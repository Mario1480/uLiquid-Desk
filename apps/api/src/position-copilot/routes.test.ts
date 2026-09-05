import assert from "node:assert/strict";
import test from "node:test";
import { registerPositionCopilotRoutes } from "./routes.js";
import { resetAiAnalyzerState } from "../ai/analyzer.js";
import { buildMarketFeatureContext } from "../ai/features/context.js";

function createFakeApp() {
  const postHandlers = new Map<string, any[]>();
  return {
    post(path: string, ...handlers: any[]) {
      postHandlers.set(path, handlers);
    },
    get() {},
    put() {},
    handler(path: string) {
      return postHandlers.get(path)?.at(-1);
    }
  };
}

function createRes() {
  return {
    locals: { user: { id: "user_1", email: "user@example.test" } },
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    }
  };
}

function validAnalyzeBody(trigger: "manual" | "event" | "periodic" = "manual") {
  return {
    trigger,
    language: "en",
    snapshot: {
      exchangeAccountId: "account_1",
      marketType: "perp",
      symbol: "BTCUSDT",
      side: "long",
      size: 0.1,
      entryPrice: 65_000,
      markPrice: 64_000,
      unrealizedPnlUsd: -100,
      leverage: 5,
      marginMode: "isolated",
      marginUsd: 1_280,
      notionalUsd: 6_400,
      liquidationPrice: 61_000,
      liquidationDistancePct: 4.6875,
      roePct: -7.8,
      pnlPct: -1.56,
      stopLossPrice: 62_500,
      takeProfitPrice: 68_000,
      dataDegraded: false,
      observedAt: "2026-08-02T12:00:00.000Z"
    }
  };
}

async function withPositionFeatureFlags(
  values: Record<string, string>,
  work: () => Promise<void>
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function capabilityDeps(
  capabilities: Record<string, boolean>,
  plan: "free" | "pro" | "premium" | "enterprise" = "premium"
) {
  return {
    resolvePlanCapabilitiesForUserId: async () => ({ plan, capabilities }),
    isCapabilityAllowed: (values: Record<string, boolean>, capability: string) => values[capability] === true,
    sendCapabilityDenied(res: any, input: any) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: input.capability,
        currentPlan: input.currentPlan,
        requiredPlan: "premium"
      });
    },
    hasAdminBackendAccess: async () => false
  };
}

test("Position Copilot rejects cross-user account access before invoking AI", async () => {
  await withPositionFeatureFlags({ AI_POSITION_COPILOT_ENABLED: "true" }, async () => {
    const app = createFakeApp();
    let accountWhere: any = null;
    let aiCalled = false;
    let marketCalled = false;
    registerPositionCopilotRoutes(app as any, {
      db: {
        exchangeAccount: {
          findFirst: async ({ where }: any) => {
            accountWhere = where;
            return null;
          }
        }
      },
      callAiChat: async () => {
        aiCalled = true;
        throw new Error("must_not_run");
      },
      loadMarketContext: async () => { marketCalled = true; throw new Error("must_not_run"); },
      dispatchPositionCopilotNotification: async () => undefined,
      ...capabilityDeps({ "product.ai_position_copilot": true })
    });

    const handler = app.handler("/api/position-copilot/analyze");
    const res = createRes();
    const body = validAnalyzeBody();
    body.snapshot.exchangeAccountId = "account_owned_by_user_2";
    await handler({ body }, res);

    assert.deepEqual(accountWhere, { id: "account_owned_by_user_2", userId: "user_1" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body?.error, "exchange_account_not_found");
    assert.equal(aiCalled, false);
    assert.equal(marketCalled, false);
  });
});

test("direct Position Copilot is denied before account reads when the Premium capability is missing", async () => {
  await withPositionFeatureFlags({ AI_POSITION_COPILOT_ENABLED: "true" }, async () => {
    const app = createFakeApp();
    let accountRead = false;
    registerPositionCopilotRoutes(app as any, {
      db: {
        exchangeAccount: {
          findFirst: async () => {
            accountRead = true;
            return null;
          }
        }
      },
      callAiChat: async () => { throw new Error("must_not_run"); },
      dispatchPositionCopilotNotification: async () => undefined,
      ...capabilityDeps({ "product.ai_position_copilot": false }, "pro")
    });

    const res = createRes();
    await app.handler("/api/position-copilot/analyze")({ body: validAnalyzeBody() }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.capability, "product.ai_position_copilot");
    assert.equal(accountRead, false);
  });
});

test("admin preview cannot bypass the Position Copilot environment master gate", async () => {
  await withPositionFeatureFlags({ AI_POSITION_COPILOT_ENABLED: "false" }, async () => {
    const app = createFakeApp();
    registerPositionCopilotRoutes(app as any, {
      db: {},
      callAiChat: async () => { throw new Error("must_not_run"); },
      dispatchPositionCopilotNotification: async () => undefined,
      ...capabilityDeps({}),
      hasAdminBackendAccess: async () => true
    });

    const res = createRes();
    await app.handler("/api/position-copilot/analyze")({ body: validAnalyzeBody() }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.error, "position_copilot_feature_disabled");
  });
});

test("automatic Position Copilot analysis additionally requires the monitoring capability", async () => {
  await withPositionFeatureFlags({
    AI_POSITION_COPILOT_ENABLED: "true",
    AI_POSITION_MONITORING_ENABLED: "true"
  }, async () => {
    const app = createFakeApp();
    let accountRead = false;
    registerPositionCopilotRoutes(app as any, {
      db: {
        exchangeAccount: {
          findFirst: async () => {
            accountRead = true;
            return null;
          }
        }
      },
      callAiChat: async () => { throw new Error("must_not_run"); },
      dispatchPositionCopilotNotification: async () => undefined,
      ...capabilityDeps({
        "product.ai_position_copilot": true,
        "product.ai_position_monitoring": false
      })
    });

    const res = createRes();
    await app.handler("/api/position-copilot/analyze")({ body: validAnalyzeBody("event") }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.capability, "product.ai_position_monitoring");
    assert.equal(accountRead, false);
  });
});

test("owned manual analysis persists the exact public context without activating notifications", async () => {
  await withPositionFeatureFlags({ AI_POSITION_COPILOT_ENABLED: "true" }, async () => {
    resetAiAnalyzerState();
    const app = createFakeApp();
    const steps: string[] = [];
    let trace: any;
    registerPositionCopilotRoutes(app as any, {
      db: {
        exchangeAccount: { findFirst: async ({ where }: any) => { assert.equal(where.userId, "user_1"); steps.push("ownership"); return { id: "account_1", exchange: "bitget" }; } },
        botTradeHistory: { findFirst: async () => null },
        globalSetting: { findUnique: async () => { steps.push("settings"); return null; } },
        aiTraceLog: { create: async ({ data }: any) => { trace = data; } }
      },
      loadMarketContext: async params => { steps.push("market"); assert.equal(params.userId, "user_1"); assert.equal(params.account.id, "account_1"); return buildMarketFeatureContext([], [], ["market_context_unavailable"]); },
      callAiChat: async () => { steps.push("ai"); return { content: JSON.stringify({ summary: "Read-only fixture.", thesisStatus: "unknown", riskLevel: "critical", riskFactors: [], events: [] }), toolCalls: [], usage: {}, provider: "openai", model: "test", finishReason: "stop" }; },
      dispatchPositionCopilotNotification: async () => { assert.fail("manual analysis must not notify"); },
      ...capabilityDeps({ "product.ai_position_copilot": true })
    });
    const res = createRes();
    await app.handler("/api/position-copilot/analyze")({ body: validAnalyzeBody() }, res);
    assert.deepEqual(steps, ["ownership", "settings", "market", "ai"]);
    assert.equal(res.body.analysis.readOnly, true);
    assert.deepEqual(res.body.marketContext, trace.parsedResponse.marketContext);
    assert.equal(res.body.marketContext.quality, "unavailable");
  });
});
