# BotVault v4 Status Model

BotVault v4 exposes one shared `statusCategory` vocabulary across API payloads,
reconcile metadata, readiness blockers, and operational logs. Detailed reason
codes remain specific, but they should roll up into one of these categories.

| Category | Meaning | Typical reasons |
| --- | --- | --- |
| `pending` | Work is expected to continue and no operator action is known yet. | Funding requested, transfer submitted, reserve pending without an error. |
| `retryable` | A retry or later read can resolve the state. | RPC/read failure, delayed HyperCore or EVM visibility, post-transfer reconcile pending. |
| `recovery_required` | Automated normal flow cannot safely continue and recovery handling must run. | Local lifecycle degraded by counterevidence, HYPE reserve recovery failure, post-reconcile recovery. |
| `user_action_required` | The user must change funding/configuration before the system can continue. | Missing agent setup, missing Core spot USDC for HYPE reserve, HYPE reserve budget too low. |
| `blocked` | Execution is blocked by a non-ready or contradictory state that is not just a read delay. | Close-only/closed/error lifecycle, blocking reconcile mismatch. |
| `execution_ready` | Start conditions are verified enough for v4 execution. | Funding verified, perp margin visible, HYPE reserve verified, reconcile snapshot readable. |
| `settled` | The vault is economically closed or settlement is complete. | Closed onchain state with returned principal, withdrawn HyperCore lifecycle. |

Implementation rules:

- `classifyBotVaultV4Status()` in `apps/api/src/vaults/botVaultV3.lifecycle.ts`
  is the canonical classifier.
- API summaries expose `statusCategory`, `statusReason`, and `statusDetail`.
- `executionReadiness`, `healthSummary`, `reconciliation`, and every reconcile
  issue carry the same category vocabulary.
- Grid start blockers persist `statusCategory` beside the blocker code.
- Grid start blockers also persist `reasonCode`, `mismatchCategory`,
  `recoveryAction`, and `recoveryHint` when a reconcile/readiness mismatch is
  known. The same issue code should appear as the blocker reason and as the
  BotVault status reason.
- Read failures should classify as `retryable`, not `recovery_required`, unless
  there is content counterevidence.
- Concrete counterevidence or impossible local state can classify as
  `recovery_required`, `user_action_required`, or `blocked` depending on the
  recovery action.

Recovery hints are intentionally small:

| Recovery hint | Meaning |
| --- | --- |
| `retry_reconcile` | Retry later or resume reconciliation without changing capital state. |
| `degrade_to_observed_state` | Local lifecycle can be downgraded to the weaker verified state. |
| `run_recovery` | Normal execution is blocked until recovery handling resolves the mismatch. |
| `request_user_action` | User funding/configuration action is required. |
| `none` | No recovery action is needed. |

## Funding And HYPE Reserve Observability

The v4 funding path emits structured flow events for the support-critical
handoffs from funding intent through HYPE reserve bootstrap and margin-add
verification.

| Log event | Reason/status intent |
| --- | --- |
| `bot_vault_v4_funding_requested` | User funding intent was recorded; status is user-action-oriented until onchain confirmation is visible. |
| `bot_vault_v3_funding_intent_timeout` with `flowEvent=funding_timed_out` and `reasonCode=bot_vault_v4_funding_timed_out` | A pending funding intent exceeded the timeout and moved to recovery-required tracking. |
| `bot_vault_v4_reserve_bootstrap_pending` | The HYPE reserve order completed or is expected, but the target balance is not visible yet. |
| `bot_vault_v4_reserve_bootstrap_retryable` | Reserve bootstrap hit a retryable venue/read/confirmation problem. |
| `bot_vault_v4_reserve_bootstrap_user_action_required` | Reserve bootstrap needs user-side funding/configuration, such as missing Core spot USDC or too-low budget. |
| `bot_vault_v4_reserve_bootstrap_recovery_required` | Reserve bootstrap cannot safely continue without recovery handling. |
| `bot_vault_v4_margin_add_verified` | Perp margin transfer and local verification are complete; execution may still wait for HYPE reserve. |
| `bot_vault_v4_execution_ready_confirmed` | Margin, HYPE reserve, final state, and readiness metadata all reached `execution_ready`. |

These events carry `flowEvent`, `reasonCode`, `statusCategory`,
`mismatchCategory`, `recoveryAction`, and HYPE reserve fields when applicable.
Grid start blockers use v4-specific readiness reasons such as
`bot_vault_v4_funding_requested_not_confirmed` and
`bot_vault_v4_hype_reserve_not_ready` so funding and reserve pending/recovery
states remain recognizable in API status payloads.

## Reduce-Margin Observability

`reduceMargin()` is a capital-control path and exposes an additional
`flowState` plus `statusReason` in the API result and in
`executionMetadata.reduceMarginFinalization`.

| Flow state | Meaning | Resume behavior |
| --- | --- | --- |
| `transfer_submitted` | Perp-to-Spot reduce transfer was started, but final visibility is not complete. | Retry reads; do not submit a second transfer while finalization exists. |
| `transfer_verified` | v3 reduce transfer is visible and perp state was readable. | Local apply may continue after post-reconcile is applied. |
| `evm_return_pending` | v4 Spot-to-EVM return is submitted or expected, but EVM USDC is not visible yet. | Retry read/resume; if the Spot leg is visible, resume only the Spot-to-EVM leg when needed. |
| `evm_return_verified` | v4 EVM return is visible and transfer verification is complete. | Local apply may continue after post-reconcile is applied. |
| `post_reconcile_pending` | External transfer is verified, but local post-reconcile did not apply cleanly. | Retry reconcile/resume without re-sending transfers. |
| `post_reconcile_recovery_required` | Post-reconcile found content counterevidence. | Enter recovery; normal retry is blocked until recovery resolves the mismatch. |

Structured logs use the same reason codes, for example
`bot_vault_v3_reduce_margin_transfer_submitted`,
`bot_vault_v3_reduce_margin_transfer_verified`,
`bot_vault_v4_reduce_margin_evm_return_pending`,
`bot_vault_v4_reduce_margin_evm_return_verified`,
`bot_vault_v3_reduce_margin_post_reconcile_pending`, and
`bot_vault_v3_reduce_margin_post_reconcile_recovery_required`.
