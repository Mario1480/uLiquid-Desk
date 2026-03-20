import assert from "node:assert/strict";
import test from "node:test";
import { registerExchangeAccountRoutes } from "./routes.js";

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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("paper exchange account creation is denied when paper trading gate is disabled", async () => {
  const app = createFakeApp();

  registerExchangeAccountRoutes(app as any, {
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    isMexcEnabledAtRuntime: () => true,
    isBinanceEnabledAtRuntime: () => true,
    getAllowedExchangeValues: async () => ["paper", "bitget"],
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.paper_trading": false
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

  const handler = getFinalHandler(app, "/exchange-accounts");
  const res = createMockRes();

  await handler({
    body: {
      exchange: "paper",
      label: "Paper",
      marketDataExchangeAccountId: "acc_md_1"
    }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.capability, "product.paper_trading");
});
