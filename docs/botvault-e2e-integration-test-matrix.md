# BotVault E2E And Integration Test Matrix

This matrix covers the BotVault funding, GridBot release, and profitshare flows
that must stay stable for BotVault v4. Deterministic coverage stays at API,
service, adapter, and contract boundaries with mocked chain/HyperCore state.
Live wallet, HyperEVM, and HyperCore propagation are covered as an integration
spec because timing and receipt finality depend on external systems.

## Regression Commands

Run the focused BotVault/Grid suite before BotVault funding, claim, close,
reconcile, or Grid start changes:

```bash
npm -w apps/api run test:botvault-grid-smoke
npm -w apps/api run test:botvault-v4-transitions
npm -w apps/api run test:vault-grid-corewriter
npm -w apps/api run test:vaults
npm -w apps/runner run test:vault-grid-corewriter
npm -w packages/futures-exchange run test:vault-grid-corewriter
npm -w packages/contracts run test
```

Use the wider vault suite when fee settlement, PnL, ledger, or routes change:

```bash
npm -w apps/api run test:vaults
```

## Matrix

| ID | Scenario | Required level | Existing automated coverage | Integration setup and assertions |
| --- | --- | --- | --- | --- |
| BV-E2E-01 | User funded Vault on HyperEVM -> deposit to HyperCore -> GridBot starts -> orders are placed. | API/service, adapter, contract; live spec for full E2E. | `finalizeMarginAdd bootstraps a v4 HYPE reserve before marking execution ready`; `startGridInstanceNow starts after BotVault v3 reconcile returns execution-ready state`; Hyperliquid CoreWriter order tests; `BotVaultFactoryV4.t.sol` activation and action forwarding tests. | Create BotVault v4, fund USDC on HyperEVM, finalize HyperCore/perp funding, start GridBot. Assert `fundingLifecycle.stage=execution_ready`, `hypercoreFundingStatus=funded`, Grid instance and bot are `running`, and at least one venue/CoreWriter order reference is persisted. |
| BV-E2E-02 | Core empty, EVM funded -> deposit still works. | Adapter/service. | `adapter depositUsdcToHyperCore submits requested amount when core spot is empty and evm usdc is funded`; deposit confirmation reconciliation tests. | Seed Core USDC as `0`, EVM USDC above request. Submit deposit. Assert deposit tx is submitted for the requested amount and Core-balance visibility, not pre-existing Core balance, drives final confirmation. |
| BV-E2E-03 | EVM empty -> deposit blocks cleanly. | Adapter plus API/service error contract. | `adapter depositUsdcToHyperCore returns insufficient_evm_usdc when vault evm usdc is too low`. | Seed EVM USDC below request and Core USDC as `0`. Assert no deposit tx is submitted and API/service returns `reasonCode=insufficient_evm_usdc`, `recoveryHint=request_user_action`. |
| BV-E2E-04 | HyperCore -> HyperEVM withdraw delayed -> claim remains pending. | API/service. | `claimProfit blocks on insufficient contract balance until EVM transfer reconciliation succeeds`; route mapping for pending reconciliation; reduce-margin pending/post-reconcile tests. | Drain HyperCore spot to EVM but keep EVM balance stale. Attempt claim. Assert no claim tx is sent, `contractBalanceReconciliation.state=pending_reconciliation`, `reasonCode=insufficient_contract_balance`, `recoveryHint=retry_reconcile`. After EVM balance appears, retry claim and assert the pending state clears. |
| BV-E2E-05 | Profit entsteht -> profitshare is calculated once correctly. | Contract and service/math. | `testClaimProfitUsesVaultSpecificFeePolicy`; `testClaimProfitSplitsTreasuryAffiliateAndBeneficiary`; `apps/api/src/vaults/feeSettlement.*.test.ts`; `apps/api/src/vaults/profitShare.test.ts`. | Seed positive realized PnL and configured platform/affiliate split. Claim once. Assert user net payout plus platform and affiliate fees equal gross claim, and `feePaidTotal`/ledger entries match the locked fee policy. |
| BV-E2E-06 | Partial claim -> later partial claim -> no duplicate fee. | Contract and service/reconcile. | `testProfitShareSupportsMultiplePartialClaims`; `testProfitShareCannotDoubleChargeSameRealizedClosedPnl`; claim fee-event resume/idempotency tests. | Claim part of the available profit, then claim another part without increasing realized PnL beyond the same HWM capacity. Assert only newly claimed profit is charged and duplicate fee-event source keys are ignored/idempotent. |
| BV-E2E-07 | Loss after profit -> HWM/realized PnL stays correct. | Contract and service/math. | `testProfitShareLossReducesFutureFeeCapacity`; `testNetLossPaysNoProfitShare`; `apps/api/src/vaults/realizedPnl.test.ts`. | Claim profit, ingest a realized loss, then ingest later profit. Assert HWM only advances on net new profit above prior HWM, realized PnL reflects the loss, and no fee is taken while below HWM. |
| BV-E2E-08 | Bot close -> final user payout plus platform/affiliate fee is correct. | Contract and API/service. | `testCloseOnlyChargesOnlyUnsettledProfitAfterPriorClaim`; controller close settlement resume tests; close pending-reconciliation route mapping. | Put bot into close-only, flatten execution exposure, close the vault. Assert final principal return, user payout, platform fee, affiliate fee, `principalReturned`, `feePaidTotal`, `executionStatus=closed`, and no duplicate settlement on retry. |
| BV-E2E-09 | Vault activation fails -> GridBot does not become running. | API/service. | `startGridInstanceNow keeps grid out of running when BotVault activation fails`; route error payload mapping. | Force `activateBotVaultForGridInstance` to fail after readiness succeeds. Assert grid and bot are not `running`, blocker is persisted with `reasonCode=grid_instance_vault_activation_failed`, `recoveryHint=retry_reconcile`. |
| BV-E2E-10 | Reconcile after process restart continues the flow. | API/service/job. | Funding timeout escalation; reduce-margin resume without duplicate transfer; claim/close/recover settlement resume after post-processing failure; `reconcileBotVaultV3ById` fee-event resume tests. | Start funding/withdraw/claim/close, stop after submitted or post-processing-pending metadata is persisted, recreate service/job process, run reconcile. Assert existing tx/action keys are reused, no duplicate transfer/claim/close tx is sent, and flow advances to confirmed or the documented pending/recovery state. |
| BV-E2E-11 | Deterministic GridBot funding smoke: EVM funded -> Deposit pending -> Reconcile confirmed -> Grid start allowed -> Withdraw pending -> Claim blocked -> Claim after reconcile. | API/service/job smoke. | `npm -w apps/api run test:botvault-grid-smoke`; pending runtime reconciliation job test; reduce-margin pending EVM-balance reconcile test. | Assert pending deposit returns `deposit_pending_reconciliation` and readiness false, confirmed funding returns `funding_confirmed` and readiness true, pending withdraw returns `withdraw_pending_reconciliation`, and the final reconciled state has no pending runtime reconcile signal. |
| BV-E2E-12 | Funding pending GridBot does not count as order-active running. | Runner/API/UI. | Runner `funding_pending` state tests; API pause/resume route coverage; Web typecheck. | Force Core deposit or perp-transfer pending. Assert GridBot instance state is `funding_pending`, runner continues reconciliation ticks, no orders are placed, UI running count excludes it, and pause remains available. |
| BV-E2E-13 | Stale Trading-Reconciliation blocks settlement. | API/service. | Profitshare freshness tests and close/claim/recover guards. | Set `BotVaultPnlAggregate.lastReconciledAt` older than `BOTVAULT_TRADING_RECONCILIATION_FRESHNESS_SECONDS` or `isFlat=false`. Assert claim/close/recover reject before serialized onchain tx creation. |
| BV-E2E-14 | Money-flow PlatformAlerts open and resolve. | API/job/admin. | Reconciliation job alert tests; Admin Vault-Ops response shape. | Hold deposit/withdraw/contract-balance pending beyond 10m. Assert one deduped PlatformAlert opens with reason, recovery, tx/idempotency, expected/actual balances, and resolves after reconciliation becomes clean. |

## Failure Contract

Every negative or delayed path in this matrix must expose a machine-readable
`reasonCode` and an actionable `recoveryHint` in the API/service response and in
the persisted blocker or flow metadata where applicable.

| Failure path | reasonCode | recoveryHint | Persistence requirement |
| --- | --- | --- | --- |
| EVM USDC below requested deposit amount | `insufficient_evm_usdc` | `request_user_action` | Funding action remains unsubmitted; no HyperCore tx hash. |
| Funding request not yet confirmed on HyperEVM | `bot_vault_v4_funding_requested_not_confirmed` | `retry_reconcile` | Grid start blocker records pending status and readiness remains false. |
| HyperCore/perp margin not yet verified | `bot_vault_v4_perp_margin_not_verified` | `retry_reconcile` | Grid start blocker records retryable status. |
| HyperCore state contradicts local funding lifecycle | `funding_lifecycle_hypercore_counterevidence` | `run_recovery` | Reconcile issue persists recovery-required status. |
| Claim/close/recover contract balance not yet visible on HyperEVM | `insufficient_contract_balance` | `retry_reconcile` | `contractBalanceReconciliation.state=pending_reconciliation`. |
| Settlement PnL reconciliation stale or not flat | `claim_profit_unavailable:pnl_not_finalized:reconciliation_stale` / `open_positions` | run trading reconciliation first | No claim/close/recover tx is created. |
| Grid funding still reconciling | `grid_initial_core_spot_funding_pending` / `grid_initial_perp_funding_pending` | `retry_reconcile` | `GridBotInstance.state=funding_pending`; runner remains eligible but order placement is blocked. |
| Reduce-margin post-transfer reconcile failed | `bot_vault_v3_reduce_margin_post_reconcile_failed` | `retry_reconcile` | `reduceMarginFinalization.postReconcileState=pending`. |
| Reduce-margin post-transfer reconcile found counterevidence | `funding_lifecycle_perp_margin_counterevidence` | `run_recovery` | `reduceMarginFinalization.postReconcileState=recovery_required`. |
| Vault activation fails during Grid start | `grid_instance_vault_activation_failed` | `retry_reconcile` | Grid/bot state remains non-running; start blocker is persisted. |
| Grid start cannot complete BotVault reconcile | `grid_instance_vault_reconcile_required` | `retry_reconcile` | Grid/bot state remains non-running; start blocker is persisted. |

## Release Gate

For BotVault/Grid changes to pass this matrix:

- all focused regression commands above pass,
- each changed critical flow has at least one API/service-level assertion,
- every failure row returns both `reasonCode` and `recoveryHint`,
- live integration runs may remain manual, but their setup, stimulus, and
  assertions must match the scenario rows above.
