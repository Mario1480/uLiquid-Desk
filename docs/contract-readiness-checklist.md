# BotVaultV4 Contract Readiness Checklist

This checklist is for rolling out the current BotVaultV4 contracts.

Status note 2026-05-25: low-value production BotVault V4 lifecycle evidence now
exists for Wallet/User-funded start, close/settlement, and FundingVault-backed
launch. This reduces rollout risk for controlled internal canaries, but it does
not replace the broader contract-readiness items below for public scale.

## Production Assumptions

- `BotVaultFactoryV4` is the only supported deployment target.
- `BotVaultV4` contracts are created per bot id.
- The old MasterVault onchain cash-flow is not part of the current contracts workspace.
- Factory owner controls:
  - `treasuryRecipient`
  - ownership transfer
- Each BotVault stores its locked fee policy at creation time:
  - `platformFeeRatePct`
  - `affiliateFeeRatePct`
  - `profitShareFeeRatePct`
- The configured `USDC` address must be a deployed contract on the target network.
- The configured core deposit wallet must match Hyperliquid's expected HyperEVM deposit contract.

## Manual Ops Steps

Before broadcast:

- Confirm target chain ID and RPC URL.
- Confirm deployer private key and resulting deployer address.
- Confirm intended factory owner address.
- Confirm intended treasury recipient address.
- Confirm production USDC contract address on the target chain.
- Confirm core deposit wallet address.
- Confirm expected platform and affiliate fee policy in API configuration.

After deployment:

- Verify `BotVaultFactoryV4.owner()` matches the intended ops owner.
- Verify `BotVaultFactoryV4.usdc()` matches the intended USDC contract.
- Verify `BotVaultFactoryV4.coreDepositWallet()` matches the intended core deposit wallet.
- Verify `BotVaultFactoryV4.treasuryRecipient()` matches the intended treasury wallet.
- Create one test BotVault and verify `vaultOfBot(botId)` resolves to it.
- Verify the created BotVault's beneficiary, controller, agent wallet, and fee policy.

Before first real capital:

- Run the Foundry suite against the exact contract revision being deployed.
- Perform one low-value funding flow on devnet or staging. Low-value production
  evidence also exists for Wallet/User-funded and FundingVault-backed BotVault
  V4 starts.
- Exercise HyperEVM to HyperCore funding. Low-value production evidence exists
  for the BotVault/Grid path.
- Exercise close-only and close/recovery paths in staging. Low-value production
  close/settlement evidence exists for a Wallet/User-funded BotVault.
- Validate fee settlement to treasury and affiliate recipient with a controlled profit scenario.
- Confirm monitoring/indexing can read:
  - BotVault balances
  - BotVault lifecycle events
  - treasury and affiliate fee events

Live evidence references:

- `docs/archive/tasks/2026-05-21-botvaultv4-gridbot-live-monitoring.md`
- `docs/archive/tasks/2026-05-23-botvaultv4-gridbot-live-monitoring.md`
- `docs/archive/tasks/2026-05-25-funding-vault-live-start.md`

During incident response:

- Stop new BotVault creation first.
- Set affected bots to close-only before final close.
- Reconcile BotVault balances, positions, and fee receipts before resuming.
- Avoid manual DB corrections without an audit trail.

## Audit-Recommended Follow-ups

- Add invariant/fuzz testing for:
  - principal accounting
  - fee split correctness
  - close/recovery settlement monotonicity
- Review whether factory ownership changes need timelock or dual-control protections before production scale.
- Add event/indexing tests that assert exact emitted values for fee and release flows.
- Consider external audit review of close-only and settlement flows before broad rollout.
