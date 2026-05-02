# BotVault v4 Transition Regressions

This note documents the focused, E2E-near regression coverage for the highest-risk BotVault v4 and Grid handoff transitions. The tests stay at service/route lifecycle boundaries and use mocked chain, HyperCore, adapter, and persistence layers so they can run quickly without a live venue.

For the compact E2E/integration acceptance matrix across funding, GridBot
release, profitshare, close, and restart reconciliation, see
`docs/botvault-e2e-integration-test-matrix.md`.

## Covered Scenarios

- Funding to `execution_ready`: `finalizeMarginAdd bootstraps a v4 HYPE reserve before marking execution ready` verifies deposit, perp transfer, HYPE reserve, funding lifecycle, HyperCore funding status, and final metadata.
- Funding timeout escalation: `reconcileBotVaultV3ById escalates stale pending funding intents into recovery_required` verifies stale v4 funding intents move to recovery tracking and mark the pending action failed.
- Funding with HYPE reserve problems: pending, retryable, user-action, and recovery-required HYPE reserve failures assert explicit status categories, mismatch categories, recovery actions, and non-ready lifecycle states.
- `reduceMargin` success plus reconcile success: `reduceMargin drains released v4 margin from HyperCore spot back to EVM` verifies perp release, spot-to-EVM drain, EVM balance reflection, `postReconcileState: applied`, and `execution_ready` status.
- `reduceMargin` success plus post-reconcile open: `reduceMargin marks v4 transfer verified but post-reconcile pending when reconcile persist fails` verifies the transfer remains confirmed while post-reconcile is retryable and tracked.
- `reduceMargin` success plus post-reconcile recovery: `reduceMargin marks v4 post-reconcile recovery required when reconcile finds counterevidence` verifies a completed transfer is blocked when reconcile finds content counterevidence.
- Close/Recover/Claim resume after post-processing failure: close and recover resume tests verify no duplicate tx/accounting after an applied persistence failure; claim resume verifies a failed fee-event step is replayed by reconcile without re-sending the claim.
- Grid start after vault reconcile: lifecycle tests cover v4 funding-pending readiness, reconcile failure (`vault_reconcile_required`), and reconcile success with readiness false (`vault_not_ready`), including persisted start blocker metadata.

## Focused Command

```bash
npm -w apps/api run test:botvault-v4-transitions
```

Use this with typecheck when touching service contracts or route payload shapes:

```bash
npm -w apps/api run typecheck
```

## Intentionally Not Full E2E

- Real Hyperliquid orderbook, CoreWriter, and liquidity behavior are mocked.
- Real HyperEVM receipt/reorg/quorum behavior is mocked.
- Multi-process races between user-triggered margin, reduce, close, recover, and claim calls are not exercised.
- Runner scheduling/backoff and UI wallet signing flows are outside this focused suite.
- Live venue smoke coverage should remain separate from these deterministic regression tests.
