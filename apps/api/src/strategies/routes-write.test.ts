import assert from "node:assert/strict";
import test from "node:test";
import { registerStrategyWriteRoutes } from "./routes-write.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
      put: putRoutes,
      delete: deleteRoutes
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

function getFinalHandler(
  app: ReturnType<typeof createFakeApp>,
  path: string,
  method: keyof ReturnType<typeof createFakeApp>["routes"] = "post"
) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("user AI prompt generation preview is denied when AI predictions gate is disabled", async () => {
  const app = createFakeApp();

  registerStrategyWriteRoutes(app as any, {
    readUserFromLocals: (res: any) => res.locals.user,
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
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    }
  } as any);

  const handler = getFinalHandler(app, "/settings/ai-prompts/own/generate-preview");
  const res = createMockRes();

  await handler(
    {
      body: {
        strategyDescription: "Momentum",
        indicatorKeys: [],
        timeframes: ["15m"]
      }
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.capability, "product.ai_predictions");
});

test("admin AI prompt generation preview bypasses product gate when admin backend access is enabled", async () => {
  const app = createFakeApp();

  registerStrategyWriteRoutes(app as any, {
    requireSuperadmin: async () => true,
    readUserFromLocals: (res: any) => res.locals.user,
    hasAdminBackendAccess: async () => true,
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
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    adminAiPromptsGeneratePreviewSchema: {
      safeParse(input: any) {
        return {
          success: true,
          data: {
            strategyDescription: String(input?.strategyDescription ?? ""),
            indicatorKeys: [],
            timeframes: ["15m"],
            runTimeframe: null
          }
        };
      }
    },
    resolveSelectedAiPromptIndicators: () => ({
      selectedIndicators: [],
      invalidKeys: []
    }),
    generateHybridPromptText: async () => ({
      promptText: "Generated prompt",
      mode: "fallback",
      model: "test-model"
    })
  } as any);

  const handler = getFinalHandler(app, "/admin/settings/ai-prompts/generate-preview");
  const res = createMockRes();

  await handler(
    {
      body: {
        strategyDescription: "Momentum"
      }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.generatedPromptText, "Generated prompt");
});

test("user AI prompt chat returns AI builder response", async () => {
  const app = createFakeApp();
  let capturedInput: any = null;

  registerStrategyWriteRoutes(app as any, {
    readUserFromLocals: (res: any) => res.locals.user,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "pro",
      capabilities: {
        "product.ai_predictions": true
      }
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) =>
      capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    isStrategyFeatureEnabledForUser: async () => true,
    userAiPromptBuilderChatSchema: {
      safeParse(input: any) {
        return {
          success: true,
          data: {
            messages: input.messages,
            currentStrategyDescription: input.currentStrategyDescription ?? "",
            indicatorKeys: input.indicatorKeys ?? [],
            ohlcvBars: input.ohlcvBars ?? 100,
            timeframes: input.timeframes ?? [],
            runTimeframe: input.runTimeframe ?? null,
            directionPreference: input.directionPreference ?? "either",
            confidenceTargetPct: input.confidenceTargetPct ?? 60,
            slTpSource: input.slTpSource ?? "local",
            newsRiskMode: input.newsRiskMode ?? "off",
            promptMode: input.promptMode ?? "trading_explainer",
            locale: input.locale ?? "de"
          }
        };
      }
    },
    resolveSelectedAiPromptIndicators: () => ({
      selectedIndicators: [
        { key: "rsi", label: "RSI", description: "Momentum" }
      ],
      invalidKeys: []
    }),
    generatePromptBuilderChat: async (input: any) => {
      capturedInput = input;
      return {
        assistantMessage: "Ich habe daraus einen Prompt-Brief erstellt.",
        strategyDescription: "Use RSI pullback confirmation.",
        suggestedName: "RSI Pullback",
        readyForPreview: true,
        mode: "ai",
        model: "test-model"
      };
    }
  } as any);

  const handler = getFinalHandler(app, "/settings/ai-prompts/own/chat");
  const res = createMockRes();

  await handler(
    {
      body: {
        messages: [{ role: "user", content: "Ich will Pullbacks handeln." }],
        indicatorKeys: ["rsi"],
        timeframes: ["15m"],
        runTimeframe: "15m",
        locale: "de"
      }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(capturedInput?.billingUserId, "user_1");
  assert.equal(capturedInput?.selectedIndicators[0]?.key, "rsi");
  assert.equal(res.body?.assistantMessage, "Ich habe daraus einen Prompt-Brief erstellt.");
  assert.equal(res.body?.strategyDescription, "Use RSI pullback confirmation.");
  assert.equal(res.body?.suggestedName, "RSI Pullback");
  assert.equal(res.body?.readyForPreview, true);
  assert.deepEqual(res.body?.generationMeta, { mode: "ai", model: "test-model" });
});

test("user AI prompt update edits an existing own prompt", async () => {
  const app = createFakeApp();
  let capturedUpdate: any = null;

  registerStrategyWriteRoutes(app as any, {
    readUserFromLocals: (res: any) => res.locals.user,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "pro",
      capabilities: {
        "product.ai_predictions": true
      }
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) =>
      capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    isStrategyFeatureEnabledForUser: async () => true,
    userAiPromptsGenerateSaveSchema: {
      safeParse(input: any) {
        return {
          success: true,
          data: {
            name: input.name,
            strategyDescription: input.strategyDescription,
            indicatorKeys: input.indicatorKeys ?? [],
            ohlcvBars: input.ohlcvBars ?? 100,
            timeframes: input.timeframes ?? [],
            runTimeframe: input.runTimeframe ?? null,
            directionPreference: input.directionPreference ?? "either",
            confidenceTargetPct: input.confidenceTargetPct ?? 60,
            slTpSource: input.slTpSource ?? "local",
            newsRiskMode: input.newsRiskMode ?? "off",
            promptMode: input.promptMode ?? "trading_explainer",
            generatedPromptText: input.generatedPromptText,
            generationMeta: input.generationMeta
          }
        };
      }
    },
    resolveSelectedAiPromptIndicators: () => ({
      selectedIndicators: [{ key: "rsi" }],
      invalidKeys: []
    }),
    getAiModel: () => "test-model",
    updateUserAiPromptTemplate: async (userId: string, id: string, input: any) => {
      capturedUpdate = { userId, id, input };
      return {
        id,
        name: input.name,
        promptText: input.promptText,
        indicatorKeys: input.indicatorKeys,
        ohlcvBars: input.ohlcvBars,
        timeframes: input.timeframes,
        runTimeframe: input.runTimeframe,
        timeframe: input.runTimeframe,
        directionPreference: input.directionPreference,
        confidenceTargetPct: input.confidenceTargetPct,
        slTpSource: input.slTpSource,
        newsRiskMode: input.newsRiskMode,
        promptMode: input.promptMode,
        marketAnalysisUpdateEnabled: false,
        isPublic: false,
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z"
      };
    }
  } as any);

  const handler = getFinalHandler(app, "/settings/ai-prompts/own/:id", "put");
  const res = createMockRes();

  await handler(
    {
      params: { id: "uap_1" },
      body: {
        name: "Updated prompt",
        strategyDescription: "Existing prompt text",
        indicatorKeys: ["rsi"],
        timeframes: ["15m"],
        runTimeframe: "15m",
        generatedPromptText: "Updated generated prompt",
        generationMeta: { mode: "fallback", model: "test-model" }
      }
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(capturedUpdate?.userId, "user_1");
  assert.equal(capturedUpdate?.id, "uap_1");
  assert.equal(capturedUpdate?.input.promptText, "Updated generated prompt");
  assert.deepEqual(capturedUpdate?.input.indicatorKeys, ["rsi"]);
  assert.equal(res.body?.prompt?.id, "uap_1");
  assert.equal(res.body?.generatedPromptText, "Updated generated prompt");
});
