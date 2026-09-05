import assert from "node:assert/strict";
import test from "node:test";
import { loadPositionMarketContext, positionMarketContextDependencies as deps } from "./marketContext.js";

test("standalone Copilot reads shared public features once, retaining source, nulls and versions", async () => {
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

test("spot and unknown venues remain explicit and never create a client", async () => {
  const original = deps.createClient;
  deps.createClient = () => { assert.fail("unexpected client"); };
  try {
    for (const [marketType, exchange, reason] of [["spot", "binance", "spot_market_features_not_integrated"], ["perp", "unknown", "market_data_venue_unsupported"]] as const) {
      const result = await loadPositionMarketContext({ userId: "owner", account: { id: "account", exchange }, symbol: "BTCUSDT", marketType });
      assert.equal(result.quality, "unavailable"); assert.deepEqual(result.warningCodes, [reason]);
    }
  } finally { deps.createClient = original; }
});
