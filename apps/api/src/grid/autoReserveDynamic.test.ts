import assert from "node:assert/strict";
import test from "node:test";
import { computeAutoReserveAllocationDynamic } from "./autoMargin.js";

test("computeAutoReserveAllocationDynamic uses max grid when liq target is satisfied", async () => {
  const result = await computeAutoReserveAllocationDynamic({
    totalBudgetUsd: 1000,
    minInvestmentUSDT: 200,
    targetLiqDistancePct: 8,
    evaluateGridInvestment: async (gridInvestUsd) => ({
      worstCaseLiqDistancePct: gridInvestUsd <= 1000 ? 10 : 0
    })
  });
  assert.equal(result.insufficient, false);
  assert.equal(result.gridInvestUsd, 1000);
  assert.equal(result.extraMarginUsd, 0);
  assert.equal(result.reasonCodes.includes("liq_target_satisfied_with_max_grid"), true);
});

test("computeAutoReserveAllocationDynamic falls back to minimum grid when target is unreachable", async () => {
  const result = await computeAutoReserveAllocationDynamic({
    totalBudgetUsd: 1000,
    minInvestmentUSDT: 250,
    targetLiqDistancePct: 8,
    evaluateGridInvestment: async () => ({
      worstCaseLiqDistancePct: 2
    })
  });
  assert.equal(result.insufficient, false);
  assert.equal(result.gridInvestUsd, 250);
  assert.equal(result.extraMarginUsd, 750);
  assert.equal(result.reasonCodes.includes("liq_target_unreachable_at_min_grid"), true);
});

test("computeAutoReserveAllocationDynamic finds max passing value via bounded search", async () => {
  const result = await computeAutoReserveAllocationDynamic({
    totalBudgetUsd: 1000,
    minInvestmentUSDT: 200,
    targetLiqDistancePct: 8,
    maxIterations: 8,
    evaluateGridInvestment: async (gridInvestUsd) => ({
      // As grid allocation grows, liquidation distance tightens.
      worstCaseLiqDistancePct: 16 - gridInvestUsd / 100
    })
  });
  assert.equal(result.insufficient, false);
  assert.equal(result.gridInvestUsd > 200, true);
  assert.equal(result.gridInvestUsd < 1000, true);
  assert.equal(result.reasonCodes.includes("liq_guard_applied"), true);
  assert.equal(result.searchIterationsUsed <= 10, true);
});
