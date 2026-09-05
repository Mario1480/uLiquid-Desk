import assert from "node:assert/strict";
import test from "node:test";
import { createSharedDerivativesStore, type DerivativesMarketKey } from "./sharedDerivatives.js";
import type { PerpDerivativesSnapshot } from "../perp/perp-derivatives-normalization.js";

const start = Date.parse("2026-09-05T10:00:00Z");
const market: DerivativesMarketKey = { providerId: "uliquid-native:binance", sourceVenue: "binance", marketType: "perp", symbol: "BTCUSDT" };
const fixture = (): PerpDerivativesSnapshot => ({ fundingRate: 0.0001, fundingIntervalHours: 8,
  openInterest: 5, openInterestUnit: "base_asset", markPrice: 100, contractSize: null,
  observedAt: new Date(start).toISOString(), sourceTimestampProvided: true, warnings: [] });

test("simultaneous consumers share one immutable public snapshot", async () => {
  let calls = 0;
  const store = createSharedDerivativesStore({ now: () => start });
  const load = async () => { calls++; return fixture(); };
  const [funding, oi] = await Promise.all([store.read(market, load), store.read(market, load)]);
  assert.equal(calls, 1);
  assert.equal(funding.snapshot.id, oi.snapshot.id);
  assert.equal(funding.cacheHit, false);
  assert.equal(oi.cacheHit, true);
  funding.snapshot.data.fundingRate = 999;
  funding.snapshot.data.warnings.push("mutated");
  assert.equal(oi.snapshot.data.fundingRate, 0.0001);
  const cached = await store.read(market, load);
  assert.equal(cached.snapshot.data.fundingRate, 0.0001);
  assert.deepEqual(cached.warnings, []);
});

test("provider, venue and symbol are separate keys; private and ambiguous keys fail closed", async () => {
  let calls = 0;
  const store = createSharedDerivativesStore({ now: () => start });
  const load = async () => { calls++; return fixture(); };
  const ids = await Promise.all([
    store.read(market, load), store.read({ ...market, symbol: "ETHUSDT" }, load),
    store.read({ ...market, providerId: "another-provider" }, load),
    store.read({ ...market, sourceVenue: "bitget" }, load)
  ]);
  assert.equal(calls, 4);
  assert.equal(new Set(ids.map((item) => item.snapshot.id)).size, 4);
  await assert.rejects(store.read({ ...market, symbol: "BTC/USDT" }, load));
  await assert.rejects(store.read({ ...market, accountId: "private" } as DerivativesMarketKey, load));
  assert.equal(calls, 4);
});

test("TTL expiry refetches, while cache reads preserve fetch time and recalculate age", async () => {
  let at = start; let calls = 0;
  const store = createSharedDerivativesStore({ now: () => at, ttlMs: 500, staleAfterMs: 100 });
  const load = async () => { calls++; return fixture(); };
  const first = await store.read(market, load);
  at += 200;
  const second = await store.read(market, load);
  assert.equal(second.ageMs, 200);
  assert.equal(second.quality, "stale");
  assert.ok(second.warnings.includes("market_data_stale"));
  assert.equal(second.snapshot.fetchedAt, first.snapshot.fetchedAt);
  at += 301;
  const third = await store.read(market, load);
  assert.equal(calls, 2);
  assert.notEqual(first.snapshot.id, third.snapshot.id);
});

test("missing and future timestamps are never fresh and reported unknown units are retained", async () => {
  for (const missing of [true, false]) {
    const store = createSharedDerivativesStore({ now: () => start });
    const result = await store.read(market, async () => ({ ...fixture(),
      observedAt: new Date(start + 10_000).toISOString(), sourceTimestampProvided: !missing,
      openInterestUnit: "unknown" }));
    assert.equal(result.quality, "degraded");
    assert.equal(result.ageMs, missing ? null : 0);
    assert.ok(result.warnings.includes(missing ? "provider_timestamp_missing" : "provider_timestamp_in_future"));
    assert.equal(result.snapshot.data.openInterestUnit, "unknown");
  }
});

test("invalid data and failures are not cached; LRU capacity is bounded", async () => {
  const store = createSharedDerivativesStore({ now: () => start, maxEntries: 1 });
  await assert.rejects(store.read(market, async () => { throw new Error("unavailable"); }));
  await assert.rejects(store.read(market, async () => ({ ...fixture(), markPrice: Infinity })));
  await assert.rejects(store.read(market, async () => ({ ...fixture(), apiKey: "must-not-cache" })));
  let calls = 0;
  const load = async () => { calls++; return fixture(); };
  await store.read(market, load);
  await store.read({ ...market, symbol: "ETHUSDT" }, load);
  await store.read(market, load);
  assert.equal(calls, 3);
});

test("timeouts do not cache late responses or permit unbounded underlying requests", async () => {
  const store = createSharedDerivativesStore({ now: () => start, timeoutMs: 15, maxInFlight: 1 });
  let resolve!: (data: PerpDerivativesSnapshot) => void;
  const loading = new Promise<PerpDerivativesSnapshot>((done) => { resolve = done; });
  const first = store.read(market, () => loading);
  await assert.rejects(store.read({ ...market, symbol: "ETHUSDT" }, async () => fixture()), /shared_market_data_busy/);
  await assert.rejects(first, /shared_market_data_timeout/);
  await assert.rejects(store.read({ ...market, symbol: "ETHUSDT" }, async () => fixture()), /shared_market_data_busy/);
  resolve(fixture());
  await loading;
  await new Promise<void>(done => setImmediate(done));
  const retried = await store.read(market, async () => ({ ...fixture(), fundingRate: 0.2 }));
  assert.equal(retried.cacheHit, false);
  assert.equal(retried.snapshot.data.fundingRate, 0.2);
});
