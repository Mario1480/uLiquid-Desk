import assert from "node:assert/strict";
import test from "node:test";
import {
  registerDashboardWorkbenchRoutes,
  alertReached,
  summarizeTrades,
  type JournalTrade
} from "./workbench.js";
import { resolvePermissionRequirementForRequest } from "../auth/permissions.js";

function setup(degraded = false) {
  const routes = new Map<string, Function[]>();
  const rows = new Map<string, { value: unknown; updatedAt: Date }>();
  let tick = Date.now();
  const app = Object.fromEntries(
    ["get", "put", "post"].map((verb) => [
      verb,
      (path: string, ...handlers: Function[]) =>
        routes.set(`${verb}:${path}`, handlers)
    ])
  );
  const db = {
    globalSetting: {
      async findUnique({ where }: any) {
        return rows.get(where.key) ?? null;
      },
      async create({ data }: any) {
        if (rows.has(data.key)) throw { code: "P2002" };
        rows.set(data.key, { value: data.value, updatedAt: new Date(++tick) });
      },
      async updateMany({ where, data }: any) {
        const row = rows.get(where.key);
        if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime())
          return { count: 0 };
        rows.set(where.key, { value: data.value, updatedAt: new Date(++tick) });
        return { count: 1 };
      }
    }
  };
  registerDashboardWorkbenchRoutes(app as any, db, async () => ({
    items: [
      {
        symbol: "BTCUSDT",
        price: 110,
        changePct24h: 0,
        high24h: null,
        low24h: null
      }
    ],
    fetchedAt: new Date().toISOString(),
    degraded
  }));
  async function call(
    verb: string,
    path: string,
    body?: unknown,
    userId = "alice",
    section = "notes"
  ) {
    const handlers = routes.get(`${verb}:${path}`)!;
    assert.equal(handlers.length, 2, "all routes must require authentication");
    const res = {
      locals: { user: { id: userId } },
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
    await handlers.at(-1)!({ params: { section }, body }, res);
    return res;
  }
  return { call, rows };
}

test("personal documents isolate users and reject stale concurrent writes", async () => {
  const { call } = setup();
  const saved = await call("put", "/dashboard/workbench/:section", {
    revision: null,
    value: { text: "Alice", checklist: [] }
  });
  assert.equal(saved.statusCode, 200);
  const bob = await call(
    "get",
    "/dashboard/workbench/:section",
    undefined,
    "bob"
  );
  assert.equal(bob.body.value.text, "");
  const next = await call("put", "/dashboard/workbench/:section", {
    revision: saved.body.revision,
    value: { text: "New", checklist: [] }
  });
  assert.equal(next.statusCode, 200);
  const conflict = await call("put", "/dashboard/workbench/:section", {
    revision: saved.body.revision,
    value: { text: "Old tab", checklist: [] }
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(
    (await call("get", "/dashboard/workbench/:section")).body.value.text,
    "New"
  );
});

test("invalid documents never reach persistence", async () => {
  const { call, rows } = setup();
  const invalid = await call("put", "/dashboard/workbench/:section", {
    revision: null,
    value: { text: "a".repeat(10001), checklist: [] }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(rows.size, 0);
});

test("price alerts latch once on fresh prices and ignore degraded quotes", async () => {
  for (const degraded of [false, true]) {
    const { call } = setup(degraded);
    const value = {
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          symbol: "BTCUSDT",
          direction: "above",
          target: 100,
          enabled: true,
          triggeredAt: null
        }
      ]
    };
    await call(
      "put",
      "/dashboard/workbench/:section",
      { revision: null, value },
      "alice",
      "price-alerts"
    );
    const first = await call("post", "/dashboard/price-alerts/check");
    const triggeredAt = first.body.value.items[0].triggeredAt;
    assert.equal(triggeredAt !== null, !degraded);
    const second = await call("post", "/dashboard/price-alerts/check");
    assert.equal(second.body.value.items[0].triggeredAt, triggeredAt);
    assert.equal(second.body.revision, first.body.revision);
  }
  assert.equal(alertReached("above", 100, 100), true);
  assert.equal(alertReached("below", 100, 100), true);
  assert.equal(alertReached("below", 100, NaN), false);
});

test("unknown fees and PnL do not become a false zero or net result", () => {
  const base: JournalTrade = {
    id: "1",
    source: "manual",
    symbol: "BTC",
    side: "long",
    entryAt: "2026-01-01T00:00:00Z",
    exitAt: "2026-01-01T01:00:00Z",
    pnl: 100,
    fees: 5,
    note: ""
  };
  assert.equal(summarizeTrades([base]).net, 95);
  assert.equal(
    summarizeTrades([base, { ...base, id: "2", pnl: -50, fees: 2 }]).winRate,
    50
  );
  assert.equal(summarizeTrades([{ ...base, fees: null }]).net, null);
  assert.equal(summarizeTrades([{ ...base, pnl: null }]).pnl, null);
  assert.equal(summarizeTrades([]).winRate, null);
});

test("workbench endpoints have explicit dashboard permission mappings", () => {
  for (const path of [
    "/dashboard/workbench/notes",
    "/dashboard/workbench/journal",
    "/dashboard/workbench/price-alerts",
    "/dashboard/price-alerts/check",
    "/dashboard/trade-journal"
  ]) {
    assert.deepEqual(resolvePermissionRequirementForRequest("GET", path, {}), {
      any: [
        "bots.view",
        "exchange_keys.view_present",
        "trading.manual_market",
        "trading.manual_limit"
      ]
    });
  }
});
