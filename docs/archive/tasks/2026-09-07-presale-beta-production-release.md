# Presale and beta registration production release

## Authorization and source

Mario requested committing and pushing all pending application changes, including the separate beta-registration implementation, then redeploying production. The combined release is based on `origin/main`, preserving its dashboard-layout correction and existing release evidence. Browser recordings and screenshots were not added to the release.

- Presale optimization source commit: `36c46088a` (pushed on `codex/einui-desk-integration`).
- Beta-registration source commit: `88dfeb6be` (pushed on `codex/beta-access-20260907`).
- Combined production application revision: `9ad3a2481`, pushed to `main` and the release branch.

## Verification

- API and web typechecks passed after generating Prisma Client and building workspace dependencies.
- Auth: 64 tests passed.
- Beta registration: 13 tests passed with isolated local PostgreSQL and Redis; external mail and bot verification were mocked.
- Public Presale/configuration/locale routing: 28 tests passed.
- Ein UI: 14 tests passed; translation integrity passed.
- Presale V2 contracts: 41 tests passed, two fork tests skipped without fork configuration. Four Mainnet locker tests also passed. No contracts were deployed by this release.
- The additive beta migration SQL executed successfully against an empty isolated local test database.
- API and web production builds passed. A public-Presale visibility flag initially inherited `false` from the server environment; it was corrected to `true` and the replacement web build was successfully deployed. Live-data and purchase flags remain false.

## Production operations

The server checkout `/opt/uliquid-desk` was fast-forwarded to the release. A protected PostgreSQL custom-format backup and environment backup were taken before migration. `pg_restore --list` successfully inspected the dump. The API rollback image was retained as `uliquid-desk-api:pre-presale-beta-20260907`.

Only API and web were rebuilt/recreated. The API applied the beta migration; Prisma reports 115 migrations and an up-to-date database. The indexer environment interval is now 60 seconds. Runner and trading services were not replaced.

Verified public API responses: `/health` 200, `/auth/registration` 200 with registration disabled, `/auth/beta-access` 200 with intake disabled, and unauthenticated `/admin/beta-access` 401. The authenticated Chrome admin page shows the new Beta applications table and a disabled activation switch with the missing-readiness explanation. The public registration page renders its closed-registration state.

Final Docker health checks passed for API and web. Public `/en/presale`, `/en/presale/terms`, `/en/register` and `/en/register/beta` returned HTTP 200. `/de/presale` redirected to `/en/presale`. The in-app browser verified the Presale page's two Not Live badges, progress bars and disabled purchase controls. It remains a static preview; its existing pending-address copy is not evidence that the deployed contracts are missing. Runtime configuration and the receipt-backed manifest remain the address evidence.

A bounded read-only Mainnet smoke exercised the newly deployed indexer against Alchemy and the official Arbitrum RPC at finalized block `502747707`. It processed ten blocks with zero events, one explicit block-header read and one log read per provider, and one checkpoint. Persistence was an in-memory fixture; the smoke did not update production indexing state or submit transactions. The ten-block range fits Alchemy Free and is not proof of support for the normal 500-block range.

## Remaining activation work

The beta code and database are deployed, but real Turnstile keys and approved privacy configuration are absent. Intake remains closed. No external emails, invitations, or new production users were created during the smoke.

Presale live reads remain disabled because Alchemy Free's 10-block log-range limit is unresolved for the 500-block indexer. Purchases remain disabled and automatic finalization remains OFF. No paid RPC tariff was activated. Production release is not sale activation or proof of sustained RPC availability.
