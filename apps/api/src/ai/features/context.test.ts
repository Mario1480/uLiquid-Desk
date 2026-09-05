import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketFeatureContext } from "./context.js";
import { evaluateMarketFeature } from "./registry.js";
import { storedFeatureEvidence, type MarketSnapshotEvidence } from "./evidence.js";

test("feature context validates provenance and remains stable across JSON reload", () => {
  const f = evaluateMarketFeature("derivatives.funding-snapshot", { rate: 0.0001, fundingIntervalHours: 8 }, `mds_${"a".repeat(64)}`);
  const s: MarketSnapshotEvidence = { id: f.ref.inputSnapshotId, schemaVersion: "1.0.0", freshnessPolicyVersion: "1.0.0",
    market: { sourceVenue: "binance", providerId: "uliquid-native:binance", marketType: "perp", symbol: "BTCUSDT" }, dataset: "derivatives",
    interval: null, limit: null, observedAt: "2026-09-05T10:00:00.000Z", fetchedAt: "2026-09-05T10:00:00.000Z", ageMs: 0,
    quality: "fresh", warningCodes: [], atomicObservation: false };
  const context = buildMarketFeatureContext([s], [storedFeatureEvidence(f.ref, f.value, f.routineVersions)]);
  assert.equal(context.quality, "fresh");
  const saved = JSON.parse(JSON.stringify(context));
  assert.deepEqual(buildMarketFeatureContext(saved.snapshotManifest, saved.featureSnapshots, saved.warningCodes), context);
  assert.throws(() => buildMarketFeatureContext([], context.featureSnapshots), /invalid/);
  saved.featureSnapshots[0].value.apiKey = "never-expose";
  assert.throws(() => buildMarketFeatureContext([s], saved.featureSnapshots), /invalid/);
  assert.equal(buildMarketFeatureContext([{ ...s, quality: "stale" }], context.featureSnapshots).quality, "stale");
});
