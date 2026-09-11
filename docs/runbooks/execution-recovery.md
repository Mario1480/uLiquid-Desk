# Execution Recovery and Idempotency

This document defines the current execution hardening baseline for retries, replay prevention, and restart recovery.

## Objectives

- prevent duplicate submissions after timeouts or process restarts
- make retry safety explicit instead of implicit
- preserve existing runtime behavior unless a duplicate-order risk is higher than a short-lived block
- keep reconciliation catch-up idempotent

## Retry categories

### `safe_retry`

Use this when the platform can deterministically retry without creating a second live order.

Current examples:

- Paper Grid limit-order recovery, because the retry is keyed by `clientOrderId` and the paper store already deduplicates by that key

### `unsafe_retry`

Use this when transport failed during submit and the venue acceptance state is unknown.

Current examples:

- live submit timeout
- network abort during live order placement
- socket / fetch failures during a live submit

Behavior:

- keep the execution in a persisted pending-confirmation state
- do not blindly replay the order on the next tick
- attempt recovery by matching the same idempotency key against venue open orders

### `manual_intervention_required`

Use this when automatic retry is not safe or the pending confirmation window has expired.

Current examples:

- invalid order parameters
- unsupported symbol / rejected request
- stale live pending execution that could not be confirmed after the grace window

Behavior:

- block further planner-driven order placement for that execution branch
- require operator review before resuming normal flow

## Idempotency keys

### Grid runner

Grid now uses planner `clientOrderId` as the canonical idempotency key for delegated order intents.

The key is used in three places:

1. before submit, the runner persists a pending execution record in `gridInstance.stateJson.executionRecovery`
2. during submit, the runner forwards `clientOrderId` into the futures adapter when the venue supports client order ids
3. during recovery, the runner reconciles pending executions against venue open orders or the Paper order store using the same key

### Manual API orders

`POST /api/orders` now supports optional API-layer idempotency through the existing middleware.

Accepted inputs:

- `x-idempotency-key` header
- `idempotencyKey` body field
- `actionKey` body field

If no key is provided, behavior is unchanged.

### Prediction / reconciliation history

Prediction trade-entry history now deduplicates by `entryOrderId` when available, and duplicate-entry races are treated as an idempotent success instead of a hard failure.

## Restart recovery

### Grid pending execution recovery

On every Grid tick, before planner work starts, the runner now:

1. reads `stateJson.executionRecovery.pendingOrders`
2. checks whether the order is already represented in local Grid order state
3. for live venues, tries to adopt the existing venue order by matching `clientOrderId`
4. for Paper limit orders, safely replays the order using the same `clientOrderId`
5. if the order still cannot be confirmed, blocks new planning until confirmation or escalation

This is intentionally conservative. A short temporary block is preferred over placing a second live order.

### Live position recovery

Grid planner position discovery for live venues now prefers adapter positions instead of only local trade state. This prevents repeated initial seeding after a restart when the venue already has an open position but local runner state is stale.

## Reconciliation catch-up

Prediction / runner reconciliation remains the source of truth for stale open-history cleanup:

- `reconcileExternalClose(...)`
- `recordTradeEntryHistory(...)`
- `recordTradeExitHistory(...)`

These paths now explicitly support idempotent duplicate-entry handling and restart-time close catch-up.

## Tests

Focused recovery coverage lives in:

- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/recovery.test.ts`
- `/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/runtime/predictionTradeReconciliation.test.ts`

Covered scenarios:

- duplicate submission prevention by adopting an already-open venue order
- safe Paper retry after timeout / restart
- escalation from unresolved timeout to manual intervention
- stale reconciliation catch-up after restart
- duplicate history entry treated as idempotent

## Current follow-up gaps

- Grid initial seed does not yet persist a standalone explicit client-order recovery record; it relies on live position discovery to avoid replay.
- Live recovery currently confirms against open orders, not recent fills, so fast fill-only confirmation still falls back to conservative blocking until reconciliation catches up.
- Manual-trading idempotency is API-layer only; it does not yet persist an execution ledger entry in the API database.
