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
- `bot_vault_v3` is still a persisted vault model and appears in rows, action
  metadata, route payloads, and regression tests. It must remain stable until a
  deliberate data/API migration exists.
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

Grid start blocker messages now use neutral BotVault wording. Existing error
codes remain stable where clients or persisted rows may already depend on them.

## Rename Rules

Rename now:

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

- Persisted model strings such as `bot_vault_v3`.
- Stored compatibility keys such as `botVaultV3Reconciliation`.
- Historical runtime method names on the compatibility implementation service
  such as `finalizeMarginAdd`, `reduceMargin`, `controllerCloseBotVault`, and
  `controllerRecoverClosedBotVault`. Keep them until direct service consumers
  have moved behind the runtime/v4 facade.
- Onchain action names and historical error codes that external logs, rows, or
  scripts may already reference.
- The implementation files `botVaultV3.service.ts` and
  `botVaultV3.lifecycle.ts` until remaining direct imports have been reduced.
- Onchain ABI names such as `botVaultV3Abi` where the Solidity contract ABI
  family or historical action envelope is still named that way.

## Next Steps

1. Move additional internal helpers and tests to the runtime facade when they
   are touched for functional work.
2. Once direct imports are low, rename the implementation files behind the
   facade and keep thin compatibility re-export files with the old names.
3. Only migrate persisted `bot_vault_v3` or `botVaultV3Reconciliation` names as
   a versioned data/API migration with explicit backfill and rollout checks.
