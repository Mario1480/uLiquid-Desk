import assert from "node:assert/strict";
import test from "node:test";
import { registerDashboardRoutes } from "./routes.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      put: putRoutes
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

function getFinalPutHandler(app: ReturnType<typeof createFakeApp>, path: string) {
  const handlers = app.routes.put.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

test("dashboard layout returns defaults when no user layout exists", async () => {
  const app = createFakeApp();

  registerDashboardRoutes(app as any, {
    db: {
      globalSetting: {
        async findUnique() {
          return null;
        }
      }
    }
  } as any);

  const handler = getFinalHandler(app, "/dashboard/layout");
  const res = createMockRes();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.version, 1);
  assert.equal(res.body?.desktop?.columns, 12);
  assert.equal(Array.isArray(res.body?.items), true);
  assert.equal(res.body?.items?.length, 8);
  assert.equal(res.body?.items?.[0]?.id, "alerts");
  assert.equal(res.body?.updatedAt, null);
});

test("dashboard layout update rejects duplicate widgets", async () => {
  const app = createFakeApp();

  registerDashboardRoutes(app as any, {
    db: {
      globalSetting: {
        async upsert() {
          throw new Error("should_not_be_called");
        }
      }
    }
  } as any);

  const handler = getFinalPutHandler(app, "/dashboard/layout");
  const res = createMockRes();

  await handler({
    body: {
      version: 1,
      desktop: { columns: 12, gap: 12, rowHeight: 96 },
      items: [
        { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 },
        { id: "alerts", visible: false, x: 0, y: 2, w: 4, h: 2 }
      ]
    }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "invalid_payload");
});

test("dashboard layout update stores normalized layout", async () => {
  const app = createFakeApp();
  let savedValue: any = null;

  registerDashboardRoutes(app as any, {
    db: {
      globalSetting: {
        async upsert(args: any) {
          savedValue = args.update.value;
          return { updatedAt: new Date("2026-03-24T12:00:00.000Z") };
        }
      }
    }
  } as any);

  const handler = getFinalPutHandler(app, "/dashboard/layout");
  const res = createMockRes();

  await handler({
    body: {
      version: 1,
      desktop: { columns: 12, gap: 12, rowHeight: 96 },
      items: [
        { id: "wallet", visible: true, x: 0, y: 15, w: 4, h: 3 },
        { id: "alerts", visible: true, x: 0, y: 0, w: 12, h: 2 }
      ]
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedValue?.items?.length, 8);
  assert.equal(res.body?.items?.length, 8);
  assert.equal(res.body?.updatedAt, "2026-03-24T12:00:00.000Z");
  assert.equal(res.body?.items?.find((item: any) => item.id === "wallet")?.w, 4);
  assert.equal(res.body?.items?.find((item: any) => item.id === "performance")?.id, "performance");
});

test("dashboard alerts suppress stale sync warnings for paper accounts", async () => {
  const app = createFakeApp();
  const staleTs = new Date(Date.now() - 2 * 60 * 60 * 1000);

  registerDashboardRoutes(app as any, {
    db: {
      exchangeAccount: {
        async findMany() {
          return [
            {
              id: "paper_1",
              exchange: "paper",
              label: "Demo",
              lastUsedAt: staleTs,
              futuresBudgetEquity: 20_000,
              futuresBudgetAvailableMargin: 10_000,
              lastSyncErrorAt: null,
              lastSyncErrorMessage: null
            }
          ];
        }
      },
      bot: {
        async findMany() {
          return [
            {
              id: "bot_1",
              name: "Demo Bot",
              status: "running",
              lastError: null,
              updatedAt: staleTs,
              exchangeAccountId: "paper_1",
              runtime: {
                updatedAt: staleTs,
                lastHeartbeatAt: staleTs,
                lastTickAt: staleTs,
                lastError: null,
                lastErrorAt: null,
                lastErrorMessage: null,
                reason: null,
                freeUsdt: 10_000
              }
            }
          ];
        }
      },
      riskEvent: {
        async findMany() {
          return [];
        }
      }
    },
    DASHBOARD_ALERT_STALE_SYNC_MS: 30 * 60 * 1000,
    DASHBOARD_MARGIN_WARN_RATIO: 0.1,
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    listPaperMarketDataAccountIds: async () => ({}),
    resolveLastSyncAt: (runtime: any) => runtime?.updatedAt ?? null,
    computeConnectionStatus: () => "disconnected",
    createDashboardAlertId: (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(":"),
    alertSeverityRank: (value: string) => (value === "critical" ? 3 : value === "warning" ? 2 : 1),
    toFiniteNumber: (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    },
    getAiPayloadBudgetAlertSnapshot: () => ({
      highWaterAlert: false,
      highWaterConsecutive: 0,
      highWaterConsecutiveThreshold: 0,
      lastHighWaterAt: null,
      trimAlert: false,
      trimCountLastHour: 0,
      trimAlertThresholdPerHour: 0
    })
  } as any);

  const handler = getFinalHandler(app, "/dashboard/alerts");
  const res = createMockRes();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body?.items, []);
});

test("dashboard alerts still emit stale sync warnings for live accounts", async () => {
  const app = createFakeApp();
  const staleTs = new Date(Date.now() - 2 * 60 * 60 * 1000);

  registerDashboardRoutes(app as any, {
    db: {
      exchangeAccount: {
        async findMany() {
          return [
            {
              id: "bitget_1",
              exchange: "bitget",
              label: "Bitget Main",
              lastUsedAt: staleTs,
              futuresBudgetEquity: 20_000,
              futuresBudgetAvailableMargin: 10_000,
              lastSyncErrorAt: null,
              lastSyncErrorMessage: null
            }
          ];
        }
      },
      bot: {
        async findMany() {
          return [
            {
              id: "bot_1",
              name: "Live Bot",
              status: "running",
              lastError: null,
              updatedAt: staleTs,
              exchangeAccountId: "bitget_1",
              runtime: {
                updatedAt: staleTs,
                lastHeartbeatAt: staleTs,
                lastTickAt: staleTs,
                lastError: null,
                lastErrorAt: null,
                lastErrorMessage: null,
                reason: null,
                freeUsdt: 10_000
              }
            }
          ];
        }
      },
      riskEvent: {
        async findMany() {
          return [];
        }
      }
    },
    DASHBOARD_ALERT_STALE_SYNC_MS: 30 * 60 * 1000,
    DASHBOARD_MARGIN_WARN_RATIO: 0.1,
    normalizeExchangeValue: (value: string) => String(value ?? "").trim().toLowerCase(),
    listPaperMarketDataAccountIds: async () => ({}),
    resolveLastSyncAt: (runtime: any) => runtime?.updatedAt ?? null,
    computeConnectionStatus: () => "connected",
    createDashboardAlertId: (parts: Array<string | null | undefined>) => parts.filter(Boolean).join(":"),
    alertSeverityRank: (value: string) => (value === "critical" ? 3 : value === "warning" ? 2 : 1),
    toFiniteNumber: (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    },
    getAiPayloadBudgetAlertSnapshot: () => ({
      highWaterAlert: false,
      highWaterConsecutive: 0,
      highWaterConsecutiveThreshold: 0,
      lastHighWaterAt: null,
      trimAlert: false,
      trimCountLastHour: 0,
      trimAlertThresholdPerHour: 0
    })
  } as any);

  const handler = getFinalHandler(app, "/dashboard/alerts");
  const res = createMockRes();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.items?.length, 1);
  assert.equal(res.body?.items?.[0]?.type, "SYNC_FAIL");
  assert.match(String(res.body?.items?.[0]?.title ?? ""), /Sync stale/i);
});
