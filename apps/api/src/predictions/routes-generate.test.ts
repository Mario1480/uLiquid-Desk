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
