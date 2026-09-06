# Zero liquidation price correction — production release, 2026-09-06

Status: the scoped API/web correction is published and deployed. Runtime verification passed. Fresh authenticated Copilot analysis and rendered desktop/mobile acceptance remain follow-up work for the user; no new AI analysis was started during publication.

## Scope and source identity

Mario explicitly authorized publication to enable another test. This release preserves a reported zero liquidation price, distinguishes it from missing data and a genuine zero-percent distance, and removes the resulting false deterministic proximity alarm. Other risk warnings, ownership checks, read-only permissions and credit accounting remain intact.

- Published code: `0128b6f7acf9b6533861fc440438879d434b86c5` on `origin/main`.
- Local equivalent: `ff8374278`; the isolated release branch starts from `0ce28a2e8`.
- Previous server source: `9bd6a9b0b`; previous running code: `3dc0e2401`.
- Host/repository: `uliquid-desk`, `/opt/uliquid-desk`.
- Only API and web were recreated. No runner rollout, exchange writes, migrations, credential/configuration changes, monitoring activation, onchain actions, or production-record edits were performed.
- Unrelated local ULIQ history, the untracked ULIQ release note, and server backups were preserved. Local main was not force-pushed or rebased.

## Validation

| Check | Result |
|---|---|
| Futures core suite | 19/19 |
| Focused futures-exchange metrics/contracts/capabilities/retry tests | 20/20 |
| Agent Chat suite | 101/101 |
| Position Copilot and trading tests | 39/39 |
| Agent Chat UI suite | 9/9 |
| API/web typechecks, web i18n, diff check | Passed on the release base |
| Production dependency install | Both `npm ci` runs succeeded; three moderate audit findings reported, no dependency update attempted |
| Production Docker builds | API and web passed; web compilation, TypeScript and 97 generated pages passed |
| Pre-activation database status | 114 migrations; schema up to date |
| API startup migration check | No pending migrations to apply |
| Configuration invariance | Zero changed configured environment keys and built argument values compared with the previous running containers; values were not printed |
| Offline new-image fixture | Zero price: null distance, no-price status, no critical alarm; missing price: degraded; genuine zero distance: critical |
| Running-container fixture | Corrected zero-price behavior confirmed using synthetic data only |

The 188 tests exited normally without forced termination. Local dependency symlinks were reused for worktree checks; production images were independently built from the exact release source. The original checkout's dashboard type error is absent on the published base. Root/runner/contracts suites, a separate security audit, backup creation and restore rehearsal were not rerun or claimed as release gates.

## Deployment and runtime

Verified rollback images were retained before building:

- `uliquid-desk-api:liquidation-rollback-20260906`
- `uliquid-desk-web:liquidation-rollback-20260906`

The server fast-forwarded to the exact published code. The environment-sync/feature-flag wrapper was not used. Deployment commands:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api web
```

The previous containers served traffic during builds. HTTP 502 was observed during recreation/startup, followed by successful public checks: API `/health` returned 200 with `{"ok":true}`, English/German login returned 200, and unauthenticated Decision Logs returned 401.

| Service | Before | After | Result |
|---|---|---|---|
| API | `013dcf9c477e` | `04ab1b39f096` | Healthy, zero restarts; started 09:19:43 UTC |
| Web | `e1431d08d22a` | `3d0316acc466` | Healthy, zero restarts; started 09:20:06 UTC |
| Runner | `a0fe664b7932` | unchanged | Healthy |
| PostgreSQL | `769e97fe8bb0` | unchanged | Healthy |
| Redis | `0c817ad8da83` | unchanged | Healthy |
| Python strategy service | `ba00e93e1afc` | unchanged | Healthy |
| Salad proxy | `06cb505da85f` | unchanged | Healthy |

Running API image: `sha256:2af6d1a50baa1e636fe451ef458b001a253767981272497e7031fd9eed18504f`.

Running web image: `sha256:c1ddad3cb03e54082ddef372153871902831150b6f0d007ff5b027df8ff89a29`.

The bounded startup scan found no `FATAL`, `uncaughtException`, `UnhandledPromiseRejection`, or `agent_chat_tool_result_invalid` occurrences. This is not a claim that unrelated background integrations are error-free. Rollback was not executed; under a rollback decision, retag the retained images and recreate only API/web with `--no-deps --no-build`, then verify configuration, health and unaffected containers again. No database rollback is required by this correction.

## Next user test

Reload the app and start a new Position Copilot analysis. Expected provenance: built-in profile v6, account position/risk skills v2, position snapshot/risk routines v1.1.0. A currently reported BingX zero price should not generate a liquidation-proximity warning or a fabricated zero-percent distance. Missing data and genuine risk signals must remain qualified.

Historical recommendations and Decision Logs are intentionally unchanged. A successful deployment or synthetic fixture does not establish live model wording, account-specific behavior, reload persistence of a new analysis, or desktop/mobile rendering acceptance. Those remain separate observations; no real account data or AI credits were consumed during this release.
