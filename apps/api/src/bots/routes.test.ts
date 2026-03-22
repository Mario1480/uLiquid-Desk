import assert from "node:assert/strict";
import test from "node:test";
import { registerBotRoutes } from "./routes.js";

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

function getFinalPostHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("admin backend access bypasses product gate when creating bots", async () => {
  const app = createFakeApp();

  registerBotRoutes(app as any, {
    db: {
      exchangeAccount: {
        async findFirst() {
          return {
            id: "acc_1",
            exchange: "paper",
            label: "Demo"
          };
        }
      },
      bot: {
        async create(input: any) {
          return {
            id: "bot_1",
            ...input.data
          };
        }
      }
    },
    toSafeBot: (bot: any) => bot,
    normalizeSymbolInput: (value: string | null | undefined) =>
      typeof value === "string" ? value.trim().toUpperCase() : null,
    asRecord: (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}),
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.ai_predictions": false
      },
      capabilitySnapshot: null
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) => capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    botCreateSchema: {
      safeParse() {
        return {
          success: true,
          data: {
            name: "SMC",
            symbol: "BTCUSDT",
            exchangeAccountId: "acc_1",
            strategyKey: "prediction_copier",
            marginMode: "isolated",
            leverage: 10,
            tickMs: 1000,
            paramsJson: {
              predictionCopier: {
                sourceStateId: "state_1",
                timeframe: "15m"
              }
            }
          }
        };
      }
    },
    strategyCapabilityForKey: () => "product.ai_predictions",
    executionCapabilityForMode: () => "product.paper_trading",
    readExecutionSettingsFromParams: () => ({ mode: "simple" }),
    readPredictionCopierRootConfig: (paramsJson: any) => ({
      root: paramsJson?.predictionCopier ?? {},
      nested: false
    }),
    predictionCopierSettingsSchema: {
      safeParse(root: any) {
        return {
          success: true,
          data: {
            sourceStateId: String(root?.sourceStateId ?? "state_1"),
            timeframe: String(root?.timeframe ?? "15m")
          }
        };
      }
    },
    findPredictionSourceStateForCopier: async () => ({
      id: "state_1",
      symbol: "BTCUSDT",
      timeframe: "15m"
    }),
    readPredictionSourceSnapshotFromState: () => ({ stateId: "state_1" }),
    normalizeCopierTimeframe: (value: unknown) => String(value ?? "15m"),
    writePredictionCopierRootConfig: (_paramsJson: unknown, root: Record<string, unknown>) => ({
      predictionCopier: root
    }),
    buildPluginPolicySnapshot: () => ({}),
    attachPluginPolicySnapshot: (paramsJson: Record<string, unknown>) => paramsJson,
    evaluateAccessSectionBypassForUser: async () => true,
    canCreateBotForUser: async () => ({
      allowed: true,
      limit: null,
      usage: 0,
      remaining: null
    }),
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots");
  const res = createMockRes();

  await handler({ body: {} }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body?.id, "bot_1");
});

test("admin backend access bypasses product gate and start license when starting bots", async () => {
  const app = createFakeApp();
  let startLicenseChecked = false;

  registerBotRoutes(app as any, {
    db: {
      bot: {
        async findFirst() {
          return {
            id: "bot_1",
            userId: "user_1",
            exchange: "paper",
            exchangeAccountId: "acc_1",
            status: "stopped",
            futuresConfig: {
              strategyKey: "dummy",
              paramsJson: {
                execution: {
                  mode: "simple"
                }
              }
            }
          };
        },
        async count(input: any) {
          return input?.where?.status === "running" ? 0 : 1;
        },
        async update(input: any) {
          return {
            id: input.where.id,
            status: input.data.status ?? "stopped"
          };
        }
      },
      botRuntime: {
        async upsert() {
          return null;
        }
      }
    },
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.bots": false,
        "product.paper_trading": false
      },
      capabilitySnapshot: null
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) => capabilities[capability] === true,
    sendCapabilityDenied(res: any, params: { capability: string; currentPlan: string }) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: params.capability,
        currentPlan: params.currentPlan
      });
    },
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    strategyCapabilityForKey: () => "product.bots",
    readExecutionSettingsFromParams: () => ({ mode: "simple" }),
    executionCapabilityForMode: () => "product.paper_trading",
    buildPluginPolicySnapshot: () => ({}),
    attachPluginPolicySnapshot: (paramsJson: Record<string, unknown>) => paramsJson,
    evaluateAccessSectionBypassForUser: async () => true,
    getAccessSectionSettings: async () => ({
      limits: {
        bots: 1
      }
    }),
    enforceBotStartLicense: async () => {
      startLicenseChecked = true;
      return {
        allowed: false,
        reason: "should_have_been_bypassed"
      };
    },
    enqueueBotRun: async () => ({ jobId: "job_1", queued: true }),
    MEXC_PERP_ENABLED: true
  } as any);

  const handler = getFinalPostHandler(app, "/bots/:id/start");
  const res = createMockRes();

  await handler({ params: { id: "bot_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.status, "running");
  assert.equal(startLicenseChecked, false);
});
