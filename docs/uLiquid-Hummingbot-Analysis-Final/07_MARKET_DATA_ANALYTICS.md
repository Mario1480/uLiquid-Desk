# 07 – Market Data & Deterministic Analytics

## Status
**Analysis status:** FINAL
**Project:** uLiquid Desk × Hummingbot
**Date:** 2026-09-03

### Implementation status — 2026-09-05

- `IMPLEMENTED`: deterministic current-snapshot Funding, open-interest and order-book analytics with provider/source provenance, timestamps, age, fallback codes and honest quality states.
- `IMPLEMENTED`: native normalization coverage for the Phase 1 Binance, Bitget, Hyperliquid, MEXC, BingX-unsupported and linked-Paper contracts.
- `IN PROGRESS`: shared derivatives/candles/ticker/orderbook snapshots, Feature Registry, run pinning, persisted values, feature-aware AI context, standalone perpetual Copilot and sidebar are implemented locally. Historical/spot scope and acceptance are tracked in the [Phase 2 plan](implementation/PHASE_2_IMPLEMENTATION_PLAN.md).
- `NOT STARTED`: distributed subscriptions, historical Funding/OI series, raw-input recalculation/replay and Hummingbot market-data provider.
- `COMPLETE`: Mario confirmed Phase 1 verification and formal acceptance on 2026-09-05. Connector certification and a measurable native-vs-Hummingbot comparison remain separate gates.

## Executive Summary

Hummingbot's Market Data API is highly relevant to uLiquid. It exposes normalized prices, tickers, order books, candles, historical candles, funding and size-aware order-book queries such as price-for-volume and VWAP-for-volume.

The recommended uLiquid architecture is **not** to let Predictions, Agents and Bots call Hummingbot separately. Desk should own a shared Market Data & Analytics Platform:

```text
Exchanges / Providers
        ↓
Provider Adapters
        ↓
Market Data Normalization
        ↓
Shared Market State
        ↓
Deterministic Analytics
        ↓
Feature Registry
        ↓
Desk / Predictions / Agents / Bots / Risk / Cross-Market
```

Core decision: **one market state, one calculation layer, many consumers.**

Hummingbot becomes an important CEX data provider. Native Hyperliquid remains a uLiquid provider.

---

## 1. Hummingbot Market Data Surface

Current Hummingbot API capabilities include prices, ticker data, order books, candles, historical candles, funding, price-for-volume, volume-for-price, VWAP-for-volume, order-book WebSocket streaming and order-book tracker restart/recovery.

This makes Hummingbot valuable beyond execution.

## 2. Why uLiquid Needs Its Own Layer

Avoid duplicated data paths such as:

```text
Prediction Builder → Binance
Market Analyst     → Hummingbot
Position Copilot   → Bitget
Grid Bot           → own WebSocket
Arbitrage Scanner  → another feed
```

This causes inconsistent prices/timestamps, duplicated connections/calculations and rate-limit pressure.

Preferred:

```text
             Market Data Platform
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 Hummingbot CEX   Native HL     Other Providers
      └──────────────┼──────────────┘
                     ▼
              Normalized State
```

## 3. Provider Interface

```text
MarketDataProvider
getTicker()
getOrderbook()
getTrades()
getCandles()
getHistoricalCandles()
getFunding()
getOpenInterest()
getMarkPrice()
getIndexPrice()
subscribeTicker()
subscribeOrderbook()
subscribeTrades()
```

Implementations: `HummingbotMarketDataProvider`, `HyperliquidMarketDataProvider`, `PaperMarketDataProvider`, future providers.

## 4. Canonical Market Identity

```text
MarketId
venue: BITGET
marketType: PERP
base: BTC
quote: USDT
settlement: USDT
```

Exchange-specific symbols remain provider mappings, not primary business identifiers.

## 5. Normalized Data & Quality

Ticker should include market ID, timestamps, bid/ask/mid/last, mark/index price, volume, source and quality.

Order-book snapshots should include exchange timestamp, receive time, sequence, bids/asks, depth and source.

Order-book lifecycle:

```text
DISCONNECTED → CONNECTING → SYNCING → LIVE
                                ↓
                              STALE → RECONNECTING → LIVE/FAILED
```

Suggested quality states:

```text
GOOD
DEGRADED
STALE
UNAVAILABLE
INCONSISTENT
```

Checks include timestamp drift, sequence gaps, crossed books, missing candles, outlier prices and disconnects. Thresholds should be connector/data-type specific.

## 6. Shared Market State & Event Bus

Hot state:

```text
ticker
orderbook
latest trades
funding
open interest
forming candle
```

Events:

```text
TickerUpdated
OrderBookUpdated
TradeReceived
CandleClosed
FundingUpdated
OpenInterestUpdated
MarketDataStale
MarketDataRecovered
```

This enables event-driven AI:

```text
CandleClosed
↓
deterministic analytics
↓
meaningful condition?
↓
invoke Market Analyst
```

rather than calling an LLM on a fixed short interval.

---

## 7. Deterministic Analytics Platform

Pipeline:

```text
Normalized Market Data
          ↓
Analytics Engine
          ↓
Feature Registry
```

Feature families:

```text
Technical
Market Structure
Derivatives
Order Book
Volatility
Portfolio
Cross-Market
Risk
```

### Technical Pack

Recommended shared features:

```text
EMA 9/20/50/100/200
RSI
StochRSI
ATR
true range
VWAP
volume averages
returns
realized volatility
```

The LLM interprets these; it does not calculate them.

### Market Structure / SMC Pack

For uLiquid's existing SMC analysis:

```text
swing highs/lows
HH / HL / LH / LL
BOS
CHoCH
FVG
order blocks
premium/discount zones
range boundaries
```

Because SMC definitions can be subjective, uLiquid should define one explicit algorithm/version per concept, e.g. `detect_bos_v2` and `detect_fvg_v1`.

## 8. Feature Registry & Versioning

Example registry:

```text
technical.ema
technical.stochrsi
technical.atr
structure.swing
structure.bos
structure.choch
structure.fvg
derivatives.funding
derivatives.oi
orderbook.imbalance
orderbook.depth
orderbook.vwap
crossmarket.spread
crossmarket.net_edge
```

Every result should carry feature ID, version, market, timeframe, timestamp, value and quality. This makes historical decisions reproducible.

## 9. Funding & OI Analytics

Funding features:

```text
current rate
annualized estimate
24h / 7d mean
percentile
z-score
trend
extreme flag
```

OI features:

```text
current OI
change 1h / 4h / 24h
z-score
price/OI regime
```

Interpretations such as crowded-long risk belong in Skills/Agents; calculations remain deterministic.

## 10. Order-Book Analytics

Shared routines:

```text
spread_bps
mid_price
weighted_mid
depth_usd
bid_ask_depth_ratio
imbalance
price_for_volume
volume_for_price
vwap_for_volume
slippage_for_size
```

Hummingbot's existing size-aware price/volume functions make this particularly attractive.

Calculate depth across multiple bands (e.g. 10/25/50/100 bps), not only top-of-book.

## 11. Trade Flow & Volatility

Where exchange semantics are reliable:

```text
buy/sell volume
delta
cumulative delta
trade intensity
large-trade detection
```

Aggressor semantics must be provider-aware.

Volatility regime can use realized volatility, ATR percentile, range expansion and volume regime, classified as LOW/NORMAL/HIGH/EXTREME.

## 12. Cross-Market, Portfolio & Risk

Area 3 requires shared deterministic calculations for gross/executable spread, fees, slippage, depth, inventory readiness, net edge and XEMM score.

Portfolio features:

```text
gross/net exposure
asset concentration
exchange concentration
leverage
drawdown
correlation
liquidation distance
funding burden
```

Risk features:

```text
position_size_pct
portfolio_exposure_pct
distance_to_liquidation
daily_drawdown
bot_drawdown
unhedged_exposure
stale_market_data
exchange_health
```

Risk Engine consumes these deterministically; Agents explain them.

---

## 13. Prediction Feature Store

This is particularly valuable for the existing AI Prediction system.

```text
Prediction Input
├── candles
├── market structure
├── indicators
├── funding
├── OI
├── volatility
└── orderbook
```

Versioned `FeatureSnapshot` stores market/timeframe/timestamp, feature versions/values, market-data references and quality. Predictions store the snapshot ID, answering later: **what exact data did this prediction see?**

Prediction Builder should select features from the registry rather than reimplement formulas.

## 14. Live / Historical / Backtest Consistency

Use the same routines for:

```text
live
historical
backtest
replay
```

Only the data source changes.

Explicitly distinguish forming vs closed candles (`isClosed`). Strategies declare whether intra-candle values are permitted.

Track exchange timestamp, receive time, normalized timestamp and clock skew for cross-exchange synchronization.

## 15. Provenance

Every normalized record should identify provider, connector, exchange, stream/endpoint type and receive timestamp. This is essential when debugging discrepancies.

---

## 16. Hummingbot's Role

Recommended uses:

```text
CEX ticker
CEX orderbook
CEX candles
CEX funding
trading rules
price-for-volume
VWAP
```

Benefits: connector normalization, less exchange-specific code and alignment with the execution layer.

Risks: coverage differences, varying candle support, connector regressions and an additional service dependency.

Therefore: **Hummingbot is a provider, not the source-of-truth architecture.**

## 17. Native Hyperliquid

Keep native HL data because Desk has deeper requirements around HyperCore, HyperEVM, Vaults, bot state and specialized position/funding data.

Normalize it into the same platform so consumers remain provider-independent.

## 18. Context Data Layer

News, macro and economic-calendar data should be separate from price-critical exchange state:

```text
Market Data Platform
+
Context Data Platform
(news / macro / calendar)
        ↓
Agent Context Builder / Prediction Context
```

News text should not directly trigger execution. Convert relevant events into structured data before deterministic blackout/risk rules use them.

---

## 19. Shared Subscription Manager

High fan-out data should be shared:

```text
BTC-USDT Binance orderbook

Market Analyst uses
Grid Bot uses
Arbitrage uses
UI uses

→ one upstream stream
```

Use reference-counted subscriptions and unsubscribe after a grace period when no consumer remains.

The important scaling dimension is unique `venue × market × data type`, not number of users. Private account streams remain tenant-specific.

## 20. Hot / Warm / Cold Data

**Hot:** ticker, orderbook, latest trades, funding/OI, forming candles.
**Warm:** recent candles/features/funding/OI.
**Cold:** long history, backtests, audit snapshots.

Technology can be selected later.

## 21. Market Data Health & Quality Gates

Per provider/market track:

```text
connected
lastMessageAt
ageMs
sequenceStatus
errorRate
reconnectCount
latency
quality
```

Example gates:

```text
orderbook stale → XEMM BLOCK
market unavailable → new bot entry BLOCK
position stale → monetary agent action BLOCK
funding stale → funding analysis DEGRADED
```

Missing optional data should degrade gracefully rather than stop unrelated features.

## 22. Data Contracts

Consumers declare requirements.

Example XEMM Scanner:

```text
requires:
ticker GOOD
orderbook GOOD
fee profile VALID

optional:
funding
OI
```

Market Analyst may require good candles while treating orderbook/funding/OI as optional.

---

## 23. Compact AI Context

Agents should request a compact structured market context instead of assembling raw data themselves.

Example:

```json
{
  "market": "BTC-USDT",
  "venue": "BITGET",
  "timeframe": "4h",
  "price": {"mid": 110250, "ageMs": 120},
  "structure": {"trend": "bullish", "bos": "confirmed"},
  "indicators": {"ema20": 108900, "atr": 2200, "stochRsi": 0.81},
  "derivatives": {"funding": 0.00012, "oiChange4hPct": 3.2},
  "orderbook": {"spreadBps": 1.4, "imbalance": 0.08},
  "quality": "GOOD"
}
```

This can save substantial tokens versus repeatedly sending hundreds of candles and full order books.

Raw data remains available through tools when deeper inspection is required.

## 24. Analytics Caching

Cache by:

```text
featureId
featureVersion
marketId
timeframe
dataSnapshotId
```

If many users request BTC 4H market structure from the same candle snapshot, calculate it once.

## 25. Integration With Area 6

Every material Agent Decision links to:

```text
MarketDataSnapshot
FeatureSnapshot
RoutineVersions
```

Replay can therefore reproduce the exact deterministic inputs.

Feature upgrades such as `detect_fvg_v1 → v2` do not rewrite history; shadow/replay compares versions before rollout.

---

## 26. Testing

### Provider
Symbol mapping, timestamps, sequence handling, reconnect, candle completeness, funding semantics and precision.

### Routine
Known deterministic fixtures.

### Cross-Provider
Consistent normalized units/semantics.

### Replay
Historical snapshot produces identical features.

### Failure
WebSocket disconnect, sequence gap, stale feed, missing candle, outlier price and provider restart.

Operations dashboard should monitor subscriptions, messages/sec, latency, stale markets, reconnects, sequence gaps, historical API failures, analytics latency and cache hit rate.

---

## 27. Implementation Phases

These are area-specific Market Platform stages. In the consolidated roadmap, the provider-neutral Shared Market Data and Feature foundations belong to Phase 2 and proceed regardless of the Hummingbot POC result. Cross-market analytics support the Phase 3 scanners; a Hummingbot data provider is added only after the Phase 4 Decision Gate passes.

### Phase A — Canonical Schemas
MarketId, ticker, orderbook, candle, funding, OI, quality and provenance.

### Phase B — Provider Layer
Hummingbot CEX + native Hyperliquid behind one interface.

### Phase C — Shared Subscription & Health
Reference-counted streams, staleness and recovery.

### Phase D — Core Analytics
EMA, StochRSI, ATR, volume, volatility, funding, OI, orderbook depth/imbalance/VWAP.

### Phase E — Market Structure
Versioned swing/BOS/CHoCH/FVG algorithms.

### Phase F — Feature Registry & Snapshots
Shared by Predictions, Agents and Bots.

### Phase G — Portfolio/Risk Analytics
Exposure, leverage, liquidation distance, concentration and drawdown.

### Phase H — Cross-Market Analytics
Executable spread, slippage, net edge and XEMM score.

---

## 28. Responsibility Matrix

| Area | Hummingbot | uLiquid |
|---|---|---|
| CEX public data | Strong provider | **Normalize/own interface** |
| Orderbook | Strong provider | **Shared state/quality** |
| Candles | Provider-dependent | **Normalize/cache** |
| Funding | Strong for supported perps | **Analytics/quality** |
| Price-for-volume/VWAP | Strong | **Reuse/adapt** |
| Open Interest | Coverage must be verified | **Provider abstraction** |
| Hyperliquid deep data | Limited to connector scope | **Native** |
| Feature calculations | Some utilities | **Own shared registry** |
| SMC | — | **Own/version** |
| Portfolio analytics | Some API support | **Own** |
| Risk features | Partial | **Own** |
| Prediction feature store | — | **Own** |
| Data quality policy | Provider mechanisms | **Own authority** |

---

## 29. Adoption Matrix

### ADOPT
- normalized provider architecture
- shared public market streams
- deterministic analytics
- Feature Registry
- feature versioning
- snapshot/provenance model
- size-aware orderbook analytics
- quality/staleness gates
- live/historical routine consistency
- compact AI market contexts

### ADAPT FROM HUMMINGBOT
- CEX market-data connectors
- candles/historical candles
- funding
- orderbook streaming
- price-for-volume
- volume-for-price
- VWAP-for-volume
- tracker recovery concepts

### RETAIN uLIQUID-NATIVE
- Hyperliquid deep integration
- SMC algorithms
- Prediction feature store
- portfolio/risk analytics
- cross-market profitability
- Context Data layer
- data-quality authority

### REJECT
- separate market calculations inside each feature
- LLM-calculated indicators
- one upstream stream per user
- using stale data without explicit degradation
- mixing public market data with tenant-private account state
- silently changing feature algorithms
- different live/backtest indicator implementations

---

## 30. Area 7 Verdict

**Overall relevance:** EXTREMELY HIGH

**Hummingbot integration value:** VERY HIGH as a CEX data provider.

**Most important architectural result:** build one shared uLiquid Market Data + Deterministic Analytics Platform that serves Predictions, Agents, Bots, Risk and Cross-Market features.

**Biggest immediate benefit:** fewer duplicate exchange integrations/calculations and substantially more consistent AI/strategy outputs.

**Strategic benefit:** the existing AI Prediction Builder becomes much stronger when it selects versioned features from the same Feature Registry used by Market Analyst and Bots.

---

## Sources

- Hummingbot API Market Data routers
  https://hummingbot.org/hummingbot-api/routers/

- Hummingbot API documentation
  https://hummingbot.org/hummingbot-api/

- Hummingbot Candles Feed
  https://hummingbot.org/strategies/v2-strategies/candles/

- Hummingbot Connector architecture
  https://hummingbot.org/connectors/

- Hummingbot API order-book tracker restart
  https://condor.hummingbot.org/api-reference/market-data/restart-order-book-tracker

---

**Area 7 status: FINAL**
