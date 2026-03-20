import assert from "node:assert/strict";
import test from "node:test";
import { registerStrategyReadRoutes } from "./routes-read.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes
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
  const handlers = app.routes.get.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("settings local strategies returns empty list when product gate is disabled", async () => {
  const app = createFakeApp();

  registerStrategyReadRoutes(app as any, {
    readUserFromLocals: (res: any) => res.locals.user,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.local_strategies": false
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
    resolveStrategyEntitlementsPublicForUser: async () => ({
      plan: "free",
      allowedStrategyKinds: ["local"],
      allowedStrategyIds: null,
      maxCompositeNodes: 0,
      aiAllowedModels: null,
      aiMonthlyBudgetUsd: null,
      source: "plan_default"
    }),
    localStrategiesStoreReady: () => true
  } as any);

  const handler = getFinalHandler(app, "/settings/local-strategies");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body?.items, []);
});

test("admin composite strategies bypass product gate when admin backend access is enabled", async () => {
  const app = createFakeApp();

  registerStrategyReadRoutes(app as any, {
    db: {
      compositeStrategy: {
        async findMany() {
          return [
            {
              id: "cmp_1",
              name: "Composite One"
            }
          ];
        }
      }
    },
    requireSuperadmin: async () => true,
    readUserFromLocals: (res: any) => res.locals.user,
    hasAdminBackendAccess: async () => true,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: "free",
      capabilities: {
        "product.composite_strategies": false
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
    compositeStrategiesStoreReady: () => true,
    mapCompositeStrategyPublic: (row: any) => row
  } as any);

  const handler = getFinalHandler(app, "/admin/composite-strategies");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.id, "cmp_1");
});
