import assert from "node:assert/strict";
import test from "node:test";
import { createPublicHistoryStore, historyRequestUrl, normalizePublicHistory, type HistoryRequest } from "./derivativesHistory.js";

const end = Date.parse("2026-09-06T12:00:00Z");
const funding = { venue: "binance", symbol: "BTCUSDT", kind: "funding" } as const;
const row = { symbol: "BTCUSDT", fundingTime: end - 1000, fundingRate: "0.0001", rateType: "Regular" };
test("public history routes are bounded, USDT-only, read-only and fail unsupported providers closed", () => {
  const { url, limit } = historyRequestUrl(funding, end);
  assert.equal(url.origin, "https://fapi.binance.com"); assert.equal(limit, 200);
  assert.equal(url.searchParams.get("endTime"), String(end)); assert.equal(url.searchParams.has("signature"), false);
  for (const venue of ["bitget", "mexc", "hyperliquid", "bingx"] as const) {
    assert.throws(() => historyRequestUrl({ ...funding, venue, kind: "open_interest" }, end), /unsupported/);
  }
  assert.throws(() => historyRequestUrl({ ...funding, venue: "bingx" }, end), /not_verified/);
  assert.throws(() => historyRequestUrl({ ...funding, symbol: "BTCUSD" }, end));
  assert.throws(() => historyRequestUrl({ ...funding, venue: "paper" } as unknown as HistoryRequest, end));
});
test("Binance excludes nonregular and malformed funding rows without assuming funding cadence", () => {
  const result = normalizePublicHistory(funding, [row, { ...row, rateType: "Special" }, { ...row, fundingRate: "" }, { ...row, fundingTime: null }], end, end);
  assert.equal(result.points.length, 1); assert.equal(result.points[0].cadenceMs, null); assert.equal(result.excludedRows, 3);
  assert.ok(result.warningCodes.includes("history_funding_event_type_not_regular"));
  assert.throws(() => normalizePublicHistory(funding, [{ ...row, symbol: "ETHUSDT" }], end, end), /identity_mismatch/);
});
test("Binance OI retains reported notional, independent of current price", () => {
  const input = normalizePublicHistory({ ...funding, kind: "open_interest" }, [{ symbol: "BTCUSDT", timestamp: end, sumOpenInterest: "12.5", sumOpenInterestValue: "700" }], end, end);
  assert.deepEqual(input.points[0], { timestamp: end, value: 12.5, reportedNotional: 700, cadenceMs: 3_600_000 });
});
test("Bitget and MEXC envelopes, symbol separators and per-observation cadence are explicit", () => {
  const bitget = normalizePublicHistory({ ...funding, venue: "bitget" }, { code: "00000", data: [row] }, end, end);
  assert.equal(bitget.points[0].cadenceMs, null);
  const mexc = normalizePublicHistory({ ...funding, venue: "mexc" }, { success: true, code: 0, data: { resultList: [
    { symbol: "BTC_USDT", settleTime: end, fundingRate: 0.0001, collectCycle: 8 }
  ] } }, end, end);
  assert.equal(mexc.points[0].cadenceMs, 28_800_000);
  assert.equal(historyRequestUrl({ ...funding, venue: "mexc" }, end).url.searchParams.get("page_num"), "1");
  assert.throws(() => normalizePublicHistory({ ...funding, venue: "bitget" }, { code: "failed", data: [row] }, end, end), /response_invalid/);
});
test("out-of-window page rows are clipped; future and oversized responses are not trusted", () => {
  const input = normalizePublicHistory(funding, [row, { ...row, fundingTime: end - 31 * 86400000 }, { ...row, fundingTime: end + 1 }], end, end);
  assert.equal(input.points.length, 1); assert.equal(input.excludedRows, 1);
  assert.throws(() => normalizePublicHistory(funding, Array(201).fill(row), end, end), /response_invalid/);
});
test("bounded cache single-flights requests and preserves original window, fetch time and input identity", async () => {
  let now = end; let calls = 0;
  const store = createPublicHistoryStore({ now: () => now, fetch: (async (_url, init) => {
    calls++; assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.headers, undefined);
    return new Response(JSON.stringify([row]));
  }) as typeof fetch });
  const [a, b] = await Promise.all([store.read(funding), store.read(funding)]);
  assert.equal(calls, 1); assert.equal(a.snapshot.id, b.snapshot.id); assert.equal(b.cacheHit, true);
  now += 59_000;
  const cached = await store.read(funding); assert.equal(cached.snapshot.fetchedAt, a.snapshot.fetchedAt);
  assert.equal(cached.snapshot.input.requestedEnd, end);
  assert.equal(cached.evaluationInput.evaluatedAt, now);
  now += 2_000; const fresh = await store.read(funding);
  assert.equal(calls, 2); assert.notEqual(fresh.snapshot.id, a.snapshot.id);
});
test("failures are retryable and oversized/rate-limited responses do not enter cache", async () => {
  let calls = 0;
  const store = createPublicHistoryStore({ now: () => end, fetch: (async () => {
    calls++; return calls === 1 ? new Response("", { status: 429 }) : new Response(JSON.stringify([row]));
  }) as typeof fetch });
  await assert.rejects(store.read(funding), /rate_limited/);
  assert.equal((await store.read(funding)).cacheHit, false);
  const oversized = createPublicHistoryStore({ now: () => end, fetch: (async () => new Response("x".repeat(262145))) as typeof fetch });
  await assert.rejects(oversized.read(funding), /too_large/);
});
