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
