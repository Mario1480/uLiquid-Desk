import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPredictionRefreshFailurePatch,
  buildPredictionRefreshSuccessPatch,
  sanitizePredictionRefreshError,
  toPredictionRefreshHealthDto
} from "./refreshHealth.js";

test("buildPredictionRefreshSuccessPatch clears degraded state", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  assert.deepEqual(buildPredictionRefreshSuccessPatch(now), {
    refreshStatus: "ok",
    lastRefreshAttemptAt: now,
    lastRefreshErrorAt: null,
    lastRefreshError: null,
    refreshFailureCount: 0
  });
});

test("buildPredictionRefreshFailurePatch records sanitized failure state", () => {
  const now = new Date("2026-05-02T12:00:00.000Z");
  const patch = buildPredictionRefreshFailurePatch(new Error("provider\n  unavailable"), now);
  assert.equal(patch.refreshStatus, "degraded");
  assert.equal(patch.lastRefreshAttemptAt, now);
  assert.equal(patch.lastRefreshErrorAt, now);
  assert.equal(patch.lastRefreshError, "provider unavailable");
  assert.deepEqual(patch.refreshFailureCount, { increment: 1 });
});

test("toPredictionRefreshHealthDto normalizes absent legacy fields", () => {
  assert.deepEqual(toPredictionRefreshHealthDto({}), {
    refreshStatus: "ok",
    lastRefreshAttemptAt: null,
    lastRefreshErrorAt: null,
    lastRefreshError: null,
    refreshFailureCount: 0
  });
});

test("sanitizePredictionRefreshError bounds persisted error text", () => {
  const sanitized = sanitizePredictionRefreshError("x".repeat(400));
  assert.equal(sanitized.length, 240);
});
