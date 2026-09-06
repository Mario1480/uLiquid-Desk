# Ein UI and Copilot — Production Release, 2026-09-06

Status: published to `origin/main` and deployed to production API/web. Technical runtime verification passed. Post-release authenticated browser and paid-model acceptance remain open because Computer Use reported that the Mac was locked and automatic unlock failed. No alternate browser path or additional paid analysis was used.

## Authorization and source identity

Mario explicitly authorized committing all completed UI and Copilot changes together, pushing and deploying them.

- Published code: `111b9de6e2e71cc96eaa3d481242cae9ad36fe56`.
- Local combined commit: `e857cb728`, preserved on `codex/einui-desk-integration`.
- Release base and previous server source: `39c552597`.
- The release was reconciled in `codex/combined-release-20260906` from current `origin/main`. The only cherry-pick conflict retained the already-published Dashboard normalization implementation unchanged.
- Older local ULIQ commit `2482356d0` was not included. The authorized changes were carried over without replacing production ULIQ behavior. The local branch/history and untracked QA artifacts were preserved.
- Release source includes 266 changed files. Browser logs, screenshots, environment files, backups and local dependency symlinks were not committed. A staged-path and common-secret-pattern check found no matching secrets or excluded artifact paths; this is not a comprehensive security audit.

## Verification

| Check | Result |
| --- | --- |
| Agent Chat/routines/features/shared market data/native normalization | 106/106 passed on the release base |
| Combined Ein UI, web behavior, Dashboard and standalone Copilot tests | 125/125 passed on the release base |
| API/web typechecks and web i18n | Passed |
| Ein UI source/registry/license/prefix/import isolation | 44 registry entries, 54 source files, 107 route files verified |
| Vendored charting checksums | 1,949 files passed |
| Whitespace | Passed; four inherited trailing-whitespace lines in the clock widget were removed and its adopted-source hash updated |
| Production dependency installation | Both `npm ci` runs passed without install fallback; each reported three moderate audit findings |
| Production builds | API and Web passed; Web compiled, passed TypeScript and generated 98 pages |
| Migration status before activation | 114 migrations, database up to date |
| Startup migration check | No pending migrations to apply |
| Configured API/web environment comparison | Zero differing configured keys before and after activation; values were not printed |

The focused release suites total 231 passing tests with normal exits. An initial root-level combined test invocation could not resolve the web `@/` alias; rerunning with the web TypeScript configuration passed. This was a test invocation correction, not a hidden application fix.

Two known baseline checks remain failing and are not waived: `test:api-base` passes 9/10 because its cookie-name assertion omits the two existing presale cookie fields; `quality:any-budget` reports Exchange `any=73` against 72. Their source/test/budget inputs are unchanged from the previous production base. Root, runner, contract and full security suites, restore drills and capital canaries were not rerun or claimed by this API/web release.

## Deployment and runtime

Host/repository: `uliquid-desk`, `/opt/uliquid-desk`. The server fast-forwarded to the exact published code. Existing containers served traffic during the successful builds. The environment-sync/feature-flag deployment wrapper was not used; no environment, feature-gate, schema or credential changes were made.

```sh
docker compose --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api web
```

API returned HTTP 502 during recreation, then recovered. Activation completed at 11:25:33 UTC. Subsequent checks confirmed:

- API `/health`: HTTP 200.
- English/German login: HTTP 200 with meaningful form HTML and the new `data-ein-button` markup.
- Unauthenticated Decision Logs: HTTP 401.
- Unauthenticated internal UI gallery: HTTP 307 to `/en/login`.
- API/web: healthy, zero restarts. A bounded startup scan found no `FATAL`, `uncaughtException`, `UnhandledPromiseRejection` or `agent_chat_tool_result_invalid` occurrences. This is not a claim that every background provider integration is error-free.
- Running API exports: Market Analyst v6, Position Copilot v7 with `account_read`; the final-synthesis guard and standalone cache namespace `v4` are present.
- A public, unauthenticated read through the running API image's BingX client returned 25 bids and 25 asks with a provider timestamp for requested 25-level coverage. No private account or order endpoint was called.

| Service | Previous container | Current container |
| --- | --- | --- |
| API | `04ab1b39f096` | `dccf5c671f7d` |
| Web | `3d0316acc466` | `07525750b3ad` |
| Runner | `a0fe664b7932` | Unchanged |
| PostgreSQL | `769e97fe8bb0` | Unchanged |
| Redis | `0c817ad8da83` | Unchanged |
| Python strategy service | `ba00e93e1afc` | Unchanged |
| Salad proxy | `06cb505da85f` | Unchanged |

Running image identities:

- API: `sha256:e110ef8ce8935bcef5ea7dc8a8ca7ca22b625a8a33ffea5f04218e215b9c739d`.
- Web: `sha256:a48901efc049b08e62cade6005a902958f0f9bb1c81591bf3ea72cf4a11ac9a6`.

## Rollback and remaining acceptance

The previous images were retained before build as `uliquid-desk-api:einui-copilot-rollback-20260906` and `uliquid-desk-web:einui-copilot-rollback-20260906`. Rollback was not performed or rehearsed. If authorized and needed, retag these retained images to the Compose image names and recreate only API/web with `--no-deps --no-build`; recheck environment, health and unaffected services. This release requires no schema rollback.

The UI is deployed, but deployment is not a full accessibility, financial-workflow or performance certification. The [UI validation limitations](../../ui/einui-validation.md) and [Phase 2 gates](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md) remain applicable. After Mario unlocks the Mac, verify populated desktop/mobile screens and repeat the previously failing real Copilot request, its credit settlement and reloaded Decision Log evidence, plus standalone BingX book/quality/deduplication behavior. Phase 2 remains incomplete.
