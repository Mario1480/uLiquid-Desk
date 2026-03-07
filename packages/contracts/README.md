# @mm/contracts

Foundry workspace for onchain Vault contracts.

## Commands

```bash
npm -w packages/contracts run build
npm -w packages/contracts run test
npm -w packages/contracts run fmt
```

## Deploy

Local (Anvil):
```bash
npm -w packages/contracts run deploy:local
```

Devnet:
```bash
RPC_URL=...
PRIVATE_KEY=...
USDC_ADDRESS=...
DEPLOY_OWNER=0x...
npm -w packages/contracts run deploy:devnet
```

## Contracts (MVP)

- `MasterVaultFactory.sol`
- `MasterVault.sol`
- `BotVault.sol`
- `MockUSDC.sol`
