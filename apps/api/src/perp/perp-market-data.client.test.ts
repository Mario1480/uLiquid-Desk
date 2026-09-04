import assert from "node:assert/strict";
import test from "node:test";
import { normalizePerpDerivativesSnapshot } from "./perp-derivatives-normalization.js";

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
