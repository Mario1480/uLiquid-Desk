# BotVault Capital State Machine

BotVault capital movements expose one canonical API state through
`BotVaultV3Summary.operationState`. The implementation still persists detailed
flow metadata in `executionMetadata`, but UI and API callers should read this
summary field first. When detailed step metadata is missing, the summary falls
back to `fundingLifecycle`, `fundingStatus`, and `hypercoreFundingStatus` so
interrupted or older rows still expose the next capital step.

## Canonical States

| State | Meaning | Retry behavior |
| --- | --- | --- |
| `pending` | Intent exists, but no irreversible transfer was submitted. | Submit or continue the next step. |
| `submitted` | A transfer/tx was submitted or requested. | Wait and reconcile before retrying. |
| `confirmed` | The expected venue/onchain state is visible and local accounting is applied or complete. | No action. |
| `pending_reconciliation` | A tx/transfer probably succeeded, but the expected balance/accounting proof is not visible or local post-processing is incomplete. | Reconcile/resume only; do not submit a duplicate transfer. |
| `failed_retryable` | The step failed or timed out without proof that a transfer landed. | Retry with a new idempotency/action key when the flow allows it. |
| `failed_final` | Normal retry is unsafe or requires user/operator intervention. | Run recovery or request user action. |

## Steps

| Step | Source fields | Success proof |
| --- | --- | --- |
| `hyper_evm_deposit` | `executionMetadata.fundingIntent`, `onchainAction` rows | BotVault funding tx confirmed onchain. |
| `hypercore_funding` | `executionMetadata.marginAddFinalization` and auto HyperCore funding metadata | Core/Perp margin and v4 HYPE reserve are visible. |
| `hypercore_withdraw` | `executionMetadata.reduceMarginFinalization` | Core decrease and, for v4, EVM USDC increase are visible, then post-reconcile applies. |
| `claim` | `executionMetadata.claimSettlement` and `contractBalanceReconciliation` | Claim tx confirmed and settlement post-processing completes. |
| `close` | `executionMetadata.closeSettlement` and `contractBalanceReconciliation` | Close tx confirmed and settlement post-processing completes. |
| `recover` | `executionMetadata.recoverySettlement` and `contractBalanceReconciliation` | Recovery tx confirmed and settlement post-processing completes. |

## Transition Rules

```text
pending -> submitted -> confirmed
pending -> failed_retryable -> pending
submitted -> pending_reconciliation -> confirmed
submitted -> failed_retryable -> submitted
pending_reconciliation -> confirmed
pending_reconciliation -> failed_final
failed_retryable -> pending
failed_final -> pending | confirmed
confirmed -> terminal for that step
```

The important invariant is that `submitted` and `pending_reconciliation` are
not safe places to send the same transfer again. Reconcile must first prove
whether the external balance changed.

## Idempotency Rules

- HyperEVM funding uses `bot_vault_v3_funding:<botVaultId>:<amount>` and
  appends `:retry:<n>` only after a retryable timeout/failure. Duplicate calls
  with the same pending amount reuse the existing action.
- HyperCore funding resume reads `marginAddFinalization` before submitting
  `transferUsdClass(toPerp=true)`. If the finalization exists, resume reads and
  reserve bootstrap only.
- HyperCore withdraw resume reads `reduceMarginFinalization` before submitting
  `transferUsdClass(toPerp=false)`. If the spot leg is already visible, v4 may
  resume only `transferUsdcSpotToEvm`.
- Claim/Close/Recover create settlement records before local post-processing.
  Reconcile resumes `resync`, `apply`, and `fee_event` steps from stored
  settlement state.
- Claim/Close/Recover also check the onchain vault USDC balance before the tx.
  Insufficient balance maps to `pending_reconciliation` with
  `reasonCode=insufficient_contract_balance`.

## Reconcile Resume Contract

Reconcile jobs may safely continue interrupted flows by inspecting
`operationState` plus the detailed metadata:

| Current state | Reconcile action |
| --- | --- |
| `pending` | Build or submit the next missing action if the caller owns that flow. |
| `submitted` | Read venue/onchain balances and update to `pending_reconciliation` or `confirmed`; do not duplicate the transfer. |
| `pending_reconciliation` | Retry reads and local post-processing only. |
| `failed_retryable` | Allow a retry path with a new retry key when configured. |
| `failed_final` | Stop automatic retries and surface recovery/user action. |
| `confirmed` | Leave the flow unchanged except for idempotent accounting completion. |

`nextRecommendedAction` in the API summary is the UI hint derived from the
canonical state: `submit`, `wait`, `retry`, `retry_reconcile`, `recover`,
`request_user_action`, or `none`.
