import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultDashboardLayout, normalizeDashboardLayout } from "./layout";

test("new dashboard widgets are visible in the default layout", () => {
  const layout = getDefaultDashboardLayout();
  assert.equal(layout.items.length, 18);
  assert.equal(layout.items.find((item) => item.id === "marketSessions")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "watchlist")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "quickActions")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "fundingRates")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "topMovers")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "portfolioAllocation")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "networkStatus")?.visible, true);
});

test("previous layouts receive new widgets without losing saved widgets", () => {
  const layout = normalizeDashboardLayout({
    version: 1,
    desktop: { columns: 12, gap: 12, rowHeight: 96 },
    items: [{ id: "alerts", visible: false, x: 0, y: 0, w: 12, h: 2 }]
  });
  assert.equal(layout.items.find((item) => item.id === "alerts")?.visible, false);
  assert.equal(layout.items.find((item) => item.id === "marketSessions")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "watchlist")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "quickActions")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "fundingRates")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "topMovers")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "portfolioAllocation")?.visible, true);
  assert.equal(layout.items.find((item) => item.id === "networkStatus")?.visible, true);
});
