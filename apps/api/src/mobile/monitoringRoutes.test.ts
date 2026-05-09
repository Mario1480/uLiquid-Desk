import assert from "node:assert/strict";
import test from "node:test";
import { registerMobileMonitoringRoutes } from "./monitoringRoutes.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  const deleteRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    delete(path: string, ...handlers: Array<(...args: any[]) => any>) {
      deleteRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      post: postRoutes,
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

function getFinalHandler(app: ReturnType<typeof createFakeApp>, method: "get" | "post" | "delete", path: string) {
  const handlers = app.routes[method].get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${method}:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createDeps(overrides: Record<string, any> = {}) {
  const watchlistRows: any[] = [];
  const state = {
    watchlistRows,
    bots: [] as any[],
    accounts: [] as any[],
    predictions: [] as any[],
    tradeStates: [] as any[],
    riskEvents: [] as any[]
  };
  const db = {
    mobileWatchlistItem: {
      async findMany() {
        return watchlistRows;
      },
      async count() {
        return watchlistRows.length;
      },
      async upsert(args: any) {
        const key = args.where.userId_symbol_marketType_exchange;
        const existing = watchlistRows.find((row) =>
          row.userId === key.userId &&
          row.symbol === key.symbol &&
          row.marketType === key.marketType &&
          row.exchange === key.exchange
        );
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row = {
          id: `watch_${watchlistRows.length + 1}`,
          createdAt: new Date("2026-05-08T12:00:00.000Z"),
          updatedAt: new Date("2026-05-08T12:00:00.000Z"),
          ...args.create
        };
        watchlistRows.push(row);
        return row;
      },
      async deleteMany(args: any) {
        const before = watchlistRows.length;
        for (let index = watchlistRows.length - 1; index >= 0; index -= 1) {
          const row = watchlistRows[index];
          if (row.userId === args.where.userId && row.symbol === args.where.symbol) {
            watchlistRows.splice(index, 1);
          }
        }
        return { count: before - watchlistRows.length };
      }
    },
    exchangeAccount: {
      async findMany() {
        return state.accounts;
      }
    },
    bot: {
      async findMany() {
        return state.bots;
      }
    },
    predictionState: {
      async findMany() {
        return state.predictions;
      }
    },
    botTradeState: {
      async findMany() {
        return state.tradeStates;
      }
    },
    riskEvent: {
      async findMany() {
        return state.riskEvents;
      }
    },
    dashboardPerformanceSnapshot: {
      async findMany() {
        return [];
      }
    },
    dashboardPerformanceAccountSnapshot: {
      async findMany() {
        return [];
      }
    },
    botTradeHistory: {
      async findMany() {
        return [];
      }
    },
    predictionEvent: {
      async findMany() {
        return [];
      }
    }
  };

  return {
    state,
    db,
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    ignoreMissingTable: async (read: any) => read(),
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    toFiniteNumber: (value: unknown) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string" && value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    },
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => ({
      selectedAccount: { id: exchangeAccountId, exchange: "paper" },
      marketDataAccount: { id: exchangeAccountId, exchange: "paper" }
    }),
    normalizeSymbolInput: (value: string | null | undefined) =>
      String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null,
    marketTimeframeToBitgetGranularity: (timeframe: string) => timeframe,
    parseBitgetCandles: (value: unknown) => Array.isArray(value) ? value : [],
    createManualPerpMarketDataClient: () => ({
      async getCandles() {
        return [];
      },
      close: async () => {}
    }),
    createPerpExecutionAdapter: () => ({ close: async () => {} }),
    listPaperPositions: async () => [],
    listPositions: async () => [],
    isPaperTradingAccount: (account: any) => String(account.exchange ?? "").toLowerCase() === "paper",
    loadGridDeskVisibilityMask: async () => ({ symbolsByAccount: new Map(), orderIdsByAccount: new Map() }),
    filterGridBotPositionsForDesk: (rows: any[]) => rows,
    listNews: async () => ({
      items: [],
      meta: {
        mode: "all",
        page: 1,
        limit: 30,
        cache: "miss",
        fetchedAt: "2026-05-08T12:00:00.000Z"
      }
    }),
    ...overrides
  };
}

test("mobile monitoring routes can be guarded by auth middleware", async () => {
  const app = createFakeApp();
  registerMobileMonitoringRoutes(app as any, createDeps({
    authMiddleware: (_req: any, res: any) => res.status(401).json({ error: "unauthorized" })
  }) as any);

  const handler = app.routes.get.get("/mobile/watchlist")?.[0];
  const res = createMockRes();
  await handler?.({}, res, () => {
    throw new Error("next_should_not_run");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "unauthorized");
});

test("mobile watchlist supports add list and delete", async () => {
  const app = createFakeApp();
  const deps = createDeps();
  registerMobileMonitoringRoutes(app as any, deps as any);

  const createHandler = getFinalHandler(app, "post", "/mobile/watchlist");
  const createRes = createMockRes();
  await createHandler({ body: { symbol: "btcusdt", marketType: "perp" } }, createRes);

  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.body?.item?.symbol, "BTCUSDT");

  const listHandler = getFinalHandler(app, "get", "/mobile/watchlist");
  const listRes = createMockRes();
  await listHandler({}, listRes);

  assert.equal(listRes.body?.items?.length, 1);
  assert.equal(listRes.body?.items?.[0]?.exchange, null);

  const deleteHandler = getFinalHandler(app, "delete", "/mobile/watchlist/:symbol");
  const deleteRes = createMockRes();
  await deleteHandler({ params: { symbol: "BTCUSDT" } }, deleteRes);

  assert.equal(deleteRes.body?.deleted, 1);
  assert.equal(deps.state.watchlistRows.length, 0);
});

test("mobile bot health flags stale running bots and degraded predictions", async () => {
  const app = createFakeApp();
  const deps = createDeps();
  deps.state.bots.push({
    id: "bot_1",
    name: "BTC Bot",
    symbol: "BTCUSDT",
    exchange: "paper",
    status: "running",
    exchangeAccountId: "acc_1",
    runtime: {
      updatedAt: new Date("2026-05-08T10:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-05-08T10:00:00.000Z"),
      lastTickAt: new Date("2026-05-08T10:00:00.000Z")
    },
    tradeStates: [],
    futuresConfig: { strategyKey: "prediction_copier", leverage: 3 },
    exchangeAccount: { id: "acc_1", exchange: "paper", label: "Paper" },
    botVault: null
  });
  deps.state.accounts.push({ id: "acc_1", futuresBudgetEquity: 1000, futuresBudgetAvailableMargin: 800 });
  deps.state.predictions.push({
    id: "pred_1",
    accountId: "acc_1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    signal: "up",
    confidence: 70,
    expectedMovePct: 1.2,
    tsUpdated: new Date("2026-05-08T11:00:00.000Z"),
    refreshStatus: "error",
    lastRefreshError: "provider down"
  });
  registerMobileMonitoringRoutes(app as any, deps as any);

  const handler = getFinalHandler(app, "get", "/mobile/bot-health");
  const res = createMockRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.summary?.running, 1);
  assert.equal(res.body?.items?.[0]?.runtime?.stale, true);
  assert.equal(res.body?.items?.[0]?.warnings.includes("prediction_degraded"), true);
});

test("mobile position risk prefers exchange leverage margin and liquidation fields", async () => {
  const app = createFakeApp();
  const deps = createDeps({
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => ({
      selectedAccount: { id: exchangeAccountId, exchange: "bitget" },
      marketDataAccount: { id: exchangeAccountId, exchange: "bitget" }
    }),
    listPositions: async () => [
      {
        symbol: "BNBUSDT",
        side: "long",
        size: 5,
        entryPrice: 643.53,
        markPrice: 643.99,
        unrealizedPnl: 2.29,
        leverage: 5,
        marginMode: "isolated",
        marginUsd: 643.99,
        notionalUsd: 3219.95,
        liquidationPrice: 522.5,
        liquidationDistancePct: 18.8652,
        roePct: 0.3556,
        pnlPct: 0.0711,
        stopLossPrice: null,
        takeProfitPrice: null
      }
    ]
  });
  deps.state.accounts.push({ id: "acc_live", exchange: "bitget", label: "Bitget Main" });
  deps.state.bots.push({
    id: "bot_1",
    symbol: "BNBUSDT",
    exchangeAccountId: "acc_live",
    status: "running",
    futuresConfig: { leverage: 2 }
  });
  registerMobileMonitoringRoutes(app as any, deps as any);

  const handler = getFinalHandler(app, "get", "/mobile/position-risk");
  const res = createMockRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body.items[0].leverage, 5);
  assert.equal(res.body.items[0].marginMode, "isolated");
  assert.equal(res.body.items[0].marginUsd, 643.99);
  assert.equal(res.body.items[0].liquidationPrice, 522.5);
  assert.equal(res.body.items[0].liquidationDistancePct, 18.8652);
  assert.equal(res.body.items[0].roePct, 0.3556);
  assert.equal(res.body.items[0].pnlPct, 0.0711);
});

test("mobile position chart candles are read-only and do not require manual trading route", async () => {
  const app = createFakeApp();
  const deps = createDeps({
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => ({
      selectedAccount: { id: exchangeAccountId, exchange: "bitget" },
      marketDataAccount: { id: exchangeAccountId, exchange: "bitget" }
    }),
    createManualPerpMarketDataClient: () => ({
      async getCandles(params: any) {
        assert.equal(params.symbol, "BNBUSDT");
        assert.equal(params.timeframe, "15m");
        return [
          { ts: 1778256000000, open: 100, high: 105, low: 99, close: 103, volume: 12.5 }
        ];
      },
      close: async () => {}
    })
  });
  registerMobileMonitoringRoutes(app as any, deps as any);

  const handler = getFinalHandler(app, "get", "/mobile/position-chart/candles");
  const res = createMockRes();
  await handler({
    query: {
      exchangeAccountId: "acc_live",
      symbol: "bnbusdt",
      timeframe: "15m",
      limit: "50"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.degraded, false);
  assert.equal(res.body?.exchangeAccountId, "acc_live");
  assert.equal(res.body?.symbol, "BNBUSDT");
  assert.equal(res.body?.items?.[0]?.close, 103);
});

test("mobile position chart ticker returns lightweight live price", async () => {
  const app = createFakeApp();
  const deps = createDeps({
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => ({
      selectedAccount: { id: exchangeAccountId, exchange: "bitget" },
      marketDataAccount: { id: exchangeAccountId, exchange: "bitget" }
    }),
    createManualPerpMarketDataClient: () => ({
      async getTicker(symbol: string) {
        assert.equal(symbol, "BNBUSDT");
        return {
          symbol,
          last: 650.12,
          mark: 650.18,
          bid: 650.1,
          ask: 650.2,
          ts: 1778256000123
        };
      },
      close: async () => {}
    })
  });
  registerMobileMonitoringRoutes(app as any, deps as any);

  const handler = getFinalHandler(app, "get", "/mobile/position-chart/ticker");
  const res = createMockRes();
  await handler({
    query: {
      exchangeAccountId: "acc_live",
      symbol: "bnbusdt"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.degraded, false);
  assert.equal(res.body?.exchangeAccountId, "acc_live");
  assert.equal(res.body?.symbol, "BNBUSDT");
  assert.equal(res.body?.markPrice, 650.18);
  assert.equal(res.body?.lastPrice, 650.12);
  assert.equal(res.body?.bidPrice, 650.1);
  assert.equal(res.body?.askPrice, 650.2);
  assert.equal(res.body?.ts, 1778256000123);
});
