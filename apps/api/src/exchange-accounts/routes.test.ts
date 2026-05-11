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

function getFinalGetHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.get.get(path);
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

function createAssetsRouteDeps(overrides: Record<string, any> = {}) {
  const accounts = [
    { id: "bitget_1", exchange: "bitget", label: "Bitget Main" },
    { id: "bitget_2", exchange: "bitget", label: "Bitget Alt" },
    { id: "paper_1", exchange: "paper", label: "Paper Spot" },
    { id: "err_1", exchange: "bitget", label: "Broken" }
  ];
  const tradingAccounts: Record<string, any> = {
    bitget_1: { id: "bitget_1", userId: "user_1", exchange: "bitget", label: "Bitget Main" },
    bitget_2: { id: "bitget_2", userId: "user_1", exchange: "bitget", label: "Bitget Alt" },
    paper_1: { id: "paper_1", userId: "user_1", exchange: "paper", label: "Paper Spot" },
    err_1: { id: "err_1", userId: "user_1", exchange: "bitget", label: "Broken" },
    linked_1: { id: "linked_1", userId: "user_1", exchange: "bitget", label: "Linked Bitget" }
  };
  const balancesByAccountId: Record<string, any[]> = {
    bitget_1: [
      { coin: "USDT", available: "25", frozen: "0" },
      { coin: "BTC", available: "0.2", frozen: "0.01" },
      { coin: "EMPTY", available: "0", frozen: "0" }
    ],
    bitget_2: [
      { asset: "USDC", available: 5, locked: 0 },
      { asset: "XRP", available: 12, locked: 0 }
    ],
    linked_1: [
      { coin: "USDT", available: "10", frozen: "0" },
      { coin: "ETH", available: "2", frozen: "0" }
    ]
  };
  const priceBySymbol: Record<string, number> = {
    BTCUSDT: 50_000,
    ETHUSDT: 3_000
  };

  return {
    db: {
      exchangeAccount: {
        findMany: async ({ where }: any) => {
          const rows = where?.id ? accounts.filter((row) => row.id === where.id) : accounts;
          return rows.filter((row) => row.id !== "linked_1");
        }
      }
    },
    normalizeExchangeValue: (value: string) => value.trim().toLowerCase(),
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => {
      const selectedAccount = tradingAccounts[exchangeAccountId];
      if (!selectedAccount) throw new Error("account_not_found");
      return {
        selectedAccount,
        marketDataAccount: exchangeAccountId === "paper_1" ? tradingAccounts.linked_1 : selectedAccount
      };
    },
    createManualSpotClient: (account: any) => ({
      getBalances: async () => {
        if (account.id === "err_1") {
          const error = new Error("Private spot endpoint unavailable") as Error & { code?: string };
          error.code = "spot_unavailable";
          throw error;
        }
        return balancesByAccountId[account.id] ?? [];
      },
      getLastPrice: async (symbol: string) => {
        if (!Object.prototype.hasOwnProperty.call(priceBySymbol, symbol)) {
          throw new Error("price_not_found");
        }
        return priceBySymbol[symbol];
      }
    }),
    ...overrides
  };
}

test("GET /exchange-accounts/assets normalizes spot assets and isolates account errors", async () => {
  const app = createFakeApp();
  registerExchangeAccountRoutes(app as any, createAssetsRouteDeps() as any);

  const handler = getFinalGetHandler(app, "/exchange-accounts/assets");
  const res = createMockRes();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.accounts?.length, 4);
  assert.equal(res.body?.meta?.partialErrors, 1);

  const bitget = res.body.accounts.find((row: any) => row.exchangeAccountId === "bitget_1");
  assert.equal(bitget?.status, "ok");
  assert.equal(bitget?.quoteAsset, "USDT");
  assert.equal(bitget?.assets?.length, 2);
  assert.deepEqual(bitget.assets.map((asset: any) => asset.asset), ["BTC", "USDT"]);
  assert.equal(bitget.assets[0].total, 0.21);
  assert.equal(bitget.assets[0].approxUsd, 10500);
  assert.equal(bitget.totals.approxUsd, 10525);

  const paper = res.body.accounts.find((row: any) => row.exchangeAccountId === "paper_1");
  assert.equal(paper?.status, "ok");
  assert.equal(paper?.exchange, "paper");
  assert.equal(paper?.marketDataExchange, "bitget");
  assert.deepEqual(paper.assets.map((asset: any) => asset.asset), ["ETH", "USDT"]);
  assert.equal(paper.assets[0].approxUsd, 6000);

  const bitgetAlt = res.body.accounts.find((row: any) => row.exchangeAccountId === "bitget_2");
  assert.equal(bitgetAlt?.status, "ok");
  assert.equal(bitgetAlt?.assets.find((asset: any) => asset.asset === "USDC")?.approxUsd, 5);
  assert.equal(bitgetAlt?.assets.find((asset: any) => asset.asset === "XRP")?.approxUsd, null);

  const broken = res.body.accounts.find((row: any) => row.exchangeAccountId === "err_1");
  assert.equal(broken?.status, "error");
  assert.equal(broken?.error?.code, "spot_unavailable");
});

test("GET /exchange-accounts/assets supports account filter and includeZero", async () => {
  const app = createFakeApp();
  registerExchangeAccountRoutes(app as any, createAssetsRouteDeps() as any);

  const handler = getFinalGetHandler(app, "/exchange-accounts/assets");
  const res = createMockRes();

  await handler({
    query: {
      exchangeAccountId: "bitget_1",
      includeZero: "true"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.accounts?.length, 1);
  assert.equal(res.body.accounts[0]?.exchangeAccountId, "bitget_1");
  assert.ok(res.body.accounts[0]?.assets?.some((asset: any) => asset.asset === "EMPTY" && asset.total === 0));
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
