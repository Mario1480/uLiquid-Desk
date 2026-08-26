import crypto from "node:crypto";
import { prisma } from "@mm/db";
import { logger } from "../logger.js";
import {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_USDC_ADDRESS,
  ARBITRUM_USDC_DECIMALS,
  BILLING_PAYMENT_CONFIRMATIONS,
  ERC20_DECIMALS_FUNCTION,
  ERC20_TRANSFER_EVENT,
  createBillingOnchainClient,
  formatArbitrumUsdcAmount,
  getArbitrumTransactionExplorerUrl,
  getBillingArbitrumRpcUrl,
  normalizeBillingAddress,
  normalizeBillingTreasuryAddress,
  normalizeBillingTxHash,
  verifyArbitrumUsdcTransaction,
  type BillingOnchainClient
} from "./onchain.js";
import {
  consumeUliqBenefitReservationInTransaction,
  createUliqBenefitReservationInTransaction,
  expireUliqBenefitReservations,
  prepareUliqBillingBenefit,
  releaseUliqBenefitReservationInTransaction,
  resolveUliqDiscountSelection,
  type PreparedUliqBillingBenefit
} from "../uliq/benefitReservation.service.js";
import { allocateUliqDiscountAcrossLines } from "../uliq/math.js";
import { getUliqFeatureFlags } from "../uliq/config.js";
import {
  buildActiveBotCapacityWhere,
  buildRealExchangeAccountCapacityWhere
} from "../admission/quotaAdmission.js";
import { CANONICAL_STAGE4_PACKAGES, canonicalPackageByCode } from "./canonicalPackages.js";

const db = prisma as any;

function uliqDiscountsRuntimeEnabled(): boolean {
  try {
    const flags = getUliqFeatureFlags();
    return flags.enabled && flags.discountsEnabled;
  } catch {
    return false;
  }
}

async function expireUliqBenefitsIfEnabled(now = new Date()): Promise<void> {
  if (uliqDiscountsRuntimeEnabled()) await expireUliqBenefitReservations(db, now);
}

export type EffectivePlan = "free" | "pro" | "premium";
export type StoredEffectivePlan = "FREE" | "PRO" | "PREMIUM";
export type ResolvedEffectivePlan = {
  userId: string;
  plan: EffectivePlan;
  status: "active" | "grace" | "inactive";
  planValidUntil: string | null;
  /** @deprecated Retained as a compatibility alias during the Premium rollout. */
  proValidUntil: string | null;
  maxExchangeAccounts: number | null;
  maxRunningBots: number;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  aiCreditBalance: bigint;
  aiCreditsUsedLifetime: bigint;
  monthlyAiCreditsIncluded: bigint;
};
export type BillingPackageKind = "plan" | "addon";
export type BillingAddonType =
  | "running_bots"
  | "running_predictions_ai"
  | "running_predictions_composite"
  | "ai_credits";
export type BillingOrderStatus =
  | "pending"
  | "confirming"
  | "paid"
  | "failed"
  | "expired"
  | "review_required";
export type AiLedgerReason = "monthly_grant" | "topup" | "usage_reserve" | "usage_settle" | "usage_release" | "usage_refund" | "admin_adjust" | "promo_grant";
export type BillingFeatureFlags = {
  billingEnabled: boolean;
  aiCreditBillingEnabled: boolean;
};

const BILLING_FEATURE_FLAGS_KEY = "admin.billingFeatureFlags.v1";
const BILLING_FEATURE_FLAGS_CACHE_MS = 5_000;
const DEFAULT_BILLING_FEATURE_FLAGS: BillingFeatureFlags = {
  billingEnabled: false,
  aiCreditBillingEnabled: true
};

const FREE_MAX_RUNNING_BOTS = 2;
const FREE_MAX_EXCHANGE_ACCOUNTS = 1;
const FREE_ALLOWED_EXCHANGES = ["*"];
const FREE_MAX_RUNNING_PREDICTIONS_AI = 0;
const FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE = 0;
const PRO_MAX_RUNNING_BOTS = 5;
const PRO_MAX_RUNNING_PREDICTIONS_AI = 3;
const PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE = 2;
const PREMIUM_MAX_RUNNING_BOTS = 15;
const PREMIUM_MAX_RUNNING_PREDICTIONS_AI = 10;
const PREMIUM_MAX_RUNNING_PREDICTIONS_COMPOSITE = 5;

export function resolvePlanBaseQuotaDefaults(plan: EffectivePlan): {
  maxRunningBots: number;
  maxRunningPredictionsAi: number;
  maxRunningPredictionsComposite: number;
} {
  if (plan === "premium") {
    return {
      maxRunningBots: PREMIUM_MAX_RUNNING_BOTS,
      maxRunningPredictionsAi: PREMIUM_MAX_RUNNING_PREDICTIONS_AI,
      maxRunningPredictionsComposite: PREMIUM_MAX_RUNNING_PREDICTIONS_COMPOSITE
    };
  }
  if (plan === "pro") {
    return {
      maxRunningBots: PRO_MAX_RUNNING_BOTS,
      maxRunningPredictionsAi: PRO_MAX_RUNNING_PREDICTIONS_AI,
      maxRunningPredictionsComposite: PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE
    };
  }
  return {
    maxRunningBots: FREE_MAX_RUNNING_BOTS,
    maxRunningPredictionsAi: FREE_MAX_RUNNING_PREDICTIONS_AI,
    maxRunningPredictionsComposite: FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE
  };
}
const DEFAULT_BILLING_CURRENCY = "USD";
const BILLING_PAYMENT_CONFIGURATION_ID = "arbitrum-usdc";
const BILLING_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const BILLING_GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const BILLING_RETRY_BASE_MS = 30_000;
const BILLING_MAX_MISSING_TRANSACTION_ATTEMPTS = 20;
const BILLING_LATE_PAYMENT_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const BILLING_DISCOVERY_LOOKBACK_BLOCKS = 5_000n;
const BILLING_DISCOVERY_SCAN_CHUNK_BLOCKS = 2_000n;
const BILLING_DISCOVERY_REORG_OVERLAP_BLOCKS = 32n;
const BILLING_DISCOVERY_RETRY_MAX_MS = 60 * 60 * 1000;
const BILLING_AI_GRANT_ALERT_SOURCE = "billing_subscription_lifecycle";
const BILLING_AI_GRANT_ALERT_TYPE = "subscription_ai_credit_failed";
export const BILLING_DB_BIGINT_MIN = -(2n ** 63n);
export const BILLING_DB_BIGINT_MAX = (2n ** 63n) - 1n;
export const BILLING_ORDER_AMOUNT_CENTS_MAX = 2_147_483_647;

export type PredictionQuotaKind = "local" | "ai" | "composite";

export type EffectiveQuota = {
  bots: {
    maxRunning: number;
  };
  predictions: {
    local: {
      maxRunning: number | null;
    };
    ai: {
      maxRunning: number | null;
    };
    composite: {
      maxRunning: number | null;
    };
  };
};

export type QuotaUsage = {
  bots: {
    running: number;
  };
  predictions: {
    local: {
      running: number;
    };
    ai: {
      running: number;
    };
    composite: {
      running: number;
    };
  };
};

export type EffectiveQuotaCaps = {
  bots?: {
    maxRunning?: number | null;
  };
  predictions?: {
    ai?: {
      maxRunning?: number | null;
    };
    composite?: {
      maxRunning?: number | null;
    };
  };
};

export type QuotaLimitCheckResult = {
  allowed: boolean;
  reason:
    | "ok"
    | "prediction_running_limit_exceeded_ai"
    | "prediction_running_limit_exceeded_composite"
    | "prediction_schedule_limit_exceeded_ai"
    | "prediction_schedule_limit_exceeded_composite";
  limits: EffectiveQuota;
  usage: QuotaUsage;
};

let billingFeatureFlagsCache:
  | {
      flags: BillingFeatureFlags;
      source: "db" | "default";
      updatedAt: string | null;
      fetchedAt: number;
    }
  | null = null;

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return 0n;
    }
  }
  return 0n;
}

export function parseBillingDbBigInt(value: unknown, options?: { min?: bigint; max?: bigint }): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (
    typeof value === "string"
    && /^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)
  ) {
    parsed = BigInt(value);
  } else {
    throw new Error("invalid_billing_integer");
  }
  const min = options?.min ?? BILLING_DB_BIGINT_MIN;
  const max = options?.max ?? BILLING_DB_BIGINT_MAX;
  if (parsed < min || parsed > max) throw new Error("billing_integer_out_of_range");
  return parsed;
}

function normalizeInt(value: unknown, fallback: number, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function normalizeNullableInt(value: unknown, fallback: number | null, min = 0): number | null {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function applyHardCap(value: number | null, hardCap: number | null | undefined): number | null {
  if (hardCap === null || hardCap === undefined) return value;
  if (value === null) return Math.max(0, hardCap);
  return Math.max(0, Math.min(value, hardCap));
}

function normalizeBillingAddonType(value: unknown): BillingAddonType | null {
  if (
    value === "running_bots"
    || value === "running_predictions_ai"
    || value === "running_predictions_composite"
    || value === "ai_credits"
  ) {
    return value;
  }
  return null;
}

function deriveAddonTypeFromPackage(pkg: any): BillingAddonType | null {
  const explicit =
    normalizeBillingAddonType(pkg?.addonType)
    ?? normalizeBillingAddonType(asRecord(pkg?.meta).billingAddonType);
  if (explicit) return explicit;
  if (pkg?.kind !== "ADDON") return null;
  const aiCredits = toBigInt(pkg?.aiCredits);
  const bots = normalizeNullableInt(pkg?.deltaRunningBots, 0, 0) ?? 0;
  const ai = normalizeNullableInt(pkg?.deltaRunningPredictionsAi, 0, 0) ?? 0;
  const composite = normalizeNullableInt(pkg?.deltaRunningPredictionsComposite, 0, 0) ?? 0;
  if (aiCredits > 0n && bots === 0 && ai === 0 && composite === 0) return "ai_credits";
  if (bots > 0 && ai === 0 && composite === 0) return "running_bots";
  if (ai > 0 && bots === 0 && composite === 0) return "running_predictions_ai";
  if (composite > 0 && bots === 0 && ai === 0) return "running_predictions_composite";
  return null;
}

function mapStoragePackageKindToPublicKind(kind: unknown): BillingPackageKind {
  return kind === "PLAN" ? "plan" : "addon";
}

function buildBillingMeta(
  meta: Record<string, unknown> | null | undefined,
  addonType: BillingAddonType | null
): Record<string, unknown> | null {
  const base = asRecord(meta);
  if (addonType) {
    return {
      ...base,
      billingAddonType: addonType
    };
  }
  if (!("billingAddonType" in base)) {
    return Object.keys(base).length > 0 ? base : null;
  }
  const { billingAddonType: _drop, ...rest } = base;
  return Object.keys(rest).length > 0 ? rest : null;
}

function createEmptyQuotaUsage(): QuotaUsage {
  return {
    bots: {
      running: 0
    },
    predictions: {
      local: {
        running: 0
      },
      ai: {
        running: 0
      },
      composite: {
        running: 0
      }
    }
  };
}

function normalizePredictionQuotaKind(value: unknown): PredictionQuotaKind | null {
  if (value === "local" || value === "ai" || value === "composite") return value;
  return null;
}

function resolvePredictionQuotaKindFromStateRow(row: {
  strategyKind?: unknown;
  signalMode?: unknown;
  featuresSnapshot?: unknown;
}): PredictionQuotaKind {
  const directKind = normalizePredictionQuotaKind(row.strategyKind);
  if (directKind) return directKind;

  const snapshot = asRecord(row.featuresSnapshot);
  const strategyRef = asRecord(snapshot.strategyRef);
  const strategyRefKind = normalizePredictionQuotaKind(strategyRef.kind);
  if (strategyRefKind) return strategyRefKind;

  if (typeof snapshot.compositeStrategyId === "string" && snapshot.compositeStrategyId.trim()) {
    return "composite";
  }
  if (typeof snapshot.localStrategyId === "string" && snapshot.localStrategyId.trim()) {
    return "local";
  }
  if (typeof snapshot.aiPromptTemplateId === "string" && snapshot.aiPromptTemplateId.trim()) {
    return "ai";
  }

  const signalMode =
    row.signalMode === "local_only" || row.signalMode === "ai_only" || row.signalMode === "both"
      ? row.signalMode
      : (typeof snapshot.signalMode === "string" ? snapshot.signalMode : "both");
  if (signalMode === "local_only") return "local";
  return "ai";
}

function normalizeCapacityDelta(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return out.length > 0 ? out : [...fallback];
}

function isSubscriptionPlanActive(row: any, now: Date): boolean {
  if (!row) return false;
  if (formatPlan(row.effectivePlan) === "free") return false;
  const validUntil = row.planValidUntil instanceof Date
    ? row.planValidUntil
    : row.proValidUntil instanceof Date
      ? row.proValidUntil
      : null;
  if (!validUntil) return false;
  return addGracePeriod(validUntil).getTime() > now.getTime();
}

function readPlanValidUntil(row: any): Date | null {
  if (row?.planValidUntil instanceof Date) return row.planValidUntil;
  if (row?.proValidUntil instanceof Date) return row.proValidUntil;
  return null;
}

export function addBillingMonths(base: Date, months: number): Date {
  const count = Math.max(1, Math.trunc(months));
  const sourceDay = base.getUTCDate();
  const next = new Date(base);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    0,
    next.getUTCHours(),
    next.getUTCMinutes(),
    next.getUTCSeconds(),
    next.getUTCMilliseconds()
  )).getUTCDate();
  next.setUTCDate(Math.min(sourceDay, lastDay));
  return next;
}

function addGracePeriod(base: Date): Date {
  return new Date(base.getTime() + BILLING_GRACE_PERIOD_MS);
}

export function planSubscriptionTermWindow(params: {
  now: Date;
  billingMonths: number;
  latestTerm?: { endsAt: Date; graceEndsAt: Date } | null;
  legacyValidUntil?: Date | null;
}): { startsAt: Date; endsAt: Date; graceEndsAt: Date } {
  let startsAt = params.now;
  if (params.latestTerm && params.latestTerm.graceEndsAt.getTime() > params.now.getTime()) {
    startsAt = params.latestTerm.endsAt;
  } else if (
    params.legacyValidUntil
    && addGracePeriod(params.legacyValidUntil).getTime() > params.now.getTime()
  ) {
    startsAt = params.legacyValidUntil;
  }
  const endsAt = addBillingMonths(startsAt, params.billingMonths);
  return { startsAt, endsAt, graceEndsAt: addGracePeriod(endsAt) };
}

export function buildSubscriptionMonthlyGrantSchedule(startsAt: Date, endsAt: Date): Date[] {
  const dates: Date[] = [];
  for (let cycle = 0; cycle < 120; cycle += 1) {
    const scheduledAt = cycle === 0 ? new Date(startsAt) : addBillingMonths(startsAt, cycle);
    if (scheduledAt >= endsAt) break;
    dates.push(scheduledAt);
  }
  return dates;
}

export function resolveSubscriptionTermPhase(params: {
  startsAt: Date;
  endsAt: Date;
  graceEndsAt: Date;
  now: Date;
}): "scheduled" | "active" | "grace" | "expired" {
  if (params.now < params.startsAt) return "scheduled";
  if (params.now < params.endsAt) return "active";
  if (params.now < params.graceEndsAt) return "grace";
  return "expired";
}

export function cutoffCapacityGrantValidity(
  currentValidUntil: Date | null,
  nextTermStartsAt: Date
): Date {
  return !currentValidUntil || currentValidUntil > nextTermStartsAt
    ? nextTermStartsAt
    : currentValidUntil;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "off") return false;
  }
  return fallback;
}

function normalizeBillingFeatureFlags(value: unknown): BillingFeatureFlags {
  const raw = asRecord(value);
  return {
    billingEnabled: asBoolean(raw.billingEnabled, DEFAULT_BILLING_FEATURE_FLAGS.billingEnabled),
    aiCreditBillingEnabled: asBoolean(
      raw.aiCreditBillingEnabled,
      DEFAULT_BILLING_FEATURE_FLAGS.aiCreditBillingEnabled
    )
  };
}

export function mergeBillingFeatureFlags(
  current: BillingFeatureFlags,
  next: Partial<BillingFeatureFlags>
): BillingFeatureFlags {
  const raw = asRecord(next);
  return {
    billingEnabled: raw.billingEnabled === undefined
      ? current.billingEnabled
      : asBoolean(raw.billingEnabled, current.billingEnabled),
    aiCreditBillingEnabled: raw.aiCreditBillingEnabled === undefined
      ? current.aiCreditBillingEnabled
      : asBoolean(raw.aiCreditBillingEnabled, current.aiCreditBillingEnabled)
  };
}

async function loadBillingFeatureFlags(
  force = false
): Promise<{
  flags: BillingFeatureFlags;
  source: "db" | "default";
  updatedAt: string | null;
}> {
  const now = Date.now();
  if (
    !force &&
    billingFeatureFlagsCache &&
    now - billingFeatureFlagsCache.fetchedAt <= BILLING_FEATURE_FLAGS_CACHE_MS
  ) {
    return {
      flags: billingFeatureFlagsCache.flags,
      source: billingFeatureFlagsCache.source,
      updatedAt: billingFeatureFlagsCache.updatedAt
    };
  }

  const row = await db.globalSetting.findUnique({
    where: { key: BILLING_FEATURE_FLAGS_KEY },
    select: { value: true, updatedAt: true }
  });
  const source: "db" | "default" = row ? "db" : "default";
  const flags = row
    ? normalizeBillingFeatureFlags(row.value)
    : { ...DEFAULT_BILLING_FEATURE_FLAGS };
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  billingFeatureFlagsCache = {
    flags,
    source,
    updatedAt,
    fetchedAt: now
  };
  return { flags, source, updatedAt };
}

export async function getBillingFeatureFlags(): Promise<BillingFeatureFlags> {
  const loaded = await loadBillingFeatureFlags();
  return loaded.flags;
}

export async function getBillingFeatureFlagsSettings(): Promise<
  BillingFeatureFlags & {
    source: "db" | "default";
    updatedAt: string | null;
    defaults: BillingFeatureFlags;
  }
> {
  const loaded = await loadBillingFeatureFlags();
  return {
    ...loaded.flags,
    source: loaded.source,
    updatedAt: loaded.updatedAt,
    defaults: { ...DEFAULT_BILLING_FEATURE_FLAGS }
  };
}

export async function updateBillingFeatureFlags(
  next: Partial<BillingFeatureFlags>
): Promise<
  BillingFeatureFlags & {
    source: "db";
    updatedAt: string | null;
    defaults: BillingFeatureFlags;
  }
> {
  const current = await loadBillingFeatureFlags(true);
  const normalized = mergeBillingFeatureFlags(current.flags, next);
  if (normalized.billingEnabled && !current.flags.billingEnabled) {
    const readiness = await getArbitrumUsdcPaymentReadiness();
    if (!readiness.configured || !readiness.rpc.ready) {
      throw new Error("payment_config_not_ready");
    }
  }
  const row = await db.globalSetting.upsert({
    where: { key: BILLING_FEATURE_FLAGS_KEY },
    create: { key: BILLING_FEATURE_FLAGS_KEY, value: normalized },
    update: { value: normalized },
    select: { value: true, updatedAt: true }
  });
  const effective = normalizeBillingFeatureFlags(row.value);
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  billingFeatureFlagsCache = {
    flags: effective,
    source: "db",
    updatedAt,
    fetchedAt: Date.now()
  };
  return {
    ...effective,
    source: "db",
    updatedAt,
    defaults: { ...DEFAULT_BILLING_FEATURE_FLAGS }
  };
}

export async function isBillingEnabled(): Promise<boolean> {
  return (await getBillingFeatureFlags()).billingEnabled;
}

export async function isAiCreditBillingEnabled(): Promise<boolean> {
  return (await getBillingFeatureFlags()).aiCreditBillingEnabled;
}

export {
  ARBITRUM_ONE_CHAIN_ID,
  ARBITRUM_USDC_ADDRESS,
  ARBITRUM_USDC_DECIMALS,
  BILLING_PAYMENT_CONFIRMATIONS
} from "./onchain.js";

export type ArbitrumUsdcPaymentConfiguration = {
  configured: boolean;
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number;
  treasuryAddress: string | null;
  revision: number | null;
  confirmationsRequired: number;
  updatedAt: string | null;
};

export async function getArbitrumUsdcPaymentConfiguration(): Promise<ArbitrumUsdcPaymentConfiguration> {
  const row = await db.billingPaymentConfiguration.findUnique({
    where: { id: BILLING_PAYMENT_CONFIGURATION_ID }
  });
  let treasuryAddress: string | null = null;
  try {
    treasuryAddress = row?.treasuryAddress
      ? normalizeBillingTreasuryAddress(row.treasuryAddress)
      : null;
  } catch {
    treasuryAddress = null;
  }
  const exactNetwork =
    Number(row?.chainId) === ARBITRUM_ONE_CHAIN_ID
    && String(row?.tokenAddress ?? "").toLowerCase() === ARBITRUM_USDC_ADDRESS.toLowerCase()
    && Number(row?.tokenDecimals) === ARBITRUM_USDC_DECIMALS;
  return {
    configured: Boolean(treasuryAddress && exactNetwork),
    chainId: ARBITRUM_ONE_CHAIN_ID,
    tokenAddress: ARBITRUM_USDC_ADDRESS,
    tokenDecimals: ARBITRUM_USDC_DECIMALS,
    treasuryAddress,
    revision: row ? normalizeInt(row.revision, 1, 1) : null,
    confirmationsRequired: BILLING_PAYMENT_CONFIRMATIONS,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

export async function runSerializableBillingConfigTransaction<T>(
  database: any,
  work: (tx: any) => Promise<T>
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await database.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      lastError = error;
      const code = String((error as any)?.code ?? "");
      const message = String((error as any)?.message ?? error).toLowerCase();
      const retryable =
        code === "P2034"
        || code === "P2002"
        || message.includes("serialization")
        || message.includes("write conflict");
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw lastError;
}

export async function updateArbitrumUsdcPaymentConfiguration(params: {
  treasuryAddress: string;
  actorUserId: string;
  ip?: string | null;
}): Promise<ArbitrumUsdcPaymentConfiguration> {
  const treasuryAddress = normalizeBillingTreasuryAddress(params.treasuryAddress);
  await runSerializableBillingConfigTransaction(db, async (tx: any) => {
    const current = await tx.billingPaymentConfiguration.findUnique({
      where: { id: BILLING_PAYMENT_CONFIGURATION_ID }
    });
    const isSame =
      current
      && String(current.treasuryAddress ?? "").toLowerCase() === treasuryAddress
      && Number(current.chainId) === ARBITRUM_ONE_CHAIN_ID
      && String(current.tokenAddress ?? "").toLowerCase() === ARBITRUM_USDC_ADDRESS.toLowerCase()
      && Number(current.tokenDecimals) === ARBITRUM_USDC_DECIMALS;
    const revision = isSame ? normalizeInt(current.revision, 1, 1) : normalizeInt(current?.revision, 0, 0) + 1;
    await tx.billingPaymentConfiguration.upsert({
      where: { id: BILLING_PAYMENT_CONFIGURATION_ID },
      create: {
        id: BILLING_PAYMENT_CONFIGURATION_ID,
        chainId: ARBITRUM_ONE_CHAIN_ID,
        tokenAddress: ARBITRUM_USDC_ADDRESS.toLowerCase(),
        tokenDecimals: ARBITRUM_USDC_DECIMALS,
        treasuryAddress,
        revision
      },
      update: {
        chainId: ARBITRUM_ONE_CHAIN_ID,
        tokenAddress: ARBITRUM_USDC_ADDRESS.toLowerCase(),
        tokenDecimals: ARBITRUM_USDC_DECIMALS,
        treasuryAddress,
        revision
      }
    });
    if (!isSame) {
      await tx.adminAuditEvent.create({
        data: {
          actorUserId: params.actorUserId,
          action: "billing.payment_configuration.treasury_rotated",
          targetType: "BillingPaymentConfiguration",
          targetId: BILLING_PAYMENT_CONFIGURATION_ID,
          targetLabel: "Arbitrum USDC treasury",
          ip: params.ip ?? null,
          metadata: {
            oldTreasuryAddress: current?.treasuryAddress ?? null,
            newTreasuryAddress: treasuryAddress,
            previousRevision: current?.revision ?? null,
            revision,
            chainId: ARBITRUM_ONE_CHAIN_ID,
            tokenAddress: ARBITRUM_USDC_ADDRESS.toLowerCase()
          }
        }
      });
    }
  });
  return getArbitrumUsdcPaymentConfiguration();
}

export async function getArbitrumUsdcPaymentReadiness(params?: {
  client?: BillingOnchainClient;
}): Promise<ArbitrumUsdcPaymentConfiguration & {
  token: {
    ready: boolean;
    hasCode: boolean;
    decimals: number | null;
    error: string | null;
  };
  rpc: {
    ready: boolean;
    lastBlockNumber: string | null;
    lastCheckedAt: string | null;
    error: string | null;
  };
}> {
  const config = await getArbitrumUsdcPaymentConfiguration();
  const checkedAt = new Date();
  let lastBlockNumber: bigint | null = null;
  let tokenHasCode = false;
  let tokenDecimals: number | null = null;
  let error: string | null = null;
  try {
    const client = params?.client ?? createBillingOnchainClient();
    const inspected = await inspectArbitrumUsdcRpc(client);
    lastBlockNumber = inspected.blockNumber;
    tokenHasCode = inspected.tokenHasCode;
    tokenDecimals = inspected.tokenDecimals;
  } catch (caught) {
    error = String((caught as any)?.message ?? caught).slice(0, 300);
  }

  const row = await db.billingPaymentConfiguration.findUnique({
    where: { id: BILLING_PAYMENT_CONFIGURATION_ID }
  });
  if (row) {
    await db.billingPaymentConfiguration.update({
      where: { id: BILLING_PAYMENT_CONFIGURATION_ID },
      data: {
        lastRpcBlockNumber: lastBlockNumber,
        lastRpcCheckAt: checkedAt,
        lastRpcError: error
      }
    });
  }
  return {
    ...config,
    token: {
      ready: tokenHasCode && tokenDecimals === ARBITRUM_USDC_DECIMALS && !error,
      hasCode: tokenHasCode,
      decimals: tokenDecimals,
      error
    },
    rpc: {
      ready:
        config.configured
        && lastBlockNumber !== null
        && tokenHasCode
        && tokenDecimals === ARBITRUM_USDC_DECIMALS
        && !error,
      lastBlockNumber: lastBlockNumber?.toString() ?? null,
      lastCheckedAt: checkedAt.toISOString(),
      error
    }
  };
}

export async function inspectArbitrumUsdcRpc(
  client: BillingOnchainClient
): Promise<{ blockNumber: bigint; tokenHasCode: boolean; tokenDecimals: number }> {
  const chainId = await client.getChainId();
  if (chainId !== ARBITRUM_ONE_CHAIN_ID) throw new Error("billing_rpc_wrong_chain");
  const [blockNumber, bytecode, rawDecimals] = await Promise.all([
    client.getBlockNumber(),
    client.getBytecode({ address: ARBITRUM_USDC_ADDRESS.toLowerCase() as `0x${string}` }),
    client.readContract({
      address: ARBITRUM_USDC_ADDRESS,
      abi: [ERC20_DECIMALS_FUNCTION],
      functionName: "decimals"
    })
  ]);
  const tokenHasCode = typeof bytecode === "string" && bytecode !== "0x";
  if (!tokenHasCode) throw new Error("billing_usdc_contract_code_missing");
  const tokenDecimals = Number(rawDecimals);
  if (tokenDecimals !== ARBITRUM_USDC_DECIMALS) {
    throw new Error("billing_usdc_decimals_mismatch");
  }
  return { blockNumber, tokenHasCode, tokenDecimals };
}

export async function requireLiveArbitrumBillingBlock(
  client: BillingOnchainClient
): Promise<bigint> {
  try {
    return (await inspectArbitrumUsdcRpc(client)).blockNumber;
  } catch (error) {
    if (String((error as any)?.message ?? error) === "billing_rpc_wrong_chain") {
      throw new Error("payment_config_not_ready");
    }
    throw error;
  }
}

export function formatPlan(value: unknown): EffectivePlan {
  if (value === "PREMIUM" || value === "premium") return "premium";
  if (value === "PRO" || value === "pro") return "pro";
  return "free";
}

function toStoredPlan(value: EffectivePlan): StoredEffectivePlan {
  if (value === "premium") return "PREMIUM";
  if (value === "pro") return "PRO";
  return "FREE";
}

function toStrategyPlan(value: EffectivePlan): EffectivePlan {
  return value;
}

export function isEnterpriseStrategyLicense(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "enterprise";
}

export function buildCommercialStrategyEntitlements(plan: EffectivePlan): {
  plan: EffectivePlan;
  allowedStrategyKinds: Array<"local" | "ai" | "composite">;
  maxCompositeNodes: number;
  aiAllowedModels: string[];
} {
  const allowAdvancedStrategies = plan !== "free";
  return {
    plan,
    allowedStrategyKinds: allowAdvancedStrategies
      ? ["local", "ai", "composite"]
      : ["local"],
    maxCompositeNodes: allowAdvancedStrategies ? 12 : 0,
    aiAllowedModels: allowAdvancedStrategies ? ["*"] : []
  };
}

function getDefaultMonthlyCredits(): bigint {
  return canonicalPackageByCode("pro_monthly").monthlyAiCredits;
}

export async function ensureBillingDefaults(): Promise<void> {
  if (!db.billingPackage || typeof db.billingPackage.upsert !== "function") return;

  const proMonthlyPriceCents = canonicalPackageByCode("pro_monthly").priceCents;
  const proMonthlyCredits = getDefaultMonthlyCredits();
  const entitlementTopupPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_PRICE_CENTS ?? "1500",
    1500
  );
  const entitlementBotsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_BOTS_PRICE_CENTS ?? "500",
    500
  );
  const entitlementAiPredictionsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_AI_PREDICTIONS_PRICE_CENTS ?? "500",
    500
  );
  const entitlementCompositePredictionsUnitPriceCents = normalizeInt(
    process.env.BILLING_ENTITLEMENT_TOPUP_COMPOSITE_PREDICTIONS_PRICE_CENTS ?? "500",
    500
  );

  await db.billingPackage.upsert({
    where: { code: "free" },
    update: {},
    create: {
      code: "free",
      name: "Free",
      description: "Starter plan",
      kind: "PLAN",
      addonType: null,
      isActive: true,
      sortOrder: 0,
      priceCents: 0,
      billingMonths: 1,
      plan: "FREE",
      maxExchangeAccounts: FREE_MAX_EXCHANGE_ACCOUNTS,
      maxRunningBots: FREE_MAX_RUNNING_BOTS,
      maxRunningPredictionsAi: FREE_MAX_RUNNING_PREDICTIONS_AI,
      maxRunningPredictionsComposite: FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      allowedExchanges: [...FREE_ALLOWED_EXCHANGES],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: null,
      deltaRunningPredictionsAi: null,
      deltaRunningPredictionsComposite: null
    }
  });

  await db.billingPackage.upsert({
    where: { code: "pro_monthly" },
    update: { monthlyAiCredits: proMonthlyCredits },
    create: {
      code: "pro_monthly",
      name: "Pro Monthly",
      description: "Monthly Pro subscription",
      kind: "PLAN",
      addonType: null,
      isActive: true,
      sortOrder: 10,
      priceCents: proMonthlyPriceCents,
      billingMonths: 1,
      plan: "PRO",
      maxExchangeAccounts: null,
      maxRunningBots: PRO_MAX_RUNNING_BOTS,
      maxRunningPredictionsAi: PRO_MAX_RUNNING_PREDICTIONS_AI,
      maxRunningPredictionsComposite: PRO_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      allowedExchanges: ["*"],
      monthlyAiCredits: proMonthlyCredits,
      aiCredits: 0n,
      deltaRunningBots: null,
      deltaRunningPredictionsAi: null,
      deltaRunningPredictionsComposite: null
    }
  });

  await db.billingPackage.upsert({
    where: { code: "ai_topup_250k" },
    update: { isActive: false, aiCredits: 0n },
    create: {
      code: "ai_topup_250k",
      name: "AI Topup 250k",
      description: "Legacy AI credit package (inactive)",
      kind: "ADDON",
      addonType: "AI_CREDITS",
      isActive: false,
      sortOrder: 20,
      priceCents: 0,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: null,
      deltaRunningPredictionsAi: null,
      deltaRunningPredictionsComposite: null,
      meta: {
        billingAddonType: "ai_credits"
      }
    }
  });

  for (const topup of [
    { code: "ai_topup_10k", name: "10,000 AI Credits", credits: 10_000n, priceCents: 1_000, sortOrder: 20 },
    { code: "ai_topup_25k", name: "25,000 AI Credits", credits: 25_000n, priceCents: 2_500, sortOrder: 21 },
    { code: "ai_topup_50k", name: "50,000 AI Credits", credits: 50_000n, priceCents: 5_000, sortOrder: 22 },
    { code: "ai_topup_100k", name: "100,000 AI Credits", credits: 100_000n, priceCents: 10_000, sortOrder: 23 }
  ]) {
    await db.billingPackage.upsert({
      where: { code: topup.code },
      update: {
        name: topup.name,
        description: "Prepaid AI Credits for cost-based OpenAI usage",
        addonType: "AI_CREDITS",
        isActive: true,
        sortOrder: topup.sortOrder,
        priceCents: topup.priceCents,
        aiCredits: topup.credits,
        meta: { billingAddonType: "ai_credits" }
      },
      create: {
        code: topup.code,
        name: topup.name,
        description: "Prepaid AI Credits for cost-based OpenAI usage",
        kind: "ADDON",
        addonType: "AI_CREDITS",
        isActive: true,
        sortOrder: topup.sortOrder,
        priceCents: topup.priceCents,
        billingMonths: 1,
        plan: null,
        maxRunningBots: null,
        maxRunningPredictionsAi: null,
        maxRunningPredictionsComposite: null,
        allowedExchanges: ["*"],
        monthlyAiCredits: 0n,
        aiCredits: topup.credits,
        deltaRunningBots: null,
        deltaRunningPredictionsAi: null,
        deltaRunningPredictionsComposite: null,
        meta: { billingAddonType: "ai_credits" }
      }
    });
  }

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_starter" },
    update: {
      isActive: false
    },
    create: {
      code: "capacity_topup_starter",
      name: "Capacity Topup Starter",
      description: "Extra bot and prediction capacity until plan end",
      kind: "ADDON",
      addonType: null,
      isActive: false,
      sortOrder: 30,
      priceCents: entitlementTopupPriceCents,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: 1,
      deltaRunningPredictionsAi: 1,
      deltaRunningPredictionsComposite: 1,
      meta: {
        billingAddonType: "running_bots"
      }
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_bots_unit" },
    update: {},
    create: {
      code: "capacity_topup_bots_unit",
      name: "Capacity Topup Bots Unit",
      description: "Adds bot capacity until plan end",
      kind: "ADDON",
      addonType: "RUNNING_BOTS",
      isActive: true,
      sortOrder: 31,
      priceCents: entitlementBotsUnitPriceCents,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: 1,
      deltaRunningPredictionsAi: 0,
      deltaRunningPredictionsComposite: 0,
      meta: {
        billingAddonType: "running_bots"
      }
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_ai_predictions_unit" },
    update: {},
    create: {
      code: "capacity_topup_ai_predictions_unit",
      name: "Capacity Topup AI Predictions Unit",
      description: "Adds AI prediction capacity until plan end",
      kind: "ADDON",
      addonType: "RUNNING_PREDICTIONS_AI",
      isActive: true,
      sortOrder: 32,
      priceCents: entitlementAiPredictionsUnitPriceCents,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: 0,
      deltaRunningPredictionsAi: 1,
      deltaRunningPredictionsComposite: 0,
      meta: {
        billingAddonType: "running_predictions_ai"
      }
    }
  });

  await db.billingPackage.upsert({
    where: { code: "capacity_topup_composite_predictions_unit" },
    update: {},
    create: {
      code: "capacity_topup_composite_predictions_unit",
      name: "Capacity Topup Composite Predictions Unit",
      description: "Adds composite prediction capacity until plan end",
      kind: "ADDON",
      addonType: "RUNNING_PREDICTIONS_COMPOSITE",
      isActive: true,
      sortOrder: 33,
      priceCents: entitlementCompositePredictionsUnitPriceCents,
      billingMonths: 1,
      plan: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: 0,
      deltaRunningPredictionsAi: 0,
      deltaRunningPredictionsComposite: 1,
      meta: {
        billingAddonType: "running_predictions_composite"
      }
    }
  });
}

async function getOrCreateSubscription(userId: string, tx: any = db): Promise<any> {
  const existing = await tx.userSubscription.findUnique({ where: { userId } });
  if (existing) return existing;
  const freeDefaults = await getFreePlanDefaults(tx);
  return tx.userSubscription.create({
    data: {
      userId,
      effectivePlan: "FREE",
      status: "ACTIVE",
      maxExchangeAccounts: freeDefaults.maxExchangeAccounts,
      maxRunningBots: freeDefaults.maxRunningBots,
      maxRunningPredictionsAi: freeDefaults.maxRunningPredictionsAi,
      maxRunningPredictionsComposite: freeDefaults.maxRunningPredictionsComposite,
      allowedExchanges: freeDefaults.allowedExchanges,
      aiCreditBalance: freeDefaults.monthlyAiCredits,
      aiCreditsUsedLifetime: 0n,
      monthlyAiCreditsIncluded: freeDefaults.monthlyAiCredits
    }
  });
}

async function getFreePlanDefaults(tx: any = db): Promise<{
  maxExchangeAccounts: number;
  maxRunningBots: number;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: bigint;
}> {
  const pkg = await tx.billingPackage.findUnique({
    where: { code: "free" },
    select: {
      maxExchangeAccounts: true,
      maxRunningBots: true,
      maxRunningPredictionsAi: true,
      maxRunningPredictionsComposite: true,
      allowedExchanges: true,
      monthlyAiCredits: true
    }
  });

  return {
    maxExchangeAccounts: normalizeNullableInt(
      pkg?.maxExchangeAccounts,
      FREE_MAX_EXCHANGE_ACCOUNTS,
      0
    ) ?? FREE_MAX_EXCHANGE_ACCOUNTS,
    maxRunningBots: normalizeInt(pkg?.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      pkg?.maxRunningPredictionsAi,
      FREE_MAX_RUNNING_PREDICTIONS_AI,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      pkg?.maxRunningPredictionsComposite,
      FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      0
    ),
    allowedExchanges: normalizeStringArray(pkg?.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
    monthlyAiCredits: toBigInt(pkg?.monthlyAiCredits)
  };
}

export function buildPlanPackageLiveSyncWhere(plan: StoredEffectivePlan) {
  return plan === "FREE"
    ? { effectivePlan: "FREE" as const }
    : {
        effectivePlan: plan,
        // Paid terms own immutable entitlement snapshots. Only termless legacy paid
        // subscriptions may continue to mirror the mutable package defaults.
        terms: { none: {} }
      };
}

export async function ensureAiCreditMinimumInTransaction(params: {
  tx: any;
  subscriptionId: string;
  minimum: bigint;
}): Promise<{ balance: bigint; granted: bigint }> {
  const minimum = params.minimum > 0n ? params.minimum : 0n;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    const current = toBigInt(row?.aiCreditBalance);
    if (current >= minimum) return { balance: current, granted: 0n };
    const granted = minimum - current;
    const claimed = await params.tx.userSubscription.updateMany({
      where: { id: params.subscriptionId, aiCreditBalance: current },
      data: { aiCreditBalance: { increment: granted } }
    });
    if (claimed.count === 1) return { balance: minimum, granted };
  }
  throw new Error("ai_credit_balance_concurrent_update");
}

async function syncPlanPackageToSubscriptions(pkg: {
  kind: "PLAN" | "ADDON";
  plan: StoredEffectivePlan | null;
  maxExchangeAccounts: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: bigint;
}): Promise<void> {
  if (pkg.kind !== "PLAN" || !pkg.plan) return;

  if (pkg.plan === "FREE") {
    const freeWhere = buildPlanPackageLiveSyncWhere("FREE");
    const freeMonthlyCredits = toBigInt(pkg.monthlyAiCredits);
    const freeRows = await db.userSubscription.findMany({
      where: freeWhere,
      select: { userId: true }
    });

    await db.userSubscription.updateMany({
      where: freeWhere,
      data: {
        status: "ACTIVE",
        entitlementSyncPending: true,
        maxExchangeAccounts: normalizeNullableInt(
          pkg.maxExchangeAccounts,
          FREE_MAX_EXCHANGE_ACCOUNTS,
          0
        ) ?? FREE_MAX_EXCHANGE_ACCOUNTS,
        maxRunningBots: normalizeInt(pkg.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
        maxRunningPredictionsAi: normalizeNullableInt(
          pkg.maxRunningPredictionsAi,
          FREE_MAX_RUNNING_PREDICTIONS_AI,
          0
        ),
        maxRunningPredictionsComposite: normalizeNullableInt(
          pkg.maxRunningPredictionsComposite,
          FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
          0
        ),
        allowedExchanges: normalizeStringArray(pkg.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
        monthlyAiCreditsIncluded: freeMonthlyCredits
      }
    });

    if (freeMonthlyCredits > 0n) {
      const rows = await db.userSubscription.findMany({
        where: {
          ...freeWhere,
          aiCreditBalance: {
            lt: freeMonthlyCredits
          }
        },
        select: {
          id: true,
          userId: true
        }
      });

      for (const row of rows) {
        await runSerializableBillingConfigTransaction(db, async (tx: any) => {
          const latest = await tx.userSubscription.findUnique({
            where: { id: row.id },
            select: {
              id: true,
              userId: true,
              aiCreditBalance: true
            }
          });
          if (!latest) return;
          const ensured = await ensureAiCreditMinimumInTransaction({
            tx,
            subscriptionId: latest.id,
            minimum: freeMonthlyCredits
          });

          if (ensured.granted > 0n) {
            await tx.aiCreditLedger.create({
              data: {
                userId: latest.userId,
                subscriptionId: latest.id,
                reason: "MONTHLY_GRANT",
                deltaCredits: ensured.granted,
                balanceAfterCredits: ensured.balance,
                meta: {
                  source: "free_package_sync",
                  packagePlan: "FREE"
                }
              }
            });
          }
        });
      }
    }

    for (const row of freeRows) {
      const userId = typeof row.userId === "string" ? row.userId.trim() : "";
      if (!userId) continue;
      await syncWorkspaceEntitlementsWithRetryTracking({
        userId,
        effectivePlan: "free"
      });
    }
    return;
  }

  const paidWhere = buildPlanPackageLiveSyncWhere(pkg.plan);
  const paidRows = await db.userSubscription.findMany({
    where: paidWhere,
    select: { userId: true }
  });

  const paidDefaults = resolvePlanBaseQuotaDefaults(formatPlan(pkg.plan));
  await db.userSubscription.updateMany({
    where: paidWhere,
    data: {
      status: "ACTIVE",
      entitlementSyncPending: true,
      maxExchangeAccounts: normalizeNullableInt(pkg.maxExchangeAccounts, null, 0),
      maxRunningBots: normalizeInt(pkg.maxRunningBots, paidDefaults.maxRunningBots, 0),
      maxRunningPredictionsAi: normalizeNullableInt(
        pkg.maxRunningPredictionsAi,
        paidDefaults.maxRunningPredictionsAi,
        0
      ),
      maxRunningPredictionsComposite: normalizeNullableInt(
        pkg.maxRunningPredictionsComposite,
        paidDefaults.maxRunningPredictionsComposite,
        0
      ),
      allowedExchanges: normalizeStringArray(pkg.allowedExchanges, ["*"]),
      monthlyAiCreditsIncluded: toBigInt(pkg.monthlyAiCredits)
    }
  });

  const effectivePlan = formatPlan(pkg.plan);
  for (const row of paidRows) {
    const userId = typeof row.userId === "string" ? row.userId.trim() : "";
    if (!userId) continue;
    await syncWorkspaceEntitlementsWithRetryTracking({
      userId,
      effectivePlan
    });
  }
}

export async function setUserToFreePlan(params: {
  userId: string;
  syncWorkspaceEntitlements?: boolean;
}): Promise<ResolvedEffectivePlan> {
  await ensureBillingDefaults();

  await runSerializableBillingConfigTransaction(db, async (tx: any) => {
    const defaults = await getFreePlanDefaults(tx);
    const sub = await getOrCreateSubscription(params.userId, tx);

    await tx.userSubscription.update({
      where: { id: sub.id },
      data: {
        effectivePlan: "FREE",
        status: "ACTIVE",
        planValidUntil: null,
        proValidUntil: null,
        maxExchangeAccounts: defaults.maxExchangeAccounts,
        maxRunningBots: defaults.maxRunningBots,
        maxRunningPredictionsAi: defaults.maxRunningPredictionsAi,
        maxRunningPredictionsComposite: defaults.maxRunningPredictionsComposite,
        allowedExchanges: defaults.allowedExchanges,
        monthlyAiCreditsIncluded: defaults.monthlyAiCredits,
        entitlementSyncPending: true
      }
    });

    const ensured = await ensureAiCreditMinimumInTransaction({
      tx,
      subscriptionId: sub.id,
      minimum: defaults.monthlyAiCredits
    });
    if (ensured.granted > 0n) {
      await tx.aiCreditLedger.create({
        data: {
          userId: params.userId,
          subscriptionId: sub.id,
          reason: "MONTHLY_GRANT",
          deltaCredits: ensured.granted,
          balanceAfterCredits: ensured.balance,
          meta: {
            source: "set_user_to_free_plan",
            packageCode: "free"
          }
        }
      });
    }
  });

  if (params.syncWorkspaceEntitlements !== false) {
    await syncWorkspaceEntitlementsWithRetryTracking({
      userId: params.userId,
      effectivePlan: "free"
    });
  }

  return resolveEffectivePlanForUser(params.userId);
}

export async function syncPrimaryWorkspaceEntitlementsForUser(params: {
  userId: string;
  effectivePlan: EffectivePlan;
}): Promise<void> {
  if (!db.workspaceMember || !db.licenseEntitlement) return;

  const membership = await db.workspaceMember.findFirst({
    where: { userId: params.userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  const workspaceId = typeof membership?.workspaceId === "string" ? membership.workspaceId.trim() : "";
  if (!workspaceId) return;

  const existing = await db.licenseEntitlement.findUnique({
    where: { workspaceId },
    select: { plan: true }
  });
  if (isEnterpriseStrategyLicense(existing?.plan)) {
    return;
  }

  const {
    plan,
    allowedStrategyKinds,
    maxCompositeNodes,
    aiAllowedModels
  } = buildCommercialStrategyEntitlements(toStrategyPlan(params.effectivePlan));

  await db.licenseEntitlement.upsert({
    where: { workspaceId },
    update: {
      plan,
      allowedStrategyKinds,
      allowedStrategyIds: [],
      maxCompositeNodes,
      aiAllowedModels,
      aiMonthlyBudgetUsd: null
    },
    create: {
      workspaceId,
      plan,
      allowedStrategyKinds,
      allowedStrategyIds: [],
      maxCompositeNodes,
      aiAllowedModels,
      aiMonthlyBudgetUsd: null
    }
  });
}

export async function syncWorkspaceEntitlementsWithRetryTracking(params: {
  userId: string;
  effectivePlan: EffectivePlan;
}): Promise<boolean> {
  return runTrackedWorkspaceEntitlementSync({
    database: db,
    sync: () => syncPrimaryWorkspaceEntitlementsForUser(params),
    userId: params.userId
  });
}

export async function runTrackedWorkspaceEntitlementSync(params: {
  database: any;
  sync: () => Promise<void>;
  userId: string;
}): Promise<boolean> {
  try {
    await params.sync();
    await params.database.userSubscription.updateMany({
      where: { userId: params.userId },
      data: {
        entitlementSyncPending: false,
        entitlementSyncAttempts: 0,
        entitlementSyncLastError: null,
        entitlementSyncedAt: new Date()
      }
    });
    return true;
  } catch (error) {
    await params.database.userSubscription.updateMany({
      where: { userId: params.userId },
      data: {
        entitlementSyncPending: true,
        entitlementSyncAttempts: { increment: 1 },
        entitlementSyncLastError: String((error as any)?.message ?? error).slice(0, 500)
      }
    });
    return false;
  }
}

export async function resolveEffectivePlanForUser(userId: string): Promise<ResolvedEffectivePlan> {
  const now = new Date();
  let row = await getOrCreateSubscription(userId);
  let term = await db.subscriptionTerm.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "GRACE"] },
      startsAt: { lte: now },
      graceEndsAt: { gt: now },
      activatedAt: { not: null }
    },
    orderBy: { startsAt: "desc" }
  });
  const dueTerm = await db.subscriptionTerm.findFirst({
    where: { userId, status: "SCHEDULED", startsAt: { lte: now } },
    select: { id: true }
  });
  const lifecycleNeeded = Boolean(
    dueTerm
    || (term?.status === "ACTIVE" && term.endsAt <= now)
    || (term?.status === "GRACE" && term.graceEndsAt <= now)
    || (formatPlan(row.effectivePlan) !== "free" && !term && !isSubscriptionPlanActive(row, now))
  );
  if (lifecycleNeeded) {
    await runSubscriptionLifecycle({ now, limit: 50, userId });
    row = await getOrCreateSubscription(userId);
    term = await db.subscriptionTerm.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "GRACE"] },
        startsAt: { lte: now },
        graceEndsAt: { gt: now },
        activatedAt: { not: null }
      },
      orderBy: { startsAt: "desc" }
    });
  }

  const legacyActiveWithoutTerm = !term && isSubscriptionPlanActive(row, now);
  const effectivePlan = term
    ? formatPlan(readTermSnapshot(term).plan)
    : formatPlan(row.effectivePlan);
  const planValidUntil = readPlanValidUntil(row)
    ?? (term?.endsAt instanceof Date ? term.endsAt : null);
  if (effectivePlan !== "free" && (term || legacyActiveWithoutTerm)) {
    const paidDefaults = resolvePlanBaseQuotaDefaults(effectivePlan);
    const inGrace = term
      ? term.endsAt <= now
      : planValidUntil instanceof Date && planValidUntil <= now;
    return {
      userId,
      plan: effectivePlan,
      status: inGrace ? "grace" : "active",
      planValidUntil: planValidUntil ? planValidUntil.toISOString() : null,
      proValidUntil: row.proValidUntil ? row.proValidUntil.toISOString() : null,
      maxExchangeAccounts: normalizeNullableInt(row.maxExchangeAccounts, null, 0),
      maxRunningBots: normalizeInt(row.maxRunningBots, paidDefaults.maxRunningBots, 0),
      maxRunningPredictionsAi: normalizeNullableInt(
        row.maxRunningPredictionsAi,
        paidDefaults.maxRunningPredictionsAi,
        0
      ),
      maxRunningPredictionsComposite: normalizeNullableInt(
        row.maxRunningPredictionsComposite,
        paidDefaults.maxRunningPredictionsComposite,
        0
      ),
      allowedExchanges: normalizeStringArray(row.allowedExchanges, ["*"]),
      aiCreditBalance: toBigInt(row.aiCreditBalance),
      aiCreditsUsedLifetime: toBigInt(row.aiCreditsUsedLifetime),
      monthlyAiCreditsIncluded: toBigInt(row.monthlyAiCreditsIncluded)
    };
  }

  return {
    userId,
    plan: "free",
    status: "active",
    planValidUntil: planValidUntil ? planValidUntil.toISOString() : null,
    proValidUntil: row.proValidUntil ? row.proValidUntil.toISOString() : null,
    maxExchangeAccounts: normalizeNullableInt(
      row.maxExchangeAccounts,
      FREE_MAX_EXCHANGE_ACCOUNTS,
      0
    ),
    maxRunningBots: normalizeInt(row.maxRunningBots, FREE_MAX_RUNNING_BOTS, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      row.maxRunningPredictionsAi,
      FREE_MAX_RUNNING_PREDICTIONS_AI,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      row.maxRunningPredictionsComposite,
      FREE_MAX_RUNNING_PREDICTIONS_COMPOSITE,
      0
    ),
    allowedExchanges: normalizeStringArray(row.allowedExchanges, [...FREE_ALLOWED_EXCHANGES]),
    aiCreditBalance: toBigInt(row.aiCreditBalance),
    aiCreditsUsedLifetime: toBigInt(row.aiCreditsUsedLifetime),
    monthlyAiCreditsIncluded: toBigInt(row.monthlyAiCreditsIncluded)
  };
}

async function resolveActiveCapacityGrantDeltas(params: {
  userId: string;
  plan: EffectivePlan;
  now?: Date;
}): Promise<{
  runningBots: number;
  runningPredictionsAi: number;
  runningPredictionsComposite: number;
}> {
  if (!db.subscriptionCapacityGrant) {
    return {
      runningBots: 0,
      runningPredictionsAi: 0,
      runningPredictionsComposite: 0
    };
  }

  const now = params.now ?? new Date();
  const rows = await db.subscriptionCapacityGrant.findMany({
    where: {
      userId: params.userId,
      OR: [
        { validUntil: null },
        { validUntil: { gt: now } }
      ]
    },
    select: {
      planScope: true,
      deltaRunningBots: true,
      deltaRunningPredictionsAi: true,
      deltaRunningPredictionsComposite: true
    }
  });

  const expectedScope = toStoredPlan(params.plan);
  let runningBots = 0;
  let runningPredictionsAi = 0;
  let runningPredictionsComposite = 0;
  for (const row of rows) {
    if (!isCapacityGrantScopeCompatible(expectedScope, row.planScope)) continue;
    runningBots += normalizeCapacityDelta(row.deltaRunningBots);
    runningPredictionsAi += normalizeCapacityDelta(row.deltaRunningPredictionsAi);
    runningPredictionsComposite += normalizeCapacityDelta(row.deltaRunningPredictionsComposite);
  }

  return {
    runningBots,
    runningPredictionsAi,
    runningPredictionsComposite
  };
}

export function isCapacityGrantScopeCompatible(
  currentPlan: StoredEffectivePlan,
  grantScope: StoredEffectivePlan | null | undefined
): boolean {
  if (currentPlan === "FREE") return grantScope === "FREE";
  if (!grantScope) return true;
  return grantScope === "PRO" || grantScope === "PREMIUM";
}

export async function resolveEffectiveQuotaForUser(
  userId: string,
  caps?: EffectiveQuotaCaps | null
): Promise<EffectiveQuota> {
  const resolved = await resolveEffectivePlanForUser(userId);
  const deltas = await resolveActiveCapacityGrantDeltas({
    userId,
    plan: resolved.plan
  });

  const baseAiRunning = resolved.maxRunningPredictionsAi;
  const baseCompositeRunning = resolved.maxRunningPredictionsComposite;

  const computed: EffectiveQuota = {
    bots: {
      maxRunning: Math.max(0, resolved.maxRunningBots + deltas.runningBots)
    },
    predictions: {
      local: {
        maxRunning: null
      },
      ai: {
        maxRunning:
          baseAiRunning === null
            ? null
            : Math.max(0, baseAiRunning + deltas.runningPredictionsAi)
      },
      composite: {
        maxRunning:
          baseCompositeRunning === null
            ? null
            : Math.max(0, baseCompositeRunning + deltas.runningPredictionsComposite)
      }
    }
  };

  return {
    bots: {
      maxRunning: Math.max(0, applyHardCap(computed.bots.maxRunning, caps?.bots?.maxRunning) ?? 0)
    },
    predictions: {
      local: {
        maxRunning: null
      },
      ai: {
        maxRunning: applyHardCap(computed.predictions.ai.maxRunning, caps?.predictions?.ai?.maxRunning)
      },
      composite: {
        maxRunning: applyHardCap(
          computed.predictions.composite.maxRunning,
          caps?.predictions?.composite?.maxRunning
        )
      }
    }
  };
}

export async function resolveQuotaUsageForUser(userId: string): Promise<QuotaUsage> {
  const [botsRunning, predictionStates] = await Promise.all([
    db.bot.count({ where: buildActiveBotCapacityWhere(userId) }),
    db.predictionState.findMany({
      where: { userId },
      select: {
        strategyKind: true,
        signalMode: true,
        featuresSnapshot: true,
        autoScheduleEnabled: true,
        autoSchedulePaused: true
      }
    })
  ]);

  const usage = createEmptyQuotaUsage();
  usage.bots.running = botsRunning;
  for (const row of predictionStates) {
    if (!row.autoScheduleEnabled) continue;
    const kind = resolvePredictionQuotaKindFromStateRow(row);
    if (!row.autoSchedulePaused) {
      usage.predictions[kind].running += 1;
    }
  }
  return usage;
}

function exceedsLimit(limit: number | null, nextUsage: number): boolean {
  if (limit === null) return false;
  return nextUsage > limit;
}

export function predictionScheduleConsumesNewSlot(params: {
  currentlyEnabled: boolean;
  currentlyPaused: boolean;
}): boolean {
  return !params.currentlyEnabled || params.currentlyPaused;
}

export async function canCreateBot(params: {
  userId: string;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);

  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export async function canCreatePrediction(params: {
  userId: string;
  kind: PredictionQuotaKind;
  existingStateId: string | null;
  consumesSlot: boolean;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);
  if (params.kind === "local" || params.existingStateId || !params.consumesSlot) {
    return {
      allowed: true,
      reason: "ok",
      limits,
      usage
    };
  }

  const bucket = params.kind === "ai" ? usage.predictions.ai : usage.predictions.composite;
  const bucketLimits = params.kind === "ai" ? limits.predictions.ai : limits.predictions.composite;
  if (exceedsLimit(bucketLimits.maxRunning, bucket.running + 1)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_running_limit_exceeded_ai"
          : "prediction_running_limit_exceeded_composite",
      limits,
      usage
    };
  }
  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export async function canEnablePredictionSchedule(params: {
  userId: string;
  kind: PredictionQuotaKind;
  currentlyEnabled: boolean;
  currentlyPaused: boolean;
  caps?: EffectiveQuotaCaps | null;
}): Promise<QuotaLimitCheckResult> {
  const [limits, usage] = await Promise.all([
    resolveEffectiveQuotaForUser(params.userId, params.caps),
    resolveQuotaUsageForUser(params.userId)
  ]);
  if (params.kind === "local" || !predictionScheduleConsumesNewSlot(params)) {
    return {
      allowed: true,
      reason: "ok",
      limits,
      usage
    };
  }

  const bucket = params.kind === "ai" ? usage.predictions.ai : usage.predictions.composite;
  const bucketLimits = params.kind === "ai" ? limits.predictions.ai : limits.predictions.composite;

  const nextRunning = bucket.running + 1;
  if (exceedsLimit(bucketLimits.maxRunning, nextRunning)) {
    return {
      allowed: false,
      reason:
        params.kind === "ai"
          ? "prediction_schedule_limit_exceeded_ai"
          : "prediction_schedule_limit_exceeded_composite",
      limits,
      usage
    };
  }

  return {
    allowed: true,
    reason: "ok",
    limits,
    usage
  };
}

export function buildActiveBillingPackageWhere(): Record<string, unknown> {
  return {
    isActive: true,
    priceCents: { gt: 0 },
    NOT: { kind: "PLAN", plan: "FREE" }
  };
}

export async function listActiveBillingPackages(): Promise<any[]> {
  await ensureBillingDefaults();
  return db.billingPackage.findMany({
    where: buildActiveBillingPackageWhere(),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

export async function listBillingPackages(): Promise<any[]> {
  await ensureBillingDefaults();
  return db.billingPackage.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
}

type CheckoutCartItemInput = {
  packageId: string;
  quantity: number;
};

type CheckoutResolvedLine = {
  packageId: string;
  quantity: number;
  kind: BillingPackageKind;
  addonType: BillingAddonType | null;
  unitPriceCents: number;
  lineAmountCents: number;
  currency: string;
  pkg: any;
};

export type ImmediatePremiumUpgradePricing = {
  kind: "IMMEDIATE_PLAN_UPGRADE";
  sourcePlan: "PRO";
  targetPlan: "PREMIUM";
  sourceTermId: string;
  sourceTermEndsAt: string;
  sourceTermGraceEndsAt: string;
  sourcePriceCents: number;
  targetPriceCents: number;
  differenceCents: number;
  billingMonths: number;
};

export function resolveImmediatePremiumUpgradePricing(params: {
  now: Date;
  sourcePlan: unknown;
  targetPlan: unknown;
  sourceTermId: string;
  sourceTermEndsAt: Date;
  sourceTermGraceEndsAt: Date;
  sourcePriceCents: number;
  targetPriceCents: number;
  sourceBillingMonths: number;
  targetBillingMonths: number;
  hasScheduledTerm: boolean;
}): ImmediatePremiumUpgradePricing | null {
  if (params.sourcePlan !== "PRO" || params.targetPlan !== "PREMIUM") return null;
  if (!params.sourceTermId || params.sourceTermEndsAt.getTime() <= params.now.getTime()) {
    throw new Error("premium_upgrade_active_term_required");
  }
  if (params.hasScheduledTerm) throw new Error("premium_upgrade_scheduled_term_conflict");
  if (
    !Number.isSafeInteger(params.sourceBillingMonths)
    || !Number.isSafeInteger(params.targetBillingMonths)
    || params.sourceBillingMonths < 1
    || params.sourceBillingMonths !== params.targetBillingMonths
  ) {
    throw new Error("premium_upgrade_term_mismatch");
  }
  if (
    !Number.isSafeInteger(params.sourcePriceCents)
    || !Number.isSafeInteger(params.targetPriceCents)
    || params.sourcePriceCents < 1
    || params.targetPriceCents <= params.sourcePriceCents
  ) {
    throw new Error("premium_upgrade_price_evidence_invalid");
  }
  return {
    kind: "IMMEDIATE_PLAN_UPGRADE",
    sourcePlan: "PRO",
    targetPlan: "PREMIUM",
    sourceTermId: params.sourceTermId,
    sourceTermEndsAt: params.sourceTermEndsAt.toISOString(),
    sourceTermGraceEndsAt: params.sourceTermGraceEndsAt.toISOString(),
    sourcePriceCents: params.sourcePriceCents,
    targetPriceCents: params.targetPriceCents,
    differenceCents: params.targetPriceCents - params.sourcePriceCents,
    billingMonths: params.targetBillingMonths
  };
}

export function calculateBillingCartAmountCents(
  lines: Array<{ lineAmountCents: number }>
): number {
  let total = 0n;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.lineAmountCents) || line.lineAmountCents < 0) {
      throw new Error("cart_total_out_of_range");
    }
    total += BigInt(line.lineAmountCents);
    if (total > BigInt(BILLING_ORDER_AMOUNT_CENTS_MAX)) {
      throw new Error("cart_total_out_of_range");
    }
  }
  return Number(total);
}

export function requirePayableBillingCartAmountCents(amountCents: number): number {
  if (amountCents <= 0) throw new Error("cart_zero_amount_not_supported");
  return amountCents;
}

export function billingAmountCentsToUsdcRaw(amountCents: number): bigint {
  const validated = calculateBillingCartAmountCents([{ lineAmountCents: amountCents }]);
  return BigInt(validated) * 10_000n;
}

function mapBillingPackageKind(value: unknown): BillingPackageKind {
  return value === "PLAN" ? "plan" : "addon";
}

export function isBillingPackagePurchasable(pkg: {
  kind?: unknown;
  plan?: unknown;
  priceCents?: unknown;
}): boolean {
  return normalizeInt(pkg.priceCents, 0, 0) > 0
    && !(pkg.kind === "PLAN" && pkg.plan === "FREE");
}

function buildPackageSnapshot(pkg: any): Record<string, unknown> {
  const addonType = deriveAddonTypeFromPackage(pkg);
  return {
    id: String(pkg.id ?? ""),
    code: String(pkg.code ?? ""),
    name: String(pkg.name ?? ""),
    description: pkg.description ?? null,
    kind: mapStoragePackageKindToPublicKind(pkg.kind),
    addonType,
    plan: pkg.plan ?? null,
    billingMonths: normalizeInt(pkg.billingMonths, 1, 1),
    maxExchangeAccounts: pkg.maxExchangeAccounts ?? null,
    maxRunningBots: pkg.maxRunningBots ?? null,
    maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? null,
    maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? null,
    allowedExchanges: normalizeStringArray(pkg.allowedExchanges, ["*"]),
    monthlyAiCredits: toBigInt(pkg.monthlyAiCredits).toString(),
    aiCredits: toBigInt(pkg.aiCredits).toString(),
    deltaRunningBots: pkg.deltaRunningBots ?? null,
    deltaRunningPredictionsAi: pkg.deltaRunningPredictionsAi ?? null,
    deltaRunningPredictionsComposite: pkg.deltaRunningPredictionsComposite ?? null,
    priceCents: normalizeInt(pkg.priceCents, 0, 0),
    currency: DEFAULT_BILLING_CURRENCY
  };
}

async function fetchBillingOrderWithItems(orderId: string): Promise<any> {
  return db.billingOrder.findUnique({
    where: { id: orderId },
    include: {
      pkg: true,
      onchainPayment: true,
      subscriptionTerm: true,
      uliqBenefitReservation: true,
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });
}

async function resolveCheckoutLines(params: {
  userId: string;
  items: CheckoutCartItemInput[];
}): Promise<CheckoutResolvedLine[]> {
  if (!Array.isArray(params.items)) throw new Error("invalid_cart_payload");
  if (params.items.length === 0) throw new Error("cart_empty");
  if (params.items.length > 20) throw new Error("invalid_cart_payload");

  const seen = new Set<string>();
  const normalizedRaw = params.items.map((item) => {
    const packageId = typeof item.packageId === "string" ? item.packageId.trim() : "";
    const rawQuantity = Number(item.quantity);
    if (!packageId) throw new Error("invalid_cart_payload");
    if (!Number.isFinite(rawQuantity) || !Number.isInteger(rawQuantity)) {
      throw new Error("cart_quantity_invalid");
    }
    if (rawQuantity <= 0) throw new Error("cart_quantity_invalid");
    if (seen.has(packageId)) throw new Error("cart_duplicate_package");
    seen.add(packageId);
    return {
      packageId,
      quantity: rawQuantity
    };
  });

  const packageIds = normalizedRaw.map((item) => item.packageId);
  const packages = await db.billingPackage.findMany({
    where: {
      id: { in: packageIds },
      isActive: true,
      priceCents: { gt: 0 }
    }
  });
  if (packages.length !== packageIds.length) {
    throw new Error("cart_item_not_found");
  }

  const byId = new Map<string, any>();
  for (const pkg of packages) {
    byId.set(String(pkg.id), pkg);
  }

  const lines: CheckoutResolvedLine[] = normalizedRaw.map((item) => {
    const pkg = byId.get(item.packageId);
    if (!pkg) throw new Error("cart_item_not_found");
    if (!isBillingPackagePurchasable(pkg)) throw new Error("cart_free_plan_not_purchasable");
    const kind = mapBillingPackageKind(pkg.kind);
    const addonType = deriveAddonTypeFromPackage(pkg);
    if (kind === "plan" && item.quantity !== 1) {
      throw new Error("cart_quantity_invalid");
    }
    if (kind === "addon" && (item.quantity < 1 || item.quantity > 20)) {
      throw new Error("cart_quantity_invalid");
    }
    const unitPriceCents = normalizeInt(pkg.priceCents, 0, 0);
    const currency = DEFAULT_BILLING_CURRENCY;
    return {
      packageId: String(pkg.id),
      quantity: item.quantity,
      kind,
      addonType,
      unitPriceCents,
      lineAmountCents: unitPriceCents * item.quantity,
      currency,
      pkg
    };
  });

  const planLines = lines.filter((line) => line.kind === "plan");
  if (planLines.length > 1) throw new Error("cart_plan_count_invalid");
  const hasPaidPlanInCart = planLines.some(
    (line) => line.pkg.plan === "PRO" || line.pkg.plan === "PREMIUM"
  );
  const resolved = await resolveEffectivePlanForUser(params.userId);
  const canUsePaidTopups = resolved.plan !== "free" || hasPaidPlanInCart;

  if (lines.some((line) => line.kind === "addon") && !canUsePaidTopups) {
    throw new Error("cart_capacity_requires_pro");
  }
  const currency = lines[0]?.currency ?? DEFAULT_BILLING_CURRENCY;
  const mixedCurrencies = lines.some((line) => line.currency !== currency);
  if (mixedCurrencies) throw new Error("invalid_cart_payload");

  return lines;
}

function readStoredPlan(value: unknown): StoredEffectivePlan | null {
  if (value === "FREE" || value === "PRO" || value === "PREMIUM") return value;
  if (value === "free") return "FREE";
  if (value === "pro") return "PRO";
  if (value === "premium") return "PREMIUM";
  return null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readTermPlanPriceEvidence(term: any, expectedPlan: StoredEffectivePlan): {
  priceCents: number;
  billingMonths: number;
} | null {
  const termSnapshot = asRecord(term?.entitlementSnapshot);
  const sourceOrderItems = Array.isArray(term?.order?.items) ? term.order.items : [];
  const sourcePlanItem = sourceOrderItems.find((item: any) => {
    const itemSnapshot = asRecord(item.packageSnapshot);
    const itemPlan = readStoredPlan(itemSnapshot.plan ?? item.pkg?.plan);
    const itemKind = item.kindSnapshot ?? itemSnapshot.kind ?? item.pkg?.kind;
    return (itemKind === "PLAN" || itemKind === "plan") && itemPlan === expectedPlan;
  }) ?? null;
  const sourceItemSnapshot = asRecord(sourcePlanItem?.packageSnapshot);
  const sourcePackageCode = String(
    termSnapshot.packageCode ?? sourceItemSnapshot.code ?? sourcePlanItem?.pkg?.code ?? ""
  );
  const canonicalCode = expectedPlan === "PRO" && sourcePackageCode === "pro_monthly"
    ? "pro_monthly"
    : expectedPlan === "PREMIUM" && sourcePackageCode === "premium_monthly"
      ? "premium_monthly"
      : null;
  const canonicalSource = canonicalCode ? canonicalPackageByCode(canonicalCode) : null;
  const priceCents = readPositiveInt(termSnapshot.priceCents)
    ?? readPositiveInt(sourcePlanItem?.unitPriceCents)
    ?? readPositiveInt(sourceItemSnapshot.priceCents)
    ?? canonicalSource?.priceCents
    ?? null;
  const billingMonths = readPositiveInt(termSnapshot.billingMonths)
    ?? readPositiveInt(sourceItemSnapshot.billingMonths)
    ?? readPositiveInt(sourcePlanItem?.pkg?.billingMonths)
    ?? canonicalSource?.billingMonths
    ?? null;
  return priceCents === null || billingMonths === null ? null : { priceCents, billingMonths };
}

async function resolveImmediatePremiumUpgradeForCheckout(params: {
  userId: string;
  lines: CheckoutResolvedLine[];
  now: Date;
}): Promise<ImmediatePremiumUpgradePricing | null> {
  const targetLine = params.lines.find(
    (line) => line.kind === "plan" && readStoredPlan(line.pkg?.plan) === "PREMIUM"
  );
  if (!targetLine) return null;

  const resolved = await resolveEffectivePlanForUser(params.userId);
  if (resolved.plan !== "pro") return null;

  const [sourceTerm, scheduledTerm] = await Promise.all([
    db.subscriptionTerm.findFirst({
      where: {
        userId: params.userId,
        status: "ACTIVE",
        startsAt: { lte: params.now },
        endsAt: { gt: params.now }
      },
      include: {
        order: {
          include: {
            items: {
              include: { pkg: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }]
            }
          }
        }
      },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }]
    }),
    db.subscriptionTerm.findFirst({
      where: { userId: params.userId, status: "SCHEDULED" },
      select: { id: true }
    })
  ]);
  if (!sourceTerm) throw new Error("premium_upgrade_active_term_required");

  const termSnapshot = asRecord(sourceTerm.entitlementSnapshot);
  const sourcePlan = readStoredPlan(sourceTerm.plan ?? termSnapshot.plan);
  if (sourcePlan !== "PRO") throw new Error("premium_upgrade_active_term_required");

  const sourcePriceEvidence = readTermPlanPriceEvidence(sourceTerm, "PRO");
  if (!sourcePriceEvidence) {
    throw new Error("premium_upgrade_price_evidence_invalid");
  }

  const pricing = resolveImmediatePremiumUpgradePricing({
    now: params.now,
    sourcePlan,
    targetPlan: readStoredPlan(targetLine.pkg?.plan),
    sourceTermId: String(sourceTerm.id),
    sourceTermEndsAt: sourceTerm.endsAt,
    sourceTermGraceEndsAt: sourceTerm.graceEndsAt,
    sourcePriceCents: sourcePriceEvidence.priceCents,
    targetPriceCents: targetLine.unitPriceCents,
    sourceBillingMonths: sourcePriceEvidence.billingMonths,
    targetBillingMonths: normalizeInt(targetLine.pkg?.billingMonths, 1, 1),
    hasScheduledTerm: Boolean(scheduledTerm)
  });
  if (!pricing) return null;
  targetLine.unitPriceCents = pricing.differenceCents;
  targetLine.lineAmountCents = pricing.differenceCents * targetLine.quantity;
  return pricing;
}

function fingerprintCheckoutLines(
  lines: CheckoutResolvedLine[],
  applyUliqDiscount = false,
  upgrade: ImmediatePremiumUpgradePricing | null = null
): string {
  const canonical = lines
    .map((line) => `${line.packageId}:${line.quantity}:${line.unitPriceCents}`)
    .sort()
    .concat(upgrade ? `upgrade:${upgrade.sourceTermId}:${upgrade.differenceCents}` : "upgrade:none")
    .concat(`uliq:${applyUliqDiscount ? "requested" : "none"}`)
    .join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function buildOnchainPaymentResponse(order: any): any | null {
  const payment = order?.onchainPayment;
  if (!payment) return null;
  const txHash = payment.txHash ? String(payment.txHash) : null;
  const recipientAddress = String(payment.treasuryAddress ?? "");
  return {
    chainId: Number(payment.chainId),
    tokenAddress: String(payment.tokenAddress),
    tokenDecimals: Number(payment.tokenDecimals),
    recipientAddress,
    treasuryAddress: recipientAddress,
    expectedSenderAddress: String(payment.expectedSenderAddress),
    amountRaw: toBigInt(payment.expectedAmountRaw).toString(),
    amountFormatted: formatArbitrumUsdcAmount(toBigInt(payment.expectedAmountRaw)),
    confirmationsRequired: BILLING_PAYMENT_CONFIRMATIONS,
    confirmations: normalizeInt(payment.confirmations, 0, 0),
    txHash,
    blockNumber: payment.blockNumber == null ? null : toBigInt(payment.blockNumber).toString(),
    blockHash: payment.blockHash ?? null,
    expiresAt: order.expiresAt instanceof Date ? order.expiresAt.toISOString() : null,
    lastError: payment.lastError ?? null,
    verifiedAt: payment.verifiedAt instanceof Date ? payment.verifiedAt.toISOString() : null,
    explorerUrl: getArbitrumTransactionExplorerUrl(txHash)
  };
}

function buildCheckoutResult(order: any): {
  order: any;
  payment: any | null;
  mode: "onchain" | "instant";
} {
  const payment = buildOnchainPaymentResponse(order);
  return {
    order,
    payment,
    mode: payment ? "onchain" : "instant"
  };
}

function buildCheckoutOrderItems(lines: CheckoutResolvedLine[]): any[] {
  return lines.map((line) => ({
    packageId: line.packageId,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    lineAmountCents: line.lineAmountCents,
    currency: line.currency,
    kindSnapshot: line.kind === "plan" ? "PLAN" : "ADDON",
    packageSnapshot: buildPackageSnapshot(line.pkg)
  }));
}

function buildDiscountedCheckoutOrderItems(
  lines: CheckoutResolvedLine[],
  prepared: PreparedUliqBillingBenefit | null,
  eligibleLineIndexes: number[] = []
): any[] {
  const allocations = lines.map((line) => ({
      baseAmountCents: line.lineAmountCents,
      discountAmountCents: 0,
      finalAmountCents: line.lineAmountCents
    }));
  if (prepared && eligibleLineIndexes.length > 0) {
    const eligibleAllocations = allocateUliqDiscountAcrossLines(
      eligibleLineIndexes.map((index) => lines[index].lineAmountCents),
      prepared.discountAmountCents
    );
    eligibleLineIndexes.forEach((lineIndex, allocationIndex) => {
      allocations[lineIndex] = eligibleAllocations[allocationIndex];
    });
  }
  return buildCheckoutOrderItems(lines).map((item, index) => ({
    ...item,
    baseAmountCents: allocations[index].baseAmountCents,
    discountAmountCents: allocations[index].discountAmountCents,
    finalAmountCents: allocations[index].finalAmountCents
  }));
}

async function expireStalePendingBillingOrders(userId: string, now = new Date()): Promise<number> {
  const result = await db.billingOrder.updateMany({
    where: {
      userId,
      provider: "ARBITRUM_USDC",
      status: "PENDING",
      expiresAt: { lte: now },
      onchainPayment: { txHash: null }
    },
    data: {
      status: "EXPIRED",
      paymentStatusRaw: "checkout_expired"
    }
  });
  return result.count;
}

async function findOpenArbitrumOrderForUser(userId: string, now: Date): Promise<any | null> {
  await expireStalePendingBillingOrders(userId, now);
  await expireUliqBenefitsIfEnabled(now);
  return db.billingOrder.findFirst({
    where: {
      userId,
      provider: "ARBITRUM_USDC",
      status: { in: ["PENDING", "CONFIRMING"] }
    },
    include: {
      pkg: true,
      onchainPayment: true,
      subscriptionTerm: true,
      uliqBenefitReservation: true,
      items: {
        include: { pkg: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function createBillingOrderWithTreasurySnapshotCas(params: {
  database: any;
  configuration: { treasuryAddress: string; revision: number };
  rpcCheckedBlock: bigint;
  scanFromBlock: bigint;
  orderData: Record<string, unknown>;
  include: Record<string, unknown>;
  uliqBenefit?: PreparedUliqBillingBenefit | null;
  uliqReservationNow?: Date;
}): Promise<any> {
  return runSerializableBillingConfigTransaction(params.database, async (tx: any) => {
    const {
      expectedSenderAddress,
      expectedAmountRaw,
      ...billingOrderData
    } = params.orderData as Record<string, any>;
    const guarded = await tx.billingPaymentConfiguration.updateMany({
      where: {
        id: BILLING_PAYMENT_CONFIGURATION_ID,
        chainId: ARBITRUM_ONE_CHAIN_ID,
        tokenAddress: ARBITRUM_USDC_ADDRESS.toLowerCase(),
        tokenDecimals: ARBITRUM_USDC_DECIMALS,
        treasuryAddress: params.configuration.treasuryAddress,
        revision: params.configuration.revision
      },
      data: {
        lastRpcBlockNumber: params.rpcCheckedBlock,
        lastRpcCheckAt: new Date(),
        lastRpcError: null
      }
    });
    if (guarded.count !== 1) throw new Error("billing_payment_configuration_changed");
    const reservation = params.uliqBenefit
      ? await createUliqBenefitReservationInTransaction({
        tx,
        prepared: params.uliqBenefit,
        referenceType: "BILLING_ORDER",
        referenceId: String(billingOrderData.merchantOrderId),
        idempotencyKey: `billing:${String(billingOrderData.merchantOrderId)}:${params.uliqBenefit.benefitType}`,
        now: params.uliqReservationNow
      })
      : null;
    return tx.billingOrder.create({
      data: {
        ...billingOrderData,
        uliqBenefitReservationId: reservation?.id ?? null,
        onchainPayment: {
          create: {
            chainId: ARBITRUM_ONE_CHAIN_ID,
            tokenAddress: ARBITRUM_USDC_ADDRESS.toLowerCase(),
            tokenDecimals: ARBITRUM_USDC_DECIMALS,
            expectedSenderAddress,
            treasuryAddress: params.configuration.treasuryAddress,
            treasuryConfigRevision: params.configuration.revision,
            expectedAmountRaw,
            scanFromBlock: params.scanFromBlock
          }
        }
      },
      include: params.include
    });
  });
}

export async function createBillingCheckout(params: {
  userId: string;
  items: CheckoutCartItemInput[];
  applyUliqDiscount?: boolean;
}): Promise<{
  order: any;
  payment: any | null;
  mode: "onchain" | "instant";
}> {
  if (!(await isBillingEnabled())) throw new Error("billing_disabled");

  await ensureBillingDefaults();
  const lines = await resolveCheckoutLines({ userId: params.userId, items: params.items });
  const now = new Date();
  const immediateUpgrade = await resolveImmediatePremiumUpgradeForCheckout({
    userId: params.userId,
    lines,
    now
  });
  const baseAmountCents = requirePayableBillingCartAmountCents(calculateBillingCartAmountCents(lines));
  const planLine = lines.find((line) => line.kind === "plan");
  const anchorPackageId = planLine?.packageId ?? lines[0]?.packageId;
  if (!anchorPackageId) throw new Error("cart_empty");

  const applyUliqDiscount = params.applyUliqDiscount === true;
  const cartFingerprint = fingerprintCheckoutLines(lines, applyUliqDiscount, immediateUpgrade);
  const openOrder = await findOpenArbitrumOrderForUser(params.userId, now);
  if (openOrder) {
    if (openOrder.cartFingerprint !== cartFingerprint) throw new Error("open_order_cart_mismatch");
    return buildCheckoutResult(openOrder);
  }

  const merchantOrderId = `ULIQUID_${crypto.randomUUID()}`;
  const currency = lines[0]?.currency ?? DEFAULT_BILLING_CURRENCY;
  const uliqSelection = applyUliqDiscount ? resolveUliqDiscountSelection(lines) : null;
  const eligibleUliqBaseAmountCents = uliqSelection
    ? uliqSelection.eligibleLineIndexes.reduce((sum, index) => sum + lines[index].lineAmountCents, 0)
    : 0;
  const uliqBenefit = uliqSelection
    ? await prepareUliqBillingBenefit({
      db,
      userId: params.userId,
      baseAmountCents: eligibleUliqBaseAmountCents,
      benefitType: uliqSelection.benefitType,
      now
    })
    : null;
  const amountCents = baseAmountCents - (uliqBenefit?.discountAmountCents ?? 0);
  const createPayload = {
    merchantOrderId,
    checkoutMode: "arbitrum_usdc",
    upgrade: immediateUpgrade,
    uliqBenefit: uliqBenefit ? {
      tier: uliqBenefit.tierSnapshot,
      discountBps: uliqBenefit.discountBps,
      baseAmountCents: uliqBenefit.baseAmountCents,
      discountAmountCents: uliqBenefit.discountAmountCents,
      finalAmountCents: amountCents,
      entitlementSnapshotId: uliqBenefit.entitlementSnapshotId,
      priceSnapshotId: uliqBenefit.priceSnapshotId,
      asOfBlock: uliqBenefit.asOfBlock.toString(),
      configVersion: uliqBenefit.configVersion,
      expiresAt: uliqBenefit.expiresAt.toISOString()
    } : null,
    items: lines.map((line) => ({
      packageId: line.packageId,
      packageCode: String(line.pkg.code ?? ""),
      packageName: String(line.pkg.name ?? ""),
      kind: line.kind,
      addonType: line.addonType,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineAmountCents: line.lineAmountCents
    }))
  };

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { walletAddress: true }
  });
  if (!user?.walletAddress) throw new Error("wallet_not_linked");
  const expectedSenderAddress = normalizeBillingAddress(user.walletAddress, "wallet_not_linked");
  const expectedAmountRaw = billingAmountCentsToUsdcRaw(amountCents);
  const expiresAt = new Date(now.getTime() + BILLING_ORDER_TTL_MS);
  for (let configurationAttempt = 0; configurationAttempt < 3; configurationAttempt += 1) {
    const config = await getArbitrumUsdcPaymentConfiguration();
    if (!config.configured || !config.treasuryAddress || !config.revision || !getBillingArbitrumRpcUrl()) {
      throw new Error("payment_config_not_ready");
    }
    if (config.treasuryAddress === expectedSenderAddress) {
      throw new Error("payment_config_not_ready");
    }
    let rpcCheckedBlock: bigint;
    try {
      rpcCheckedBlock = await requireLiveArbitrumBillingBlock(createBillingOnchainClient());
    } catch (error) {
      if (String((error as any)?.message ?? error) === "payment_config_not_ready") throw error;
      throw new Error("rpc_unavailable");
    }
    // The checked head is already mined before checkout is returned. The first
    // transaction that can belong to this order must therefore be in a later block.
    const scanFromBlock = rpcCheckedBlock + 1n;

    try {
      const created = await createBillingOrderWithTreasurySnapshotCas({
        database: db,
        configuration: {
          treasuryAddress: config.treasuryAddress,
          revision: config.revision
        },
        rpcCheckedBlock,
        scanFromBlock,
        orderData: {
          provider: "ARBITRUM_USDC",
          userId: params.userId,
          packageId: anchorPackageId,
          status: "PENDING",
          amountCents,
          currency,
          merchantOrderId,
          cartFingerprint,
          expiresAt,
          createPayload,
          baseAmountCents,
          discountAmountCents: uliqBenefit?.discountAmountCents ?? 0,
          finalAmountCents: amountCents,
          uliqTierSnapshot: uliqBenefit?.tierSnapshot ?? null,
          uliqDiscountBps: uliqBenefit?.discountBps ?? null,
          uliqEntitlementSnapshotId: uliqBenefit?.entitlementSnapshotId ?? null,
          uliqTierConfigVersion: uliqBenefit?.configVersion ?? null,
          uliqPriceSnapshotId: uliqBenefit?.priceSnapshotId ?? null,
          uliqWalletAddress: uliqBenefit?.walletAddress ?? null,
          uliqAsOfBlock: uliqBenefit?.asOfBlock ?? null,
          items: {
            create: buildDiscountedCheckoutOrderItems(
              lines,
              uliqBenefit,
              uliqSelection?.eligibleLineIndexes ?? []
            )
          },
          expectedSenderAddress,
          expectedAmountRaw
        },
        uliqBenefit,
        uliqReservationNow: now,
        include: {
          pkg: true,
          onchainPayment: true,
          subscriptionTerm: true,
          uliqBenefitReservation: true,
          items: { include: { pkg: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }
        }
      });
      return buildCheckoutResult(created);
    } catch (error) {
      const reason = String((error as any)?.message ?? error);
      if (reason === "billing_payment_configuration_changed") continue;
      if ((error as any)?.code !== "P2002") throw error;
      const racedOrder = await findOpenArbitrumOrderForUser(params.userId, now);
      if (racedOrder?.cartFingerprint === cartFingerprint) return buildCheckoutResult(racedOrder);
      throw new Error("open_order_cart_mismatch");
    }
  }
  throw new Error("payment_config_not_ready");
}

export async function getBillingOrderForUser(userId: string, orderId: string): Promise<{
  order: any;
  payment: any | null;
}> {
  await expireStalePendingBillingOrders(userId);
  const order = await fetchBillingOrderWithItems(orderId);
  if (!order || order.userId !== userId) throw new Error("order_not_found");
  return { order, payment: buildOnchainPaymentResponse(order) };
}

export async function cancelBillingOrder(params: {
  userId: string;
  orderId: string;
}): Promise<{ order: any; payment: any | null }> {
  const order = await fetchBillingOrderWithItems(params.orderId);
  if (!order || order.userId !== params.userId) throw new Error("order_not_found");
  if (
    order.provider !== "ARBITRUM_USDC"
    || order.status !== "PENDING"
    || order.onchainPayment?.txHash
  ) {
    throw new Error("order_not_cancellable");
  }
  await db.$transaction(async (tx: any) => {
    const updated = await tx.billingOrder.updateMany({
      where: {
        id: order.id,
        userId: params.userId,
        provider: "ARBITRUM_USDC",
        status: "PENDING",
        onchainPayment: { txHash: null }
      },
      data: { status: "EXPIRED", paymentStatusRaw: "user_cancelled" }
    });
    if (updated.count !== 1) throw new Error("order_not_cancellable");
    await releaseUliqBenefitReservationInTransaction({
      tx,
      reservationId: order.uliqBenefitReservationId,
      now: new Date(),
      reason: "billing_order_cancelled"
    });
  });
  return getBillingOrderForUser(params.userId, params.orderId);
}

export async function submitBillingTransaction(params: {
  userId: string;
  orderId: string;
  txHash: string;
  client?: BillingOnchainClient;
}): Promise<{ order: any; payment: any | null }> {
  await expireUliqBenefitsIfEnabled();
  const txHash = normalizeBillingTxHash(params.txHash);
  const order = await fetchBillingOrderWithItems(params.orderId);
  if (!order || order.userId !== params.userId) throw new Error("order_not_found");
  if (order.provider !== "ARBITRUM_USDC" || !order.onchainPayment) {
    throw new Error("order_not_payable");
  }
  if (order.status === "PAID") {
    if (String(order.onchainPayment.txHash ?? "").toLowerCase() !== txHash) {
      throw new Error("transaction_hash_mismatch");
    }
    return { order, payment: buildOnchainPaymentResponse(order) };
  }
  if (order.status !== "PENDING" && order.status !== "CONFIRMING") {
    throw new Error("order_not_payable");
  }
  const submittedAt = new Date();
  if (order.status === "PENDING" && order.expiresAt instanceof Date && order.expiresAt <= submittedAt) {
    const expired = await db.billingOrder.updateMany({
      where: {
        id: order.id,
        status: "PENDING",
        onchainPayment: { txHash: null }
      },
      data: { status: "EXPIRED", paymentStatusRaw: "checkout_expired" }
    });
    if (expired.count === 1) throw new Error("order_not_payable");
  }
  const currentHash = String(order.onchainPayment.txHash ?? "").toLowerCase();
  if (currentHash && currentHash !== txHash) throw new Error("transaction_hash_mismatch");

  const hashOwner = await db.billingOnchainPayment.findUnique({
    where: { txHash },
    select: { orderId: true }
  });
  if (hashOwner && hashOwner.orderId !== order.id) throw new Error("transaction_hash_in_use");

  try {
    await db.$transaction(async (tx: any) => {
      const orderClaim = await tx.billingOrder.updateMany({
        where: {
          id: order.id,
          userId: params.userId,
          provider: "ARBITRUM_USDC",
          OR: [
            { status: "CONFIRMING" },
            { status: "PENDING", expiresAt: { gt: submittedAt } }
          ]
        },
        data: {
          status: "CONFIRMING",
          paymentStatusRaw: "transaction_submitted"
        }
      });
      if (orderClaim.count !== 1) throw new Error("billing_submit_cas_conflict");

      const paymentClaim = await tx.billingOnchainPayment.updateMany({
        where: {
          orderId: order.id,
          OR: [{ txHash: null }, { txHash }]
        },
        data: {
          txHash,
          lastError: null,
          nextRetryAt: submittedAt
        }
      });
      if (paymentClaim.count !== 1) throw new Error("billing_submit_hash_conflict");
    });
  } catch (error) {
    if ((error as any)?.code === "P2002") throw new Error("transaction_hash_in_use");
    const reason = String((error as any)?.message ?? error);
    if (reason !== "billing_submit_cas_conflict" && reason !== "billing_submit_hash_conflict") {
      throw error;
    }
    const latest = await fetchBillingOrderWithItems(order.id);
    if (!latest || latest.userId !== params.userId) throw new Error("order_not_found");
    const latestHash = String(latest.onchainPayment?.txHash ?? "").toLowerCase();
    if (latestHash && latestHash !== txHash) throw new Error("transaction_hash_mismatch");
    if (latest.status === "PAID" && latestHash === txHash) {
      return { order: latest, payment: buildOnchainPaymentResponse(latest) };
    }
    if (latest.status !== "CONFIRMING" || latestHash !== txHash) {
      throw new Error("order_not_payable");
    }
  }
  return reconcileBillingOrderPayment({
    userId: params.userId,
    orderId: order.id,
    client: params.client
  });
}

function billingRetryAt(attempts: number, now = new Date()): Date {
  const delay = Math.min(15 * 60_000, BILLING_RETRY_BASE_MS * (2 ** Math.min(5, attempts)));
  return new Date(now.getTime() + delay);
}

export function shouldEscalateMissingBillingTransaction(params: {
  reason: string;
  attempts: number;
  expiresAt: Date | null;
  now: Date;
}): boolean {
  return (
    params.reason === "transaction_or_receipt_not_available"
    && params.attempts >= BILLING_MAX_MISSING_TRANSACTION_ATTEMPTS
    && params.expiresAt instanceof Date
    && params.expiresAt <= params.now
  );
}

export function isWithinLatePaymentRecoveryHorizon(expiresAt: Date | null, now: Date): boolean {
  return Boolean(
    expiresAt
    && expiresAt <= now
    && expiresAt.getTime() >= now.getTime() - BILLING_LATE_PAYMENT_RECOVERY_MS
  );
}

export async function persistBillingVerificationTransition(params: {
  database: any;
  orderId: string;
  txHash: string;
  expectedVerificationAttempts: number;
  orderStatus: "CONFIRMING" | "REVIEW_REQUIRED";
  paymentStatusRaw: string;
  paymentData: Record<string, unknown>;
}): Promise<boolean> {
  try {
    return await params.database.$transaction(async (tx: any) => {
      // Always lock/claim the order first. Submit, cancel, discovery and
      // verification use the same ordering so terminal states stay monotone.
      const orderClaim = await tx.billingOrder.updateMany({
        where: {
          id: params.orderId,
          provider: "ARBITRUM_USDC",
          status: { in: ["PENDING", "CONFIRMING"] }
        },
        data: {
          status: params.orderStatus,
          paymentStatusRaw: params.paymentStatusRaw
        }
      });
      if (orderClaim.count !== 1) return false;

      const paymentClaim = await tx.billingOnchainPayment.updateMany({
        where: {
          orderId: params.orderId,
          txHash: params.txHash,
          verificationAttempts: params.expectedVerificationAttempts,
          verifiedAt: null
        },
        data: params.paymentData
      });
      if (paymentClaim.count !== 1) throw new Error("billing_verification_cas_lost");
      return true;
    });
  } catch (error) {
    if (String((error as any)?.message ?? error) === "billing_verification_cas_lost") return false;
    throw error;
  }
}

async function resolveBillingOrderAfterVerificationCasLoss(
  orderId: string,
  userId?: string
): Promise<{ order: any; payment: any | null }> {
  let latest = await fetchBillingOrderWithItems(orderId);
  if (!latest || (userId && latest.userId !== userId)) throw new Error("order_not_found");
  if (shouldResumeVerifiedBillingPayment(latest)) {
    await finalizeConfirmedBillingOrderWithReviewHandling(
      latest.id,
      latest.merchantOrderId,
      "onchain_confirmed_resume",
      getVerifiedBillingPaymentTimestamp(latest)!
    );
    latest = await fetchBillingOrderWithItems(orderId);
    if (!latest) throw new Error("order_not_found");
  }
  if (latest.status === "REVIEW_REQUIRED") throw new Error("review_required");
  if (!["PENDING", "CONFIRMING", "PAID"].includes(String(latest.status))) {
    throw new Error("order_not_payable");
  }
  return { order: latest, payment: buildOnchainPaymentResponse(latest) };
}

export async function reconcileBillingOrderPayment(params: {
  orderId: string;
  userId?: string;
  client?: BillingOnchainClient;
}): Promise<{ order: any; payment: any | null }> {
  await expireUliqBenefitsIfEnabled();
  const order = await fetchBillingOrderWithItems(params.orderId);
  if (!order || (params.userId && order.userId !== params.userId)) throw new Error("order_not_found");
  if (order.provider !== "ARBITRUM_USDC" || !order.onchainPayment) {
    throw new Error("order_not_payable");
  }
  if (order.status === "PAID") return { order, payment: buildOnchainPaymentResponse(order) };
  if (order.status !== "PENDING" && order.status !== "CONFIRMING") {
    throw new Error(order.status === "REVIEW_REQUIRED" ? "review_required" : "order_not_payable");
  }
  const txHash = order.onchainPayment.txHash ? String(order.onchainPayment.txHash) : "";
  if (!txHash) throw new Error("order_not_payable");

  if (shouldResumeVerifiedBillingPayment(order)) {
    const verifiedAt = getVerifiedBillingPaymentTimestamp(order)!;
    await finalizeConfirmedBillingOrderWithReviewHandling(
      order.id,
      order.merchantOrderId,
      "onchain_confirmed_resume",
      verifiedAt
    );
    const resumed = await fetchBillingOrderWithItems(order.id);
    if (!resumed) throw new Error("order_not_found");
    return { order: resumed, payment: buildOnchainPaymentResponse(resumed) };
  }

  const client = params.client ?? createBillingOnchainClient();
  const result = await verifyArbitrumUsdcTransaction({
    client,
    txHash,
    expectedSenderAddress: String(order.onchainPayment.expectedSenderAddress),
    recipientAddress: String(order.onchainPayment.treasuryAddress),
    expectedAmountRaw: toBigInt(order.onchainPayment.expectedAmountRaw),
    minimumBlockNumber:
      typeof order.onchainPayment.scanFromBlock === "bigint"
        ? order.onchainPayment.scanFromBlock
        : null,
    tokenAddress: String(order.onchainPayment.tokenAddress),
    confirmationsRequired: BILLING_PAYMENT_CONFIRMATIONS
  });
  const checkedAt = new Date();
  const nextAttempts = normalizeInt(order.onchainPayment.verificationAttempts, 0, 0) + 1;

  if (result.kind === "retry") {
    const staleMissingTransaction = shouldEscalateMissingBillingTransaction({
      reason: result.reason,
      attempts: nextAttempts,
      expiresAt: order.expiresAt instanceof Date ? order.expiresAt : null,
      now: checkedAt
    });
    const persisted = await persistBillingVerificationTransition({
      database: db,
      orderId: order.id,
      txHash,
      expectedVerificationAttempts: normalizeInt(order.onchainPayment.verificationAttempts, 0, 0),
      orderStatus: staleMissingTransaction ? "REVIEW_REQUIRED" : "CONFIRMING",
      paymentStatusRaw: staleMissingTransaction ? "stale_missing_transaction" : "rpc_retry",
      paymentData: {
        verificationAttempts: { increment: 1 },
        lastCheckedAt: checkedAt,
        nextRetryAt: staleMissingTransaction ? null : billingRetryAt(nextAttempts, checkedAt),
        lastError: staleMissingTransaction ? "stale_missing_transaction" : result.reason
      }
    });
    if (!persisted) return resolveBillingOrderAfterVerificationCasLoss(order.id, params.userId);
    if (staleMissingTransaction) throw new Error("review_required");
    throw new Error("rpc_unavailable");
  }

  if (result.kind === "review_required") {
    const persisted = await persistBillingVerificationTransition({
      database: db,
      orderId: order.id,
      txHash,
      expectedVerificationAttempts: normalizeInt(order.onchainPayment.verificationAttempts, 0, 0),
      orderStatus: "REVIEW_REQUIRED",
      paymentStatusRaw: result.reason,
      paymentData: {
        verificationAttempts: { increment: 1 },
        lastCheckedAt: checkedAt,
        nextRetryAt: null,
        lastError: result.reason,
        confirmations: result.confirmations,
        blockNumber: result.blockNumber,
        blockHash: result.blockHash
      }
    });
    if (!persisted) return resolveBillingOrderAfterVerificationCasLoss(order.id, params.userId);
    throw new Error("review_required");
  }

  const persisted = await persistBillingVerificationTransition({
    database: db,
    orderId: order.id,
    txHash,
    expectedVerificationAttempts: normalizeInt(order.onchainPayment.verificationAttempts, 0, 0),
    orderStatus: "CONFIRMING",
    paymentStatusRaw: result.kind === "confirmed" ? "onchain_confirmed" : "confirming",
    paymentData: {
      verificationAttempts: { increment: 1 },
      lastCheckedAt: checkedAt,
      nextRetryAt: result.kind === "confirming" ? billingRetryAt(0, checkedAt) : null,
      lastError: null,
      confirmations: result.confirmations,
      blockNumber: result.blockNumber,
      blockHash: result.blockHash,
      ...(result.kind === "confirmed" ? { verifiedAt: checkedAt } : {})
    }
  });
  if (!persisted) return resolveBillingOrderAfterVerificationCasLoss(order.id, params.userId);

  if (result.kind === "confirmed") {
    await finalizeConfirmedBillingOrderWithReviewHandling(
      order.id,
      order.merchantOrderId,
      "onchain_confirmed",
      checkedAt
    );
  }
  const updated = await fetchBillingOrderWithItems(order.id);
  if (!updated) throw new Error("order_not_found");
  return { order: updated, payment: buildOnchainPaymentResponse(updated) };
}

export async function reconcilePendingBillingPayments(params?: {
  limit?: number;
  client?: BillingOnchainClient;
}): Promise<{ checked: number; paid: number; confirming: number; reviewRequired: number; retry: number }> {
  const now = new Date();
  await expireUliqBenefitsIfEnabled(now);
  const rows = await db.billingOnchainPayment.findMany({
    where: {
      txHash: { not: null },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      order: { status: { in: ["PENDING", "CONFIRMING"] } }
    },
    select: { orderId: true, verificationAttempts: true },
    orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(500, params?.limit ?? 100))
  });
  const empty = { checked: 0, paid: 0, confirming: 0, reviewRequired: 0, retry: 0 };
  if (rows.length === 0) return empty;
  const client = params?.client ?? createBillingOnchainClient();
  return reconcileBillingPaymentRows({
    rows,
    reconcile: (row) => reconcileBillingOrderPayment({ orderId: row.orderId, client }),
    onUnexpectedError: async (row, error) => {
      const reason = String((error as any)?.message ?? error).slice(0, 400);
      const attempts = normalizeInt(row.verificationAttempts, 0, 0) + 1;
      await db.billingOnchainPayment.updateMany({
        where: {
          orderId: row.orderId,
          verificationAttempts: normalizeInt(row.verificationAttempts, 0, 0),
          verifiedAt: null,
          order: { status: { in: ["PENDING", "CONFIRMING"] } }
        },
        data: {
          verificationAttempts: { increment: 1 },
          nextRetryAt: billingRetryAt(attempts),
          lastCheckedAt: new Date(),
          lastError: `reconcile_error:${reason}`
        }
      });
      logger.warn("billing_onchain_order_reconcile_failed", { orderId: row.orderId, error: reason });
    }
  });
}

export async function reconcileBillingPaymentRows(params: {
  rows: any[];
  reconcile: (row: any) => Promise<{ order: { status: string } }>;
  onUnexpectedError: (row: any, error: unknown) => Promise<void>;
}): Promise<{ checked: number; paid: number; confirming: number; reviewRequired: number; retry: number }> {
  const summary = { checked: 0, paid: 0, confirming: 0, reviewRequired: 0, retry: 0 };
  for (const row of params.rows) {
    summary.checked += 1;
    try {
      const result = await params.reconcile(row);
      if (result.order.status === "PAID") summary.paid += 1;
      else summary.confirming += 1;
    } catch (error) {
      const reason = String((error as any)?.message ?? error);
      if (reason === "review_required") {
        summary.reviewRequired += 1;
      } else if (reason === "rpc_unavailable") {
        summary.retry += 1;
      } else {
        summary.retry += 1;
        try {
          await params.onUnexpectedError(row, error);
        } catch (trackingError) {
          logger.warn("billing_onchain_order_reconcile_tracking_failed", {
            orderId: row?.orderId ?? null,
            error: String((trackingError as any)?.message ?? trackingError)
          });
        }
      }
    }
  }
  return summary;
}

export function getVerifiedBillingPaymentTimestamp(order: any): Date | null {
  const verifiedAt = order?.onchainPayment?.verifiedAt;
  return verifiedAt instanceof Date && Number.isFinite(verifiedAt.getTime())
    ? verifiedAt
    : null;
}

export function shouldResumeVerifiedBillingPayment(order: any): boolean {
  const blockNumber = order?.onchainPayment?.blockNumber;
  const scanFromBlock = order?.onchainPayment?.scanFromBlock;
  const verifiedAt = getVerifiedBillingPaymentTimestamp(order);
  return Boolean(
    order?.provider === "ARBITRUM_USDC"
    && order?.status === "CONFIRMING"
    && verifiedAt !== null
    && normalizeInt(order?.onchainPayment?.confirmations, 0, 0) >= BILLING_PAYMENT_CONFIRMATIONS
    && typeof blockNumber === "bigint"
    && typeof scanFromBlock === "bigint"
    && blockNumber >= scanFromBlock
  );
}

function safeLowerBillingAddress(value: unknown): string | null {
  try {
    return normalizeBillingAddress(value);
  } catch {
    return null;
  }
}

export function matchBillingDiscoveryTransactionHashes(params: {
  expectedSenderAddress: string;
  recipientAddress: string;
  logs: any[];
}): string[] {
  const expectedSender = normalizeBillingAddress(params.expectedSenderAddress);
  const recipient = normalizeBillingAddress(params.recipientAddress, "invalid_treasury_address");
  const hashes = new Set<string>();
  for (const log of params.logs) {
    const from = safeLowerBillingAddress(log?.args?.from);
    const to = safeLowerBillingAddress(log?.args?.to);
    const hash = String(log?.transactionHash ?? "").toLowerCase();
    if (from === expectedSender && to === recipient && /^0x[0-9a-f]{64}$/.test(hash)) {
      hashes.add(hash);
    }
  }
  return [...hashes];
}

export function assignBillingDiscoveryTransactionHashes(params: {
  payments: Array<{
    id: string;
    expectedSenderAddress: string;
    treasuryAddress: string;
    scanFromBlock: bigint | null;
    createdAt?: Date | string | null;
  }>;
  logs: any[];
}): { hashesByPaymentId: Record<string, string[]>; ambiguousPaymentIds: string[] } {
  const candidatesByRoute = new Map<string, Array<{
    id: string;
    scanFromBlock: bigint;
    createdAtMs: number;
  }>>();
  const hashesByPaymentId: Record<string, string[]> = {};

  for (const payment of params.payments) {
    const id = String(payment.id ?? "");
    const sender = safeLowerBillingAddress(payment.expectedSenderAddress);
    const recipient = safeLowerBillingAddress(payment.treasuryAddress);
    if (!id || !sender || !recipient || typeof payment.scanFromBlock !== "bigint" || payment.scanFromBlock < 0n) {
      continue;
    }
    hashesByPaymentId[id] = [];
    const route = `${sender}:${recipient}`;
    const createdAtMs = new Date(payment.createdAt ?? 0).getTime();
    candidatesByRoute.set(route, [
      ...(candidatesByRoute.get(route) ?? []),
      {
        id,
        scanFromBlock: payment.scanFromBlock,
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0
      }
    ]);
  }

  for (const candidates of candidatesByRoute.values()) {
    candidates.sort((left, right) => {
      if (left.scanFromBlock !== right.scanFromBlock) {
        return left.scanFromBlock < right.scanFromBlock ? -1 : 1;
      }
      if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
      return left.id.localeCompare(right.id);
    });
  }

  const ownersByHash = new Map<string, Set<string>>();
  for (const log of params.logs) {
    const sender = safeLowerBillingAddress(log?.args?.from);
    const recipient = safeLowerBillingAddress(log?.args?.to);
    const hash = String(log?.transactionHash ?? "").toLowerCase();
    const blockNumber = typeof log?.blockNumber === "bigint" ? log.blockNumber : null;
    if (!sender || !recipient || blockNumber === null || !/^0x[0-9a-f]{64}$/.test(hash)) continue;

    const candidates = candidatesByRoute.get(`${sender}:${recipient}`) ?? [];
    let owner: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (candidate.scanFromBlock > blockNumber) break;
      owner = candidate;
    }
    if (!owner) continue;
    const owners = ownersByHash.get(hash) ?? new Set<string>();
    owners.add(owner.id);
    ownersByHash.set(hash, owners);
  }

  const ambiguousPaymentIds = new Set<string>();
  for (const [hash, owners] of ownersByHash.entries()) {
    if (owners.size !== 1) {
      for (const owner of owners) ambiguousPaymentIds.add(owner);
      continue;
    }
    const [owner] = owners;
    const current = hashesByPaymentId[owner!] ?? [];
    if (!current.includes(hash)) current.push(hash);
    hashesByPaymentId[owner!] = current;
  }

  return {
    hashesByPaymentId,
    ambiguousPaymentIds: [...ambiguousPaymentIds]
  };
}

export function getBillingDiscoveryScanRange(params: {
  latestBlock: bigint;
  hintedStart: bigint;
  cursorLastScannedBlock?: bigint | null;
}): { safeHead: bigint; fromBlock: bigint; toBlock: bigint } | null {
  const confirmationLag = BigInt(Math.max(0, BILLING_PAYMENT_CONFIRMATIONS - 1));
  const safeHead = params.latestBlock > confirmationLag
    ? params.latestBlock - confirmationLag
    : 0n;
  if (params.hintedStart > safeHead) return null;
  if (
    params.cursorLastScannedBlock !== null
    && params.cursorLastScannedBlock !== undefined
    && params.cursorLastScannedBlock >= safeHead
  ) {
    return null;
  }
  const cursorStart = params.cursorLastScannedBlock === null || params.cursorLastScannedBlock === undefined
    ? params.hintedStart
    : params.cursorLastScannedBlock + 1n > BILLING_DISCOVERY_REORG_OVERLAP_BLOCKS
      ? params.cursorLastScannedBlock + 1n - BILLING_DISCOVERY_REORG_OVERLAP_BLOCKS
      : 0n;
  const fromBlock = cursorStart > params.hintedStart ? cursorStart : params.hintedStart;
  const chunkEnd = fromBlock + BILLING_DISCOVERY_SCAN_CHUNK_BLOCKS - 1n;
  return {
    safeHead,
    fromBlock,
    toBlock: chunkEnd < safeHead ? chunkEnd : safeHead
  };
}

export function billingDiscoveryRetryAt(failureCount: number, now = new Date()): Date {
  const exponent = Math.max(0, Math.min(10, Math.trunc(failureCount) - 1));
  const delay = Math.min(BILLING_DISCOVERY_RETRY_MAX_MS, BILLING_RETRY_BASE_MS * (2 ** exponent));
  return new Date(now.getTime() + delay);
}

export async function persistBillingDiscoveryTransition(params: {
  database: any;
  paymentId: string;
  orderId: string;
  expectedOrderStatus: "PENDING" | "EXPIRED";
  orderStatus: "CONFIRMING" | "REVIEW_REQUIRED";
  paymentStatusRaw: string;
  paymentData: Record<string, unknown>;
}): Promise<boolean> {
  try {
    return await params.database.$transaction(async (tx: any) => {
      const orderClaim = await tx.billingOrder.updateMany({
        where: {
          id: params.orderId,
          provider: "ARBITRUM_USDC",
          status: params.expectedOrderStatus
        },
        data: {
          status: params.orderStatus,
          paymentStatusRaw: params.paymentStatusRaw
        }
      });
      if (orderClaim.count !== 1) return false;

      const paymentClaim = await tx.billingOnchainPayment.updateMany({
        where: { id: params.paymentId, txHash: null },
        data: params.paymentData
      });
      if (paymentClaim.count !== 1) throw new Error("billing_discovery_cas_lost");
      return true;
    });
  } catch (error) {
    if (String((error as any)?.message ?? error) === "billing_discovery_cas_lost") return false;
    throw error;
  }
}

export async function persistBillingDiscoveryCandidate(params: {
  database: any;
  paymentId: string;
  orderId: string;
  expectedOrderStatus: "PENDING" | "EXPIRED";
  expectedExpiresAt?: Date | null;
  now: Date;
  candidate:
    | { kind: "hash"; txHash: string }
    | { kind: "review"; reason: string };
}): Promise<{ applied: boolean; outcome: "discovered" | "review_required" | null }> {
  let snapshot: { orderStatus: "PENDING" | "EXPIRED"; expiresAt: Date | null } = {
    orderStatus: params.expectedOrderStatus,
    expiresAt: params.expectedExpiresAt instanceof Date ? params.expectedExpiresAt : null
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const isLate = snapshot.orderStatus === "EXPIRED"
      || (snapshot.expiresAt instanceof Date && snapshot.expiresAt <= params.now);
    const transition = params.candidate.kind === "review"
      ? {
          orderStatus: "REVIEW_REQUIRED" as const,
          paymentStatusRaw: params.candidate.reason,
          paymentData: {
            lastError: params.candidate.reason,
            lastCheckedAt: params.now
          },
          outcome: "review_required" as const
        }
      : {
          orderStatus: isLate ? "REVIEW_REQUIRED" as const : "CONFIRMING" as const,
          paymentStatusRaw: isLate ? "late_payment_discovered" : "transaction_discovered",
          paymentData: {
            txHash: params.candidate.txHash,
            discoveredAt: params.now,
            nextRetryAt: isLate ? null : params.now,
            lastError: isLate ? "late_payment_discovered" : null
          },
          outcome: isLate ? "review_required" as const : "discovered" as const
        };
    const applied = await persistBillingDiscoveryTransition({
      database: params.database,
      paymentId: params.paymentId,
      orderId: params.orderId,
      expectedOrderStatus: snapshot.orderStatus,
      orderStatus: transition.orderStatus,
      paymentStatusRaw: transition.paymentStatusRaw,
      paymentData: transition.paymentData
    });
    if (applied) return { applied: true, outcome: transition.outcome };

    const current = await params.database.billingOnchainPayment.findUnique({
      where: { id: params.paymentId },
      select: {
        orderId: true,
        txHash: true,
        order: { select: { id: true, status: true, expiresAt: true } }
      }
    });
    if (
      current
      && String(current.orderId) === params.orderId
      && current.txHash !== null
    ) {
      return { applied: false, outcome: null };
    }
    if (
      !current
      || String(current.orderId) !== params.orderId
      || (current.order?.status !== "PENDING" && current.order?.status !== "EXPIRED")
      || current.txHash !== null
    ) {
      throw new Error("billing_discovery_scope_unresolved");
    }
    snapshot = {
      orderStatus: current.order.status,
      expiresAt: current.order.expiresAt instanceof Date ? current.order.expiresAt : null
    };
  }
  throw new Error("billing_discovery_scope_unresolved");
}

export async function captureBillingDiscoveryScopeAfterHead<T>(params: {
  getLatestBlock: () => Promise<bigint>;
  loadScopedPayments: () => Promise<T[]>;
}): Promise<{ latestBlock: bigint; scopedPayments: T[] }> {
  const latestBlock = await params.getLatestBlock();
  const scopedPayments = await params.loadScopedPayments();
  return { latestBlock, scopedPayments };
}

export async function assertBillingDiscoveryScopeStableBeforeCursor(params: {
  database: any;
  scope: { chainId: number; tokenAddress: string; treasuryAddress: string };
  recoveryCutoff: Date;
  rangeToBlock: bigint;
  snapshotPaymentIds: string[];
}): Promise<void> {
  const snapshotIds = new Set(params.snapshotPaymentIds);
  const current = await params.database.billingOnchainPayment.findMany({
    where: {
      txHash: null,
      chainId: params.scope.chainId,
      tokenAddress: params.scope.tokenAddress,
      treasuryAddress: params.scope.treasuryAddress,
      scanFromBlock: { lte: params.rangeToBlock },
      order: {
        status: { in: ["PENDING", "EXPIRED"] },
        expiresAt: { gte: params.recoveryCutoff }
      }
    },
    select: { id: true }
  });
  const unseenIds = current
    .map((payment: any) => String(payment.id ?? ""))
    .filter((id: string) => id && !snapshotIds.has(id));
  if (unseenIds.length > 0) throw new Error("billing_discovery_scope_changed");
}

export async function discoverMissingBillingTransactions(params?: {
  limit?: number;
  client?: BillingOnchainClient;
}): Promise<{ scannedScopes: number; discovered: number; reviewRequired: number }> {
  const now = new Date();
  await expireUliqBenefitsIfEnabled(now);
  const recoveryCutoff = new Date(now.getTime() - BILLING_LATE_PAYMENT_RECOVERY_MS);
  const eligibleOrderWhere = {
    status: { in: ["PENDING", "EXPIRED"] },
    expiresAt: { gte: recoveryCutoff }
  };
  // Limit seed scopes, not individual payments. A scope cursor may only advance
  // after every eligible payment in that scope participated in assignment.
  const paymentSeeds = await db.billingOnchainPayment.findMany({
    where: {
      txHash: null,
      order: eligibleOrderWhere
    },
    include: { order: { select: { id: true, status: true, expiresAt: true } } },
    orderBy: [
      { lastCheckedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" }
    ],
    take: Math.max(1, Math.min(500, params?.limit ?? 100))
  });
  const summary = { scannedScopes: 0, discovered: 0, reviewRequired: 0 };
  if (paymentSeeds.length === 0) return summary;
  const groups = new Map<string, any>();
  for (const payment of paymentSeeds) {
    const key = `${payment.chainId}:${String(payment.tokenAddress).toLowerCase()}:${String(payment.treasuryAddress).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, payment);
  }
  const client = params?.client ?? createBillingOnchainClient();
  const markPaymentsChecked = async (payments: any[]) => {
    const ids = payments.map((payment) => String(payment.id)).filter(Boolean);
    for (let offset = 0; offset < ids.length; offset += 500) {
      await db.billingOnchainPayment.updateMany({
        where: { id: { in: ids.slice(offset, offset + 500) } },
        data: { lastCheckedAt: now }
      });
    }
  };

  for (const sample of groups.values()) {
    const scope = {
      chainId: Number(sample.chainId),
      tokenAddress: String(sample.tokenAddress),
      treasuryAddress: String(sample.treasuryAddress)
    };
    const loadScopedPayments = () => db.billingOnchainPayment.findMany({
      where: {
        txHash: null,
        chainId: scope.chainId,
        tokenAddress: scope.tokenAddress,
        treasuryAddress: scope.treasuryAddress,
        order: eligibleOrderWhere
      },
      include: { order: { select: { id: true, status: true, expiresAt: true } } },
      orderBy: [{ scanFromBlock: "asc" }, { createdAt: "asc" }]
    });
    let scopedPayments: any[] = [];
    if (scope.chainId !== ARBITRUM_ONE_CHAIN_ID) {
      scopedPayments = await loadScopedPayments();
      await markPaymentsChecked(scopedPayments);
      continue;
    }
    const cursor = await db.billingOnchainScanCursor.findUnique({
      where: {
        chainId_tokenAddress_treasuryAddress: scope
      }
    });
    if (cursor?.nextRetryAt instanceof Date && cursor.nextRetryAt > now) {
      scopedPayments = await loadScopedPayments();
      await markPaymentsChecked(scopedPayments);
      continue;
    }
    let hintedStart = 0n;
    try {
      const captured = await captureBillingDiscoveryScopeAfterHead({
        getLatestBlock: () => client.getBlockNumber(),
        loadScopedPayments
      });
      const latestBlock = captured.latestBlock;
      scopedPayments = captured.scopedPayments;
      if (scopedPayments.length === 0) continue;
      const scanHints = scopedPayments
        .map((payment) => payment.scanFromBlock)
        .filter((value): value is bigint => typeof value === "bigint");
      if (scanHints.length === 0) {
        hintedStart = latestBlock > BILLING_DISCOVERY_LOOKBACK_BLOCKS
          ? latestBlock - BILLING_DISCOVERY_LOOKBACK_BLOCKS
          : 0n;
      } else {
        hintedStart = scanHints.reduce((min, value) => value < min ? value : min);
      }
      const range = getBillingDiscoveryScanRange({
        latestBlock,
        hintedStart,
        cursorLastScannedBlock: cursor ? toBigInt(cursor.lastScannedBlock) : null
      });
      if (!range) {
        await markPaymentsChecked(scopedPayments);
        if (cursor && (cursor.failureCount > 0 || cursor.lastError || cursor.nextRetryAt)) {
          await db.billingOnchainScanCursor.update({
            where: { id: cursor.id },
            data: {
              failureCount: 0,
              nextRetryAt: null,
              lastError: null,
              lastSuccessfulAt: now
            }
          });
        }
        continue;
      }
      const logs = await client.getLogs({
        address: scope.tokenAddress,
        event: ERC20_TRANSFER_EVENT,
        args: { to: scope.treasuryAddress },
        fromBlock: range.fromBlock,
        toBlock: range.toBlock
      });
      summary.scannedScopes += 1;
      const assignments = assignBillingDiscoveryTransactionHashes({
        payments: scopedPayments.map((payment) => ({
          id: String(payment.id),
          expectedSenderAddress: String(payment.expectedSenderAddress),
          treasuryAddress: String(payment.treasuryAddress),
          scanFromBlock: typeof payment.scanFromBlock === "bigint" ? payment.scanFromBlock : null,
          createdAt: payment.createdAt
        })),
        logs
      });
      const ambiguousPaymentIds = new Set(assignments.ambiguousPaymentIds);

      for (const payment of scopedPayments) {
        const expectedOrderStatus = payment.order?.status === "EXPIRED" ? "EXPIRED" : "PENDING";
        const missingScanFromBlock = typeof payment.scanFromBlock !== "bigint";
        const ambiguousAssignment = ambiguousPaymentIds.has(String(payment.id));
        const hashes = assignments.hashesByPaymentId[String(payment.id)] ?? [];
        if (missingScanFromBlock || ambiguousAssignment || hashes.length > 1) {
          const reason = missingScanFromBlock
            ? "missing_scan_from_block"
            : ambiguousAssignment
              ? "ambiguous_candidate_assignment"
              : "multiple_candidate_transactions";
          const persisted = await persistBillingDiscoveryCandidate({
            database: db,
            paymentId: String(payment.id),
            orderId: String(payment.orderId),
            expectedOrderStatus,
            expectedExpiresAt: payment.order?.expiresAt ?? null,
            now,
            candidate: { kind: "review", reason }
          });
          if (persisted.outcome === "review_required") summary.reviewRequired += 1;
        } else if (hashes.length === 1) {
          const [txHash] = hashes;
          try {
            const persisted = await persistBillingDiscoveryCandidate({
              database: db,
              paymentId: String(payment.id),
              orderId: String(payment.orderId),
              expectedOrderStatus,
              expectedExpiresAt: payment.order?.expiresAt ?? null,
              now,
              candidate: { kind: "hash", txHash }
            });
            if (persisted.outcome === "review_required") summary.reviewRequired += 1;
            if (persisted.outcome === "discovered") summary.discovered += 1;
          } catch (error) {
            if ((error as any)?.code !== "P2002") throw error;
            const persisted = await persistBillingDiscoveryCandidate({
              database: db,
              paymentId: String(payment.id),
              orderId: String(payment.orderId),
              expectedOrderStatus,
              expectedExpiresAt: payment.order?.expiresAt ?? null,
              now,
              candidate: { kind: "review", reason: "transaction_hash_in_use" }
            });
            if (persisted.outcome === "review_required") summary.reviewRequired += 1;
          }
        }
      }

      await assertBillingDiscoveryScopeStableBeforeCursor({
        database: db,
        scope,
        recoveryCutoff,
        rangeToBlock: range.toBlock,
        snapshotPaymentIds: scopedPayments.map((payment) => String(payment.id))
      });
      await markPaymentsChecked(scopedPayments);

      await db.billingOnchainScanCursor.upsert({
        where: { chainId_tokenAddress_treasuryAddress: scope },
        create: {
          ...scope,
          lastScannedBlock: range.toBlock,
          lastSuccessfulAt: now,
          failureCount: 0
        },
        update: {
          lastScannedBlock: range.toBlock,
          lastSuccessfulAt: now,
          failureCount: 0,
          nextRetryAt: null,
          lastError: null
        }
      });
    } catch (error) {
      try {
        await markPaymentsChecked(scopedPayments);
      } catch (trackingError) {
        logger.warn("billing_onchain_discovery_payment_tracking_failed", {
          scope,
          error: String((trackingError as any)?.message ?? trackingError)
        });
      }
      const failureCount = normalizeInt(cursor?.failureCount, 0, 0) + 1;
      const lastError = String((error as any)?.message ?? error).slice(0, 500);
      const initialLastScannedBlock = hintedStart > 0n ? hintedStart - 1n : -1n;
      try {
        await db.billingOnchainScanCursor.upsert({
          where: { chainId_tokenAddress_treasuryAddress: scope },
          create: {
            ...scope,
            lastScannedBlock: initialLastScannedBlock,
            failureCount,
            nextRetryAt: billingDiscoveryRetryAt(failureCount, now),
            lastError
          },
          update: {
            failureCount: { increment: 1 },
            nextRetryAt: billingDiscoveryRetryAt(failureCount, now),
            lastError
          }
        });
      } catch (cursorError) {
        logger.warn("billing_onchain_discovery_cursor_update_failed", {
          scope,
          error: String((cursorError as any)?.message ?? cursorError)
        });
      }
      logger.warn("billing_onchain_discovery_scope_failed", { scope, failureCount, error: lastError });
    }
  }
  return summary;
}

type ApplyPackageData = {
  id: string;
  code: string;
  name: string;
  kind: "PLAN" | "ADDON";
  publicKind: BillingPackageKind;
  addonType: BillingAddonType | null;
  plan: StoredEffectivePlan | null;
  billingMonths: number;
  priceCents: number;
  maxExchangeAccounts: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: bigint;
  aiCredits: bigint;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
};

type ApplyOrderLine = {
  quantity: number;
  pkg: ApplyPackageData;
};

function normalizeApplyPackageData(params: {
  snapshot: Record<string, unknown>;
  pkg: any;
  kindFallback: BillingPackageKind;
}): ApplyPackageData {
  const read = (key: string): unknown =>
    params.snapshot[key] !== undefined ? params.snapshot[key] : params.pkg?.[key];
  const fallbackKind = params.kindFallback === "addon" ? "ADDON" : "PLAN";
  const rawKind = read("kind");
  const kind = rawKind === "ADDON" || rawKind === "PLAN"
    ? rawKind
    : fallbackKind;
  const rawAddonType = normalizeBillingAddonType(read("addonType"));
  const addonType = rawAddonType ?? deriveAddonTypeFromPackage(params.pkg ?? { ...params.snapshot, kind });

  const rawPlan = read("plan");
  const plan = rawPlan === "FREE" || rawPlan === "PRO" || rawPlan === "PREMIUM"
    ? rawPlan
    : null;

  return {
    id: String(read("id") ?? params.pkg?.id ?? ""),
    code: String(read("code") ?? params.pkg?.code ?? ""),
    name: String(read("name") ?? params.pkg?.name ?? ""),
    kind,
    publicKind: kind === "PLAN" ? "plan" : "addon",
    addonType,
    plan,
    billingMonths: normalizeInt(read("billingMonths"), normalizeInt(params.pkg?.billingMonths, 1, 1), 1),
    priceCents: normalizeInt(read("priceCents"), normalizeInt(params.pkg?.priceCents, 0, 0), 0),
    maxExchangeAccounts: normalizeNullableInt(
      read("maxExchangeAccounts"),
      params.pkg?.maxExchangeAccounts ?? null,
      0
    ),
    maxRunningBots: normalizeNullableInt(read("maxRunningBots"), params.pkg?.maxRunningBots ?? null, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      read("maxRunningPredictionsAi"),
      params.pkg?.maxRunningPredictionsAi ?? null,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      read("maxRunningPredictionsComposite"),
      params.pkg?.maxRunningPredictionsComposite ?? null,
      0
    ),
    allowedExchanges: normalizeStringArray(read("allowedExchanges"), ["*"]),
    monthlyAiCredits: toBigInt(read("monthlyAiCredits")),
    aiCredits: toBigInt(read("aiCredits")),
    deltaRunningBots: normalizeNullableInt(
      read("deltaRunningBots"),
      params.pkg?.deltaRunningBots ?? null,
      0
    ),
    deltaRunningPredictionsAi: normalizeNullableInt(
      read("deltaRunningPredictionsAi"),
      params.pkg?.deltaRunningPredictionsAi ?? null,
      0
    ),
    deltaRunningPredictionsComposite: normalizeNullableInt(
      read("deltaRunningPredictionsComposite"),
      params.pkg?.deltaRunningPredictionsComposite ?? null,
      0
    )
  };
}

function buildApplyOrderLines(order: any): ApplyOrderLine[] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map((item: any) => {
      const quantity = normalizeInt(item.quantity, 1, 1);
      const kindFallback = mapBillingPackageKind(item.kindSnapshot ?? item.pkg?.kind);
      const snapshot = asRecord(item.packageSnapshot);
      return {
        quantity,
        pkg: normalizeApplyPackageData({
          snapshot,
          pkg: item.pkg ?? null,
          kindFallback
        })
      };
    });
  }

  return [
    {
      quantity: 1,
      pkg: normalizeApplyPackageData({
        snapshot: {},
        pkg: order.pkg ?? null,
        kindFallback: mapBillingPackageKind(order.pkg?.kind)
      })
    }
  ];
}

function buildTermEntitlementSnapshot(lines: ApplyOrderLine[], plan: ApplyPackageData): Record<string, unknown> {
  return {
    plan: plan.plan ?? "PRO",
    packageId: plan.id,
    packageCode: plan.code,
    billingMonths: plan.billingMonths,
    priceCents: plan.priceCents,
    maxExchangeAccounts: plan.maxExchangeAccounts,
    maxRunningBots: plan.maxRunningBots,
    maxRunningPredictionsAi: plan.maxRunningPredictionsAi,
    maxRunningPredictionsComposite: plan.maxRunningPredictionsComposite,
    allowedExchanges: plan.allowedExchanges,
    monthlyAiCredits: plan.monthlyAiCredits.toString(),
    lines: lines.map((line) => ({
      quantity: line.quantity,
      package: {
        id: line.pkg.id,
        code: line.pkg.code,
        name: line.pkg.name,
        kind: line.pkg.publicKind,
        addonType: line.pkg.addonType,
        plan: line.pkg.plan,
        billingMonths: line.pkg.billingMonths,
        priceCents: line.pkg.priceCents,
        maxExchangeAccounts: line.pkg.maxExchangeAccounts,
        maxRunningBots: line.pkg.maxRunningBots,
        maxRunningPredictionsAi: line.pkg.maxRunningPredictionsAi,
        maxRunningPredictionsComposite: line.pkg.maxRunningPredictionsComposite,
        allowedExchanges: line.pkg.allowedExchanges,
        monthlyAiCredits: line.pkg.monthlyAiCredits.toString(),
        aiCredits: line.pkg.aiCredits.toString(),
        deltaRunningBots: line.pkg.deltaRunningBots,
        deltaRunningPredictionsAi: line.pkg.deltaRunningPredictionsAi,
        deltaRunningPredictionsComposite: line.pkg.deltaRunningPredictionsComposite
      }
    }))
  };
}

function readTermSnapshot(term: any): {
  plan: StoredEffectivePlan;
  maxExchangeAccounts: number | null;
  maxRunningBots: number;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: bigint;
  lines: ApplyOrderLine[];
} {
  const snapshot = asRecord(term?.entitlementSnapshot);
  const rawPlan = term?.plan ?? snapshot.plan;
  const plan = rawPlan === "FREE" || rawPlan === "PRO" || rawPlan === "PREMIUM"
    ? rawPlan
    : null;
  if (!plan) throw new Error("subscription_term_plan_invalid");
  const rawLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const planDefaults = resolvePlanBaseQuotaDefaults(formatPlan(plan));
  const lines: ApplyOrderLine[] = rawLines.map((rawLine: unknown) => {
    const line = asRecord(rawLine);
    const pkg = asRecord(line.package);
    return {
      quantity: normalizeInt(line.quantity, 1, 1),
      pkg: normalizeApplyPackageData({
        snapshot: pkg,
        pkg: null,
        kindFallback: pkg.kind === "addon" || pkg.kind === "ADDON" ? "addon" : "plan"
      })
    };
  });
  return {
    plan,
    maxExchangeAccounts: normalizeNullableInt(snapshot.maxExchangeAccounts, null, 0),
    maxRunningBots: normalizeInt(snapshot.maxRunningBots, planDefaults.maxRunningBots, 0),
    maxRunningPredictionsAi: normalizeNullableInt(
      snapshot.maxRunningPredictionsAi,
      planDefaults.maxRunningPredictionsAi,
      0
    ),
    maxRunningPredictionsComposite: normalizeNullableInt(
      snapshot.maxRunningPredictionsComposite,
      planDefaults.maxRunningPredictionsComposite,
      0
    ),
    allowedExchanges: normalizeStringArray(snapshot.allowedExchanges, ["*"]),
    monthlyAiCredits: toBigInt(snapshot.monthlyAiCredits ?? term?.monthlyAiCredits),
    lines
  };
}

function readImmediatePremiumUpgradeMetadata(value: unknown): ImmediatePremiumUpgradePricing | null {
  const payload = asRecord(value);
  const raw = asRecord(payload.upgrade);
  if (raw.kind !== "IMMEDIATE_PLAN_UPGRADE") return null;
  const sourceTermId = typeof raw.sourceTermId === "string" ? raw.sourceTermId : "";
  const sourceTermEndsAt = typeof raw.sourceTermEndsAt === "string" ? raw.sourceTermEndsAt : "";
  const sourceTermGraceEndsAt = typeof raw.sourceTermGraceEndsAt === "string"
    ? raw.sourceTermGraceEndsAt
    : "";
  const sourcePriceCents = readPositiveInt(raw.sourcePriceCents);
  const targetPriceCents = readPositiveInt(raw.targetPriceCents);
  const differenceCents = readPositiveInt(raw.differenceCents);
  const billingMonths = readPositiveInt(raw.billingMonths);
  if (
    raw.sourcePlan !== "PRO"
    || raw.targetPlan !== "PREMIUM"
    || !sourceTermId
    || !sourceTermEndsAt
    || !sourceTermGraceEndsAt
    || Number.isNaN(Date.parse(sourceTermEndsAt))
    || Number.isNaN(Date.parse(sourceTermGraceEndsAt))
    || sourcePriceCents === null
    || targetPriceCents === null
    || differenceCents === null
    || billingMonths === null
    || targetPriceCents - sourcePriceCents !== differenceCents
  ) {
    throw new Error("confirmed_order_upgrade_metadata_invalid");
  }
  return {
    kind: "IMMEDIATE_PLAN_UPGRADE",
    sourcePlan: "PRO",
    targetPlan: "PREMIUM",
    sourceTermId,
    sourceTermEndsAt,
    sourceTermGraceEndsAt,
    sourcePriceCents,
    targetPriceCents,
    differenceCents,
    billingMonths
  };
}

function buildImmediatePremiumUpgradeSnapshot(params: {
  sourceTerm: any;
  orderLines: ApplyOrderLine[];
  targetPlanLine: ApplyOrderLine;
  upgrade: ImmediatePremiumUpgradePricing;
  paidAt: Date;
}): Record<string, unknown> {
  const sourceSnapshot = asRecord(params.sourceTerm.entitlementSnapshot);
  const previousAddonLines = readTermSnapshot(params.sourceTerm).lines.filter(
    (line) => line.pkg.publicKind === "addon"
  );
  const newAddonLines = params.orderLines.filter((line) => line.pkg.publicKind === "addon");
  const priorHistory = Array.isArray(sourceSnapshot.upgradeHistory)
    ? sourceSnapshot.upgradeHistory.slice(-19)
    : [];
  return {
    ...sourceSnapshot,
    ...buildTermEntitlementSnapshot(
      [params.targetPlanLine, ...previousAddonLines, ...newAddonLines],
      params.targetPlanLine.pkg
    ),
    schemaVersion: "billing-entitlement/v3",
    upgradeHistory: [
      ...priorHistory,
      {
        kind: params.upgrade.kind,
        sourcePlan: params.upgrade.sourcePlan,
        targetPlan: params.upgrade.targetPlan,
        sourceTermId: params.upgrade.sourceTermId,
        sourcePriceCents: params.upgrade.sourcePriceCents,
        targetPriceCents: params.upgrade.targetPriceCents,
        differenceCents: params.upgrade.differenceCents,
        billingMonths: params.upgrade.billingMonths,
        paidAt: params.paidAt.toISOString()
      }
    ]
  };
}

export async function applyAiLedgerCreditInTransaction(params: {
  tx: any;
  userId: string;
  subscriptionId: string;
  orderId?: string | null;
  reason: "MONTHLY_GRANT" | "TOPUP";
  delta: bigint;
  idempotencyKey: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  if (params.delta <= 0n) return;
  if (params.delta > BILLING_DB_BIGINT_MAX) throw new Error("ai_credit_balance_out_of_range");
  const duplicate = await params.tx.aiCreditLedger.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { id: true }
  });
  if (duplicate) return;
  const credited = await params.tx.userSubscription.updateMany({
    where: {
      id: params.subscriptionId,
      aiCreditBalance: { lte: BILLING_DB_BIGINT_MAX - params.delta }
    },
    data: { aiCreditBalance: { increment: params.delta } }
  });
  if (credited.count !== 1) {
    const current = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    if (toBigInt(current?.aiCreditBalance) > BILLING_DB_BIGINT_MAX - params.delta) {
      throw new Error("ai_credit_balance_out_of_range");
    }
    throw new Error("ai_credit_balance_concurrent_update");
  }
  const updated = await params.tx.userSubscription.findUnique({
    where: { id: params.subscriptionId },
    select: { aiCreditBalance: true }
  });
  const nextBalance = toBigInt(updated?.aiCreditBalance);
  await params.tx.aiCreditLedger.create({
    data: {
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      orderId: params.orderId ?? null,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
      deltaCredits: params.delta,
      balanceAfterCredits: nextBalance,
      meta: params.meta
    }
  });
}

export function isBillingFinalizationReviewError(error: unknown): boolean {
  const reason = String((error as any)?.message ?? error);
  return (
    reason === "paid_plan_required_for_capacity_topup"
    || reason === "legacy_order_read_only"
    || reason === "confirmed_order_invalid_cart"
    || reason === "ai_credit_balance_out_of_range"
    || reason === "term_activation_failed"
  );
}

export function resolveBillingOrderFinalizationDecision(status: unknown): "finalize" | "already_paid" {
  if (status === "PAID") return "already_paid";
  if (status === "CONFIRMING") return "finalize";
  if (status === "REVIEW_REQUIRED") throw new Error("review_required");
  throw new Error("order_not_payable");
}

export async function runConfirmedBillingFinalization(params: {
  finalize: () => Promise<void>;
  markReviewRequired: (reason: string) => Promise<boolean | void>;
  resolveTerminalStatus?: () => Promise<string | null>;
}): Promise<void> {
  try {
    await params.finalize();
  } catch (error) {
    const reason = String((error as any)?.message ?? error);
    if (reason === "billing_finalization_cas_lost" && params.resolveTerminalStatus) {
      const terminalStatus = await params.resolveTerminalStatus();
      if (terminalStatus === "PAID") return;
      if (terminalStatus === "REVIEW_REQUIRED") throw new Error("review_required");
    }
    if (!isBillingFinalizationReviewError(error)) throw error;
    let marked: boolean | void;
    try {
      marked = await params.markReviewRequired(reason);
    } catch (markError) {
      if (params.resolveTerminalStatus) {
        const terminalStatus = await params.resolveTerminalStatus();
        if (terminalStatus === "PAID") return;
        if (terminalStatus === "REVIEW_REQUIRED") throw new Error("review_required");
      }
      throw markError;
    }
    if (marked === false && params.resolveTerminalStatus) {
      const terminalStatus = await params.resolveTerminalStatus();
      if (terminalStatus === "PAID") return;
    }
    throw new Error("review_required");
  }
}

async function finalizeConfirmedBillingOrderWithReviewHandling(
  orderId: string,
  merchantOrderId: string,
  statusRaw: string,
  paidAt: Date
): Promise<void> {
  return runConfirmedBillingFinalization({
    finalize: () => finalizeConfirmedBillingOrder(merchantOrderId, statusRaw, paidAt),
    markReviewRequired: async (reason) => {
      return db.$transaction(async (tx: any) => {
        const orderClaim = await tx.billingOrder.updateMany({
          where: { id: orderId, status: "CONFIRMING" },
          data: {
            status: "REVIEW_REQUIRED",
            paymentStatusRaw: `finalization:${reason}`
          }
        });
        if (orderClaim.count !== 1) return false;
        const paymentClaim = await tx.billingOnchainPayment.updateMany({
          where: { orderId, verifiedAt: { not: null } },
          data: {
            nextRetryAt: null,
            lastCheckedAt: new Date(),
            lastError: `finalization:${reason}`
          }
        });
        if (paymentClaim.count !== 1) throw new Error("billing_finalization_review_cas_lost");
        return true;
      });
    },
    resolveTerminalStatus: async () => {
      const current = await db.billingOrder.findUnique({
        where: { id: orderId },
        select: { status: true }
      });
      return current?.status ?? null;
    }
  });
}

export async function resolveCapacityAddonTargetTermInTransaction(params: {
  tx: any;
  userId: string;
  now: Date;
  activate?: (tx: any, termId: string, now: Date) => Promise<boolean>;
}): Promise<{ term: any | null; activated: number }> {
  const dueTerms = await params.tx.subscriptionTerm.findMany({
    where: {
      userId: params.userId,
      status: "SCHEDULED",
      startsAt: { lte: params.now }
    },
    select: { id: true },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: 50
  });
  const activate = params.activate ?? activateSubscriptionTermInTransaction;
  let activated = 0;
  for (const dueTerm of dueTerms) {
    if (await activate(params.tx, dueTerm.id, params.now)) activated += 1;
  }
  const term = await params.tx.subscriptionTerm.findFirst({
    where: {
      userId: params.userId,
      startsAt: { lte: params.now },
      graceEndsAt: { gt: params.now },
      status: { in: ["ACTIVE", "GRACE"] }
    },
    orderBy: { startsAt: "desc" }
  });
  return { term, activated };
}

export function hasPaidCapacityAddonTarget(activeTerm: unknown, effectivePlan: unknown): boolean {
  return Boolean(activeTerm) || effectivePlan === "PRO" || effectivePlan === "PREMIUM";
}

async function finalizeConfirmedBillingOrder(
  merchantOrderId: string,
  statusRaw: string,
  paidAt = new Date()
): Promise<void> {
  const order = await db.billingOrder.findUnique({
    where: { merchantOrderId },
    include: {
      pkg: true,
      items: {
        include: {
          pkg: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    }
  });
  if (!order) return;
  if (order.status === "PAID") return;
  if (order.provider !== "ARBITRUM_USDC") throw new Error("legacy_order_read_only");
  resolveBillingOrderFinalizationDecision(order.status);

  const applyLines = buildApplyOrderLines(order).sort((a, b) => {
    const aRank = a.pkg.kind === "PLAN" ? 0 : 1;
    const bRank = b.pkg.kind === "PLAN" ? 0 : 1;
    return aRank - bRank;
  });
  if (
    applyLines.length === 0
    || applyLines.some((line) => !line.pkg.id || !line.pkg.code)
    || applyLines.some((line) => line.pkg.publicKind === "plan" && !line.pkg.plan)
  ) {
    throw new Error("confirmed_order_invalid_cart");
  }
  const immediateUpgrade = readImmediatePremiumUpgradeMetadata(order.createPayload);

  const now = paidAt;
  let scheduledTermId: string | null = null;
  let lifecycleRunRequired = false;
  let forceFree = false;
  let finalizationCommitted = false;
  await db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-subscription:${order.userId}`}, 0))`;
    }
    const currentOrder = await tx.billingOrder.findUnique({
      where: { id: order.id },
      select: { status: true }
    });
    const decision = resolveBillingOrderFinalizationDecision(currentOrder?.status);
    if (decision === "already_paid") return;
    const finalizationClaim = await tx.billingOrder.updateMany({
      where: { id: order.id, status: "CONFIRMING" },
      data: { paymentStatusRaw: `finalizing:${statusRaw}` }
    });
    if (finalizationClaim.count !== 1) throw new Error("billing_finalization_cas_lost");
    const existingSub = await getOrCreateSubscription(order.userId, tx);
    const planLine = applyLines.find((line) => line.pkg.publicKind === "plan") ?? null;

    if (planLine?.pkg.plan === "FREE") {
      forceFree = true;
    } else if (planLine && immediateUpgrade) {
      if (
        planLine.pkg.plan !== "PREMIUM"
        || planLine.pkg.billingMonths !== immediateUpgrade.billingMonths
        || planLine.pkg.priceCents !== immediateUpgrade.targetPriceCents
      ) {
        throw new Error("confirmed_order_upgrade_metadata_invalid");
      }
      const planOrderItem = order.items.find((item: any) => {
        const snapshot = asRecord(item.packageSnapshot);
        const kind = item.kindSnapshot ?? snapshot.kind ?? item.pkg?.kind;
        return kind === "PLAN" || kind === "plan";
      });
      if (normalizeInt(planOrderItem?.unitPriceCents, 0, 0) !== immediateUpgrade.differenceCents) {
        throw new Error("confirmed_order_upgrade_metadata_invalid");
      }
      const [sourceTerm, scheduledConflict] = await Promise.all([
        tx.subscriptionTerm.findUnique({ where: { id: immediateUpgrade.sourceTermId } }),
        tx.subscriptionTerm.findFirst({
          where: {
            userId: order.userId,
            status: "SCHEDULED",
            id: { not: immediateUpgrade.sourceTermId }
          },
          select: { id: true }
        })
      ]);
      const sourceSnapshot = sourceTerm ? readTermSnapshot(sourceTerm) : null;
      if (
        !sourceTerm
        || sourceTerm.userId !== order.userId
        || sourceTerm.subscriptionId !== existingSub.id
        || sourceSnapshot?.plan !== "PRO"
        || sourceTerm.status !== "ACTIVE"
        || sourceTerm.endsAt.getTime() <= now.getTime()
        || sourceTerm.endsAt.toISOString() !== immediateUpgrade.sourceTermEndsAt
        || sourceTerm.graceEndsAt.toISOString() !== immediateUpgrade.sourceTermGraceEndsAt
        || scheduledConflict
      ) {
        throw new Error("premium_upgrade_source_term_changed");
      }

      const upgradedTerm = await tx.subscriptionTerm.updateMany({
        where: {
          id: sourceTerm.id,
          userId: order.userId,
          subscriptionId: existingSub.id,
          status: "ACTIVE",
          endsAt: sourceTerm.endsAt,
          graceEndsAt: sourceTerm.graceEndsAt
        },
        data: {
          plan: "PREMIUM",
          entitlementSnapshot: buildImmediatePremiumUpgradeSnapshot({
            sourceTerm,
            orderLines: applyLines,
            targetPlanLine: planLine,
            upgrade: immediateUpgrade,
            paidAt: now
          }),
          monthlyAiCredits: planLine.pkg.monthlyAiCredits
        }
      });
      if (upgradedTerm.count !== 1) throw new Error("premium_upgrade_source_term_changed");
      await tx.userSubscription.update({
        where: { id: existingSub.id },
        data: {
          effectivePlan: "PREMIUM",
          status: "ACTIVE",
          planValidUntil: sourceTerm.endsAt,
          proValidUntil: sourceTerm.endsAt,
          maxExchangeAccounts: planLine.pkg.maxExchangeAccounts,
          maxRunningBots: planLine.pkg.maxRunningBots,
          maxRunningPredictionsAi: planLine.pkg.maxRunningPredictionsAi,
          maxRunningPredictionsComposite: planLine.pkg.maxRunningPredictionsComposite,
          allowedExchanges: planLine.pkg.allowedExchanges,
          monthlyAiCreditsIncluded: planLine.pkg.monthlyAiCredits,
          entitlementSyncPending: true
        }
      });

      for (const [index, line] of applyLines.entries()) {
        if (line.pkg.publicKind !== "addon") continue;
        const quantity = normalizeInt(line.quantity, 1, 1);
        if (line.pkg.addonType === "ai_credits") {
          await applyAiLedgerCreditInTransaction({
            tx,
            userId: order.userId,
            subscriptionId: existingSub.id,
            orderId: order.id,
            reason: "TOPUP",
            delta: line.pkg.aiCredits * BigInt(quantity),
            idempotencyKey: `order:${order.id}:topup:${index}`,
            meta: { packageId: line.pkg.id, packageCode: line.pkg.code, quantity, merchantOrderId }
          });
          continue;
        }
        await tx.subscriptionCapacityGrant.create({
          data: {
            userId: order.userId,
            subscriptionId: existingSub.id,
            orderId: order.id,
            termId: sourceTerm.id,
            sourceKey: `order:${order.id}:capacity:${index}`,
            planScope: "PREMIUM",
            deltaRunningBots: normalizeCapacityDelta(line.pkg.deltaRunningBots) * quantity,
            deltaRunningPredictionsAi: normalizeCapacityDelta(line.pkg.deltaRunningPredictionsAi) * quantity,
            deltaRunningPredictionsComposite: normalizeCapacityDelta(
              line.pkg.deltaRunningPredictionsComposite
            ) * quantity,
            validUntil: sourceTerm.graceEndsAt
          }
        });
      }
    } else if (planLine) {
      const latestTerm = await tx.subscriptionTerm.findFirst({
        where: { userId: order.userId },
        orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }]
      });
      const months = normalizeInt(planLine.pkg.billingMonths, 1, 1) * normalizeInt(planLine.quantity, 1, 1);
      const { startsAt, endsAt, graceEndsAt } = planSubscriptionTermWindow({
        now,
        billingMonths: months,
        latestTerm,
        legacyValidUntil: readPlanValidUntil(existingSub)
      });
      const term = await tx.subscriptionTerm.create({
        data: {
          userId: order.userId,
          subscriptionId: existingSub.id,
          orderId: order.id,
          plan: planLine.pkg.plan,
          status: "SCHEDULED",
          startsAt,
          endsAt,
          graceEndsAt,
          entitlementSnapshot: buildTermEntitlementSnapshot(applyLines, planLine.pkg),
          monthlyAiCredits: planLine.pkg.monthlyAiCredits
        }
      });
      scheduledTermId = term.id;
      if (startsAt <= now) {
        const activated = await activateSubscriptionTermInTransaction(tx, term.id, now);
        if (!activated) throw new Error("term_activation_failed");
      }
      const currentValidUntil = readPlanValidUntil(existingSub);
      if (!currentValidUntil || endsAt > currentValidUntil) {
        await tx.userSubscription.update({
          where: { id: existingSub.id },
          data: {
            planValidUntil: endsAt,
            // Compatibility cache for existing consumers during the rollout.
            proValidUntil: endsAt
          }
        });
      }
    } else {
      const target = await resolveCapacityAddonTargetTermInTransaction({
        tx,
        userId: order.userId,
        now
      });
      const activeTerm = target.term;
      lifecycleRunRequired = target.activated > 0;
      const existingPlanValidUntil = readPlanValidUntil(existingSub);
      const validUntil = activeTerm?.graceEndsAt
        ?? (existingPlanValidUntil && addGracePeriod(existingPlanValidUntil) > now
          ? addGracePeriod(existingPlanValidUntil)
          : null);
      if (!validUntil || !hasPaidCapacityAddonTarget(activeTerm, existingSub.effectivePlan)) {
        throw new Error("paid_plan_required_for_capacity_topup");
      }
      for (const [index, line] of applyLines.entries()) {
        const quantity = normalizeInt(line.quantity, 1, 1);
        if (line.pkg.addonType === "ai_credits") {
          await applyAiLedgerCreditInTransaction({
            tx,
            userId: order.userId,
            subscriptionId: existingSub.id,
            orderId: order.id,
            reason: "TOPUP",
            delta: line.pkg.aiCredits * BigInt(quantity),
            idempotencyKey: `order:${order.id}:topup:${index}`,
            meta: { packageId: line.pkg.id, packageCode: line.pkg.code, quantity, merchantOrderId }
          });
          continue;
        }
        await tx.subscriptionCapacityGrant.create({
          data: {
            userId: order.userId,
            subscriptionId: existingSub.id,
            orderId: order.id,
            termId: activeTerm?.id ?? null,
            sourceKey: `order:${order.id}:capacity:${index}`,
            planScope: activeTerm?.plan ?? existingSub.effectivePlan,
            deltaRunningBots: normalizeCapacityDelta(line.pkg.deltaRunningBots) * quantity,
            deltaRunningPredictionsAi: normalizeCapacityDelta(line.pkg.deltaRunningPredictionsAi) * quantity,
            deltaRunningPredictionsComposite: normalizeCapacityDelta(
              line.pkg.deltaRunningPredictionsComposite
            ) * quantity,
            validUntil
          }
        });
      }
    }

    await consumeUliqBenefitReservationInTransaction({
      tx,
      reservationId: order.uliqBenefitReservationId,
      now
    });

    const paidClaim = await tx.billingOrder.updateMany({
      where: { id: order.id, status: "CONFIRMING" },
      data: {
        status: "PAID",
        paidAt: now,
        paymentStatusRaw: statusRaw,
        subscriptionId: existingSub.id
      }
    });
    if (paidClaim.count !== 1) throw new Error("billing_finalization_cas_lost");
    finalizationCommitted = true;
  });

  if (!finalizationCommitted) return;

  if (forceFree) {
    await setUserToFreePlan({ userId: order.userId, syncWorkspaceEntitlements: true });
    return;
  }
  if (scheduledTermId || lifecycleRunRequired) {
    await runSubscriptionLifecycle({ now, limit: 50, userId: order.userId });
  } else {
    const resolved = await resolveEffectivePlanForUser(order.userId);
    await syncWorkspaceEntitlementsWithRetryTracking({
      userId: order.userId,
      effectivePlan: resolved.plan
    });
  }
}

export async function activateSubscriptionTermInTransaction(
  tx: any,
  termId: string,
  now: Date
): Promise<boolean> {
    const claimed = await tx.subscriptionTerm.updateMany({
      where: {
        id: termId,
        status: "SCHEDULED",
        activatedAt: null,
        startsAt: { lte: now }
      },
      data: {
        status: "ACTIVE",
        activatedAt: now
      }
    });
    if (claimed.count !== 1) return false;
    const term = await tx.subscriptionTerm.findUnique({ where: { id: termId } });
    if (!term) return false;
    const snapshot = readTermSnapshot(term);

    const previousTerms = await tx.subscriptionTerm.findMany({
      where: {
        userId: term.userId,
        id: { not: term.id },
        startsAt: { lt: term.startsAt },
        status: { in: ["ACTIVE", "GRACE"] }
      },
      select: { id: true }
    });
    const previousTermIds = previousTerms.map((row: any) => row.id);
    if (previousTermIds.length > 0) {
      await tx.subscriptionTerm.updateMany({
        where: { id: { in: previousTermIds } },
        data: { status: "EXPIRED", expiredAt: now }
      });
      await tx.subscriptionCapacityGrant.updateMany({
        where: {
          termId: { in: previousTermIds },
          OR: [{ validUntil: null }, { validUntil: { gt: term.startsAt } }]
        },
        data: { validUntil: term.startsAt }
      });
    }

    await tx.userSubscription.update({
      where: { id: term.subscriptionId },
      data: {
        effectivePlan: snapshot.plan,
        status: "ACTIVE",
        maxExchangeAccounts: snapshot.maxExchangeAccounts,
        maxRunningBots: snapshot.maxRunningBots,
        maxRunningPredictionsAi: snapshot.maxRunningPredictionsAi,
        maxRunningPredictionsComposite: snapshot.maxRunningPredictionsComposite,
        allowedExchanges: snapshot.allowedExchanges,
        monthlyAiCreditsIncluded: snapshot.monthlyAiCredits,
        entitlementSyncPending: true
      }
    });

    for (const [index, line] of snapshot.lines.entries()) {
      if (line.pkg.publicKind !== "addon") continue;
      const quantity = normalizeInt(line.quantity, 1, 1);
      if (line.pkg.addonType === "ai_credits") {
        // Token credits are applied by the independently retryable AI-cycle worker.
        // They must never roll back the paid term or its non-token entitlements.
        continue;
      }
      await tx.subscriptionCapacityGrant.create({
        data: {
          userId: term.userId,
          subscriptionId: term.subscriptionId,
          orderId: term.orderId,
          termId: term.id,
          sourceKey: `term:${term.id}:capacity:${index}`,
          planScope: snapshot.plan,
          deltaRunningBots: normalizeCapacityDelta(line.pkg.deltaRunningBots) * quantity,
          deltaRunningPredictionsAi: normalizeCapacityDelta(line.pkg.deltaRunningPredictionsAi) * quantity,
          deltaRunningPredictionsComposite: normalizeCapacityDelta(
            line.pkg.deltaRunningPredictionsComposite
          ) * quantity,
          validUntil: term.graceEndsAt
        }
      });
    }

    await tx.subscriptionTerm.update({
      where: { id: term.id },
      data: {
        aiGrantCyclesApplied: 0,
        // Persistent due marker: a failed credit transaction rolls back without
        // advancing this timestamp, so the lifecycle job retries idempotently.
        nextAiGrantAt: term.startsAt < term.endsAt ? term.startsAt : null
      }
    });
  return true;
}

async function activateSubscriptionTerm(termId: string, now: Date): Promise<boolean> {
  return db.$transaction((tx: any) => activateSubscriptionTermInTransaction(tx, termId, now));
}

export async function applyDueSubscriptionTermAiCycleInTransaction(
  tx: any,
  termId: string,
  now: Date
): Promise<boolean> {
  const term = await tx.subscriptionTerm.findUnique({ where: { id: termId } });
  if (
    !term
    || !term.activatedAt
    || (term.status !== "ACTIVE" && term.status !== "GRACE")
    || !(term.nextAiGrantAt instanceof Date)
    || term.nextAiGrantAt > now
    || term.nextAiGrantAt >= term.endsAt
  ) {
    return false;
  }
  const cycle = normalizeInt(term.aiGrantCyclesApplied, 0, 0);
  const nextAiGrantAt = addBillingMonths(term.startsAt, cycle + 1);
  const claimed = await tx.subscriptionTerm.updateMany({
    where: {
      id: term.id,
      aiGrantCyclesApplied: cycle,
      nextAiGrantAt: term.nextAiGrantAt
    },
    data: {
      aiGrantCyclesApplied: cycle + 1,
      nextAiGrantAt: nextAiGrantAt < term.endsAt ? nextAiGrantAt : null
    }
  });
  if (claimed.count !== 1) return false;

  if (cycle === 0) {
    const snapshot = readTermSnapshot(term);
    for (const [index, line] of snapshot.lines.entries()) {
      if (line.pkg.publicKind !== "addon" || line.pkg.addonType !== "ai_credits") continue;
      const quantity = normalizeInt(line.quantity, 1, 1);
      await applyAiLedgerCreditInTransaction({
        tx,
        userId: term.userId,
        subscriptionId: term.subscriptionId,
        orderId: term.orderId,
        reason: "TOPUP",
        delta: line.pkg.aiCredits * BigInt(quantity),
        idempotencyKey: `term:${term.id}:topup:${index}`,
        meta: { termId: term.id, packageId: line.pkg.id, packageCode: line.pkg.code, quantity }
      });
    }
  }

  await applyAiLedgerCreditInTransaction({
    tx,
    userId: term.userId,
    subscriptionId: term.subscriptionId,
    orderId: term.orderId,
    reason: "MONTHLY_GRANT",
    delta: toBigInt(term.monthlyAiCredits),
    idempotencyKey: `term:${term.id}:monthly:${cycle}`,
    meta: { termId: term.id, cycle, scheduledAt: term.nextAiGrantAt.toISOString() }
  });
  return true;
}

export async function runDueSubscriptionTermAiCycle(
  database: any,
  termId: string,
  now: Date
): Promise<boolean> {
  return database.$transaction((tx: any) => (
    applyDueSubscriptionTermAiCycleInTransaction(tx, termId, now)
  ));
}

async function grantDueMonthlyAiCycles(termId: string, now: Date): Promise<number> {
  let granted = 0;
  for (let guard = 0; guard < 36; guard += 1) {
    const applied = await runDueSubscriptionTermAiCycle(db, termId, now);
    if (!applied) break;
    granted += 1;
  }
  return granted;
}

export function buildDueSubscriptionAiGrantOrderBy(): Array<Record<string, "asc">> {
  return [{ updatedAt: "asc" }, { nextAiGrantAt: "asc" }, { id: "asc" }];
}

export async function persistSubscriptionAiGrantFailure(params: {
  database: any;
  term: { id: string; userId: string; nextAiGrantAt?: Date | null };
  now: Date;
  error: unknown;
}): Promise<void> {
  const reason = String((params.error as any)?.message ?? params.error).slice(0, 1_000);
  await params.database.subscriptionTerm.updateMany({
    where: {
      id: params.term.id,
      status: { in: ["ACTIVE", "GRACE"] },
      nextAiGrantAt: { not: null }
    },
    // This is a retry/fairness marker only. The original due cycle and ledger
    // key remain unchanged, while the failed row moves behind other due rows.
    data: { updatedAt: params.now }
  }).catch(() => undefined);

  const alerts = params.database.platformAlert;
  if (typeof alerts?.findFirst !== "function" || typeof alerts?.create !== "function") return;
  const existing = await alerts.findFirst({
    where: {
      source: BILLING_AI_GRANT_ALERT_SOURCE,
      type: BILLING_AI_GRANT_ALERT_TYPE,
      userId: params.term.userId,
      status: { in: ["open", "acknowledged"] }
    },
    orderBy: [{ updatedAt: "desc" }]
  }).catch(() => null);
  const data = {
    severity: "warning",
    title: "Subscription AI credit requires attention",
    message: `AI credit cycle for subscription term ${params.term.id} failed: ${reason}`,
    metadata: {
      termId: params.term.id,
      nextAiGrantAt: params.term.nextAiGrantAt?.toISOString() ?? null,
      failedAt: params.now.toISOString(),
      reason
    }
  };
  if (existing?.id && typeof alerts.update === "function") {
    await alerts.update({ where: { id: existing.id }, data }).catch(() => undefined);
    return;
  }
  await alerts.create({
    data: {
      ...data,
      status: "open",
      type: BILLING_AI_GRANT_ALERT_TYPE,
      source: BILLING_AI_GRANT_ALERT_SOURCE,
      userId: params.term.userId
    }
  }).catch(() => undefined);
}

async function resolveSubscriptionAiGrantFailure(database: any, userId: string, now: Date): Promise<void> {
  if (typeof database.platformAlert?.updateMany !== "function") return;
  await database.platformAlert.updateMany({
    where: {
      source: BILLING_AI_GRANT_ALERT_SOURCE,
      type: BILLING_AI_GRANT_ALERT_TYPE,
      userId,
      status: { in: ["open", "acknowledged"] }
    },
    data: {
      status: "resolved",
      resolvedAt: now,
      resolvedByUserId: null
    }
  }).catch(() => undefined);
}

async function synchronizeSubscriptionLifecycleForUser(userId: string, now: Date): Promise<EffectivePlan> {
  return db.$transaction(async (tx: any) => {
    const sub = await getOrCreateSubscription(userId, tx);
    const currentTerm = await tx.subscriptionTerm.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "GRACE"] },
        startsAt: { lte: now },
        graceEndsAt: { gt: now },
        activatedAt: { not: null }
      },
      orderBy: { startsAt: "desc" }
    });
    if (currentTerm) {
      const snapshot = readTermSnapshot(currentTerm);
      const inGrace = currentTerm.endsAt <= now;
      if (inGrace && currentTerm.status === "ACTIVE") {
        await tx.subscriptionTerm.updateMany({
          where: { id: currentTerm.id, status: "ACTIVE", endsAt: { lte: now }, graceEndsAt: { gt: now } },
          data: { status: "GRACE", graceEnteredAt: currentTerm.graceEnteredAt ?? now }
        });
      }
      const furthest = await tx.subscriptionTerm.findFirst({
        where: { userId, status: { in: ["SCHEDULED", "ACTIVE", "GRACE"] } },
        orderBy: { endsAt: "desc" },
        select: { endsAt: true }
      });
      await tx.userSubscription.update({
        where: { id: sub.id },
        data: {
          effectivePlan: snapshot.plan,
          status: inGrace ? "GRACE" : "ACTIVE",
          planValidUntil: furthest?.endsAt ?? currentTerm.endsAt,
          proValidUntil: furthest?.endsAt ?? currentTerm.endsAt,
          entitlementSyncPending: true
        }
      });
      return formatPlan(snapshot.plan);
    }

    const defaults = await getFreePlanDefaults(tx);
    await tx.userSubscription.update({
      where: { id: sub.id },
      data: {
        effectivePlan: "FREE",
        status: "ACTIVE",
        planValidUntil: null,
        proValidUntil: null,
        maxExchangeAccounts: defaults.maxExchangeAccounts,
        maxRunningBots: defaults.maxRunningBots,
        maxRunningPredictionsAi: defaults.maxRunningPredictionsAi,
        maxRunningPredictionsComposite: defaults.maxRunningPredictionsComposite,
        allowedExchanges: defaults.allowedExchanges,
        monthlyAiCreditsIncluded: defaults.monthlyAiCredits,
        entitlementSyncPending: true
      }
    });
    await tx.subscriptionCapacityGrant.updateMany({
      where: {
        userId,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }]
      },
      data: { validUntil: now }
    });
    return "free";
  });
}

export async function runSubscriptionLifecycle(params?: {
  now?: Date;
  limit?: number;
  userId?: string;
}): Promise<{
  activated: number;
  graceEntered: number;
  expired: number;
  downgraded: number;
  monthlyGrants: number;
}> {
  const now = params?.now ?? new Date();
  const limit = Math.max(1, Math.min(2_000, params?.limit ?? 500));
  const userFilter = params?.userId ? { userId: params.userId } : {};
  const touchedUsers = new Set<string>();
  const dueTerms = await db.subscriptionTerm.findMany({
    where: { ...userFilter, status: "SCHEDULED", startsAt: { lte: now } },
    select: { id: true, userId: true },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });
  let activated = 0;
  for (const term of dueTerms) {
    try {
      if (await activateSubscriptionTerm(term.id, now)) activated += 1;
      touchedUsers.add(term.userId);
    } catch (error) {
      logger.warn("billing_subscription_term_activation_failed", {
        termId: term.id,
        userId: term.userId,
        error: String((error as any)?.message ?? error)
      });
    }
  }

  const dueMonthlyTerms = await db.subscriptionTerm.findMany({
    where: {
      ...userFilter,
      status: { in: ["ACTIVE", "GRACE"] },
      nextAiGrantAt: { lte: now }
    },
    select: { id: true, userId: true, nextAiGrantAt: true },
    orderBy: buildDueSubscriptionAiGrantOrderBy(),
    take: limit
  });
  let monthlyGrants = 0;
  for (const term of dueMonthlyTerms) {
    try {
      monthlyGrants += await grantDueMonthlyAiCycles(term.id, now);
      await resolveSubscriptionAiGrantFailure(db, term.userId, now);
      touchedUsers.add(term.userId);
    } catch (error) {
      await persistSubscriptionAiGrantFailure({ database: db, term, now, error });
      logger.warn("billing_subscription_monthly_grant_failed", {
        termId: term.id,
        userId: term.userId,
        error: String((error as any)?.message ?? error)
      });
    }
  }

  const graceCandidates = await db.subscriptionTerm.findMany({
    where: { ...userFilter, status: "ACTIVE", endsAt: { lte: now } },
    select: { id: true, userId: true },
    take: limit
  });
  let graceEntered = 0;
  for (const term of graceCandidates) {
    try {
      const updated = await db.subscriptionTerm.updateMany({
        where: { id: term.id, status: "ACTIVE", endsAt: { lte: now }, graceEndsAt: { gt: now } },
        data: { status: "GRACE", graceEnteredAt: now }
      });
      graceEntered += updated.count;
      touchedUsers.add(term.userId);
    } catch (error) {
      logger.warn("billing_subscription_grace_transition_failed", {
        termId: term.id,
        userId: term.userId,
        error: String((error as any)?.message ?? error)
      });
    }
  }

  const expiredCandidates = await db.subscriptionTerm.findMany({
    where: {
      ...userFilter,
      status: { in: ["ACTIVE", "GRACE"] },
      graceEndsAt: { lte: now }
    },
    select: { id: true, userId: true },
    take: limit
  });
  let expired = 0;
  for (const term of expiredCandidates) {
    try {
      const updated = await db.subscriptionTerm.updateMany({
        where: { id: term.id, status: { in: ["ACTIVE", "GRACE"] }, graceEndsAt: { lte: now } },
        data: { status: "EXPIRED", expiredAt: now }
      });
      expired += updated.count;
      touchedUsers.add(term.userId);
    } catch (error) {
      logger.warn("billing_subscription_expiry_transition_failed", {
        termId: term.id,
        userId: term.userId,
        error: String((error as any)?.message ?? error)
      });
    }
  }
  if (!params?.userId) {
    const legacyExpired = await db.userSubscription.findMany({
      where: {
        effectivePlan: { in: ["PRO", "PREMIUM"] },
        OR: [
          { planValidUntil: { lte: new Date(now.getTime() - BILLING_GRACE_PERIOD_MS) } },
          {
            planValidUntil: null,
            proValidUntil: { lte: new Date(now.getTime() - BILLING_GRACE_PERIOD_MS) }
          }
        ],
        terms: { none: {} }
      },
      select: { userId: true },
      take: limit
    });
    for (const row of legacyExpired) touchedUsers.add(row.userId);
    const entitlementSyncRows = await db.userSubscription.findMany({
      where: {
        OR: [
          { entitlementSyncPending: true },
          {
            effectivePlan: { in: ["PRO", "PREMIUM"] },
            status: { in: ["ACTIVE", "GRACE"] }
          }
        ]
      },
      select: { userId: true },
      orderBy: { updatedAt: "asc" },
      take: limit
    });
    for (const row of entitlementSyncRows) touchedUsers.add(row.userId);
  }
  if (params?.userId) touchedUsers.add(params.userId);

  let downgraded = 0;
  for (const userId of touchedUsers) {
    try {
      const before = await db.userSubscription.findUnique({
        where: { userId },
        select: { effectivePlan: true }
      });
      const plan = await synchronizeSubscriptionLifecycleForUser(userId, now);
      if (formatPlan(before?.effectivePlan) !== "free" && plan === "free") downgraded += 1;
      await syncWorkspaceEntitlementsWithRetryTracking({ userId, effectivePlan: plan });
    } catch (error) {
      logger.warn("billing_subscription_user_sync_failed", {
        userId,
        error: String((error as any)?.message ?? error)
      });
    }
  }
  return { activated, graceEntered, expired, downgraded, monthlyGrants };
}

export async function getSubscriptionSummary(userId: string): Promise<{
  plan: EffectivePlan;
  planDisplayName: "Free" | "Pro" | "Premium";
  status: "active" | "grace" | "inactive";
  planValidUntil: string | null;
  proValidUntil: string | null;
  graceEndsAt: string | null;
  scheduledTerm: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    graceEndsAt: string;
  } | null;
  limits: {
    maxExchangeAccounts: number | null;
    maxRunningBots: number;
    allowedExchanges: string[];
    bots: {
      maxRunning: number;
    };
    predictions: {
      local: {
        maxRunning: number | null;
      };
      ai: {
        maxRunning: number | null;
      };
      composite: {
        maxRunning: number | null;
      };
    };
  };
  usage: {
    runningBots: number;
    bots: {
      running: number;
    };
    predictions: {
      local: {
        running: number;
      };
      ai: {
        running: number;
      };
      composite: {
        running: number;
      };
    };
  };
  quotaBreakdown: {
    base: {
      runningBots: number;
      runningPredictionsAi: number | null;
      runningPredictionsComposite: number | null;
    };
    addon: {
      runningBots: number;
      runningPredictionsAi: number;
      runningPredictionsComposite: number;
    };
    effective: {
      runningBots: number;
      runningPredictionsAi: number | null;
      runningPredictionsComposite: number | null;
    };
  };
  exchangeAccounts: { used: number; max: number | null; paperExcluded: true };
  upgradePreview: ImmediatePremiumUpgradePricing | null;
  ai: { creditBalance: string; creditsUsedLifetime: string; monthlyIncludedCredits: string; billingEnabled: boolean };
  planCatalog: any[];
  packages: any[];
  orders: any[];
}> {
  await ensureBillingDefaults();
  await expireStalePendingBillingOrders(userId);
  const resolved = await resolveEffectivePlanForUser(userId);
  const now = new Date();
  const [limits, usage, capacityAddon, exchangeAccountsUsed, packages, orders, currentTerm, scheduledTerm] = await Promise.all([
    resolveEffectiveQuotaForUser(userId),
    resolveQuotaUsageForUser(userId),
    resolveActiveCapacityGrantDeltas({ userId, plan: resolved.plan, now }),
    db.exchangeAccount.count({ where: buildRealExchangeAccountCapacityWhere(userId) }),
    listActiveBillingPackages(),
    db.billingOrder.findMany({
      where: { userId },
      include: {
        onchainPayment: true,
        subscriptionTerm: true,
        uliqBenefitReservation: true,
        pkg: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true
          }
        },
        items: {
          include: {
            pkg: {
              select: {
                id: true,
                code: true,
                name: true,
                kind: true
              }
            }
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    db.subscriptionTerm.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "GRACE"] },
        startsAt: { lte: now },
        graceEndsAt: { gt: now }
      },
      include: {
        order: {
          include: {
            items: {
              include: { pkg: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }]
            }
          }
        }
      },
      orderBy: { startsAt: "desc" }
    }),
    db.subscriptionTerm.findFirst({
      where: { userId, status: "SCHEDULED" },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }]
    })
  ]);

  let upgradePreview: ImmediatePremiumUpgradePricing | null = null;
  if (resolved.plan === "pro" && currentTerm?.status === "ACTIVE" && !scheduledTerm) {
    const sourceEvidence = readTermPlanPriceEvidence(currentTerm, "PRO");
    const target = canonicalPackageByCode("premium_monthly");
    if (sourceEvidence) {
      try {
        upgradePreview = resolveImmediatePremiumUpgradePricing({
          now,
          sourcePlan: readStoredPlan(currentTerm.plan ?? asRecord(currentTerm.entitlementSnapshot).plan),
          targetPlan: target.plan,
          sourceTermId: String(currentTerm.id),
          sourceTermEndsAt: currentTerm.endsAt,
          sourceTermGraceEndsAt: currentTerm.graceEndsAt,
          sourcePriceCents: sourceEvidence.priceCents,
          targetPriceCents: target.priceCents,
          sourceBillingMonths: sourceEvidence.billingMonths,
          targetBillingMonths: target.billingMonths,
          hasScheduledTerm: false
        });
      } catch {
        upgradePreview = null;
      }
    }
  }

  return {
    plan: resolved.plan,
    planDisplayName: resolved.plan === "premium" ? "Premium" : resolved.plan === "pro" ? "Pro" : "Free",
    status: resolved.status,
    planValidUntil: resolved.planValidUntil,
    proValidUntil: resolved.proValidUntil,
    graceEndsAt: currentTerm?.graceEndsAt instanceof Date
      ? currentTerm.graceEndsAt.toISOString()
      : null,
    scheduledTerm: scheduledTerm ? {
      id: String(scheduledTerm.id),
      status: String(scheduledTerm.status).toLowerCase(),
      startsAt: scheduledTerm.startsAt.toISOString(),
      endsAt: scheduledTerm.endsAt.toISOString(),
      graceEndsAt: scheduledTerm.graceEndsAt.toISOString()
    } : null,
    limits: {
      maxExchangeAccounts: resolved.maxExchangeAccounts,
      maxRunningBots: limits.bots.maxRunning,
      allowedExchanges: resolved.allowedExchanges,
      bots: {
        maxRunning: limits.bots.maxRunning
      },
      predictions: {
        local: {
          maxRunning: limits.predictions.local.maxRunning
        },
        ai: {
          maxRunning: limits.predictions.ai.maxRunning
        },
        composite: {
          maxRunning: limits.predictions.composite.maxRunning
        }
      }
    },
    usage: {
      runningBots: usage.bots.running,
      bots: {
        running: usage.bots.running
      },
      predictions: {
        local: {
          running: usage.predictions.local.running
        },
        ai: {
          running: usage.predictions.ai.running
        },
        composite: {
          running: usage.predictions.composite.running
        }
      }
    },
    quotaBreakdown: {
      base: {
        runningBots: resolved.maxRunningBots,
        runningPredictionsAi: resolved.maxRunningPredictionsAi,
        runningPredictionsComposite: resolved.maxRunningPredictionsComposite
      },
      addon: {
        runningBots: capacityAddon.runningBots,
        runningPredictionsAi: capacityAddon.runningPredictionsAi,
        runningPredictionsComposite: capacityAddon.runningPredictionsComposite
      },
      effective: {
        runningBots: limits.bots.maxRunning,
        runningPredictionsAi: limits.predictions.ai.maxRunning,
        runningPredictionsComposite: limits.predictions.composite.maxRunning
      }
    },
    exchangeAccounts: {
      used: exchangeAccountsUsed,
      max: resolved.maxExchangeAccounts,
      paperExcluded: true
    },
    upgradePreview,
    ai: {
      creditBalance: resolved.aiCreditBalance.toString(),
      creditsUsedLifetime: resolved.aiCreditsUsedLifetime.toString(),
      monthlyIncludedCredits: resolved.monthlyAiCreditsIncluded.toString(),
      billingEnabled: await isAiCreditBillingEnabled()
    },
    planCatalog: CANONICAL_STAGE4_PACKAGES
      .filter((item) => item.kind === "PLAN")
      .map((item) => {
        const livePackage = packages.find((pkg: any) => pkg.code === item.code) ?? null;
        return {
          code: item.code,
          name: item.name,
          description: item.description,
          plan: formatPlan(item.plan),
          priceCents: item.priceCents,
          billingMonths: item.billingMonths,
          maxExchangeAccounts: item.maxExchangeAccounts,
          maxRunningBots: item.maxRunningBots,
          maxRunningPredictionsAi: item.maxRunningPredictionsAi,
          maxRunningPredictionsComposite: item.maxRunningPredictionsComposite,
          monthlyAiCredits: item.monthlyAiCredits.toString(),
          packageId: livePackage?.id ?? null,
          purchasable: Boolean(livePackage && isBillingPackagePurchasable(livePackage))
        };
      }),
    packages,
    orders
  };
}

export async function listSubscriptionOrders(userId: string): Promise<any[]> {
  await expireStalePendingBillingOrders(userId);
  return db.billingOrder.findMany({
    where: { userId },
    include: {
      onchainPayment: true,
      subscriptionTerm: true,
      uliqBenefitReservation: true,
      pkg: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true
        }
      },
      items: {
        include: {
          pkg: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true
            }
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}

export async function getEntitlementsForBotStart(
  userId: string,
  caps?: EffectiveQuotaCaps | null
): Promise<{
  maxRunningBots: number;
  allowedExchanges: string[];
}> {
  const [quota, resolved] = await Promise.all([
    resolveEffectiveQuotaForUser(userId, caps),
    resolveEffectivePlanForUser(userId)
  ]);
  return {
    maxRunningBots: quota.bots.maxRunning,
    allowedExchanges: resolved.allowedExchanges
  };
}

export async function applyAiCreditAdminAdjustmentInTransaction(params: {
  tx: any;
  subscriptionId: string;
  delta: bigint;
}): Promise<{ balance: bigint; appliedDelta: bigint }> {
  if (params.delta === 0n) {
    const row = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    return { balance: toBigInt(row?.aiCreditBalance), appliedDelta: 0n };
  }

  if (params.delta > 0n) {
    const credited = await params.tx.userSubscription.updateMany({
      where: {
        id: params.subscriptionId,
        aiCreditBalance: { lte: BILLING_DB_BIGINT_MAX - params.delta }
      },
      data: { aiCreditBalance: { increment: params.delta } }
    });
    if (credited.count !== 1) {
      const row = await params.tx.userSubscription.findUnique({
        where: { id: params.subscriptionId },
        select: { aiCreditBalance: true }
      });
      if (toBigInt(row?.aiCreditBalance) > BILLING_DB_BIGINT_MAX - params.delta) {
        throw new Error("ai_credit_balance_out_of_range");
      }
      throw new Error("ai_credit_balance_concurrent_update");
    }
    const row = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    return { balance: toBigInt(row?.aiCreditBalance), appliedDelta: params.delta };
  }

  const requestedDebit = -params.delta;
  const fullDebit = await params.tx.userSubscription.updateMany({
    where: {
      id: params.subscriptionId,
      aiCreditBalance: { gte: requestedDebit }
    },
    data: { aiCreditBalance: { decrement: requestedDebit } }
  });
  if (fullDebit.count === 1) {
    const row = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    return { balance: toBigInt(row?.aiCreditBalance), appliedDelta: -requestedDebit };
  }

  // Clamp to zero with compare-and-swap. A concurrent grant/debit changes the
  // predicate and forces a fresh read, so no balance update is overwritten.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await params.tx.userSubscription.findUnique({
      where: { id: params.subscriptionId },
      select: { aiCreditBalance: true }
    });
    const current = toBigInt(row?.aiCreditBalance);
    if (current <= 0n) return { balance: 0n, appliedDelta: 0n };
    const claimed = await params.tx.userSubscription.updateMany({
      where: { id: params.subscriptionId, aiCreditBalance: current },
      data: { aiCreditBalance: { decrement: current } }
    });
    if (claimed.count === 1) return { balance: 0n, appliedDelta: -current };
  }
  throw new Error("ai_credit_balance_concurrent_update");
}

export async function adjustAiCreditBalanceByAdmin(params: {
  userId: string;
  deltaCredits: string | bigint | number;
  note?: string;
  actorUserId?: string | null;
}): Promise<{ balance: bigint }> {
  const delta = parseBillingDbBigInt(params.deltaCredits);

  return runSerializableBillingConfigTransaction(db, async (tx: any) => {
    const sub = await getOrCreateSubscription(params.userId, tx);
    const adjusted = await applyAiCreditAdminAdjustmentInTransaction({
      tx,
      subscriptionId: sub.id,
      delta
    });

    if (adjusted.appliedDelta !== 0n) {
      await tx.aiCreditLedger.create({
        data: {
          userId: params.userId,
          subscriptionId: sub.id,
          reason: "ADMIN_ADJUST",
          deltaCredits: adjusted.appliedDelta,
          balanceAfterCredits: adjusted.balance,
          meta: {
            note: params.note ?? null,
            actorUserId: params.actorUserId ?? null
          }
        }
      });
    }

    return {
      balance: adjusted.balance
    };
  });
}

export async function downgradeExpiredSubscriptions(limit = 500): Promise<number> {
  const result = await runSubscriptionLifecycle({ limit });
  return result.downgraded;
}

export function resolveBillingPackageCreditAmounts(params: {
  isPlan: boolean;
  addonType: BillingAddonType | null;
  monthlyAiCredits?: string | bigint | number;
  aiCredits?: string | bigint | number;
  existing?: { monthlyAiCredits?: unknown; aiCredits?: unknown } | null;
}): { monthlyAiCredits: bigint; aiCredits: bigint } {
  return {
    monthlyAiCredits: params.isPlan
      ? parseBillingDbBigInt(params.monthlyAiCredits ?? params.existing?.monthlyAiCredits ?? 0n, { min: 0n })
      : 0n,
    aiCredits: !params.isPlan && params.addonType === "ai_credits"
      ? parseBillingDbBigInt(params.aiCredits ?? params.existing?.aiCredits ?? 0n, { min: 0n })
      : 0n
  };
}

export function validateBillingPackageConfiguration(data: {
  isActive: boolean;
  kind: string;
  plan: string | null;
  addonType: string | null;
  priceCents: number;
  aiCredits: bigint;
  deltaRunningBots: number;
  deltaRunningPredictionsAi: number;
  deltaRunningPredictionsComposite: number;
}): void {
  if (!data.isActive) return;
  if (data.kind !== "PLAN" && data.kind !== "ADDON") throw new Error("package_kind_invalid");
  if (data.kind === "PLAN") {
    if (!data.plan) throw new Error("package_plan_required");
    if ((data.plan === "PRO" || data.plan === "PREMIUM") && data.priceCents < 1) {
      throw new Error("package_active_price_required");
    }
    return;
  }
  if (data.priceCents < 1) throw new Error("package_active_price_required");
  if (!data.addonType) throw new Error("package_addon_type_required");
  const hasValue = data.addonType === "RUNNING_BOTS"
    ? data.deltaRunningBots > 0
    : data.addonType === "RUNNING_PREDICTIONS_AI"
      ? data.deltaRunningPredictionsAi > 0
      : data.addonType === "RUNNING_PREDICTIONS_COMPOSITE"
        ? data.deltaRunningPredictionsComposite > 0
        : data.aiCredits > 0n;
  if (!hasValue) throw new Error("package_addon_value_required");
}

export async function upsertBillingPackage(params: {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  kind: BillingPackageKind;
  addonType?: BillingAddonType | null;
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  billingMonths: number;
  plan: EffectivePlan | null;
  maxExchangeAccounts?: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits?: string | bigint | number;
  aiCredits?: string | bigint | number;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
  meta?: Record<string, unknown> | null;
}): Promise<any> {
  const addonType = normalizeBillingAddonType(params.addonType ?? null);
  const isPlan = params.kind === "plan";
  const needsExistingTokens = Boolean(params.id) && (
    (isPlan && params.monthlyAiCredits === undefined)
    || (!isPlan && addonType === "ai_credits" && params.aiCredits === undefined)
  );
  const existingTokens = needsExistingTokens
    ? await db.billingPackage.findUnique({
        where: { id: params.id },
        select: { monthlyAiCredits: true, aiCredits: true }
      })
    : null;
  const creditAmounts = resolveBillingPackageCreditAmounts({
    isPlan,
    addonType,
    monthlyAiCredits: params.monthlyAiCredits,
    aiCredits: params.aiCredits,
    existing: existingTokens
  });
  const data = {
    code: params.code.trim(),
    name: params.name.trim(),
    description: params.description ?? null,
    kind: isPlan ? "PLAN" : "ADDON",
    addonType:
      !isPlan && addonType
        ? addonType === "running_bots"
          ? "RUNNING_BOTS"
          : addonType === "running_predictions_ai"
            ? "RUNNING_PREDICTIONS_AI"
            : addonType === "running_predictions_composite"
              ? "RUNNING_PREDICTIONS_COMPOSITE"
              : "AI_CREDITS"
        : null,
    isActive: Boolean(params.isActive),
    sortOrder: normalizeInt(params.sortOrder, 0, 0),
    priceCents: normalizeInt(params.priceCents, 0, 0),
    billingMonths: normalizeInt(params.billingMonths, 1, 1),
    plan: isPlan ? (params.plan ? toStoredPlan(params.plan) : null) : null,
    maxExchangeAccounts:
      isPlan && params.maxExchangeAccounts !== null && params.maxExchangeAccounts !== undefined
        ? normalizeInt(params.maxExchangeAccounts, 0, 0)
        : null,
    maxRunningBots:
      isPlan && params.maxRunningBots !== null ? normalizeInt(params.maxRunningBots, 0, 0) : null,
    maxRunningPredictionsAi:
      !isPlan || params.maxRunningPredictionsAi === null
        ? null
        : normalizeInt(params.maxRunningPredictionsAi, 0, 0),
    maxRunningPredictionsComposite:
      !isPlan || params.maxRunningPredictionsComposite === null
        ? null
        : normalizeInt(params.maxRunningPredictionsComposite, 0, 0),
    allowedExchanges: normalizeStringArray(params.allowedExchanges, ["*"]),
    monthlyAiCredits: creditAmounts.monthlyAiCredits,
    aiCredits: creditAmounts.aiCredits,
    deltaRunningBots:
      !isPlan && addonType === "running_bots" && params.deltaRunningBots !== null
        ? normalizeInt(params.deltaRunningBots, 0, 0)
        : 0,
    deltaRunningPredictionsAi:
      !isPlan && addonType === "running_predictions_ai" && params.deltaRunningPredictionsAi !== null
        ? normalizeInt(params.deltaRunningPredictionsAi, 0, 0)
        : 0,
    deltaRunningPredictionsComposite:
      !isPlan && addonType === "running_predictions_composite" && params.deltaRunningPredictionsComposite !== null
        ? normalizeInt(params.deltaRunningPredictionsComposite, 0, 0)
        : 0,
    meta: buildBillingMeta(params.meta, addonType)
  };
  validateBillingPackageConfiguration(data);

  if (params.id) {
    const updated = await db.billingPackage.update({
      where: { id: params.id },
      data
    });
    await syncPlanPackageToSubscriptions(updated);
    return updated;
  }

  const created = await db.billingPackage.create({ data });
  await syncPlanPackageToSubscriptions(created);
  return created;
}

export async function deleteBillingPackage(id: string): Promise<void> {
  await db.billingPackage.delete({ where: { id } });
}
