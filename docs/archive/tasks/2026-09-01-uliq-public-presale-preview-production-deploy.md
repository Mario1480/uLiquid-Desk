# ULIQ Public Presale Preview Production Deployment

Date: 2026-09-01

## Scope

Deploy the static, no-login two-round ULIQ Presale preview and the schedule-only Superadmin preparation surface. Contract deployment, contract calls, public onchain reads, wallet sessions, purchases, Mainnet approval, and the legacy ULIQ runtime were excluded.

## Release

- Canonical public target: `desk.uliquid.vip` / `api.desk.uliquid.vip`
- Canonical production A record: `185.216.213.200`
- Production host: `vm-262`
- Git branch: `main`
- Deployed commit: `18f9960acfa564abab628d98bba9371adbe1b5f6`
- Initial feature commit: `935897c64b5d6898c8a7776527dafa69a57d40a9`
- Follow-up fixes: `a947199b`, `0e9b3bd3`, `28b3729b`, `802e555a`, `18f9960a`

## Pre-deployment evidence

- 36 focused auth, middleware, API, admin, session, configuration, and web tests passed.
- The focused strict API TypeScript check passed.
- Web i18n integrity passed.
- Prisma Client generation passed in the production Docker build.
- Full API, runner, and Next.js production builds passed.
- Next.js generated 97 routes, including `/presale`, `/presale/vesting`, `/presale/terms`, and `/admin/uliq`.
- `git diff --check` and deployment-script syntax checks passed.

## Backup and rollback evidence

- Backup directory: `/var/backups/uliquid-desk/releases/20260901T075107Z-public-presale-preview`
- Environment backup: `env.prod`, 11,753 bytes, mode `600`
- PostgreSQL custom dump: `marketmaker.dump`, 100,692,665 bytes, mode `600`
- Dump SHA-256: `187822477c9eac868b56e8fdf3fd224ea2f3f9d7ebb0242c13f830bc1e677d6f`
- `pg_restore --list` validated the dump.
- Rollback image tag suffix: `rollback-20260901T075107Z`
- API, web, runner, and Python strategy images were tagged before deployment.

## Migration evidence

- Prisma found 114 migrations.
- `20260901100000_public_uliq_presale` was applied successfully.
- Prisma reported all migrations successfully applied.
- The named PostgreSQL volume remained attached across container recreation.

## Effective runtime controls

| Control | Value |
| --- | --- |
| `ULIQ_ENABLED` | `false` |
| `ULIQ_PUBLIC_PRESALE_ENABLED` | `false` |
| `ULIQ_PUBLIC_PRESALE_ADMIN_ENABLED` | `true` |
| `ULIQ_PUBLIC_PRESALE_PURCHASES_ENABLED` | `false` |
| `ULIQ_PUBLIC_PRESALE_MAINNET_APPROVED` | `false` |
| `NEXT_PUBLIC_ULIQ_ENABLED` | `false` |
| `NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_ENABLED` | `true` |
| `NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_LIVE_DATA_ENABLED` | `false` |
| `NEXT_PUBLIC_ULIQ_ADMIN_VISIBLE` | `true` |

## Production smoke evidence

- All seven Compose services were running and healthy.
- API, web, and runner restart counts were `0` after deployment.
- `https://api.desk.uliquid.vip/health`: HTTP `200`.
- `https://desk.uliquid.vip/de/presale`: HTTP `200`, no login redirect.
- `https://desk.uliquid.vip/de/presale/vesting`: HTTP `200`, no login redirect.
- `https://desk.uliquid.vip/de/presale/terms`: HTTP `200`, no login redirect.
- `https://desk.uliquid.vip/en/presale`: HTTP `200`, no login redirect.
- German preview title, preview label, pending-contract notice, vesting title, and pending-terms notice were present in rendered HTML.
- The public Presale API returned HTTP `404`, confirming that public onchain reads stayed disabled.
- The unauthenticated schedule-admin endpoint returned HTTP `401`, confirming that it exists behind authentication.
- The preview rendered `noindex, nofollow` and remained omitted from `sitemap.xml`.

## Target verification note

The legacy `staking-vps` SSH alias resolved to a non-canonical host and was updated during the initial target check before DNS routing was compared. It received the same preparation migration and release, remained healthy, and was not rolled back because a database rollback would be destructive. The canonical public DNS target was then separately backed up, deployed, and verified as documented above.

## Remaining gates

- No contract was deployed or called.
- No Mainnet address, Safe, custody adapter, deployment block, terms version, or terms hash was accepted.
- Public onchain reads, wallet sessions, purchases, Mainnet approval, and the legacy ULIQ runtime remain disabled.
- Legal approval, independent audit closure, custody decisions, reviewed Mainnet deployment parameters, transaction E2E evidence, and operational reconciliation evidence remain required before purchase activation.
