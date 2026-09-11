# AI Evaluation Framework

## Purpose

uLiquid Desk now evaluates prediction quality with one normalized model that is cheap to persist, easy to aggregate, and safe to expose to future dashboard surfaces.

The framework is designed to answer five operational questions:

1. Was the direction right?
2. Was the confidence calibrated?
3. Was the prediction useful after accounting for risk?
4. Did the prediction become stale before evaluation?
5. What was the AI cost footprint behind the prediction?

## Components Reviewed

The current AI path already had strong building blocks, but they were spread across separate modules:

- Prompt generation: [apps/api/src/ai/promptGenerator.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/ai/promptGenerator.ts)
- Payload budgeting: [apps/api/src/ai/payloadBudget.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/ai/payloadBudget.ts)
- History context packing: [apps/api/src/ai/historyContext.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/ai/historyContext.ts)
- Quality gating: [apps/api/src/ai/qualityGate.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/ai/qualityGate.ts)
- Prediction explainer: [apps/api/src/ai/predictionExplainer.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/ai/predictionExplainer.ts)
- Prediction evaluator math: [apps/api/src/jobs/predictionEvaluatorJob.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/api/src/jobs/predictionEvaluatorJob.ts)

The new framework does not replace those components. It normalizes their outputs into one persisted evaluation payload.

## Storage Model

Per-prediction evaluation is stored under:

- `Prediction.outcomeMeta.aiEvaluation`

The evaluator payload is versioned:

- `version: "ai_evaluation_v1"`

AI execution metadata that helps explain cost footprint is stored at prediction creation time under:

- `Prediction.featuresSnapshot.aiExplainMeta`

This keeps storage backward-compatible and avoids a schema migration.

## Evaluation Model

Each stored evaluation contains:

- `signalSource`
  - `local` or `ai`
- `directionCorrect`
  - `true`, `false`, or `null` when directional scoring is not applicable
- `confidencePct`
  - normalized to `0..100`
- `calibrationGapPct`
  - absolute gap between predicted confidence and realized correctness
  - example: `80%` confidence with a correct call produces a `20%` gap
- `riskAdjustedUsefulness`
  - formula: `(realizedReturnPct / riskReferencePct) * confidenceWeight`
  - `riskReferencePct` is the max of:
    - realized adverse excursion
    - expected move
    - `0.25%` floor
  - the score is clamped to `[-5, 5]`
- `stalePrediction`
  - marks evaluations that resolved later than:
    - `expected horizon + one timeframe grace window`
- `costFootprint`
  - provider/model
  - prompt template reference
  - payload bytes
  - estimated tokens
  - trim flags
  - cache/fallback/over-budget signals
  - tool calls used

## API Summary

New summary endpoint:

- `GET /api/predictions/evaluation-summary`

Supported filters match the existing metrics endpoints:

- `timeframe` or `tf`
- `symbol`
- `signalSource`
- `from`
- `to`
- `bins`

Response shape:

- `evaluationSummary`
  - counts
  - direction correctness rate
  - average calibration gap
  - average risk-adjusted usefulness
  - stale rate
  - AI cost footprint rollups
  - `bySignalSource` breakdown
- `metricsSummary`
  - existing calibration-bin and error summary output

This makes the endpoint usable as a future dashboard backend without forcing the UI to join multiple APIs.

## Operational Notes

- Local predictions can still produce an `aiEvaluation` if they have realized outcomes; their cost footprint usually shows `aiUsed: false`.
- Mixed-mode predictions keep the selected signal source in the evaluation while still preserving AI explainer cost signals.
- Historical predictions that already have realized outcome fields but were created before this framework can still be summarized on read, even if `aiEvaluation` was not originally persisted.

## Follow-Up Ideas

- Add per-model cost estimates once pricing policy is formalized.
- Surface `aiEvaluation` directly in more admin/debug views.
- Add time-series rollups for trend charts instead of point-in-time summaries only.
