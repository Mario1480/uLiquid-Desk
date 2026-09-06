import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDerivativesHistory } from "../routines/derivativesHistory.js";
import { serializeMarketModelPayload } from "./modelPayload.js";

function history(kind: "funding" | "open_interest", start: string, end: string) {
  return summarizeDerivativesHistory({ kind, unit: kind === "funding" ? "rate" : "base_asset",
    requestedStart: Date.parse(start) - 3600000, requestedEnd: Date.parse(end) + 3600000,
    evaluatedAt: Date.parse(end) + 3600000, warningCodes: [], excludedRows: 0,
    conflictingDuplicates: false, truncated: false,
    points: [start, end].map(timestamp => ({ timestamp: Date.parse(timestamp), value: 1,
      reportedNotional: null, cadenceMs: null })) });
}

test("live regression: model receives exact UTC windows in both tool data and stored feature context", () => {
  for (const [kind, start, end] of [
    ["open_interest", "2026-08-30T19:00:00.000Z", "2026-09-06T18:00:00.000Z"],
    ["funding", "2026-08-08T00:00:00.000Z", "2026-09-06T16:00:00.000Z"]
  ] as const) {
    const value = history(kind, start, end);
    const payload = { data: { history: value }, marketContext: { featureSnapshots: [{ value, inputSnapshotId: "unchanged" }] } };
    const original = JSON.stringify(payload);
    const presented = JSON.parse(serializeMarketModelPayload(payload));
    assert.equal(presented.data.history.actualStart, start);
    assert.equal(presented.data.history.actualEnd, end);
    assert.equal(presented.data.history.requestedStart, new Date(value.requestedStart).toISOString());
    assert.equal(presented.data.history.requestedEnd, new Date(value.requestedEnd).toISOString());
    assert.deepEqual(presented.marketContext.featureSnapshots[0].value, presented.data.history);
    assert.equal(presented.marketContext.featureSnapshots[0].inputSnapshotId, "unchanged");
    assert.equal(presented.data.history.change, null);
    assert.equal(presented.data.history.sampleCount, 2);
    assert.equal(JSON.stringify(payload), original);
  }
});

test("null historical endpoints and unrelated timestamp fields are not invented or rewritten", () => {
  const value = { ...history("funding", "2026-08-08T00:00:00Z", "2026-09-06T16:00:00Z"), actualStart: null, actualEnd: null };
  const payload = { value, other: { actualStart: 123, timestamp: 456 }, missing: null };
  const presented = JSON.parse(serializeMarketModelPayload(payload));
  assert.equal(presented.value.actualStart, null);
  assert.equal(presented.value.actualEnd, null);
  assert.deepEqual(presented.other, payload.other);
  assert.equal(presented.missing, null);
});
