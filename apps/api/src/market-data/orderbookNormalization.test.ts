import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSharedOrderbook } from "./sharedMarket.js";

test("shared book normalization accepts numeric strings but never turns a Binance spot sequence into time", () => {
  const book = { bids: [["100", "2"]], asks: [["101", "3"]], ts: Date.now() };
  const spot = normalizeSharedOrderbook(book, "spot", "binance", 25);
  assert.deepEqual(spot.data, { bids: [[100, 2]], asks: [[101, 3]] });
  assert.equal(spot.observedAt, null);
  assert.ok(normalizeSharedOrderbook(book, "perp", "binance", 25).observedAt);
  for (const bad of [null, "", " ", true, "NaN", "Infinity", "0x10"]) {
    assert.throws(() => normalizeSharedOrderbook({ ...book, bids: [[bad, "1"]] }, "spot", "bitget", 25));
  }
  assert.deepEqual(normalizeSharedOrderbook({ bids: [], asks: [] }, "spot", "binance", 25).data, { bids: [], asks: [] });
});
