# Phase 3 — Cross-Market Scanner Implementation

Status: **CODE COMPLETE — RELEASE AND OWNER ACCEPTANCE PENDING**
Date: 2026-09-09

## Objective

Deliver deterministic, scanner-only Arbitrage and XEMM experiences on top of the uLiquid-owned Shared Market Data contracts. The scanners must expose realistic size-aware profitability, depth, fee, safety-buffer, freshness and inventory-readiness evidence without creating an order, execution intent, bot or provider-specific product contract.

## Delivered scope

### Deterministic opportunity engine

- Arbitrage evaluates every directed venue pair from the selected public perpetual books.
- XEMM evaluates both passive maker sides for every maker/taker venue pair.
- Both scanners walk normalized order-book depth for the requested size instead of treating top-of-book spread as executable profit.
- Results separate gross edge, depth slippage, explicit maker/taker fees, safety buffer, expected net edge and expected net PnL.
- Partial depth is calculated with quantity-consistent fills and blocks the opportunity.
- Data older than the configured maximum age, stale books, empty books and insufficient inventory block the opportunity.
- Inventory readiness is `ready`, `insufficient` or `unknown`. The initial perpetual implementation uses a disclosed conservative 1x quote-collateral requirement on both venues.
- The deterministic score combines net edge, executable depth, data quality and inventory readiness.
- Maker fills are always marked as unguaranteed.

### Shared public market-data integration

- The scanner reuses the existing normalized perpetual clients and `sharedMarketStore` snapshot/cache boundary.
- Binance, Bitget, Hyperliquid, MEXC and BingX are accepted scanner venues. A scan requires at least two successful public order books and records stable per-venue failure codes for partial provider coverage.
- Every available source records provider ID, snapshot ID, observation/fetch time, age, quality and warnings.
- Hyperliquid `l2Book` object levels are normalized into the existing tuple-based order-book contract. This also corrects the shared Hyperliquid depth path used by other public market-data consumers.
- No Hummingbot runtime or DTO is introduced. Phase 4's `PARTIAL` Decision Gate and the Phase 5 gate are unchanged.

### Authenticated API and Desk UX

- `POST /cross-market/scan` is authenticated, validates a bounded USDT perpetual request and exposes only scanner output.
- The endpoint accepts optional per-venue fee overrides and optional quote-collateral observations. Defaults remain explicit in the response.
- `/cross-market` adds a compact Ein UI page with Arbitrage/XEMM tabs, BTC/ETH/SOL presets, target size, minimum edge, safety buffer, venue selection, optional collateral, ranked opportunities, cost decomposition and market-data evidence.
- The page has no order, draft, launch or execution action. English and German copy explicitly state the read-only boundary.
- Navigation and breadcrumbs expose the new product area under Desk & Trading.

## Safety boundary

This phase performs public market-data reads and deterministic calculations only. It does not:

- read exchange credentials or private balances;
- create an `ExecutionIntent`, order, bot, reservation or withdrawal;
- perform a database migration or add persisted opportunity history;
- enable automated Arbitrage or XEMM execution;
- deploy to production or change a feature flag.

Automated Arbitrage remains Phase 6C and requires proven dual-leg idempotency, capital reservation, reconciliation and recovery. Automated XEMM remains Phase 6D and additionally requires an independent hedge watchdog and emergency recovery.

## Verification — 2026-09-09

- Cross-market engine, service and route tests: 9/9 passed.
- Focused cross-market plus perpetual-client regression tests: 15/15 passed.
- Full API TypeScript check: passed.
- Full web TypeScript check: passed.
- API production build: passed.
- Web production build: passed with a local build-only `API_URL`; no runtime configuration was changed.
- English/German i18n integrity: passed.
- `git diff --check`: passed before publication.
- Public BTCUSDT read smoke through the implemented runtime code path succeeded for Binance, Bitget and Hyperliquid without credentials. It produced 6 directed Arbitrage and 12 XEMM evaluations. The best live observations were below the configured five-basis-point net threshold after default costs; the scanner reported `below_threshold` rather than presenting a headline spread as profit.
- The actual Desk page rendered at 1440×1000 and 390×844 using the Ein UI shell. Navigation, controls, read-only disclosure and responsive one-column layout rendered without horizontal overflow. The temporary local route exposure used to inspect the unauthenticated visual state was removed after the check.

## Release gates beyond code publication

- Deploy API and web only with separate production authorization.
- Run an authenticated target-environment scan and verify the API response, both result tabs and provider failure state in the browser.
- Record Mario's owner acceptance before changing the consolidated Phase 3 status to `COMPLETE`.
