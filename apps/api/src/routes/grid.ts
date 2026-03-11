import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { requestGridPreview } from "../grid/pythonGridClient.js";
import { computeAutoMarginAllocation, computeAutoReserveAllocationDynamic } from "../grid/autoMargin.js";
import { ManualTradingError, normalizeSymbolInput } from "../trading.js";
import {
  mapBotVaultSnapshot,
  extractBotVaultProviderMetadataRaw,
  summarizeBotVaultProviderMetadata,
  type VaultService
} from "../vaults/service.js";
import type { ExecutionProviderOrchestrator } from "../vaults/executionProvider.orchestrator.js";
import { getEffectiveVaultExecutionProvider } from "../vaults/executionProvider.settings.js";
import { resolveHypervaultsGlobalAccount } from "../vaults/hypervaultsGlobalAccount.settings.js";
import { resolveGridHyperliquidPilotAccess } from "../vaults/gridHyperliquidPilot.settings.js";

const gridModeSchema = z.enum(["long", "short", "neutral", "cross"]);
const gridPriceModeSchema = z.enum(["arithmetic", "geometric"]);
const gridStateSchema = z.enum(["created", "running", "paused", "stopped", "archived", "error"]);
const gridAllocationModeSchema = z.enum([
  "EQUAL_NOTIONAL_PER_GRID",
  "EQUAL_BASE_QTY_PER_GRID",
  "WEIGHTED_NEAR_PRICE"
]);
const gridBudgetSplitPolicySchema = z.enum([
  "FIXED_50_50",
  "FIXED_CUSTOM",
  "DYNAMIC_BY_PRICE_POSITION"
]);
const gridMarginPolicySchema = z.enum(["MANUAL_ONLY", "AUTO_ALLOWED"]);
const gridAutoMarginTriggerTypeSchema = z.enum(["LIQ_DISTANCE_PCT_BELOW", "MARGIN_RATIO_ABOVE"]);
const gridInstanceMarginModeSchema = z.enum(["MANUAL", "AUTO"]);
const gridAutoReservePolicySchema = z.enum(["FIXED_RATIO", "LIQ_GUARD_MAX_GRID"]);

function normalizeGridExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((entry) => normalizeGridExchange(entry))
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

function ensureGridExchangeAllowed(params: {
  exchange: unknown;
  allowedExchanges: Set<string>;
}): { ok: true } | { ok: false; exchange: string; allowedExchanges: string[] } {
  const exchange = normalizeGridExchange(params.exchange);
  if (params.allowedExchanges.has(exchange)) return { ok: true };
  return {
    ok: false,
    exchange,
    allowedExchanges: [...params.allowedExchanges]
  };
}

const gridTemplateBaseObjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  symbol: z.string().trim().min(1).max(40),
  marketType: z.literal("perp").default("perp"),
  mode: gridModeSchema,
  gridMode: gridPriceModeSchema,
  allocationMode: gridAllocationModeSchema.default("EQUAL_NOTIONAL_PER_GRID"),
  budgetSplitPolicy: gridBudgetSplitPolicySchema.default("FIXED_50_50"),
  longBudgetPct: z.number().min(0).max(100).default(50),
  shortBudgetPct: z.number().min(0).max(100).default(50),
  marginPolicy: gridMarginPolicySchema.default("MANUAL_ONLY"),
  autoMarginMaxUSDT: z.number().min(0).nullable().optional(),
  autoMarginTriggerType: gridAutoMarginTriggerTypeSchema.nullable().optional(),
  autoMarginTriggerValue: z.number().positive().nullable().optional(),
  autoMarginStepUSDT: z.number().positive().nullable().optional(),
  autoMarginCooldownSec: z.number().int().min(0).nullable().optional(),
  autoReservePolicy: gridAutoReservePolicySchema.default("LIQ_GUARD_MAX_GRID"),
  autoReserveFixedGridPct: z.number().min(0).max(100).default(70),
  autoReserveTargetLiqDistancePct: z.number().min(0).max(100).nullable().optional(),
  autoReserveMaxPreviewIterations: z.number().int().min(1).max(16).default(8),
  initialSeedEnabled: z.boolean().default(true),
  initialSeedPct: z.number().min(0).max(60).default(30),
  activeOrderWindowSize: z.number().int().min(40).max(120).default(100),
  recenterDriftLevels: z.number().int().min(1).max(10).default(1),
  lowerPrice: z.number().positive(),
  upperPrice: z.number().positive(),
  gridCount: z.number().int().min(2).max(500),
  leverageMin: z.number().int().min(1).max(125).default(1),
  leverageMax: z.number().int().min(1).max(125).default(3),
  leverageDefault: z.number().int().min(1).max(125).default(3),
  investMaxUsd: z.number().positive().default(100_000),
  investDefaultUsd: z.number().positive().default(100),
  slippageDefaultPct: z.number().min(0.0001).max(5).default(0.1),
  slippageMinPct: z.number().min(0.0001).max(5).default(0.0001),
  slippageMaxPct: z.number().min(0.0001).max(5).default(5),
  tpDefaultPct: z.number().positive().max(200).nullable().optional(),
  slDefaultPrice: z.number().positive().nullable().optional(),
  // legacy compatibility, derived from marginPolicy
  allowAutoMargin: z.boolean().default(false),
  allowManualMarginAdjust: z.boolean().default(true),
  allowProfitWithdraw: z.boolean().default(true),
  version: z.number().int().min(1).default(1)
});

function validateGridTemplateBounds(value: z.infer<typeof gridTemplateBaseObjectSchema>, ctx: z.RefinementCtx): void {
  if (value.upperPrice <= value.lowerPrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["upperPrice"],
      message: "upperPrice must be greater than lowerPrice"
    });
  }
  if (value.leverageDefault < value.leverageMin || value.leverageDefault > value.leverageMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["leverageDefault"],
      message: "leverageDefault must be between leverageMin and leverageMax"
    });
  }
  if (value.investDefaultUsd > value.investMaxUsd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["investDefaultUsd"],
      message: "investDefaultUsd must be less than or equal to investMaxUsd"
    });
  }
  if (value.slippageDefaultPct < value.slippageMinPct || value.slippageDefaultPct > value.slippageMaxPct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["slippageDefaultPct"],
      message: "slippageDefaultPct must be between slippageMinPct and slippageMaxPct"
    });
  }
  if (value.mode === "cross" && value.budgetSplitPolicy === "FIXED_CUSTOM" && Math.abs((value.longBudgetPct + value.shortBudgetPct) - 100) > 0.000001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["longBudgetPct"],
      message: "longBudgetPct + shortBudgetPct must equal 100 for FIXED_CUSTOM"
    });
  }
  if (value.autoReservePolicy === "FIXED_RATIO") {
    if (!Number.isFinite(Number(value.autoReserveFixedGridPct))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoReserveFixedGridPct"],
        message: "autoReserveFixedGridPct is required when autoReservePolicy is FIXED_RATIO"
      });
    }
  }
  if (value.autoReservePolicy === "LIQ_GUARD_MAX_GRID") {
    if (!Number.isFinite(Number(value.autoReserveMaxPreviewIterations))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoReserveMaxPreviewIterations"],
        message: "autoReserveMaxPreviewIterations is required when autoReservePolicy is LIQ_GUARD_MAX_GRID"
      });
    }
  }
  if (!Number.isFinite(Number(value.activeOrderWindowSize)) || Math.trunc(Number(value.activeOrderWindowSize)) < 40 || Math.trunc(Number(value.activeOrderWindowSize)) > 120) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["activeOrderWindowSize"],
      message: "activeOrderWindowSize must be between 40 and 120"
    });
  }
  if (!Number.isFinite(Number(value.recenterDriftLevels)) || Math.trunc(Number(value.recenterDriftLevels)) < 1 || Math.trunc(Number(value.recenterDriftLevels)) > 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recenterDriftLevels"],
      message: "recenterDriftLevels must be between 1 and 10"
    });
  }
  if (value.marginPolicy === "MANUAL_ONLY") {
    if (value.autoMarginMaxUSDT != null || value.autoMarginTriggerType != null || value.autoMarginTriggerValue != null || value.autoMarginStepUSDT != null || value.autoMarginCooldownSec != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["marginPolicy"],
        message: "auto margin fields must be null when marginPolicy is MANUAL_ONLY"
      });
    }
  } else {
    if (!value.autoMarginTriggerType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginTriggerType"],
        message: "autoMarginTriggerType is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginTriggerValue == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginTriggerValue"],
        message: "autoMarginTriggerValue is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginStepUSDT == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginStepUSDT"],
        message: "autoMarginStepUSDT is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginCooldownSec == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginCooldownSec"],
        message: "autoMarginCooldownSec is required when marginPolicy is AUTO_ALLOWED"
      });
    }
  }
}

const gridTemplateCreateSchema = gridTemplateBaseObjectSchema.superRefine(validateGridTemplateBounds);
const gridTemplateUpdateSchema = gridTemplateBaseObjectSchema.partial();

const gridTemplateListQuerySchema = z.object({
  published: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  symbol: z.string().trim().min(1).optional(),
  mode: gridModeSchema.optional()
});

const gridTemplatePreviewSchema = z.object({
  investUsd: z.number().positive(),
  leverage: z.number().positive(),
  markPrice: z.number().positive(),
  slippagePct: z.number().min(0.0001).max(5).optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  triggerPrice: z.number().positive().nullable().optional(),
  trailingEnabled: z.boolean().optional()
});

const gridInstanceCreateSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  investUsd: z.number().positive(),
  extraMarginUsd: z.number().min(0).default(0),
  triggerPrice: z.number().positive().nullable().optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().default(false),
  name: z.string().trim().min(1).max(120).optional()
});

const gridInstancePreviewSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  investUsd: z.number().positive(),
  extraMarginUsd: z.number().min(0).default(0),
  triggerPrice: z.number().positive().nullable().optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().default(false),
});

const gridTemplateDraftPreviewSchema = z.object({
  draftTemplate: gridTemplateCreateSchema,
  previewInput: z.object({
    exchangeAccountId: z.string().trim().min(1),
    investUsd: z.number().positive(),
    extraMarginUsd: z.number().min(0).default(0),
    triggerPrice: z.number().positive().nullable().optional(),
    tpPct: z.number().positive().max(200).nullable().optional(),
    slPrice: z.number().positive().nullable().optional(),
    marginMode: gridInstanceMarginModeSchema.optional(),
    autoMarginEnabled: z.boolean().default(false),
    markPriceOverride: z.number().positive().nullable().optional()
  })
});

const gridInstanceListQuerySchema = z.object({
  state: gridStateSchema.optional(),
  exchangeAccountId: z.string().trim().min(1).optional(),
  includeArchived: z.coerce.boolean().optional()
});

const gridInstanceRiskUpdateSchema = z.object({
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().optional()
});

const gridMarginAdjustSchema = z.object({
  amountUsd: z.number().positive()
});

const gridWithdrawSchema = z.object({
  amountUsd: z.number().positive()
});

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as any).code ?? "") : "";
  const message = "message" in error ? String((error as any).message ?? "") : String(error);
  if (code === "P2021") return true;
  return /table .* does not exist/i.test(message) || /relation .* does not exist/i.test(message);
}

async function requireGridFeatureEnabledOrRespond(res: express.Response): Promise<boolean> {
  const raw = process.env.FUTURES_GRID_V1;
  const normalized = String(raw ?? "").trim().toLowerCase();
  const enabled = raw == null || raw === "" || !(normalized === "off" || normalized === "disabled");
  if (enabled) return true;
  res.status(404).json({ error: "futures_grid_disabled" });
  return false;
}

function extractRiskErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const rawCode = "code" in error ? String((error as any).code ?? "").trim() : "";
    if (rawCode.startsWith("risk_")) return rawCode;
  }
  const message = error instanceof Error
    ? String(error.message ?? "")
    : String(error ?? "");
  const match = message.match(/risk_[a-z0-9_]+/i);
  if (!match?.[0]) return null;
  return match[0].toLowerCase();
}

function mapRiskErrorToHttp(error: unknown): { status: number; code: string; reason: string } | null {
  const code = extractRiskErrorCode(error);
  if (!code) return null;
  const status = code === "risk_invalid_status_transition" ? 409 : 400;
  return {
    status,
    code,
    reason: error instanceof Error ? String(error.message ?? code) : code
  };
}

function normalizeTemplateSymbol(value: string): string {
  return normalizeSymbolInput(value) || String(value ?? "").trim().toUpperCase();
}

function toTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function parseAdminBackendAccessSetting(value: unknown): { userIds: string[] } {
  const record = asRecord(value);
  const raw = Array.isArray(record.userIds) ? record.userIds : [];
  return {
    userIds: Array.from(
      new Set(
        raw
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      )
    )
  };
}

async function isAdminGridViewer(db: any, user: { id: string; email: string }): Promise<boolean> {
  const superadminEmail = String(process.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  if (superadminEmail && user.email.trim().toLowerCase() === superadminEmail) return true;
  const row = await db?.globalSetting?.findUnique?.({
    where: { key: "admin.backendAccess" },
    select: { value: true }
  });
  const access = parseAdminBackendAccessSetting(row?.value);
  return access.userIds.includes(String(user.id));
}

function isDirectHyperliquidExchange(exchange: unknown): boolean {
  return normalizeGridExchange(exchange) === "hyperliquid";
}

function sendGridHyperliquidPilotRequired(
  res: express.Response,
  pilotAccess: { allowed: boolean; reason: string; scope: string },
  exchangeAccountId: string,
  marketDataVenue: string
) {
  return res.status(403).json({
    error: "grid_hyperliquid_pilot_required",
    reason: pilotAccess.reason,
    scope: pilotAccess.scope,
    allowed: false,
    exchangeAccountId,
    marketDataVenue
  });
}

async function resolveGridHyperliquidAccountUsage(params: {
  deps: RegisterGridRoutesDeps;
  userId: string;
  exchangeAccount: { id: string; exchange: string };
  symbol: string;
}): Promise<{ usesHyperliquid: boolean; marketDataVenue: string | null }> {
  if (isDirectHyperliquidExchange(params.exchangeAccount.exchange)) {
    return { usesHyperliquid: true, marketDataVenue: "hyperliquid" };
  }
  if (normalizeGridExchange(params.exchangeAccount.exchange) !== "paper") {
    return { usesHyperliquid: false, marketDataVenue: normalizeGridExchange(params.exchangeAccount.exchange) || null };
  }
  try {
    const venueContext = await params.deps.resolveVenueContext({
      userId: params.userId,
      exchangeAccountId: params.exchangeAccount.id,
      symbol: params.symbol
    });
    const marketDataVenue = normalizeGridExchange(venueContext.marketDataVenue);
    return {
      usesHyperliquid: marketDataVenue === "hyperliquid",
      marketDataVenue: marketDataVenue || null
    };
  } catch {
    return { usesHyperliquid: false, marketDataVenue: null };
  }
}

type ResolvedGridExecutionTarget =
  | {
      kind: "global_hypervaults";
      exchangeAccountId: null;
      exchange: "hyperliquid";
      account: null;
      usesHyperliquid: true;
      marketDataVenue: "hyperliquid";
    }
  | {
      kind: "exchange_account";
      exchangeAccountId: string;
      exchange: string;
      account: any;
      usesHyperliquid: boolean;
      marketDataVenue: string | null;
    };

async function resolveGridExecutionTarget(params: {
  deps: RegisterGridRoutesDeps;
  userId: string;
  exchangeAccountId?: string | null;
  symbol: string;
  allowHyperliquid: boolean;
}): Promise<ResolvedGridExecutionTarget> {
  const requestedExchangeAccountId = String(params.exchangeAccountId ?? "").trim();
  if (!requestedExchangeAccountId) {
    const globalAccount = await resolveHypervaultsGlobalAccount(params.deps.db);
    if (!globalAccount || !params.allowHyperliquid) {
      throw new ManualTradingError(
        "hypervaults global execution account missing",
        409,
        "hypervaults_global_account_missing"
      );
    }
    return {
      kind: "global_hypervaults",
      exchangeAccountId: null,
      exchange: "hyperliquid",
      account: null,
      usesHyperliquid: true,
      marketDataVenue: "hyperliquid"
    };
  }

  const account = await params.deps.db.exchangeAccount.findFirst({
    where: {
      id: requestedExchangeAccountId,
      userId: params.userId
    }
  });
  if (!account) throw new ManualTradingError("exchange account missing", 404, "exchange_account_not_found");

  const allowed = ensureGridExchangeAllowed({
    exchange: account.exchange,
    allowedExchanges: params.allowHyperliquid ? new Set([...readAllowedGridExchanges(), "hyperliquid"]) : readAllowedGridExchanges()
  });
  if (!allowed.ok) {
    throw new ManualTradingError(`exchange ${allowed.exchange} is not allowed for grid`, 400, "grid_exchange_not_allowed");
  }

  const hyperliquidUsage = await resolveGridHyperliquidAccountUsage({
    deps: params.deps,
    userId: params.userId,
    exchangeAccount: { id: account.id, exchange: String(account.exchange ?? "") },
    symbol: params.symbol
  });

  return {
    kind: "exchange_account",
    exchangeAccountId: String(account.id),
    exchange: String(account.exchange ?? ""),
    account,
    usesHyperliquid: hyperliquidUsage.usesHyperliquid,
    marketDataVenue: hyperliquidUsage.marketDataVenue
  };
}

function mergeExecutionStateIntoBotVault(
  botVault: Record<string, unknown> | null,
  executionState: Record<string, unknown> | null,
  includeProviderMetadataRaw: boolean
): Record<string, unknown> | null {
  if (!botVault) return null;
  if (!executionState) return botVault;
  const providerMetadataRaw = extractBotVaultProviderMetadataRaw(asRecord(executionState).providerMetadata);
  return {
    ...botVault,
    executionStatus: toNullableString(executionState.status) ?? botVault.executionStatus ?? null,
    executionLastSyncedAt: toNullableString(executionState.observedAt) ?? botVault.executionLastSyncedAt ?? null,
    providerMetadataSummary: summarizeBotVaultProviderMetadata(providerMetadataRaw) ?? botVault.providerMetadataSummary ?? null,
    providerMetadataRaw: includeProviderMetadataRaw ? (providerMetadataRaw ?? botVault.providerMetadataRaw ?? null) : null
  };
}

function buildGridPilotStatus(params: {
  botVault: Record<string, unknown> | null;
  currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
}): Record<string, unknown> | null {
  const botVault = params.botVault ? asRecord(params.botVault) : null;
  const provider = toNullableString(botVault?.executionProvider);
  const executionLastErrorAt = toNullableString(botVault?.executionLastErrorAt);
  const summary = asRecord(botVault?.providerMetadataSummary);
  const providerSelectionReason = toNullableString(summary.providerSelectionReason);
  const pilotScope = toNullableString(summary.pilotScope) ?? params.currentPilotAccess?.scope ?? "none";
  const isDemoProvider = provider === "hyperliquid_demo";
  const isLiveProvider = provider === "hyperliquid";
  const allowState = isLiveProvider || isDemoProvider || Boolean(params.currentPilotAccess?.allowed);
  if (!provider && !params.currentPilotAccess && !isDemoProvider && !isLiveProvider) return null;
  return {
    allowed: allowState,
    reason: allowState
      ? (
          isLiveProvider
            ? "live_provider"
            : (params.currentPilotAccess?.reason ?? (isDemoProvider ? "allowlist" : "not_listed"))
        )
      : (params.currentPilotAccess?.reason ?? "not_listed"),
    provider,
    providerSelectionReason,
    scope: pilotScope,
    lastBlockAt: null,
    lastSyncErrorAt: executionLastErrorAt
  };
}

async function getGridHyperliquidExecutionContext(db: any): Promise<{
  provider: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid: boolean;
  globalAccountConfigured: boolean;
}> {
  const provider = await getEffectiveVaultExecutionProvider(db).catch(
    () => "mock" as "mock" | "hyperliquid_demo" | "hyperliquid"
  );
  const globalAccount = await resolveHypervaultsGlobalAccount(db).catch(() => null);
  return {
    provider: provider as "mock" | "hyperliquid_demo" | "hyperliquid",
    allowLiveHyperliquid: provider === "hyperliquid" && Boolean(globalAccount),
    globalAccountConfigured: Boolean(globalAccount)
  };
}

function resolvePositiveMarkPrice(params: {
  override?: number | null;
  venueMarkPrice?: number | null;
  lowerPrice: number;
  upperPrice: number;
}): number {
  const override = Number(params.override);
  if (Number.isFinite(override) && override > 0) return override;
  const venueMarkPrice = Number(params.venueMarkPrice);
  if (Number.isFinite(venueMarkPrice) && venueMarkPrice > 0) return venueMarkPrice;
  const lower = Number(params.lowerPrice);
  const upper = Number(params.upperPrice);
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower > 0 && upper > lower) {
    return (lower + upper) / 2;
  }
  if (Number.isFinite(lower) && lower > 0) return lower;
  if (Number.isFinite(upper) && upper > 0) return upper;
  return 1;
}

function isTemplatePolicyImplemented(template: {
  allocationMode?: string | null;
  budgetSplitPolicy?: string | null;
}): boolean {
  const allocationMode = String(template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(template.budgetSplitPolicy ?? "FIXED_50_50");
  if (allocationMode === "WEIGHTED_NEAR_PRICE") return false;
  if (budgetSplitPolicy === "DYNAMIC_BY_PRICE_POSITION") return false;
  return true;
}

function normalizeTemplatePolicyInput(input: Record<string, unknown>): Record<string, unknown> {
  const marginPolicyRaw = String(input.marginPolicy ?? "").trim();
  const allowAutoMarginRaw = Boolean(input.allowAutoMargin);
  const marginPolicy = marginPolicyRaw === "AUTO_ALLOWED" || marginPolicyRaw === "MANUAL_ONLY"
    ? marginPolicyRaw
    : (allowAutoMarginRaw ? "AUTO_ALLOWED" : "MANUAL_ONLY");
  const allowAutoMargin = marginPolicy === "AUTO_ALLOWED";

  const normalized: Record<string, unknown> = {
    ...input,
    marginPolicy,
    allowAutoMargin,
    allocationMode: String(input.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID"),
    budgetSplitPolicy: String(input.budgetSplitPolicy ?? "FIXED_50_50"),
    longBudgetPct: Number.isFinite(Number(input.longBudgetPct)) ? Number(input.longBudgetPct) : 50,
    shortBudgetPct: Number.isFinite(Number(input.shortBudgetPct)) ? Number(input.shortBudgetPct) : 50,
    autoReservePolicy: String(input.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"),
    autoReserveFixedGridPct: Number.isFinite(Number(input.autoReserveFixedGridPct)) ? Number(input.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(input.autoReserveTargetLiqDistancePct))
      ? Number(input.autoReserveTargetLiqDistancePct)
      : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(input.autoReserveMaxPreviewIterations))
      ? Math.trunc(Number(input.autoReserveMaxPreviewIterations))
      : 8,
    initialSeedEnabled: typeof input.initialSeedEnabled === "boolean"
      ? input.initialSeedEnabled
      : true,
    initialSeedPct: Number.isFinite(Number(input.initialSeedPct))
      ? Math.max(0, Math.min(60, Number(input.initialSeedPct)))
      : 30,
    activeOrderWindowSize: Number.isFinite(Number(input.activeOrderWindowSize))
      ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize))))
      : 100,
    recenterDriftLevels: Number.isFinite(Number(input.recenterDriftLevels))
      ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels))))
      : 1,
  };

  if (!allowAutoMargin) {
    normalized.autoMarginMaxUSDT = null;
    normalized.autoMarginTriggerType = null;
    normalized.autoMarginTriggerValue = null;
    normalized.autoMarginStepUSDT = null;
    normalized.autoMarginCooldownSec = null;
  } else {
    if (!Number.isFinite(Number(normalized.autoMarginMaxUSDT))) normalized.autoMarginMaxUSDT = 0;
    if (!normalized.autoMarginTriggerType) normalized.autoMarginTriggerType = "LIQ_DISTANCE_PCT_BELOW";
    if (!Number.isFinite(Number(normalized.autoMarginTriggerValue))) normalized.autoMarginTriggerValue = 3;
    if (!Number.isFinite(Number(normalized.autoMarginStepUSDT))) normalized.autoMarginStepUSDT = 25;
    if (!Number.isFinite(Number(normalized.autoMarginCooldownSec))) normalized.autoMarginCooldownSec = 300;
  }

  return normalized;
}

function mapDraftTemplateToPreviewContext(
  input: z.infer<typeof gridTemplateCreateSchema>
): z.infer<typeof gridTemplateCreateSchema> {
  const normalized = normalizeTemplatePolicyInput({
    ...input,
    symbol: normalizeTemplateSymbol(input.symbol)
  });
  const parsed = gridTemplateCreateSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`draft_template_invalid:${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }
  return parsed.data;
}

type GridPreviewComputationInput = {
  userId: string;
  exchangeAccountId?: string | null;
  exchange?: string | null;
  template: any;
  autoReservePolicy?: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
  autoReserveFixedGridPct?: number | null;
  autoReserveTargetLiqDistancePct?: number | null;
  autoReserveMaxPreviewIterations?: number | null;
  activeOrderWindowSize?: number | null;
  recenterDriftLevels?: number | null;
  investUsd: number;
  extraMarginUsd: number;
  autoMarginEnabled: boolean;
  tpPct: number | null;
  slPrice: number | null;
  triggerPrice: number | null;
  markPriceOverride?: number | null;
  leverage: number;
  slippagePct: number;
  resolveVenueContext: RegisterGridRoutesDeps["resolveVenueContext"];
};

type GridPreviewComputationOutput = {
  markPrice: number;
  minInvestmentUSDT: number;
  preview: Awaited<ReturnType<typeof requestGridPreview>>;
  warnings: string[];
  minInvestmentBreakdown: {
    long: number;
    short: number;
    seed: number;
    total: number;
  };
  initialSeed: {
    enabled: boolean;
    seedPct: number;
    seedSide: "buy" | "sell" | null;
    seedQty: number;
    seedNotionalUsd: number;
    seedMarginUsd: number;
    seedMinMarginUsd: number;
  };
  allocation: {
    totalBudgetUsd: number;
    gridInvestUsd: number;
    extraMarginUsd: number;
    splitMode: "manual" | "auto_fixed_ratio" | "auto_liq_guard_dynamic";
    policy: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
    targetLiqDistancePct: number | null;
    searchIterationsUsed: number;
    insufficient: boolean;
    reasonCodes: string[];
  };
  venueContext: Awaited<ReturnType<RegisterGridRoutesDeps["resolveVenueContext"]>>;
};

async function computeGridPreviewAndAllocation(
  input: GridPreviewComputationInput
): Promise<GridPreviewComputationOutput> {
  const allocationMode = String(input.template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(input.template.budgetSplitPolicy ?? "FIXED_50_50");
  const longBudgetPct = Number.isFinite(Number(input.template.longBudgetPct)) ? Number(input.template.longBudgetPct) : 50;
  const shortBudgetPct = Number.isFinite(Number(input.template.shortBudgetPct)) ? Number(input.template.shortBudgetPct) : 50;
  const autoReservePolicy = (String(
    input.autoReservePolicy ?? input.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"
  ) === "FIXED_RATIO" ? "FIXED_RATIO" : "LIQ_GUARD_MAX_GRID") as "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
  const autoReserveFixedGridPct = Number.isFinite(Number(input.autoReserveFixedGridPct ?? input.template.autoReserveFixedGridPct))
    ? Number(input.autoReserveFixedGridPct ?? input.template.autoReserveFixedGridPct)
    : 70;
  const autoReserveMaxPreviewIterations = Number.isFinite(Number(input.autoReserveMaxPreviewIterations ?? input.template.autoReserveMaxPreviewIterations))
    ? Math.max(1, Math.min(16, Math.trunc(Number(input.autoReserveMaxPreviewIterations ?? input.template.autoReserveMaxPreviewIterations))))
    : 8;
  const initialSeedEnabled = typeof (input.template.initialSeedEnabled) === "boolean"
    ? Boolean(input.template.initialSeedEnabled)
    : true;
  const initialSeedPct = Number.isFinite(Number(input.template.initialSeedPct))
    ? Math.max(0, Math.min(60, Number(input.template.initialSeedPct)))
    : 30;
  const activeOrderWindowSize = Number.isFinite(Number(input.activeOrderWindowSize ?? input.template.activeOrderWindowSize))
    ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize ?? input.template.activeOrderWindowSize))))
    : 100;
  const recenterDriftLevels = Number.isFinite(Number(input.recenterDriftLevels ?? input.template.recenterDriftLevels))
    ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels ?? input.template.recenterDriftLevels))))
    : 1;

  const venueContext = await input.resolveVenueContext({
    userId: input.userId,
    exchangeAccountId: input.exchangeAccountId,
    exchange: input.exchange ?? null,
    symbol: input.template.symbol
  });
  const effectiveMarkPrice = resolvePositiveMarkPrice({
    override: input.markPriceOverride,
    venueMarkPrice: Number(venueContext.markPrice),
    lowerPrice: input.template.lowerPrice,
    upperPrice: input.template.upperPrice
  });

  const totalBudgetUsd = input.autoMarginEnabled
    ? toTwoDecimals(input.investUsd)
    : toTwoDecimals(input.investUsd + input.extraMarginUsd);
  const targetLiqDistancePct = Number.isFinite(Number(input.autoReserveTargetLiqDistancePct ?? input.template.autoReserveTargetLiqDistancePct))
    ? Number(input.autoReserveTargetLiqDistancePct ?? input.template.autoReserveTargetLiqDistancePct)
    : Number(venueContext.liqDistanceMinPct);

  const runPreview = (gridInvestUsd: number, extraMarginUsd: number) =>
    requestGridPreview({
      mode: input.template.mode,
      gridMode: input.template.gridMode,
      lowerPrice: input.template.lowerPrice,
      upperPrice: input.template.upperPrice,
      gridCount: input.template.gridCount,
      activeOrderWindowSize,
      recenterDriftLevels,
      investUsd: gridInvestUsd,
      leverage: input.leverage,
      markPrice: effectiveMarkPrice,
      slippagePct: input.slippagePct,
      tpPct: input.tpPct,
      slPrice: input.slPrice,
      triggerPrice: input.triggerPrice,
      trailingEnabled: false,
      allocationMode,
      budgetSplitPolicy,
      longBudgetPct,
      shortBudgetPct,
      venueConstraints: venueContext.venueConstraints,
      feeBufferPct: venueContext.feeBufferPct,
      mmrPct: venueContext.mmrPct,
      extraMarginUsd,
      initialSeedEnabled,
      initialSeedPct
    });

  const firstPassPreview = await runPreview(
    input.autoMarginEnabled ? totalBudgetUsd : input.investUsd,
    input.autoMarginEnabled ? 0 : input.extraMarginUsd
  );

  const minInvestmentUSDT = Number(firstPassPreview.minInvestmentUSDT ?? 0);
  let allocation: GridPreviewComputationOutput["allocation"] = {
    totalBudgetUsd,
    gridInvestUsd: toTwoDecimals(input.investUsd),
    extraMarginUsd: toTwoDecimals(input.extraMarginUsd),
    splitMode: "manual",
    policy: null,
    targetLiqDistancePct: null,
    searchIterationsUsed: 0,
    insufficient: false,
    reasonCodes: []
  };

  if (input.autoMarginEnabled) {
    if (autoReservePolicy === "FIXED_RATIO") {
      const split = computeAutoMarginAllocation({
        totalBudgetUsd,
        minInvestmentUSDT,
        ratioGrid: autoReserveFixedGridPct / 100
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_fixed_ratio",
        policy: "FIXED_RATIO",
        targetLiqDistancePct: null,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    } else {
      const split = await computeAutoReserveAllocationDynamic({
        totalBudgetUsd,
        minInvestmentUSDT,
        targetLiqDistancePct,
        maxIterations: autoReserveMaxPreviewIterations,
        evaluateGridInvestment: async (gridInvestUsd) => {
          const preview = await runPreview(gridInvestUsd, toTwoDecimals(totalBudgetUsd - gridInvestUsd));
          return {
            worstCaseLiqDistancePct: preview.worstCaseLiqDistancePct
          };
        }
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_liq_guard_dynamic",
        policy: "LIQ_GUARD_MAX_GRID",
        targetLiqDistancePct: split.targetLiqDistancePct,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    }
  }

  const finalPreview = await runPreview(
    allocation.gridInvestUsd,
    allocation.extraMarginUsd
  );

  return {
    markPrice: effectiveMarkPrice,
    minInvestmentUSDT,
    preview: finalPreview,
    warnings: [...(finalPreview.warnings ?? []), ...(venueContext.warnings ?? [])],
    minInvestmentBreakdown: {
      long: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.long)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.long) : 0,
      short: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.short)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.short) : 0,
      seed: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.seed)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.seed) : 0,
      total: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.total)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.total) : minInvestmentUSDT
    },
    initialSeed: {
      enabled: Boolean((finalPreview as any)?.initialSeed?.enabled),
      seedPct: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedPct)) ? Number((finalPreview as any)?.initialSeed?.seedPct) : 0,
      seedSide: (String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "sell"
        ? "sell"
        : String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "buy"
          ? "buy"
          : null) as "buy" | "sell" | null,
      seedQty: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedQty)) ? Number((finalPreview as any)?.initialSeed?.seedQty) : 0,
      seedNotionalUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedNotionalUsd)) ? Number((finalPreview as any)?.initialSeed?.seedNotionalUsd) : 0,
      seedMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMarginUsd) : 0,
      seedMinMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd) : 0,
    },
    allocation,
    venueContext
  };
}

type RegisterGridRoutesDeps = {
  db: any;
  requireSuperadmin: (res: express.Response) => Promise<boolean>;
  enqueueBotRun: (botId: string) => Promise<void>;
  cancelBotRun: (botId: string) => Promise<void>;
  vaultService: VaultService;
  executionOrchestrator?: ExecutionProviderOrchestrator | null;
  resolveVenueContext: (params: {
    userId: string;
    exchangeAccountId?: string | null;
    exchange?: string | null;
    symbol: string;
  }) => Promise<{
    markPrice: number;
    marketDataVenue: string;
    venueConstraints: {
      minQty: number | null;
      qtyStep: number | null;
      priceTick: number | null;
      minNotional: number | null;
      feeRate: number | null;
    };
    feeBufferPct: number;
    mmrPct: number;
    liqDistanceMinPct: number;
    warnings: string[];
  }>;
};

async function loadGridInstanceForUser(params: {
  db: any;
  userId: string;
  instanceId: string;
}) {
  const row = await params.db.gridBotInstance.findFirst({
    where: {
      id: params.instanceId,
      userId: params.userId
    },
    include: {
      template: true,
      bot: {
        include: {
          futuresConfig: true,
          exchangeAccount: {
            select: {
              id: true,
              exchange: true,
              label: true
            }
          }
        }
      }
    }
  });
  if (!row) return row;
  const vaultByInstanceId = await loadBotVaultByInstanceIds(params.db, [row.id]);
  return {
    ...row,
    botVault: vaultByInstanceId.get(row.id) ?? null
  };
}

async function loadBotVaultByInstanceIds(db: any, instanceIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!instanceIds.length) return map;
  const botVaultModel = db?.botVault;
  if (!botVaultModel || typeof botVaultModel.findMany !== "function") return map;
  try {
    const rows = await botVaultModel.findMany({
      where: {
        gridInstanceId: {
          in: instanceIds
        }
      }
    });
    for (const row of rows) {
      const key = String(row?.gridInstanceId ?? "");
      if (!key) continue;
      map.set(key, row);
    }
  } catch {
    // Optional compatibility fallback: older Prisma clients may not expose BotVault yet.
  }
  return map;
}

function mapGridTemplateRow(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? null,
    symbol: row.symbol,
    marketType: row.marketType,
    mode: row.mode,
    gridMode: row.gridMode,
    allocationMode: row.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : 50,
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : 50,
    marginPolicy: row.marginPolicy ?? (row.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean" ? row.initialSeedEnabled : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct)) ? Number(row.initialSeedPct) : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize)) ? Math.trunc(Number(row.activeOrderWindowSize)) : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels)) ? Math.trunc(Number(row.recenterDriftLevels)) : 1,
    lowerPrice: row.lowerPrice,
    upperPrice: row.upperPrice,
    gridCount: row.gridCount,
    leverageMin: row.leverageMin,
    leverageMax: row.leverageMax,
    leverageDefault: row.leverageDefault,
    investMaxUsd: row.investMaxUsd,
    investDefaultUsd: row.investDefaultUsd,
    slippageDefaultPct: row.slippageDefaultPct,
    slippageMinPct: row.slippageMinPct,
    slippageMaxPct: row.slippageMaxPct,
    tpDefaultPct: row.tpDefaultPct ?? null,
    slDefaultPrice: row.slDefaultPrice ?? null,
    allowAutoMargin: row.allowAutoMargin,
    allowManualMarginAdjust: row.allowManualMarginAdjust,
    allowProfitWithdraw: row.allowProfitWithdraw,
    isPublished: row.isPublished,
    isArchived: row.isArchived,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapGridInstanceRow(
  row: any,
  options?: {
    includeProviderMetadataRaw?: boolean;
    currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
  }
) {
  const botVault = row.botVault
    ? mapBotVaultSnapshot(row.botVault, { includeProviderMetadataRaw: options?.includeProviderMetadataRaw })
    : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    exchangeAccountId: row.exchangeAccountId,
    templateId: row.templateId,
    botId: row.botId,
    state: row.state,
    isArchived: String(row.state ?? "").trim().toLowerCase() === "archived",
    archivedAt: row.archivedAt ?? null,
    archivedReason: row.archivedReason ?? null,
    restartable: String(row.state ?? "").trim().toLowerCase() !== "archived",
    allocationMode: row.allocationMode ?? row.template?.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? row.template?.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : Number(row.template?.longBudgetPct ?? 50),
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : Number(row.template?.shortBudgetPct ?? 50),
    marginPolicy: row.marginPolicy ?? row.template?.marginPolicy ?? (row.template?.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    marginMode: row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : Number.isFinite(Number(row.template?.autoMarginMaxUSDT)) ? Number(row.template?.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? row.template?.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : Number.isFinite(Number(row.template?.autoMarginTriggerValue)) ? Number(row.template?.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : Number.isFinite(Number(row.template?.autoMarginStepUSDT)) ? Number(row.template?.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : Number.isFinite(Number(row.template?.autoMarginCooldownSec)) ? Number(row.template?.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? row.template?.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : Number.isFinite(Number(row.template?.autoReserveFixedGridPct)) ? Number(row.template?.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : Number.isFinite(Number(row.template?.autoReserveTargetLiqDistancePct)) ? Number(row.template?.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : Number.isFinite(Number(row.template?.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.template?.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean"
      ? row.initialSeedEnabled
      : typeof row.template?.initialSeedEnabled === "boolean"
        ? row.template.initialSeedEnabled
        : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct))
      ? Number(row.initialSeedPct)
      : Number.isFinite(Number(row.template?.initialSeedPct))
        ? Number(row.template.initialSeedPct)
        : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize))
      ? Math.trunc(Number(row.activeOrderWindowSize))
      : Number.isFinite(Number(row.template?.activeOrderWindowSize))
        ? Math.trunc(Number(row.template?.activeOrderWindowSize))
        : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels))
      ? Math.trunc(Number(row.recenterDriftLevels))
      : Number.isFinite(Number(row.template?.recenterDriftLevels))
        ? Math.trunc(Number(row.template?.recenterDriftLevels))
        : 1,
    autoMarginUsedUSDT: Number.isFinite(Number(row.autoMarginUsedUSDT)) ? Number(row.autoMarginUsedUSDT) : 0,
    lastAutoMarginAt: row.lastAutoMarginAt ?? null,
    investUsd: row.investUsd,
    leverage: row.leverage,
    extraMarginUsd: row.extraMarginUsd,
    triggerPrice: row.triggerPrice ?? null,
    slippagePct: row.slippagePct,
    tpPct: row.tpPct ?? null,
    slPrice: row.slPrice ?? null,
    autoMarginEnabled: row.autoMarginEnabled,
    stateJson: row.stateJson ?? {},
    metricsJson: row.metricsJson ?? {},
    lastPlanAt: row.lastPlanAt ?? null,
    lastPlanError: row.lastPlanError ?? null,
    lastPlanVersion: row.lastPlanVersion ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    botVault,
    pilotStatus: buildGridPilotStatus({
      botVault: botVault ? (botVault as Record<string, unknown>) : null,
      currentPilotAccess: options?.currentPilotAccess ?? null
    }),
    template: row.template ? mapGridTemplateRow(row.template) : null,
    bot: row.bot
      ? {
          id: row.bot.id,
          name: row.bot.name,
          symbol: row.bot.symbol,
          status: row.bot.status,
          exchange: row.bot.exchange,
          exchangeAccount: row.bot.exchangeAccount
            ? {
                id: row.bot.exchangeAccount.id,
                exchange: row.bot.exchangeAccount.exchange,
                label: row.bot.exchangeAccount.label
              }
            : null
        }
      : null
  };
}

export function registerGridRoutes(app: Express, deps: RegisterGridRoutesDeps) {
  const allowedGridExchanges = readAllowedGridExchanges();

  function isAdminGridDraftPreviewExchangeAllowed(exchange: unknown): boolean {
    const normalized = normalizeGridExchange(exchange);
    return allowedGridExchanges.has(normalized) || normalized === "hyperliquid";
  }

  async function readPaperSymbolState(params: {
    exchangeAccountId: string;
    symbol: string;
  }): Promise<{
    positions: Array<Record<string, unknown>>;
    openOrders: Array<Record<string, unknown>>;
  }> {
    const key = `paper.state:${params.exchangeAccountId}`;
    const row = await deps.db.globalSetting.findUnique({
      where: { key },
      select: { value: true }
    });
    const state = asRecord(row?.value);
    const normalizedSymbol = normalizeTemplateSymbol(params.symbol);
    const positions = Array.isArray(state.positions)
      ? state.positions.filter((entry) => normalizeTemplateSymbol(asRecord(entry).symbol as string) === normalizedSymbol).map(asRecord)
      : [];
    const openOrders = Array.isArray(state.orders)
      ? state.orders
          .filter((entry) => {
            const item = asRecord(entry);
            return normalizeTemplateSymbol(item.symbol as string) === normalizedSymbol
              && String(item.status ?? "").trim().toLowerCase() === "open";
          })
          .map(asRecord)
      : [];
    return { positions, openOrders };
  }

  async function startGridInstanceNow(params: {
    row: any;
    userId: string;
  }): Promise<{ id: string; state: "running"; botId: string }> {
    const row = params.row;
    const previousState = String(row.state ?? "").trim().toLowerCase();
    if (String(row.state ?? "").trim().toLowerCase() === "archived") {
      throw new ManualTradingError("grid instance is archived", 409, "grid_instance_archived_not_restartable");
    }
    const allowed = ensureGridExchangeAllowed({
      exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? "",
      allowedExchanges: allowedGridExchanges
    });
    if (!allowed.ok) {
      throw new ManualTradingError(`exchange ${allowed.exchange} is not allowed for grid`, 400, "grid_exchange_not_allowed");
    }

    const exchangeKey = normalizeGridExchange(row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? "");
    const botSymbol = normalizeTemplateSymbol(row.template.symbol);
    if (exchangeKey === "paper") {
      const paperState = await readPaperSymbolState({
        exchangeAccountId: row.exchangeAccountId,
        symbol: botSymbol
      });
      const previousStateIsFresh = previousState === "created" || !previousState;
      const foreignOpenOrders = paperState.openOrders.filter((entry) => {
        const clientOrderId = String(entry.clientOrderId ?? "").trim();
        return !clientOrderId.startsWith(`grid-${row.id}-`);
      });
      if (previousStateIsFresh && (paperState.positions.length > 0 || paperState.openOrders.length > 0)) {
        throw new ManualTradingError(
          `paper symbol ${botSymbol} is not clean for a fresh grid start`,
          409,
          "grid_paper_symbol_not_clean"
        );
      }
      if (!previousStateIsFresh && foreignOpenOrders.length > 0) {
        throw new ManualTradingError(
          `paper symbol ${botSymbol} has foreign open orders`,
          409,
          "grid_paper_symbol_conflict"
        );
      }
    }

    const venueContext = await deps.resolveVenueContext({
      userId: params.userId,
      exchangeAccountId: row.exchangeAccountId,
      exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? null,
      symbol: row.template.symbol
    });
    const safeMarkPrice = resolvePositiveMarkPrice({
      venueMarkPrice: Number(venueContext.markPrice),
      lowerPrice: Number(row.template.lowerPrice),
      upperPrice: Number(row.template.upperPrice)
    });
    const preview = await requestGridPreview({
      mode: row.template.mode,
      gridMode: row.template.gridMode,
      allocationMode: row.allocationMode ?? row.template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
      budgetSplitPolicy: row.budgetSplitPolicy ?? row.template.budgetSplitPolicy ?? "FIXED_50_50",
      longBudgetPct: row.longBudgetPct ?? row.template.longBudgetPct ?? 50,
      shortBudgetPct: row.shortBudgetPct ?? row.template.shortBudgetPct ?? 50,
      lowerPrice: row.template.lowerPrice,
      upperPrice: row.template.upperPrice,
      gridCount: row.template.gridCount,
      activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
      recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
      investUsd: row.investUsd,
      leverage: row.leverage,
      markPrice: safeMarkPrice,
      slippagePct: row.slippagePct,
      tpPct: row.tpPct,
      slPrice: row.slPrice,
      triggerPrice: row.triggerPrice,
      trailingEnabled: false,
      venueConstraints: venueContext.venueConstraints,
      feeBufferPct: venueContext.feeBufferPct,
      mmrPct: venueContext.mmrPct,
      extraMarginUsd: row.extraMarginUsd,
      initialSeedEnabled: row.initialSeedEnabled ?? row.template.initialSeedEnabled ?? true,
      initialSeedPct: row.initialSeedPct ?? row.template.initialSeedPct ?? 30
    });
    const minInvestmentUSDT = Number(preview.minInvestmentUSDT ?? 0);
    if (Number.isFinite(minInvestmentUSDT) && minInvestmentUSDT > 0 && row.investUsd + 1e-9 < minInvestmentUSDT) {
      throw new ManualTradingError("grid invest below minimum", 400, "grid_instance_invest_below_minimum");
    }

    const nextStateJson = (() => {
      const base = asRecord(row.stateJson);
      if (previousState === "paused" || previousState === "stopped" || previousState === "error") {
        return { ...base, initialSeedNeedsReseed: true };
      }
      return base;
    })();
    await deps.db.$transaction([
      deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: { state: "running", archivedAt: null, archivedReason: null, stateJson: nextStateJson }
      }),
      deps.db.bot.update({ where: { id: row.botId }, data: { status: "running", lastError: null } })
    ]);

    await deps.vaultService.activateBotVaultForGridInstance({
      userId: params.userId,
      gridInstanceId: String(row.id)
    });
    return { id: row.id, state: "running", botId: row.botId };
  }

  async function archiveGridInstance(params: {
    row: any;
    userId: string;
    reason: string;
    closeSourceType: string;
  }): Promise<{ id: string; state: "archived"; botId: string; alreadyArchived: boolean }> {
    const row = params.row;
    if (String(row.state ?? "").trim().toLowerCase() === "archived") {
      return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: true };
    }
    await deps.db.$transaction([
      deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: {
          state: "archived",
          archivedAt: new Date(),
          archivedReason: params.reason
        }
      }),
      deps.db.bot.update({ where: { id: row.botId }, data: { status: "stopped" } })
    ]);

    await deps.vaultService.setBotVaultCloseOnlyForGridInstance({
      userId: params.userId,
      gridInstanceId: String(row.id)
    });
    await deps.vaultService.closeBotVaultForGridInstance({
      userId: params.userId,
      gridInstanceId: String(row.id),
      idempotencyKey: `grid_instance:${row.id}:close:v2:${params.reason}`,
      metadata: {
        sourceType: params.closeSourceType
      }
    });
    return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: false };
  }

  app.get("/admin/grid/templates", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = gridTemplateListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    try {
      const rows = await deps.db.gridBotTemplate.findMany({
        where: {
          ...(parsed.data.published !== undefined ? { isPublished: parsed.data.published } : {}),
          ...(parsed.data.archived !== undefined ? { isArchived: parsed.data.archived } : {}),
          ...(parsed.data.symbol ? { symbol: normalizeTemplateSymbol(parsed.data.symbol) } : {}),
          ...(parsed.data.mode ? { mode: parsed.data.mode } : {})
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      return res.json({ items: rows.map(mapGridTemplateRow) });
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({ error: "grid_schema_not_ready" });
      }
      return res.status(500).json({ error: "grid_template_list_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const normalizedInput = normalizeTemplatePolicyInput((req.body ?? {}) as Record<string, unknown>);
    const parsed = gridTemplateCreateSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (!isTemplatePolicyImplemented(parsed.data)) {
      return res.status(400).json({
        error: "grid_policy_not_implemented",
        reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
      });
    }

    const user = getUserFromLocals(res);
    try {
      const membership = await deps.db.workspaceMember.findFirst({
        where: { userId: user.id },
        select: { workspaceId: true }
      });
      if (!membership?.workspaceId) {
        return res.status(400).json({ error: "workspace_not_found" });
      }

      const row = await deps.db.gridBotTemplate.create({
        data: {
          workspaceId: membership.workspaceId,
          createdByUserId: user.id,
          ...parsed.data,
          symbol: normalizeTemplateSymbol(parsed.data.symbol)
        }
      });
      return res.status(201).json(mapGridTemplateRow(row));
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({ error: "grid_schema_not_ready" });
      }
      return res.status(500).json({ error: "grid_template_create_failed", reason: String(error) });
    }
  });

  app.put("/admin/grid/templates/:id", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = gridTemplateUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const existing = await deps.db.gridBotTemplate.findUnique({
        where: { id: req.params.id }
      });
      if (!existing) return res.status(404).json({ error: "grid_template_not_found" });
      const mergedPayload = normalizeTemplatePolicyInput({
        ...existing,
        ...(parsed.data as Record<string, unknown>)
      });
      const mergedParsed = gridTemplateCreateSchema.safeParse(mergedPayload);
      if (!mergedParsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: mergedParsed.error.flatten() });
      }
      if (!isTemplatePolicyImplemented(mergedParsed.data)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }
      const nextTemplate = mergedParsed.data;
      const row = await deps.db.gridBotTemplate.update({
        where: { id: req.params.id },
        data: {
          ...nextTemplate,
          symbol: normalizeTemplateSymbol(nextTemplate.symbol)
        }
      });
      return res.json(mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_update_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/publish", requireAuth, async (_req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const row = await deps.db.gridBotTemplate.update({
        where: { id: _req.params.id },
        data: { isPublished: true, isArchived: false }
      });
      return res.json(mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_publish_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/archive", requireAuth, async (_req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const row = await deps.db.gridBotTemplate.update({
        where: { id: _req.params.id },
        data: { isArchived: true, isPublished: false }
      });
      return res.json(mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_archive_failed", reason: String(error) });
    }
  });

  app.delete("/admin/grid/templates/:id", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const instanceCount = await deps.db.gridBotInstance.count({
        where: { templateId: req.params.id }
      });
      if (instanceCount > 0) {
        return res.status(409).json({
          error: "grid_template_in_use",
          instanceCount
        });
      }
      await deps.db.gridBotTemplate.delete({ where: { id: req.params.id } });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_delete_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/draft-preview", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = gridTemplateDraftPreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const account = await deps.db.exchangeAccount.findFirst({
        where: {
          id: parsed.data.previewInput.exchangeAccountId,
          userId: user.id
        }
      });
      if (!account) return res.status(404).json({ error: "exchange_account_not_found" });
      const pilotAccess = await resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email
      });
      {
        if (!isAdminGridDraftPreviewExchangeAllowed(account.exchange)) {
          const allowed = ensureGridExchangeAllowed({
            exchange: account.exchange,
            allowedExchanges: new Set([...allowedGridExchanges, "hyperliquid"])
          });
          const blockedExchange = normalizeGridExchange(account.exchange);
          const allowedExchanges = "allowedExchanges" in allowed
            ? allowed.allowedExchanges
            : [...allowedGridExchanges, "hyperliquid"];
          return res.status(400).json({
            error: "grid_exchange_not_allowed",
            exchange: blockedExchange,
            allowedExchanges
          });
        }
      }

      const template = mapDraftTemplateToPreviewContext(parsed.data.draftTemplate);
      if (!isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.previewInput.marginMode
        ?? (parsed.data.previewInput.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }
      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }

      const computed = await computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: account.id,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.previewInput.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.previewInput.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.previewInput.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.previewInput.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.previewInput.triggerPrice ?? null,
        markPriceOverride: parsed.data.previewInput.markPriceOverride ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      const minLiqDistancePct = Number.isFinite(Number(computed.preview.liqDistanceMinPct))
        ? Number(computed.preview.liqDistanceMinPct)
        : Number(computed.venueContext.liqDistanceMinPct);
      const worstCaseLiqDistancePct = Number.isFinite(Number(computed.preview.worstCaseLiqDistancePct))
        ? Number(computed.preview.worstCaseLiqDistancePct)
        : null;
      const liqRisk = worstCaseLiqDistancePct !== null && worstCaseLiqDistancePct < minLiqDistancePct;
      const insufficient = Boolean(computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT);
      const statusCodeSet = new Set<string>(computed.allocation.reasonCodes ?? []);
      if (insufficient) statusCodeSet.add("insufficient_budget");
      if (liqRisk) statusCodeSet.add("liq_distance_below_threshold");

      return res.json({
        markPrice: computed.markPrice,
        marketDataVenue: computed.venueContext.marketDataVenue,
        minInvestmentUSDT: computed.minInvestmentUSDT,
        minInvestmentBreakdown: computed.minInvestmentBreakdown,
        initialSeed: computed.initialSeed,
        marginMode: requestedMarginMode,
        allocation: computed.allocation,
        allocationBreakdown: (computed.preview as any).allocationBreakdown ?? null,
        qtyModel: (computed.preview as any).qtyModel ?? null,
        venueChecks: (computed.preview as any).venueChecks ?? null,
        windowMeta: (computed.preview as any).windowMeta ?? null,
        profitPerGridEstimateUSDT: Number((computed.preview as any).profitPerGridEstimateUSDT ?? computed.preview.profitPerGridNetUsd ?? 0),
        liq: {
          liqEstimateLong: computed.preview.liqEstimateLong ?? null,
          liqEstimateShort: computed.preview.liqEstimateShort ?? null,
          worstCaseLiqPrice: computed.preview.worstCaseLiqPrice ?? null,
          worstCaseLiqDistancePct,
          liqDistanceMinPct: minLiqDistancePct
        },
        warnings: computed.warnings,
        status: {
          ready: !insufficient && !liqRisk,
          codes: [...statusCodeSet]
        },
        pilotAccess
      });
    } catch (error) {
      if (error instanceof ManualTradingError) {
        return res.status(error.status).json({ error: error.code, reason: error.message });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/preview", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = gridTemplatePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const template = await deps.db.gridBotTemplate.findUnique({ where: { id: req.params.id } });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      if (!isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const preview = await requestGridPreview({
        mode: template.mode,
        gridMode: template.gridMode,
        allocationMode: template.allocationMode,
        budgetSplitPolicy: template.budgetSplitPolicy,
        longBudgetPct: template.longBudgetPct,
        shortBudgetPct: template.shortBudgetPct,
        lowerPrice: template.lowerPrice,
        upperPrice: template.upperPrice,
        gridCount: template.gridCount,
        activeOrderWindowSize: template.activeOrderWindowSize ?? 100,
        recenterDriftLevels: template.recenterDriftLevels ?? 1,
        investUsd: parsed.data.investUsd,
        leverage: parsed.data.leverage,
        markPrice: parsed.data.markPrice,
        slippagePct: parsed.data.slippagePct ?? template.slippageDefaultPct,
        tpPct: parsed.data.tpPct,
        slPrice: parsed.data.slPrice,
        triggerPrice: parsed.data.triggerPrice,
        trailingEnabled: parsed.data.trailingEnabled ?? false,
        initialSeedEnabled: template.initialSeedEnabled ?? true,
        initialSeedPct: template.initialSeedPct ?? 30
      });

      return res.json({ template: mapGridTemplateRow(template), preview });
    } catch (error) {
      const reason = String(error);
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason });
    }
  });

  app.get("/grid/templates", requireAuth, async (_req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    try {
      const rows = await deps.db.gridBotTemplate.findMany({
        where: {
          isPublished: true,
          isArchived: false
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      return res.json({ items: rows.map(mapGridTemplateRow) });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_list_failed", reason: String(error) });
    }
  });

  app.get("/grid/pilot-access", requireAuth, async (_req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    const [pilotAccess, executionContext] = await Promise.all([
      resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email
      }),
      getGridHyperliquidExecutionContext(deps.db)
    ]);
    return res.json({
      ...pilotAccess,
      provider: executionContext.provider,
      allowLiveHyperliquid: executionContext.allowLiveHyperliquid,
      globalAccountConfigured: executionContext.globalAccountConfigured
    });
  });

  app.post("/grid/templates/:id/instance-preview", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridInstancePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const [pilotAccess, executionContext] = await Promise.all([
        resolveGridHyperliquidPilotAccess(deps.db, {
          userId: user.id,
          email: user.email
        }),
        getGridHyperliquidExecutionContext(deps.db)
      ]);
      const allowHyperliquid = pilotAccess.allowed || executionContext.allowLiveHyperliquid;
      const template = await deps.db.gridBotTemplate.findFirst({
        where: {
          id: req.params.id,
          isPublished: true,
          isArchived: false
        }
      });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      const executionTarget = await resolveGridExecutionTarget({
        deps,
        userId: user.id,
        exchangeAccountId: parsed.data.exchangeAccountId,
        symbol: String(template.symbol ?? ""),
        allowHyperliquid
      });
      if (executionTarget.kind === "exchange_account" && executionTarget.usesHyperliquid && !allowHyperliquid) {
        return sendGridHyperliquidPilotRequired(
          res,
          pilotAccess,
          executionTarget.exchangeAccountId,
          executionTarget.marketDataVenue ?? "hyperliquid"
        );
      }
      if (!isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.marginMode ?? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }
      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }

      const computed = await computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: executionTarget.exchangeAccountId,
        exchange: executionTarget.exchange,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.triggerPrice ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
        return res.status(400).json({
          error: "grid_instance_invest_below_minimum",
          requiredMinInvestmentUSDT: computed.minInvestmentUSDT,
          minInvestmentBreakdown: computed.minInvestmentBreakdown,
          initialSeed: computed.initialSeed,
          currentInvestUsd: parsed.data.investUsd,
          symbol: template.symbol,
          markPrice: computed.markPrice,
          allocation: computed.allocation,
          windowMeta: (computed.preview as any).windowMeta ?? null,
          liq: {
            liqEstimateLong: computed.preview.liqEstimateLong ?? null,
            liqEstimateShort: computed.preview.liqEstimateShort ?? null,
            worstCaseLiqPrice: computed.preview.worstCaseLiqPrice ?? null,
            worstCaseLiqDistancePct: computed.preview.worstCaseLiqDistancePct ?? null,
            liqDistanceMinPct: computed.preview.liqDistanceMinPct ?? computed.venueContext.liqDistanceMinPct
          },
          warnings: computed.warnings
        });
      }

      return res.json({
        markPrice: computed.markPrice,
        marketDataVenue: computed.venueContext.marketDataVenue,
        pilotAccess: {
          ...pilotAccess,
          provider: executionContext.provider,
          allowLiveHyperliquid: executionContext.allowLiveHyperliquid,
          globalAccountConfigured: executionContext.globalAccountConfigured
        },
        minInvestmentUSDT: computed.minInvestmentUSDT,
        minInvestmentBreakdown: computed.minInvestmentBreakdown,
        initialSeed: computed.initialSeed,
        marginMode: requestedMarginMode,
        allocation: computed.allocation,
        allocationBreakdown: (computed.preview as any).allocationBreakdown ?? null,
        qtyModel: (computed.preview as any).qtyModel ?? null,
        windowMeta: (computed.preview as any).windowMeta ?? null,
        profitPerGridEstimateUSDT: Number((computed.preview as any).profitPerGridEstimateUSDT ?? computed.preview.profitPerGridNetUsd ?? 0),
        liq: {
          liqEstimateLong: computed.preview.liqEstimateLong ?? null,
          liqEstimateShort: computed.preview.liqEstimateShort ?? null,
          worstCaseLiqPrice: computed.preview.worstCaseLiqPrice ?? null,
          worstCaseLiqDistancePct: computed.preview.worstCaseLiqDistancePct ?? null,
          liqDistanceMinPct: computed.preview.liqDistanceMinPct ?? computed.venueContext.liqDistanceMinPct
        },
        warnings: computed.warnings
      });
    } catch (error) {
      if (error instanceof ManualTradingError) {
        return res.status(error.status).json({ error: error.code, reason: error.message });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason: String(error) });
    }
  });

  app.post("/grid/templates/:id/instances", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridInstanceCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const [pilotAccess, executionContext] = await Promise.all([
        resolveGridHyperliquidPilotAccess(deps.db, {
          userId: user.id,
          email: user.email
        }),
        getGridHyperliquidExecutionContext(deps.db)
      ]);
      const allowHyperliquid = pilotAccess.allowed || executionContext.allowLiveHyperliquid;
      const template = await deps.db.gridBotTemplate.findFirst({
        where: {
          id: req.params.id,
          isPublished: true,
          isArchived: false
        }
      });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      const executionTarget = await resolveGridExecutionTarget({
        deps,
        userId: user.id,
        exchangeAccountId: parsed.data.exchangeAccountId,
        symbol: String(template.symbol ?? ""),
        allowHyperliquid
      });
      if (executionTarget.kind === "exchange_account" && executionTarget.usesHyperliquid && !allowHyperliquid) {
        return sendGridHyperliquidPilotRequired(
          res,
          pilotAccess,
          executionTarget.exchangeAccountId,
          executionTarget.marketDataVenue ?? "hyperliquid"
        );
      }
      if (!isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const workspaceMember = await deps.db.workspaceMember.findFirst({
        where: {
          userId: user.id,
          workspaceId: template.workspaceId
        }
      });
      if (!workspaceMember) {
        return res.status(403).json({ error: "workspace_access_denied" });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.marginMode ?? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }

      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }

      const computed = await computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: executionTarget.exchangeAccountId,
        exchange: executionTarget.exchange,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.triggerPrice ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
        return res.status(400).json({
          error: "grid_instance_invest_below_minimum",
          requiredMinInvestmentUSDT: computed.minInvestmentUSDT,
          minInvestmentBreakdown: computed.minInvestmentBreakdown,
          initialSeed: computed.initialSeed,
          currentInvestUsd: parsed.data.investUsd,
          symbol: template.symbol,
          markPrice: computed.markPrice,
          allocation: computed.allocation,
          windowMeta: (computed.preview as any).windowMeta ?? null,
          liq: {
            liqEstimateLong: computed.preview.liqEstimateLong ?? null,
            liqEstimateShort: computed.preview.liqEstimateShort ?? null,
            worstCaseLiqPrice: computed.preview.worstCaseLiqPrice ?? null,
            worstCaseLiqDistancePct: computed.preview.worstCaseLiqDistancePct ?? null,
            liqDistanceMinPct: computed.preview.liqDistanceMinPct ?? computed.venueContext.liqDistanceMinPct
          },
          warnings: computed.warnings
        });
      }

      const botName = parsed.data.name?.trim() || `${template.name} (${template.symbol})`;
      let createdInstanceId: string | null = null;
      let createdBotId: string | null = null;
      const created = await deps.db.$transaction(async (tx: any) => {
        const bot = await tx.bot.create({
          data: {
            userId: user.id,
            workspaceId: template.workspaceId,
            exchangeAccountId: executionTarget.exchangeAccountId ?? undefined,
            name: botName,
            symbol: template.symbol,
            exchange: executionTarget.exchange,
            status: "stopped",
            futuresConfig: {
              create: {
                strategyKey: "futures_grid",
                marginMode: "isolated",
                leverage: Math.trunc(fixedLeverage),
                tickMs: 2000,
                paramsJson: {
                  grid: {
                    mode: template.mode,
                    gridMode: template.gridMode,
                    lowerPrice: template.lowerPrice,
                    upperPrice: template.upperPrice,
                    gridCount: template.gridCount,
                    activeOrderWindowSize: Number.isFinite(Number(template.activeOrderWindowSize)) ? Math.trunc(Number(template.activeOrderWindowSize)) : 100,
                    recenterDriftLevels: Number.isFinite(Number(template.recenterDriftLevels)) ? Math.trunc(Number(template.recenterDriftLevels)) : 1
                  }
                }
              }
            }
          },
          include: {
            futuresConfig: true
          }
        });
        createdBotId = String(bot.id);

        const createdInstance = await tx.gridBotInstance.create({
          data: {
            workspaceId: template.workspaceId,
            userId: user.id,
            exchangeAccountId: executionTarget.exchangeAccountId ?? undefined,
            templateId: template.id,
            botId: bot.id,
            state: "created",
            archivedAt: null,
            archivedReason: null,
            allocationMode: template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
            budgetSplitPolicy: template.budgetSplitPolicy ?? "FIXED_50_50",
            longBudgetPct: Number.isFinite(Number(template.longBudgetPct)) ? Number(template.longBudgetPct) : 50,
            shortBudgetPct: Number.isFinite(Number(template.shortBudgetPct)) ? Number(template.shortBudgetPct) : 50,
            marginPolicy: templateMarginPolicy === "AUTO_ALLOWED" ? "AUTO_ALLOWED" : "MANUAL_ONLY",
            marginMode: requestedMarginMode,
            autoMarginMaxUSDT: template.autoMarginMaxUSDT ?? null,
            autoMarginTriggerType: template.autoMarginTriggerType ?? null,
            autoMarginTriggerValue: template.autoMarginTriggerValue ?? null,
            autoMarginStepUSDT: template.autoMarginStepUSDT ?? null,
            autoMarginCooldownSec: template.autoMarginCooldownSec ?? null,
            autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
            autoReserveFixedGridPct: Number.isFinite(Number(template.autoReserveFixedGridPct)) ? Number(template.autoReserveFixedGridPct) : 70,
            autoReserveTargetLiqDistancePct: Number.isFinite(Number(template.autoReserveTargetLiqDistancePct)) ? Number(template.autoReserveTargetLiqDistancePct) : null,
            autoReserveMaxPreviewIterations: Number.isFinite(Number(template.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(template.autoReserveMaxPreviewIterations)) : 8,
            initialSeedEnabled: typeof template.initialSeedEnabled === "boolean" ? template.initialSeedEnabled : true,
            initialSeedPct: Number.isFinite(Number(template.initialSeedPct)) ? Number(template.initialSeedPct) : 30,
            activeOrderWindowSize: Number.isFinite(Number(template.activeOrderWindowSize)) ? Math.trunc(Number(template.activeOrderWindowSize)) : 100,
            recenterDriftLevels: Number.isFinite(Number(template.recenterDriftLevels)) ? Math.trunc(Number(template.recenterDriftLevels)) : 1,
            autoMarginUsedUSDT: 0,
            investUsd: computed.allocation.gridInvestUsd,
            leverage: Math.trunc(fixedLeverage),
            extraMarginUsd: computed.allocation.extraMarginUsd,
            triggerPrice: parsed.data.triggerPrice ?? null,
            slippagePct: fixedSlippagePct,
            tpPct: parsed.data.tpPct ?? template.tpDefaultPct ?? null,
            slPrice: parsed.data.slPrice ?? template.slDefaultPrice ?? null,
            autoMarginEnabled,
            stateJson: {},
            metricsJson: {}
          }
        });
        createdInstanceId = String(createdInstance.id);

        await deps.vaultService.ensureBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: createdInstance.id,
          allocatedUsd: Number(createdInstance.investUsd ?? 0) + Number(createdInstance.extraMarginUsd ?? 0)
        });
        return createdInstance;
      });

      if (!createdInstanceId || !createdBotId || !created) {
        return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_create" });
      }

      try {
        const row = await loadGridInstanceForUser({
          db: deps.db,
          userId: user.id,
          instanceId: createdInstanceId
        });
        if (!row) {
          throw new Error("created_instance_not_found");
        }
        await startGridInstanceNow({
          row,
          userId: user.id
        });
      } catch (startError) {
        try {
          await deps.vaultService.setBotVaultCloseOnlyForGridInstance({
            userId: user.id,
            gridInstanceId: createdInstanceId
          });
          await deps.vaultService.closeBotVaultForGridInstance({
            userId: user.id,
            gridInstanceId: createdInstanceId,
            idempotencyKey: `grid_instance:${createdInstanceId}:rollback_create_start`,
            forceClose: true,
            metadata: { sourceType: "grid_instance_create_rollback" }
          });
        } catch {
          // best effort
        }
        await deps.db.$transaction(async (tx: any) => {
          await tx.botRuntime.deleteMany({ where: { botId: createdBotId } });
          await tx.futuresBotConfig.deleteMany({ where: { botId: createdBotId } });
          await tx.bot.deleteMany({ where: { id: createdBotId } });
        });
        if (startError instanceof ManualTradingError) {
          return res.status(startError.status).json({
            error: "grid_instance_create_rollback_start_failed",
            startError: startError.code,
            reason: startError.message
          });
        }
        const mappedStartRisk = mapRiskErrorToHttp(startError);
        if (mappedStartRisk) {
          return res.status(mappedStartRisk.status).json({
            error: "grid_instance_create_rollback_start_failed",
            startError: mappedStartRisk.code,
            reason: mappedStartRisk.reason
          });
        }
        return res.status(500).json({
          error: "grid_instance_create_rollback_start_failed",
          reason: String(startError)
        });
      }

      const instance = await loadGridInstanceForUser({
        db: deps.db,
        userId: user.id,
        instanceId: createdInstanceId
      });
      if (!instance) {
        return res.status(500).json({ error: "grid_instance_create_failed", reason: "instance_not_found_post_start" });
      }
      return res.status(201).json(mapGridInstanceRow(instance));
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_create_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridInstanceListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const currentPilotAccess = await resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email ?? null
      }).catch(() => null);
      const rows = await deps.db.gridBotInstance.findMany({
        where: {
          userId: user.id,
          ...(parsed.data.exchangeAccountId ? { exchangeAccountId: parsed.data.exchangeAccountId } : {})
        },
        include: {
          template: true,
          bot: {
            include: {
              futuresConfig: true,
              exchangeAccount: {
                select: {
                  id: true,
                  exchange: true,
                  label: true
                }
              }
            }
          }
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      const filteredRows = rows.filter((row: any) => {
        const state = String(row.state ?? "");
        if (parsed.data.state) return state === parsed.data.state;
        if (parsed.data.includeArchived === true) return true;
        return state !== "archived";
      });
      const vaultByInstanceId = await loadBotVaultByInstanceIds(deps.db, filteredRows.map((row: any) => row.id));
      return res.json({
        items: filteredRows.map((row: any) =>
          mapGridInstanceRow({
            ...row,
            botVault: vaultByInstanceId.get(row.id) ?? null
          }, {
            includeProviderMetadataRaw: false,
            currentPilotAccess
          })
        )
      });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_list_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const includeProviderMetadataRaw = await isAdminGridViewer(deps.db, user);
      const currentPilotAccess = await resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email ?? null
      }).catch(() => null);
      const row = await loadGridInstanceForUser({
        db: deps.db,
        userId: user.id,
        instanceId: req.params.id
      });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      let executionState: Record<string, unknown> | null = null;
      if (row.botVault?.id) {
        const state = await deps.vaultService.getExecutionStateForGridInstance({
          userId: user.id,
          gridInstanceId: String(row.id)
        });
        executionState = state ? (state as Record<string, unknown>) : null;
      }
      const mapped = mapGridInstanceRow(row, {
        includeProviderMetadataRaw,
        currentPilotAccess
      });
      const mergedBotVault = mergeExecutionStateIntoBotVault(
        mapped.botVault ? (mapped.botVault as Record<string, unknown>) : null,
        executionState,
        includeProviderMetadataRaw
      );
      return res.json({
        ...mapped,
        botVault: mergedBotVault,
        pilotStatus: buildGridPilotStatus({
          botVault: mergedBotVault,
          currentPilotAccess
        }),
        executionState
      });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_get_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/start", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      if (String(row.state ?? "").trim().toLowerCase() === "archived") {
        return res.status(409).json({
          error: "grid_instance_archived_not_restartable",
          id: row.id,
          state: row.state,
          restartable: false
        });
      }
      const started = await startGridInstanceNow({
        row,
        userId: user.id
      });
      return res.json({ ok: true, ...started });
    } catch (error) {
      if (error instanceof ManualTradingError) {
        if (error.code === "grid_exchange_not_allowed") {
          return res.status(error.status).json({
            error: error.code,
            reason: error.message,
            allowedExchanges: [...allowedGridExchanges]
          });
        }
        return res.status(error.status).json({ error: error.code, reason: error.message });
      }
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_start_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/pause", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const state = String(row.state ?? "").trim().toLowerCase();
      if (state === "archived") {
        return res.status(409).json({ error: "grid_instance_archived_not_restartable", state: row.state, restartable: false });
      }
      if (state !== "running") {
        return res.status(409).json({ error: "grid_instance_pause_invalid_state", state: row.state });
      }
      await deps.db.$transaction([
        deps.db.gridBotInstance.update({ where: { id: row.id }, data: { state: "paused" } }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "stopped" } })
      ]);
      await deps.vaultService.pauseBotVaultForGridInstance({
        userId: user.id,
        gridInstanceId: String(row.id)
      });
      return res.json({ ok: true, id: row.id, state: "paused", botId: row.botId });
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_pause_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/resume", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const state = String(row.state ?? "").trim().toLowerCase();
      if (state === "archived") {
        return res.status(409).json({ error: "grid_instance_archived_not_restartable", state: row.state, restartable: false });
      }
      if (state !== "paused" && state !== "stopped" && state !== "created" && state !== "error") {
        return res.status(409).json({ error: "grid_instance_resume_invalid_state", state: row.state });
      }
      const started = await startGridInstanceNow({
        row,
        userId: user.id
      });
      return res.json({ ok: true, ...started });
    } catch (error) {
      if (error instanceof ManualTradingError) {
        if (error.code === "grid_exchange_not_allowed") {
          return res.status(error.status).json({
            error: error.code,
            reason: error.message,
            allowedExchanges: [...allowedGridExchanges]
          });
        }
        return res.status(error.status).json({ error: error.code, reason: error.message });
      }
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_resume_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/stop", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const archived = await archiveGridInstance({
        row,
        userId: user.id,
        reason: "manual_stop",
        closeSourceType: "grid_instance_stop_final"
      });
      return res.json({ ok: true, ...archived });
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_stop_failed", reason: String(error) });
    }
  });

  app.put("/grid/instances/:id/risk", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridInstanceRiskUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const templateMarginPolicy = String(row.template.marginPolicy ?? (row.template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const currentMarginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL")) === "AUTO" ? "AUTO" : "MANUAL";
      const requestedMarginMode = parsed.data.marginMode
        ?? (parsed.data.autoMarginEnabled !== undefined ? (parsed.data.autoMarginEnabled ? "AUTO" : "MANUAL") : currentMarginMode);
      const nextAutoMarginEnabled = requestedMarginMode === "AUTO";
      if (nextAutoMarginEnabled && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }

      const updateData: Record<string, unknown> = {
        ...(parsed.data.tpPct !== undefined ? { tpPct: parsed.data.tpPct } : {}),
        ...(parsed.data.slPrice !== undefined ? { slPrice: parsed.data.slPrice } : {}),
        ...(parsed.data.autoMarginEnabled !== undefined ? { autoMarginEnabled: parsed.data.autoMarginEnabled } : {}),
        ...(parsed.data.marginMode !== undefined ? { marginMode: parsed.data.marginMode } : {}),
        marginMode: requestedMarginMode,
        autoMarginEnabled: nextAutoMarginEnabled
      };

      if (nextAutoMarginEnabled && currentMarginMode !== "AUTO") {
        const totalBudget = Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0);
        const computed = await computeGridPreviewAndAllocation({
          userId: user.id,
          exchangeAccountId: row.exchangeAccountId,
          exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? null,
          template: row.template,
          autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
          autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
          autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
          autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
          activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
          recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
          investUsd: totalBudget,
          extraMarginUsd: 0,
          autoMarginEnabled: true,
          tpPct: parsed.data.tpPct ?? row.tpPct ?? row.template.tpDefaultPct ?? null,
          slPrice: parsed.data.slPrice ?? row.slPrice ?? row.template.slDefaultPrice ?? null,
          triggerPrice: row.triggerPrice ?? null,
          leverage: row.leverage,
          slippagePct: row.slippagePct,
          resolveVenueContext: deps.resolveVenueContext
        });
        if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
          return res.status(400).json({
            error: "grid_instance_invest_below_minimum",
            requiredMinInvestmentUSDT: computed.minInvestmentUSDT,
            minInvestmentBreakdown: computed.minInvestmentBreakdown,
            initialSeed: computed.initialSeed,
            currentInvestUsd: totalBudget,
            symbol: row.template.symbol,
            markPrice: computed.markPrice,
            allocation: computed.allocation,
            warnings: computed.warnings
          });
        }
        updateData.investUsd = computed.allocation.gridInvestUsd;
        updateData.extraMarginUsd = computed.allocation.extraMarginUsd;
      }

      const updated = await deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: updateData,
        include: {
          template: true,
          bot: {
            include: {
              futuresConfig: true,
              exchangeAccount: {
                select: {
                  id: true,
                  exchange: true,
                  label: true
                }
              }
            }
          }
        }
      });
      return res.json(mapGridInstanceRow(updated));
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_risk_update_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/margin/add", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const marginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"));
      if (marginMode === "AUTO") {
        const nextTotalBudget = toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0) + parsed.data.amountUsd);
        const computed = await computeGridPreviewAndAllocation({
          userId: user.id,
          exchangeAccountId: row.exchangeAccountId,
          exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? null,
          template: row.template,
          autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
          autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
          autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
          autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
          activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
          recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
          investUsd: nextTotalBudget,
          extraMarginUsd: 0,
          autoMarginEnabled: true,
          tpPct: row.tpPct ?? row.template.tpDefaultPct ?? null,
          slPrice: row.slPrice ?? row.template.slDefaultPrice ?? null,
          triggerPrice: row.triggerPrice ?? null,
          leverage: row.leverage,
          slippagePct: row.slippagePct,
          resolveVenueContext: deps.resolveVenueContext
        });

        if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
          return res.status(400).json({
            error: "grid_instance_invest_below_minimum",
            requiredMinInvestmentUSDT: computed.minInvestmentUSDT,
            minInvestmentBreakdown: computed.minInvestmentBreakdown,
            initialSeed: computed.initialSeed,
            currentInvestUsd: nextTotalBudget,
            symbol: row.template.symbol,
            markPrice: computed.markPrice,
            allocation: computed.allocation,
            warnings: computed.warnings
          });
        }

        const updated = await deps.db.$transaction(async (tx: any) => {
          const nextRow = await tx.gridBotInstance.update({
            where: { id: row.id },
            data: {
              investUsd: computed.allocation.gridInvestUsd,
              extraMarginUsd: computed.allocation.extraMarginUsd
            }
          });
          const previousTotal = toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0));
          const nextTotal = toTwoDecimals(Number(nextRow.investUsd ?? 0) + Number(nextRow.extraMarginUsd ?? 0));
          const topUpDeltaUsd = toTwoDecimals(Math.max(0, nextTotal - previousTotal));
          if (topUpDeltaUsd > 0) {
            await deps.vaultService.topUpBotVaultForGridInstance({
              tx,
              userId: user.id,
              gridInstanceId: String(row.id),
              amountUsd: topUpDeltaUsd,
              idempotencyKey: `grid_instance:${row.id}:margin_add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
              metadata: {
                sourceType: "grid_margin_add_auto"
              }
            });
          }
          return nextRow;
        });
        return res.json({
          ok: true,
          id: updated.id,
          investUsd: updated.investUsd,
          extraMarginUsd: updated.extraMarginUsd
        });
      }
      const updated = await deps.db.$transaction(async (tx: any) => {
        const nextRow = await tx.gridBotInstance.update({
          where: { id: row.id },
          data: {
            extraMarginUsd: Number(row.extraMarginUsd ?? 0) + parsed.data.amountUsd
          }
        });
        await deps.vaultService.topUpBotVaultForGridInstance({
          tx,
          userId: user.id,
          gridInstanceId: String(row.id),
          amountUsd: parsed.data.amountUsd,
          idempotencyKey: `grid_instance:${row.id}:margin_add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          metadata: {
            sourceType: "grid_margin_add_manual"
          }
        });
        return nextRow;
      });
      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd
      });
    } catch (error) {
      const mappedRisk = mapRiskErrorToHttp(error);
      if (mappedRisk) {
        return res.status(mappedRisk.status).json({
          error: mappedRisk.code,
          reason: mappedRisk.reason
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_add_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/margin/remove", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridMarginAdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const marginMode = String(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"));
      if (marginMode === "AUTO") {
        const currentTotalBudget = toTwoDecimals(Number(row.investUsd ?? 0) + Number(row.extraMarginUsd ?? 0));
        const nextTotalBudget = toTwoDecimals(Math.max(0.01, currentTotalBudget - parsed.data.amountUsd));
        const computed = await computeGridPreviewAndAllocation({
          userId: user.id,
          exchangeAccountId: row.exchangeAccountId,
          exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? null,
          template: row.template,
          autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
          autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
          autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
          autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
          activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
          recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
          investUsd: nextTotalBudget,
          extraMarginUsd: 0,
          autoMarginEnabled: true,
          tpPct: row.tpPct ?? row.template.tpDefaultPct ?? null,
          slPrice: row.slPrice ?? row.template.slDefaultPrice ?? null,
          triggerPrice: row.triggerPrice ?? null,
          leverage: row.leverage,
          slippagePct: row.slippagePct,
          resolveVenueContext: deps.resolveVenueContext
        });
        if (computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT) {
          return res.status(400).json({
            error: "grid_instance_invest_below_minimum",
            requiredMinInvestmentUSDT: computed.minInvestmentUSDT,
            minInvestmentBreakdown: computed.minInvestmentBreakdown,
            initialSeed: computed.initialSeed,
            currentInvestUsd: nextTotalBudget,
            symbol: row.template.symbol,
            markPrice: computed.markPrice,
            allocation: computed.allocation,
            warnings: computed.warnings
          });
        }

        const updated = await deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: {
            investUsd: computed.allocation.gridInvestUsd,
            extraMarginUsd: computed.allocation.extraMarginUsd
          }
        });
        return res.json({
          ok: true,
          id: updated.id,
          investUsd: updated.investUsd,
          extraMarginUsd: updated.extraMarginUsd
        });
      }
      const current = Number(row.extraMarginUsd ?? 0);
      const next = Math.max(0, current - parsed.data.amountUsd);
      const updated = await deps.db.gridBotInstance.update({
        where: { id: row.id },
        data: { extraMarginUsd: next }
      });
      return res.json({
        ok: true,
        id: updated.id,
        investUsd: updated.investUsd,
        extraMarginUsd: updated.extraMarginUsd
      });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_margin_remove_failed", reason: String(error) });
    }
  });

  app.post("/grid/instances/:id/withdraw-profit", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const parsed = gridWithdrawSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const result = await deps.vaultService.withdrawFromGridInstance({
        userId: user.id,
        gridInstanceId: row.id,
        amountUsd: parsed.data.amountUsd
      });
      return res.json({
        ok: true,
        id: row.id,
        withdrawnProfitUsd: result.botVault.withdrawnUsd,
        botVault: result.botVault,
        settlement: result.settlement
      });
    } catch (error) {
      const reason = String(error);
      if (reason.includes("insufficient_withdrawable_profit")) {
        return res.status(400).json({
          error: "insufficient_withdrawable_profit"
        });
      }
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_withdraw_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/metrics", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      return res.json({
        id: row.id,
        state: row.state,
        metrics: row.metricsJson ?? {},
        stateJson: row.stateJson ?? {},
        lastPlanAt: row.lastPlanAt ?? null,
        lastPlanError: row.lastPlanError ?? null,
        lastPlanVersion: row.lastPlanVersion ?? null
      });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_metrics_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/orders", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.gridBotOrderMap.findMany({
        where: {
          instanceId: row.id,
          status: "open"
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200
      });
      return res.json({ items });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_orders_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/fills", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.gridBotFillEvent.findMany({
        where: { instanceId: row.id },
        orderBy: [{ fillTs: "desc" }],
        take: 200
      });
      return res.json({ items });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_fills_failed", reason: String(error) });
    }
  });

  app.get("/grid/instances/:id/events", requireAuth, async (req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    const user = getUserFromLocals(res);
    try {
      const row = await loadGridInstanceForUser({ db: deps.db, userId: user.id, instanceId: req.params.id });
      if (!row) return res.status(404).json({ error: "grid_instance_not_found" });
      const items = await deps.db.riskEvent.findMany({
        where: { botId: row.botId },
        orderBy: [{ createdAt: "desc" }],
        take: 200
      });
      return res.json({ items });
    } catch (error) {
      if (isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_instance_events_failed", reason: String(error) });
    }
  });
}
