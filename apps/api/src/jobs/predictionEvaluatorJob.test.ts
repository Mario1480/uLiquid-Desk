import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_TO_CLOSE_EVALUATOR_VERSION,
  buildPredictionMetricsSummary,
  computeCalibrationBins,
  computeDirectionalRealizedReturnPct,
  computePredictionErrorMetrics,
  normalizeConfidencePct,
  resolvePredictionEvaluationHorizonMs,
  shouldEvaluateCloseToClosePrediction
} from "./predictionEvaluatorJob.js";

test("computeDirectionalRealizedReturnPct returns directional pnl for up/down", () => {
  assert.equal(Number(computeDirectionalRealizedReturnPct("up", 100, 110).toFixed(2)), 10);
  assert.equal(Number(computeDirectionalRealizedReturnPct("down", 100, 90).toFixed(2)), 10);
  assert.equal(Number(computeDirectionalRealizedReturnPct("neutral", 100, 110).toFixed(2)), 0);
});

test("computePredictionErrorMetrics returns hit and regression errors", () => {
  const up = computePredictionErrorMetrics({
    signal: "up",
    expectedMovePct: 2,
    realizedReturnPct: 1
  });
  assert.equal(up.hit, true);
  assert.equal(up.absError, 1);
  assert.equal(up.sqError, 1);

  const down = computePredictionErrorMetrics({
    signal: "down",
    expectedMovePct: 2,
    realizedReturnPct: -3
  });
  assert.equal(down.hit, true);
  assert.equal(down.absError, 1);
  assert.equal(down.sqError, 1);
});

test("normalizeConfidencePct handles 0..1 and 0..100 inputs", () => {
  assert.equal(normalizeConfidencePct(0.65), 65);
  assert.equal(normalizeConfidencePct(65), 65);
});

test("computeCalibrationBins creates stable bins", () => {
  const bins = computeCalibrationBins([
    { confidence: 10, hit: false },
    { confidence: 15, hit: true },
    { confidence: 88, hit: true }
  ], 10);
  assert.equal(bins.length, 10);
  assert.equal(bins[1].n, 2);
  assert.equal(bins[8].n, 1);
});

test("buildPredictionMetricsSummary computes hit rate, mae and mse", () => {
  const summary = buildPredictionMetricsSummary([
    {
      confidence: 80,
      signal: "up",
      expectedMovePct: 2,
      realizedReturnPct: 1,
      hit: true,
      absError: 1,
      sqError: 1
    },
    {
      confidence: 40,
      signal: "down",
      expectedMovePct: 1,
      realizedReturnPct: -3,
      hit: true,
      absError: 2,
      sqError: 4
    },
    {
      confidence: 55,
      signal: "neutral",
      expectedMovePct: 0,
      realizedReturnPct: 0.1,
      hit: null,
      absError: 0.1,
      sqError: 0.01
    }
  ]);

  assert.equal(summary.evaluatedCount, 3);
  assert.equal(summary.hitRate, 100);
  assert.equal(summary.mae, 1.0333);
  assert.equal(summary.mse, 1.67);
  assert.equal(summary.calibrationBins.length, 10);
});

test("resolvePredictionEvaluationHorizonMs prefers persisted horizon over one bar", () => {
  const timeframeMs = 15 * 60 * 1000;
  assert.equal(
    resolvePredictionEvaluationHorizonMs({
      horizonMs: 12 * timeframeMs,
      timeframeMs,
      defaultHorizonBars: 12
    }),
    12 * timeframeMs
  );
  assert.equal(
    resolvePredictionEvaluationHorizonMs({
      horizonMs: null,
      timeframeMs,
      defaultHorizonBars: 12
    }),
    12 * timeframeMs
  );
});

test("shouldEvaluateCloseToClosePrediction recomputes v1 rows and waits for full horizon", () => {
  const timeframeMs = 15 * 60 * 1000;
  const tsCreated = new Date("2026-05-02T10:00:00.000Z");
  const horizonMs = 12 * timeframeMs;

  assert.equal(
    shouldEvaluateCloseToClosePrediction({
      outcomeMeta: {
        realizedEvaluatedAt: "2026-05-02T10:20:00.000Z",
        evaluatorVersion: "close_to_close_v1"
      },
      tsCreated,
      horizonMs,
      timeframeMs,
      defaultHorizonBars: 12,
      cutoffMs: tsCreated.getTime() + horizonMs + 1
    }),
    true
  );

  assert.equal(
    shouldEvaluateCloseToClosePrediction({
      outcomeMeta: null,
      tsCreated,
      horizonMs,
      timeframeMs,
      defaultHorizonBars: 12,
      cutoffMs: tsCreated.getTime() + timeframeMs + 1
    }),
    false
  );

  assert.equal(
    shouldEvaluateCloseToClosePrediction({
      outcomeMeta: {
        realizedEvaluatedAt: "2026-05-02T13:00:00.000Z",
        evaluatorVersion: CLOSE_TO_CLOSE_EVALUATOR_VERSION
      },
      tsCreated,
      horizonMs,
      timeframeMs,
      defaultHorizonBars: 12,
      cutoffMs: tsCreated.getTime() + horizonMs + 1
    }),
    false
  );
});
