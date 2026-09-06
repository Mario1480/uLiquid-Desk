# Phase 2 historical analytics — storage decision

Status: proposed; owner selection pending. This is not an implemented historical feature or an approved migration.

## Decision required

1. **Provider-history mode:** request bounded existing public exchange histories on demand, using the existing in-process cache abstraction. Persist only validated feature outputs and provenance in the existing redacted evidence records. Unsupported or insufficient history stays unavailable. No collector, migration or persistent raw series.
2. **Desk-series mode:** additionally collect and retain public series with a separately reviewed schema, bounded symbol universe, scheduler ownership, idempotent observation keys, retention and operating limits. A migration and collector activation require separate authorization. Missing provider backfill means the dataset must accumulate before statistics become available.

Neither mode supplies fabricated observations for unsupported venues. Choosing mode 1 does not imply cross-venue coverage or unlimited history. Choosing mode 2 does not make historical data immediately available.

## Verified starting coverage — 2026-09-06

- Binance USD-M Funding: public `/fapi/v1/fundingRate`; timestamp, rate, mark price and rate type. The current API permits up to 1000 rows/request and shares a 500 requests/5 minutes/IP quota with funding information. Additional/special funding events must not be mixed silently with regular cadence statistics.
- Binance USD-M OI: public `/futures/data/openInterestHist`; period selection, up to 500 rows/request, only the latest month, and 1000 requests/5 minutes/IP. Preserve reported OI and reported notional independently; do not derive historical notional from today's price.
- Read-only BTCUSDT probes returned HTTP 200 and five records from each endpoint. One funding event timestamp was offset by one millisecond: cadence validation needs a documented timestamp tolerance, not exact equality or arbitrary interval inference.
- Bitget, Hyperliquid, MEXC and BingX historical contracts and limits still need endpoint-specific verification. Current snapshot support does not establish historical support. Paper must use its owner-checked linked venue; spot Funding/OI are not applicable.

Source: [Binance USD-M market-data specification](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data). These probes certify neither production availability nor live connector write capability.

## Proposed calculation and evidence contract

- Same provider, venue, instrument, market, unit, period and event type within each comparable series; do not mix spot/perpetual or normalize contract quantities without a verified multiplier.
- Bounded requested window and sample count, explicit actual start/end, observed/fetched time, gaps, duplicates, excluded malformed rows, age and coverage ratio.
- No interpolation or carry-forward to manufacture missing observations. Duplicate timestamps with conflicting values invalidate comparable-series metrics.
- At least two valid comparable endpoints for an absolute change; percentage change is null when the baseline is zero. Funding changes use basis-point differences, not misleading percentage ratios around zero.
- Percentile and Z-score require an explicitly approved minimum sample/window policy; the proposed initial floor is 30 comparable observations. Zero dispersion returns a null Z-score and a reason. Do not label crowding or liquidation risk from these statistics alone.
- Version all calculations in the existing Routine Registry and outputs in the Feature Registry. Existing Funding/OI skills gain optional historical context; no parallel tool registry or execution surface.
- Invalid, stale, incomplete or unsupported history must be apparent to the model and persisted Decision Log. Raw histories must remain bounded and must not spill into raw provider payload storage.

## Capacity and rollout boundaries

Provider-history mode should begin with one bounded request per eligible dataset, no automatic pagination/backfill, 60-second cache TTL, existing single-flight/timeout limits, and explicit truncation warnings. Actual history availability governs the result.

Desk-series mode needs measured row/index size and query plans before setting a retention budget. For orientation, 20 instruments × 5 venues × 288 five-minute observations/day × 90 days yields 2,592,000 OI rows before funding, indexes, replicas or backups. This is a sizing example, not an approved collection universe or cost estimate.

Do not remove the historical Phase 2 gate until the chosen scope is implemented, tested, deployed and accepted. A choice to defer requires an explicit owner decision; no deferral has been inferred.
