# Execution Foundation Gap List

Status date: 2026-09-11

Current classification: `SHARED FOUNDATION LANDED / FOLLOW-UP OPEN`.

This list is re-baselined against the current shared execution pipeline. The
previous version incorrectly left all manual trading mutations in the remaining
scope even though several now use `createPerpExecutionService` and
`executeSharedExecutionPipeline`.

## Completed foundation

- A shared execution contract and pipeline exist in `packages/futures-engine`.
- Venue capability and Paper linked-market-data validation are centralized.
- Engine-backed and custom execution paths use the shared response vocabulary.
- Runner simple execution, Prediction Copier bridging, and futures-grid
  delegated order handling use shared execution helpers.
- Manual Perpetual leverage, order placement, order editing, position TP/SL, and
  position close use the shared execution service and pipeline.
- Vault lifecycle events use shared execution metadata.

## Required closeout work

- Move manual Perpetual single-order cancel through the shared pipeline.
- Move manual Perpetual cancel-all through the shared pipeline.
- Retire `legacyPredictionCopierExecutionMode` or document and test why it must
  remain as an intentional compatibility path.
- Collapse remaining bespoke futures-grid result construction onto the shared
  result helper where behavior is equivalent.
- Decide and document whether Vault provider actions use the full shared
  pipeline. They are currently metadata-aligned but not venue/risk-hook aligned.
- Decide whether runner guardrail transitions should become shared pre/post
  hooks or remain mode-owned.
- Decide whether `apps/runner/src/runtime/executionEvents.ts` belongs in a shared
  package after spot, perpetual, and Vault reporting contracts converge.
- Extend the shared action contract only if leverage-only, TP/SL-only, or provider
  lifecycle controls require first-class cross-domain parity.

## Required parity evidence

- Live manual adapter contract tests for place, edit, cancel, cancel-all, TP/SL,
  and close without sending production orders.
- Paper futures-grid terminal-flow tests.
- Persisted Vault provider lifecycle event tests.
- No regression in Prediction Copier idempotency, pending-order recovery, or
  futures-grid cancellation and reconciliation.

## Close condition

The program can close when every retained exception is intentional and
documented, all required execution paths emit the shared result vocabulary, and
the parity suites pass. Planner rewrites, exchange behavior changes, and Vault
orchestration redesign remain out of scope unless separately approved.
