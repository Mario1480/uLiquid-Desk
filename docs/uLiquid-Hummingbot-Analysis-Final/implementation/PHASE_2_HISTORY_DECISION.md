# Phase 2 historical analytics — storage decision

Status: provider-history mode selected by Mario on 2026-09-06; foundation, AI consumers and Decision Log presentation deployed to production as `41299926e`. Technical smokes passed; authenticated acceptance pending. No migration or collector is approved. See the [release evidence](../../archive/tasks/2026-09-06-phase2-provider-history-release.md).

## Owner decision

Mario selected existing exchange histories without a new database. Mode 1 below is the implementation boundary; mode 2 remains unapproved. This choice does not itself close the Phase 2 historical acceptance gate.

1. **Provider-history mode:** request bounded existing public exchange histories on demand, using the existing in-process cache abstraction. Persist only validated feature outputs and provenance in the existing redacted evidence records. Unsupported or insufficient history stays unavailable. No collector, migration or persistent raw series.
2. **Desk-series mode:** additionally collect and retain public series with a separately reviewed schema, bounded symbol universe, scheduler ownership, idempotent observation keys, retention and operating limits. A migration and collector activation require separate authorization. Missing provider backfill means the dataset must accumulate before statistics become available.

Neither mode supplies fabricated observations for unsupported venues. Choosing mode 1 does not imply cross-venue coverage or unlimited history. Choosing mode 2 does not make historical data immediately available.

## Verified starting coverage — 2026-09-06

- Binance USD-M Funding: public `/fapi/v1/fundingRate`; timestamp, rate, mark price and rate type. The current API permits up to 1000 rows/request and shares a 500 requests/5 minutes/IP quota with funding information. Additional/special funding events must not be mixed silently with regular cadence statistics.
- Binance USD-M OI: public `/futures/data/openInterestHist`; period selection, up to 500 rows/request, only the latest month, and 1000 requests/5 minutes/IP. Preserve reported OI and reported notional independently; do not derive historical notional from today's price.
- Read-only BTCUSDT probes returned HTTP 200 and five records from each endpoint. One funding event timestamp was offset by one millisecond: cadence validation needs a documented timestamp tolerance, not exact equality or arbitrary interval inference.
- Bitget, Hyperliquid, MEXC and BingX historical contracts and limits still need endpoint-specific verification. Current snapshot support does not establish historical support. Paper must use its owner-checked linked venue; spot Funding/OI are not applicable.

Source: [Binance USD-M market-data specification](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data). These probes certify neither production availability nor live connector write capability.

## Calculation and evidence contract

- Same provider, venue, instrument, market, unit, period and event type within each comparable series; do not mix spot/perpetual or normalize contract quantities without a verified multiplier.
- Bounded requested window and sample count, explicit actual start/end, observed/fetched time, gaps, duplicates, excluded malformed rows, age and coverage ratio.
- No interpolation or carry-forward to manufacture missing observations. Duplicate timestamps with conflicting values invalidate comparable-series metrics.
- At least two valid comparable endpoints for an absolute change; percentage change is null when the baseline is zero. Funding changes use basis-point differences, not misleading percentage ratios around zero.
- The initial versioned policy requires at least 30 comparable observations for percentile and Z-score. Funding requests cover up to 30 days; OI requests cover seven days of hourly observations. Actual coverage governs the calculation, not the requested window label. Zero dispersion returns a null Z-score and a reason. Do not label crowding or liquidation risk from these statistics alone.
- Version all calculations in the existing Routine Registry and outputs in the Feature Registry. Existing Funding/OI skills gain optional historical context; no parallel tool registry or execution surface.
- Invalid, stale, incomplete or unsupported history must be apparent to the model and persisted Decision Log. Raw histories must remain bounded and must not spill into raw provider payload storage.

## Capacity and rollout boundaries

Provider-history mode should begin with one bounded request per eligible dataset, no automatic pagination/backfill, 60-second cache TTL, existing single-flight/timeout limits, and explicit truncation warnings. Actual history availability governs the result.

Desk-series mode needs measured row/index size and query plans before setting a retention budget. For orientation, 20 instruments × 5 venues × 288 five-minute observations/day × 90 days yields 2,592,000 OI rows before funding, indexes, replicas or backups. This is a sizing example, not an approved collection universe or cost estimate.

Do not remove the historical Phase 2 gate until the chosen scope is implemented, tested, deployed and accepted. A choice to defer requires an explicit owner decision; no deferral has been inferred.

## Local foundation — 2026-09-06

- `apps/api/src/market-data/derivativesHistory.ts` provides bounded public requests for Binance USD-M Funding/OI, Bitget USDT-M Funding and MEXC USDT Funding. Canonical USDT symbols only; no private credentials, account access, pagination, cross-venue fallback or persistence. Hyperliquid/BingX history remains fail-closed pending integration-specific contract verification. Paper must be resolved by an owner-checked consumer before this public reader; passing Paper directly is rejected.
- One request per dataset, maximum 200 rows (Bitget 100), 256 KiB response limit, six-second transport timeout, redirect rejection, 60-second cache TTL and existing bounded single-flight cache. Cached source identity, observation window and fetched time are retained; a separate evaluation input refreshes age.
- The registered `derivatives.history-summary.v1` routine and `derivatives.history-summary` feature (both version 1.0.0) expose bounded summaries, not raw series. Replay validation requires the distinct `derivatives_history` dataset; historical event times do not count as instantaneous snapshot skew. Existing v1 snapshot schemas remain unchanged.
- Cadence is not inferred from event spacing or today's Funding snapshot. Binance hourly OI has an explicit request period. MEXC observations supplied `collectCycle` (hours) in public probes. Binance/Bitget Funding currently retains observations but returns cadence-dependent statistics as null with `history_cadence_unverified_or_changed`. Current Funding snapshots remain separately available through existing skills.
- Public read-only probes returned HTTP 200: Binance Funding 90 observations, Binance hourly OI 168, Bitget Funding 90 in the requested window, MEXC Funding 90. OI statistics and MEXC per-event-cadence statistics were calculable. These are local public endpoint observations, not production connector certification or authenticated AI acceptance.
- Deterministic checks cover malformed rows, identity mismatch, unknown cadence, changed cadence, gaps, duplicate conflicts, empty input, zero baseline/dispersion, timestamp jitter, stale evaluation, clipped windows, bounds, rate limits, cache identity and redacted JSON replay. No AI credits or private exchange reads were used for these checks.
- Local verification: Agent Chat/routines/features/market-data suite 123/123 passed with normal process exit; API typecheck and `git diff --check` passed. This is code evidence only; no commit, push or deployment was performed for this foundation.

Official contracts: [Bitget historical Funding](https://www.bitget.com/api-doc/classic/contract/market/Get-History-Funding-Rate), [MEXC contract API](https://mexcdevelop.github.io/apidocs/contract_v1_en/), and the Binance market-data specification linked above.

## Consumer integration — local implementation

- Historical support is additive in the existing Futures Capability Registry. Initial Funding coverage is Binance, Bitget and MEXC; historical OI is Binance only. Hyperliquid/BingX remain explicitly unsupported in this release, not silently mapped to another venue. This is an implementation coverage boundary, not a claim that those exchanges lack public history endpoints. Certification remains `not_assessed`.
- Existing Funding/OI skills v5 accept optional `history: true` for a separate bounded history summary; the default remains the current snapshot. No duplicate skill or new execution surface. Only executed routine versions are recorded. Explicit venues fail closed; `auto` records skipped-source fallback. Account/Paper ownership is checked before repeated pinned reads.
- Standalone perpetual Copilot adds supported histories from its resolved venue without fallback; spot never requests them. Context remains bounded to five snapshots and six validated features. Explanation cache v6 retains analysis and original evidence together. No notification or monitoring setting is changed.
- Market Analyst v8 and Position Copilot v9 explain only validated historical metrics, actual windows and quality. The existing Decision Log feature panel renders sample count, actual dates, interval, coverage, change, mean, percentile, Z-score and null values in German/English. Raw observations are never part of stored feature output.
- Consumer fixtures cover pinned reads, ownership revocation, explicit unsupported venues, Paper-linked auto fallback, source identity, six-feature standalone context and persisted Decision Log values. Current-snapshot and historical versions remain separate.
- Verification after integration: Agent Chat 126/126, standalone Copilot 28/28, Futures Core 19/19, Futures Exchange 174/174 and web Agent Chat 11/11 passed. Exchange tests ran directly without forced exit. API/web typechecks, i18n integrity and diff checks passed. Web tests require the `apps/web` working directory so existing `@/` aliases resolve; an initial root-directory invocation failed for that reason and was rerun correctly.

Still required before completion: authenticated history evidence/reload/mobile acceptance and the other open Phase 2 acceptance items in the implementation plan. The Mac was locked at the initial browser attempt; that attempt is not passing evidence. Do not mark Phase 2 complete from code tests and public smokes alone.
