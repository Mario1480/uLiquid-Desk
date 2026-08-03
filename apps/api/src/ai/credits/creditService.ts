import { randomUUID } from "node:crypto";
import {
  calculateAiUsageCost,
  creditsForRetailMicrousd,
  serializePricingSnapshot,
  type AiPricingSnapshot,
  type AiTokenUsage
} from "./pricing.js";
import type { AiRoutingDecision } from "./modelRouter.js";

const DEFAULT_RESERVATION_TTL_MS = 15 * 60_000;
const MAX_CAS_ATTEMPTS = 5;

export class AiCreditError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

export function isAiCreditBillingEnabled(value = process.env.AI_CREDIT_BILLING_V2): boolean {
  return String(value ?? "false").trim().toLowerCase() === "true";
}

export async function isAiCreditBillingEnabledForDatabase(database: any): Promise<boolean> {
  if (!isAiCreditBillingEnabled()) return false;
  const row = await database.globalSetting.findUnique({
    where: { key: "admin.billingFeatureFlags.v1" },
    select: { value: true }
  });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  return (value as Record<string, unknown>).aiCreditBillingEnabled !== false;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

function utcStartOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function utcStartOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export async function resolveAiPricing(database: any, model: string, at = new Date()): Promise<AiPricingSnapshot> {
  const rows = await database.aiModelPricing.findMany({
    where: {
      provider: "openai",
      model,
      serviceTier: "default",
      processingRegion: "global",
      isActive: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }]
    },
    orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
    take: 2
  });
  if (rows.length === 0) throw new AiCreditError("ai_pricing_unavailable", 503);
  if (rows.length > 1) throw new AiCreditError("ai_pricing_ambiguous", 503);
  const row = rows[0];
  return {
    id: String(row.id),
    provider: "openai",
    model: String(row.model),
    serviceTier: "default",
    processingRegion: "global",
    inputMicrousdPerMillion: toBigInt(row.inputMicrousdPerMillion),
    cachedInputMicrousdPerMillion: toBigInt(row.cachedInputMicrousdPerMillion),
    cacheWriteMicrousdPerMillion: row.cacheWriteMicrousdPerMillion === null ? null : toBigInt(row.cacheWriteMicrousdPerMillion),
    outputMicrousdPerMillion: toBigInt(row.outputMicrousdPerMillion),
    longContextThresholdTokens: row.longContextThresholdTokens === null ? null : Number(row.longContextThresholdTokens),
    longInputMultiplierBps: row.longInputMultiplierBps === null ? null : Number(row.longInputMultiplierBps),
    longOutputMultiplierBps: row.longOutputMultiplierBps === null ? null : Number(row.longOutputMultiplierBps),
    markupBps: Number(row.markupBps),
    revision: Number(row.revision),
    effectiveFrom: new Date(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? new Date(row.effectiveUntil) : null
  };
}

export async function estimateAiRunReservation(params: {
  database: any;
  routing: AiRoutingDecision;
  expectedInputTokens: number;
  toolMicrousdPerCall?: bigint;
  at?: Date;
}): Promise<{ credits: bigint; providerCostMicrousd: bigint; retailCostMicrousd: bigint; pricing: AiPricingSnapshot }> {
  const pricing = await resolveAiPricing(params.database, params.routing.model, params.at);
  const calls = Math.max(1, params.routing.maxToolRounds + 1);
  let providerCostMicrousd = 0n;
  let retailCostMicrousd = 0n;
  for (let callIndex = 0; callIndex < calls; callIndex += 1) {
    const estimatedInput = Math.max(1, Math.trunc(params.expectedInputTokens))
      + callIndex * (params.routing.maxOutputTokens + 2_000);
    const cost = calculateAiUsageCost({
      pricing,
      usage: {
        inputTokens: BigInt(estimatedInput),
        cachedInputTokens: 0n,
        cacheWriteTokens: 0n,
        outputTokens: BigInt(params.routing.maxOutputTokens),
        reasoningTokens: 0n
      },
      toolMicrousd: params.toolMicrousdPerCall ?? 0n
    });
    providerCostMicrousd += cost.providerCostMicrousd;
    retailCostMicrousd += cost.retailCostMicrousd;
  }
  return {
    credits: creditsForRetailMicrousd(retailCostMicrousd, 1n),
    providerCostMicrousd,
    retailCostMicrousd,
    pricing
  };
}

async function getSettledUsage(tx: any, userId: string, from: Date): Promise<bigint> {
  const aggregate = await tx.aiAgentRun.aggregate({
    where: { userId, completedAt: { gte: from }, status: "completed" },
    _sum: { chargedCredits: true }
  });
  return toBigInt(aggregate?._sum?.chargedCredits);
}

export async function reserveAiCredits(params: {
  database: any;
  userId: string;
  agentRunId: string;
  credits: bigint;
  idempotencyKey: string;
  now?: Date;
  ttlMs?: number;
}): Promise<any | null> {
  if (!isAiCreditBillingEnabled()) return null;
  if (params.credits <= 0n) throw new AiCreditError("ai_credit_reservation_failed");
  const now = params.now ?? new Date();

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    try {
      const result = await params.database.$transaction(async (tx: any) => {
        const duplicate = await tx.aiCreditReservation.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
        if (duplicate) {
          if (duplicate.agentRunId !== params.agentRunId || toBigInt(duplicate.reservedCredits) !== params.credits) {
            throw new AiCreditError("ai_credit_idempotency_conflict");
          }
          return duplicate;
        }

        const subscription = await tx.userSubscription.upsert({
          where: { userId: params.userId },
          update: {},
          create: { userId: params.userId, status: "ACTIVE" }
        });
        const balance = toBigInt(subscription.aiCreditBalance);
        const reserved = toBigInt(subscription.aiCreditsReserved);
        const available = balance - reserved;
        if (available < params.credits) throw new AiCreditError("ai_credit_balance_exhausted", 402);
        if (subscription.aiMaxRunCredits !== null && params.credits > toBigInt(subscription.aiMaxRunCredits)) {
          throw new AiCreditError("ai_run_limit_exceeded", 402);
        }

        const [dailyUsed, monthlyUsed] = await Promise.all([
          getSettledUsage(tx, params.userId, utcStartOfDay(now)),
          getSettledUsage(tx, params.userId, utcStartOfMonth(now))
        ]);
        if (subscription.aiDailyLimitCredits !== null && dailyUsed + reserved + params.credits > toBigInt(subscription.aiDailyLimitCredits)) {
          throw new AiCreditError("ai_daily_limit_exceeded", 402);
        }
        if (subscription.aiMonthlyLimitCredits !== null && monthlyUsed + reserved + params.credits > toBigInt(subscription.aiMonthlyLimitCredits)) {
          throw new AiCreditError("ai_monthly_limit_exceeded", 402);
        }

        const claimed = await tx.userSubscription.updateMany({
          where: { id: subscription.id, aiCreditBalance: balance, aiCreditsReserved: reserved },
          data: { aiCreditsReserved: reserved + params.credits }
        });
        if (claimed.count !== 1) return null;

        const reservation = await tx.aiCreditReservation.create({
          data: {
            id: randomUUID(),
            userId: params.userId,
            subscriptionId: subscription.id,
            agentRunId: params.agentRunId,
            status: "ACTIVE",
            reservedCredits: params.credits,
            idempotencyKey: params.idempotencyKey,
            expiresAt: new Date(now.getTime() + Math.max(60_000, params.ttlMs ?? DEFAULT_RESERVATION_TTL_MS))
          }
        });
        await Promise.all([
          tx.aiCreditLedger.create({
            data: {
              userId: params.userId,
              subscriptionId: subscription.id,
              agentRunId: params.agentRunId,
              reservationId: reservation.id,
              reason: "USAGE_RESERVE",
              idempotencyKey: `${params.idempotencyKey}:ledger:reserve`,
              deltaCredits: 0n,
              balanceAfterCredits: balance,
              reservedAfterCredits: reserved + params.credits,
              meta: { reservedCredits: params.credits.toString() }
            }
          }),
          tx.aiAgentRun.update({ where: { id: params.agentRunId }, data: { reservedCredits: params.credits } })
        ]);
        return reservation;
      });
      if (result) return result;
    } catch (error) {
      if (error instanceof AiCreditError) throw error;
      if (attempt === MAX_CAS_ATTEMPTS - 1) throw error;
    }
  }
  throw new AiCreditError("ai_credit_reservation_failed");
}

export async function recordAiUsage(params: {
  database: any;
  agentRunId: string;
  callIndex: number;
  routing: AiRoutingDecision;
  usage: AiTokenUsage;
  responseId?: string | null;
  requestId?: string | null;
  serviceTier?: string | null;
  latencyMs?: number | null;
  toolMicrousd?: bigint;
  status?: "COMPLETED" | "FAILED" | "RECONCILIATION_REQUIRED";
  errorCode?: string | null;
  at?: Date;
}): Promise<any> {
  const pricing = await resolveAiPricing(params.database, params.routing.model, params.at);
  if (params.serviceTier && params.serviceTier !== "default") throw new AiCreditError("ai_pricing_unavailable", 503);
  const cost = calculateAiUsageCost({ pricing, usage: params.usage, toolMicrousd: params.toolMicrousd });
  return params.database.$transaction(async (tx: any) => {
    const duplicate = await tx.aiUsageRecord.findUnique({
      where: { agentRunId_callIndex: { agentRunId: params.agentRunId, callIndex: params.callIndex } }
    });
    if (duplicate) {
      if (String(duplicate.model) !== params.routing.model || String(duplicate.responseId ?? "") !== String(params.responseId ?? "")) {
        throw new AiCreditError("ai_usage_idempotency_conflict");
      }
      return duplicate;
    }
    const usageRecord = await tx.aiUsageRecord.create({
      data: {
        id: randomUUID(),
        agentRunId: params.agentRunId,
        callIndex: params.callIndex,
        provider: "openai",
        model: params.routing.model,
        modelClass: params.routing.modelClass,
        serviceTier: "default",
        processingRegion: "global",
        responseId: params.responseId ?? null,
        requestId: params.requestId ?? null,
        inputTokens: params.usage.inputTokens,
        cachedInputTokens: params.usage.cachedInputTokens,
        cacheWriteTokens: params.usage.cacheWriteTokens,
        outputTokens: params.usage.outputTokens,
        reasoningTokens: params.usage.reasoningTokens,
        providerCostMicrousd: cost.providerCostMicrousd,
        retailCostMicrousd: cost.retailCostMicrousd,
        pricingRevisionId: pricing.id,
        pricingSnapshot: serializePricingSnapshot(pricing),
        status: params.status ?? "COMPLETED",
        errorCode: params.errorCode ?? null,
        latencyMs: params.latencyMs ?? null
      }
    });
    await tx.aiAgentRun.update({
      where: { id: params.agentRunId },
      data: {
        provider: "openai",
        model: params.routing.model,
        modelClass: params.routing.modelClass,
        modelCallCount: { increment: 1 },
        providerCostMicrousd: { increment: cost.providerCostMicrousd },
        retailCostMicrousd: { increment: cost.retailCostMicrousd }
      }
    });
    return usageRecord;
  });
}

async function aggregateRunCosts(tx: any, agentRunId: string): Promise<{ provider: bigint; retail: bigint; unresolved: number }> {
  const [aggregate, unresolved] = await Promise.all([
    tx.aiUsageRecord.aggregate({ where: { agentRunId }, _sum: { providerCostMicrousd: true, retailCostMicrousd: true } }),
    tx.aiUsageRecord.count({ where: { agentRunId, status: "RECONCILIATION_REQUIRED" } })
  ]);
  return {
    provider: toBigInt(aggregate?._sum?.providerCostMicrousd),
    retail: toBigInt(aggregate?._sum?.retailCostMicrousd),
    unresolved
  };
}

export async function settleAiRun(params: { database: any; agentRunId: string; now?: Date }): Promise<{ chargedCredits: bigint; remainingBalance: bigint } | null> {
  if (!isAiCreditBillingEnabled()) return null;
  const now = params.now ?? new Date();
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const result = await params.database.$transaction(async (tx: any) => {
      const reservation = await tx.aiCreditReservation.findUnique({ where: { agentRunId: params.agentRunId } });
      if (!reservation) throw new AiCreditError("ai_credit_reservation_failed");
      if (reservation.status === "SETTLED") {
        const subscription = await tx.userSubscription.findUnique({ where: { id: reservation.subscriptionId } });
        return { chargedCredits: toBigInt(reservation.settledCredits), remainingBalance: toBigInt(subscription?.aiCreditBalance) };
      }
      if (reservation.status !== "ACTIVE") throw new AiCreditError("ai_usage_settlement_failed");
      const costs = await aggregateRunCosts(tx, params.agentRunId);
      if (costs.unresolved > 0) {
        await tx.aiCreditReservation.update({ where: { id: reservation.id }, data: { status: "RECONCILIATION_REQUIRED", reconciliationReason: "usage_unresolved" } });
        throw new AiCreditError("ai_usage_settlement_failed", 503);
      }
      const chargedCredits = creditsForRetailMicrousd(costs.retail, costs.retail > 0n ? 1n : 0n);
      const reservedCredits = toBigInt(reservation.reservedCredits);
      if (chargedCredits > reservedCredits) {
        await tx.aiCreditReservation.update({ where: { id: reservation.id }, data: { status: "RECONCILIATION_REQUIRED", reconciliationReason: "reservation_exceeded" } });
        throw new AiCreditError("ai_run_limit_exceeded", 503);
      }

      const subscription = await tx.userSubscription.findUnique({ where: { id: reservation.subscriptionId } });
      if (!subscription) throw new AiCreditError("ai_credit_reservation_failed");
      const balance = toBigInt(subscription.aiCreditBalance);
      const reserved = toBigInt(subscription.aiCreditsReserved);
      if (balance < chargedCredits || reserved < reservedCredits) throw new AiCreditError("ai_usage_settlement_failed");
      const claimed = await tx.userSubscription.updateMany({
        where: { id: subscription.id, aiCreditBalance: balance, aiCreditsReserved: reserved },
        data: {
          aiCreditBalance: balance - chargedCredits,
          aiCreditsReserved: reserved - reservedCredits,
          aiCreditsUsedLifetime: { increment: chargedCredits }
        }
      });
      if (claimed.count !== 1) return null;

      await tx.aiCreditReservation.update({
        where: { id: reservation.id },
        data: { status: "SETTLED", settledCredits: chargedCredits, settledAt: now, releasedAt: reservedCredits > chargedCredits ? now : null }
      });
      await tx.aiCreditLedger.create({
        data: {
          userId: reservation.userId,
          subscriptionId: subscription.id,
          agentRunId: params.agentRunId,
          reservationId: reservation.id,
          reason: "USAGE_SETTLE",
          idempotencyKey: `${reservation.idempotencyKey}:ledger:settle`,
          deltaCredits: -chargedCredits,
          balanceAfterCredits: balance - chargedCredits,
          reservedAfterCredits: reserved - reservedCredits,
          providerCostMicrousd: costs.provider,
          retailCostMicrousd: costs.retail,
          meta: { reservedCredits: reservedCredits.toString(), releasedCredits: (reservedCredits - chargedCredits).toString() }
        }
      });
      if (reservedCredits > chargedCredits) {
        await tx.aiCreditLedger.create({
          data: {
            userId: reservation.userId,
            subscriptionId: subscription.id,
            agentRunId: params.agentRunId,
            reservationId: reservation.id,
            reason: "USAGE_RELEASE",
            idempotencyKey: `${reservation.idempotencyKey}:ledger:release`,
            deltaCredits: 0n,
            balanceAfterCredits: balance - chargedCredits,
            reservedAfterCredits: reserved - reservedCredits,
            meta: { releasedCredits: (reservedCredits - chargedCredits).toString() }
          }
        });
      }
      await tx.aiAgentRun.update({
        where: { id: params.agentRunId },
        data: { chargedCredits, providerCostMicrousd: costs.provider, retailCostMicrousd: costs.retail }
      });
      return { chargedCredits, remainingBalance: balance - chargedCredits };
    });
    if (result) return result;
  }
  throw new AiCreditError("ai_usage_settlement_failed");
}

export async function releaseAiReservation(params: { database: any; agentRunId: string; reason: string; now?: Date; finalStatus?: "RELEASED" | "EXPIRED" }): Promise<void> {
  if (!isAiCreditBillingEnabled()) return;
  const now = params.now ?? new Date();
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const released = await params.database.$transaction(async (tx: any) => {
      const reservation = await tx.aiCreditReservation.findUnique({ where: { agentRunId: params.agentRunId } });
      if (!reservation || reservation.status === "RELEASED" || reservation.status === "SETTLED") return true;
      if (reservation.status === "RECONCILIATION_REQUIRED") throw new AiCreditError("ai_usage_settlement_failed", 503);
      const subscription = await tx.userSubscription.findUnique({ where: { id: reservation.subscriptionId } });
      if (!subscription) return true;
      const reserved = toBigInt(subscription.aiCreditsReserved);
      const release = toBigInt(reservation.reservedCredits);
      if (reserved < release) throw new AiCreditError("ai_usage_settlement_failed", 503);
      const nextReserved = reserved - release;
      const claimed = await tx.userSubscription.updateMany({
        where: { id: subscription.id, aiCreditsReserved: reserved },
        data: { aiCreditsReserved: nextReserved }
      });
      if (claimed.count !== 1) return false;
      await Promise.all([
        tx.aiCreditReservation.update({ where: { id: reservation.id }, data: { status: params.finalStatus ?? "RELEASED", releasedAt: now, reconciliationReason: params.reason } }),
        tx.aiCreditLedger.create({
          data: {
            userId: reservation.userId,
            subscriptionId: subscription.id,
            agentRunId: params.agentRunId,
            reservationId: reservation.id,
            reason: "USAGE_RELEASE",
            idempotencyKey: `${reservation.idempotencyKey}:ledger:release`,
            deltaCredits: 0n,
            balanceAfterCredits: toBigInt(subscription.aiCreditBalance),
            reservedAfterCredits: nextReserved,
            meta: { reason: params.reason, releasedCredits: release.toString() }
          }
        })
      ]);
      return true;
    });
    if (released) return;
  }
  throw new AiCreditError("ai_credit_reservation_failed");
}

export async function releaseExpiredAiReservations(database: any, now = new Date(), take = 100): Promise<number> {
  if (!isAiCreditBillingEnabled()) return 0;
  const rows = await database.aiCreditReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { agentRunId: true },
    orderBy: { expiresAt: "asc" },
    take: Math.min(1_000, Math.max(1, take))
  });
  let released = 0;
  for (const row of rows) {
    await releaseAiReservation({
      database,
      agentRunId: row.agentRunId,
      reason: "reservation_expired",
      finalStatus: "EXPIRED",
      now
    });
    released += 1;
  }
  return released;
}

export async function markAiReservationForReconciliation(params: { database: any; agentRunId: string; reason: string }): Promise<void> {
  if (!isAiCreditBillingEnabled()) return;
  await params.database.aiCreditReservation.updateMany({
    where: { agentRunId: params.agentRunId, status: "ACTIVE" },
    data: { status: "RECONCILIATION_REQUIRED", reconciliationReason: params.reason.slice(0, 191) }
  });
}

export async function getAiCreditSummary(database: any, userId: string, now = new Date()): Promise<{
  balance: bigint;
  reserved: bigint;
  available: bigint;
  usedLifetime: bigint;
  usedToday: bigint;
  usedThisMonth: bigint;
  dailyLimit: bigint | null;
  monthlyLimit: bigint | null;
  maxRunCredits: bigint | null;
}> {
  const subscription = await database.userSubscription.findUnique({ where: { userId } });
  if (!subscription) return { balance: 0n, reserved: 0n, available: 0n, usedLifetime: 0n, usedToday: 0n, usedThisMonth: 0n, dailyLimit: null, monthlyLimit: null, maxRunCredits: null };
  const [usedToday, usedThisMonth] = await Promise.all([
    getSettledUsage(database, userId, utcStartOfDay(now)),
    getSettledUsage(database, userId, utcStartOfMonth(now))
  ]);
  const balance = toBigInt(subscription.aiCreditBalance);
  const reserved = toBigInt(subscription.aiCreditsReserved);
  return {
    balance,
    reserved,
    available: balance > reserved ? balance - reserved : 0n,
    usedLifetime: toBigInt(subscription.aiCreditsUsedLifetime),
    usedToday,
    usedThisMonth,
    dailyLimit: subscription.aiDailyLimitCredits === null ? null : toBigInt(subscription.aiDailyLimitCredits),
    monthlyLimit: subscription.aiMonthlyLimitCredits === null ? null : toBigInt(subscription.aiMonthlyLimitCredits),
    maxRunCredits: subscription.aiMaxRunCredits === null ? null : toBigInt(subscription.aiMaxRunCredits)
  };
}
