# Runner Reconciliation and Event Standards

This document captures the shared reconciliation language that is being converged between Prediction Copier and Grid in the runner.

## Goals

The runner should not treat Grid and Prediction Copier as unrelated execution systems. They need the same basic vocabulary for:

- execution result
- close outcome
- reconciliation result
- risk-event metadata
- failure normalization

## Shared primitives

Current shared sources:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/executionEvents.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/predictionTradeReconciliation.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/futuresVenueRuntime.ts`

The normalized runtime types now include:

- `NormalizedExecutionResult`
- `NormalizedCloseOutcome`
- `NormalizedReconciliationResult`

These are intentionally small and operational. They let different execution domains speak the same language without forcing the whole runner into one giant abstract model too early.

## Event metadata standard

`riskEvent.meta` should carry a stable base shape:

- `domain`
- `stage`
- `symbol`
- `instanceId` where applicable
- `reason`
- `error`

Domain-specific additions are allowed, but the shared base should remain stable so downstream diagnostics do not need different parsers for Grid and Prediction Copier.

## Prediction Copier

Prediction Copier already uses the shared reconciliation helpers for:

- external close reconciliation
- history entry recording
- history close recording
- orphan close detection

It also emits normalized close/reconciliation payloads into event metadata so the result shape is easier to compare with Grid behavior.

## Grid

Grid now uses the same normalized close-outcome primitive for protective termination / residual close handling, including shared execution metadata for `executionVenue` and linked Paper market-data venue when relevant.

Grid termination now also performs a best-effort trade-history close through the same neutral reconciliation helper surface. If no open history row exists, the helper can suppress orphan noise so Grid does not emit misleading close-history events for planner-only states.

Prediction Copier and Grid now also attach normalized `executionVenue` / `marketDataVenue` metadata through the same runner execution-meta helper, so close outcomes and terminal events describe venue context the same way.

Venue-specific Grid rules still remain separate:

- liquidation distance gates
- fee buffer
- active order window
- planner reason codes

That separation is intentional: the event and reconciliation shape should be shared, while planner and venue constraints stay domain-specific.

## Remaining alignment work

Still to finish:

1. align Grid trade-history semantics more closely with the same close/history vocabulary used by Prediction Copier
2. normalize more delegated execution results from Grid planner intents
3. keep extending reconciliation parity tests across Paper and live venues

The neutral helper surface now uses:

- `reconcileExternalClose(...)`
- `recordTradeExitHistory(...)`
- `recordTradeEntryHistory(...)`

Prediction-Copier-specific helper names remain as compatibility wrappers while the runner moves toward one shared reconciliation API.

## Related tests

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/executionEvents.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/predictionTradeReconciliation.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/prediction-copier.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/pythonGridClient.test.ts`
