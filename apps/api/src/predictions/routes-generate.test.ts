import assert from "node:assert/strict";
import test from "node:test";
import { registerPredictionGenerateRoutes } from "./routes-generate.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const postRoutes: RouteMap = new Map();
  return {
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    routes: {
      post: postRoutes
    }
  };
}

function createMockRes() {
  return {
    locals: {
      user: {
        id: "user_1",
        email: "user_1@example.com"
      }
    },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createPredictionGenerateRouteDeps(overrides: Record<string, any> = {}) {
  return {
    isSuperadminEmail: () => false,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "pro",
      capabilities: {
        "product.ai_predictions": true,
        "product.local_strategies": true,
        "product.composite_strategies": true
      }
    }),
    isCapabilityAllowed: () => true,
    sendCapabilityDenied(res: any) {
      return res.status(403).json({ error: "feature_not_available" });
    },
    asRecord: (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {},
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    normalizePredictionSignalMode: (value: unknown) =>
      value === "local_only" || value === "ai_only" || value === "both" ? value : "both",
    normalizeSymbolInput: (value: string | null | undefined) => value?.trim().toUpperCase() || null,
    normalizePredictionStrategyKind: (value: unknown) =>
      value === "local" || value === "composite" || value === "ai" ? value : null,
    getEnabledLocalStrategyById: async () => null,
    getEnabledCompositeStrategyById: async () => null,
    resolveStrategyBoundSignalMode: (mode: "local_only" | "ai_only" | "both") => mode,
    resolvePredictionLimitBucketFromStrategy: () => "predictionsAi",
    resolveUserContext: async () => ({ hasAdminBackendAccess: false }),
    resolveStrategyEntitlementsForUser: async () => ({}),
    resolveAiPromptRuntimeForUserSelection: async () => null,
    isStrategyFeatureEnabledForUser: async () => true,
    evaluateStrategySelectionAccess: () => ({ allowed: true }),
    getAiModelAsync: async () => "gpt-5-mini",
    countCompositeStrategyNodes: () => null,
    evaluateAiPromptAccess: () => ({ allowed: true, reason: "ok", mode: "off", wouldBlock: false }),
    getAiPromptRuntimeSettings: async () => ({
      activePromptId: "default",
      activePromptName: "Default",
      runTimeframe: "15m",
      timeframes: ["15m"],
      slTpSource: "local",
      directionPreference: "either",
      confidenceTargetPct: 60,
      marketAnalysisUpdateEnabled: true
    }),
    normalizePromptTimeframeSetForRuntime: (_settings: any, timeframe: any) => ({
      runTimeframe: timeframe,
      timeframes: [timeframe]
    }),
    readPrefillExchangeAccountId: (snapshot: Record<string, any>) =>
      typeof snapshot.prefillExchangeAccountId === "string" ? snapshot.prefillExchangeAccountId : null,
    findPredictionStateIdByScope: async () => null,
    isAutoScheduleEnabled: () => true,
    canCreatePredictionForUser: async () => ({ allowed: true }),
    withStrategyRunSnapshot: (snapshot: Record<string, any>) => snapshot,
    resolvePreferredSignalSourceForMode: () => "ai",
    PREDICTION_PRIMARY_SIGNAL_SOURCE: "ai",
    normalizeTagList: (value: unknown) => Array.isArray(value) ? value.map(String) : [],
    resolveStrategyNewsRiskMode: () => "off",
    readGlobalNewsRiskEnforcement: async () => false,
    shouldBlockByNewsRisk: () => false,
    resolveNewsRiskBlockReasonCode: () => "news_risk_blocked",
    derivePredictionTrackingFromSnapshot: () => ({
      entryPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      horizonMs: 15 * 60 * 1000
    }),
    generateAndPersistPrediction: async (input: any) => ({
      persisted: true,
      prediction: input.prediction,
      signalSource: "ai",
      explanation: {
        explanation: "Deutsche Analyse",
        tags: ["trend_up"],
        keyDrivers: [],
        aiPrediction: input.prediction,
        disclaimer: "grounded_features_only"
      },
      featureSnapshot: {
        ...input.featureSnapshot,
        responseLanguage: input.responseLanguage
      },
      modelVersion: "model-v1",
      rowId: "pred_1"
    }),
    enforceNewsRiskTag: (tags: string[] | null | undefined) => tags ?? [],
    normalizeKeyDriverList: () => [],
    buildPredictionChangeHash: () => "hash",
    readPredictionStrategyRef: (snapshot: Record<string, any>) => snapshot.strategyRef ?? null,
    toPredictionStateStrategyScope: () => ({ strategyKind: "legacy", strategyId: "legacy" }),
    timeframeToIntervalMs: () => 15 * 60 * 1000,
    isAutoSchedulePaused: () => false,
    parseDirectionPreference: () => "either",
    readConfidenceTarget: () => 60,
    readRequestedLeverage: () => undefined,
    persistPredictionState: async () => ({ id: "state_1" }),
    dispatchTradablePredictionNotification: async () => undefined,
    resolveNotificationStrategyName: () => "Default",
    readAiPromptMarketAnalysisUpdateEnabled: () => true,
    dispatchMarketAnalysisUpdateNotification: async () => undefined,
    readAiPromptTemplateId: (snapshot: Record<string, any>) => snapshot.aiPromptTemplateId ?? null,
    readAiPromptTemplateName: (snapshot: Record<string, any>) => snapshot.aiPromptTemplateName ?? null,
    readLocalStrategyId: (snapshot: Record<string, any>) => snapshot.localStrategyId ?? null,
    readLocalStrategyName: (snapshot: Record<string, any>) => snapshot.localStrategyName ?? null,
    readCompositeStrategyId: (snapshot: Record<string, any>) => snapshot.compositeStrategyId ?? null,
    readCompositeStrategyName: (snapshot: Record<string, any>) => snapshot.compositeStrategyName ?? null,
    generateAutoPredictionForUser: async (_userId: string, payload: any) => ({
      persisted: true,
      prediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.7 },
      timeframe: payload.timeframe,
      directionPreference: "either",
      confidenceTargetPct: 60,
      signalSource: "ai",
      signalMode: "both",
      explanation: {
        explanation: "Analysis",
        tags: [],
        keyDrivers: [],
        aiPrediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.7 },
        disclaimer: "grounded_features_only"
      },
      modelVersion: "model-v1",
      predictionId: "pred_1",
      tsCreated: "2026-05-04T10:00:00.000Z",
      responseLanguage: payload.responseLanguage,
      aiPromptTemplateId: null,
      aiPromptTemplateName: null,
      localStrategyId: null,
      localStrategyName: null,
      compositeStrategyId: null,
      compositeStrategyName: null,
      strategyRef: null
    }),
    sendManualTradingError(res: any, error: any) {
      return res.status(error.status ?? 500).json({
        error: error.code ?? "manual_trading_error",
        code: error.code ?? "manual_trading_error"
      });
    },
    db: {
      predictionEvent: {
        create: async () => ({ id: "event_1" })
      }
    },
    ...overrides
  };
}

test("prediction auto-generate denies AI predictions when product gate is disabled", async () => {
  const app = createFakeApp();

  registerPredictionGenerateRoutes(app as any, {
    isSuperadminEmail: () => false,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.ai_predictions": false
      }
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) =>
      capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        code: "CAPABILITY_DENIED",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    }
  } as any);

  const handler = getFinalHandler(app, "/api/predictions/generate-auto");
  const res = createMockRes();

  await handler({
    body: {
      exchangeAccountId: "acc_1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m"
    }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.capability, "product.ai_predictions");
});

test("manual prediction generate fails closed when history persistence fails", async () => {
  const app = createFakeApp();
  let eventCreates = 0;
  let statePersists = 0;
  let tradableNotifications = 0;

  registerPredictionGenerateRoutes(app as any, {
    isSuperadminEmail: () => false,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "pro",
      capabilities: {
        "product.ai_predictions": true
      }
    }),
    isCapabilityAllowed: () => true,
    sendCapabilityDenied(res: any) {
      return res.status(403).json({ error: "feature_not_available" });
    },
    asRecord: (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {},
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    normalizePredictionSignalMode: (value: unknown) =>
      value === "local_only" || value === "ai_only" || value === "both" ? value : "both",
    normalizeSymbolInput: (value: string | null | undefined) => value?.trim().toUpperCase() || null,
    normalizePredictionStrategyKind: (value: unknown) =>
      value === "local" || value === "composite" || value === "ai" ? value : null,
    getEnabledLocalStrategyById: async () => null,
    getEnabledCompositeStrategyById: async () => null,
    resolveStrategyBoundSignalMode: (mode: "local_only" | "ai_only" | "both") => mode,
    resolvePredictionLimitBucketFromStrategy: () => "predictionsAi",
    resolveUserContext: async () => ({ hasAdminBackendAccess: false }),
    resolveStrategyEntitlementsForUser: async () => ({}),
    resolveAiPromptRuntimeForUserSelection: async () => null,
    isStrategyFeatureEnabledForUser: async () => true,
    evaluateStrategySelectionAccess: () => ({ allowed: true }),
    getAiModelAsync: async () => "gpt-5-mini",
    countCompositeStrategyNodes: () => null,
    evaluateAiPromptAccess: () => ({ allowed: true, reason: "ok", mode: "off", wouldBlock: false }),
    getAiPromptRuntimeSettings: async () => ({
      activePromptId: "default",
      activePromptName: "Default",
      runTimeframe: "15m",
      timeframes: ["15m"],
      slTpSource: "local",
      directionPreference: "either",
      confidenceTargetPct: 60
    }),
    normalizePromptTimeframeSetForRuntime: (_settings: any, timeframe: any) => ({
      runTimeframe: timeframe,
      timeframes: [timeframe]
    }),
    readPrefillExchangeAccountId: (snapshot: Record<string, any>) =>
      typeof snapshot.prefillExchangeAccountId === "string" ? snapshot.prefillExchangeAccountId : null,
    findPredictionStateIdByScope: async () => null,
    isAutoScheduleEnabled: () => true,
    canCreatePredictionForUser: async () => ({ allowed: true }),
    withStrategyRunSnapshot: (snapshot: Record<string, any>) => snapshot,
    resolvePreferredSignalSourceForMode: () => "ai",
    PREDICTION_PRIMARY_SIGNAL_SOURCE: "ai",
    normalizeTagList: (value: unknown) => Array.isArray(value) ? value.map(String) : [],
    resolveStrategyNewsRiskMode: () => "off",
    readGlobalNewsRiskEnforcement: async () => false,
    shouldBlockByNewsRisk: () => false,
    derivePredictionTrackingFromSnapshot: () => ({
      entryPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      horizonMs: 15 * 60 * 1000
    }),
    generateAndPersistPrediction: async () => {
      throw Object.assign(new Error("prediction_persist_failed"), {
        status: 503,
        code: "prediction_persist_failed"
      });
    },
    enforceNewsRiskTag: (tags: string[] | null | undefined) => tags ?? [],
    normalizeKeyDriverList: () => [],
    buildPredictionChangeHash: () => "hash",
    readPredictionStrategyRef: () => null,
    toPredictionStateStrategyScope: () => ({ strategyKind: "legacy", strategyId: "legacy" }),
    timeframeToIntervalMs: () => 15 * 60 * 1000,
    isAutoSchedulePaused: () => false,
    parseDirectionPreference: () => "either",
    readConfidenceTarget: () => 60,
    readRequestedLeverage: () => undefined,
    persistPredictionState: async () => {
      statePersists += 1;
      return { id: "state_1" };
    },
    dispatchTradablePredictionNotification: async () => {
      tradableNotifications += 1;
    },
    resolveNotificationStrategyName: () => null,
    readAiPromptMarketAnalysisUpdateEnabled: () => false,
    dispatchMarketAnalysisUpdateNotification: async () => undefined,
    readAiPromptTemplateId: () => null,
    readAiPromptTemplateName: () => null,
    readLocalStrategyId: () => null,
    readLocalStrategyName: () => null,
    readCompositeStrategyId: () => null,
    readCompositeStrategyName: () => null,
    generateAutoPredictionForUser: async () => {
      throw new Error("not_used");
    },
    sendManualTradingError(res: any, error: any) {
      return res.status(error.status ?? 500).json({
        error: error.code ?? "manual_trading_error",
        code: error.code ?? "manual_trading_error"
      });
    },
    db: {
      predictionEvent: {
        create: async () => {
          eventCreates += 1;
          return { id: "event_1" };
        }
      }
    }
  } as any);

  const handler = getFinalHandler(app, "/api/predictions/generate");
  const res = createMockRes();

  await handler({
    body: {
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      prediction: {
        signal: "up",
        expectedMovePct: 1.2,
        confidence: 0.7
      },
      featureSnapshot: {
        prefillExchangeAccountId: "acc_1",
        prefillExchange: "bitget"
      },
      signalMode: "ai_only"
    }
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body?.code, "prediction_persist_failed");
  assert.equal(eventCreates, 0);
  assert.equal(statePersists, 0);
  assert.equal(tradableNotifications, 0);
});

test("manual prediction generate persists and dispatches selected response language", async () => {
  const app = createFakeApp();
  let capturedGenerateInput: any = null;
  const tradableNotifications: any[] = [];
  const marketNotifications: any[] = [];

  registerPredictionGenerateRoutes(app as any, createPredictionGenerateRouteDeps({
    generateAndPersistPrediction: async (input: any) => {
      capturedGenerateInput = input;
      return {
        persisted: true,
        prediction: input.prediction,
        signalSource: "ai",
        explanation: {
          explanation: "Deutsche Analyse",
          tags: ["trend_up"],
          keyDrivers: [],
          aiPrediction: input.prediction,
          disclaimer: "grounded_features_only"
        },
        featureSnapshot: {
          ...input.featureSnapshot,
          responseLanguage: input.responseLanguage
        },
        modelVersion: "model-v1",
        rowId: "pred_1"
      };
    },
    dispatchTradablePredictionNotification: async (payload: any) => {
      tradableNotifications.push(payload);
    },
    dispatchMarketAnalysisUpdateNotification: async (payload: any) => {
      marketNotifications.push(payload);
    }
  }) as any);

  const handler = getFinalHandler(app, "/api/predictions/generate");
  const res = createMockRes();

  await handler({
    body: {
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      responseLanguage: "de",
      prediction: {
        signal: "up",
        expectedMovePct: 1.2,
        confidence: 0.7
      },
      featureSnapshot: {
        prefillExchangeAccountId: "acc_1",
        prefillExchange: "bitget"
      },
      signalMode: "ai_only"
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(capturedGenerateInput?.responseLanguage, "de");
  assert.equal(capturedGenerateInput?.featureSnapshot?.responseLanguage, "de");
  assert.equal(res.body?.responseLanguage, "de");
  assert.equal(tradableNotifications[0]?.responseLanguage, "de");
  assert.equal(marketNotifications[0]?.responseLanguage, "de");
});

test("auto prediction generate normalizes invalid or missing response language to English", async () => {
  const app = createFakeApp();
  let capturedPayload: any = null;

  registerPredictionGenerateRoutes(app as any, createPredictionGenerateRouteDeps({
    generateAutoPredictionForUser: async (_userId: string, payload: any) => {
      capturedPayload = payload;
      return {
        persisted: true,
        prediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.7 },
        timeframe: payload.timeframe,
        directionPreference: "either",
        confidenceTargetPct: 60,
        signalSource: "ai",
        signalMode: "both",
        explanation: {
          explanation: "Analysis",
          tags: [],
          keyDrivers: [],
          aiPrediction: { signal: "up", expectedMovePct: 1.2, confidence: 0.7 },
          disclaimer: "grounded_features_only"
        },
        modelVersion: "model-v1",
        predictionId: "pred_1",
        tsCreated: "2026-05-04T10:00:00.000Z",
        responseLanguage: payload.responseLanguage,
        aiPromptTemplateId: null,
        aiPromptTemplateName: null,
        localStrategyId: null,
        localStrategyName: null,
        compositeStrategyId: null,
        compositeStrategyName: null,
        strategyRef: null
      };
    }
  }) as any);

  const handler = getFinalHandler(app, "/api/predictions/generate-auto");
  const res = createMockRes();

  await handler({
    body: {
      exchangeAccountId: "acc_1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m",
      responseLanguage: "fr"
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(capturedPayload?.responseLanguage, "en");
  assert.equal(res.body?.responseLanguage, "en");

  capturedPayload = null;
  const resMissing = createMockRes();
  await handler({
    body: {
      exchangeAccountId: "acc_1",
      symbol: "BTCUSDT",
      marketType: "perp",
      timeframe: "15m"
    }
  }, resMissing);

  assert.equal(resMissing.statusCode, 201);
  assert.equal(capturedPayload?.responseLanguage, "en");
  assert.equal(resMissing.body?.responseLanguage, "en");
});
