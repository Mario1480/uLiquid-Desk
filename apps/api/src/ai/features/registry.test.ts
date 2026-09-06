import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMarketFeature, MARKET_FEATURES, type MarketFeatureId } from "./registry.js";
import { executeAgentRoutine } from "../routines/registry.js";

const source = `mds_${"a".repeat(64)}`;
const inputs: Record<MarketFeatureId, unknown> = {
  "derivatives.history-summary": { kind: "funding", unit: "rate", requestedStart: 1000, requestedEnd: 2000, evaluatedAt: 2000,
    points: [], warningCodes: [], excludedRows: 0, conflictingDuplicates: false, truncated: false },
  "technical.indicator-summary": { candles: [], indicators: ["rsi14"] },
  "derivatives.funding-snapshot": { rate: 0.0001, fundingIntervalHours: null },
  "derivatives.open-interest-snapshot": { reportedValue: 12, reportedUnit: "unknown", referencePrice: 100 },
  "orderbook.snapshot": { bids: [[99, 2]], asks: [[101, 1]] }
};

for (const id of Object.keys(MARKET_FEATURES) as MarketFeatureId[]) {
  test(`${id} delegates to the registered routine and carries deterministic version provenance`, () => {
    const first = evaluateMarketFeature(id, inputs[id], source);
    const second = evaluateMarketFeature(id, inputs[id], source);
    assert.deepEqual(first, second);
    assert.deepEqual(first.value, executeAgentRoutine(MARKET_FEATURES[id].routineId, inputs[id]));
    assert.equal(first.ref.inputSnapshotId, source);
    assert.equal(first.ref.version, "1.0.0");
    assert.equal(first.routineVersions[0].id, MARKET_FEATURES[id].routineId);
    assert.notEqual(first.ref.snapshotId, evaluateMarketFeature(id, inputs[id], `mds_${"b".repeat(64)}`).ref.snapshotId);
    assert.throws(() => evaluateMarketFeature(id, { unexpected: true }, source));
  });
}

test("feature evaluation rejects unknown IDs and untrusted provenance identifiers", () => {
  assert.throws(() => evaluateMarketFeature("toString" as MarketFeatureId, {}, source), /market_feature_unknown/);
  assert.throws(() => evaluateMarketFeature("derivatives.funding-snapshot", inputs["derivatives.funding-snapshot"], "private-account-id"));
});

test("different indicator parameters do not collide within a source snapshot", () => {
  const first = evaluateMarketFeature("technical.indicator-summary", { candles: [], indicators: ["rsi14"] }, source);
  const second = evaluateMarketFeature("technical.indicator-summary", { candles: [], indicators: ["sma20"] }, source);
  assert.notEqual(first.ref.snapshotId, second.ref.snapshotId);
});
