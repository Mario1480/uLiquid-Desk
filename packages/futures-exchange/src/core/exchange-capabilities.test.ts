import assert from "node:assert/strict";
import test from "node:test";
import { BINANCE_FUTURES_CAPABILITIES, BINGX_FUTURES_CAPABILITIES, BITGET_FUTURES_CAPABILITIES, HYPERLIQUID_FUTURES_CAPABILITIES, MEXC_FUTURES_CAPABILITIES, PAPER_FUTURES_CAPABILITIES } from "./exchange-capabilities.js";

test("market-data capabilities are explicit and conservatively uncertified", () => {
  for (const capability of [BINANCE_FUTURES_CAPABILITIES, BITGET_FUTURES_CAPABILITIES, HYPERLIQUID_FUTURES_CAPABILITIES, MEXC_FUTURES_CAPABILITIES, BINGX_FUTURES_CAPABILITIES, PAPER_FUTURES_CAPABILITIES]) {
    assert.ok(capability.providerId.length > 0);
    assert.equal(capability.liveCertificationStatus, "not_assessed");
  }
  assert.equal(MEXC_FUTURES_CAPABILITIES.marketData.fundingRate, "native");
  assert.equal(MEXC_FUTURES_CAPABILITIES.marketData.openInterest, "unsupported");
  assert.equal(BINGX_FUTURES_CAPABILITIES.marketData.fundingRate, "unsupported");
  assert.equal(BINGX_FUTURES_CAPABILITIES.marketData.openInterest, "unsupported");
});

test("paper capabilities are linked instead of misrepresented as native", () => {
  assert.equal(PAPER_FUTURES_CAPABILITIES.providerKind, "paper_linked");
  assert.equal(PAPER_FUTURES_CAPABILITIES.marketData.orderbookAnalytics, "linked");
  assert.equal(PAPER_FUTURES_CAPABILITIES.marketData.openInterest, "linked");
});

test("historical capabilities are independent of current snapshots and never certify live trading", () => {
  assert.equal(BINANCE_FUTURES_CAPABILITIES.marketData.openInterestHistory, "native");
  for (const venue of [BINANCE_FUTURES_CAPABILITIES, BITGET_FUTURES_CAPABILITIES, MEXC_FUTURES_CAPABILITIES]) {
    assert.equal(venue.marketData.fundingHistory, "native"); assert.equal(venue.liveCertificationStatus, "not_assessed");
  }
  for (const venue of [BITGET_FUTURES_CAPABILITIES, MEXC_FUTURES_CAPABILITIES, HYPERLIQUID_FUTURES_CAPABILITIES, BINGX_FUTURES_CAPABILITIES]) {
    assert.equal(venue.marketData.openInterestHistory, "unsupported");
  }
  assert.equal(PAPER_FUTURES_CAPABILITIES.marketData.fundingHistory, "linked");
  assert.equal(PAPER_FUTURES_CAPABILITIES.marketData.openInterestHistory, "linked");
});
