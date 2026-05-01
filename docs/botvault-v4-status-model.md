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

## Status / Reason Matrix

This matrix is the compact reference for new BotVault v4 and Grid status work.
Use the `Retry`, `Recovery`, and `User action` columns to decide which API
category, log event, and start blocker metadata a new reason should carry.

### Lifecycle And Readiness

| Technical state / reason | API/user meaning | Retry | Recovery | User action |
| --- | --- | --- | --- | --- |
| `deployed`, `funding_requested`, `bot_vault_v4_funding_requested_not_confirmed` | Funding intent exists or funding is still waiting for onchain confirmation. | yes | no | yes |
| `bot_vault_v4_funding_timed_out`, `bot_vault_v4_funding_intent_timeout:*` | Funding intent stayed pending past timeout; normal start is unsafe. | no | yes | maybe |
| `hyper_evm_confirmed`, `bot_vault_v4_hypercore_funding_not_started` | Vault has HyperEVM funding, but HyperCore movement has not started. | yes | no | no |
| `hypercore_funded`, `bot_vault_v4_hypercore_transfer_pending` | HyperCore funding exists, but perp margin transfer is not finalized. | yes | no | no |
| `perp_margin_transferred`, `bot_vault_v4_perp_margin_not_verified`, `bot_vault_v4_funding_verification_missing` | Perp transfer was submitted/observed, but final funding metadata or reads are incomplete. | yes | no | no |
| `bot_vault_v4_reconciliation_snapshot_missing`, `bot_vault_v4_perp_margin_not_visible` | Reconcile/read snapshot cannot yet prove executable perp margin. | yes | no | no |
| `bot_vault_v4_hype_reserve_not_ready`, `bot_vault_v4_hype_reserve_balance_pending`, `bot_vault_v4_hype_reserve_confirmation_pending` | HYPE reserve bootstrap is pending or visibility is delayed. | yes | no | no |
| `bot_vault_v4_hype_reserve_core_spot_usdc_missing`, `bot_vault_v4_hype_reserve_budget_too_low` | Reserve bootstrap needs user-side Core spot USDC or a higher reserve budget. | no | no | yes |
| `bot_vault_v4_hype_reserve_corewriter_missing`, `bot_vault_v4_hype_reserve_market_missing`, `bot_vault_v4_hype_reserve_unknown_failure` | Reserve bootstrap cannot continue safely through the normal path. | no | yes | no |
| `execution_ready`, `bot_vault_v4_ready` | Funding, perp margin, reserve, and reconcile evidence are ready for Grid execution. | no | no | no |
| `failed`, `recovery_required`, `bot_vault_v4_execution_blocked` | Lifecycle is explicitly blocked or terminal until recovery/ops resolves it. | no | yes | maybe |
| `settled` | Vault is economically closed or settlement completed. | no | no | no |

### Reconcile And Mismatch

| Technical state / reason | API/user meaning | Retry | Recovery | User action |
| --- | --- | --- | --- | --- |
| `observed_state_incomplete` | Read/RPC evidence is missing or stale; do not infer counterevidence. | yes | no | no |
| `funding_verification_missing` | Required margin/funding metadata or visibility is incomplete. | yes | no | no |
| `reserve_bootstrap_incomplete` with recovery action `retry` | Reserve bootstrap can be retried or re-read later. | yes | no | no |
| `reserve_bootstrap_incomplete` with recovery action `user_action_required` | Reserve bootstrap is blocked by user-fixable funding/config. | no | no | yes |
| `reserve_bootstrap_incomplete` with recovery action `recovery_required` | Reserve bootstrap has non-retryable system/config failure. | no | yes | no |
| `local_ahead_of_observed_state`, `funding_lifecycle_execution_ready_counterevidence` | Local lifecycle is ahead of verified venue state. | no | yes | no |
| `post_transfer_reconcile_failed` with recovery action `retry` | Capital move is done, but local post-reconcile write/read can retry. | yes | no | no |
| `post_transfer_reconcile_failed` with recovery action `recovery_required` | Post-reconcile found content counterevidence. | no | yes | no |
| `manual_intervention_required` | The classifier cannot resolve safely without user or operator action. | no | maybe | maybe |
| `bot_vault_v4_reconciliation_blocking_mismatch` | Reconcile has a blocking issue; Grid start must inherit issue metadata. | no | yes | maybe |

### Grid Start Blockers

| Technical state / reason | API/user meaning | Retry | Recovery | User action |
| --- | --- | --- | --- | --- |
| `grid_instance_vault_reconcile_required` | Grid start could not complete BotVault reconcile/readiness check. | yes | no | no |
| `bot_vault_v4_execution_not_ready` with `reasonCode` from readiness/reconcile | Grid start is blocked by the current BotVault reason. | inherited | inherited | inherited |
| `grid_exchange_not_allowed` | Grid venue is not enabled for this environment/account. | no | no | yes |
| `grid_paper_symbol_not_clean`, `grid_paper_symbol_conflict` | Paper venue has foreign positions/orders for a fresh or resumed start. | no | no | yes |

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
| `bot_vault_v4_funding_intent_timeout` with `flowEvent=funding_timed_out` and `reasonCode=bot_vault_v4_funding_timed_out` | A pending funding intent exceeded the timeout and moved to recovery-required tracking. |
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

## Historical Names Still Present

- `BotVaultV3...` service, lifecycle, and test names remain compatibility names
  for the current v4 production path. New product-facing docs should use
  BotVault v4 or neutral BotVault wording.
- v4 readiness and funding reasons should now use `bot_vault_v4_*` prefixes.
  Historical `bot_vault_v3_*` readiness reasons remain readable for existing
  rows and logs.
- New v4 funding action metadata uses `fund_bot_vault_v4` and
  `bot_vault_v4_funding:*`; readers still accept `fund_bot_vault_v3` and old
  action keys for compatibility.
- Funding-timeout events are emitted with the active runtime model. v4 rows use
  `bot_vault_v4_funding_intent_timeout:*`; existing v3 timeout details remain
  accepted as legacy evidence.
