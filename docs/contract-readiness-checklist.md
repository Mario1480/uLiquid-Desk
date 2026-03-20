# Contract Readiness Checklist

This checklist is for rolling out the vault contracts with stronger operational discipline.

## Production Assumptions

- `MasterVault` ownership is immutable at deployment time. There is no proxy or upgrade path.
- `MasterVaultFactory` ownership is separate from each `MasterVault` owner.
- Factory owner controls only:
  - `treasuryRecipient`
  - `profitShareFeeRatePct`
- Vault owner controls operational vault actions:
  - deposits
  - withdrawals
  - bot vault creation
  - allocation
  - pause/unpause
  - close-only and close
- `createMasterVault` is currently permissionless for any target owner address. Production rollout therefore assumes the backend/UI treats vault creation as an owned workflow and does not rely on factory-level caller restrictions.
- The configured `USDC` address must be a deployed contract on the target network.
- Pause is an operational safety stop for risk-increasing bot actions. It does not block owner deposits or owner withdrawals.
- Profit-share fees depend on:
  - correct `treasuryRecipient`
  - correct `profitShareFeeRatePct`
  - correct high-water-mark continuity on `BotVault`

## Manual Ops Steps

Before broadcast:

- Confirm target chain ID and RPC URL.
- Confirm deployer private key and resulting deployer address.
- Confirm intended vault owner address.
- Confirm intended treasury recipient address.
- Confirm production USDC contract address on the target chain.
- Confirm expected fee rate policy for rollout.

After deployment:

- Verify `MasterVaultFactory.owner()` matches the intended ops owner.
- Verify `MasterVaultFactory.usdc()` matches the intended USDC contract.
- Verify `MasterVaultFactory.treasuryRecipient()` matches the intended treasury wallet.
- Verify `MasterVaultFactory.profitShareFeeRatePct()` matches the approved fee policy.
- Verify `MasterVaultFactory.masterVaultOf(owner)` resolves to the deployed vault.
- Verify `MasterVault.owner()`, `MasterVault.usdc()`, and `MasterVault.factory()` are wired correctly.

Before first real capital:

- Run the Foundry suite against the exact contract revision being deployed.
- Perform one dry-run deposit/withdraw on devnet or staging.
- Exercise pause/unpause and a close-only path in a staging environment.
- Validate fee settlement to treasury with a controlled profit scenario.
- Confirm monitoring/indexing can read:
  - vault balances
  - bot-vault lifecycle events
  - treasury fee events

During incident response:

- Use `pause()` to stop new bot-vault provisioning and allocation.
- If needed, keep using owner withdrawals and owner recapitalization while paused.
- Move active bot vaults to close-only before final close.
- Reconcile `freeBalance`, `reservedBalance`, and treasury fee receipts before resuming.

## Tests Added In This Pass

- Deploy script assumptions:
  - local deploy wires owner, vault, and mock USDC correctly
  - devnet deploy rejects zero USDC
  - devnet deploy rejects non-contract USDC
  - devnet deploy uses provided USDC without mock minting
- Ownership separation:
  - factory owner cannot operate a vault owned by another address
- Emergency behavior:
  - owner can still deposit and withdraw while paused
  - pause/unpause remains owner-controlled and duplicate transitions are guarded

## Audit-Recommended Follow-ups

- Review whether `createMasterVault` should remain permissionless or become self-service/permissioned.
- Add a formal emergency rescue policy for accidentally transferred non-USDC assets if that operational scenario matters.
- Add invariant/fuzz testing for:
  - `freeBalance + reservedBalance` accounting
  - `principalAllocated` / `principalReturned`
  - high-water-mark monotonicity under arbitrary settlement sequences
- Review whether factory-controlled fee recipient and fee-rate changes need timelock or dual-control protections before production scale.
- Consider event/indexing tests that assert exact emitted values for treasury fee and release flows.
- Consider external audit review of close-only and settlement flows before broad rollout.
