import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPredictionEvaluation,
  buildPredictionEvaluationDashboardSummary,
  readPredictionEvaluationFromOutcomeMeta
} from "./evaluationFramework.js";

test("buildPredictionEvaluation derives calibration, usefulness, stale state, and cost footprint", () => {
  const evaluation = buildPredictionEvaluation({
    signalSource: "ai",
    confidence: 0.8,
    realizedReturnPct: 1.5,
    directionCorrect: true,
    expectedMovePct: 1.2,
    maxAdversePct: 0.5,
    featuresSnapshot: {
      aiExplainMeta: {
        provider: "openai",
        model: "gpt-5.4",
        promptTemplateId: "prompt_1",
        promptTemplateName: "Default",
        analysisMode: "trading_explainer",
        payloadBytes: 2400,
        estimatedTokens: 600,
        trimFlags: ["history_trimmed"],
        maxPayloadBytes: 8192,
        maxHistoryBytes: 4096,
        toolCallsUsed: 1,
        historyContextHash: "abc123",
        overBudget: false,
        cacheHit: false,
        fallbackUsed: false,
        rateLimited: false
      }
    },
    tsCreated: "2026-03-20T10:00:00.000Z",
    outcomeEvaluatedAt: "2026-03-20T10:40:00.000Z",
    timeframeMs: 15 * 60 * 1000,
    horizonMs: 15 * 60 * 1000
  });

  assert.ok(evaluation);
  assert.equal(evaluation?.directionCorrect, true);
  assert.equal(evaluation?.confidencePct, 80);
  assert.equal(evaluation?.calibrationGapPct, 20);
  assert.equal(evaluation?.usefulnessBand, "positive");
  assert.equal(evaluation?.stalePrediction.detected, true);
  assert.equal(evaluation?.costFootprint.provider, "openai");
  assert.equal(evaluation?.costFootprint.estimatedTokens, 600);
});

test("readPredictionEvaluationFromOutcomeMeta reads stored evaluation payloads", () => {
  const stored = {
    version: "ai_evaluation_v1",
    signalSource: "local",
    directionCorrect: false
  };
  assert.deepEqual(
    readPredictionEvaluationFromOutcomeMeta({ aiEvaluation: stored }),
    stored
  );
});

test("buildPredictionEvaluationDashboardSummary aggregates evaluation and metrics outputs", () => {
  const evaluationA = buildPredictionEvaluation({
    signalSource: "ai",
    confidence: 0.7,
    realizedReturnPct: 1,
    directionCorrect: true,
    expectedMovePct: 1,
    maxAdversePct: 0.5,
    featuresSnapshot: {
      aiExplainMeta: {
        provider: "openai",
        model: "gpt-5.4",
        payloadBytes: 2000,
        estimatedTokens: 500,
        toolCallsUsed: 1,
        cacheHit: true,
        fallbackUsed: false,
        overBudget: false
      }
    },
    tsCreated: "2026-03-20T10:00:00.000Z",
    outcomeEvaluatedAt: "2026-03-20T10:10:00.000Z",
    timeframeMs: 15 * 60 * 1000
  });
  const evaluationB = buildPredictionEvaluation({
    signalSource: "local",
    confidence: 55,
    realizedReturnPct: -0.8,
    directionCorrect: false,
    expectedMovePct: 1.4,
    maxAdversePct: 1.1,
    featuresSnapshot: {},
    tsCreated: "2026-03-20T10:00:00.000Z",
    outcomeEvaluatedAt: "2026-03-20T10:05:00.000Z",
    timeframeMs: 15 * 60 * 1000
  });

  const summary = buildPredictionEvaluationDashboardSummary({
    evaluations: [evaluationA!, evaluationB!],
    metricsSamples: [
      {
        confidence: 70,
        signal: "up",
        expectedMovePct: 1,
        realizedReturnPct: 1,
        hit: true,
        absError: 0,
        sqError: 0
      },
      {
        confidence: 55,
        signal: "down",
        expectedMovePct: 1.4,
        realizedReturnPct: -0.8,
        hit: false,
        absError: 0.6,
        sqError: 0.36
      }
    ],
    bins: 5
  });

  assert.equal(summary.evaluationSummary.evaluatedCount, 2);
  assert.equal(summary.evaluationSummary.directionCorrectRatePct, 50);
  assert.equal(summary.evaluationSummary.costFootprint.aiEvaluatedCount, 1);
  assert.equal(summary.metricsSummary.evaluatedCount, 2);
  assert.equal(summary.metricsSummary.calibrationBins.length, 5);
});
