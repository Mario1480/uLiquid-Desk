# Release Evidence Matrix

Use this file as the per-release Go/No-Go evidence checklist. Keep completed copies with the release tag or deployment notes so build, migration, canary, rollback, and ownership decisions are traceable.

## Release

| Field | Evidence |
|---|---|
| Release version/tag |  |
| Commit SHA |  |
| Deployment environment |  |
| Release owner |  |
| Reviewer |  |
| Planned deployment window |  |
| Rollback owner |  |

## Build And Test Gates

| Gate | Command or Evidence | Result | Link/Notes |
|---|---|---:|---|
| Node version | `node --version` must be Node 20.x |  |  |
| Install | `npm ci` |  |  |
| Dependency audit | `npm audit --audit-level=high` |  |  |
| Prisma generate | `npx prisma generate` |  |  |
| Prisma engine cache/offline policy | `docs/prisma-engine-cache-and-offline-builds.md` reviewed; cache hit/miss noted |  |  |
| Root typecheck | `npm run typecheck` |  |  |
| Root build | `npm run build` |  |  |
| API release hardening tests | `npm -w apps/api run test:release-hardening` |  |  |
| API auth/AI/vault tests | `npm -w apps/api run test:auth`; `test:ai`; `test:vaults` |  |  |
| BotVault V4 smoke/transitions | `npm -w apps/api run test:botvault-grid-smoke`; `test:botvault-v4-transitions` |  |  |
| Runner tests | `npm -w apps/runner run test` |  |  |
| Web behavior/i18n tests | Web `test:*` release suites; `npm -w apps/web run i18n:check` |  |  |
| Any budget | `npm run quality:any-budget` |  |  |
| Type-safety ratchet | `docs/type-safety-strictness-plan.md` reviewed; budget decreases recorded |  |  |
| Vendored charting checksum | `npm run quality:vendor-charting` |  |  |
| Futures core tests | `npm -w packages/futures-core run test` |  |  |
| Futures exchange tests | `npm -w packages/futures-exchange run test` |  |  |
| Python strategy tests | `PY_STRATEGY_AUTH_TOKEN=... PY_GRID_AUTH_TOKEN=... pytest -q apps/py-strategy-service` |  |  |
| Contracts build | `npm run contracts:build` |  |  |
| Contracts tests/fuzz/invariants | `npm run contracts:test` |  |  |
| Web production build | included in `npm run build` or explicit `npm -w apps/web run build` |  |  |
| Docker production build | compose/build log artifact |  |  |

## Database And Migrations

| Gate | Evidence | Result | Notes |
|---|---|---:|---|
| Migration diff reviewed |  |  |  |
| Migration applied to staging |  |  |  |
| Backup created before production deploy |  |  |  |
| Restore drill or latest restore evidence |  |  |  |
| Prisma client generated from deployed schema |  |  |  |

## Secrets And Configuration

| Gate | Evidence | Result | Notes |
|---|---|---:|---|
| Production env validation passes |  |  |  |
| No placeholder/default secrets |  |  |  |
| Redis configured for rate-limit/idempotency |  |  |  |
| Python strategy tokens meet production quality |  |  |  |
| Web/API CORS origins reviewed |  |  |  |
| Webhook secrets/signatures configured |  |  |  |

## Onchain

| Gate | Evidence | Result | Notes |
|---|---|---:|---|
| Contract addresses recorded |  |  |  |
| Owner/timelock/multisig ownership verified |  |  |  |
| Deployment dry-run completed |  |  |  |
| Broadcast tx hashes recorded |  |  |  |
| Explorer verification completed |  |  |  |
| Pause/kill-switch path tested |  |  |  |
| External review/audit reference |  |  |  |

## Canary

| Gate | Evidence | Result | Notes |
|---|---|---:|---|
| Max notional configured |  |  |  |
| Max open orders configured |  |  |  |
| Max vault allocation configured |  |  |  |
| Dry-run versus live reconciliation checked |  |  |  |
| Alerting verified |  |  |  |
| Rollback tested or rehearsed |  |  |  |

## Decision

| Decision | Owner | Timestamp | Notes |
|---|---|---|---|
| Go / No-Go |  |  |  |
