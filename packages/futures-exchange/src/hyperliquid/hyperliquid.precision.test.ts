import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHyperliquidPrice,
  formatHyperliquidSize,
  hyperliquidPriceTickForValue
} from "./hyperliquid.precision.js";
import { toHyperliquidContractInfo } from "./hyperliquid.contract-cache.js";

test("toHyperliquidContractInfo derives Hyperliquid tick size from mark price and szDecimals", () => {
  const info = toHyperliquidContractInfo({
    index: 0,
    universe: {
      name: "ETH",
      szDecimals: 4,
      maxLeverage: 50
    },
    assetCtx: {
      markPx: "2467.89",
      oraclePx: "2467.10"
    }
  });

  assert.equal(info.stepSize, 0.0001);
  assert.equal(info.tickSize, 0.1);
  assert.equal(info.priceScale, 1);
});

test("Hyperliquid precision helpers truncate price and size to valid wire values", () => {
  assert.equal(hyperliquidPriceTickForValue(67457.29, 4), 1);
  assert.equal(formatHyperliquidPrice(67457.29, 4), "67457");
  assert.equal(formatHyperliquidPrice(2467.89, 4), "2467.8");
  assert.equal(formatHyperliquidSize(0.123456, 4), "0.1234");
});
