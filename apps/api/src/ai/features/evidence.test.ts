import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMarketFeature } from "./registry.js";
import { storedFeatureEvidence, parseStoredFeatures } from "./evidence.js";
import { projectDecisionLogs } from "../agent-chat/decisionLogs.js";

const at = "2026-09-05T10:00:00.000Z";
function summary() {
  const feature = evaluateMarketFeature("derivatives.funding-snapshot", { rate: 0.0001, fundingIntervalHours: 8 }, `mds_${"a".repeat(64)}`);
  return { quality: "fresh", warnings: [], featureSnapshots: [storedFeatureEvidence(feature.ref, feature.value, feature.routineVersions)],
    marketSnapshot: { id: feature.ref.inputSnapshotId, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0",
      market: { providerId: "native:binance", sourceVenue: "binance", marketType: "perp", symbol: "BTCUSDT" },
      dataset: "derivatives", interval: null, limit: null, observedAt: at, fetchedAt: at, ageMs: 0,
      quality: "fresh", warningCodes: [], atomicObservation: false } };
}
function log(summaries: unknown[], state = "completed") {
  return projectDecisionLogs([{ id: "run", status: state, createdAt: at, completedAt: at,
    profileSnapshot: {}, contextSnapshot: {}, traceLogs: [],
    toolCalls: summaries.map((resultSummary, i) => ({ id: String(i), toolName: "market.get_funding_rate", status: "success", resultSummary }))
  }], [])[0];
}

test("persisted feature values survive JSON reload without recalculation or timestamp refresh", () => {
  const saved = JSON.parse(JSON.stringify(summary()));
  const result = log([saved, saved]);
  assert.equal(result.snapshotManifest.length, 1);
  assert.deepEqual(result.evidence[0].featureSnapshots, saved.featureSnapshots);
  assert.equal((result.evidence[0].featureSnapshots[0].value as any).rate, 0.0001);
  assert.equal(result.snapshotManifest[0].fetchedAt, at);
  assert.equal(result.snapshotManifest[0].ageMs, 0);
  assert.equal(result.permission.execution, "not_permitted");
});

test("legacy and failed runs never gain invented features or recommendations", () => {
  const legacy = log([{}]);
  assert.deepEqual(legacy.snapshotManifest, []);
  assert.deepEqual(legacy.evidence[0].featureSnapshots, []);
  const failed = log([summary()], "failed");
  assert.equal(failed.recommendation, null);
  assert.equal(failed.evidence[0].featureSnapshots.length, 1);
  assert.equal(failed.dataQuality.state, "unavailable");
});

test("invalid stored values, source mismatches and incompatible versions are rejected safely", () => {
  for (const alter of [
    (row: any) => { row.featureSnapshots[0].value.rate = "must-not-leak"; },
    (row: any) => { row.featureSnapshots[0].version = "2.0.0"; },
    (row: any) => { row.featureSnapshots[0].inputSnapshotId = `mds_${"b".repeat(64)}`; },
    (row: any) => { row.marketSnapshot.dataset = "ticker"; },
    (row: any) => { row.marketSnapshot.market.accountId = "must-not-leak"; },
    (row: any) => { row.featureSnapshots[0].value.rawProviderPayload = "must-not-leak"; }
  ]) {
    const saved = summary(); alter(saved);
    const result = log([saved]);
    assert.deepEqual(result.evidence[0].featureSnapshots, []);
    assert.ok(result.dataQuality.reasonCodes.includes("stored_feature_evidence_invalid"));
    assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  }
});

test("mixed providers and excessive instantaneous observation skew are explicit", () => {
  const a = summary(); const b = summary();
  b.marketSnapshot.id = `mds_${"b".repeat(64)}`;
  b.featureSnapshots[0].inputSnapshotId = b.marketSnapshot.id;
  b.marketSnapshot.market.providerId = "native:bitget";
  b.marketSnapshot.market.sourceVenue = "bitget";
  b.marketSnapshot.observedAt = "2026-09-05T09:50:00.000Z";
  const result = log([a, b]);
  assert.ok(result.dataQuality.reasonCodes.includes("market_snapshot_sources_differ"));
  assert.ok(result.dataQuality.reasonCodes.includes("market_snapshot_time_skew"));
  assert.equal(result.dataQuality.state, "degraded");
});

test("stored evidence has a hard byte budget and a bounded feature list", () => {
  const feature = summary().featureSnapshots[0];
  assert.equal(parseStoredFeatures(Array(20).fill(feature)).length, 4);
  assert.throws(() => storedFeatureEvidence({ id: feature.id, version: feature.version, snapshotId: feature.snapshotId, inputSnapshotId: feature.inputSnapshotId },
    { ...(feature.value as any), quality: { state: "degraded", reasons: ["x".repeat(10000)] } }, feature.routineVersions), /budget_exceeded/);
});
