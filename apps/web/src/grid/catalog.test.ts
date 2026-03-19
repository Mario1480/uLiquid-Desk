import assert from "node:assert/strict";
import test from "node:test";
import { buildGridCatalogQuery, updateGridCatalogFavoriteState } from "./catalog.js";

test("buildGridCatalogQuery serializes active filters only", () => {
  const query = buildGridCatalogQuery({
    search: " btc ",
    category: "Trend",
    tag: "swing",
    difficulty: "ADVANCED",
    risk: "HIGH",
    favoritesOnly: true
  });

  assert.equal(
    query,
    "search=btc&category=Trend&tag=swing&difficulty=ADVANCED&risk=HIGH&favoritesOnly=true"
  );
});

test("updateGridCatalogFavoriteState removes unfavorited items in favorites mode", () => {
  const result = updateGridCatalogFavoriteState([
    { id: "tpl_1", name: "One", symbol: "BTCUSDT", mode: "long", gridMode: "arithmetic", allocationMode: "EQUAL_NOTIONAL_PER_GRID", budgetSplitPolicy: "FIXED_50_50", longBudgetPct: 50, shortBudgetPct: 50, marginPolicy: "MANUAL_ONLY", autoMarginMaxUSDT: null, autoMarginTriggerType: null, autoMarginTriggerValue: null, autoMarginStepUSDT: null, autoMarginCooldownSec: null, autoReservePolicy: "LIQ_GUARD_MAX_GRID", autoReserveFixedGridPct: 70, autoReserveTargetLiqDistancePct: null, autoReserveMaxPreviewIterations: 8, lowerPrice: 40000, upperPrice: 50000, gridCount: 20, leverageDefault: 3, investMinUsd: 0, investMaxUsd: 1000, investDefaultUsd: 100, slippageDefaultPct: 0.1, tpDefaultPct: null, slDefaultPrice: null, allowManualMarginAdjust: true, allowProfitWithdraw: true, isFavorite: true },
    { id: "tpl_2", name: "Two", symbol: "ETHUSDT", mode: "short", gridMode: "geometric", allocationMode: "EQUAL_NOTIONAL_PER_GRID", budgetSplitPolicy: "FIXED_50_50", longBudgetPct: 50, shortBudgetPct: 50, marginPolicy: "MANUAL_ONLY", autoMarginMaxUSDT: null, autoMarginTriggerType: null, autoMarginTriggerValue: null, autoMarginStepUSDT: null, autoMarginCooldownSec: null, autoReservePolicy: "LIQ_GUARD_MAX_GRID", autoReserveFixedGridPct: 70, autoReserveTargetLiqDistancePct: null, autoReserveMaxPreviewIterations: 8, lowerPrice: 2000, upperPrice: 3000, gridCount: 24, leverageDefault: 3, investMinUsd: 0, investMaxUsd: 1000, investDefaultUsd: 100, slippageDefaultPct: 0.1, tpDefaultPct: null, slDefaultPrice: null, allowManualMarginAdjust: true, allowProfitWithdraw: true, isFavorite: true }
  ], "tpl_1", false, true);

  assert.deepEqual(result.map((row) => row.id), ["tpl_2"]);
  assert.equal(result[0]?.isFavorite, true);
});
