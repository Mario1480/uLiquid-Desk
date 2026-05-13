import assert from "node:assert/strict";
import test from "node:test";
import { registerMobileTradingRoutes } from "./tradingRoutes.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes
    }
  };
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
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

function createDeps(overrides: Record<string, any> = {}) {
  const adapter = {
    async getAccountState() {
      return {
        equity: 1234.56,
        availableMargin: 900.12,
        marginMode: "isolated"
      };
    },
    async close() {
      return undefined;
    }
  };

  return {
    async getTradingSettings() {
      return { marketType: "perp" };
    },
    async resolveMarketDataTradingAccount() {
      return {
        selectedAccount: { id: "acct_1", exchange: "bitget" },
        marketDataAccount: { id: "acct_1", exchange: "bitget" }
      };
    },
    sendManualTradingError(res: any, error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: message });
    },
    normalizeSpotSymbol(value: string | null | undefined) {
      return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    },
    normalizeSymbolInput(value: string | null | undefined) {
      const normalized = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      return normalized || null;
    },
    createPerpExecutionAdapter() {
      return adapter;
    },
    isPaperTradingAccount() {
      return false;
    },
    async getPaperAccountState() {
      return {};
    },
    async getPaperSpotAccountState() {
      return {};
    },
    async listPaperPositions() {
      return [];
    },
    async listPaperSpotPositions() {
      return [];
    },
    async listPaperOpenOrders() {
      return [];
    },
    async listPaperSpotOpenOrders() {
      return [];
    },
    async listPositions() {
      return [{
        symbol: "BTCUSDT",
        side: "long",
        size: 0.25,
        entryPrice: 65000,
        markPrice: 66000,
        unrealizedPnl: 250,
        leverage: 10,
        marginMode: "isolated",
        marginUsd: 1650,
        notionalUsd: 16500,
        liquidationPrice: 50000,
        liquidationDistancePct: 24,
        roePct: 15,
        pnlPct: 1.5,
        takeProfitPrice: 70000,
        stopLossPrice: 62000
      }];
    },
    async listOpenOrders() {
      return [{
        orderId: "ord_1",
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        status: "open",
        price: 64000,
        qty: 0.1,
        triggerPrice: null,
        takeProfitPrice: null,
        stopLossPrice: null,
        reduceOnly: false,
        createdAt: "2026-05-13T12:00:00.000Z",
        raw: {}
      }];
    },
    async loadGridDeskVisibilityMask() {
      return {};
    },
    filterGridBotPositionsForDesk(rows: any[]) {
      return rows;
    },
    filterGridBotOrdersForDesk(rows: any[]) {
      return rows;
    },
    splitCanonicalSymbol(symbol: string) {
      const normalized = symbol.toUpperCase();
      return {
        baseAsset: normalized.replace(/USDT$/, ""),
        quoteAsset: normalized.endsWith("USDT") ? "USDT" : null
      };
    },
    async placePaperOrder() {
      return { orderId: "paper_order" };
    },
    async placePaperSpotOrder() {
      return { orderId: "paper_spot_order" };
    },
    async cancelPaperOrder() {
      return { ok: true };
    },
    async cancelPaperSpotOrder() {
      return { ok: true };
    },
    async setPaperPositionTpSl() {
      return { updated: true };
    },
    async setPositionTpSl() {
      return { ok: true };
    },
    async cancelAllOrders() {
      return { requested: 0, cancelled: 0, failed: 0 };
    },
    async closePositionsMarket() {
      return ["close_1"];
    },
    async closePaperPosition() {
      return ["paper_close_1"];
    },
    async closePaperSpotPosition() {
      return ["paper_spot_close_1"];
    },
    ...overrides
  };
}

test("mobile trading routes register iOS contract paths", () => {
  const app = createFakeApp();
  registerMobileTradingRoutes(app as any, createDeps() as any);

  assert.ok(app.routes.get.has("/mobile/trading/state"));
  assert.ok(app.routes.post.has("/mobile/trading/orders"));
  assert.ok(app.routes.post.has("/mobile/trading/orders/:id/cancel"));
  assert.ok(app.routes.post.has("/mobile/trading/positions/close"));
  assert.ok(app.routes.post.has("/mobile/trading/positions/protection"));
});

test("mobile trading state aggregates perp balances positions and open orders", async () => {
  const app = createFakeApp();
  registerMobileTradingRoutes(app as any, createDeps() as any);
  const handler = getFinalHandler(app, "get", "/mobile/trading/state");
  const res = createMockRes();

  await handler({
    query: {
      exchangeAccountId: "acct_1",
      marketType: "perp",
      symbol: "BTCUSDT"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.exchangeAccountId, "acct_1");
  assert.equal(res.body.marketType, "perp");
  assert.equal(res.body.symbol, "BTCUSDT");
  assert.equal(res.body.balances.availableMargin, 900.12);
  assert.equal(res.body.capabilities.supportsTPSL, true);
  assert.equal(res.body.positions[0].side, "long");
  assert.equal(res.body.positions[0].takeProfitPrice, 70000);
  assert.equal(res.body.openOrders[0].id, "ord_1");
  assert.equal(res.body.openOrders[0].orderType, "limit");
});
