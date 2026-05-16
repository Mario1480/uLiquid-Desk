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
| Prisma generate | `npx prisma generate` |  |  |
| Root typecheck | `npm run typecheck` |  |  |
| Root build | `npm run build` |  |  |
| API release hardening tests | `npm -w apps/api run test:release-hardening` |  |  |
| Any budget | `npm run quality:any-budget` |  |  |
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
