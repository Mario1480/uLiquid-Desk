import test from "node:test";
import assert from "node:assert/strict";
import { estimatePnl, priceFromRoe, partialCloseOrder } from "./positionMath";

const long = { side: "long" as const, symbol: "BTCUSDT", size: 2, entryPrice: 100, marginUsd: 20 };
test("ROE uses margin and reverses direction for shorts", () => {
  assert.equal(priceFromRoe(long, 50), 105);
  assert.equal(estimatePnl(long, 105), 10);
  assert.equal(priceFromRoe(long, -50), 95);
  const short = { ...long, side: "short" as const };
  assert.equal(priceFromRoe(short, 50), 95);
  assert.equal(estimatePnl(short, 95), 10);
  assert.equal(priceFromRoe(short, -50), 105);
});
test("unavailable inputs and nonpositive prices cannot produce targets", () => {
  assert.equal(priceFromRoe({ ...long, marginUsd: null }, 50), null);
  assert.equal(priceFromRoe({ ...long, size: 0 }, 50), null);
  assert.equal(priceFromRoe(long, NaN), null);
  assert.equal(priceFromRoe(long, -1000), null);
  assert.equal(estimatePnl({ ...long, entryPrice: null }, 100), null);
});
test("partial futures closes reduce only the opposite order side", () => {
  assert.deepEqual(partialCloseOrder(long, 25, false), { symbol: "BTCUSDT", type: "market", side: "short", qty: 0.5, reduceOnly: true });
  assert.equal(partialCloseOrder({ ...long, side: "short" }, 75, false).side, "long");
  assert.deepEqual(partialCloseOrder(long, 50, true), { symbol: "BTCUSDT", type: "market", side: "sell", qty: 1 });
  for (const percent of [0, -1, 100, 101, NaN, Infinity]) assert.throws(() => partialCloseOrder(long, percent, false));
});
