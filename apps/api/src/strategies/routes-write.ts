import express from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { requireAuth } from "../auth.js";

const localStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const compositeStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const userAiPromptTemplateIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

export type RegisterStrategyWriteRoutesDeps = {
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
  readAiPromptLicensePolicyPublic(): any;
  parseStoredAiPromptSettings(value: unknown): any;
  GLOBAL_SETTING_AI_PROMPTS_KEY: string;
  DEFAULT_AI_PROMPT_SETTINGS: any;
  invalidateAiPromptSettingsCache(): void;
  setGlobalSettingValue(key: string, value: unknown): Promise<{ value: unknown; updatedAt: Date | string | null }>;
  normalizeAiPromptSettingsPayload(payload: any, nowIso: string): { settings: any; invalidKeys: string[]; duplicatePromptIds: string[] };
  resolveAiPromptRuntimeSettingsForContext(settings: any, context: any, source: "db" | "default"): any;
  buildPredictionExplainerPromptPreview(input: any, deps: any): Promise<any>;
  resolveSelectedAiPromptIndicators(indicatorKeys: readonly string[]): {
    selectedIndicators: any[];
    invalidKeys: string[];
  };
  generateHybridPromptText(input: any): Promise<{ promptText: string; mode: "ai" | "fallback"; model: string }>;
  getAiModel(): string;
  createGeneratedPromptDraft(input: any): { promptId: string; payload: any };
  createUserAiPromptTemplate(input: any): Promise<any>;
  deleteUserAiPromptTemplateById(userId: string, id: string): Promise<boolean>;
  adminAiPromptsSchema: any;
  adminAiPromptsPreviewSchema: any;
  adminAiPromptsGeneratePreviewSchema: any;
  adminAiPromptsGenerateSaveSchema: any;
  userAiPromptsGeneratePreviewSchema: any;
  userAiPromptsGenerateSaveSchema: any;
  localStrategyDefinitionSchema: any;
  localStrategyDefinitionUpdateSchema: any;
  localStrategyRunSchema: any;
  compositeStrategyCreateSchema: any;
  compositeStrategyUpdateSchema: any;
  compositeStrategyDryRunSchema: any;
  adminAiTraceSettingsSchema: any;
  adminAiTraceLogsQuerySchema: any;
  adminAiTraceCleanupSchema: any;
  getRegisteredLocalStrategy(type: string): any;
  listRegisteredLocalStrategies(): Array<{ type: string; defaultConfig: any; uiSchema: any }>;
  listLocalFallbackStrategyTypes(): string[];
  resolvePythonFallbackStrategyType(params: {
    requestedFallbackStrategyType: string | null | undefined;
    strategyType: string;
    remoteStrategyType: string;
    availableTypes: string[];
  }): { value: string | null; invalidValue: string | null };
  getBuiltinLocalStrategyTemplates(): any[];
  mapLocalStrategyDefinitionPublic(row: any): any;
  localStrategiesStoreReady(): boolean;
  resolveStrategyEntitlementsPublicForUser(user: { id: string; email: string }): Promise<any>;
  evaluateStrategySelectionAccess(params: {
    entitlements: any;
    kind: "local" | "ai" | "composite";
    strategyId?: string | null;
    aiModel?: string | null;
    compositeNodes?: number | null;
  }): { allowed: boolean; reason?: string; maxCompositeNodes?: number | null };
  runLocalStrategy(id: string, featureSnapshot: Record<string, unknown>, ctx?: Record<string, unknown>): Promise<any>;
  compositeStrategiesStoreReady(): boolean;
  validateCompositeStrategyPayload(payload: any): Promise<{ graph: any; validation: { valid: boolean; errors?: string[] } }>;
  mapCompositeStrategyPublic(row: any): any;
  countCompositeStrategyNodes(strategy: any): number;
  toJsonRecord(value: unknown): Record<string, unknown>;
  PREDICTION_TIMEFRAMES: Set<string>;
  PREDICTION_MARKET_TYPES: Set<string>;
  runCompositeStrategy(input: any, refs: any): Promise<any>;
  getAiPromptTemplateById(id: string): Promise<any>;
  GLOBAL_SETTING_AI_TRACE_KEY: string;
  parseStoredAiTraceSettings(value: unknown): any;
  DEFAULT_AI_TRACE_SETTINGS: any;
  invalidateAiTraceSettingsCache(): void;
  getAiTraceSettingsCached(): Promise<{ settings: any; source: string }>;
  getAiPayloadBudgetTelemetrySnapshot(): any;
  getAiQualityGateTelemetrySnapshot(): any;
};

export function registerStrategyWriteRoutes(
  app: express.Express,
  deps: RegisterStrategyWriteRoutesDeps
) {
  async function requireProductCapability(
    res: express.Response,
    capability: CapabilityKey,
    legacyCode = "strategy_license_blocked"
  ): Promise<boolean> {
    const user = deps.readUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
      userId: user.id
    });
    if (deps.isCapabilityAllowed(capabilityContext.capabilities, capability)) {
      return true;
    }
    deps.sendCapabilityDenied(res, {
      capability,
      currentPlan: capabilityContext.plan,
      legacyCode
    });
    return false;
  }

  app.get("/admin/settings/ai-prompts", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_AI_PROMPTS_KEY },
      select: { value: true, updatedAt: true }
    });
    const settings = deps.parseStoredAiPromptSettings(row?.value);

    return res.json({
      activePromptId: settings.activePromptId,
      prompts: settings.prompts,
      availableIndicators: deps.getAiPromptIndicatorOptionsPublic(),
      licensePolicy: deps.readAiPromptLicensePolicyPublic(),
      updatedAt: row?.updatedAt ?? null,
      source: row ? "db" : "default",
      defaults: deps.DEFAULT_AI_PROMPT_SETTINGS
    });
  });

  app.put("/admin/settings/ai-prompts", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const parsed = deps.adminAiPromptsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const normalized = deps.normalizeAiPromptSettingsPayload(parsed.data, new Date().toISOString());
    if (normalized.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: normalized.invalidKeys }
      });
    }
    if (normalized.duplicatePromptIds.length > 0) {
      return res.status(409).json({
        error: "duplicate_prompt_id",
        details: { duplicatePromptIds: normalized.duplicatePromptIds }
      });
    }

    const sanitized = deps.parseStoredAiPromptSettings(normalized.settings);
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_AI_PROMPTS_KEY, sanitized);
    const settings = deps.parseStoredAiPromptSettings(updated.value);
    deps.invalidateAiPromptSettingsCache();

    return res.json({
      activePromptId: settings.activePromptId,
      prompts: settings.prompts,
      availableIndicators: deps.getAiPromptIndicatorOptionsPublic(),
      licensePolicy: deps.readAiPromptLicensePolicyPublic(),
      updatedAt: updated.updatedAt,
      source: "db",
      defaults: deps.DEFAULT_AI_PROMPT_SETTINGS
    });
  });

  app.post("/admin/settings/ai-prompts/generate-preview", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const parsed = deps.adminAiPromptsGeneratePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const selected = deps.resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
    if (selected.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: selected.invalidKeys }
      });
    }

    const generation = await deps.generateHybridPromptText({
      strategyDescription: parsed.data.strategyDescription,
      selectedIndicators: selected.selectedIndicators,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null
    }).catch(() => null);

    if (!generation) {
      return res.status(500).json({ error: "generation_failed" });
    }

    return res.json({
      generatedPromptText: generation.promptText,
      generationMeta: {
        mode: generation.mode,
        model: generation.model
      }
    });
  });

  app.post("/admin/settings/ai-prompts/generate-save", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const parsed = deps.adminAiPromptsGenerateSaveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const selected = deps.resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
    if (selected.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: selected.invalidKeys }
      });
    }

    const nowIso = new Date().toISOString();
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_AI_PROMPTS_KEY },
      select: { value: true }
    });
    const existingSettings = deps.parseStoredAiPromptSettings(row?.value);

    let generatedPromptText = "";
    let generationMode: "ai" | "fallback" = "fallback";
    let generationModel = parsed.data.generationMeta?.model ?? deps.getAiModel();

    if (typeof parsed.data.generatedPromptText === "string") {
      const provided = parsed.data.generatedPromptText.trim();
      if (!provided) {
        return res.status(400).json({
          error: "invalid_payload",
          details: { reason: "generatedPromptText must not be empty" }
        });
      }
      generatedPromptText = provided;
      generationMode = parsed.data.generationMeta?.mode ?? "fallback";
    } else {
      const generation = await deps.generateHybridPromptText({
        strategyDescription: parsed.data.strategyDescription,
        selectedIndicators: selected.selectedIndicators,
        timeframes: parsed.data.timeframes,
        runTimeframe: parsed.data.runTimeframe ?? null
      }).catch(() => null);

      if (!generation) {
        return res.status(500).json({ error: "generation_failed" });
      }

      generatedPromptText = generation.promptText;
      generationMode = generation.mode;
      generationModel = generation.model;
    }

    let draftPayload: { activePromptId: string | null; prompts: any[] };
    let promptId = "";
    try {
      const draft = deps.createGeneratedPromptDraft({
        existingSettings,
        name: parsed.data.name,
        promptText: generatedPromptText,
        indicatorKeys: selected.selectedIndicators.map((item) => item.key),
        ohlcvBars: parsed.data.ohlcvBars,
        timeframes: parsed.data.timeframes,
        runTimeframe: parsed.data.runTimeframe ?? null,
        promptMode: parsed.data.promptMode,
        directionPreference: parsed.data.directionPreference,
        confidenceTargetPct: parsed.data.confidenceTargetPct,
        slTpSource: parsed.data.slTpSource,
        newsRiskMode: parsed.data.newsRiskMode,
        setActive: parsed.data.setActive,
        isPublic: parsed.data.isPublic,
        nowIso
      });
      promptId = draft.promptId;
      draftPayload = draft.payload;
    } catch (error) {
      return res.status(400).json({
        error: "invalid_payload",
        details: { reason: String(error) }
      });
    }

    const normalized = deps.normalizeAiPromptSettingsPayload(draftPayload, nowIso);
    if (normalized.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: normalized.invalidKeys }
      });
    }
    if (normalized.duplicatePromptIds.length > 0) {
      return res.status(409).json({
        error: "duplicate_prompt_id",
        details: { duplicatePromptIds: normalized.duplicatePromptIds }
      });
    }

    const sanitized = deps.parseStoredAiPromptSettings(normalized.settings);
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_AI_PROMPTS_KEY, sanitized);
    const settings = deps.parseStoredAiPromptSettings(updated.value);
    deps.invalidateAiPromptSettingsCache();

    const savedPrompt = settings.prompts.find((item: any) => item.id === promptId) ?? null;
    if (!savedPrompt) {
      return res.status(500).json({ error: "generation_failed" });
    }

    return res.json({
      prompt: savedPrompt,
      activePromptId: settings.activePromptId,
      generatedPromptText: savedPrompt.promptText,
      generationMeta: {
        mode: generationMode,
        model: generationModel
      },
      updatedAt: updated.updatedAt
    });
  });

  app.post("/admin/settings/ai-prompts/preview", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const parsed = deps.adminAiPromptsPreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    let settings: any;
    if (parsed.data.settingsDraft !== undefined) {
      const draftParsed = deps.adminAiPromptsSchema.safeParse(parsed.data.settingsDraft);
      if (!draftParsed.success) {
        return res.status(400).json({
          error: "invalid_settings_draft",
          details: draftParsed.error.flatten()
        });
      }
      const normalizedDraft = deps.normalizeAiPromptSettingsPayload(
        draftParsed.data,
        new Date().toISOString()
      );
      if (normalizedDraft.invalidKeys.length > 0) {
        return res.status(400).json({
          error: "invalid_indicator_keys",
          details: { invalidKeys: normalizedDraft.invalidKeys }
        });
      }
      if (normalizedDraft.duplicatePromptIds.length > 0) {
        return res.status(409).json({
          error: "duplicate_prompt_id",
          details: { duplicatePromptIds: normalizedDraft.duplicatePromptIds }
        });
      }
      settings = deps.parseStoredAiPromptSettings(normalizedDraft.settings);
    } else {
      const row = await deps.db.globalSetting.findUnique({
        where: { key: deps.GLOBAL_SETTING_AI_PROMPTS_KEY },
        select: { value: true }
      });
      settings = deps.parseStoredAiPromptSettings(row?.value);
    }

    const context = {
      exchange: parsed.data.exchange ?? null,
      accountId: parsed.data.accountId ?? null,
      symbol: parsed.data.symbol,
      timeframe: parsed.data.timeframe
    };
    const runtimeSettings = deps.resolveAiPromptRuntimeSettingsForContext(
      settings,
      context,
      "db"
    );

    const promptInput = {
      symbol: parsed.data.symbol,
      marketType: parsed.data.marketType,
      timeframe: parsed.data.timeframe,
      tsCreated: parsed.data.tsCreated ?? new Date().toISOString(),
      prediction: parsed.data.prediction ?? {
        signal: "neutral" as const,
        expectedMovePct: 0.8,
        confidence: 0.5
      },
      featureSnapshot: parsed.data.featureSnapshot ?? {}
    };

    const preview = await deps.buildPredictionExplainerPromptPreview(promptInput, {
      promptSettings: runtimeSettings,
      promptScopeContext: context
    });

    return res.json({
      scopeContext: preview.scopeContext,
      runtimeSettings: preview.runtimeSettings,
      systemMessage: preview.systemMessage,
      cacheKey: preview.cacheKey,
      userPayload: preview.userPayload
    });
  });

  app.post("/settings/ai-prompts/own/generate-preview", requireAuth, async (req, res) => {
    const user = deps.readUserFromLocals(res);
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const strategyFeatureEnabled = await deps.isStrategyFeatureEnabledForUser(user);
    if (!strategyFeatureEnabled) {
      return res.status(403).json({ error: "forbidden" });
    }

    const parsed = deps.userAiPromptsGeneratePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const selected = deps.resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
    if (selected.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: selected.invalidKeys }
      });
    }

    const generation = await deps.generateHybridPromptText({
      strategyDescription: parsed.data.strategyDescription,
      selectedIndicators: selected.selectedIndicators,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null,
      billingUserId: user.id
    }).catch(() => null);

    if (!generation) {
      return res.status(500).json({ error: "generation_failed" });
    }

    return res.json({
      generatedPromptText: generation.promptText,
      generationMeta: {
        mode: generation.mode,
        model: generation.model
      }
    });
  });

  app.post("/settings/ai-prompts/own/generate-save", requireAuth, async (req, res) => {
    const user = deps.readUserFromLocals(res);
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const strategyFeatureEnabled = await deps.isStrategyFeatureEnabledForUser(user);
    if (!strategyFeatureEnabled) {
      return res.status(403).json({ error: "forbidden" });
    }

    const parsed = deps.userAiPromptsGenerateSaveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const selected = deps.resolveSelectedAiPromptIndicators(parsed.data.indicatorKeys);
    if (selected.invalidKeys.length > 0) {
      return res.status(400).json({
        error: "invalid_indicator_keys",
        details: { invalidKeys: selected.invalidKeys }
      });
    }

    let generatedPromptText = "";
    let generationMode: "ai" | "fallback" = "fallback";
    let generationModel = parsed.data.generationMeta?.model ?? deps.getAiModel();

    if (typeof parsed.data.generatedPromptText === "string") {
      const provided = parsed.data.generatedPromptText.trim();
      if (!provided) {
        return res.status(400).json({
          error: "invalid_payload",
          details: { reason: "generatedPromptText must not be empty" }
        });
      }
      generatedPromptText = provided;
      generationMode = parsed.data.generationMeta?.mode ?? "fallback";
    } else {
      const generation = await deps.generateHybridPromptText({
        strategyDescription: parsed.data.strategyDescription,
        selectedIndicators: selected.selectedIndicators,
        timeframes: parsed.data.timeframes,
        runTimeframe: parsed.data.runTimeframe ?? null,
        billingUserId: user.id
      }).catch(() => null);
      if (!generation) {
        return res.status(500).json({ error: "generation_failed" });
      }
      generatedPromptText = generation.promptText;
      generationMode = generation.mode;
      generationModel = generation.model;
    }

    const now = new Date();
    const prompt = await deps.createUserAiPromptTemplate({
      userId: user.id,
      name: parsed.data.name,
      promptText: generatedPromptText,
      indicatorKeys: selected.selectedIndicators.map((item) => item.key),
      ohlcvBars: parsed.data.ohlcvBars,
      timeframes: parsed.data.timeframes,
      runTimeframe: parsed.data.runTimeframe ?? null,
      promptMode: parsed.data.promptMode,
      directionPreference: parsed.data.directionPreference,
      confidenceTargetPct: parsed.data.confidenceTargetPct,
      slTpSource: parsed.data.slTpSource,
      newsRiskMode: parsed.data.newsRiskMode,
      now
    });

    return res.json({
      prompt,
      generatedPromptText: prompt.promptText,
      generationMeta: {
        mode: generationMode,
        model: generationModel
      },
      updatedAt: prompt.updatedAt
    });
  });

  app.delete("/settings/ai-prompts/own/:id", requireAuth, async (req, res) => {
    const user = deps.readUserFromLocals(res);
    if (!(await requireProductCapability(res, "product.ai_predictions"))) return;
    const strategyFeatureEnabled = await deps.isStrategyFeatureEnabledForUser(user);
    if (!strategyFeatureEnabled) {
      return res.status(403).json({ error: "forbidden" });
    }
    const parsed = userAiPromptTemplateIdParamSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_params", details: parsed.error.flatten() });
    }
    const deleted = await deps.deleteUserAiPromptTemplateById(user.id, parsed.data.id);
    if (!deleted) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json({ ok: true });
  });

  app.post("/admin/local-strategies", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.local_strategies"))) return;
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const parsed = deps.localStrategyDefinitionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const registration = deps.getRegisteredLocalStrategy(parsed.data.strategyType);
    if (parsed.data.engine === "ts" && !registration) {
      return res.status(400).json({
        error: "unknown_strategy_type",
        availableTypes: deps.listRegisteredLocalStrategies().map((entry) => entry.type)
      });
    }
    const fallbackTypes = deps.listLocalFallbackStrategyTypes();
    const remoteStrategyType =
      parsed.data.engine === "python"
        ? (parsed.data.remoteStrategyType?.trim() || parsed.data.strategyType)
        : null;
    const fallbackResolution =
      parsed.data.engine === "python"
        ? deps.resolvePythonFallbackStrategyType({
            requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
            strategyType: parsed.data.strategyType,
            remoteStrategyType: remoteStrategyType ?? parsed.data.strategyType,
            availableTypes: fallbackTypes
          })
        : { value: null, invalidValue: null as string | null };
    if (fallbackResolution.invalidValue) {
      return res.status(400).json({
        error: "unknown_fallback_strategy_type",
        availableTypes: fallbackTypes
      });
    }

    const now = new Date();
    const template = deps.getBuiltinLocalStrategyTemplates().find(
      (item) => item.strategyType === parsed.data.strategyType
    );
    const configJson = Object.keys(parsed.data.configJson).length > 0
      ? parsed.data.configJson
      : (registration?.defaultConfig ?? {});
    const inputSchema = parsed.data.inputSchema ?? template?.inputSchema ?? null;

    const created = await deps.db.localStrategyDefinition.create({
      data: {
        strategyType: parsed.data.strategyType,
        engine: parsed.data.engine,
        shadowMode: parsed.data.engine === "python" ? parsed.data.shadowMode : false,
        remoteStrategyType,
        fallbackStrategyType: parsed.data.engine === "python" ? fallbackResolution.value : null,
        timeoutMs: parsed.data.engine === "python" ? (parsed.data.timeoutMs ?? null) : null,
        newsRiskMode: parsed.data.newsRiskMode,
        name: parsed.data.name.trim(),
        description:
          typeof parsed.data.description === "string" && parsed.data.description.trim()
            ? parsed.data.description.trim()
            : null,
        version: parsed.data.version.trim() || "1.0.0",
        inputSchema,
        configJson,
        isEnabled: parsed.data.isEnabled,
        createdAt: now,
        updatedAt: now
      }
    });

    return res.status(201).json({
      item: deps.mapLocalStrategyDefinitionPublic(created)
    });
  });

  app.put("/admin/local-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.local_strategies"))) return;
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const parsed = deps.localStrategyDefinitionUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const existing = await deps.db.localStrategyDefinition.findUnique({
      where: { id: params.data.id },
      select: {
        id: true,
        strategyType: true,
        engine: true,
        shadowMode: true,
        remoteStrategyType: true
      }
    });
    if (!existing) {
      return res.status(404).json({ error: "not_found" });
    }

    const effectiveEngine =
      parsed.data.engine !== undefined
        ? parsed.data.engine
        : (existing.engine === "python" ? "python" : "ts");
    const effectiveStrategyType =
      typeof parsed.data.strategyType === "string"
        ? parsed.data.strategyType
        : existing.strategyType;

    const fallbackTypes = deps.listLocalFallbackStrategyTypes();
    const effectiveRemoteStrategyType =
      typeof parsed.data.remoteStrategyType === "string" && parsed.data.remoteStrategyType.trim()
        ? parsed.data.remoteStrategyType.trim()
        : (
            typeof existing.remoteStrategyType === "string" && existing.remoteStrategyType.trim()
              ? existing.remoteStrategyType.trim()
              : effectiveStrategyType
          );

    if (effectiveEngine === "ts") {
      const registration = deps.getRegisteredLocalStrategy(effectiveStrategyType);
      if (!registration) {
        return res.status(400).json({
          error: "unknown_strategy_type",
          availableTypes: deps.listRegisteredLocalStrategies().map((entry) => entry.type)
        });
      }
    } else if (parsed.data.fallbackStrategyType !== undefined) {
      const fallbackResolution = deps.resolvePythonFallbackStrategyType({
        requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
        strategyType: effectiveStrategyType,
        remoteStrategyType: effectiveRemoteStrategyType,
        availableTypes: fallbackTypes
      });
      if (fallbackResolution.invalidValue) {
        return res.status(400).json({
          error: "unknown_fallback_strategy_type",
          availableTypes: fallbackTypes
        });
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.strategyType !== undefined) data.strategyType = parsed.data.strategyType;
    if (parsed.data.engine !== undefined) data.engine = parsed.data.engine;
    if (parsed.data.shadowMode !== undefined) data.shadowMode = parsed.data.shadowMode;
    if (parsed.data.remoteStrategyType !== undefined) data.remoteStrategyType = parsed.data.remoteStrategyType;
    if (parsed.data.timeoutMs !== undefined) data.timeoutMs = parsed.data.timeoutMs;
    if (parsed.data.newsRiskMode !== undefined) data.newsRiskMode = parsed.data.newsRiskMode;
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) {
      data.description =
        typeof parsed.data.description === "string" && parsed.data.description.trim()
          ? parsed.data.description.trim()
          : null;
    }
    if (effectiveEngine === "ts") {
      if (parsed.data.shadowMode === undefined) data.shadowMode = false;
      if (parsed.data.remoteStrategyType === undefined) data.remoteStrategyType = null;
      if (parsed.data.fallbackStrategyType === undefined) data.fallbackStrategyType = null;
      if (parsed.data.timeoutMs === undefined) data.timeoutMs = null;
    } else {
      if (parsed.data.fallbackStrategyType !== undefined) {
        data.fallbackStrategyType = deps.resolvePythonFallbackStrategyType({
          requestedFallbackStrategyType: parsed.data.fallbackStrategyType,
          strategyType: effectiveStrategyType,
          remoteStrategyType: effectiveRemoteStrategyType,
          availableTypes: fallbackTypes
        }).value;
      }
      if (parsed.data.remoteStrategyType === undefined && existing.engine !== "python") {
        data.remoteStrategyType = effectiveStrategyType;
      }
      if (parsed.data.fallbackStrategyType === undefined && existing.engine !== "python") {
        data.fallbackStrategyType = deps.resolvePythonFallbackStrategyType({
          requestedFallbackStrategyType: undefined,
          strategyType: effectiveStrategyType,
          remoteStrategyType: effectiveRemoteStrategyType,
          availableTypes: fallbackTypes
        }).value;
      }
    }
    if (parsed.data.version !== undefined) data.version = parsed.data.version.trim();
    if (parsed.data.inputSchema !== undefined) data.inputSchema = parsed.data.inputSchema;
    if (parsed.data.configJson !== undefined) data.configJson = parsed.data.configJson;
    if (parsed.data.isEnabled !== undefined) data.isEnabled = parsed.data.isEnabled;

    try {
      const updated = await deps.db.localStrategyDefinition.update({
        where: { id: params.data.id },
        data
      });
      return res.json({ item: deps.mapLocalStrategyDefinitionPublic(updated) });
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      throw error;
    }
  });

  app.delete("/admin/local-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.local_strategies"))) return;
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }

    try {
      await deps.db.localStrategyDefinition.delete({
        where: { id: params.data.id }
      });
      return res.json({ ok: true });
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/admin/local-strategies/:id/run", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.local_strategies"))) return;
    const user = deps.readUserFromLocals(res);
    const strategyEntitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!deps.localStrategiesStoreReady()) {
      return res.status(503).json({ error: "local_strategies_not_ready" });
    }

    const params = localStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const accessCheck = deps.evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: "local",
      strategyId: params.data.id
    });
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "strategy_license_blocked",
        reason: accessCheck.reason,
        maxCompositeNodes: accessCheck.maxCompositeNodes
      });
    }
    const parsed = deps.localStrategyRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const result = await deps.runLocalStrategy(
        params.data.id,
        parsed.data.featureSnapshot,
        parsed.data.ctx
      );
      return res.json({
        result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "strategy_not_found") {
        return res.status(404).json({ error: message });
      }
      if (message === "local_strategies_not_ready") {
        return res.status(503).json({ error: message });
      }
      if (message.startsWith("strategy_type_not_registered:")) {
        return res.status(409).json({ error: message });
      }
      if (message === "strategy_id_required") {
        return res.status(400).json({ error: message });
      }
      console.warn("[local-strategies] run failed", { id: params.data.id, reason: message });
      return res.status(500).json({ error: "strategy_execution_failed", message });
    }
  });

  app.post("/admin/composite-strategies", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.composite_strategies"))) return;
    const user = deps.readUserFromLocals(res);
    const strategyEntitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    const accessCheck = deps.evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: "composite",
      strategyId: null
    });
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "strategy_license_blocked",
        reason: accessCheck.reason,
        maxCompositeNodes: accessCheck.maxCompositeNodes
      });
    }
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const parsed = deps.compositeStrategyCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const validation = await deps.validateCompositeStrategyPayload({
      ...parsed.data,
      maxCompositeNodes: strategyEntitlements.maxCompositeNodes
    });
    if (!validation.validation.valid) {
      return res.status(400).json({
        error: "invalid_graph",
        details: validation.validation
      });
    }

    const created = await deps.db.compositeStrategy.create({
      data: {
        name: parsed.data.name.trim(),
        description:
          typeof parsed.data.description === "string" && parsed.data.description.trim()
            ? parsed.data.description.trim()
            : null,
        version: parsed.data.version.trim(),
        nodesJson: validation.graph.nodes,
        edgesJson: validation.graph.edges,
        combineMode: validation.graph.combineMode,
        outputPolicy: validation.graph.outputPolicy,
        newsRiskMode: parsed.data.newsRiskMode,
        isEnabled: parsed.data.isEnabled
      }
    });

    return res.status(201).json({
      item: deps.mapCompositeStrategyPublic(created),
      validation: validation.validation
    });
  });

  app.put("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.composite_strategies"))) return;
    const user = deps.readUserFromLocals(res);
    const strategyEntitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const accessCheck = deps.evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: "composite",
      strategyId: params.data.id
    });
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "strategy_license_blocked",
        reason: accessCheck.reason,
        maxCompositeNodes: accessCheck.maxCompositeNodes
      });
    }
    const parsed = deps.compositeStrategyUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const current = await deps.db.compositeStrategy.findUnique({
      where: { id: params.data.id }
    });
    if (!current) {
      return res.status(404).json({ error: "not_found" });
    }

    const mergedGraphInput = {
      nodesJson: parsed.data.nodesJson ?? current.nodesJson,
      edgesJson: parsed.data.edgesJson ?? current.edgesJson,
      combineMode: parsed.data.combineMode ?? current.combineMode,
      outputPolicy: parsed.data.outputPolicy ?? current.outputPolicy,
      maxCompositeNodes: strategyEntitlements.maxCompositeNodes
    };
    const validation = await deps.validateCompositeStrategyPayload(mergedGraphInput);
    if (!validation.validation.valid) {
      return res.status(400).json({
        error: "invalid_graph",
        details: validation.validation
      });
    }

    const updateData: Record<string, unknown> = {
      nodesJson: validation.graph.nodes,
      edgesJson: validation.graph.edges,
      combineMode: validation.graph.combineMode,
      outputPolicy: validation.graph.outputPolicy
    };
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) {
      updateData.description =
        typeof parsed.data.description === "string" && parsed.data.description.trim()
          ? parsed.data.description.trim()
          : null;
    }
    if (parsed.data.version !== undefined) updateData.version = parsed.data.version.trim();
    if (parsed.data.newsRiskMode !== undefined) updateData.newsRiskMode = parsed.data.newsRiskMode;
    if (parsed.data.isEnabled !== undefined) updateData.isEnabled = parsed.data.isEnabled;

    const updated = await deps.db.compositeStrategy.update({
      where: { id: params.data.id },
      data: updateData
    });

    return res.json({
      item: deps.mapCompositeStrategyPublic(updated),
      validation: validation.validation
    });
  });

  app.delete("/admin/composite-strategies/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.composite_strategies"))) return;
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    try {
      await deps.db.compositeStrategy.delete({
        where: { id: params.data.id }
      });
      return res.json({ ok: true });
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      throw error;
    }
  });

  app.post("/admin/composite-strategies/:id/dry-run", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!(await requireProductCapability(res, "product.composite_strategies"))) return;
    const user = deps.readUserFromLocals(res);
    const strategyEntitlements = await deps.resolveStrategyEntitlementsPublicForUser(user);
    if (!deps.compositeStrategiesStoreReady()) {
      return res.status(503).json({ error: "composite_strategies_not_ready" });
    }
    const params = compositeStrategyIdParamSchema.safeParse(req.params ?? {});
    if (!params.success) {
      return res.status(400).json({ error: "invalid_params", details: params.error.flatten() });
    }
    const parsed = deps.compositeStrategyDryRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const [strategy, prediction] = await Promise.all([
      deps.db.compositeStrategy.findUnique({ where: { id: params.data.id } }),
      deps.db.prediction.findUnique({ where: { id: parsed.data.predictionId } })
    ]);
    if (!strategy) {
      return res.status(404).json({ error: "composite_not_found" });
    }
    const accessCheck = deps.evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: "composite",
      strategyId: strategy.id,
      compositeNodes: deps.countCompositeStrategyNodes(strategy)
    });
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "strategy_license_blocked",
        reason: accessCheck.reason,
        maxCompositeNodes: accessCheck.maxCompositeNodes
      });
    }
    if (!prediction) {
      return res.status(404).json({ error: "prediction_not_found" });
    }

    const featureSnapshot = deps.toJsonRecord(prediction.featuresSnapshot);
    const signal = prediction.signal === "up" || prediction.signal === "down" || prediction.signal === "neutral"
      ? prediction.signal
      : "neutral";
    const timeframe = deps.PREDICTION_TIMEFRAMES.has(prediction.timeframe as string)
      ? prediction.timeframe
      : "15m";
    const marketType = deps.PREDICTION_MARKET_TYPES.has(prediction.marketType as string)
      ? prediction.marketType
      : "perp";

    const run = await deps.runCompositeStrategy({
      compositeId: strategy.id,
      nodesJson: strategy.nodesJson,
      edgesJson: strategy.edgesJson,
      combineMode: strategy.combineMode,
      outputPolicy: strategy.outputPolicy,
      featureSnapshot,
      basePrediction: {
        symbol: prediction.symbol,
        marketType,
        timeframe,
        tsCreated: prediction.tsCreated.toISOString(),
        signal,
        expectedMovePct: Number(prediction.expectedMovePct),
        confidence: Number(prediction.confidence)
      },
      context: {
        exchange: typeof featureSnapshot.prefillExchange === "string" ? featureSnapshot.prefillExchange : undefined,
        accountId: typeof featureSnapshot.prefillExchangeAccountId === "string"
          ? featureSnapshot.prefillExchangeAccountId
          : undefined,
        symbol: prediction.symbol,
        marketType,
        timeframe
      }
    }, {
      resolveLocalStrategyRef: async (id: string) => {
        if (!deps.db.localStrategyDefinition || typeof deps.db.localStrategyDefinition.findUnique !== "function") return false;
        const found = await deps.db.localStrategyDefinition.findUnique({
          where: { id },
          select: { id: true }
        });
        return Boolean(found);
      },
      resolveAiPromptRef: async (id: string) => {
        const found = await deps.getAiPromptTemplateById(id);
        return Boolean(found);
      }
    });

    return res.json({
      composite: deps.mapCompositeStrategyPublic(strategy),
      prediction: {
        id: prediction.id,
        symbol: prediction.symbol,
        timeframe,
        marketType
      },
      run
    });
  });

  app.put("/admin/settings/ai-trace", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = deps.adminAiTraceSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const sanitized = deps.parseStoredAiTraceSettings(parsed.data);
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_AI_TRACE_KEY, sanitized);
    deps.invalidateAiTraceSettingsCache();

    return res.json({
      ...sanitized,
      updatedAt: updated.updatedAt,
      source: "db",
      defaults: deps.DEFAULT_AI_TRACE_SETTINGS
    });
  });

  app.get("/admin/ai-trace/logs", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = deps.adminAiTraceLogsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }
    if (!deps.db.aiTraceLog || typeof deps.db.aiTraceLog.findMany !== "function") {
      return res.status(503).json({ error: "ai_trace_not_ready" });
    }

    const selectedUserId =
      typeof parsed.data.userId === "string" && parsed.data.userId === "__none__"
        ? "__none__"
        : (parsed.data.userId ?? null);
    const where =
      selectedUserId === "__none__"
        ? { userId: null }
        : (selectedUserId ? { userId: selectedUserId } : {});

    const [items, total, traceSettings, userIdRows, unassignedCount] = await Promise.all([
      deps.db.aiTraceLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parsed.data.limit
      }),
      deps.db.aiTraceLog.count({ where }),
      deps.getAiTraceSettingsCached(),
      deps.db.aiTraceLog.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
        distinct: ["userId"],
        orderBy: { userId: "asc" },
        take: 2000
      }),
      deps.db.aiTraceLog.count({ where: { userId: null } })
    ]);

    const userIdsForLookup = new Set<string>();
    for (const row of userIdRows) {
      if (row?.userId && typeof row.userId === "string") userIdsForLookup.add(row.userId);
    }
    for (const row of items) {
      if (row?.userId && typeof row.userId === "string") userIdsForLookup.add(row.userId);
    }

    const userIdList = Array.from(userIdsForLookup);
    const usersById = new Map<string, string>();
    if (userIdList.length > 0 && deps.db.user && typeof deps.db.user.findMany === "function") {
      const users = await deps.db.user.findMany({
        where: { id: { in: userIdList } },
        select: { id: true, email: true }
      });
      for (const user of users) {
        if (typeof user?.id === "string" && typeof user?.email === "string") {
          usersById.set(user.id, user.email);
        }
      }
    }

    const filterUsers = userIdList
      .map((id) => ({ id, email: usersById.get(id) ?? null }))
      .sort((a, b) => (a.email ?? a.id).localeCompare(b.email ?? b.id, undefined, { sensitivity: "base" }));

    const readTraceMeta = (payload: unknown) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return {
          retryUsed: false,
          retryCount: 0,
          totalTokens: null,
          analysisMode: "trading_explainer",
          neutralEnforced: false,
          explanationLength: null,
          explanationSentenceCount: null,
          explanationParagraphCount: null,
          paragraphFormatRequired: false,
          payloadCompactionProfile: "none",
          payloadCompactionDroppedPaths: [],
          requestedModel: null,
          resolvedModel: null,
          attemptedModels: [],
          fallbackReason: null
        };
      }
      const meta = (payload as Record<string, unknown>).__trace;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        return {
          retryUsed: false,
          retryCount: 0,
          totalTokens: null,
          analysisMode: "trading_explainer",
          neutralEnforced: false,
          explanationLength: null,
          explanationSentenceCount: null,
          explanationParagraphCount: null,
          paragraphFormatRequired: false,
          payloadCompactionProfile: "none",
          payloadCompactionDroppedPaths: [],
          requestedModel: null,
          resolvedModel: null,
          attemptedModels: [],
          fallbackReason: null
        };
      }
      const record = meta as Record<string, unknown>;
      const retryUsed = record.retryUsed === true;
      const retryCountRaw = Number(record.retryCount);
      const retryCount = Number.isFinite(retryCountRaw) ? Math.max(0, Math.trunc(retryCountRaw)) : 0;
      const totalTokensRaw = Number(record.totalTokens);
      const totalTokens =
        Number.isFinite(totalTokensRaw) && totalTokensRaw >= 0
          ? Math.max(0, Math.trunc(totalTokensRaw))
          : null;
      const explanationLengthRaw = Number(record.explanationLength);
      const explanationLength =
        Number.isFinite(explanationLengthRaw) && explanationLengthRaw >= 0
          ? Math.max(0, Math.trunc(explanationLengthRaw))
          : null;
      const explanationSentenceCountRaw = Number(record.explanationSentenceCount);
      const explanationSentenceCount =
        Number.isFinite(explanationSentenceCountRaw) && explanationSentenceCountRaw >= 0
          ? Math.max(0, Math.trunc(explanationSentenceCountRaw))
          : null;
      const explanationParagraphCountRaw = Number(record.explanationParagraphCount);
      const explanationParagraphCount =
        Number.isFinite(explanationParagraphCountRaw) && explanationParagraphCountRaw >= 0
          ? Math.max(0, Math.trunc(explanationParagraphCountRaw))
          : null;
      const analysisMode = record.analysisMode === "market_analysis" ? "market_analysis" : "trading_explainer";
      const neutralEnforced = record.neutralEnforced === true;
      const paragraphFormatRequired = record.paragraphFormatRequired === true;
      const payloadCompactionProfile =
        record.payloadCompactionProfile === "minimal_v2_trading"
        || record.payloadCompactionProfile === "minimal_v2_analysis"
        || record.payloadCompactionProfile === "none"
          ? record.payloadCompactionProfile
          : "none";
      const payloadCompactionDroppedPaths = Array.isArray(record.payloadCompactionDroppedPaths)
        ? record.payloadCompactionDroppedPaths
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0)
            .slice(0, 100)
        : [];
      const requestedModel =
        typeof record.requestedModel === "string" && record.requestedModel.trim()
          ? record.requestedModel.trim().slice(0, 128)
          : null;
      const resolvedModel =
        typeof record.resolvedModel === "string" && record.resolvedModel.trim()
          ? record.resolvedModel.trim().slice(0, 128)
          : null;
      const attemptedModels = Array.isArray(record.attemptedModels)
        ? record.attemptedModels
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0)
            .slice(0, 10)
        : [];
      const fallbackReason =
        typeof record.fallbackReason === "string" && record.fallbackReason.trim()
          ? record.fallbackReason.trim().slice(0, 1000)
          : null;
      return {
        retryUsed,
        retryCount,
        totalTokens,
        analysisMode,
        neutralEnforced,
        explanationLength,
        explanationSentenceCount,
        explanationParagraphCount,
        paragraphFormatRequired,
        payloadCompactionProfile,
        payloadCompactionDroppedPaths,
        requestedModel,
        resolvedModel,
        attemptedModels,
        fallbackReason
      };
    };

    return res.json({
      enabled: traceSettings.settings.enabled,
      source: traceSettings.source,
      total,
      limit: parsed.data.limit,
      selectedUserId,
      users: filterUsers,
      hasUnassigned: unassignedCount > 0,
      items: items.map((row: any) => ({
        ...readTraceMeta(row.userPayload ?? null),
        id: row.id,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
        userId: row.userId ?? null,
        userEmail:
          typeof row.userId === "string" && row.userId
            ? (usersById.get(row.userId) ?? null)
            : null,
        scope: row.scope,
        provider: row.provider ?? null,
        model: row.model ?? null,
        symbol: row.symbol ?? null,
        marketType: row.marketType ?? null,
        timeframe: row.timeframe ?? null,
        promptTemplateId: row.promptTemplateId ?? null,
        promptTemplateName: row.promptTemplateName ?? null,
        systemMessage: row.systemMessage ?? null,
        userPayload: row.userPayload ?? null,
        rawResponse: row.rawResponse ?? null,
        parsedResponse: row.parsedResponse ?? null,
        success: Boolean(row.success),
        error: row.error ?? null,
        fallbackUsed: Boolean(row.fallbackUsed),
        cacheHit: Boolean(row.cacheHit),
        rateLimited: Boolean(row.rateLimited),
        latencyMs:
          Number.isFinite(Number(row.latencyMs)) && row.latencyMs !== null
            ? Math.max(0, Math.trunc(Number(row.latencyMs)))
            : null
      }))
    });
  });

  app.post("/admin/ai-trace/logs/cleanup", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = deps.adminAiTraceCleanupSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (!deps.db.aiTraceLog || typeof deps.db.aiTraceLog.deleteMany !== "function") {
      return res.status(503).json({ error: "ai_trace_not_ready" });
    }

    const where = parsed.data.deleteAll
      ? {}
      : { createdAt: { lt: new Date(Date.now() - parsed.data.olderThanDays * 24 * 60 * 60 * 1000) } };
    const deleted = await deps.db.aiTraceLog.deleteMany({ where });

    return res.json({
      deletedCount: deleted.count,
      mode: parsed.data.deleteAll ? "all" : "older_than_days",
      olderThanDays: parsed.data.deleteAll ? null : parsed.data.olderThanDays
    });
  });
}
