# Phase 2 snapshot release and authenticated Chrome acceptance — 2026-09-05

Status: the authorized API/web snapshot slice is deployed; browser acceptance is partial. Phase 2 is not complete. This dated record is evidence, not an open implementation plan; follow-ups remain in the [active Phase 2 plan](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md).

## Authority and release identity

Mario authorized deployment to the production server followed by Chrome Computer Use testing. He separately approved the read-only analysis of the selected real Hyperliquid account through the existing AI integration. No orders, transfers, closes, monitoring activations, credential changes or onchain actions were performed.

- Target: `uliquid-desk`, `/opt/uliquid-desk`; web `https://desk.uliquid.vip`, API `https://api.desk.uliquid.vip`.
- Previous production/origin commit: `33772ac73`.
- Released code: `4afc5dec80041d6137f8463af9d54036d2665d4e`.
- The local task commit `95acf3ed3` was cherry-picked onto the current production base in an isolated worktree. The unrelated local ULIQ commit `2482356d0` was not pushed or deployed. The local main divergence and unrelated untracked release note were preserved.
- `git push origin HEAD:main` succeeded; the server used a fast-forward pull to the exact release commit. Later documentation-only commits do not change the built code identity above.

## Verification before activation

| Check | Result |
|---|---|
| Agent Chat | 92/92 passed, normal exit |
| Position Copilot | 19/19 passed, normal exit |
| Web Agent Chat UI | 9/9 passed, normal exit |
| Futures Core | 16/16 passed, normal exit |
| Futures Exchange | Core 37/37, CEX 57/57, Hyperliquid 77/77; 171 total, normal exits without `--test-force-exit` |
| API/web typechecks | Passed |
| Web i18n and `git diff --check` | Passed |
| Fresh API/web production Docker builds | Passed, Node 20 build images and successful `npm ci` |
| Prisma generation/status | Passed; 114 migrations present, database up to date |
| Migration/configuration scope | No Prisma, environment, contract or presale runtime diff in the release |

The pre-existing production dashboard fix `f7d8df936` resolves the web typecheck error recorded during local third-slice validation. No dashboard patch was invented for this release. The package test scripts were not changed to conceal process hangs: the Futures Exchange scripts were invoked without their existing forced-exit flag and completed normally.

The installs reported three moderate dependency vulnerabilities; this was not a separate complete dependency/security audit. Root monorepo, contract, runner and unrelated capital-flow suites were not rerun or represented as passing gates for this scoped release.

## Deployment and configuration preservation

Rollback images were tagged before building:

- `uliquid-desk-api:phase2-rollback-20260905`
- `uliquid-desk-web:phase2-rollback-20260905`

Rendered Compose environment and build arguments were compared in memory against the running containers. Both services had zero changed configured environment keys and zero changed build argument keys. Values and secrets were not printed. No environment-sync wrapper was used.

Commands executed on the server:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml build api web
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps api web
```

The previous containers served traffic during the builds. The recreate/start sequence produced a brief observed web HTTP 502 while API became healthy; subsequent German and English login checks returned 200. API startup found 114 migrations and reported `No pending migrations to apply.` No new database backup or restore drill was performed for this no-migration release; existing backups were preserved. Image rollback is not evidence of a database restore drill.

| Service | Before | After | Observation |
|---|---|---|---|
| API | `c30b14578ebd` | `132d28b1b44b` | Healthy, zero restarts |
| Web | `3cbe02c3093e` | `1bd045e7abb5` | Healthy, zero restarts |
| Runner | `a0fe664b7932` | unchanged | Healthy |
| Python | `ba00e93e1afc` | unchanged | Healthy |
| PostgreSQL | `769e97fe8bb0` | unchanged | Healthy |
| Redis | `0c817ad8da83` | unchanged | Healthy |
| Proxy | `06cb505da85f` | unchanged | Healthy |

Running API image: `sha256:341c855eb88d9d990adec38f7ade99361a87698886266c6fd40a2f825ab79010`.
Running web image: `sha256:ffb8edaa82623cb4fa06cfae0188d06d8e56a1692234eaf787e1fcfb845b1746`.

Post-activation and post-browser checks returned API `/health` 200 with `{"ok":true}`, web login 200, and unauthenticated Decision Logs 401. The unaffected service IDs remained unchanged and API/web still had zero restarts after approximately nine minutes.

### Rollback procedure, not executed

Under a separate rollback decision, retag the two retained rollback images as their corresponding `latest` images, then recreate only `api web` with `--no-deps --no-build`. Recheck configured environment invariance, health and unaffected container IDs. The source checkout would still identify the newer release; record the actual running image/code relationship explicitly and do not reset unrelated Git work. No schema rollback is required by this release. Image tags were created and verified, but an actual rollback was not rehearsed.

## Authenticated browser checks

Chrome was already authenticated. Tests used Computer Use against production; no credentials were extracted. Existing conversations remained intact and two test conversations were added, with three bounded read-only analysis runs. No production records were altered to fabricate failures or stale data.

| Scenario | Observed result | Latency / charge |
|---|---|---|
| Binance Market Analyst, 1h indicators/Funding/OI/book | Four stored v1.0.0 features; profile v5; indicator/book skills v3 and Funding/OI v4. Fresh book, degraded forming candle and missing funding cadence/history were clearly qualified. No invented annualization or OI trend. | 21.0 s / 71 AI Credits |
| Same conversation, explicit BingX Funding/OI only | No Binance substitution or fabricated values. Two read tools failed closed; completed run showed unavailable evidence. Generic error wording remains a follow-up. | 5.9 s / 11 AI Credits |
| Authorized real-account Position Copilot | Real `risk.analyze_portfolio` v1 evidence, snapshot/risk routines v1.0.0 and profile v5. Empty-account response without invented positions or feature values. | 5.8 s / 18 AI Credits |

These are observed run metrics, not a controlled before/after benchmark. The three run receipts total 100 AI Credits. Reservations returned to zero after settlement; no credit configuration was changed.

Additional checks:

- Funding/OI used the exact same input snapshot identity. Stored feature/input hashes and values survived a full page reload without recalculation.
- Both runs in the market conversation survived reload; the recent-run selector displayed the appropriate older/newer recommendation and evidence.
- Copilot required account selection before enabling its initial prompts. Its completed account-read evidence survived reload.
- The Trading Desk showed an empty-position state for the approved account; no standalone positive-position analysis was possible and no order was created to enable it.
- Historical conversations rendered without invented stored feature values.
- Desktop rendering and German/English 390×844 drawers were visually inspected. Drawer open/close, scrolling, expanded hash/value wrapping and older-run selection worked. No framework error overlay was visible. Temporary viewport overrides were reset.
- Captured console logs contained no application warnings/errors on Agent Chat or Trading Desk. Wallet browser extensions emitted listener/injection errors, including an Ethereum-provider property conflict; these were not attributed to the application or silently counted as a clean browser console.
- Some automation attempts used names that differ between native accessibility and DOM roles and did not match. Correctly grounded controls were subsequently used; those failed locator attempts were not application pass evidence.

Screenshots were inspected in the Computer Use session; no screenshots containing account information, raw prompts, provider payloads, account IDs, credentials or balances were committed to the repository.

## Findings and open gates

1. **Unsupported-capability wording/provenance:** explicit BingX is safely rejected, but `withPublicVenue` converts `agent_chat_venue_unsupported` into `agent_chat_market_data_degraded`. The UI and model report a generic degraded source, and failed evidence lacks the skill-version detail present on successful evidence. Preserve the specific safe reason and failed-tool version provenance in a subsequent scoped fix.
2. **Positive-position Copilot:** the approved real account was empty. Agent Chat position-feature integration and the standalone position-analysis path still need a suitable position/test fixture; do not create live exposure solely for acceptance.
3. **Stale/fallback/failed-run coverage:** local fixtures cover these paths, but deliberately stale observations, a genuine automatic fallback, and a completely failed run were not reproduced in production. The BingX run completed with failed tools; it is not failed-run coverage.
4. **Quality/efficiency baseline:** no identical-prompt before/after live-model comparison was completed. Snapshot sharing has fixture/public-smoke evidence, not a measured production-wide improvement claim.
5. **Historical and spot scope:** the 2D provider-history/storage design and the standalone spot-enrichment decision remain open. No Funding/OI history migration, backfill, Feature Registry expansion beyond the approved four snapshots, Hummingbot or execution dependency was added.
6. **Separate operational observation:** API startup logs contained repeated Bitget history-window errors (`startTime and endTime interval cannot be greater than 90 days`). Their origin and relationship to the release were not established here; investigate separately rather than treating healthy containers as proof that all background integrations are healthy.

The authorized snapshot release is operational. This evidence does not close full Phase 2 acceptance, certify exchange execution, or change any existing capital/onchain go-live gate.
