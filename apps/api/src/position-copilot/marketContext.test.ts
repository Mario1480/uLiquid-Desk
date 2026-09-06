import assert from "node:assert/strict";
import test from "node:test";
import { loadPositionMarketContext, positionMarketContextDependencies as deps } from "./marketContext.js";
import { historyFeatureDependencies } from "../ai/features/history.js";
import { createPublicHistoryStore } from "../market-data/derivativesHistory.js";

test("standalone Copilot reads shared public features once, retaining source, nulls and versions", async t => {
  t.mock.method(deps, "readHistory", async () => { throw new Error("fixture_history_unavailable"); });
  const original = deps.createClient;
  const calls = { derivatives: 0, candles: 0, book: 0 };
  const now = Date.now();
  deps.createClient = (account: any) => {
    assert.equal(account.apiKey, ""); assert.equal(account.apiSecret, "");
    assert.equal(account.userId, "public");
    return {
      getDerivativesSnapshot: async () => { calls.derivatives++; return { fundingRate: 0, fundingIntervalHours: null,
        openInterest: 10, openInterestUnit: "unknown", contractSize: null, markPrice: 100,
        observedAt: new Date(now).toISOString(), sourceTimestampProvided: false, warnings: [] }; },
      getCandles: async () => { calls.candles++; return Array.from({ length: 100 }, (_, i) => [now - (100 - i) * 3600000, 100, 101, 99, 100, 1]); },
      getDepth: async () => { calls.book++; return { bids: [[99.99, 1]], asks: [[100.01, 2]], ts: now }; },
      close: async () => undefined
    } as any;
  };
  try {
    const request = { userId: "owner", account: { id: "private-account", exchange: "binance" }, symbol: "CONTEXTUSDT", marketType: "perp" as const };
    const [a, b] = await Promise.all([loadPositionMarketContext(request), loadPositionMarketContext(request)]);
    assert.deepEqual(calls, { derivatives: 1, candles: 1, book: 1 });
    assert.deepEqual(a.snapshotManifest.map(s => s.id), b.snapshotManifest.map(s => s.id));
    assert.equal(a.featureSnapshots.length, 4);
    assert.equal(a.quality, "degraded");
    assert.ok(a.warningCodes.includes("provider_timestamp_missing"));
    const funding = a.featureSnapshots.find(f => f.id === "derivatives.funding-snapshot")!;
    assert.equal((funding.value as any).rateBps, 0);
    assert.equal((funding.value as any).annualizedEstimate, null);
    assert.equal((a.featureSnapshots.find(f => f.id === "derivatives.open-interest-snapshot")!.value as any).notionalUsd, null);
    assert.equal(JSON.stringify(a).includes("private-account"), false);
    assert.ok(a.featureSnapshots.every(f => f.version === "1.0.0" && f.routineVersions.length === 1));
  } finally { deps.createClient = original; }
});

test("standalone Copilot carries both same-venue histories through six validated feature contracts", async t => {
  const at = Date.now();
  const store = createPublicHistoryStore({ now: () => at, fetch: (async url => {
    const request = new URL(String(url)); assert.equal(request.hostname, "fapi.binance.com");
    const funding = request.pathname.includes("fundingRate");
    return new Response(JSON.stringify(Array.from({ length: 40 }, (_, i) => funding
      ? { symbol: "HISTORYUSDT", fundingTime: at - (39 - i) * 28800000, fundingRate: "0.0001", rateType: "Regular" }
      : { symbol: "HISTORYUSDT", timestamp: at - (39 - i) * 3600000, sumOpenInterest: String(100 + i), sumOpenInterestValue: "1000" })));
  }) as typeof fetch });
  t.mock.method(historyFeatureDependencies.store, "read", store.read);
  t.mock.method(deps, "createClient", () => ({
    getDerivativesSnapshot: async () => ({ fundingRate: 0, fundingIntervalHours: 8, openInterest: 10, openInterestUnit: "base_asset",
      contractSize: null, markPrice: 100, observedAt: new Date(at).toISOString(), sourceTimestampProvided: true, warnings: [] }),
    getCandles: async () => Array.from({ length: 100 }, (_, i) => [at - (100 - i) * 3600000, 100, 101, 99, 100, 1]),
    getDepth: async () => ({ bids: [[99, 1]], asks: [[101, 2]], ts: at }), close: async () => undefined
  }) as any);
  const result = await loadPositionMarketContext({ userId: "owner", account: { id: "private-id", exchange: "binance" }, symbol: "HISTORYUSDT", marketType: "perp" });
  assert.equal(result.featureSnapshots.length, 6); assert.equal(result.snapshotManifest.length, 5);
  const histories = result.featureSnapshots.filter(f => f.id === "derivatives.history-summary");
  assert.equal(histories.length, 2);
  assert.equal((histories.find(f => (f.value as any).kind === "funding")!.value as any).changeBps, null);
  assert.equal((histories.find(f => (f.value as any).kind === "open_interest")!.value as any).change, 39);
  assert.ok(result.snapshotManifest.every(s => s.market.sourceVenue === "binance"));
  assert.doesNotMatch(JSON.stringify(result), /private-id|"points"/);
});

test("Paper resolves its owner's linked venue and unsupported derivatives never hit an endpoint", async () => {
  const originalClient = deps.createClient, originalLinked = deps.resolveLinked;
  let resolved = false;
  deps.resolveLinked = async (userId, id) => {
    assert.equal(userId, "owner"); assert.equal(id, "paper"); resolved = true;
    return { marketDataAccount: { exchange: "bingx" } } as any;
  };
  deps.createClient = (account: any) => {
    assert.equal(resolved, true); assert.equal(account.exchange, "bingx");
    return { getDerivativesSnapshot: async () => { assert.fail("unsupported derivatives requested"); },
      getCandles: async () => { throw new Error("private-provider-error-not-for-evidence"); },
      getDepth: async () => { throw new Error("private-provider-error-not-for-evidence"); }, close: async () => undefined } as any;
  };
  try {
    const result = await loadPositionMarketContext({ userId: "owner", account: { id: "paper", exchange: "paper" }, symbol: "PAPERCONTEXTUSDT", marketType: "perp" });
    assert.equal(result.quality, "unavailable");
    assert.ok(result.warningCodes.includes("paper_linked_market_data"));
    assert.ok(result.warningCodes.includes("funding_unsupported"));
    assert.ok(result.warningCodes.includes("open_interest_unsupported"));
    assert.ok(!JSON.stringify(result).includes("private-provider-error"));
    deps.resolveLinked = async () => { throw new Error("access_denied"); };
    const denied = await loadPositionMarketContext({ userId: "owner", account: { id: "paper", exchange: "paper" }, symbol: "BTCUSDT", marketType: "perp" });
    assert.deepEqual(denied.warningCodes, ["linked_market_data_unavailable"]);
  } finally { deps.createClient = originalClient; deps.resolveLinked = originalLinked; }
});

test("unknown venues remain explicit and never create a client", async () => {
  const original = deps.createClient;
  deps.createClient = () => { assert.fail("unexpected client"); };
  try {
    for (const [marketType, exchange, reason] of [["spot", "unknown", "market_data_venue_unsupported"], ["perp", "unknown", "market_data_venue_unsupported"]] as const) {
      const result = await loadPositionMarketContext({ userId: "owner", account: { id: "account", exchange }, symbol: "BTCUSDT", marketType });
      assert.equal(result.quality, "unavailable"); assert.deepEqual(result.warningCodes, [reason]);
    }
  } finally { deps.createClient = original; }
});

test("spot context shares bounded public candles/book without derivatives or private credentials", async t => {
  const now = Date.now();
  let candles = 0, books = 0;
  t.mock.method(deps, "createClient", () => { assert.fail("spot must not use a perpetual client"); });
  t.mock.method(deps, "createSpotClient", (account: any) => {
    assert.equal(account.userId, "public");
    assert.equal(account.apiKey, ""); assert.equal(account.apiSecret, "");
    return {
      getCandles: async ({ limit, timeframe }: any) => {
        assert.equal(limit, 100); assert.equal(timeframe, "1h"); candles++;
        return Array.from({ length: 100 }, (_, i) => [now - (100 - i) * 3600000, 100, 101, 99, 100, 1]);
      },
      getDepth: async (_symbol: string, limit: number) => {
        assert.equal(limit, 25); books++;
        return { bids: [[99.99, 1]], asks: [[100.01, 2]] };
      }
    } as any;
  });
  const request = { userId: "owner", account: { id: "private-spot", exchange: "binance" }, symbol: "SPOTCONTEXTUSDT", marketType: "spot" as const };
  const [a, b] = await Promise.all([loadPositionMarketContext(request), loadPositionMarketContext(request)]);
  assert.equal(candles, 1); assert.equal(books, 1);
  assert.deepEqual(a, b);
  assert.equal(a.featureSnapshots.length, 2);
  assert.ok(a.snapshotManifest.every(s => s.market.marketType === "spot" && s.market.providerId === "uliquid-native-spot:binance"));
  assert.ok(a.warningCodes.includes("provider_timestamp_missing"));
  assert.ok(!a.warningCodes.includes("funding_unsupported"));
  assert.doesNotMatch(JSON.stringify(a), /private-spot|apiKey|funding-snapshot/);
});

test("standalone BingX context uses native depth normalization while retaining 25-level evidence", async t => {
  const now = Date.now();
  let depthCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/openApi/swap/v2/quote/depth") {
      depthCalls++;
      assert.equal(parsed.searchParams.get("limit"), "50");
      return new Response(JSON.stringify({ code: 0, data: {
        bids: Array.from({ length: 50 }, (_, i) => [100 - i / 100, 1]),
        asks: Array.from({ length: 50 }, (_, i) => [101 + i / 100, 1]), T: now
      } }));
    }
    assert.equal(parsed.pathname, "/openApi/swap/v3/quote/klines");
    return new Response(JSON.stringify({ code: 0, data: Array.from({ length: 100 }, (_, i) => ({
      time: now - (100 - i) * 3600000, open: "100", high: "102", low: "99", close: "101", volume: "5"
    })) }));
  });
  const result = await loadPositionMarketContext({ userId: "owner", account: { id: "fixture-account", exchange: "bingx" }, symbol: "DEPTHFIXUSDT", marketType: "perp" });
  assert.equal(depthCalls, 1);
  assert.ok(!result.warningCodes.includes("orderbook_snapshot_unavailable"));
  assert.ok(result.warningCodes.includes("funding_unsupported"));
  assert.ok(result.warningCodes.includes("open_interest_unsupported"));
  assert.equal(result.snapshotManifest.find(s => s.dataset === "orderbook")!.limit, 25);
  assert.equal(result.snapshotManifest.find(s => s.dataset === "orderbook")!.quality, "fresh");
  assert.ok(result.featureSnapshots.some(f => f.id === "orderbook.snapshot"));
});
