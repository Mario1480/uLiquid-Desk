import assert from "node:assert/strict";
import test from "node:test";
import { computeAutoMarginAllocation } from "./autoMargin.js";

test("computeAutoMarginAllocation applies 70/30 split", () => {
  const result = computeAutoMarginAllocation({
    totalBudgetUsd: 1000,
    minInvestmentUSDT: 200
  });
  assert.equal(result.insufficient, false);
  assert.equal(result.gridInvestUsd, 700);
  assert.equal(result.extraMarginUsd, 300);
  assert.equal(result.searchIterationsUsed, 0);
});

test("computeAutoMarginAllocation applies min investment floor", () => {
  const result = computeAutoMarginAllocation({
    totalBudgetUsd: 1000,
    minInvestmentUSDT: 850
  });
  assert.equal(result.insufficient, false);
  assert.equal(result.gridInvestUsd, 850);
  assert.equal(result.extraMarginUsd, 150);
  assert.equal(result.reasonCodes.includes("min_investment_floor_applied"), true);
  assert.equal(result.searchIterationsUsed, 0);
});

test("computeAutoMarginAllocation marks insufficient when min exceeds total", () => {
  const result = computeAutoMarginAllocation({
    totalBudgetUsd: 500,
    minInvestmentUSDT: 600
  });
  assert.equal(result.insufficient, true);
  assert.equal(result.gridInvestUsd, 500);
  assert.equal(result.extraMarginUsd, 0);
  assert.deepEqual(result.reasonCodes, ["min_investment_above_total_budget"]);
  assert.equal(result.searchIterationsUsed, 0);
});

test("computeAutoMarginAllocation keeps rounded sums exact", () => {
  const result = computeAutoMarginAllocation({
    totalBudgetUsd: 333.33,
    minInvestmentUSDT: 111.11
  });
  assert.equal(Number((result.gridInvestUsd + result.extraMarginUsd).toFixed(2)), 333.33);
  assert.equal(result.insufficient, false);
  assert.equal(result.searchIterationsUsed, 0);
});
