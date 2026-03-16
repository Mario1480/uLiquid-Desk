import assert from "node:assert/strict";
import test from "node:test";
import { resolvePredictionPerformanceMetrics } from "./performanceMetrics.js";

test("resolvePredictionPerformanceMetrics falls back to outcomePnlPct and computed errors", () => {
  const result = resolvePredictionPerformanceMetrics({
    signal: "up",
    expectedMovePct: 2,
    outcomeMeta: null,
    outcomePnlPct: 1.25,
    asRecord(value) {
      return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    },
    readRealizedPayloadFromOutcomeMeta() {
      return {
        realizedReturnPct: null,
        evaluatedAt: null,
        errorMetrics: null
      };
    },
    computePredictionErrorMetrics({ realizedReturnPct }) {
      return {
        hit: realizedReturnPct !== null ? realizedReturnPct > 0 : null,
        absError: 0.75,
        sqError: 0.5625
      };
    }
  });

  assert.equal(result.realizedReturnPct, 1.25);
  assert.equal(result.hit, true);
  assert.equal(result.absError, 0.75);
  assert.equal(result.sqError, 0.5625);
});

test("resolvePredictionPerformanceMetrics keeps stored evaluator metrics when present", () => {
  const result = resolvePredictionPerformanceMetrics({
    signal: "down",
    expectedMovePct: 3,
    outcomeMeta: {
      realizedReturnPct: -1.5,
      errorMetrics: {
        hit: true,
        absError: 0.4,
        sqError: 0.16
      }
    },
    outcomePnlPct: 9.9,
    asRecord(value) {
      return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    },
    readRealizedPayloadFromOutcomeMeta(outcomeMeta) {
      const record =
        outcomeMeta && typeof outcomeMeta === "object" && !Array.isArray(outcomeMeta)
          ? (outcomeMeta as Record<string, unknown>)
          : {};
      return {
        realizedReturnPct: record.realizedReturnPct,
        evaluatedAt: null,
        errorMetrics: record.errorMetrics
      };
    },
    computePredictionErrorMetrics() {
      return {
        hit: false,
        absError: 7,
        sqError: 49
      };
    }
  });

  assert.equal(result.realizedReturnPct, -1.5);
  assert.equal(result.hit, true);
  assert.equal(result.absError, 0.4);
  assert.equal(result.sqError, 0.16);
});

test("resolvePredictionPerformanceMetrics supports nested realized payloads", () => {
  const result = resolvePredictionPerformanceMetrics({
    signal: "neutral",
    expectedMovePct: 0,
    outcomeMeta: {
      realized: {
        realizedReturnPct: 0.2
      }
    },
    asRecord(value) {
      return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    },
    readRealizedPayloadFromOutcomeMeta() {
      return {
        realizedReturnPct: null,
        evaluatedAt: null,
        errorMetrics: null
      };
    },
    computePredictionErrorMetrics() {
      return {
        hit: null,
        absError: 0.2,
        sqError: 0.04
      };
    }
  });

  assert.equal(result.realizedReturnPct, 0.2);
  assert.equal(result.hit, null);
  assert.equal(result.absError, 0.2);
  assert.equal(result.sqError, 0.04);
});
