# Phase 2 provider-history release

Status: code published and production API/web deployed as `41299926e`; technical runtime smokes passed. Subsequent authenticated Chrome acceptance verified history evidence persistence and mobile access, but found incorrect actual-window start dates in the generated answer. Historical answer acceptance and full Phase 2 completion remain open.

## Scope and boundaries

Mario selected existing exchange histories without a new database and requested continued completion and publication. This release adds a bounded public provider-history reader, registered summary routine/feature, additive historical capabilities, existing Funding/OI skill v5 history mode, standalone Copilot enrichment and German/English Decision Log metrics. Market Analyst is v8, Position Copilot v9, and the standalone explanation cache is v6.

Initial historical coverage is Binance USD-M Funding/OI and Bitget/MEXC Funding. Historical Hyperliquid/BingX support is explicitly unavailable in this release. This does not claim that those venues have no history endpoints. Unsupported explicit requests fail closed; eligible Agent Chat auto fallback is recorded. Standalone enrichment stays on the resolved account/Paper-linked venue.

No new table, migration, collector, dependency, credential/configuration change, trading action or monitoring activation was introduced. Raw observations stay in the bounded in-process cache and do not enter persisted feature output. No paid AI call or private exchange read was made during this release verification.

## Code verification

- Agent Chat/routines/features/market data: 126/126, normal exit.
- Standalone Position Copilot: 28/28, normal exit.
- Futures Core: 19/19; Futures Exchange: 174/174, run without forced-exit flags.
- Web Agent Chat: 11/11 from the web workspace; API/web typechecks, i18n integrity and diff checks passed.
- Isolated release checkout repeated Agent Chat 126/126, Copilot 28/28, web 11/11 and both typechecks. An initial root-directory web test invocation failed to resolve existing `@/` aliases; rerunning from the correct workspace passed without changing unrelated UI code.
- Tests include interval/gap/duplicate/zero safeguards, null statistics, response bounds, rate-limit failures, source identity, pinned history, Paper ownership revocation, explicit unsupported providers, spot restrictions, six-feature standalone context, exact routine provenance and JSON Decision Log replay without raw observations.

## Publication and deployment

- Local task commit `c4cbb9237` was cherry-picked into the isolated release checkout as `41299926e` and pushed to `origin/main`.
- Unrelated local UI edits and older local branch divergence were excluded.
- Server fast-forwarded to the release. Docker builds for API and web passed; only those services were recreated with `--no-deps`.
- API container `2abef45a8e91`, image `sha256:d568604c8a575d99d0a1999fca4a3edc4add36c3ce74c58a615a75177e582524`; web container `b7c4c5724cf0`, image `sha256:a37f4a2cbfeb5a69507642325f289a26c8f576cd3e125cb7f555819f3d8e8d6c`. Both matched the newly built images, were healthy and had zero restarts.
- Runner `a0fe664b7932`, PostgreSQL `769e97fe8bb0`, Redis `0c817ad8da83`, Python `ba00e93e1afc` and proxy `06cb505da85f` were unchanged.
- Preflight and startup confirmed 114 known migrations with none pending. No environment synchronization was run.
- Previous API/web images were retained under `phase2-history-rollback-20260906` tags. No rollback was needed or rehearsed.

## Running-image public smokes

The running API exported Market Analyst v8 and Position Copilot v9. Public BTCUSDT reads through the new feature consumer returned:

| Dataset | Observations | Quality | Statistical result |
| --- | ---: | --- | --- |
| Binance Funding | 90 | degraded | Cadence-dependent statistics null; `history_cadence_unverified_or_changed` |
| Binance hourly OI | 168 | fresh | Comparable summary available |
| Bitget Funding | 90 | degraded | Cadence-dependent statistics null; `history_cadence_unverified_or_changed` |
| MEXC Funding | 90 | fresh | Per-event cadence and comparable summary available |
| BingX OI history | none requested | unsupported | `open_interest_history_unsupported` before a public history request |

API `/health` returned `{"ok":true}`; English and German login routes returned HTTP 200; unauthenticated Decision Logs returned HTTP 401. These checks are not authenticated UI acceptance or live connector certification.

## Browser gate and remaining work

The intended flow is production Agent Chat → explicit historical Funding/OI request → persisted evidence → full reload → desktop/mobile evidence inspection. Computer Use reported that the Mac was locked and could not be automatically unlocked. Mario was asked to unlock it while implementation and release work continued. No new browser screenshot, interaction, console-health or reload evidence is claimed.

The active [Phase 2 plan](../../uLiquid-Hummingbot-Analysis-Final/implementation/PHASE_2_IMPLEMENTATION_PLAN.md) retains authenticated historical acceptance, the exact live standalone cache comparison, naturally stale evidence and the controlled before/after benchmark as open gates. No orders, transfers, account/provider settings or deliberate service disruptions are required or authorized by these acceptance steps.

## Subsequent authenticated Chrome acceptance — 18:05 UTC

After Mario unlocked the Mac, a fresh Chrome tab using the existing login successfully ran a public-only Binance BTCUSDT perpetual history request. The existing tab's detached debugger required opening a new tab; no account or browser security settings were changed.

- Market Analyst v8 invoked Open Interest and Funding skills v5 with historical summaries. Both recorded `derivatives.history-summary.v1` v1.0.0.
- OI returned 168 observations, fresh quality, hourly cadence, 100% requested coverage, change -731.733 base units (-0.6830752099%), percentile 8.630952381 and Z-score -1.009264063.
- Funding returned 90 observations, degraded quality and `history_cadence_unverified_or_changed`. Coverage, interval, mean, change, percentile and Z-score were unavailable, without substituted statistics.
- The expanded Decision Log's complete rendered text compared exactly equal before and after full page reload, including feature/input identities, values, provenance, fetch timestamps and recorded analysis-time age. Reload did not incur another analysis charge.
- Desktop screenshot inspection and the mobile 390×844 Decision Log drawer showed readable stored evidence. The drawer opened and closed successfully; the temporary viewport override was reset. German rendering was not rechecked in this pass.
- The browser error log contained a wallet-extension `Cannot redefine property: ethereum` error from a `chrome-extension://` source; no application-origin error appeared in the returned error entries. This is not a clean extension-console claim.
- UI billing showed 65 AI Credits used, balance 9,483 → 9,418, zero reserved. Recorded total latency was 12.7 seconds; OI/Funding tool durations were 0.6/0.3 seconds. This single run is not a controlled before/after benchmark.

### Acceptance finding: generated history windows contradict stored evidence

| Dataset | Stored actual window, converted from browser-local UTC+2 to UTC | Generated answer |
| --- | --- | --- |
| OI | 2026-08-30 19:00 to 2026-09-06 18:00 | Incorrect start: 2026-08-30 00:20 UTC |
| Funding | 2026-08-08 00:00 to 2026-09-06 16:00 | Incorrect start: 2026-08-06 18:40 UTC |

The incorrect dates also persisted in the recommendation section, while the stored feature values remained internally consistent. This is a model-answer grounding failure, not evidence that the historical records changed on reload. Source inspection shows numeric epoch-millisecond window fields in the historical tool result; whether model-side date conversion caused the discrepancy requires a focused fix and repeat live acceptance. Do not mark the history answer gate complete from successful persistence alone.

No private position read, order, transfer, activation, setting change or deployment occurred during this browser pass. The standalone cache comparison, naturally stale case and controlled benchmark were not performed in this pass. The finding is documented locally; this evidence update has not yet been published.

## Local history-window presentation correction

The model boundary now serializes validated historical summary window endpoints as deterministic ISO 8601 UTC strings. This applies to Agent Chat tool data and feature evidence, and standalone Position Copilot feature context. Stored routine output, numeric timestamps, snapshot identities and historical UI evidence are unchanged. Null endpoints remain null and unrelated numeric fields are not converted. The shared model policy requires copying actual endpoints rather than deriving them from the requested window, sample count or cadence.

Market Analyst is locally v9 and Position Copilot v10. The standalone explanation cache namespace is v7 so previously generated explanations cannot satisfy the corrected path's cache lookup. Skill and routine versions remain unchanged because their validated output contracts and calculations have not changed; only model presentation and instructions changed.

Regression fixtures cover the exact OI/Funding dates found above, duplicated tool/feature presentation, requested versus actual windows, null preservation and non-mutation of persisted values. Agent Chat tests passed 128/128, standalone Copilot 28/28, API typecheck and `git diff --check` passed. The known missing `/hooks/validate-schema.py` post-edit hook reported errors; file inspection confirmed the patches landed and the listed checks then completed successfully.

This correction is local, not committed, pushed or deployed. It removes model-side epoch conversion but is not a guarantee against all generated-answer errors. A new authenticated paid read-only history run after publication must verify exact UTC dates and persistence before closing this acceptance finding. Existing saved answers are not rewritten.

## UTC correction production deployment

Following Mario's explicit deployment request, local commit `ab3da0054` was cherry-picked into the isolated main release checkout as `31a9da352` and pushed to `origin/main`. The release checkout repeated 128/128 Agent Chat tests and the API typecheck successfully. Unrelated local UI changes were excluded.

The server fast-forwarded to this commit and built the API successfully. Preflight confirmed 114 migrations with the schema up to date; no new migration or environment synchronization was introduced. Only API was recreated using `--no-deps --wait`; web, runner, PostgreSQL, Redis, Python and proxy container identities remained unchanged.

API container `6201f137f091` runs image `sha256:c9180b7cb66c1432c10f90531804ea4a2993480461f40e5c9056fdaa09545dab`, healthy with zero restarts. Public `/health` returned `{"ok":true}`. The previous API image is retained as `uliquid-desk-api:history-utc-rollback-20260906`. Server tracked files are clean; pre-existing `backups/` is preserved.

This supersedes the preceding local-only publication status. Authenticated generated-answer acceptance remains open: deployment health does not establish that a new model answer reproduces both UTC windows correctly. No paid AI request or trading action was made during this deployment.
