# Grid Runtime Recovery

## Goal

Grid runtime recovery is designed to keep runner restarts and exchange delays from causing:

- duplicate order submission
- missed fill ingestion
- stale local open-order state
- unsafe continuation after ambiguous exchange confirmation

## Recovery Flow

The current recovery path in [apps/runner/src/execution/futuresGridExecutionMode.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/futuresGridExecutionMode.ts) now runs in this order:

1. Restore `executionRecovery` state from `gridBotInstance.stateJson`
2. Run a pre-plan live fill-sync catch-up for non-paper venues
3. Reconcile local open-order state against current venue open orders
4. Recover pending submissions that were left in `pending_confirmation`
5. Rebuild planner inputs from refreshed open-order and position state
6. Execute the planner result
7. Run the normal post-plan fill sync

## What Is Persisted

Recovery state is stored under `stateJson.executionRecovery` and now includes:

- `pendingOrders`
  Pending submissions that still need venue confirmation or manual intervention
- `openOrderRuntime`
  Local observations used to detect stale open orders that disappear from the venue across multiple cycles
- `fillSync`
  Last fill-sync attempt/success/error metadata and recent counts

The implementation lives in [apps/runner/src/execution/recovery.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/recovery.ts).

## Hardened Behaviors

### Restart Pending-Order Recovery

Pending grid orders are still recovered conservatively:

- if a matching venue order is found, the runner adopts it and clears the pending state
- for paper limit orders, a safe retry recreates the order
- for unresolved live submissions, the runner blocks after the manual-intervention threshold

### Missed Fill Sync Cycle Catch-Up

For live venues, a pre-plan fill sync now runs before planner execution after restart. This lets the runner ingest fills that happened while it was offline before deciding what the next ladder actions should be.

Fill-sync health is recorded in recovery state so we can see:

- last attempt time
- last success time
- last error
- consecutive failures

### Delayed Order Status

Local open orders are no longer canceled immediately just because the venue does not report them in one cycle.

The runner now:

- tracks missed venue observations per local open order
- waits for two consecutive misses before declaring the order orphaned
- marks the local order map entry as `canceled` only after that threshold

This protects against temporary venue propagation delays during restart or reconnect windows.

### Partial Ladder Execution

Fill sync is now conservative about marking an order as fully filled.

In [apps/runner/src/grid/fillSync.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/fillSync.ts):

- terminal-looking fills update the local order map to `filled`
- partial fills keep the local order open unless the payload shows terminal evidence

This prevents a partially executed ladder order from being treated as fully gone too early.

### Orphaned Grid Order State

If the local grid order map still says an order is open but the venue repeatedly does not, the runner now treats that as stale local state and clears it after the grace threshold instead of carrying it forever through restarts.

## Tests Added

Coverage now includes:

- restart recovery adopting an already-existing venue order
- safe retry of paper orders after restart
- escalation of unresolved stale pending submissions
- delayed venue-order reappearance resetting the orphan counter
- orphaned local open-order cleanup after repeated misses
- conservative terminal-vs-partial fill detection

Relevant test files:

- [apps/runner/src/execution/recovery.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/recovery.test.ts)
- [apps/runner/src/execution/gridRuntimeRecovery.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/execution/gridRuntimeRecovery.test.ts)
- [apps/runner/src/grid/fillSync.test.ts](/Users/marioeuchner/Documents/GitHub/uLiquid-Desk/apps/runner/src/grid/fillSync.test.ts)

## Remaining Limitations

- Unknown venue orders are only counted, not automatically adopted, if they do not match local open-order or pending references. This is intentional because the runner cannot safely infer ownership in every exchange payload shape.
- Partial-fill awareness still depends on venue payload quality. If a venue does not expose terminal status or remaining quantity, the runner stays conservative and leaves the order open.
- Pre-plan fill sync is only available for non-paper adapters that expose fills through the supported APIs.
- Recovery improves local consistency, but it does not replace exchange-native reconciliation for long outages or missing historical fills beyond the current fetch window.
