import assert from "node:assert/strict";
import test from "node:test";
import { registerEconomicCalendarRoutes } from "./economic-calendar.js";

type RouteMap = Map<string, Array<(...args: any[]) => any>>;

function createFakeApp() {
  const getRoutes: RouteMap = new Map();
  const putRoutes: RouteMap = new Map();
  const postRoutes: RouteMap = new Map();
  return {
    get(path: string, ...handlers: Array<(...args: any[]) => any>) {
      getRoutes.set(path, handlers);
    },
    put(path: string, ...handlers: Array<(...args: any[]) => any>) {
      putRoutes.set(path, handlers);
    },
    post(path: string, ...handlers: Array<(...args: any[]) => any>) {
      postRoutes.set(path, handlers);
    },
    routes: {
      get: getRoutes,
      put: putRoutes,
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
  const handlers = app.routes.get.get(path);
  if (!handlers || handlers.length === 0) {
    throw new Error(`route_not_found:${path}`);
  }
  return handlers[handlers.length - 1];
}

function createEconomicEvent(index: number) {
  return {
    id: `evt_${index}`,
    sourceId: `evt_${index}`,
    ts: new Date(`2026-02-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`),
    country: "US",
    currency: "USD",
    title: `Event ${index}`,
    impact: "high",
    forecast: null,
    previous: null,
    actual: null,
    source: "fmp"
  };
}

test("economic calendar rejects from dates after to dates", async () => {
  const app = createFakeApp();
  registerEconomicCalendarRoutes(app as any, {
    db: {},
    requireSuperadmin: async () => true
  });
  const handler = getFinalHandler(app, "/economic-calendar");
  const res = createMockRes();

  await handler({ query: { from: "2026-02-10", to: "2026-02-09" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "invalid_date_range");
});

test("economic calendar rejects ranges over 31 calendar days", async () => {
  const app = createFakeApp();
  registerEconomicCalendarRoutes(app as any, {
    db: {},
    requireSuperadmin: async () => true
  });
  const handler = getFinalHandler(app, "/economic-calendar");
  const res = createMockRes();

  await handler({ query: { from: "2026-02-01", to: "2026-03-05" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "calendar_range_too_large");
});

test("economic calendar applies limit and exposes truncated metadata", async () => {
  const app = createFakeApp();
  let observedTake: number | undefined;
  registerEconomicCalendarRoutes(app as any, {
    db: {
      economicCalendarConfig: {
        async upsert() {
          return {};
        }
      },
      economicEvent: {
        async findMany(args: any) {
          observedTake = args.take;
          return [0, 1, 2, 3].map(createEconomicEvent);
        }
      }
    },
    requireSuperadmin: async () => true
  });
  const handler = getFinalHandler(app, "/economic-calendar");
  const res = createMockRes();

  await handler({
    query: {
      from: "2026-02-01",
      to: "2026-02-05",
      limit: "3",
      impacts: "high",
      currencies: "USD"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(observedTake, 4);
  assert.equal(res.body?.events?.length, 3);
  assert.equal(res.body?.meta?.limit, 3);
  assert.equal(res.body?.meta?.truncated, true);
  assert.equal(res.body?.meta?.from, "2026-02-01");
  assert.equal(res.body?.meta?.to, "2026-02-05");
});

test("economic calendar clamps oversized limits to the server maximum", async () => {
  const app = createFakeApp();
  let observedTake: number | undefined;
  registerEconomicCalendarRoutes(app as any, {
    db: {
      economicCalendarConfig: {
        async upsert() {
          return {};
        }
      },
      economicEvent: {
        async findMany(args: any) {
          observedTake = args.take;
          return [];
        }
      }
    },
    requireSuperadmin: async () => true
  });
  const handler = getFinalHandler(app, "/economic-calendar");
  const res = createMockRes();

  await handler({
    query: {
      from: "2026-02-01",
      to: "2026-02-05",
      limit: "5000"
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(observedTake, 1001);
  assert.equal(res.body?.meta?.limit, 1000);
});
