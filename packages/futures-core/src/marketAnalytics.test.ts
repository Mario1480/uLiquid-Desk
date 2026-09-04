import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFundingSnapshot,
  analyzeOpenInterestSnapshot,
  analyzeOrderbookSnapshot
} from "./marketAnalytics.js";

test("funding snapshot annualizes only with a reliable cadence", () => {
  const complete = analyzeFundingSnapshot({ rate: 0.0001, fundingIntervalHours: 8 });
  assert.equal(complete.rateBps, 1);
  assert.equal(complete.direction, "positive");
  assert.equal(complete.annualizedEstimate, 0.1095);
  assert.equal(complete.quality.state, "fresh");

  const missingCadence = analyzeFundingSnapshot({ rate: -0.0002 });
  assert.equal(missingCadence.direction, "negative");
  assert.equal(missingCadence.annualizedEstimate, null);
  assert.equal(missingCadence.quality.state, "degraded");
});

test("open interest preserves unknown units instead of inventing notional", () => {
  const unknown = analyzeOpenInterestSnapshot({ reportedValue: 123, reportedUnit: "provider_native", referencePrice: 50_000 });
  assert.equal(unknown.reportedValue, 123);
  assert.equal(unknown.normalizedBaseQuantity, null);
  assert.equal(unknown.notionalUsd, null);
  assert.equal(unknown.quality.state, "degraded");

  const normalized = analyzeOpenInterestSnapshot({ reportedValue: 2, reportedUnit: "base_asset", referencePrice: 50_000 });
  assert.equal(normalized.notionalUsd, 100_000);
});

test("orderbook snapshot calculates deterministic depth and imbalance", () => {
  const analysis = analyzeOrderbookSnapshot({
    bids: [[99.95, 2], [99.5, 3]],
    asks: [[100.05, 1], [100.5, 4]]
  });
  assert.equal(analysis.midPrice, 100);
  assert.ok(Math.abs((analysis.spreadBps ?? 0) - 10) < 1e-9);
  assert.equal(analysis.weightedMid, 100.016666666667);
  assert.equal(analysis.bands.length, 4);
  assert.equal(analysis.bands[3]?.bidDepthUsd, 498.4);
  assert.equal(analysis.quality.state, "fresh");
});

test("orderbook snapshot degrades malformed, missing and crossed books", () => {
  const malformed = analyzeOrderbookSnapshot({ bids: [[100, -1], [99, 1]], asks: [[101, 1]] });
  assert.equal(malformed.quality.state, "degraded");
  assert.ok(malformed.quality.reasons.includes("invalid_levels_removed"));

  const missing = analyzeOrderbookSnapshot({ bids: [], asks: [[101, 1]] });
  assert.equal(missing.quality.state, "degraded");

  const crossed = analyzeOrderbookSnapshot({ bids: [[102, 1]], asks: [[101, 1]] });
  assert.equal(crossed.midPrice, null);
  assert.ok(crossed.quality.reasons.includes("orderbook_crossed"));
});

test("orderbook snapshot explains unavailable depth ratios and imbalance", () => {
  const zeroDepth = analyzeOrderbookSnapshot({ bids: [[99, 1]], asks: [[101, 1]] });
  assert.equal(zeroDepth.bands[0]?.depthRatio, null);
  assert.equal(zeroDepth.bands[0]?.imbalance, null);
  assert.ok(zeroDepth.quality.reasons.includes("depth_ratio_unavailable_10bps"));
  assert.ok(zeroDepth.quality.reasons.includes("imbalance_unavailable_10bps"));
  assert.equal(zeroDepth.quality.state, "degraded");
});
