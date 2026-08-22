# @mm/contracts

Foundry workspace for the current onchain BotVault contracts.

## ULIQ testnet MVP

- Compiler: Solidity `0.8.30`
- EVM target: `paris`
- OpenZeppelin Contracts: exact `5.4.0`
- Network guard: deployment scripts accept only local chain `31337` or Arbitrum Sepolia `421614`
- `ULIQTestnetEscrow` is a provisional test-only custody adapter and has no treasury release path.

Run the focused suite with `npm -w @mm/contracts run test:uliq`. Deployment and configuration are intentionally separate stages so addresses and ownership can be reconciled before inventory funding. No mainnet script is provided for ULIQ while ADR-001 is blocked.

### Arbitrum Sepolia deployment preflight

Required non-secret inputs:

- `ULIQ_ADMIN_ADDRESS`: testnet Safe/admin address; verify it independently before broadcast.
- `ULIQ_TEST_USDC_ADDRESS`: 6-decimal test token, or the zero address to deploy `ULIQMockUSDC`.
- `ULIQ_SALE_START`, `ULIQ_SALE_END`: Unix timestamps with `saleEnd > saleStart`.
- `ULIQ_WITHDRAWAL_PERIOD_SECONDS`: explicit testnet value; the production specification remains 14 days.

Required secret/provider inputs must come from a local secret manager or protected CI environment, never from a committed env file:

- `ARBITRUM_SEPOLIA_RPC_URL`
- `ULIQ_TESTNET_DEPLOYER_PRIVATE_KEY`
- `ETHERSCAN_API_KEY` when source verification is enabled

Run the non-broadcast simulation first:

```bash
npm -w packages/contracts run deploy:uliq:testnet:dry-run
```

After checking chain ID, admin, USDC, timestamps, deployer funding and simulated addresses, broadcast and request source verification:

```bash
FORGE_BROADCAST_ARGS=--verify npm -w packages/contracts run deploy:uliq:testnet
```

Record the emitted addresses, then supply `ULIQ_TOKEN_ADDRESS`, `ULIQ_PRESALE_ADDRESS`, `ULIQ_VESTING_ADDRESS` and `ULIQ_PAYMENT_CUSTODY_ADDRESS`. Simulate `configure:uliq:testnet:dry-run`, verify ownership/wiring/inventory, and only then run `configure:uliq:testnet`. Finally copy the canonical deployment block and verified addresses into the server-side ULIQ runtime configuration. Local Anvil addresses are never valid Sepolia evidence.

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
