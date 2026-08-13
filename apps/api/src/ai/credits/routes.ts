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

function warningLevel(balance: bigint, available: bigint): "none" | "low_20" | "low_10" | "exhausted" {
  if (available <= 0n) return "exhausted";
  if (balance <= 0n) return "none";
  const percent = available * 100n / balance;
  if (percent <= 10n) return "low_10";
  if (percent <= 20n) return "low_20";
  return "none";
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
      balance: asString(summary.balance),
      reserved: asString(summary.reserved),
      available: asString(summary.available),
      usedLifetime: asString(summary.usedLifetime),
      usedToday: asString(summary.usedToday),
      usedThisMonth: asString(summary.usedThisMonth),
      dailyLimit: summary.dailyLimit?.toString() ?? null,
      monthlyLimit: summary.monthlyLimit?.toString() ?? null,
      maxRunCredits: summary.maxRunCredits?.toString() ?? null,
      warningLevel: warningLevel(summary.balance, summary.available),
      topups: topups.map((row: any) => ({ ...row, aiCredits: asString(row.aiCredits) }))
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
    const take = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
    const runs = await deps.db.aiAgentRun.findMany({
      where: { userId: user.id, modelCallCount: { gt: 0 } },
      select: { id: true, scope: true, status: true, modelClass: true, chargedCredits: true, providerCostMicrousd: true, retailCostMicrousd: true, modelCallCount: true, createdAt: true, completedAt: true },
      orderBy: { createdAt: "desc" },
      take
    });
    return res.json({
      items: runs.map((run: any) => ({
        ...run,
        chargedCredits: asString(run.chargedCredits),
        providerCostMicrousd: asString(run.providerCostMicrousd),
        retailCostMicrousd: asString(run.retailCostMicrousd)
      }))
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
