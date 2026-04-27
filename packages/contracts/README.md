# @mm/contracts

Foundry workspace for the current onchain BotVault contracts.

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
