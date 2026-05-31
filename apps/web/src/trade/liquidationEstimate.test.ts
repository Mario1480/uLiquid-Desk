import assert from "node:assert/strict";
import test from "node:test";

import { estimateLiquidationPrices } from "./liquidationEstimate";

test("cross long estimate is empty when account equity covers the full long notional", () => {
  const estimate = estimateLiquidationPrices({
    entryPrice: 100,
    quantity: 1,
    leverage: 10,
    marginMode: "cross",
    accountEquity: 150,
    availableMargin: 10
  });

  assert.equal(estimate.long, null);
  assert.equal(Number(estimate.short?.toFixed(6)), 248.756219);
});

test("cross estimate falls back to available margin when equity is unavailable", () => {
  const estimate = estimateLiquidationPrices({
    entryPrice: 100,
    quantity: 1,
    leverage: 10,
    marginMode: "cross",
    accountEquity: null,
    availableMargin: 50
  });

  assert.equal(Number(estimate.long?.toFixed(6)), 50.251256);
  assert.equal(Number(estimate.short?.toFixed(6)), 149.253731);
});

test("isolated estimate uses only position initial margin", () => {
  const estimate = estimateLiquidationPrices({
    entryPrice: 100,
    quantity: 1,
    leverage: 10,
    marginMode: "isolated",
    accountEquity: 150,
    availableMargin: 150
  });

  assert.equal(Number(estimate.long?.toFixed(6)), 90.361446);
  assert.equal(Number(estimate.short?.toFixed(6)), 109.561753);
});

test("invalid inputs return empty estimates", () => {
  assert.deepEqual(
    estimateLiquidationPrices({
      entryPrice: 0,
      quantity: 1,
      leverage: 10,
      marginMode: "cross",
      accountEquity: 100
    }),
    { long: null, short: null }
  );
});
