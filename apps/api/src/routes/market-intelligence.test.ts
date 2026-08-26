import assert from "node:assert/strict";
import test from "node:test";
import { registerMarketIntelligenceRoutes } from "./market-intelligence.js";

function createFakeApp() {
  const getRoutes = new Map<string, any[]>();
  return {
    get(path: string, ...handlers: any[]) {
      getRoutes.set(path, handlers);
    },
    put() {},
    post() {},
    handler(path: string) {
      return getRoutes.get(path)?.at(-1);
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

function register(params: {
  capabilities: Record<string, boolean>;
  service?: any;
  hasAdminBackendAccess?: () => Promise<boolean>;
}) {
  const app = createFakeApp();
  registerMarketIntelligenceRoutes(app as any, {
    db: {},
    requireSuperadmin: async () => false,
    resolvePlanCapabilitiesForUserId: async () => ({
      plan: params.capabilities["product.market_intelligence"] ? "pro" : "free",
      capabilities: params.capabilities
    }),
    isCapabilityAllowed: (capabilities: Record<string, boolean>, capability: string) => (
      capabilities[capability] === true
    ),
    sendCapabilityDenied(res: any, input: any) {
      return res.status(403).json({
        error: "feature_not_available",
        capability: input.capability,
        currentPlan: input.currentPlan,
        requiredPlan: "pro"
      });
    },
    hasAdminBackendAccess: params.hasAdminBackendAccess,
    service: params.service ?? {
      getMarketContext: async () => ({ ok: true }),
      getDailySummary: async () => ({ ok: true }),
      getProviderStates: async () => [],
      getNewsItem: async () => null
    }
  } as any);
  return app;
}

test("full Market Intelligence is denied for Free with the standardized capability payload", async () => {
  const app = register({ capabilities: { "product.market_intelligence": false } });
  const res = createRes();

  await app.handler("/market-intelligence/context")({ query: {} }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.capability, "product.market_intelligence");
  assert.equal(res.body?.requiredPlan, "pro");
});

test("Pro Market Intelligence summary retains billing attribution", async () => {
  let summaryInput: any = null;
  const app = register({
    capabilities: { "product.market_intelligence": true },
    service: {
      async getDailySummary(input: any) {
        summaryInput = input;
        return { summary: "public-market-summary" };
      }
    }
  });
  const res = createRes();

  await app.handler("/market-intelligence/summary")({ query: { symbol: "BTCUSDT", horizon: "24h" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.summary, "public-market-summary");
  assert.deepEqual(summaryInput, {
    symbol: "BTCUSDT",
    horizon: "24h",
    billingUserId: "user_1"
  });
});

test("general news detail remains outside the full Market Intelligence plan gate", async () => {
  let capabilityResolved = false;
  const app = createFakeApp();
  registerMarketIntelligenceRoutes(app as any, {
    db: {},
    requireSuperadmin: async () => false,
    resolvePlanCapabilitiesForUserId: async () => {
      capabilityResolved = true;
      return { plan: "free", capabilities: {} };
    },
    isCapabilityAllowed: () => false,
    sendCapabilityDenied: () => {
      throw new Error("must_not_gate_news");
    },
    service: {
      getNewsItem: async (id: string) => ({ id, title: "News" })
    }
  } as any);
  const res = createRes();

  await app.handler("/news/:id")({ params: { id: "news_1" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.item?.id, "news_1");
  assert.equal(capabilityResolved, false);
});
