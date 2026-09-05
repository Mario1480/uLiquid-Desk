import assert from "node:assert/strict";
import test from "node:test";
import { normalizePerpDerivativesSnapshot } from "./perp-derivatives-normalization.js";
import { createPerpMarketDataClient } from "./perp-market-data.client.js";

test("Binance depth maps requested coverage to valid provider sizes and trims normalized levels", async (t) => {
  let expectedLimit = 50;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/fapi/v1/depth");
    assert.equal(parsed.searchParams.get("limit"), String(expectedLimit));
    assert.equal(parsed.searchParams.get("symbol"), "BTCUSDT");
    assert.equal(options.method, "GET");
    const levels = Array.from({ length: expectedLimit }, () => ["100", "2"]);
    return new Response(JSON.stringify({ bids: levels, asks: levels, E: 1700000000000 }));
  });
  const client = createPerpMarketDataClient({ id: "public:binance", userId: "public", exchange: "binance", label: "public", apiKey: "", apiSecret: "", passphrase: null, marketDataExchangeAccountId: null });
  for (const [requested, upstream, returned] of [[25, 50, 25], [7, 10, 7], [100, 100, 100], [200, 500, 200], [NaN, 50, 50]]) {
    expectedLimit = upstream;
    const result = await client.getDepth("BTCUSDT", requested);
    assert.equal(result.bids.length, returned);
    assert.equal(result.asks.length, returned);
  }
  await client.close();
});

test("normalizes Binance and Bitget funding/OI conservatively", () => {
  const binance = normalizePerpDerivativesSnapshot({ venue: "binance", symbol: "BTCUSDT", primary: { lastFundingRate: "0.0001", markPrice: "50000", time: 1_700_000_000_000 }, secondary: { openInterest: "2" } });
  assert.equal(binance.openInterestUnit, "base_asset");
  assert.equal(binance.fundingIntervalHours, null);
  assert.ok(binance.warnings.includes("funding_interval_unavailable"));
  const bitget = normalizePerpDerivativesSnapshot({ venue: "bitget", symbol: "BTCUSDT", primary: [{ fundingRate: "-0.0002", holdingAmount: "5", markPrice: "49900", ts: "1700000000000" }] });
  assert.equal(bitget.fundingRate, -0.0002);
  assert.equal(bitget.openInterestUnit, "provider_native");
});

test("normalizes Hyperliquid asset contexts and marks request-time timestamps degraded", () => {
  const snapshot = normalizePerpDerivativesSnapshot({ venue: "hyperliquid", symbol: "BTCUSDT", primary: [{ universe: [{ name: "ETH" }, { name: "BTC" }] }, [{ funding: "0.00001" }, { funding: "0.00002", openInterest: "3", markPx: "50000" }]] });
  assert.equal(snapshot.fundingRate, 0.00002);
  assert.equal(snapshot.openInterest, 3);
  assert.equal(snapshot.sourceTimestampProvided, false);
  assert.ok(snapshot.warnings.includes("provider_timestamp_missing"));
});

test("keeps MEXC OI and BingX derivatives unsupported", () => {
  const mexc = normalizePerpDerivativesSnapshot({ venue: "mexc", symbol: "BTCUSDT", primary: { fundingRate: "0.0001", collectCycle: 8 }, secondary: { fairPrice: "50000" } });
  assert.equal(mexc.openInterest, null);
  assert.ok(mexc.warnings.includes("open_interest_unsupported"));
  const bingx = normalizePerpDerivativesSnapshot({ venue: "bingx", symbol: "BTCUSDT" });
  assert.equal(bingx.fundingRate, null);
  assert.equal(bingx.openInterest, null);
});
