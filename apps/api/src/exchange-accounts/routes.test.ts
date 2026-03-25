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

function getFinalPutHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.put.get(path);
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

test("hyperliquid exchange account creation starts credential rotation timer", async () => {
  const app = createFakeApp();
  let createdData: any = null;

  registerExchangeAccountRoutes(app as any, {
    db: {
      exchangeAccount: {
        create: async ({ data }: any) => {
          createdData = data;
          return { id: "hl_1", exchange: data.exchange, label: data.label };
        }
      }
    },
    encryptSecret: (value: string) => `enc:${value}`,
    decryptSecret: (value: string) => value.replace(/^enc:/, ""),
    maskSecret: (value: string) => `****${value.slice(-4)}`,
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    isMexcEnabledAtRuntime: () => true,
    isBinanceEnabledAtRuntime: () => true,
    getAllowedExchangeValues: async () => ["hyperliquid", "paper", "bitget"],
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: { "product.paper_trading": true } }),
    isCapabilityAllowed: () => true,
    sendCapabilityDenied: (res: any) => res,
    setPaperMarketDataAccountId: async () => undefined
  } as any);

  const handler = getFinalHandler(app, "/exchange-accounts");
  const res = createMockRes();

  await handler({
    body: {
      exchange: "hyperliquid",
      label: "HL Main",
      apiKey: "0x1111111111111111111111111111111111111111",
      apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdData?.exchange, "hyperliquid");
  assert.equal(createdData?.credentialsRotatedAt instanceof Date, true);
  assert.equal(createdData?.credentialsExpiryNoticeSentAt, null);
});

test("hyperliquid label-only update preserves credential rotation timer", async () => {
  const app = createFakeApp();
  let updatedData: any = null;

  registerExchangeAccountRoutes(app as any, {
    db: {
      exchangeAccount: {
        findFirst: async () => ({
          id: "hl_1",
          userId: "user_1",
          exchange: "hyperliquid",
          label: "Old",
          apiKeyEnc: "enc:0x1111111111111111111111111111111111111111",
          apiSecretEnc: "enc:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          passphraseEnc: null
        }),
        update: async ({ data }: any) => {
          updatedData = data;
          return { id: "hl_1", exchange: "hyperliquid", label: data.label };
        }
      }
    },
    encryptSecret: (value: string) => `enc:${value}`,
    decryptSecret: (value: string) => value.replace(/^enc:/, ""),
    maskSecret: (value: string) => `****${value.slice(-4)}`,
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: { "product.paper_trading": true } }),
    isCapabilityAllowed: () => true,
    sendCapabilityDenied: (res: any) => res
  } as any);

  const handler = getFinalPutHandler(app, "/exchange-accounts/:id");
  const res = createMockRes();

  await handler({
    params: { id: "hl_1" },
    body: {
      label: "New Label"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedData?.label, "New Label");
  assert.equal("credentialsRotatedAt" in updatedData, false);
  assert.equal("credentialsExpiryNoticeSentAt" in updatedData, false);
});

test("hyperliquid credential update resets credential rotation timer", async () => {
  const app = createFakeApp();
  let updatedData: any = null;

  registerExchangeAccountRoutes(app as any, {
    db: {
      exchangeAccount: {
        findFirst: async () => ({
          id: "hl_1",
          userId: "user_1",
          exchange: "hyperliquid",
          label: "Old",
          apiKeyEnc: "enc:0x1111111111111111111111111111111111111111",
          apiSecretEnc: "enc:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          passphraseEnc: null
        }),
        update: async ({ data }: any) => {
          updatedData = data;
          return { id: "hl_1", exchange: "hyperliquid", label: data.label };
        }
      }
    },
    encryptSecret: (value: string) => `enc:${value}`,
    decryptSecret: (value: string) => value.replace(/^enc:/, ""),
    maskSecret: (value: string) => `****${value.slice(-4)}`,
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: { "product.paper_trading": true } }),
    isCapabilityAllowed: () => true,
    sendCapabilityDenied: (res: any) => res
  } as any);

  const handler = getFinalPutHandler(app, "/exchange-accounts/:id");
  const res = createMockRes();

  await handler({
    params: { id: "hl_1" },
    body: {
      label: "New Label",
      apiSecret: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedData?.credentialsRotatedAt instanceof Date, true);
  assert.equal(updatedData?.credentialsExpiryNoticeSentAt, null);
});
