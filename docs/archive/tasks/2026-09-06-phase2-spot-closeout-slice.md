# Phase 2 closeout — spot context and drawer slice

Status: published and deployed to production API/web as `9c31dbe6b`; technical smokes and the subsequent mobile, Spot Agent Chat and genuine auto-fallback browser checks passed. Historical storage selection and remaining gates below are pending. Not Phase 2 completion.

Mario authorized completing the remaining Phase 2 work, including the previously discussed publication and acceptance steps. Trading actions, account settings, new monitoring activations and database migrations remain outside this slice. The historical storage strategy is awaiting an explicit owner choice.

## Changes

- Standalone spot Copilot now loads the existing shared 100-candle 1h indicator and 25-level orderbook datasets using synthetic public credentials and the same spot backend selection as Agent Chat. Paper resolves its owner-checked linked venue. No derivative data is requested for spot.
- Existing entitlement/ownership ordering and read-only model policy remain unchanged. The explanation cache namespace is v5 to invalidate pre-enrichment spot explanations; explanation and original evidence remain one cache entry.
- Both AI consumers normalize decimal-string book levels strictly, without converting null/empty/boolean values to numbers. Invalid levels fail closed. Binance Spot depth update IDs are not treated as timestamps, and missing observation time remains degraded.
- Orderbook skill v4, Market Analyst v7 and Position Copilot v8 record the material contract change. Routine/feature calculation versions are unchanged.
- The previously verified local drawer correction disables the shell animation only for Agent Chat. No unrelated local UI edits are included in this slice.

## Public read observations

A native Binance BTCUSDT spot read initially returned indicators but rejected string-valued book levels at the shared schema boundary. Direct inspection confirmed numeric strings and an update sequence in the client timestamp field. After normalization, both indicator and book features were returned. Forming-candle and missing-provider-timestamp warnings remained explicit. No credentials, private data, orders or paid AI calls were used.

The existing native client and official [Binance Spot API documentation](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md) establish that REST depth returns `lastUpdateId`, not an observation time. Other venue live certification is not inferred from this smoke.

## Open acceptance

- Target-environment mobile acceptance passed after Mario unlocked the Mac; see the subsequent browser evidence below. The earlier locked-Mac attempt remains an unsuccessful attempt, not passing evidence.
- Exact standalone cached evidence at the live consumer boundary.
- Genuine stale scenarios and controlled fixed-prompt comparison. Eligible auto-fallback passed in the subsequent check below.
- Historical strategy, provider coverage and approved storage scope. No history feature or migration is claimed here.

## Verification and release evidence

- Local checks: Agent Chat 107/107, standalone Copilot 27/27, web Agent Chat 10/10, Futures Core 19/19 and Futures Exchange 173/173. Exchange suites ran without their existing forced-exit flags. API/web TypeScript and i18n checks passed. Two old profile-version assertions were updated for the intentional version bumps; the final suite passed normally.
- Release worktree repeated Agent Chat 107/107, Copilot 27/27, web Agent Chat 10/10 and API/web typechecks. Unrelated user UI changes and the older local ULIQ divergence were excluded. Local commit `9d1f847c2` was cherry-picked as `9c31dbe6b` and pushed to `origin/main`.
- Production Docker builds passed. API was recreated first; the initial Compose pass retained the old web container while the new web image finished exporting. A subsequent web-only pass recreated it, and the final running image identities below were checked. This intermediate state is not counted as a completed web deploy.
- Final API container `3fee240a96d0`, image `sha256:dd63be5ee6c4ca874638f61d80f6b79b1c56ae0eae0f9f06f6c58aefc6bb1f5d`; web container `8b1b709bc8c1`, image `sha256:9e4f538f8e6272558cf4f9ef54e120256aa021dea0e5c07d2ab54258293a5b6a`. Both healthy with zero restarts.
- Runner `a0fe664b7932`, PostgreSQL `769e97fe8bb0`, Redis `0c817ad8da83`, Python `ba00e93e1afc` and proxy `06cb505da85f` remained unchanged. No environment/configuration changes were made. Startup reported 114 migrations and none pending.
- API health returned `{"ok":true}`; English/German login routes returned HTTP 200; unauthenticated Decision Logs returned HTTP 401.
- The running API exported Market Analyst v7 and Position Copilot v8. A public Binance spot read returned both features, forming-candle degradation and null orderbook observation time with `provider_timestamp_missing`. The running web's CSS includes the scoped animation correction.
- Rollback images retained as `uliquid-desk-api:phase2-spot-rollback-20260906` and `uliquid-desk-web:phase2-spot-rollback-20260906`. No rollback was required or rehearsed.
- No new paid model calls, trades, account changes, notification activations or raw-history collection occurred. Public provider probes do not close the authenticated cache, stale/fallback or benchmark gates.

## Subsequent authenticated acceptance after unlock

- Chrome, production `/en/agent-chat` and `/de/agent-chat`, 390×844: the Decision Log panel bounds were y=253.203125 to y=844; shell transform was `none`. Internal scrolling reached 1688 px without moving the panel out of the viewport. Close, reopen and German full-page reload passed. No horizontal overflow was observed. Screenshots were visually inspected.
- Desktop 1512×862: expected URL/title and populated Agent Chat, no framework overlay or horizontal overflow. The captured 36 warning/error entries were extension-origin; no application-origin warning/error appeared. The temporary viewport was reset and English restored.
- A new Binance BTCUSDT Spot conversation completed with Market Analyst v7, indicators v3 and orderbook v4, taking 10.8 seconds and 64 AI Credits. Both market features were present. Missing book observation time and the forming candle were explicitly degraded; no derivative or private account read was requested. Expanded Decision Log text matched exactly after reload.
- A separate Firefox Position Copilot v8 conversation selected the existing BingX account, `auto`, ADAUSDT perpetual, and requested only public Funding with an explicitly permitted alternate source. It completed in 6.1 seconds and cost 37 AI Credits. The one successful evidence skill was Funding v4; actual source was Hyperliquid, with `agent_chat_venue_unsupported`, alternative-source and missing-provider-timestamp warnings. No portfolio, balance or order skill appeared. This is a genuine capability fallback, not a manufactured outage or cross-venue substitution under an explicit venue restriction.
- Expanded fallback Decision Log text matched exactly after reload, ignoring accessibility node numbers. Both account headers confirmed zero reservations. Total additional cost: **101 AI Credits**.
- These were bounded functional checks, not the controlled before/after benchmark. No standalone private-position cache hit, naturally stale observation, historical feature, migration or Phase 2 completion is claimed. No orders, account settings, notification activations or provider configuration were changed.
