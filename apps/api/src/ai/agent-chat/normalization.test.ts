import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgentCandleRows } from "./normalization.js";

test("normalizes Binance-style and Hyperliquid-style candle payloads", () => {
  const candles = normalizeAgentCandleRows([
    [2_000, "101", "105", "99", "103", "42"],
    { t: 1_000, o: "100", h: "104", l: "98", c: "101", v: "21" }
  ]);
  assert.deepEqual(candles, [
    { ts: 1_000, open: 100, high: 104, low: 98, close: 101, volume: 21 },
    { ts: 2_000, open: 101, high: 105, low: 99, close: 103, volume: 42 }
  ]);
});

test("normalizes provider envelopes and rejects incomplete rows", () => {
  assert.deepEqual(normalizeAgentCandleRows({ data: [
    { timestamp: "3000", open: 10, high: 12, low: 9, close: 11, volume: 5 },
    { timestamp: "invalid", open: 10, high: 12, low: 9, close: 11 }
  ] }), [
    { ts: 3_000, open: 10, high: 12, low: 9, close: 11, volume: 5 }
  ]);
});
