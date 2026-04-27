# BotVaultV4 Rollout

BotVaultV4 is the current onchain BotVault implementation. New onchain deployments should only use `BotVaultFactoryV4` and `BotVaultV4`.

## Current Rule

- New Grid BotVaults use `BotVaultV4`.
- The old MasterVault onchain cash-flow is removed from the contracts workspace.
- BotVault V1/V2/V3 Solidity sources and deploy targets are removed from the contracts workspace.
- Backend/database fields may still contain legacy names for compatibility with existing rows and indexer code.

## Deploy

```bash
cd /opt/uliquid-desk
./scripts/deploy_contracts_vps.sh --mode devnet --target botvaultv4 --env-file .env.prod
```

Direct workspace command:

```bash
npm -w packages/contracts run deploy:botvaultv4:devnet
```

## Required Production ENV

```env
BOT_VAULT_ONCHAIN_CONTRACT_VERSION=v4
BOT_VAULT_V4_FACTORY_ADDRESS=0x...
BOT_VAULT_V3_CONTROLLER_ADDRESS=0x...
```

`BOT_VAULT_V3_CONTROLLER_ADDRESS` is still the existing controller wallet env key. It is not a contract-version selector.

## Validation

After deployment verify:

- `BotVaultFactoryV4.usdc()` matches HyperEVM USDC.
- `BotVaultFactoryV4.coreDepositWallet()` matches the Hyperliquid core deposit wallet.
- `BotVaultFactoryV4.treasuryRecipient()` matches the configured treasury.
- `BotVaultFactoryV4.owner()` matches the intended ops owner.

For a newly created BotVault verify:

- `executionMetadata.onchainContractVersion` is `v4`.
- the create action metadata contains `contractVersion: "v4"`.
- the vault address is returned by `BotVaultFactoryV4.vaultOfBot(botId)`.
- the vault stores its locked fee policy via `platformFeeRatePct()`, `affiliateFeeRatePct()`, and `profitShareFeeRatePct()`.

## Operational Smoke Test

1. Create a new Grid Bot.
2. Fund the BotVault.
3. Move USDC from HyperEVM to HyperCore.
4. Transfer margin to Perps.
5. Run a small execution cycle.
6. Claim profit or close the BotVault.
7. Confirm fee events and affiliate accruals match the locked V4 fee policy.

## Rollback Scope

There is no supported rollback to older onchain contract variants from this workspace. If a deployment is bad, stop creating new BotVaults, fix the V4 deployment/configuration, and redeploy BotVaultV4.
