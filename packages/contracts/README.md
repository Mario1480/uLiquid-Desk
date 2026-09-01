# @mm/contracts

Foundry workspace for the current onchain BotVault contracts.

## ULIQ testnet MVP

- Source: `src/uliq/legacy-testnet/`
- Tests: `test/uliq/legacy-testnet/`
- Deployment scripts: `script/uliq/legacy-testnet/`
- Compiler: Solidity `0.8.30`
- EVM target: `paris`
- OpenZeppelin Contracts: exact `5.4.0`
- Network guard: deployment scripts accept only local chain `31337` or Arbitrum Sepolia `421614`
- `ULIQTestnetEscrow` is a provisional test-only custody adapter with purchase-bound refund-or-release settlement and a two-step treasury rotation. It is not a production safeguarding decision.

## ULIQ two-round contract review draft

ADR-009 adds an isolated review package under `src/uliq/presale-v2/` without changing the deployed testnet MVP. The shared token is under `src/uliq/shared/`:

- `ULIQPresaleRound.sol`: one generic non-upgradeable implementation for both accepted rounds.
- `ULIQPresaleRoundVesting.sol`: one isolated listing-based release pool per round.
- `ULIQGlobalListing.sol`: one shared, one-time listing timestamp gated by both rounds.
- `ULIQPaymentCustody.sol`: one purchase-bound USDC custody candidate per round; use remains blocked by Legal approval and an independent audit.
- `ULIQPresaleRounds.t.sol`: exact parameter, lifecycle, buyer-limit, listing, and vesting tests.
- `ULIQPresaleRounds.invariant.t.sol`: cap, wallet-limit, inventory, pending-allocation, and custody invariants.

The review constants are Round 1: 50,000,000 ULIQ at 0.002 USDC, 100,000 USDC hard cap, 500/10,000 USDC buyer limits, 5% at listing, 90-day cliff, then 548-day linear vesting. Round 2: 100,000,000 ULIQ at 0.0035 USDC, 350,000 USDC hard cap, 100/5,000 USDC buyer limits, 25% at listing, then 274-day linear vesting.

The implementation keeps unsold inventory in each round and includes no Mainnet deployment script. The proposed onchain custody model, ADR-001 legal/access/cancellation decisions, exact calendar interpretation, Safe addresses, audit, and unsold-token recovery remain explicit blockers. The code and passing tests must not be described as audited or Mainnet-ready.

The exact external-review handoff, exclusions, trust assumptions, and open blockers are documented in [`ULIQ_PRESALE_V2_AUDIT_SCOPE.md`](./ULIQ_PRESALE_V2_AUDIT_SCOPE.md).

Run only the new review suite with `npm -w @mm/contracts run test:uliq:presale-v2`, only the previous MVP suite with `npm -w @mm/contracts run test:uliq:legacy-testnet`, or both with `npm -w @mm/contracts run test:uliq`. Deployment and configuration are intentionally separate stages so addresses and ownership can be reconciled before inventory funding. No Mainnet script is provided for ULIQ while ADR-001 is blocked.

### Arbitrum Sepolia deployment preflight

Required non-secret inputs:

- `ULIQ_ADMIN_ADDRESS`: testnet Safe or admin EOA; verify it independently before broadcast. Automated configuration is only possible when the configured deployer key controls this address.
- `ULIQ_TREASURY_ADDRESS`: dedicated testnet receiving wallet or Safe. It must be non-zero and is independently rotatable through owner proposal plus acceptance by the new treasury.
- `ULIQ_TEST_USDC_ADDRESS`: 6-decimal test token, or the zero address to deploy `ULIQMockUSDC`.
- `ULIQ_SALE_START`, `ULIQ_SALE_END`: Unix timestamps with `saleEnd > saleStart`.
- `ULIQ_WITHDRAWAL_PERIOD_SECONDS`: explicit testnet value with a deployment-enforced minimum of `3600`; use `3600` for the next staging deployment. The production specification remains 14 days.

Required secret/provider inputs must come from a local secret manager or protected CI environment, never from a committed env file:

- `ARBITRUM_SEPOLIA_RPC_URL`
- `ULIQ_TESTNET_DEPLOYER_PRIVATE_KEY`: funded testnet deployer; for automated configuration it must also control an admin EOA.
- `ETHERSCAN_API_KEY` when source verification is enabled

Run the non-broadcast simulation first:

```bash
npm -w packages/contracts run deploy:uliq:testnet:dry-run
```

After checking chain ID, admin, USDC, timestamps, deployer funding and simulated addresses, broadcast and request source verification:

```bash
FORGE_BROADCAST_ARGS=--verify npm -w packages/contracts run deploy:uliq:testnet
```

Record the emitted addresses, then supply `ULIQ_TOKEN_ADDRESS`, `ULIQ_PRESALE_ADDRESS`, `ULIQ_VESTING_ADDRESS`, `ULIQ_LOCKER_ADDRESS`, `ULIQ_PAYMENT_CUSTODY_ADDRESS` and `ULIQ_USDC_ADDRESS`. Simulate `configure:uliq:testnet:dry-run`, verify ownership/wiring/inventory/treasury and the custody accounting identity, and only then run `configure:uliq:testnet` when the admin is an EOA controlled by the dedicated testnet key.

When `ULIQ_ADMIN_ADDRESS` is a Safe, do not provide or invent a private key for it. Instead, prepare and approve the equivalent Safe batch for `vesting.setPresale(presale)`, `custody.setPresale(presale)`, `token.transfer(presale, 120_000_000 ether)` and `presale.markReady()`. Verify the testnet Safe owners and threshold (at least 2) independently before execution. Finally copy the canonical deployment block and verified addresses into the server-side ULIQ runtime configuration. Local Anvil addresses are never valid Sepolia evidence.

## Current Contract Set

- `BotVaultFactoryV4.sol`
- `BotVaultV4.sol`
- `HyperCoreActionEncoder.sol`
- `MockUSDC.sol`

Old MasterVault, BotVault V1/V2, and BotVault V3 contract sources have been removed from this workspace. Backend/database compatibility code may still use legacy names internally, but new onchain deployments use BotVaultV4 only.

## Commands

```bash
npm -w packages/contracts run build
npm -w packages/contracts run test
npm -w packages/contracts run fmt
```

## Deploy BotVaultV4

Local Anvil:

```bash
npm -w packages/contracts run deploy:local
```

Devnet / HyperEVM:

```bash
RPC_URL=...
PRIVATE_KEY=...
USDC_ADDRESS=...
DEPLOY_OWNER=0x...
FORGE_BROADCAST_ARGS=--legacy
npm -w packages/contracts run deploy:devnet
```

Explicit V4 aliases are also available:

```bash
npm -w packages/contracts run deploy:botvaultv4:local
npm -w packages/contracts run deploy:botvaultv4:devnet
```
