# 03 – Arbitrage & Cross-Exchange Market Making (XEMM)

## Status
**Analysis status:** FINAL
**Project:** uLiquid Desk × Hummingbot
**Area:** Arbitrage, Cross-Exchange Market Making, Opportunity Scanning, Inventory/Risk, Productization
**Date:** 2026-09-03

---

## 1. Executive Summary

Hummingbot's Arbitrage and XEMM stack is strategically very interesting for uLiquid Desk, but it should **not** be integrated as a black-box production subsystem at this stage.

The strongest opportunity is not merely to add two more bot types. The more valuable direction is to build a broader **Cross-Market Opportunity Layer** inside uLiquid:

1. discover opportunities across connected exchanges,
2. normalize price, fees, depth and inventory,
3. rank opportunities by realistic net profitability,
4. validate them against user/exchange/risk constraints,
5. hand validated execution intents to a deterministic execution layer,
6. track inventory, hedge state, realized PnL and failures.

Hummingbot provides several highly reusable building blocks:

- `ArbitrageExecutor`
- `XEMMExecutor`
- `xemm_multiple_levels` V2 controller
- generic/statistical arbitrage examples
- `find-arbitrage-opps` skill
- `find-xemm-opps` skill
- multi-exchange connector infrastructure

However, current 2026 open issues show that **direct API execution for multi-market executors still has edge cases**. In particular:

- Arbitrage/XEMM executors launched through `POST /executors` can fail because both market legs are not automatically subscribed in the API path.
- A reported XEMM cancellation/fill race can result in the maker order filling while the taker hedge is skipped, leaving naked exposure.
- Recent PRs still address net-PnL sign/unit handling, execution timeout, and maker-order cancellation state.

Therefore the recommendation is:

> **ADOPT the opportunity-discovery, profitability, market-pair scoring and risk concepts.**
>
> **ADAPT Hummingbot XEMM/Arbitrage controllers and executors behind uLiquid's own orchestration and safety layer.**
>
> **DO NOT expose current direct Hummingbot multi-market executors as a production user-facing feature until uLiquid-specific hedge recovery and failure testing is complete.**

---

## 2. Scope

This area examines classical cross-exchange arbitrage, spot-to-spot arbitrage, CEX-to-DEX arbitrage, potential spot/perpetual extensions, cross-exchange market making, maker/taker hedging, inventory management, spread and profitability calculations, order-book depth, execution latency, opportunity discovery, risk handling, product/UX opportunities for uLiquid, and Hummingbot's current implementation maturity.

---

## 3. Hummingbot Components

### 3.1 ArbitrageExecutor

The `ArbitrageExecutor` is designed to trade a price discrepancy between two interchangeable markets.

```text
Market A                    Market B
   │                           │
   └──── price comparison ─────┘
               │
               ▼
      profitability check
               │
        fees / tx costs
               │
               ▼
     min profitability met?
               │
              YES
               │
       ┌───────┴───────┐
       ▼               ▼
      BUY             SELL
       │               │
       └──── track ─────┘
               │
               ▼
            net PnL
```

Important concepts already implemented include interchangeable-pair validation, order tracking for both sides, minimum profitability, transaction-cost awareness and concurrent buy/sell execution.

### 3.2 Arbitrage Controller

The newer V2 Arbitrage controller adds automatic spread detection, configurable price feeds, external oracle support, minimum spread, maximum position sizing and cooldown periods.

The architecture is useful for uLiquid:

```text
Controller
  ↓
decides WHEN/WHERE

Executor
  ↓
handles HOW
```

### 3.3 XEMMExecutor

Cross-Exchange Market Making actively places liquidity on one market and hedges on another.

```text
             TAKER EXCHANGE
          deep / tight spread
                 ▲
                 │ hedge
                 │
          maker order filled
                 │
                 ▼
             MAKER EXCHANGE
        wider / shallower spread
```

The process is:

1. monitor both markets,
2. calculate profitability including fees,
3. place a maker limit order,
4. wait for maker fill,
5. execute a taker hedge,
6. capture the remaining spread.

---

## 4. Why XEMM Is Potentially More Interesting Than Simple Arbitrage

Pure arbitrage competes heavily on detection speed, market-data latency, API latency, execution speed and fees.

XEMM can exploit more structural differences:

```text
Exchange A
wide spread
lower liquidity

Exchange B
tight spread
deep liquidity
```

This is a better fit for a configurable multi-exchange SaaS platform like uLiquid Desk.

---

## 5. XEMM Multiple Levels

The `xemm_multiple_levels` V2 controller supports separate buy and sell quoting levels.

```text
Buy Level 1    target 0.3%    $100
Buy Level 2    target 0.6%    $200
Buy Level 3    target 0.9%    $300

Sell Level 1   target 0.3%    $100
Sell Level 2   target 0.6%    $200
Sell Level 3   target 0.9%    $300
```

It also exposes minimum profitability, maximum profitability, executor imbalance limits and separate maker/taker connectors.

**Recommendation:** ADAPT as the basis for a future advanced uLiquid XEMM configuration model.

---

## 6. Opportunity Discovery Skills

### 6.1 `find-arbitrage-opps`

Current documented functionality includes:

- CEX scanning,
- optional DEX scanning,
- parallel exchange analysis,
- outlier filtering,
- connector filtering,
- arbitrage opportunity ranking.

This is immediately useful even without automated execution.

### 6.2 `find-xemm-opps`

This skill scans live order-book depth and scores exchange pairs using:

- mid-price gap,
- spread ratio,
- depth ratio,
- order-book balance,
- imbalance penalties.

It looks for:

```text
Maker:
wide spread
shallow book

Taker:
tight spread
deep book
```

It can also suggest profitability levels and generate a controller configuration.

**Recommendation:** ADAPT / HIGH PRIORITY.

---

## 7. Proposed uLiquid Opportunity Engine

```text
                Exchange / Market Data Layer
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
         Binance         Bitget           OKX
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                 Opportunity Engine
                           │
                  normalization layer
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Arbitrage Scan      XEMM Scan        Stat-Arb Scan
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                    Profitability Engine
                           │
                           ▼
                       Risk Engine
                           │
                           ▼
                  Execution Intent
                           │
                           ▼
                   Execution Gateway
                    ┌──────┴──────┐
                    ▼             ▼
                 Native       Hummingbot
```

uLiquid should own the higher-level abstraction rather than expose Hummingbot strategy objects directly.

---

## 8. Profitability Model

A headline spread is insufficient.

uLiquid should calculate:

```text
Gross Spread
- maker fee
- taker fee
- slippage
- expected market impact
- funding costs where applicable
- DEX gas / swap fees
- borrow cost where applicable
- conversion cost
- inventory rebalance cost
- safety buffer
= Expected Net Edge
```

Then:

```text
Expected Net Edge / Capital at Risk
= Expected Net Profitability
```

---

## 9. Size-Aware Pricing

Best bid/ask can be misleading when order-book depth is shallow.

For each opportunity, uLiquid should calculate something equivalent to:

```text
priceForVolume(exchangeA, amount)
priceForVolume(exchangeB, amount)
```

and derive executable VWAP rather than headline prices.

Hummingbot's Market Data layer already contains price-for-volume and VWAP concepts that can be reused or referenced.

---

## 10. Opportunity Score

A future uLiquid scanner could rank opportunities using:

```text
Net Spread
Available Depth
Hedge Liquidity
Spread Stability
Exchange Reliability
Inventory Balance
Latency Risk
Funding / Carry
```

Example output:

```text
BTC / USDT

Maker: Bitget
Taker: Binance

Expected net edge: 0.41%
Depth quality: HIGH
Hedge quality: HIGH
Spread stability: MEDIUM
Inventory: READY

Opportunity Score: 82 / 100
```

The exact weighting should later be backtested.

---

## 11. Inventory Is the Core Operational Problem

Cross-exchange strategies need pre-positioned inventory.

Every opportunity should therefore include an inventory status:

```text
READY
PARTIAL
REBALANCE_REQUIRED
NOT_EXECUTABLE
```

### Suggested model

```text
ExchangeInventory

exchange
asset
available
reserved
botReserved
pending
targetAllocation
minAllocation
maxAllocation
```

---

## 12. Capital Reservation

Multiple bots must not consume the same capital.

```text
Wallet Balance
     │
     ▼
Available Capital
     │
     ├── Bot A Reserve
     ├── Bot B Reserve
     ├── Open Order Reserve
     └── Manual Trading Reserve
```

This should be owned by uLiquid.

---

## 13. Rebalancing

Three approaches:

### Natural Rebalancing
Wait for opposite-direction trades.

### Trading Rebalance
Trade on the exchanges to restore allocation.

### Asset Transfer
Transfer assets between exchanges.

**Recommendation:** Do not automate CEX withdrawals for XEMM/Arbitrage. Keep exchange API keys Read + Trade only.

---

## 14. The Main XEMM Risk: Naked Exposure

Normal flow:

```text
Maker SELL fills
      │
      ▼
Taker BUY executes
      │
      ▼
Neutral
```

Failure:

```text
Maker SELL fills
      │
      X
Taker hedge fails
      │
      ▼
NAKED EXPOSURE
```

A current open Hummingbot issue reports a cancellation/fill race where this can happen.

---

## 15. uLiquid Hedge State Machine

Recommended states:

```text
MAKER_PENDING
MAKER_OPEN
MAKER_PARTIAL_FILL
HEDGE_REQUIRED
HEDGE_SUBMITTING
HEDGE_PARTIAL
HEDGED
HEDGE_FAILED
EMERGENCY_CLOSE_REQUIRED
RECONCILING
```

Core calculation:

```text
filled maker amount - confirmed hedge amount = unhedged amount
```

If unhedged exposure exceeds tolerance, uLiquid must initiate recovery.

---

## 16. Hedge Watchdog

The hedge watchdog should be independent from the executor process.

```text
XEMM Executor
     │
     ▼
Trade Events
     │
     ▼
uLiquid Hedge Watchdog
     │
     ├── maker fill
     ├── hedge fill
     ├── current exposure
     └── elapsed time
```

Possible fallback chain:

```text
Primary hedge: LIMIT IOC
↓ fails
Secondary: MARKET
↓ fails
Emergency: reduce/close exposure
↓
STOP BOT
```

Exact timing and slippage policies must be connector-specific.

---

## 17. Latency and Stale-Data Risk

Every opportunity should eventually track:

```text
market-data age
decision latency
provider latency
exchange ACK latency
fill latency
hedge latency
```

Stale-data guards should include:

```text
maxPriceAgeMs
maxBookAgeMs
maxClockSkewMs
```

---

## 18. Fee Profiles

Users may have different VIP tiers, rebates or fee-token discounts.

Suggested model:

```text
FeeProfile

exchange
makerFee
takerFee
source
lastVerified
```

Opportunity results should always state the fee assumptions.

---

## 19. Suggested Desk UX

### Arbitrage Scanner

```text
SOL/USDT

BUY
Binance
$142.31

SELL
Bitget
$142.86

Gross spread       0.386%
Fees              -0.120%
Slippage estimate -0.041%
Safety buffer     -0.030%

Expected net       0.195%

Executable size
$3,800
```

### XEMM Scanner

```text
BTC/USDT

Maker       Bitget
Taker       Binance

Maker spread        0.52%
Taker spread        0.03%
Net expected edge   0.31%

Depth               Excellent
Hedge liquidity     Excellent
Inventory           Ready

Score               87
```

This could become a distinctive **Cross-Market Opportunities** area inside Desk.

---

## 20. AI Role

Good AI tasks:

- explain opportunities,
- summarize liquidity,
- compare candidates,
- explain inventory needs,
- suggest conservative settings,
- surface unusual risks.

Core calculations and execution remain deterministic.

---

## 21. Potential uLiquid Skills

### `scan_arbitrage`

Inputs:

```text
base asset
quotes
allowed exchanges
minimum net edge
minimum depth
maximum capital
```

Structured output:

```json
{
  "pair": "BTC-USDT",
  "buyExchange": "binance",
  "sellExchange": "bitget",
  "grossSpreadPct": 0.34,
  "estimatedNetPct": 0.18,
  "maxExecutableUsd": 4200,
  "inventoryReady": true,
  "riskScore": 22
}
```

### `scan_xemm`

Outputs:

```text
recommended maker
recommended taker
maker spread
taker spread
depth ratio
order-book imbalance
recommended levels
minimum profitability
inventory requirements
```

---

## 22. Hyperliquid Cross-Market Opportunity

Because uLiquid already has native Hyperliquid integration, later combinations could include:

```text
Bitget ↔ Hyperliquid
Binance ↔ Hyperliquid
OKX ↔ Hyperliquid
```

Architecture:

```text
Opportunity Engine
       │
       ▼
Execution Intent
       │
 ┌─────┴─────┐
 ▼           ▼
HB CEX    Native HL
```

This could be more differentiated than offering only CEX-to-CEX arbitrage.

---

## 23. Future Perpetual / Statistical Arbitrage

Potential later categories:

```text
Perp ↔ Perp
Spot ↔ Perp
Funding arbitrage
Basis arbitrage
Statistical pair arbitrage
```

Hummingbot already contains a generic statistical arbitrage controller using two position executors and z-score/spread logic.

**Recommendation:** Separate later feature family.

---

## 24. Product Roadmap

This area-specific roadmap starts only after the consolidated roadmap has delivered the provider-neutral Shared Market Data and Feature foundations. Scanner calculations must consume shared normalized state rather than create direct exchange- or Hummingbot-specific data paths.

### Phase A — Scanner Only
Implement Arbitrage Scanner, XEMM Scanner, Net Profitability, Depth Analysis, Fee Model, Inventory Readiness and Opportunity Score.

**Priority: P1**

### Phase B — Paper Execution
Replay opportunities using realistic execution delay and slippage.

**Priority: P1/P2**

### Phase C — Automated Arbitrage
Requires dual-leg reconciliation, capital reservation, latency guard, slippage guard, kill switch and max-loss policy.

**Priority: P2 / CONDITIONAL**

### Phase D — XEMM
Requires maker-fill listener, hedge watchdog, emergency hedge, inventory manager, multi-level controls and exposure reconciliation.

**Priority: P3**

### Phase E — Hyperliquid Cross-Market
Use native uLiquid Hyperliquid provider.

**Priority: P3 / STRATEGIC**

### Phase F — CEX/DEX and Statistical Arbitrage
Later expansion.

**Priority: P4**

---

## 25. Current Hummingbot API Limitation

A significant open issue affects direct API creation of XEMM and Arbitrage executors.

The API prepares top-level:

```text
connector_name
trading_pair
```

while multi-market configs instead use:

```text
buying_market
selling_market
```

Through the direct REST path, required order books may not be registered, causing repeated missing-order-book failures.

**Conclusion:** Direct REST creation of Arbitrage/XEMM executors should not currently be treated as production-ready without patching and testing.

Controller/script mode follows a different market initialization path.

---

## 26. Current Development Activity

Recent 2026 Hummingbot work includes fixes for:

- XEMM/Arbitrage net-PnL units/sign,
- Arbitrage execution timeout,
- XEMM maker-order cancellation state.

This is positive, but confirms that the subsystem is still evolving.

### Version policy

```text
DO NOT use:
hummingbot:latest

USE:
tested immutable version
```

Upgrade process:

```text
New release
↓
Compatibility tests
↓
Arbitrage/XEMM regression suite
↓
Canary shard
↓
Production rollout
```

---

## 27. Required Regression Tests

### Arbitrage

```text
both legs fill
buy fills first
sell fills first
buy partial
sell partial
one leg rejected
one exchange disconnects
timeout after submit
fee change
slippage exceeds limit
```

### XEMM

```text
maker never fills
maker partial fill
maker full fill
cancel succeeds
cancel/fill race
hedge fails
hedge partial fill
hedge timeout
taker price jumps
maker reconnect
taker reconnect
bot restart while unhedged
```

Restart while unhedged is especially critical.

---

## 28. Durable Cross-Market State

Suggested record:

```text
CrossMarketExecution

id
strategyId
makerOrderId
takerOrderId
makerFilledQty
hedgedQty
unhedgedQty
state
lastReconciledAt
```

This must live outside transient executor memory.

---

## 29. Risk Limits

Per strategy:

```text
maxCapital
maxOrderSize
maxUnhedgedExposure
maxUnhedgedDuration
maxSlippage
minNetProfitability
maxDailyLoss
maxConsecutiveFailures
```

Per user:

```text
maxCrossExchangeCapital
allowedExchanges
allowedAssets
```

Global:

```text
provider kill switch
exchange kill switch
strategy-type kill switch
```

---

## 30. Reporting

Useful metrics:

```text
Gross spread
Fees
Slippage
Net realized PnL
Maker fills
Taker hedge fills
Average hedge latency
Max naked exposure
Unhedged duration
Capital utilized
Return on utilized capital
Opportunity hit rate
Missed opportunities
Rejected opportunities
```

---

## 31. Responsibility Matrix

| Function | uLiquid | Hummingbot |
|---|---|---|
| Opportunity UI | **Owner** | Reference |
| Opportunity scanning | **Owner/Adapt** | Strong reference/skills |
| Market normalization | **Owner** | Data provider |
| Profitability model | **Owner** | Adapt |
| Fee model | **Owner** | Inputs |
| Inventory manager | **Owner** | Executor-local support |
| Capital reservation | **Owner** | — |
| Strategy permissions | **Owner** | — |
| Risk policies | **Owner** | Supplement |
| Arbitrage execution | Gateway | Possible provider |
| XEMM execution | Gateway | Possible provider |
| Hedge watchdog | **Owner** | Must supplement |
| Recovery authority | **Owner** | Executor state |
| Hyperliquid execution | **Native uLiquid** | — |
| Agent explanation | **Owner** | Skills reference |

---

## 32. Adoption Matrix

| Component | Decision |
|---|---|
| `find-arbitrage-opps` | **ADAPT / HIGH PRIORITY** |
| `find-xemm-opps` | **ADAPT / HIGH PRIORITY** |
| ArbitrageExecutor | **POC / CONDITIONAL INTEGRATION** |
| XEMMExecutor | **REFERENCE + POC** |
| `xemm_multiple_levels` | **ADAPT** |
| Generic statistical arbitrage | **FUTURE REFERENCE** |

---

## 33. Product Opportunity Ranking

| Feature | Product Value | Technical Risk | Priority |
|---|---:|---:|---|
| Arbitrage Scanner | Very High | Low | **P1** |
| XEMM Scanner | Very High | Low | **P1** |
| Opportunity Alerts | High | Low | **P1** |
| Net Profitability Engine | Critical | Medium | **P1** |
| Inventory Readiness | Critical | Medium | **P1** |
| Paper Arbitrage | High | Low/Medium | **P1/P2** |
| Automated Arbitrage | High | High | **P2** |
| XEMM Bot | Very High | Very High | **P3** |
| Hyperliquid X-Market | Very High | High | **P3** |
| CEX/DEX Arbitrage | High | Very High | P4 |
| Stat Arb | High | High | P4 |

---

## 34. Suggested Module Structure

```text
cross-market/
│
├── opportunity-engine/
│   ├── arbitrage-scanner
│   ├── xemm-scanner
│   ├── normalization
│   └── scoring
│
├── profitability/
│   ├── fees
│   ├── depth
│   ├── slippage
│   ├── funding
│   └── safety-buffer
│
├── inventory/
│   ├── balances
│   ├── reservations
│   ├── allocation
│   └── rebalancing
│
├── execution/
│   ├── arbitrage-intent
│   ├── xemm-intent
│   ├── hedge-watchdog
│   └── reconciliation
│
└── reporting/
    ├── opportunity-history
    ├── execution-performance
    └── hedge-metrics
```

---

## 35. Recommended Initial Implementation

Do **not** begin with an automated Arbitrage bot.

Start with a **Cross-Market Opportunity Scanner**.

This is the first deliverable inside the Cross-Market product area, not the first deliverable of the overall Hummingbot roadmap. It depends on the Shared Market Data, quality, freshness and deterministic analytics foundations.

Initial universe:

```text
BTC
ETH
SOL

Binance
Bitget
OKX
Bybit
Gate
```

Features:

- live cross-exchange prices,
- size-aware executable spread,
- maker/taker fees,
- estimated slippage,
- estimated net edge,
- max executable size,
- inventory readiness,
- opportunity score.

Then add:

```text
Arbitrage tab
XEMM tab
```

This validates actual opportunity quality before heavy execution work.

---

## 36. Integration With Existing Desk Features

The new engine can feed:

### Market Analyst
Find and explain cross-market opportunities.

### Position Copilot
Check whether existing balances can support an opportunity.

### Bot Architect
Generate a conservative XEMM configuration.

### Trading Desk
Display cross-exchange spreads.

### Notifications
Alert when an opportunity exceeds a configured score.

### AI Predictions
Use cross-market liquidity/spread information as additional market features.

---

## 37. Strategic Insight

Hummingbot's biggest contribution here is not just an Arbitrage bot.

The opportunity is to:

> **Turn cross-exchange infrastructure into a discoverable, understandable and safely executable product.**

Hummingbot contributes infrastructure and reference implementations.

uLiquid contributes:

- SaaS UX,
- opportunity discovery,
- AI explanation,
- risk visualization,
- permissions,
- portfolio context,
- Hyperliquid integration,
- reporting,
- product packaging.

That is the differentiation.

---

## 38. Final Decision

### ADOPT
- cross-market opportunity engine
- size-aware profitability
- inventory readiness
- deterministic fee/slippage calculations
- maker/taker pair scoring
- multi-level XEMM concept
- cross-market reporting
- stale-data checks
- capital reservation
- independent hedge reconciliation

### ADAPT
- `find-arbitrage-opps`
- `find-xemm-opps`
- Arbitrage Controller concepts
- `xemm_multiple_levels`
- Arbitrage/XEMM profitability logic

### POC
- ArbitrageExecutor behind uLiquid Gateway
- XEMMExecutor behind uLiquid Gateway

### RETAIN NATIVE
- Hyperliquid execution
- permissions
- risk engine
- credential ownership
- inventory reservations
- audit trail
- strategy state authority

### REJECT
- direct Agent → Hummingbot execution
- direct Frontend → Hummingbot
- automated CEX withdrawals for rebalancing
- relying solely on executor state for hedge safety
- presenting headline spread as expected profit
- production use of unpinned `latest` images

---

## 39. Recommended Next Actions

1. Build the Arbitrage/XEMM scanner concept first.
2. Reuse Hummingbot skill logic as reference.
3. Define uLiquid profitability model.
4. Define account-specific fee profiles.
5. Define inventory reservation/readiness.
6. Add simulated execution and latency replay.
7. Build independent hedge watchdog.
8. POC automated Arbitrage.
9. Add XEMM only after Arbitrage execution is stable.
10. Later connect native Hyperliquid as a cross-market leg.

---

## 40. Area 3 Verdict

**Overall relevance to uLiquid:** VERY HIGH

**Immediate integration priority:**
Scanner / analytics: **VERY HIGH**
Automated Arbitrage: **MEDIUM**
Automated XEMM: **MEDIUM-LATER**

**Main opportunity:**
A new **Cross-Market Opportunities** product area inside uLiquid Desk.

**Main risk:**
Dual-leg execution and unhedged exposure.

**Recommended Hummingbot role:**
Reference implementation + optional execution provider behind uLiquid-owned safety/orchestration.

---

## Sources

- Hummingbot Arbitrage Executor documentation
  https://hummingbot.org/strategies/v2-strategies/executors/arbitrage-executor/

- Hummingbot Cross-Exchange Market Making documentation
  https://hummingbot.org/strategies/v1-strategies/cross-exchange-market-making/

- Hummingbot Skills
  https://hummingbot.org/mcp/skills/

- XEMM Multiple Levels controller
  https://github.com/hummingbot/hummingbot/blob/master/controllers/generic/xemm_multiple_levels.py

- Arbitrage Executor source
  https://github.com/hummingbot/hummingbot/blob/master/hummingbot/strategy_v2/executors/arbitrage_executor/arbitrage_executor.py

- Hummingbot API issue #158
  https://github.com/hummingbot/hummingbot-api/issues/158

- Hummingbot issue #8094
  https://github.com/hummingbot/hummingbot/issues/8094

- Hummingbot current pull requests
  https://github.com/hummingbot/hummingbot/pulls

---

**Area 3 status: FINAL**
