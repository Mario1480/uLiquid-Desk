import assert from "node:assert/strict";
import test from "node:test";
import { averageConfidence, buildPredictionCopierReviewHref, predictionEvaluationState, separatePredictionAndCopierMetrics } from "./predictionUi";

test("a running prediction is not presented as finally evaluated", () => {
  assert.equal(predictionEvaluationState({ outcomeStatus: "pending", evaluatedAt: null }), "running");
  assert.equal(predictionEvaluationState({ outcomeStatus: "closed", evaluatedAt: null }), "running");
  assert.equal(predictionEvaluationState({ outcomeStatus: "closed", evaluatedAt: "2026-08-02T12:00:00Z" }), "final");
});

test("prediction confidence handles ratio and percentage inputs", () => {
  assert.equal(averageConfidence([0.8, 60]), 70);
  assert.equal(averageConfidence([]), null);
});

test("copier CTA builds a review-only URL", () => {
  const href = buildPredictionCopierReviewHref({
    localePath: "/en/bots/new",
    stateId: "state-1",
    accountId: "account-1"
  });
  assert.match(href, /review=1/);
  assert.match(href, /strategy=prediction_copier/);
  assert.match(href, /sourceStateId=state-1/);
  assert.equal(href.includes("activate"), false);
});

test("prediction and copier performance stay in separate domains", () => {
  const result = separatePredictionAndCopierMetrics({
    directionAccuracy: 61,
    sampleSize: 40,
    copierExecutionReturnPct: 8,
    copierExecutions: 12
  });
  assert.deepEqual(result.prediction, { directionAccuracy: 61, sampleSize: 40 });
  assert.deepEqual(result.copier, { executionReturnPct: 8, executions: 12 });
});
