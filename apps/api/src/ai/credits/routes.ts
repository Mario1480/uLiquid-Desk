import { randomUUID } from "node:crypto";
import type { Express, Response } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../../auth.js";
import { estimateAiRunReservation, getAiCreditSummary } from "./creditService.js";
import { routeOpenAiModel } from "./modelRouter.js";
import { resolveOpenAiModelRoutingWithSource } from "../provider.js";

const estimateSchema = z.object({
  scope: z.string().trim().min(1).max(120),
  profile: z.enum(["market_analyst", "position_copilot", "trading_assistant", "prediction_builder"]),
  skills: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  requestedSymbols: z.number().int().min(0).max(50).default(1),
  requestedAccounts: z.number().int().min(0).max(20).default(0),
  createsTradingDraft: z.boolean().default(false),
  expectedInputTokens: z.number().int().min(1).max(1_000_000).optional()
}).strict();

const limitsSchema = z.object({
  dailyLimitCredits: z.string().regex(/^\d+$/).nullable(),
  monthlyLimitCredits: z.string().regex(/^\d+$/).nullable(),
  maxRunCredits: z.string().regex(/^\d+$/).nullable()
}).strict();

const usageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().min(1).max(512).optional()
});

type AiUsageCursor = {
  id: string;
  createdAt: string;
};

const pricingSchema = z.object({
  model: z.string().trim().min(1).max(120),
  inputMicrousdPerMillion: z.string().regex(/^\d+$/),
  cachedInputMicrousdPerMillion: z.string().regex(/^\d+$/),
  cacheWriteMicrousdPerMillion: z.string().regex(/^\d+$/).nullable().default(null),
  outputMicrousdPerMillion: z.string().regex(/^\d+$/),
  longContextThresholdTokens: z.number().int().positive().nullable().default(null),
  longInputMultiplierBps: z.number().int().min(10_000).max(100_000).nullable().default(null),
  longOutputMultiplierBps: z.number().int().min(10_000).max(100_000).nullable().default(null),
  markupBps: z.number().int().min(10_000).max(100_000),
  effectiveFrom: z.string().datetime().optional()
}).strict();

function asString(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value ?? "0");
}

function asBigInt(value: unknown): bigint {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function warningLevel(balance: bigint, available: bigint): "none" | "low_20" | "low_10" | "exhausted" {
  if (available <= 0n) return "exhausted";
  if (balance <= 0n) return "none";
  const percent = available * 100n / balance;
  if (percent <= 10n) return "low_10";
  if (percent <= 20n) return "low_20";
  return "none";
}

function serializeAiCreditSummary(summary: Awaited<ReturnType<typeof getAiCreditSummary>>) {
  return {
    balance: asString(summary.balance),
    reserved: asString(summary.reserved),
    available: asString(summary.available),
    usedLifetime: asString(summary.usedLifetime),
    usedToday: asString(summary.usedToday),
    usedThisMonth: asString(summary.usedThisMonth),
    dailyLimit: summary.dailyLimit?.toString() ?? null,
    monthlyLimit: summary.monthlyLimit?.toString() ?? null,
    maxRunCredits: summary.maxRunCredits?.toString() ?? null,
    warningLevel: warningLevel(summary.balance, summary.available)
  };
}

export function encodeAiUsageCursor(cursor: AiUsageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAiUsageCursor(value: string): AiUsageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AiUsageCursor>;
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (typeof parsed.id !== "string" || parsed.id.trim().length === 0 || !createdAt || Number.isNaN(createdAt.getTime())) {
      throw new Error("invalid_cursor");
    }
    return { id: parsed.id, createdAt: createdAt.toISOString() };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function requireAdminOr403(res: Response, requireSuperadmin: (res: Response) => Promise<boolean>): Promise<boolean> {
  return requireSuperadmin(res);
}

export function registerAiCreditRoutes(app: Express, deps: {
  db: any;
  requireSuperadmin(res: Response): Promise<boolean>;
  recordAdminAuditEvent?: (input: { actorUserId: string; action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> | null }) => Promise<void>;
}) {
  app.get("/api/billing/ai-credits", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const [summary, topups] = await Promise.all([
      getAiCreditSummary(deps.db, user.id),
      deps.db.billingPackage.findMany({
        where: { isActive: true, kind: "ADDON", aiCredits: { gt: 0n } },
        select: { id: true, code: true, name: true, description: true, priceCents: true, aiCredits: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }]
      })
    ]);
    return res.json({
      ...serializeAiCreditSummary(summary),
      topups: topups.map((row: any) => ({ ...row, aiCredits: asString(row.aiCredits) }))
    });
  });

  app.get("/api/billing/ai-credits/summary", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const subscription = await deps.db.userSubscription.findUnique({
      where: { userId: user.id },
      select: { aiCreditBalance: true, aiCreditsReserved: true }
    });
    const balance = asBigInt(subscription?.aiCreditBalance);
    const reserved = asBigInt(subscription?.aiCreditsReserved);
    const available = balance > reserved ? balance - reserved : 0n;
    return res.json({
      balance: balance.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      warningLevel: warningLevel(balance, available)
    });
  });

  app.patch("/api/billing/ai-credits/limits", requireAuth, async (req, res) => {
    const parsed = limitsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    await deps.db.userSubscription.upsert({
      where: { userId: user.id },
      update: {
        aiDailyLimitCredits: parsed.data.dailyLimitCredits === null ? null : BigInt(parsed.data.dailyLimitCredits),
        aiMonthlyLimitCredits: parsed.data.monthlyLimitCredits === null ? null : BigInt(parsed.data.monthlyLimitCredits),
        aiMaxRunCredits: parsed.data.maxRunCredits === null ? null : BigInt(parsed.data.maxRunCredits)
      },
      create: {
        userId: user.id,
        status: "ACTIVE",
        aiDailyLimitCredits: parsed.data.dailyLimitCredits === null ? null : BigInt(parsed.data.dailyLimitCredits),
        aiMonthlyLimitCredits: parsed.data.monthlyLimitCredits === null ? null : BigInt(parsed.data.monthlyLimitCredits),
        aiMaxRunCredits: parsed.data.maxRunCredits === null ? null : BigInt(parsed.data.maxRunCredits)
      }
    });
    return res.json({ ok: true });
  });

  app.get("/api/billing/ai-credits/usage", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsedQuery = usageQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) return res.status(400).json({ error: "invalid_query", details: parsedQuery.error.flatten() });
    let cursor: AiUsageCursor | null = null;
    if (parsedQuery.data.cursor) {
      try {
        cursor = decodeAiUsageCursor(parsedQuery.data.cursor);
      } catch {
        return res.status(400).json({ error: "invalid_cursor" });
      }
    }
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const runs = await deps.db.aiAgentRun.findMany({
      where: {
        userId: user.id,
        AND: [
          { OR: [{ modelCallCount: { gt: 0 } }, { reservation: { isNot: null } }] },
          ...(cursor && cursorDate ? [{
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursor.id } }
            ]
          }] : [])
        ]
      },
      select: {
        id: true,
        scope: true,
        status: true,
        provider: true,
        model: true,
        modelClass: true,
        reservedCredits: true,
        chargedCredits: true,
        modelCallCount: true,
        usageTotalTokens: true,
        latencyMs: true,
        createdAt: true,
        completedAt: true,
        reservation: { select: { status: true, reservedCredits: true, settledCredits: true } },
        usageRecords: {
          select: { inputTokens: true, cachedInputTokens: true, outputTokens: true, reasoningTokens: true },
          orderBy: { callIndex: "asc" }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: parsedQuery.data.limit + 1
    });
    const hasMore = runs.length > parsedQuery.data.limit;
    const visibleRuns = hasMore ? runs.slice(0, parsedQuery.data.limit) : runs;
    const nextRow = hasMore ? visibleRuns.at(-1) : null;
    return res.json({
      items: visibleRuns.map((run: any) => {
        const tokenUsage = run.usageRecords.reduce((totals: Record<string, bigint>, record: any) => ({
          input: totals.input + BigInt(record.inputTokens ?? 0),
          cachedInput: totals.cachedInput + BigInt(record.cachedInputTokens ?? 0),
          output: totals.output + BigInt(record.outputTokens ?? 0),
          reasoning: totals.reasoning + BigInt(record.reasoningTokens ?? 0)
        }), { input: 0n, cachedInput: 0n, output: 0n, reasoning: 0n });
        return {
          id: run.id,
          scope: run.scope,
          status: run.status,
          provider: run.provider,
          model: run.model,
          modelClass: run.modelClass,
          reservedCredits: asString(run.reservedCredits),
          chargedCredits: asString(run.chargedCredits),
          modelCallCount: run.modelCallCount,
          usageTotalTokens: run.usageTotalTokens ?? Number(tokenUsage.input + tokenUsage.output),
          tokenUsage: {
            input: tokenUsage.input.toString(),
            cachedInput: tokenUsage.cachedInput.toString(),
            output: tokenUsage.output.toString(),
            reasoning: tokenUsage.reasoning.toString()
          },
          latencyMs: run.latencyMs,
          reservation: run.reservation ? {
            status: run.reservation.status,
            reservedCredits: asString(run.reservation.reservedCredits),
            settledCredits: asString(run.reservation.settledCredits)
          } : null,
          createdAt: run.createdAt,
          completedAt: run.completedAt
        };
      }),
      page: {
        hasMore,
        nextCursor: nextRow ? encodeAiUsageCursor({ id: nextRow.id, createdAt: nextRow.createdAt.toISOString() }) : null
      }
    });
  });

  app.post("/api/ai/runs/estimate", requireAuth, async (req, res) => {
    const parsed = estimateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const configuredModelRouting = await resolveOpenAiModelRoutingWithSource();
    const routing = routeOpenAiModel({
      scope: parsed.data.scope,
      profile: parsed.data.profile,
      enabledSkills: parsed.data.skills,
      requestedSymbols: parsed.data.requestedSymbols,
      requestedAccounts: parsed.data.requestedAccounts,
      createsTradingDraft: parsed.data.createsTradingDraft,
      expectedInputTokens: parsed.data.expectedInputTokens,
      allowDeep: process.env.AI_DEEP_ANALYSIS_ENABLED === "true"
    }, configuredModelRouting.models);
    const estimate = await estimateAiRunReservation({
      database: deps.db,
      routing,
      expectedInputTokens: parsed.data.expectedInputTokens ?? 8_000
    });
    const high = estimate.credits;
    const low = high > 1n ? (high * 60n + 99n) / 100n : high;
    return res.json({
      modelClass: routing.modelClass,
      reasonCode: routing.reasonCode,
      estimatedCredits: { low: low.toString(), high: high.toString() },
      maximumReservation: high.toString(),
      requiresConfirmation: routing.modelClass === "deep"
    });
  });

  app.get("/admin/ai/pricing", requireAuth, async (_req, res) => {
    if (!(await requireAdminOr403(res, deps.requireSuperadmin))) return;
    const [pricing, metrics] = await Promise.all([
      deps.db.aiModelPricing.findMany({ orderBy: [{ model: "asc" }, { revision: "desc" }] }),
      deps.db.aiAgentRun.aggregate({ _sum: { chargedCredits: true, providerCostMicrousd: true, retailCostMicrousd: true }, _count: { id: true } })
    ]);
    return res.json({
      provider: "openai",
      serviceTier: "default",
      processingRegion: "global",
      featureFlags: {
        creditBillingV2: process.env.AI_CREDIT_BILLING_V2 === "true",
        modelRouterV1: process.env.AI_MODEL_ROUTER_V1 === "true",
        responsesApiAgent: process.env.AI_RESPONSES_API_AGENT === "true",
        agentChat: process.env.AI_AGENT_CHAT_ENABLED === "true",
        deepAnalysis: process.env.AI_DEEP_ANALYSIS_ENABLED === "true"
      },
      pricing: pricing.map((row: any) => ({
        ...row,
        inputMicrousdPerMillion: asString(row.inputMicrousdPerMillion),
        cachedInputMicrousdPerMillion: asString(row.cachedInputMicrousdPerMillion),
        cacheWriteMicrousdPerMillion: row.cacheWriteMicrousdPerMillion === null ? null : asString(row.cacheWriteMicrousdPerMillion),
        outputMicrousdPerMillion: asString(row.outputMicrousdPerMillion)
      })),
      metrics: {
        runs: Number(metrics._count?.id ?? 0),
        chargedCredits: asString(metrics._sum?.chargedCredits),
        providerCostMicrousd: asString(metrics._sum?.providerCostMicrousd),
        retailCostMicrousd: asString(metrics._sum?.retailCostMicrousd)
      }
    });
  });

  app.post("/admin/ai/pricing", requireAuth, async (req, res) => {
    if (!(await requireAdminOr403(res, deps.requireSuperadmin))) return;
    const parsed = pricingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const effectiveFrom = parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : new Date();
    const actor = getUserFromLocals(res);
    const created = await deps.db.$transaction(async (tx: any) => {
      const latest = await tx.aiModelPricing.findFirst({
        where: { provider: "openai", model: parsed.data.model, serviceTier: "default", processingRegion: "global" },
        orderBy: { revision: "desc" }
      });
      await tx.aiModelPricing.updateMany({
        where: { provider: "openai", model: parsed.data.model, serviceTier: "default", processingRegion: "global", isActive: true, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: effectiveFrom } }] },
        data: { effectiveUntil: effectiveFrom }
      });
      return tx.aiModelPricing.create({
        data: {
          id: randomUUID(),
          provider: "openai",
          model: parsed.data.model,
          serviceTier: "default",
          processingRegion: "global",
          inputMicrousdPerMillion: BigInt(parsed.data.inputMicrousdPerMillion),
          cachedInputMicrousdPerMillion: BigInt(parsed.data.cachedInputMicrousdPerMillion),
          cacheWriteMicrousdPerMillion: parsed.data.cacheWriteMicrousdPerMillion === null ? null : BigInt(parsed.data.cacheWriteMicrousdPerMillion),
          outputMicrousdPerMillion: BigInt(parsed.data.outputMicrousdPerMillion),
          longContextThresholdTokens: parsed.data.longContextThresholdTokens,
          longInputMultiplierBps: parsed.data.longInputMultiplierBps,
          longOutputMultiplierBps: parsed.data.longOutputMultiplierBps,
          markupBps: parsed.data.markupBps,
          revision: Number(latest?.revision ?? 0) + 1,
          effectiveFrom
        }
      });
    });
    await deps.recordAdminAuditEvent?.({ actorUserId: actor.id, action: "ai_pricing_revision_created", targetType: "AiModelPricing", targetId: created.id, metadata: { model: parsed.data.model, revision: created.revision } });
    return res.status(201).json({ id: created.id, revision: created.revision });
  });
}
