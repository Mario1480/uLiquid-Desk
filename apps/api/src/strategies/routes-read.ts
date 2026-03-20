import express from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";

const localStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const compositeStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

export type RegisterStrategyReadRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  readUserFromLocals(res: express.Response): { id: string; email: string };
  resolvePlanCapabilitiesForUserId(input: {
    userId: string;
  }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
  sendCapabilityDenied(
    res: express.Response,
    params: {
      capability: CapabilityKey;
      currentPlan: PlanTier;
      legacyCode?: string;
    }
  ): express.Response;
  isStrategyFeatureEnabledForUser(user: { id: string; email: string }): Promise<boolean>;
  getAiPromptIndicatorOptionsPublic(): any;
  listUserAiPromptTemplates(userId: string): Promise<any[]>;
  resolveStrategyEntitlementsPublicForUser(user: { id: string; email: string }): Promise<any>;
  parseStoredAiPromptSettings(value: unknown): any;
  GLOBAL_SETTING_AI_PROMPTS_KEY: string;
  isSuperadminEmail(email: string): boolean;
  getPublicAiPromptTemplates(settings: any): any[];
  canUseStrategyKindByEntitlements(entitlements: any, kind: "local" | "ai" | "composite"): boolean;
  canUseStrategyIdByEntitlements(entitlements: any, kind: "local" | "ai" | "composite", id: string): boolean;
  readAiPromptLicensePolicyPublic(): any;
  listPythonStrategyRegistry(): Promise<any>;
  listLocalStrategyRegistryPublic(): any;
  getBuiltinLocalStrategyTemplates(): any;
  localStrategiesStoreReady(): boolean;
  mapLocalStrategyDefinitionPublic(row: any): any;
  compositeStrategiesStoreReady(): boolean;
  mapCompositeStrategyPublic(row: any): any;
  GLOBAL_SETTING_AI_TRACE_KEY: string;
  parseStoredAiTraceSettings(value: unknown): any;
  DEFAULT_AI_TRACE_SETTINGS: any;
  getAiPayloadBudgetTelemetrySnapshot(): any;
  getAiQualityGateTelemetrySnapshot(): any;
};

export function registerStrategyReadRoutes(
  app: express.Express,
  deps: RegisterStrategyReadRoutesDeps
) {
  async function resolveProductCapabilityAccess(
    res: express.Response,
    capability: CapabilityKey
  ) {
    const user = deps.readUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
      userId: user.id
    });
    return {
      user,
      capabilityContext,
      allowed: deps.isCapabilityAllowed(capabilityContext.capabilities, capability)
    };
  }

  app.get("/settings/ai-prompts/own", requireAuth, async (_req, res) => {
    const access = await resolveProductCapabilityAccess(res, "product.ai_predictions");
    const user = access.user;
    const strategyFeatureEnabled = await deps.isStrategyFeatureEnabledForUser(user);
    if (!access.allowed || !strategyFeatureEnabled) {
      return res.json({
        items: [],
        availableIndicators: deps.getAiPromptIndicatorOptionsPublic(),
        strategyFeatureEnabled: false,
        updatedAt: null
      });
    }

    const items = await deps.listUserAiPromptTemplates(user.id);
    return res.json({
      items,
      availableIndicators: deps.getAiPromptIndicatorOptionsPublic(),
      strategyFeatureEnabled: true,
      updatedAt: items[0]?.updatedAt ?? null
    });
  });

  app.get("/settings/ai-prompts/public", requireAuth, async (_req, res) => {
    const access = await resolveProductCapabilityAccess(res, "product.ai_predictions");
    const user = access.user;
    const strategyEntitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!access.allowed) {
      return res.json({
        items: [],
        licensePolicy: deps.readAiPromptLicensePolicyPublic(),
        strategyEntitlements,
        updatedAt: null
      });
    }
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_AI_PROMPTS_KEY },
      select: { value: true, updatedAt: true }
    });
    const settings = deps.parseStoredAiPromptSettings(row?.value);
    const isSuperadmin = deps.isSuperadminEmail(user.email);
    const visiblePrompts = isSuperadmin ? settings.prompts : deps.getPublicAiPromptTemplates(settings);
    const kindAllowed = deps.canUseStrategyKindByEntitlements(strategyEntitlements, "ai");
    const idFilteredPrompts = kindAllowed
      ? visiblePrompts.filter((item: any) =>
          deps.canUseStrategyIdByEntitlements(strategyEntitlements, "ai", String(item.id))
        )
      : [];

    return res.json({
      items: idFilteredPrompts.map((item: any) => ({
        id: item.id,
        name: item.name,
        promptText: item.promptText,
        indicatorKeys: item.indicatorKeys,
        ohlcvBars: item.ohlcvBars,
        timeframes: item.timeframes,
        runTimeframe: item.runTimeframe,
        timeframe: item.timeframe,
        directionPreference: item.directionPreference,
        confidenceTargetPct: item.confidenceTargetPct,
        slTpSource: item.slTpSource,
        newsRiskMode: item.newsRiskMode,
        promptMode: item.promptMode,
        isPublic: item.isPublic,
        updatedAt: item.updatedAt
      })),
      licensePolicy: deps.readAiPromptLicensePolicyPublic(),
      strategyEntitlements,
      updatedAt: row?.updatedAt ?? null
    });
  });

  app.get("/admin/local-strategies/registry", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.local_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.local_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    const pythonRegistry = await deps.listPythonStrategyRegistry();
    return res.json({
      items: deps.listLocalStrategyRegistryPublic(),
      templates: deps.getBuiltinLocalStrategyTemplates(),
      pythonRegistry
    });
  });

  app.get("/admin/local-strategies/python/registry", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.local_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.local_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    const pythonRegistry = await deps.listPythonStrategyRegistry();
    return res.json(pythonRegistry);
  });

  app.get("/admin/local-strategies", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.local_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.local_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const rows = await deps.db.localStrategyDefinition.findMany({
      orderBy: { updatedAt: "desc" }
    });

    const pythonRegistry = await deps.listPythonStrategyRegistry();
    return res.json({
      items: rows.map((row: any) => deps.mapLocalStrategyDefinitionPublic(row)),
      registry: deps.listLocalStrategyRegistryPublic(),
      templates: deps.getBuiltinLocalStrategyTemplates(),
      pythonRegistry
    });
  });

  app.get("/admin/local-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.local_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.local_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }

    const row = await deps.db.localStrategyDefinition.findUnique({
      where: { id: params.data.id }
    });
    if (!row) {
      return res.status(404).json({ error: "not_found" });
    }

    const pythonRegistry = await deps.listPythonStrategyRegistry();
    return res.json({
      item: deps.mapLocalStrategyDefinitionPublic(row),
      registry: deps.listLocalStrategyRegistryPublic(),
      pythonRegistry
    });
  });

  app.get("/settings/composite-strategies", requireAuth, async (_req, res) => {
    const access = await resolveProductCapabilityAccess(res, "product.composite_strategies");
    const user = access.user;
    const entitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!access.allowed) {
      return res.json({
        items: [],
        strategyEntitlements: entitlements
      });
    }
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    if (!deps.canUseStrategyKindByEntitlements(entitlements, "composite")) {
      return res.json({
        items: [],
        strategyEntitlements: entitlements
      });
    }
    const rows = await deps.db.compositeStrategy.findMany({
      where: { isEnabled: true },
      orderBy: { updatedAt: "desc" }
    });
    return res.json({
      items: rows
        .filter((row: any) => deps.canUseStrategyIdByEntitlements(entitlements, "composite", String(row.id)))
        .map((row: any) => deps.mapCompositeStrategyPublic(row)),
      strategyEntitlements: entitlements
    });
  });

  app.get("/settings/local-strategies", requireAuth, async (_req, res) => {
    const access = await resolveProductCapabilityAccess(res, "product.local_strategies");
    const user = access.user;
    const entitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!access.allowed) {
      return res.json({
        items: [],
        strategyEntitlements: entitlements
      });
    }
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }
    if (!deps.canUseStrategyKindByEntitlements(entitlements, "local")) {
      return res.json({
        items: [],
        strategyEntitlements: entitlements
      });
    }
    const rows = await deps.db.localStrategyDefinition.findMany({
      where: { isEnabled: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        strategyType: true,
        name: true,
        description: true,
        version: true,
        updatedAt: true
      }
    });
    return res.json({
      items: rows
        .filter((row: any) => deps.canUseStrategyIdByEntitlements(entitlements, "local", String(row.id)))
        .map((row: any) => ({
          id: row.id,
          strategyType: row.strategyType,
          name: row.name,
          description: row.description ?? null,
          version: row.version,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
        })),
      strategyEntitlements: entitlements
    });
  });

  app.get("/settings/strategy-entitlements", requireAuth, async (_req, res) => {
    const user = deps.readUserFromLocals(res);
    const entitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    return res.json({ entitlements });
  });

  app.get("/admin/composite-strategies", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.composite_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.composite_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const rows = await deps.db.compositeStrategy.findMany({
      orderBy: { updatedAt: "desc" }
    });
    return res.json({
      items: rows.map((row: any) => deps.mapCompositeStrategyPublic(row))
    });
  });

  app.get("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.composite_strategies");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.composite_strategies",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const row = await deps.db.compositeStrategy.findUnique({
      where: { id: params.data.id }
    });
    if (!row) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json({
      item: deps.mapCompositeStrategyPublic(row)
    });
  });

  app.get("/admin/settings/ai-trace", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const access = await resolveProductCapabilityAccess(res, "product.ai_predictions");
    if (!access.allowed) {
      return deps.sendCapabilityDenied(res, {
        capability: "product.ai_predictions",
        currentPlan: access.capabilityContext.plan,
        legacyCode: "strategy_license_blocked"
      });
    }
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_AI_TRACE_KEY },
      select: { value: true, updatedAt: true }
    });
    const settings = deps.parseStoredAiTraceSettings(row?.value);

    return res.json({
      ...settings,
      updatedAt: row?.updatedAt ?? null,
      source: row ? "db" : "default",
      defaults: deps.DEFAULT_AI_TRACE_SETTINGS,
      payloadBudget: deps.getAiPayloadBudgetTelemetrySnapshot(),
      qualityGate: deps.getAiQualityGateTelemetrySnapshot()
    });
  });
}
