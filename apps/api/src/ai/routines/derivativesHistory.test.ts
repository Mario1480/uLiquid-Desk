import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDerivativesHistory, type DerivativesHistoryInput } from "./derivativesHistory.js";
import { AGENT_ROUTINE_IDS, executeAgentRoutine } from "./registry.js";

const start = Date.parse("2026-09-01T00:00:00Z");
const hour = 3_600_000;
function fixture(count = 40): DerivativesHistoryInput {
  return { kind: "open_interest", unit: "base_asset", requestedStart: start, requestedEnd: start + count * hour,
    evaluatedAt: start + count * hour, points: Array.from({ length: count }, (_, i) => ({ timestamp: start + (i + 1) * hour, value: 100 + i,
      reportedNotional: 1000 + i, cadenceMs: hour })), warningCodes: [], excludedRows: 0, conflictingDuplicates: false, truncated: false };
}
test("history routine is deterministic, registered and exposes only a bounded summary", () => {
  const result = summarizeDerivativesHistory(fixture());
  assert.deepEqual(result, executeAgentRoutine(AGENT_ROUTINE_IDS.derivativesHistory, fixture()));
  assert.equal(result.change, 39); assert.equal(result.changePct, 39);
  assert.equal(result.mean, 119.5); assert.equal(result.percentile, 98.75);
  assert.equal(result.quality.state, "fresh"); assert.equal(result.coverageRatio, 1);
  assert.equal(result.latestReportedNotional, 1039);
  assert.equal("points" in result, false);
});
test("unknown cadence never manufactures statistics or annualization", () => {
  const input = fixture(); input.kind = "funding"; input.unit = "rate";
  input.points = input.points.map(p => ({ ...p, value: 0.0001, cadenceMs: null }));
  const result = summarizeDerivativesHistory(input);
  assert.equal(result.changeBps, null); assert.equal(result.mean, null); assert.equal(result.zScore, null);
  assert.ok(result.quality.reasons.includes("history_cadence_unverified_or_changed"));
  assert.equal("annualizedEstimate" in result, false);
});
test("funding uses basis-point differences and no near-zero percent change", () => {
  const input = fixture(2); input.kind = "funding"; input.unit = "rate";
  input.points[0].value = -0.0001; input.points[1].value = 0.0001;
  const result = summarizeDerivativesHistory(input);
  assert.equal(result.changeBps, 2); assert.equal(result.changePct, null); assert.equal(result.percentile, null);
});
test("gaps, cadence changes and excluded malformed observations fail comparable metrics closed", () => {
  for (const change of [
    (input: DerivativesHistoryInput) => { input.points.splice(10, 1); },
    (input: DerivativesHistoryInput) => { input.points[10].cadenceMs = 8 * hour; },
    (input: DerivativesHistoryInput) => { input.excludedRows = 1; },
    (input: DerivativesHistoryInput) => { input.points[10].value = -1; }
  ]) {
    const input = fixture(); change(input); const result = summarizeDerivativesHistory(input);
    assert.equal(result.change, null); assert.equal(result.zScore, null); assert.equal(result.quality.state, "degraded");
  }
});
test("duplicate conflicts invalidate latest and summary values; exact duplicates are not weighted twice", () => {
  const input = fixture(); input.points.push({ ...input.points[10] });
  assert.equal(summarizeDerivativesHistory(input).sampleCount, 40);
  input.points.at(-1)!.value++;
  const result = summarizeDerivativesHistory(input);
  assert.equal(result.quality.state, "unavailable"); assert.equal(result.change, null); assert.equal(result.latestValue, null);
});
test("zero baseline, zero dispersion, empty history and timestamps remain explicit", () => {
  const input = fixture(); input.points.forEach(p => { p.value = 0; });
  const result = summarizeDerivativesHistory(input);
  assert.equal(result.changePct, null); assert.equal(result.zScore, null); assert.equal(result.percentile, 50);
  assert.ok(result.quality.reasons.includes("history_zero_baseline"));
  assert.ok(result.quality.reasons.includes("history_zero_dispersion"));
  input.points = [];
  assert.equal(summarizeDerivativesHistory(input).quality.state, "unavailable");
  assert.throws(() => summarizeDerivativesHistory({ ...fixture(), points: [{ value: 1 }] }));
  assert.throws(() => summarizeDerivativesHistory({ ...fixture(), unit: "rate" }));
  assert.throws(() => summarizeDerivativesHistory({ ...fixture(), requestedEnd: start - 1 }));
});
test("one millisecond event jitter is tolerated; stale and truncated coverage remain visible", () => {
  const input = fixture(); input.points[10].timestamp++;
  assert.equal(summarizeDerivativesHistory(input).quality.state, "fresh");
  input.evaluatedAt += 2 * hour; input.truncated = true;
  const result = summarizeDerivativesHistory(input);
  assert.equal(result.quality.state, "stale"); assert.ok(result.quality.reasons.includes("history_page_limit_reached"));
});
