# Vault Onchain Reconciliation Job Soft Path Audit

Scope: `apps/api/src/jobs/vaultOnchainReconciliationJob.ts`.

## Classification

| Class | Rule |
| --- | --- |
| `must_fail` | A state/repair write did not land, so DB state can remain materially wrong. The job may continue over other rows, but the cycle is marked degraded/blocked. |
| `recoverable_track` | The cycle can continue, but the missing evidence or tracking write must emit structured telemetry and remain retryable. |
| `okay_to_swallow` | The path is a non-authoritative enrichment or best-effort recovery side path. It must not mask the primary reconciliation result. |

## Audit List

| Path | Classification | Decision |
| --- | --- | --- |
| Master/Bot onchain state reads | `recoverable_track` | RPC/read gaps now log `observed_state_incomplete` with `recoveryAction=retry` and skip the affected row instead of repairing from incomplete evidence. |
| V3 USDC balance read used for settled close-only inference | `recoverable_track` | The job keeps processing with unknown balance, but emits a retryable read-gap log. |
| Master compensation cash-event reads | `recoverable_track` | Read failure now skips the master repair row, avoiding a repair from an unsafe empty compensation set. |
| Agent HYPE balance read/cache and low-HYPE notification state | `recoverable_track` | Balance and notification work remains non-blocking but logs degraded reads/writes to avoid silent repeated or stale notification behavior. |
| Onchain action reads/confirmation/backfill updates | `recoverable_track` | Funding/create-action tracking can retry later; failures now emit structured logs with funding mismatch context. |
| Funding timeout lifecycle persistence | `must_fail` | Failure to mark recovery-required is now logged as a critical retryable persistence failure. |
| Master/Bot drift repair writes | `must_fail` | Repair write failures now carry `local_ahead_of_observed_state`, `recoveryAction=retry`, and `issueClass=must_fail`. |
| V3 funding/lifecycle persistence after observed onchain funding | `must_fail` | Failure to persist observed funding state is now classified as critical retryable persistence failure. |
| V3 auto HyperCore advance persistence after tx-side work | `must_fail` | Missing persisted tx/status metadata is critical because retries/resume depend on it. |
| Cycle status after critical persistence failures | `must_fail` | Per-row failures now increment a critical counter and set the last job status to blocked via `vault_onchain_reconciliation_cycle_degraded`. |
| Grid provisioning and bot status side writes | `recoverable_track` | Execution can continue, but post-processing status writes now log retryable tracking failures. |
| V3 funding tx-hash recovery from historical logs | `okay_to_swallow` | Historical tx recovery is best effort. Block/log failures remain soft, but are classified and logged. |
| Primitive parse fallbacks (`readBigInt`) | `okay_to_swallow` | Parse-only fallback returns `null`; no external state or network operation is involved. |

## Remaining Intentional Soft Paths

The job may still continue after classified failures when failing the entire cycle would reduce coverage for unrelated vault rows. Remaining soft behavior is intentional only for:

- best-effort historical funding tx-hash recovery,
- non-authoritative notification/cache/provisioning side effects,
- retryable read gaps where repairing from incomplete evidence would be unsafe,
- per-row repair write failures that are logged as `must_fail` while the cycle continues to inspect other rows.
