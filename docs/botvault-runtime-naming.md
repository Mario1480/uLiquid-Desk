# BotVault Runtime Naming

BotVault v4 is the current production path. Some backend names still contain
`v3` because they are compatibility identifiers, persisted data keys, or older
implementation entry points. This note documents the migration line so new v4
work does not keep spreading those names.

## Audit

- `botVaultV3.service.ts` and `botVaultV3.lifecycle.ts` contain the current v4
  funding, reserve, margin, reconcile, readiness, and recovery behavior.
- `bot_vault_v3` is still a persisted vault model and appears in rows, action
  metadata, route payloads, and regression tests. It must remain stable until a
  deliberate data/API migration exists.
- `BotVaultV3...` service and lifecycle exports are widely used by tests and
  helper modules. Renaming them in one step would create a large import churn
  without changing behavior.
- v4-specific status and reason codes already use explicit `bot_vault_v4_*`
  names where the behavior is truly v4-only, especially reserve, mismatch, and
  verification states.

## Current Migration Step

New central call sites should import the neutral runtime facade:

- `apps/api/src/vaults/botVaultRuntime.service.ts`
- `apps/api/src/vaults/botVaultRuntime.lifecycle.ts`

The runtime facade re-exports the existing implementation and adds neutral
names such as `BotVaultRuntimeService`, `createBotVaultRuntimeService`,
`reconcileBotVaultById`, `BotVaultExecutionReadiness`,
`evaluateBotVaultExecutionReadiness`, `BotVaultFundingLifecycleStage`, and
`classifyBotVaultRuntimeMismatch`.

The app bootstrap, route registration, grid lifecycle, and bot/grid/vault
mappers now accept `botVaultRuntimeService` first. The old
`botVaultV3Service` dependency remains as a deprecated compatibility fallback
for existing callers.

Grid start blocker messages now use neutral BotVault wording. Existing error
codes remain stable where clients or persisted rows may already depend on them.

## Rename Rules

Rename now:

- New service injection names: use `botVaultRuntimeService`.
- New service types: use `BotVaultRuntimeService`.
- New generic helpers: use `reconcileBotVaultById`,
  `evaluateBotVaultExecutionReadiness`, and `readBotVaultReconciliation`.
- New lifecycle/mismatch helpers: use `BotVaultFundingLifecycle...` and
  `BotVaultRuntimeMismatch...`.

Keep for now:

- Persisted model strings such as `bot_vault_v3`.
- Stored compatibility keys such as `botVaultV3Reconciliation`.
- Onchain action names and historical error codes that external logs, rows, or
  scripts may already reference.
- The implementation files `botVaultV3.service.ts` and
  `botVaultV3.lifecycle.ts` until remaining direct imports have been reduced.

## Next Steps

1. Move additional internal helpers and tests to the runtime facade when they
   are touched for functional work.
2. Once direct imports are low, rename the implementation files behind the
   facade and keep thin compatibility re-export files with the old names.
3. Only migrate persisted `bot_vault_v3` or `botVaultV3Reconciliation` names as
   a versioned data/API migration with explicit backfill and rollout checks.
