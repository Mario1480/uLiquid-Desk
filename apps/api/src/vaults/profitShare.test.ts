import assert from "node:assert/strict";
import test from "node:test";
import { computeProfitShareFeeUsd } from "./profitShare.js";

test("computeProfitShareFeeUsd applies 30% only on positive realized pnl", () => {
  assert.equal(computeProfitShareFeeUsd(100), 30);
  assert.equal(computeProfitShareFeeUsd(-50), 0);
  assert.equal(computeProfitShareFeeUsd(0), 0);
});

test("computeProfitShareFeeUsd rounds to 4 decimals", () => {
  assert.equal(computeProfitShareFeeUsd(1.23456), 0.3704);
});
