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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.post.get(path);
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
