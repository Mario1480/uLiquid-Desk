# Phase 2 provider-history release

Status: code published and production API/web deployed as `41299926e`; technical runtime smokes passed. Authenticated history/reload/mobile acceptance is pending because the Mac was locked at the browser attempt. This is not full Phase 2 completion.

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
