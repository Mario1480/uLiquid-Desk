# 08 – Target Architecture & Integration Decision

**Status:** FINAL
**Project:** uLiquid Desk × Hummingbot
**Date:** 2026-09-03

## Executive Summary

After Areas 1–7, the recommended direction is clear:

> **Do not rebuild uLiquid Desk around Hummingbot. Build a uLiquid-owned platform architecture in which Hummingbot is an interchangeable CEX infrastructure provider.**

uLiquid retains ownership of SaaS tenancy/authentication, exchange-connection ownership, credentials, ULIQ/subscription entitlements, risk and permissions, AI Predictions/Prediction Builder, Agents/Skills, Market Data normalization, deterministic analytics, Execution Gateway, audit/replay, Hyperliquid/HyperCore/HyperEVM/Vault V3 and product UX.

Hummingbot is selectively used for CEX connectors, CEX market data, trading rules, selected executors, connector QA patterns, Arbitrage/XEMM references and selected skill/routine concepts.

Core principle:

> **uLiquid owns every stable contract. Providers implement those contracts.**

## 1. Architecture Principles

1. **uLiquid owns interfaces.** Product modules never depend directly on Hummingbot DTOs/account IDs.
2. **Providers are replaceable.** Hummingbot, Native Hyperliquid, Paper and future providers implement uLiquid contracts.
3. **AI never owns execution authority.** Permission/Risk layers decide.
4. **One shared Market Data/Analytics platform.** Predictions, Agents, Bots, Risk and Cross-Market share normalized state/features.
5. **Live exchange state outranks memory.**
6. **Every monetary action is traceable.**
7. **Hyperliquid remains native.**

## 2. Target Architecture

```text
                               uLIQUID DESK
                                    │
                         Web / iOS / future Android
                                    │
                                    ▼
                            Product API Gateway
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
             Auth/Tenant        Entitlements       Portfolio/UI
                                    │
                                    ▼
                         uLiquid Control Plane
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
 AI / Intelligence          Trading Control              Market Platform
       │                    Permission Gateway                   │
       │                        Risk Engine                      │
       │                    Execution Gateway                   │
       │                  ┌─────────┴─────────┐                 │
       │                  ▼                   ▼                 │
       │            Hummingbot CEX       Native Providers       │
       │                  │              ├─ Hyperliquid         │
       │                  ▼              └─ Paper               │
       │              CEX Exchanges                             │
       └───────────────────────────┬────────────────────────────┘
                                   ▼
                        Observability / Audit / Replay
```

## 3. Intelligence Layer

```text
AI Platform
├── AI Predictions
├── Prediction Builder
├── Agent Orchestrator
│   ├── Market Analyst
│   ├── Position Copilot
│   └── Bot Architect
├── Skill Registry
├── Context Builder
├── Memory
└── Decision Logs
```

Market Analyst defaults to read-only. Position Copilot recommends. Bot Architect creates validated `BotSpec` drafts and cannot deploy live by default.

## 4. Skills, Tools & Routines

```text
Agent
  ├── Skill = workflow/playbook
  ├── Tool = controlled platform capability
  └── Routine = deterministic calculation
```

Production skills cannot grant permissions, hold secrets or call raw exchange APIs directly.

## 5. Market Data Platform

```text
Hummingbot CEX Data ─┐
Native Hyperliquid ──┼→ Normalization → Shared State → Analytics → Features
Other Providers ─────┘
```

Shared versioned features include EMA/RSI/StochRSI/ATR, volume/volatility, BOS/CHoCH/FVG, funding/OI, orderbook depth/imbalance/VWAP, portfolio exposure, liquidation distance and cross-market net edge.

## 6. Exchange Gateway

Stable uLiquid interface:

```text
getMarkets
getTicker
getOrderbook
getCandles
getBalances
getPositions
placeOrder
cancelOrder
getOrders
getTrades
setLeverage
setPositionMode
```

Capability Registry exposes actual support:

```text
supportsSpot
supportsPerp
supportsMarket
supportsLimit
supportsPostOnly
supportsHedgeMode
supportsLeverage
supportsFunding
```

## 7. Provider Strategy

### Hummingbot Provider

Preferred for certified CEXs. Initial strong candidates: Binance, Bitget, OKX, Gate.io and KuCoin. Additional connectors require QA.

### Native Hyperliquid Provider

Retains HyperCore, HyperEVM, Vault V3, CoreWriter, wallet/funding flows, profit share and contract-specific logic.

### Paper Provider

Used for simulation, dry run, agent validation and POCs.

## 8. Hummingbot Deployment

Hummingbot API remains private infrastructure.

```text
Internet
   X
Hummingbot API
```

Only the uLiquid Exchange Gateway reaches HB over a private network. Browser, mobile clients and Agents never access HB admin endpoints directly.

## 9. Multi-Tenant & Credentials

Hummingbot accounts are not uLiquid tenants.

```text
userId
  ↓
ExchangeConnection
  ↓
provider
  ↓
internal provider mapping
```

Potential HB scaling uses shards; exact accounts-per-shard is benchmarked.

uLiquid remains secret source of truth:

```text
Exchange Credentials
↓
Credential Service
↓
KMS / Envelope Encryption
↓
Controlled Provisioner
↓
Provider
```

Policy:

```text
READ ✓
TRADE ✓
WITHDRAW ✗
TRANSFER ✗
```

Use exchange-side IP allowlisting where practical.

## 10. Execution Architecture

```text
User / Bot / Agent
↓
Execution Intent
↓
Idempotency
↓
Permission Gateway
↓
Risk Engine
↓
Fresh State Validation
↓
Execution Gateway
↓
Provider
↓
Exchange
↓
Reconciliation
```

Unknown submission state becomes `UNKNOWN/RECONCILING`; never blindly resend.

## 11. Executor Strategy

**Strong POC candidates:** Order, Position, TWAP, DCA.

**Grid:** Hummingbot can be used for CEX where advantageous; Hyperliquid/Vault Grid remains native.

**Arbitrage/XEMM:** scanner/analytics first. Automated execution only after independent dual-leg/hedge recovery.

**LP:** future scope.

## 12. Cross-Market Opportunity Layer

```text
Shared Market Data
↓
Opportunity Engine
├── Arbitrage Scanner
└── XEMM Scanner
↓
Profitability
↓
Inventory Readiness
↓
Risk
↓
Execution Intent (later)
```

Potential future differentiator: Binance/Bitget/OKX ↔ Hyperliquid.

## 13. Agent Autonomy

```text
Level 0 READ ONLY
Level 1 RECOMMEND
Level 2 CONFIGURE
Level 3 USER-APPROVED EXECUTION
Level 4 POLICY-CONSTRAINED AUTONOMOUS
```

Initial defaults:

```text
Market Analyst    Level 0
Position Copilot  Level 1
Bot Architect     Level 2
```

Prompt instructions never grant monetary permissions.

## 14. Bot Architect Flow

```text
User Request
↓
Bot Architect
↓
Structured BotSpec
↓
Schema Validation
↓
Exchange Capability Validation
↓
Risk Validation
↓
Backtest / Simulation
↓
Paper / Dry Run
↓
User Review
↓
Explicit Approval
↓
Deployment
```

## 15. Observability & Replay

Every material action links Agent/Strategy Version, Skill/Routine versions, Market/Portfolio snapshots, Decision, Proposal, Approval, Execution Intent, Provider Result, Exchange Result and Reconciliation.

New AI/Hummingbot versions follow historical replay → evaluation → shadow/canary → production.

## 16. Failure Authority

```text
Exchange State
      ↑
Provider/Execution State
      ↑
uLiquid Product/Audit State
      ↑
Agent State
```

The LLM never decides whether an order filled.

## 17. Kill Switches

```text
Global Provider
Exchange
Strategy Type
User
Connection
Bot
Agent Execution
```

These should exist before autonomous execution.

## 18. Hummingbot Version Policy

Use pinned immutable versions, not `latest`.

Upgrade:

```text
New Release
↓
Connector Certification
↓
Executor Regression
↓
Failure/Recovery Tests
↓
Canary Shard
↓
Production
```

## 19. Connector Certification

Every provider/exchange is tested for authentication, balances, market data, trading rules, orders, cancellation, fills, positions, leverage, hedge mode, reconnect, restart recovery, rate limits and reconciliation.

Statuses:

```text
CERTIFIED
LIMITED
EXPERIMENTAL
DISABLED
```

## 20. Final Adoption Matrix

| Component | Decision |
|---|---|
| Hummingbot CEX connectors | **INTEGRATE via Provider** |
| Hummingbot Market Data | **INTEGRATE via Provider** |
| Trading rules | **INTEGRATE/ADAPT** |
| Order/Position Executors | **POC → likely integrate** |
| TWAP/DCA | **POC → strong candidates** |
| Grid Executor | **CEX POC; HL native** |
| Arbitrage Scanner concepts | **ADAPT** |
| XEMM Scanner concepts | **ADAPT** |
| ArbitrageExecutor | **POC / conditional** |
| XEMMExecutor | **POC / later** |
| Condor runtime | **REFERENCE / optional lab** |
| Condor architecture | **ADOPT principles** |
| Hummingbot Skills | **ADAPT selected concepts** |
| Hummingbot routines | **ADOPT concept** |
| Hummingbot tenancy/auth | **REJECT as Desk authority** |
| Hummingbot credential model alone | **INSUFFICIENT** |
| Native Hyperliquid replacement | **REJECT** |

## 21. What uLiquid Should Build

### Core Platform
Exchange Gateway, Capability Registry, Credential Service, Permission Gateway, Risk Engine, Execution Intent and Reconciliation.

### Market/Analytics
Market Data Platform, Shared Subscription Manager, Feature/Routine Registry, Feature Snapshots and Data Quality.

### AI
Agent Orchestrator, Context Builder, Skill Registry, Memory, Decision Logs, Replay/Evaluation, Model Router and Cost Tracking.

### Cross-Market
Opportunity/Profitability Engine, Inventory Readiness, Arbitrage Scanner and XEMM Scanner.

### Providers
Hummingbot, Native Hyperliquid and Paper.

## 22. What NOT to Build From Scratch Unless Needed

Where Hummingbot passes certification, avoid duplicating CEX REST/WebSocket connectors, exchange authentication adapters, symbol/trading-rule parsing, basic CEX order lifecycle, provider-level CEX market-data normalization and selected executor mechanics.

This is where the largest maintenance savings exist.

## 23. What Must Remain uLiquid-Owned

Never outsource stable authority for tenant identity, subscriptions/ULIQ, permissions, risk, credential ownership, capital reservation, audit, AI policy, product data contracts, Hyperliquid/Vault logic and UX.

## 24. Implementation Roadmap

### Phase 1 — Consolidate Quick Wins — `IMPLEMENTED`
Extract reusable deterministic Routines, extend the existing typed Agent Skill catalog and Futures Capability Registry, project user-facing Decision Logs from the existing Agent records, and add Funding/OI/Orderbook Analytics with freshness and quality metadata. Do not create parallel registries or runtimes.

Code, focused tests and production deployment are complete at release head `837d7d12`. Authenticated target-environment Decision Log E2E and live-provider acceptance remain `FOLLOW-UP`.

### Phase 2 — Shared Data and Existing AI Upgrade — `NOT STARTED`
Build the provider-neutral Shared Market Data foundation and a versioned Feature Registry. Upgrade the existing Market Analyst and Position Copilot to consume consistent shared features and Decision Logs. This uLiquid-owned platform work proceeds regardless of the Hummingbot POC result.

### Phase 3 — New Product Features — `NOT STARTED`
Add scanner-only Arbitrage and XEMM experiences. They calculate realistic opportunities and risks but do not perform automated execution.

### Phase 4 — Parallel Infrastructure Validation — `NOT STARTED`
After Phase 1, define the Exchange Gateway by extending the existing adapter/capability foundations and run the isolated Bitget Hummingbot POC against the native Bitget path. Validate data, trading, recovery, latency, resource usage, tenant isolation and multi-account behavior. This may run in parallel with Phases 2–3.

### Decision Gate — `GATED`
Evaluate the POC against the certification criteria. Hummingbot adoption beyond the POC requires an explicit decision based on functional, recovery, security, performance and economic evidence.

### Phase 5 — If the POC Is Successful — `GATED`
Introduce the production Hummingbot CEX Provider behind the existing uLiquid contracts. Add TWAP, DCA and further exchanges only after separate connector/market/executor certification.

### Phase 6 — Advanced — `GATED`
Split advanced work into independent gates: 6A Bot Architect drafts/simulation, 6B explicitly approved deployment, 6C automated Arbitrage after proven dual-leg reconciliation, 6D XEMM after an independent Hedge Watchdog and emergency recovery, and 6E policy-constrained autonomous Agents after the complete permission, risk, audit, replay, evaluation and kill-switch stack is proven.

## 25. Dependency Order

```text
Phase 1: Existing foundations consolidated [IMPLEMENTED]
        │
        ├─→ Phase 2: Shared Market Data / Feature Registry / AI upgrades [NOT STARTED]
        │          ↓
        │   Phase 3: Arbitrage / XEMM Scanners [NOT STARTED]
        │
        └─→ Phase 4: Exchange Gateway / Bitget Hummingbot POC [NOT STARTED]
                   ↓
              DECISION GATE [GATED]
                   ↓ PASS
        Phase 5: HB CEX Provider / TWAP / DCA / Exchanges [GATED]

Phases 2–5 provide the foundations for separately gated Phase 6A–6E work.
```

Work inside a phase can run in parallel. Phase 4 can also run alongside Phases 2–3. Progression to Hummingbot-backed Phase 5 is conditional on documented POC evidence; provider-neutral Shared Market Data is not conditional on that result.

## 26. Recommended First Infrastructure Validation Deliverable

Do not start with a large rewrite.

The roadmap begins by consolidating the Phase 1 foundations. After that review, the Hummingbot validation can run in parallel with the Shared Market Data, AI-upgrade and Scanner work. Build an isolated:

```text
hummingbot-provider-poc
```

with Bitget Market Data, Balances, Positions, Orders and Failure Recovery behind a draft uLiquid Exchange Gateway.

This validates the highest-risk assumption before restructuring existing production code.

## 27. Success Criteria

Integration succeeds if it provides:

```text
less connector maintenance
more exchange coverage
consistent market data
acceptable latency
reliable recovery
secure tenant isolation
economic scaling
no product-level dependency
```

It does not succeed merely because an order can be placed.

## 28. Strategic Product Result

Implemented this way, Hummingbot unlocks:

```text
more CEX coverage
new executor types
cross-market scanning
stronger agent tools
shared deterministic analytics
safer Bot Architect
better observability
future autonomous capability
```

while uLiquid retains its differentiators:

```text
AI Predictions
Prediction Builder
Agent UX
Hyperliquid/HyperEVM/Vaults
Wallet/Funding
ULIQ utility
SaaS subscriptions
```

## 29. Final Recommendation

### PROCEED

Hummingbot is strategically valuable enough to justify integration work.

### INTEGRATE HORIZONTALLY, NOT VERTICALLY

Bad:

```text
uLiquid
↓
Hummingbot
↓
everything
```

Recommended:

```text
uLiquid-owned platform
↓
stable provider interfaces
↓
Hummingbot where useful
```

### First overall priority

**Consolidate the existing Routines + typed Skills + Capability Registry + Agent records, then add Decision Logs and Funding/OI/Orderbook Analytics.**

### First product-facing priority

**Shared Market Data + Feature Registry, then upgrade Market Analyst/Position Copilot and add the Arbitrage/XEMM Scanners.**

### First Hummingbot-specific technical priority

**Parallel Phase 4 Bitget Provider POC + Exchange Gateway validation after the Phase 1 contract review.**

### Advanced automation priority

Only after reconciliation, risk, audit and failure recovery are proven.

---

## Sources

- Hummingbot API
  https://hummingbot.org/hummingbot-api/

- Hummingbot API Routers
  https://hummingbot.org/hummingbot-api/routers/

- Hummingbot Connectors
  https://hummingbot.org/connectors/

- Hummingbot Executors
  https://hummingbot.org/strategies/v2-strategies/executors/

- Hummingbot Skills
  https://hummingbot.org/mcp/skills/

- Condor
  https://hummingbot.org/condor/

- Hummingbot GitHub
  https://github.com/hummingbot/hummingbot

- Hummingbot API GitHub
  https://github.com/hummingbot/hummingbot-api

- Condor GitHub
  https://github.com/hummingbot/condor

---

**Area 8 status: FINAL**
