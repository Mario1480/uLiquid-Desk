import assert from "node:assert/strict";
import test from "node:test";
import { createSharedMarketStore, normalizeSharedCandles, projectMarketSnapshot, providerObservedAt, type MarketDatasetKey } from "./sharedMarket.js";
import { pinRunSnapshot } from "./snapshotCache.js";

const at = Date.parse("2026-09-05T10:00:00Z");
const key = { providerId: "native:binance", sourceVenue: "binance" as const, marketType: "perp" as const, symbol: "BTCUSDT", schemaVersion: "1.0.0" as const };
const candlesKey = { ...key, dataset: "candles" as const, interval: "1h" as const, limit: 20 };
const candle = (ts: number) => [ts, "100", "102", "99", "101", "3"];

test("candle normalizer preserves real zeros only, flags malformed rows and incomplete coverage", () => {
  const result = normalizeSharedCandles([candle(at), [at - 3600000, 100, 102, 99, 101, null],
    [at - 7200000, 100, 102, 99, 101, 0], [at, 100, 98, 99, 101, 2]], "1h", 20, at);
  assert.equal(result.data.candles.length, 2);
  assert.equal(result.data.candles[0].volume, 0);
  assert.ok(result.warnings.includes("malformed_candle_rows"));
  assert.ok(result.warnings.includes("candle_coverage_incomplete"));
  assert.ok(result.warnings.includes("candle_sequence_gap_or_duplicate"));
  assert.ok(result.warnings.includes("forming_candle_included"));
});

test("shared candles coalesce, retain fetched time and isolate coverage, market and venue keys", async () => {
  let calls = 0;
  const store = createSharedMarketStore({ now: () => at });
  const load = async () => { calls++; return normalizeSharedCandles(Array.from({ length: 20 }, (_, i) => candle(at - (20 - i) * 3600000)), "1h", 20, at); };
  const [a, b] = await Promise.all([store.read<"candles">(candlesKey, load), store.read<"candles">(candlesKey, load)]);
  assert.equal(calls, 1); assert.equal(a.snapshot.id, b.snapshot.id); assert.equal(a.quality, "fresh");
  a.snapshot.data.candles[0].close = 777;
  assert.notEqual((await store.read<"candles">(candlesKey, load)).snapshot.data.candles[0].close, 777);
  for (const patch of [{ interval: "4h" as const }, { limit: 50 }, { marketType: "spot" as const }, { sourceVenue: "bitget" as const }, { symbol: "BTCUSDC" }]) {
    const next = await store.read<"candles">({ ...candlesKey, ...patch }, load);
    assert.notEqual(next.snapshot.id, b.snapshot.id);
  }
  assert.equal(calls, 6);
  assert.equal(projectMarketSnapshot(b.snapshot, true, at + 31_000).quality, "stale");
  assert.equal(projectMarketSnapshot(b.snapshot, true, at + 31_000).snapshot.fetchedAt, b.snapshot.fetchedAt);
  await assert.rejects(store.read({ ...candlesKey, schemaVersion: "99" } as unknown as MarketDatasetKey, load));
});

test("ticker and orderbook timestamps are nullable, future-aware and dataset-specific", async () => {
  const store = createSharedMarketStore({ now: () => at });
  const ticker = await store.read<"ticker">({ ...key, dataset: "ticker" }, async () => ({ data: { last: 100, mark: null, bid: null, ask: null }, observedAt: null, warnings: [] }));
  assert.equal(ticker.ageMs, null); assert.equal(ticker.quality, "degraded");
  const book = await store.read<"orderbook">({ ...key, dataset: "orderbook", limit: 25 }, async () => ({ data: { bids: [[99, 2]], asks: [[101, 3]] }, observedAt: new Date(at + 1).toISOString(), warnings: [] }));
  assert.ok(book.warnings.includes("provider_timestamp_in_future"));
  assert.notEqual(book.snapshot.id, ticker.snapshot.id);
  assert.equal(projectMarketSnapshot(book.snapshot, true, at + 31_000).quality, "stale");
  for (const value of [null, undefined, "", "bad", -1, Infinity]) assert.equal(providerObservedAt(value), null);
  assert.equal(providerObservedAt(new Date(at).toISOString()), new Date(at).toISOString());
});

test("run pinning survives public cache expiry but never crosses execution contexts", async () => {
  let now = at; let calls = 0;
  const store = createSharedMarketStore({ now: () => now });
  const owner = {}; const other = {};
  const load = () => store.read<"ticker">({ ...key, dataset: "ticker" }, async () => { calls++; return { data: { last: calls, mark: null, bid: null, ask: null }, observedAt: new Date(at).toISOString(), warnings: [] }; });
  const first = await pinRunSnapshot(owner, "ticker-key", load);
  now += 40_000;
  const pinned = await pinRunSnapshot(owner, "ticker-key", load);
  assert.equal(first.snapshot.id, pinned.snapshot.id);
  assert.equal(calls, 1);
  assert.equal(projectMarketSnapshot(pinned.snapshot, true, now).quality, "stale");
  const fresh = await pinRunSnapshot(other, "ticker-key", load);
  assert.equal(calls, 2); assert.notEqual(first.snapshot.id, fresh.snapshot.id);
  pinned.snapshot.data.last = 888;
  assert.equal((await pinRunSnapshot(owner, "ticker-key", load)).snapshot.data.last, 1);
});

test("failed run reads can retry; snapshot budgets and schema boundaries fail closed", async () => {
  const owner = {};
  await assert.rejects(pinRunSnapshot(owner, "retry", async () => { throw new Error("retryable"); }));
  assert.equal(await pinRunSnapshot(owner, "retry", async () => 1), 1);
  for (let i = 0; i < 31; i++) await pinRunSnapshot(owner, String(i), async () => i);
  await assert.rejects(pinRunSnapshot(owner, "overflow", async () => 0), /snapshot_budget_exceeded/);
  const store = createSharedMarketStore();
  await assert.rejects(store.read<"ticker">({ ...key, dataset: "ticker" }, async () => ({ data: { last: 100, mark: null, bid: null, ask: null, secret: "private" }, observedAt: null, warnings: [] })));
});
