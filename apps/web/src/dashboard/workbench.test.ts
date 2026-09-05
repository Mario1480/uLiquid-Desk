import assert from "node:assert/strict";
import test from "node:test";
import { liquidationDistance, radarState } from "./workbench";
import { getDefaultDashboardLayout, normalizeDashboardLayout } from "./layout";
import { DEFAULT_DASHBOARD_LAYOUT } from "../../../api/src/dashboard/layout";

test("liquidation distances use side and mark prices and preserve unknown data", () => {
  const row = {
    exchangeAccountId: "a",
    exchangeLabel: "A",
    symbol: "BTC",
    side: "long" as const,
    markPrice: 100,
    liquidationPrice: 95
  };
  assert.equal(liquidationDistance(row), 5);
  assert.equal(
    liquidationDistance({ ...row, side: "short", liquidationPrice: 105 }),
    5
  );
  assert.equal(liquidationDistance({ ...row, liquidationPrice: null }), null);
  assert.equal(liquidationDistance({ ...row, markPrice: 0 }), null);
  assert.equal(liquidationDistance({ ...row, liquidationPrice: 0 }), null);
  assert.equal(liquidationDistance({ ...row, liquidationPrice: 101 }), -1);
});

test("bot radar prioritizes errors and stale runtimes over a running label", () => {
  const now = Date.now();
  const bot = {
    id: "b",
    name: "Bot",
    symbol: "BTC",
    status: "running",
    runtime: { updatedAt: new Date(now).toISOString() }
  };
  assert.equal(radarState(bot, now), "running");
  assert.equal(radarState(bot, now + 360000), "stale");
  assert.equal(
    radarState(
      { ...bot, runtime: { ...bot.runtime, reason: "waiting_for_signal" } },
      now
    ),
    "waiting"
  );
  assert.equal(radarState({ ...bot, status: "error" }, now), "error");
});

test("API and web layouts agree and saved widget choices survive expansion", () => {
  assert.deepEqual(
    getDefaultDashboardLayout().items,
    DEFAULT_DASHBOARD_LAYOUT.items
  );
  const layout = normalizeDashboardLayout({
    items: [{ id: "alerts", visible: false, x: 0, y: 0, w: 12, h: 2 }]
  });
  assert.equal(layout.items.find((row) => row.id === "alerts")?.visible, false);
  for (const id of [
    "priceAlerts",
    "tradeJournal",
    "tradingSummary",
    "botRadar",
    "notes",
    "liquidationDistance"
  ])
    assert.equal(layout.items.find((row) => row.id === id)?.visible, true);
});
