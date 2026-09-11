# BotVaultV4 Architecture

This document describes the current onchain vault architecture.

## Current Model

BotVaultV4 is the active onchain model. Each launched Grid Bot gets its own BotVaultV4 contract and its own execution agent wallet. There is no active onchain MasterVault cash-flow in the current contract workspace.

## User Flow

1. User connects and links a wallet.
2. User creates or uses a managed agent wallet.
3. User launches a Grid Bot.
4. API creates a dedicated BotVaultV4 through `BotVaultFactoryV4`.
5. User funds the BotVault directly.
6. BotVault funds move through HyperEVM, HyperCore, and Perps according to the funding lifecycle.
7. Runner executes the bot through the configured agent wallet.
8. Profit claim or close settles funds and fees through the BotVaultV4 fee policy.

## Onchain Contracts

- `BotVaultFactoryV4`
  - creates one BotVaultV4 per bot id.
  - stores `vaultOfBot`.
  - owns treasury and core deposit wallet configuration.

- `BotVaultV4`
  - holds the bot-specific USDC balance.
  - stores beneficiary, controller, agent wallet, template id, and bot id.
  - locks the platform and affiliate fee rates at creation time.
  - exposes funding, HyperCore action, claim, close, and recovery operations.

## Offchain Services

- `apps/web`
  - wallet connection, agent wallet funding, BotVault actions, and funding UI.

- `apps/api`
  - BotVault lifecycle, funding state, controller transactions, onchain indexer, fee accounting, and affiliate profit-share accruals.

- `apps/runner`
  - bot execution, agent wallet secret resolution, order placement, and reconciliation with Hyperliquid.

## Naming Note

Some backend modules and database fields still contain `BotVaultV3` or `masterVault` names. Those are compatibility names from the rollout path and should not be used in new product copy or new contract docs. New onchain work should target BotVaultV4 only.

## Removed Contract Model

The old MasterVault plus BotVault V1/V2/V3 Solidity variants were removed from `packages/contracts`. Historical database rows and backend compatibility code can remain until a dedicated migration/rename removes those internal names safely.
