import assert from "node:assert/strict";
import test from "node:test";
import { featureMetricRows } from "./featureViewModel";
import type { AgentFeatureSnapshot } from "./contracts";

const feature = (id: string, value: unknown): AgentFeatureSnapshot => ({ id, value, version: "1.0.0", snapshotId: "fs_fixture", inputSnapshotId: "mds_fixture", routineVersions: [] });
test("persisted metric projection preserves zero and null and converts only presentation units", () => {
  const rows = featureMetricRows(feature("derivatives.funding-snapshot", { rateBps: 0, fundingIntervalHours: null, annualizedEstimate: 0.1 }));
  assert.deepEqual(rows.map(r => r.value), [0, null, 10]);
  assert.equal(rows[2].unit, "%");
  const oi = featureMetricRows(feature("derivatives.open-interest-snapshot", { reportedValue: 10, reportedUnit: "unknown", normalizedBaseQuantity: null, notionalUsd: null }));
  assert.equal(oi[0].unit, "unknown"); assert.equal(oi[2].value, null);
});
test("unsupported feature versions and unrecognized fields never become metric values", () => {
  assert.deepEqual(featureMetricRows({ ...feature("derivatives.funding-snapshot", { rateBps: 100 }), version: "2.0.0" }), []);
  assert.deepEqual(featureMetricRows(feature("unknown", { apiKey: "private" })), []);
  const book = featureMetricRows(feature("orderbook.snapshot", { spreadBps: "10", bands: [{ bandBps: 10, bidDepthUsd: 0, askDepthUsd: 0, imbalance: null, depthRatio: null }] }));
  assert.equal(book.find(r => r.key === "spread")!.value, null);
  assert.equal(book.find(r => r.key === "imbalance")!.value, null);
  assert.equal(book.find(r => r.key === "bidDepth")!.value, 0);
});

test("history metrics preserve unavailable statistics and display actual coverage without recalculation", () => {
  const rows = featureMetricRows(feature("derivatives.history-summary", { kind: "funding", unit: "rate", sampleCount: 90,
    minimumStatisticsSamples: 30, actualStart: 1000, actualEnd: 2000, cadenceMs: null, coverageRatio: null,
    latestValue: 0, mean: null, changeBps: null, percentile: null, zScore: null, excludedRows: 0 }));
  assert.equal(rows.find(r => r.key === "historyLatest")?.value, 0);
  assert.equal(rows.find(r => r.key === "historyChange")?.value, null);
  assert.equal(rows.find(r => r.key === "historyStart")?.format, "date");
  assert.equal(rows.find(r => r.key === "historyZScore")?.value, null);
  assert.equal(rows.some(r => r.key === "historyChangePct"), false);
});
