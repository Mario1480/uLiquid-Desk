# Phase 2 error/provenance production release — 2026-09-05

Status: the scoped API/web correction is deployed; runtime smokes and the bounded authenticated BingX post-release browser check passed. The initially locked Mac was subsequently unlocked by Mario. This is not full Phase 2 completion.

## Authority and identity

Mario explicitly authorized publication of the previously verified local correction. The release is limited to unsupported Agent Chat capability errors, failed-tool provenance, failed-run association and localized Decision Log reasons. No trading, transfers, position creation, monitoring activation, credential/configuration changes or onchain actions were performed.

- Production: `uliquid-desk`, `/opt/uliquid-desk`; web `https://desk.uliquid.vip`, API `https://api.desk.uliquid.vip`.
- Published code commit: `3dc0e2401700d94b08dd78bbf854e74f66569368`.
- Previous source HEAD: `5ca3aa318` (documentation); previous running code: `4afc5dec8`.
- Scoped local equivalent: `39915ab67`. The release was committed from the isolated production-base worktree and pushed using `git push origin HEAD:main`. The server fast-forwarded to the exact release commit.
- The unrelated local ULIQ commit and untracked release note remain preserved. Local main divergence was not reset, rebased or pushed. Later documentation-only commits do not change the image/code identity recorded here.

## Validation

| Evidence layer | Result |
|---|---|
| Agent Chat tests | 99/99 passed, normal exit |
| Position Copilot tests | 20/20 passed, normal exit |
| Web Agent Chat UI tests | 9/9 passed, normal exit |
| API/web typechecks, web i18n, diff check | Passed on the production-base worktree |
| Production Docker builds | API and web passed; Node 20 build images, dependency layers reused from cache |
| Web build | Compilation, TypeScript and 97 generated pages passed |
| Prisma before activation | 114 migrations present; database up to date |
| Prisma during startup | No pending migrations to apply |
| Migration/configuration diff | No Prisma, Compose, environment-template or deploy-wrapper changes |
| Rendered configuration comparison | Zero changed configured environment keys and build argument keys against the previously running API/web containers; values were not printed |
| Authenticated post-release UI | Initially blocked by the locked Mac; subsequently passed for the bounded BingX case after Mario unlocked it; see the follow-up below |

The previous local synthetic desktop/mobile checks remain local evidence only. No real AI analysis or credit consumption was performed in this release turn. Root, runner, contracts, unrelated capital-flow suites and a fresh dependency audit were not rerun or represented as completed release gates.

## Deployment and runtime

Rollback tags were created and verified before building:

- `uliquid-desk-api:phase2-errorfix-rollback-20260905`
- `uliquid-desk-web:phase2-errorfix-rollback-20260905`

Commands used, without the environment-sync/feature-flag deploy wrapper:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --no-build api web
```

Activation began at `2026-09-05T18:00:14Z`. The old containers served traffic during the builds. HTTP 502 was observed during container recreation/startup; subsequent checks returned API health 200 with `{"ok":true}`, English/German login 200 and unauthenticated Decision Logs 401.

| Service | Previous container | Current container | Result |
|---|---|---|---|
| API | `132d28b1b44b` | `013dcf9c477e` | Healthy, zero restarts |
| Web | `1bd045e7abb5` | `e1431d08d22a` | Healthy, zero restarts |
| Runner | `a0fe664b7932` | unchanged | Healthy |
| Python | `ba00e93e1afc` | unchanged | Healthy |
| PostgreSQL | `769e97fe8bb0` | unchanged | Healthy |
| Redis | `0c817ad8da83` | unchanged | Healthy |
| Proxy | `06cb505da85f` | unchanged | Healthy |

Running API image: `sha256:d6dee19610edb32dc1d76137de6d7acab158340624d5019e9aaf9a84ffbe7a50`.

Running web image: `sha256:0d42f6045f8c3977c4bd3f4eb9e981214cb5fbf090b466142c8bca336f056b7f`.

The bounded startup log scan found no occurrences of `FATAL`, `uncaughtException`, `UnhandledPromiseRejection` or `agent_chat_tool_result_invalid`. This is a limited startup check, not proof that all background exchange integrations are error-free.

Rollback was not executed. Under a rollback decision, retag the retained images as the corresponding latest images, recreate only API/web with `--no-deps --no-build`, then recheck configuration invariance, runtime health and unaffected container IDs. No new database backup or restore drill was performed for this no-migration correction; existing backups were preserved.

## Remaining acceptance

The bounded BingX wording/version/reload gate is closed by the follow-up below. Do not reinterpret old generic-error records as newly produced corrected runs.

Positive-position target-environment Copilot acceptance, genuine stale/fallback scenarios, fixed-prompt quality/latency/credit comparisons and the outstanding historical/spot design decisions remain in the [active Phase 2 plan](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md). No positions or corrupted production data should be created solely to manufacture acceptance fixtures.

## Authenticated Chrome follow-up after unlock — 2026-09-05

- Mario unlocked the Mac and authorized continuation of the pending check. Chrome Computer Use reused the existing public-market conversation on production, with Market Analyst, BingX, BTCUSDT and Perp visibly selected.
- One new analysis began at the displayed local time 20:11:58 (Europe/Berlin). It performed exactly two visible tool calls: `market.get_funding_rate` and `market.get_open_interest`. Both failed with `agent_chat_venue_unsupported`, retained v4 evidence and source BingX, and did not display fabricated executed routines or feature values.
- The assistant explicitly distinguished unsupported capabilities from a temporary data outage and did not reuse older Binance values. The Decision Log showed unavailable quality, the translated capability reason, no stored feature values and the explicit read-only permission statement.
- Displayed latency was 5.2 seconds; the receipt charged 20 AI Credits. After a full reload, the balance matched the settled receipt and reservations were zero. No account-position analysis, orders or other capital actions were performed.
- Full reload retained the newest recommendation, both skill versions and the reason. Selecting the older 18:28:39 run showed its historical generic failure and missing version evidence unchanged; reselecting the new run restored the corrected evidence. The older record was not rewritten or treated as evidence of the new fix.
- English desktop and German 390×844 responsive checks passed for page identity, meaningful content, no framework overlay, translated reason, recent-run selection and mobile drawer open/close. Mobile document width and scroll width both measured 375 pixels (excluding the scrollbar), with no horizontal overflow. Screenshots were inspected via Computer Use; the native Chrome window capture was used when the viewport-override tab capture was downscaled. No screenshots or private browser data were committed.
- Captured warning/error logs contained only wallet-extension listener/stream warnings, not application warnings/errors. The header briefly retained a reservation display after the completed run; a full reload displayed the settled balance and zero reservations. This observation does not establish continuous header-update timing.
- The temporary viewport override was reset and the original English route restored. A non-matching label locator and a native selection attempt did not change the UI; a DOM-grounded combobox interaction subsequently verified recent-run selection.
- This closes the scoped unsupported-provider correction acceptance, not fully failed-run production coverage, live stale/fallback acceptance or Phase 2 as a whole. No further code change or application redeployment was needed for this verification.
