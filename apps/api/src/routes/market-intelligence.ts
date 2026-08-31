import type express from "express";
import type { Express } from "express";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  getMarketIntelligenceService,
  MarketIntelligenceInsufficientDataError
} from "../services/marketIntelligence/service.js";

const horizonSchema = z.enum(["intraday", "24h", "7d"]);
const contextQuerySchema = z.object({
  symbol: z.string().trim().max(32).optional(),
  horizon: horizonSchema.default("24h")
});
const analysisCreateSchema = z.object({
  requestId: z.string().uuid(),
  horizon: horizonSchema.default("24h"),
  responseLanguage: z.enum(["de", "en"]).default("en")
});
const analysisListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).max(191).optional()
});
const providerUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  usageStatus: z.enum(["pending_review", "approved", "blocked"]).optional(),
  termsReviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fetchIntervalMinutes: z.number().int().min(5).max(1440).optional()
}).refine((value) => Object.keys(value).length > 0, { message: "empty_update" });

export function registerMarketIntelligenceRoutes(
  app: Express,
  deps: {
    db: any;
    requireSuperadmin: (res: express.Response) => Promise<boolean>;
    hasAdminBackendAccess?: (user: { id: string; email: string }) => Promise<boolean>;
    resolvePlanCapabilitiesForUserId(input: {
      userId: string;
    }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
    isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
    sendCapabilityDenied(
      res: express.Response,
      params: { capability: CapabilityKey; currentPlan: PlanTier; legacyCode?: string }
    ): express.Response;
    service?: ReturnType<typeof getMarketIntelligenceService>;
    refreshJob?: {
      runCycle: (reason: "startup" | "scheduled" | "manual", scope?: "all" | "news" | "economic_calendar") => Promise<void>;
      getStatus: () => unknown;
    };
  }
) {
  const service = deps.service ?? getMarketIntelligenceService(deps.db);

  async function requireMarketIntelligenceOrRespond(res: express.Response): Promise<boolean> {
    const user = getUserFromLocals(res);
    if (deps.hasAdminBackendAccess && (await deps.hasAdminBackendAccess(user))) return true;
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (deps.isCapabilityAllowed(capabilityContext.capabilities, "product.market_intelligence")) {
      return true;
    }
    deps.sendCapabilityDenied(res, {
      capability: "product.market_intelligence",
      currentPlan: capabilityContext.plan,
      legacyCode: "market_intelligence_not_available"
    });
    return false;
  }

  app.get("/market-intelligence/context", requireAuth, async (req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    const parsed = contextQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    try {
      return res.json(await service.getMarketContext(parsed.data));
    } catch (error) {
      return res.status(503).json({ error: "market_intelligence_context_unavailable", reason: String(error) });
    }
  });

  app.get("/market-intelligence/summary", requireAuth, async (req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    const parsed = contextQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    try {
      const user = getUserFromLocals(res);
      return res.json(await service.getDailySummary({
        ...parsed.data,
        billingUserId: user.id
      }));
    } catch (error) {
      return res.status(503).json({ error: "market_intelligence_summary_unavailable", reason: String(error) });
    }
  });

  app.get("/market-intelligence/providers", requireAuth, async (_req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    return res.json({
      items: await service.getProviderStates(),
      generatedAt: new Date().toISOString()
    });
  });

  app.post("/market-intelligence/analyses", requireAuth, async (req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    const parsed = analysisCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      const result = await service.createAnalysis({ userId: user.id, ...parsed.data });
      return res.status(result.existing ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof MarketIntelligenceInsufficientDataError) {
        return res.status(503).json({ error: "market_intelligence_insufficient_data" });
      }
      return res.status(503).json({ error: "market_intelligence_analysis_failed", reason: String(error) });
    }
  });

  app.get("/market-intelligence/analyses", requireAuth, async (req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    const parsed = analysisListSchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      return res.json(await service.listAnalyses({ userId: user.id, ...parsed.data }));
    } catch (error) {
      return res.status(503).json({ error: "market_intelligence_analyses_unavailable", reason: String(error) });
    }
  });

  app.get("/market-intelligence/analyses/:id", requireAuth, async (req, res) => {
    if (!(await requireMarketIntelligenceOrRespond(res))) return;
    const analysisId = String(req.params.id ?? "").trim();
    if (!analysisId || analysisId.length > 191) return res.status(400).json({ error: "invalid_analysis_id" });
    const user = getUserFromLocals(res);
    try {
      const analysis = await service.getAnalysis({ userId: user.id, analysisId });
      if (!analysis) return res.status(404).json({ error: "market_intelligence_analysis_not_found" });
      return res.json({ analysis });
    } catch (error) {
      return res.status(503).json({ error: "market_intelligence_analysis_unavailable", reason: String(error) });
    }
  });

  app.get("/news/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    if (!id || id.length > 191) return res.status(400).json({ error: "invalid_news_id" });
    const item = await service.getNewsItem(id);
    if (!item) return res.status(404).json({ error: "news_item_not_found" });
    return res.json({ item });
  });

  app.get("/admin/market-intelligence/providers", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json({
      items: await service.getProviderStates(),
      refresh: deps.refreshJob?.getStatus() ?? null,
      generatedAt: new Date().toISOString()
    });
  });

  app.put("/admin/market-intelligence/providers/:providerId", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
    const parsed = providerUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try {
      const settings = await service.updateProviderSettings(providerId, parsed.data);
      const actor = getUserFromLocals(res);
      try {
        await deps.db.adminAuditEvent?.create?.({
          data: {
            actorUserId: actor.id,
            action: "market_intelligence.provider.update",
            targetType: "market_data_provider",
            targetId: providerId,
            targetLabel: providerId,
            metadata: parsed.data,
            ip: req.ip ?? null
          }
        });
      } catch {
        // The provider setting is authoritative; audit persistence must not roll it back.
      }
      return res.json({ ok: true, providerId, settings: settings[providerId] });
    } catch (error) {
      return res.status(500).json({ error: "provider_settings_update_failed", reason: String(error) });
    }
  });

  app.post("/admin/market-intelligence/refresh", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.refreshJob) return res.status(404).json({ error: "market_intelligence_refresh_not_available" });
    const scopeSchema = z.object({ scope: z.enum(["all", "news", "economic_calendar"]).default("all") });
    const parsed = scopeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    await deps.refreshJob.runCycle("manual", parsed.data.scope);
    const actor = getUserFromLocals(res);
    try {
      await deps.db.adminAuditEvent?.create?.({
        data: {
          actorUserId: actor.id,
          action: "market_intelligence.provider.resync",
          targetType: "market_data_provider_group",
          targetId: parsed.data.scope,
          targetLabel: parsed.data.scope,
          metadata: { scope: parsed.data.scope },
          ip: req.ip ?? null
        }
      });
    } catch {
      // Manual refresh completion remains visible through the job status response.
    }
    return res.json({ ok: true, status: deps.refreshJob.getStatus() });
  });
}
