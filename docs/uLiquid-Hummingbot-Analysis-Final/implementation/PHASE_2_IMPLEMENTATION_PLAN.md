# Phase 2 — Shared Data and Existing AI Upgrade

Status: `IN PROGRESS` — shared datasets, persisted feature evidence and the first AI/UI consumer integration are deployed at `4afc5dec8`; authenticated Chrome acceptance is partial. Historical scope and the remaining acceptance gates are open.
Started: 2026-09-05.

## Entry decision

Mario confirmed Phase 1 as tested and formally complete on 2026-09-05 and authorized Phase 2 to start. This closes the prior Phase 1 acceptance follow-up. It is an owner acceptance decision, not a new automated test report or connector certification. The September 4 release evidence remains historical evidence for `837d7d12`.

## Objective and boundaries

Provide consistent, source-aware market features to the existing Market Analyst and Position Copilot. Keep `AGENT_SKILLS` as the sole tool authority and the Routine Registry as the calculation authority. A Feature Registry identifies and versions reusable outputs; it does not introduce another runtime.

All work remains read-only. No Hummingbot, exchange adapter replacement, execution tools, trade drafts, background AI activations, production deployment, credentials or capital actions are part of this implementation slice. Preserve the newer Agent Chat budgets, scope follow-ups, permission gates and credit accounting already on `main`.

Mario separately authorized production deployment and Chrome Computer Use acceptance on 2026-09-05. The API/web-only release below implements that authorization; it does not authorize trading, new monitoring activations, configuration changes or historical storage.

## Implementation sequence

### 2A — Shared public snapshots and feature contracts — `DEPLOYED`

- [x] Introduce a typed, strictly validated public derivatives snapshot envelope above the existing normalized perpetual client.
- [x] Key snapshots by resolved provider, source venue, market type and canonical symbol; reject private fields and ambiguous symbol strings.
- [x] Coalesce simultaneous Funding/OI reads and reuse snapshots for five seconds within one API process.
- [x] Bound hot state to 128 entries and 32 underlying requests; apply an eight-second read timeout. Failed or late responses are not cached. A timed-out upstream request retains its capacity slot until it settles because existing adapters do not consistently support cancellation.
- [x] Preserve original fetch time; recalculate observed age on cache reads. Missing/future timestamps are degraded, expired observations are stale, and absent units/cadence remain explicit.
- [x] Add static versioned features for technical indicator summary, Funding snapshot, OI snapshot and orderbook snapshot, delegating to Phase 1 routines.
- [x] Integrate Funding/OI skills with shared snapshots and feature references; retain field-specific capability checks before cache lookup and record `auto` fallback when a supported field is unavailable.
- [x] Scope the existing tool-result cache to user, run, conversation, account and implicit market context. Public-data tool classification alone must not permit sharing user-owned prediction results.
- [x] Persist safe feature/version/input-snapshot references in existing tool result JSON and project them in Decision Logs. Bump the two changed skills to version 3 and both built-in profiles to version 3.
- [x] Extend the shared snapshot envelope to candles, ticker and orderbook. Include timeframe, requested depth/history coverage and dataset schema version in keys. Keep spot/perpetual and existing canonical quote symbols separate; no new inverse/settlement aliases are introduced.
- [x] Migrate OHLCV/indicator reads to the same candle snapshot and orderbook analytics to a shared book snapshot.
- [x] Test Paper-linked venue resolution, unsupported linked fields, and ownership checks before resolution and repeated pinned reads.

The implementation remains in-process, not a Redis/distributed cache, websocket subscription manager or history store. Both typed stores use one `snapshotCache.ts` implementation, each bounded to 128 cached snapshots and 32 underlying requests. Run pinning is bounded to 32 keys and owned by the execution-context object. TTLs are three seconds for candles, two seconds for ticker/book and five seconds for derivatives. Feature values are persisted; raw market history is not stored for full recalculation/replay.

### 2B — Run snapshot consistency and durable evidence — `DEPLOYED`

- [x] Pin successful reads by resolved dataset and coverage and project the manifest from persisted Tool Calls. A new run is the refresh boundary; no silent mid-run refresh or new refresh tool exists.
- [x] Store validated feature values and routine/feature/input references in existing redacted Tool Call JSON. Decode stored values without invoking routines or providers. Limit each feature to 8 KiB and each tool to four features.
- [x] Preserve normalized observation/fetch timestamps and quality; mark `atomicObservation: false`. Existing derivatives endpoint-level timestamp semantics are retained, not upgraded to field-atomic observations.
- [x] Implement freshness policy `1.0.0`: ticker/book 30 seconds, derivatives 120 seconds, candles one interval plus 30 seconds. Flag missing/future timestamps, incomplete/malformed/gapped/duplicate/forming candles, differing providers and instantaneous observation skew above 120 seconds. Exclude candle-open timestamps from instantaneous-skew comparison.
- [x] Keep legacy feature arrays empty. Drop invalid persisted values, source/dataset mismatches and unsupported versions with `stored_feature_evidence_invalid`. Failed runs retain successful evidence without a recommendation.
- [x] Retain in-process sharing for now; distributed ownership remains conditional on measured concurrency/duplication across API workers.

### 2C — Existing AI consumers — `DEPLOYED` for snapshot context; acceptance partial

1. **Market Analyst:** consume shared candles, indicators, ticker, derivatives and orderbook features. Make source differences, stale data and insufficient context visible in the existing structured response. Compare request counts, latency and credit usage against the current path with fixed fixtures and prompts.
2. **Position Copilot:** attach public market features to account-owned position snapshots after permission checks. Preserve deterministic risk fallback, liquidation-distance semantics, deduplication, cooldowns and read-only guarantees. Cover both the Agent Chat profile and the standalone `apps/api/src/position-copilot/service.ts` path; they are distinct consumers.
3. **Decision Log UI:** show feature versions, snapshot identity and persisted key feature values in the existing sidebar/mobile drawer, with English/German translations and `AppIcon` conventions. Keep raw prompts, provider payloads and private account identifiers out of public evidence projection.

Do not reprice AI models, change tool budgets, replace profiles, or activate scheduled AI analysis as an incidental part of this migration.

- [x] Both Agent Chat profiles now include the same feature-context policy: deterministic values/nulls, source and coverage identity, non-atomic observations, provisional candles, bounded book depth, and no unsupported historical Funding/OI claims. Built-in profiles are version 5; calculation and feature versions remain 1.0.0.
- [x] Standalone perpetual Position Copilot reads a bounded 100-candle 1h indicator snapshot, a 25-level book, and supported Funding/OI through the same public stores. Entitlement, account ownership and automatic-monitoring settings remain checked first. Paper uses its linked venue; public factories receive no private account credentials. Unsupported fields and dataset failures stay explicit with no cross-venue fallback.
- [x] Cache the standalone explanation together with its original feature evidence for the existing five-minute AI cache lifetime; do not fetch fresh features beside a cached explanation. Preserve economic snapshot hashing, risk floor, deterministic fallback, notifications/cooldowns, billing scope, and no-tools policy. Add safe `marketContext` to the response and existing trace JSON; deterministic AI fallback has no fabricated market evidence.
- [x] Render persisted values, feature versions, source/input snapshot IDs, quality-at-run, observation/fetch times and coverage in the existing sidebar and mobile drawer. Keep nulls unavailable and legacy runs without invented feature values. Add English/German copy and independently handle Decision Log loading failures; refresh logs after both successful and failed sends.
- [x] Standalone spot enrichment is locally implemented in the [closeout slice](../../archive/tasks/2026-09-06-phase2-spot-closeout-slice.md): shared candles/indicators and orderbook, no derivatives, owner-checked Paper resolution, public credentials and cache v5. Production and broader provider acceptance remain open.
- [x] Authenticated Chrome checks cover Market Analyst feature evidence, exact snapshot/value persistence after reload, unsupported BingX with no cross-venue substitution, recent-run selection, the Copilot account-selection guard and its empty-account result, and German/English mobile drawers.
- [x] Live positive-position acceptance passed for the standalone and Agent Chat Copilot on 2026-09-06 after release; see the [post-release browser evidence](../../archive/tasks/2026-09-06-post-release-copilot-browser-acceptance.md). Complete recommendations, available BingX orderbook, conservative liquidation-zero handling and persisted Agent Chat provenance were observed.
- [ ] Fixed-prompt before/after quality/latency/credit comparisons, standalone cached-evidence identity, and live stale/fallback scenarios remain open. The post-release mobile Decision Log viewport-containment finding also requires correction and repeat acceptance. Passing synthetic checks does not close these gates.
- [x] The follow-up preserves the specific unsupported-capability reason through `withPublicVenue`, adds translated unavailable-capability copy and retains failed-tool skill/schema provenance. Required routines are not presented as executed routines when a tool fails. Code `3dc0e2401` is production-deployed; runtime smokes and authenticated BingX wording/version/reload acceptance passed.

### 2D — Historical feature scope — `DESIGN REQUIRED`

Historical Funding/OI changes, trends, percentiles and Z-scores remain a Phase 2 follow-on; they are not supplied by the five-second snapshot cache. Before implementing them, document verified provider history/cadence/unit coverage, gaps, sample sufficiency, retention, storage cost and backfill limits. Propose any persistence migration separately before applying it. Until enough comparable observations exist, return unavailable history and explicit reasons; never derive a trend from one snapshot or mix venues/units silently.

This item is not silently moved to a later roadmap phase. Phase 2 closeout must either complete the approved historical subset or explicitly record Mario's decision to defer it.

### 2E — Acceptance and release — `PARTIAL`; API/web snapshot slice deployed

- Run Futures Core/Exchange, Agent Chat, Position Copilot, API/web typechecks, web i18n and relevant UI tests without forced exits.
- Test single-flight/TTL/eviction, simultaneous failures, bounded hung requests, mutation isolation and cross-user/run/account/market separation.
- Verify feature input/output validation, stable hashes, changed input/version identity, preserved null values and conservative timestamp/quality handling.
- Test explicit unsupported venues, `auto` fallback, Paper-linked sources and account ownership in the actual consumer paths.
- Test durable snapshot evidence, legacy logs, failed runs and conversation reloads.
- Perform authenticated Market Analyst and Position Copilot browser acceptance for fresh/stale/degraded/fallback/unsupported states and mobile rendering.
- Measure shared reads versus current baseline, then document a separately authorized release and rollback. Do not mark Phase 2 deployed from local tests.

## Code ownership and integration map

| Layer | Current entry point | Phase 2 role |
|---|---|---|
| Provider normalization | `apps/api/src/perp/perp-market-data.client.ts`, `perp-derivatives-normalization.ts` | Existing native read contract; no adapter rewrite |
| Public state | `apps/api/src/market-data/sharedDerivatives.ts`, `sharedMarket.ts`, `snapshotCache.ts` | Typed datasets, one cache implementation and run pinning |
| Deterministic calculations | `apps/api/src/ai/routines/registry.ts`, `packages/futures-core/src/marketAnalytics.ts` | Sole calculation authority |
| Features | `apps/api/src/ai/features/registry.ts` | Feature versions and input/output snapshot identity |
| Agent consumers | `apps/api/src/ai/agent-chat/skills.ts`, `runtime.ts` | Permissions, tool execution, provenance persistence |
| Standalone Copilot | `apps/api/src/position-copilot/service.ts`, `marketContext.ts` | Account-scoped public perpetual features and evidence paired with cached explanations |
| User evidence | `apps/api/src/ai/agent-chat/decisionLogs.ts` and existing web sidebar | Redacted persisted feature evidence |

## First-slice verification — 2026-09-05

- Agent Chat including new shared-state and feature tests: 74/74 passed, normal process exit.
- Position Copilot focused tests: 13/13 passed.
- API typecheck: passed.
- Futures Core: 16/16 passed.
- Futures Exchange package build and regression command passed. The same three suites were additionally run without their existing `--test-force-exit` flag: Core 37/37, CEX 57/57, Hyperliquid 77/77 (171 total), all exited normally. Package scripts were not changed.
- Public Binance read smoke passed through the existing normalized client and new store: two concurrent consumers invoked one `getDerivativesSnapshot` load and received the same snapshot ID; Funding/OI were present. Quality correctly remained `degraded` with `funding_interval_unavailable`. This is a public-read smoke, not live connector certification.
- No private reads, trading writes or credential use were needed; native endpoint/signing contracts were not changed.
- `git diff --check` passed.
- No UI was changed; Phase 2 browser acceptance and production deployment are not claimed.

## Second-slice verification — 2026-09-05

- Agent Chat including shared datasets, pinning, Paper ownership and persisted feature tests: 90/90 passed, normal exit.
- Position Copilot: 13/13; Futures Core: 16/16; API typecheck: passed.
- OHLCV/ticker skills are now version 2; indicators/orderbook version 3; Funding/OI version 4; both built-in profiles version 4. Routine and feature calculations remain version 1.0.0.
- Added safe `marketSnapshot`, `featureSnapshots` and aggregate `snapshotManifest` Decision Log fields. No Prisma model or migration was added. The sidebar does not yet render these new fields.
- Public Binance ESM smoke passed for OHLCV, indicators, ticker and orderbook. OHLCV/indicators shared a snapshot; forming candles were degraded explicitly; missing ticker timestamp was degraded; the book was fresh with 25 returned levels and stored feature values.
- The smoke initially reproduced HTTP 400 for the requested 25-level book. The existing public client now requests the next valid Binance depth tier and trims normalized coverage. Signing, private APIs, support and certification were unchanged. See [Binance USD-M Order Book](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book).
- The initial `tsx -e` CommonJS-eval invocation stalled before its first log and was stopped as an unsuccessful launch. Native ESM was used for the successful smokes; the stopped launch was not passing evidence.
- No authenticated browser acceptance, AI-credit/model behavior comparison, commit, push or deployment is claimed for this slice.

## Third-slice verification — 2026-09-05

- Agent Chat: 92/92; Position Copilot: 19/19; web Agent Chat UI: 9/9. All exited normally without forced termination. API typecheck and web i18n integrity passed.
- Concurrent standalone fixture reads performed one load each for derivatives, candles and book across two consumers, with matching input IDs. Unknown OI units and missing cadence/timestamps retained nulls and explicit warnings. Owned-route tests verify permission/settings order and trace/response evidence parity; cross-user reads never invoke the market loader.
- The full web typecheck remains blocked by `apps/api/src/dashboard/layout.ts:206` (`DashboardLayoutItem` optional `id` inferred under the web TypeScript configuration). That file is unchanged from HEAD, verified by matching SHA-1 `151ae14ee27098b471ecb04ee7f64acf20aa8003`. No unrelated dashboard change was made to conceal this result.
- Local Next dev started successfully; `/en/agent-chat` redirected to `/en/login`. No authenticated local test session was available. Browser component acceptance uses the actual `AgentChatShell`, sidebar and CSS in an isolated localhost fixture with all fetches mocked; it cannot certify authentication, live AI or provider behavior.
- Browser component acceptance passed at 1440x1000 (English) and 390x844 (German), using Playwright CLI because the Browser plugin skill was unavailable. Page identity/content, no framework overlay, and console health (zero relevant warnings/errors) passed. Checked expanded stored metrics/IDs, degraded/fallback and stale evidence, failed runs without recommendations, legacy markers, loading/empty states, conversation reload with identical feature ID, and mobile open/close without horizontal overflow. A log-fetch failure after a successful synthetic send preserved both the answer and credit receipt; the Position Copilot account-selection guard remained effective.
- Browser testing found and corrected a sidebar overflow issue when expanding provenance: the sidebar now scrolls independently without shifting the conversation. Two test-script assertions were corrected (browser viewport scope and exact-match credit text); those failed script attempts were not passing application evidence. No authenticated/live-model acceptance or fresh-provider browser certification is claimed.
- Futures Core: 16/16 passed. Final API typecheck, web UI tests, i18n and `git diff --check` passed; full web typecheck reproduced the dashboard error above.
- No exchange signing/runtime policy, Prisma migration, Hummingbot, execution dependency, model pricing or production release is introduced.

## Next implementation slice

Complete the remaining 2C/2E gates: decide standalone spot enrichment scope, compare fixed-prompt AI behavior/latency/credits, and finish target-environment positive-position and stale/fallback acceptance. The controlled fixtures below do not replace those live gates. Do not create production positions or corrupt production data to manufacture fixtures. Prepare the 2D historical coverage/storage design before any migration or backfill.

### Live acceptance update — 2026-09-06

- [x] Reconfirmed public Market Analyst feature values and exact snapshot/provenance persistence after full reload, plus English/German mobile Decision Log rendering.
- [x] Verified that the successful zero-liquidation-price Copilot run survives reload/recent-run selection and remains separate from later failed runs.
- [x] Verified two real budget-exceeded runs retain their available evidence without inventing a recommendation; credit reservations returned to zero.
- [x] Completed a standalone manual analysis of an open position with technical-indicator context and correct zero-price risk semantics. This does not close exact standalone cached-feature provenance acceptance.
- [x] Implement a local correction for reproducible Agent Chat position-plus-market-context budget exhaustion: advertise only eligible tools and reserve the existing final model call for synthesis, without raising limits. The earlier live requests failed; post-release positive acceptance remains open.
- [x] Correct standalone BingX depth normalization locally: fetch the supported 50-level book for requested 25-level coverage and trim the normalized result. The patched client's public read smoke returned 25 bids/asks with a provider timestamp.
- [x] Separate standalone position-data completeness from market-context quality in English/German and deduplicate deterministic/model findings without lowering severity. Local component browser acceptance passed.
- [x] Publish the corrections with Mario's authorization together with the UI release: code `111b9de6e`, deployed to API/web on 2026-09-06. Technical health, read-only profile versions and the running native BingX client were verified.
- [ ] Repeat the real Position Copilot plus market-context analysis, standalone BingX analysis and cached/reloaded evidence checks after the Mac is unlocked. The post-release browser attempt was blocked by the locked Mac.
- [ ] Keep genuine stale/auto-fallback acceptance, the controlled benchmark, exact standalone cache evidence, and historical/spot scope decisions open.

See [dated live acceptance findings](../../archive/tasks/2026-09-06-phase2-live-acceptance-findings.md) for reproduction, evidence boundaries and the 127-credit test total. This was testing only: no code or production configuration was changed and no deployment was performed. Phase 2 remains incomplete.

### Local correction follow-up — 2026-09-06

Subsequent publication: the combined UI/Copilot release is now deployed; see [production release evidence](../../archive/tasks/2026-09-06-einui-copilot-production-release.md). The following paragraph records the earlier local-only stage, not current deployment status.

Mario subsequently authorized fixing those findings. The corrections above are implemented and locally verified, not published. Market Analyst is version 6, Position Copilot is version 7 and the standalone explanation cache namespace is `v4`; routine/skill calculation contracts and read-only permissions are unchanged. Agent Chat 106/106, standalone Copilot 26/26, web Agent Chat 9/9 and web Copilot 4/4 passed with normal exits, as did API/web typechecks, i18n and whitespace checks. See [local correction evidence](../../archive/tasks/2026-09-06-phase2-copilot-local-corrections.md) for boundaries and remaining live gates. The earlier live findings remain historical observations; no new live AI success or Phase 2 completion is claimed.

## Authorized release and Chrome acceptance — 2026-09-05

- Release commit `4afc5dec80041d6137f8463af9d54036d2665d4e` was pushed to `origin/main` and deployed to production. API and web were rebuilt and recreated with `--no-deps`; runner, PostgreSQL, Redis, Python and proxy container IDs were preserved. No environment or feature-gate values changed and no migrations were pending.
- The isolated release includes the existing production dashboard fix `f7d8df936`. Full web typecheck now passes; the earlier third-slice failure remains historical evidence. The unrelated local ULIQ commit `2482356d0` was excluded from the release.
- Release verification: Agent Chat 92/92, Position Copilot 19/19, web Agent Chat UI 9/9, Futures Core 16/16, Futures Exchange 171/171 without forced exits; API/web typechecks, i18n and production Docker builds passed.
- Live Market Analyst: four persisted features, profile v5, skill versions 3/4 and routine/feature versions 1.0.0. Funding and OI shared one input snapshot. The fresh book and degraded candle/funding evidence were shown honestly; feature IDs and values survived reload. Observed run latency was 21.0 seconds with 71 AI Credits charged.
- Explicit BingX Funding/OI failed closed without adopting earlier Binance values. The run completed with unavailable evidence and two failed read tools, not a fabricated quote; 5.9 seconds and 11 credits. Its generic error wording is the open follow-up above.
- Authorized Hyperliquid Copilot analysis used a real portfolio-risk tool and returned the empty-account result without fabricated positions or market features; 5.8 seconds and 18 credits. Its evidence survived reload. The Trading Desk also showed the empty-position state, so the standalone positive-position path was not exercised.
- German/English mobile drawers at 390×844, recent-run selection and desktop rendering were checked through Chrome Computer Use. No application warnings/errors appeared in the captured console logs; unrelated wallet-extension injection/listener errors were present. Temporary viewport overrides were reset.
- This is partial target-environment acceptance, not Phase 2 completion or live exchange certification. See the [dated release and acceptance evidence](../../archive/tasks/2026-09-05-phase2-snapshot-production-release-and-chrome-acceptance.md) for rollback, deployment observations and remaining gates.

## Error/provenance follow-up — locally verified, 2026-09-05

- Explicit unsupported venues retain `agent_chat_venue_unsupported` and non-retryable status, including when a tool supplies `auto` while the conversation selects BingX. Automatic fallback remains available only for eligible data errors and records stable codes rather than raw provider messages.
- Loading/failed tools store the attempted skill version and output schema ID. Failed output contributes unavailable quality and its safe error code to Decision Logs and marks the run degraded. It never invents executed routines, features, source observations or fetch timestamps. Successful skill/profile versions and calculation contracts remain unchanged by this error-path correction.
- Fully failed runs do not borrow a nearby assistant message or display a misleading legacy-association notice. Completed legacy runs retain their bounded compatibility association.
- Added runtime-to-persistence-to-projection regression tests for unsupported calls, exact versions and venue identity, model-visible non-retryable errors, stale/fallback evidence retained after a later model failure, invalid output rejection and absence of raw provider messages. An in-memory persistence round trip is used; no production database is accessed.
- Positive-position fixtures cover the actual owned-reference risk skill and the standalone HTTP handler through shared stores, four feature contracts, AI input, cached explanation and trace/response evidence. Repeated reads retain ownership checks and cached input identities; stale book/derivatives remain stale and the deterministic critical risk floor cannot be lowered by the model fixture. No execution or notifications are invoked.
- Final local checks: Agent Chat 99/99, Position Copilot 20/20 and web Agent Chat UI 9/9, normal exits; API/web typechecks, i18n and `git diff --check` passed on the isolated production-base worktree. The main checkout's unrelated local ULIQ commit and divergence are preserved.
- Chrome Computer Use rendered the actual `AgentChatShell` and sidebar at `http://127.0.0.1:3108`, using synthetic records processed by the real Decision Log projector. English desktop and German 390×844 mobile checks covered readable unsupported/stale/fallback reasons, failed-tool v4 evidence, a fully failed run without a recommendation/legacy notice, retained zero Funding, 180-second age, recent-run selection, reload and drawer open/close. Page identity, content, no framework overlay, screenshots and application console health passed; wallet-extension warnings/errors were separately observed. The mobile document had no horizontal overflow, and the viewport override was reset.
- Test harnesses and screenshots stay outside the repository. Model responses, public providers and persistence were controlled fixtures; no real AI Credits, account data or production writes were used. No additional commit, push or deployment is claimed by this follow-up. The deployed code remains `4afc5dec8`; its dated acceptance findings remain historical evidence.

## Error/provenance release — 2026-09-05

- Mario subsequently authorized publication. Code `3dc0e2401` was pushed to main and deployed to production API/web; the same 128 tests, API/web typechecks, i18n and production builds passed.
- Runtime checks passed: both containers healthy with zero restarts, API health and English/German login HTTP 200, unauthenticated Decision Logs HTTP 401. Configuration and schema were unchanged; other service containers were not recreated.
- After Mario unlocked the Mac, authenticated Chrome re-verification passed: two BingX-only v4 failures retained `agent_chat_venue_unsupported`; the assistant distinguished missing capability from temporary outage, and evidence survived reload and recent-run selection. English desktop and German mobile checks passed. One run used 20 AI Credits and took 5.2 seconds; reservations were zero after reload. Phase 2 remains incomplete. See the [dated correction release evidence](../../archive/tasks/2026-09-05-phase2-error-provenance-production-release.md) for image identity, rollback and remaining gates.
