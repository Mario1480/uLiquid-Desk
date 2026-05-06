import assert from "node:assert/strict";
import test from "node:test";
import { registerMobileDashboardRoutes } from "./routes.js";

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

function getHandlers(app: ReturnType<typeof createFakeApp>, path = "/mobile/dashboard") {
  const handlers = app.routes.get.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers;
}

function getFinalHandler(app: ReturnType<typeof createFakeApp>) {
  const handlers = getHandlers(app);
  return handlers[handlers.length - 1];
}

function createBaseDeps(overrides: Record<string, any> = {}) {
  const db = {
    exchangeAccount: {
      async findMany() {
        return [];
      }
    },
    bot: {
      async findMany() {
        return [];
      }
    },
    botTradeState: {
      async findMany() {
        return [];
      }
    },
    botTradeHistory: {
      async findMany() {
        return [];
      }
    },
    riskEvent: {
      async findMany() {
        return [];
      }
    },
    predictionState: {
      async findMany() {
        return [];
      }
    }
  };

  return {
    db,
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    ignoreMissingTable: async (read: any) => read(),
    readBotPrimaryTradeState: (rows: any[], botId: string) => rows.find((row) => row.botId === botId) ?? null,
    computeRuntimeMarkPrice: ({ mid, bid, ask }: any) => {
      if (Number.isFinite(Number(mid))) return Number(mid);
      if (Number.isFinite(Number(bid)) && Number.isFinite(Number(ask))) return (Number(bid) + Number(ask)) / 2;
      return null;
    },
    computeOpenPnlUsd: ({ side, qty, entryPrice, markPrice }: any) => {
      const size = Number(qty);
      const entry = Number(entryPrice);
      const mark = Number(markPrice);
      if (!Number.isFinite(size) || !Number.isFinite(entry) || !Number.isFinite(mark)) return null;
      return String(side).toLowerCase() === "short" ? (entry - mark) * size : (mark - entry) * size;
    },
    deriveStoppedWhy: ({ botStatus, runtimeReason, runtimeLastError, botLastError }: any) =>
      botStatus === "stopped" ? runtimeReason ?? runtimeLastError ?? botLastError ?? null : null,
    sumRealizedPnlUsdFromTradeEvents: () => 0,
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    toFiniteNumber: (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    },
    resolveMarketDataTradingAccount: async (_userId: string, exchangeAccountId: string) => ({
      selectedAccount: { id: exchangeAccountId, exchange: "paper" },
      marketDataAccount: { id: exchangeAccountId, exchange: "paper" }
    }),
    createManualPerpMarketDataClient: () => ({
      close: async () => {}
    }),
    createPerpExecutionAdapter: () => ({
      close: async () => {}
    }),
    listPaperPositions: async () => [],
    listPositions: async () => [],
    isPaperTradingAccount: (account: any) => String(account.exchange ?? "").toLowerCase() === "paper",
    loadGridDeskVisibilityMask: async () => ({
      symbolsByAccount: new Map(),
      orderIdsByAccount: new Map()
    }),
    filterGridBotPositionsForDesk: (rows: any[]) => rows,
    listNews: async () => ({
      items: [],
      meta: {
        mode: "all",
        page: 1,
        limit: 8,
        cache: "miss",
        fetchedAt: "2026-05-06T12:00:00.000Z"
      }
    }),
    getEconomicCalendarNextSummary: async () => ({
      currency: "USD",
      impactMin: "high",
      blackoutActive: false,
      activeWindow: null,
      nextEvent: null,
      asOf: "2026-05-06T12:00:00.000Z",
      degraded: false,
      degradedReason: null
    }),
    ...overrides
  };
}

test("mobile dashboard route can be guarded by auth middleware", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    authMiddleware: (_req: any, res: any) => res.status(401).json({ error: "unauthorized" })
  }) as any);

  const res = createMockRes();
  const handlers = getHandlers(app);
  await handlers[0]({}, res, () => {
    throw new Error("next_should_not_run");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, "unauthorized");
});

test("mobile dashboard returns empty state with stable sections", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps() as any);

  const handler = getFinalHandler(app);
  const res = createMockRes();
  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.totals?.totalEquity, 0);
  assert.equal(res.body?.bots?.summary?.total, 0);
  assert.equal(res.body?.predictions?.summary?.total, 0);
  assert.equal(Array.isArray(res.body?.positions?.items), true);
  assert.equal(res.body?.sections?.bots?.degraded, false);
});

test("mobile dashboard includes running and errored bots plus open positions", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    db: {
      exchangeAccount: {
        async findMany() {
          return [
            {
              id: "acc_1",
              exchange: "paper",
              label: "Paper",
              createdAt: new Date("2026-05-06T08:00:00.000Z"),
              lastUsedAt: new Date("2026-05-06T10:00:00.000Z"),
              spotBudgetTotal: 100,
              spotBudgetAvailable: 80,
              futuresBudgetEquity: 500,
              futuresBudgetAvailableMargin: 350,
              pnlTodayUsd: 12,
              lastSyncErrorAt: null,
              lastSyncErrorMessage: null
            }
          ];
        }
      },
      bot: {
        async findMany(args: any) {
          if (args.take) {
            return [
              {
                id: "bot_1",
                name: "Runner",
                symbol: "BTCUSDT",
                exchange: "paper",
                exchangeAccountId: "acc_1",
                status: "running",
                lastError: null,
                futuresConfig: { strategyKey: "prediction_copier", marginMode: "isolated", leverage: 2 },
                exchangeAccount: { id: "acc_1", exchange: "paper", label: "Paper" },
                runtime: { status: "running", reason: null, updatedAt: new Date("2026-05-06T10:00:00.000Z"), lastHeartbeatAt: null, lastTickAt: null, lastError: null, lastErrorAt: null, mid: 102, bid: null, ask: null },
                botVault: null
              },
              {
                id: "bot_2",
                name: "Broken",
                symbol: "ETHUSDT",
                exchange: "paper",
                exchangeAccountId: "acc_1",
                status: "error",
                lastError: "boom",
                futuresConfig: { strategyKey: "futures_grid", marginMode: "isolated", leverage: 1 },
                exchangeAccount: { id: "acc_1", exchange: "paper", label: "Paper" },
                runtime: null,
                botVault: null
              }
            ];
          }
          return [
            { id: "bot_1", exchangeAccountId: "acc_1", status: "running", lastError: null, runtime: { updatedAt: new Date("2026-05-06T10:00:00.000Z"), lastError: null, freeUsdt: 300 } },
            { id: "bot_2", exchangeAccountId: "acc_1", status: "error", lastError: "boom", runtime: null }
          ];
        }
      },
      botTradeState: {
        async findMany() {
          return [
            {
              botId: "bot_1",
              symbol: "BTCUSDT",
              openSide: "long",
              openQty: 1,
              openEntryPrice: 100,
              openTs: new Date("2026-05-06T09:00:00.000Z"),
              dailyTradeCount: 1
            }
          ];
        }
      },
      botTradeHistory: {
        async findMany() {
          return [];
        }
      },
      riskEvent: {
        async findMany() {
          return [];
        }
      },
      predictionState: {
        async findMany() {
          return [
            {
              id: "pred_state_1",
              exchange: "bitget",
              accountId: "acc_1",
              symbol: "BTCUSDT",
              marketType: "perp",
              timeframe: "15m",
              signalMode: "ai_only",
              signal: "up",
              expectedMovePct: 1.25,
              confidence: 72,
              explanation: "Momentum bleibt positiv.",
              tags: ["momentum", "ai"],
              keyDrivers: ["trend", "liquidity"],
              modelVersion: "model-v1",
              lastAiExplainedAt: new Date("2026-05-06T10:01:00.000Z"),
              lastChangeReason: "manual",
              autoScheduleEnabled: true,
              autoSchedulePaused: false,
              tsUpdated: new Date("2026-05-06T10:00:00.000Z"),
              tsPredictedFor: new Date("2026-05-06T10:15:00.000Z"),
              refreshStatus: "ok",
              lastRefreshErrorAt: null,
              lastRefreshError: null
            }
          ];
        }
      }
    },
    listPaperPositions: async () => [
      {
        symbol: "BTCUSDT",
        side: "long",
        size: 1,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 110,
        unrealizedPnl: 2
      }
    ]
  }) as any);

  const res = createMockRes();
  await getFinalHandler(app)({}, res);

  assert.equal(res.body?.bots?.summary?.running, 1);
  assert.equal(res.body?.bots?.summary?.error, 1);
  assert.equal(res.body?.bots?.items?.[0]?.trade?.openPnlUsd, 2);
  assert.equal(res.body?.positions?.items?.length, 1);
  assert.equal(res.body?.positions?.items?.[0]?.symbol, "BTCUSDT");
  assert.equal(res.body?.predictions?.summary?.up, 1);
  assert.equal(res.body?.predictions?.items?.[0]?.signalMode, "ai_only");
  assert.equal(res.body?.totals?.totalEquity, 600);
});

test("mobile dashboard filters archived grid bots in bot queries", async () => {
  const app = createFakeApp();
  const botQueries: any[] = [];
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    db: {
      exchangeAccount: {
        async findMany() {
          return [];
        }
      },
      bot: {
        async findMany(args: any) {
          botQueries.push(args);
          return [];
        }
      },
      botTradeState: { async findMany() { return []; } },
      botTradeHistory: { async findMany() { return []; } },
      riskEvent: { async findMany() { return []; } },
      predictionState: { async findMany() { return []; } }
    }
  }) as any);

  const res = createMockRes();
  await getFinalHandler(app)({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(botQueries.length, 2);
  for (const query of botQueries) {
    assert.deepEqual(query.where.OR, [
      { gridInstance: { is: null } },
      {
        gridInstance: {
          is: {
            archivedAt: null,
            state: { not: "archived" }
          }
        }
      }
    ]);
  }
});

test("mobile dashboard marks positions degraded when account reads fail", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    db: {
      exchangeAccount: {
        async findMany() {
          return [
            {
              id: "acc_1",
              exchange: "paper",
              label: "Paper",
              createdAt: new Date("2026-05-06T08:00:00.000Z"),
              lastUsedAt: null,
              spotBudgetTotal: null,
              spotBudgetAvailable: null,
              futuresBudgetEquity: null,
              futuresBudgetAvailableMargin: null,
              pnlTodayUsd: null,
              lastSyncErrorAt: null,
              lastSyncErrorMessage: null
            }
          ];
        }
      },
      bot: { async findMany() { return []; } },
      botTradeState: { async findMany() { return []; } },
      botTradeHistory: { async findMany() { return []; } },
      riskEvent: { async findMany() { return []; } },
      predictionState: { async findMany() { return []; } }
    },
    resolveMarketDataTradingAccount: async () => {
      throw new Error("exchange_down");
    }
  }) as any);

  const res = createMockRes();
  await getFinalHandler(app)({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.positions?.meta?.degraded, true);
  assert.equal(res.body?.sections?.positions?.degraded, true);
});

test("mobile dashboard degrades news independently", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    listNews: async () => {
      throw new Error("news_provider_unavailable");
    }
  }) as any);

  const res = createMockRes();
  await getFinalHandler(app)({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.news?.items?.length, 0);
  assert.equal(res.body?.sections?.news?.degraded, true);
  assert.equal(res.body?.sections?.calendarNext?.degraded, false);
});

test("mobile dashboard degrades calendar independently", async () => {
  const app = createFakeApp();
  registerMobileDashboardRoutes(app as any, createBaseDeps({
    getEconomicCalendarNextSummary: async () => {
      throw new Error("calendar_unavailable");
    }
  }) as any);

  const res = createMockRes();
  await getFinalHandler(app)({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.calendarNext, null);
  assert.equal(res.body?.sections?.calendarNext?.degraded, true);
  assert.equal(res.body?.sections?.news?.degraded, false);
});
