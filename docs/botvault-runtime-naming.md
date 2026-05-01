# BotVault Runtime Naming

BotVault v4 is the current production path. Some backend names still contain
`v3` because they are compatibility identifiers, persisted data keys, or older
implementation entry points. This note documents the migration line so new v4
work does not keep spreading those names.

## Audit

- `botVaultV3.service.ts` and `botVaultV3.lifecycle.ts` still contain much of
  the current v4 funding, reserve, margin, reconcile, readiness, and recovery
  behavior. They are compatibility implementation files, not an indication that
  the product path is still v3.
- `bot_vault_v4` is the canonical runtime model for new v4 BotVault rows,
  action metadata, readiness reasons, reconciliation metadata, and grid
  payloads.
- Historical rows may still persist `bot_vault_v3` while carrying
  `executionMetadata.onchainContractVersion = "v4"`. Runtime code must treat
  those rows as v4 via the central resolver until a deliberate data backfill
  exists.
- `BotVaultV3...` service and lifecycle exports remain for tests, older helper
  modules, persisted reason codes, and action names. New runtime code should not
  import those names directly.
- Central capital-flow methods and result types still originate in the
  compatibility service: `fundBotVault`, `claimProfit`, `finalizeMarginAdd`,
  `reduceMargin`, `controllerCloseBotVault`,
  `controllerRecoverClosedBotVault`, and result types such as
  `BotVaultV3ReduceMarginResult`. These are v4 production paths when the row's
  runtime contract version is v4.
- v4-specific status and reason codes already use explicit `bot_vault_v4_*`
  names where the behavior is truly v4-only, especially reserve, mismatch, and
  verification states.
- Grid runtime entry points now resolve the BotVault service through
  `botVaultRuntimeService`; `botVaultV3Service` is only the compatibility
  fallback.

## Current Migration Step

New central call sites should import one of the facade layers instead of
reaching into `botVaultV3.*` directly:

- `apps/api/src/vaults/botVaultRuntime.service.ts`
- `apps/api/src/vaults/botVaultRuntime.lifecycle.ts`
- `apps/api/src/vaults/botVaultV4.service.ts`
- `apps/api/src/vaults/botVaultV4.lifecycle.ts`

The runtime facade re-exports the existing implementation and adds neutral
names such as `BotVaultRuntimeService`, `createBotVaultRuntimeService`,
`reconcileBotVaultById`, `BotVaultExecutionReadiness`,
`evaluateBotVaultExecutionReadiness`, `BotVaultFundingLifecycleStage`, and
`classifyBotVaultRuntimeMismatch`.

The runtime facade also provides neutral capital-flow wrappers for current
product call sites: `fundBotVaultForRuntime`, `claimBotVaultProfit`,
`finalizeBotVaultMarginAdd`, `reduceBotVaultMargin`,
`closeBotVaultOnchain`, and `recoverBotVaultClosedFunds`. These helpers prefer
runtime aliases and fall back to legacy service methods, so route and grid code
does not need to mention implementation-era method names directly.

The v4 facade adds product-explicit names such as `createBotVaultV4Service`,
`BotVaultV4RuntimeService`, `reconcileBotVaultV4ById`,
`evaluateBotVaultV4ExecutionReadiness`,
`createBotVaultV4FundingLifecycleMetadata`, `fundBotVaultV4`,
`finalizeBotVaultV4MarginAdd`, and `reduceBotVaultV4Margin`. These are aliases
over the runtime facade and intentionally do not change persisted keys.

The app bootstrap, route registration, grid lifecycle, grid instance routes,
and bot/grid/vault mappers now accept or resolve `botVaultRuntimeService`
first. The old `botVaultV3Service` dependency remains as a deprecated
compatibility fallback for existing callers.

Runtime model detection is centralized in
`packages/core/src/botVaultRuntimeModel.ts`. Use
`resolveBotVaultRuntimeModel()`, `isBotVaultRuntimeModelRow()`,
`botVaultRuntimeActionType()`, and `botVaultRuntimeReasonCode()` instead of
local string comparisons. The resolver intentionally upgrades legacy
`bot_vault_v3` rows to `bot_vault_v4` when the row or metadata says the
onchain contract version is v4.

Grid start blockers, onchain action metadata, indexer/reconcile metadata, and
UI gates now derive v3/v4 names from that helper. Existing v3 codes remain
accepted for historical rows and logs; new v4 runtime flows should emit
`bot_vault_v4_*`, `create_bot_vault_v4`, and `fund_bot_vault_v4` where the
flow is runtime-model specific.

## Rename Rules

Rename now:

- Runtime model checks: use `resolveBotVaultRuntimeModel()` or
  `isBotVaultRuntimeModelRow()`.
- Runtime action/reason creation: use `botVaultRuntimeActionType()` and
  `botVaultRuntimeReasonCode()`.
- New product-level imports: use `botVaultV4.service.ts` and
  `botVaultV4.lifecycle.ts` when v4 specificity matters.
- New service injection names: use `botVaultRuntimeService`.
- New service types: use `BotVaultRuntimeService`.
- New generic helpers: use `reconcileBotVaultById`,
  `evaluateBotVaultExecutionReadiness`, and `readBotVaultReconciliation`.
- New funding and settlement call sites: use `fundBotVaultForRuntime`,
  `claimBotVaultProfit`, `finalizeBotVaultMarginAdd`,
  `reduceBotVaultMargin`, `closeBotVaultOnchain`, and
  `recoverBotVaultClosedFunds`.
- New lifecycle/mismatch helpers: use `BotVaultFundingLifecycle...` and
  `BotVaultRuntimeMismatch...`.
- New v4-specific helpers: use `BotVaultV4FundingLifecycle...`,
  `reconcileBotVaultV4ById`, `fundBotVaultV4`,
  `finalizeBotVaultV4MarginAdd`, `reduceBotVaultV4Margin`, and
  `evaluateBotVaultV4ExecutionReadiness`.

Keep for now:

- Persisted historical model strings such as `bot_vault_v3`; the resolver maps
  v4 contract metadata to `bot_vault_v4` for runtime behavior.
- Stored compatibility keys such as `botVaultV3Reconciliation`. New reconcile
  writes should also maintain neutral `botVaultRuntimeReconciliation`, and v4
  rows may include `botVaultV4Reconciliation` for analytics/debugging.
- Historical runtime method names on the compatibility implementation service
  such as `finalizeMarginAdd`, `reduceMargin`, `controllerCloseBotVault`, and
  `controllerRecoverClosedBotVault`. Keep them until direct service consumers
  have moved behind the runtime/v4 facade.
- Historical onchain action names and error codes that external logs, rows, or
  scripts may already reference. Runtime-specific create/fund actions should
  use the v4 names for v4 rows while still reading old v3 names.
- The implementation files `botVaultV3.service.ts` and
  `botVaultV3.lifecycle.ts` until remaining direct imports have been reduced.
- Onchain ABI names such as `botVaultV3Abi` where the Solidity contract ABI
  family or historical action envelope is still named that way.

## Next Steps

1. Move additional internal helpers and tests to the runtime facade when they
   are touched for functional work.
2. Once direct imports are low, rename the implementation files behind the
   facade and keep thin compatibility re-export files with the old names.
3. Backfill historical v4 rows from persisted `bot_vault_v3` to
   `bot_vault_v4` only as a versioned data/API migration. The backfill should
   preserve old action keys and retain compatibility reads for
   `botVaultV3Reconciliation`.
