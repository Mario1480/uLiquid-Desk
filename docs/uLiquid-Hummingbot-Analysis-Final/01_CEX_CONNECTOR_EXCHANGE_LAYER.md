# uLiquid Desk × Hummingbot Analysis
## 01 — CEX Connector & Exchange Layer

**Status:** Completed analysis / POC recommended
**Decision:** ADOPT uLiquid abstraction; INTEGRATE Hummingbot as optional CEX provider after POC
**Primary POC:** Bitget Perpetual

## 1. Objective
Determine whether Hummingbot can replace a substantial portion of uLiquid Desk's custom CEX connector maintenance while preserving uLiquid's control over security, tenancy, risk, product logic, AI permissions, and Hyperliquid/HyperEVM-specific infrastructure.

> **uLiquid owns the interface. Hummingbot implements part of it.**

Hummingbot remains an interchangeable infrastructure provider rather than a foundational product dependency.

## 2. Target Architecture
```text
uLIQUID DESK
  ↓
Authentication / Tenant / RBAC
  ↓
Risk Engine
  ↓
Exchange Gateway
  ↓
Capability / Provider Layer
  ├─ Native Providers → Paper / Hyperliquid / HyperCore / HyperEVM / Vault V3
  └─ HB Provider → Hummingbot API Cluster → CEX Connectors
```
Hummingbot API must never be exposed directly to the browser, mobile app, user, or AI agent.

## 3. Why Hummingbot Is Relevant
Hummingbot can provide a standardized layer for exchange authentication, REST/WebSockets, market data, balances, positions, orders, fills, leverage/position modes, trading rules, multiple exchange accounts, and bot/executor orchestration. This can eliminate substantial exchange-specific maintenance.

## 4. Exchange Candidate Matrix
### Tier A — Preferred Hummingbot candidates
- Binance — Spot + Perpetual
- Bitget — Spot + Perpetual
- OKX — Spot + Perpetual
- Gate.io — Spot + Perpetual
- KuCoin — Spot + Perpetual

### Tier B — Additional QA required
- Bybit
- BitMart
- Gemini
- Kraken
- Coinbase
- MEXC
- HTX
- Bitstamp

Some are Spot-only or community-maintained and require additional reliability/capability testing.

### Tier C — Native/custom connector if required
- LBank
- XT
- WEEX

If strategically important, uLiquid can retain/build its own provider or contribute a compatible Hummingbot connector.

### Special case — Hyperliquid
**Retain native uLiquid integration.** Hummingbot does not replace uLiquid's deeper HyperCore, HyperEVM, Vault V3, CoreWriter, wallet/funding, profit-share and smart-contract infrastructure.

## 5. uLiquid Capability Layer
Desk should consume explicit capabilities rather than hard-coded exchange names.

```text
MarketCapabilities: spot, perpetual, margin, testnet
OrderCapabilities: market, limit, limitMaker, stop, stopLimit, takeProfit, reduceOnly, IOC, FOK
PositionCapabilities: oneWay, hedge, leverage, isolatedMargin, crossMargin, positionModeSwitch
DataCapabilities: ticker, orderbook, trades, candles, funding, openInterest, markPrice
AccountCapabilities: balances, positions, fills, orderHistory, fundingHistory
OperationalCapabilities: websocket, paperTrading, exchangeTestnet, reconnect, orderReconciliation, rateLimitHandling
```

## 6. Proposed Provider Interface
```text
ExchangeProvider
getMarkets()
getTicker()
getOrderbook()
getCandles()
getBalance()
getPositions()
placeOrder()
cancelOrder()
getOrders()
getTrades()
setLeverage()
setPositionMode()
```
Implementations: `HummingbotExchangeProvider`, `HyperliquidNativeProvider`, `PaperExchangeProvider`, and future native providers.

## 7. Connector Certification
Every exchange/provider combination should pass uLiquid certification covering authentication, market data, account state, trading and operational reliability. Tests include invalid/revoked keys, balances, positions, ticker/orderbook/candles/funding, trading rules, market/limit orders, cancellation, partial/full fills, reconnect, restart recovery, reconciliation, rate limits and duplicate-order protection.

## 8. Multi-Tenant Architecture
Hummingbot multi-account support is not equivalent to SaaS tenant isolation. uLiquid remains tenant authority.

```text
uLiquid User ID → ExchangeConnection ID → Provider Mapping → Internal HB Account
```
Clients submit only an opaque `exchangeConnectionId`; internal HB account names, shard IDs and provider references remain server-side.

## 9. Security Boundary
Forbidden: `Browser → HB`, `iOS → HB`, `AI Agent → HB`.

Required path:
```text
Client → uLiquid API → Authentication → Tenant/Entitlement → Permission → Risk Engine → Exchange Gateway → HB Provider
```
AI agents produce intents only and never resolve credentials/provider account identifiers.

## 10. Credential Security
uLiquid should remain the secret source of truth using a dedicated credential service and envelope encryption backed by KMS/HSM-style key management. Web, AI, prediction and strategy services have no direct secret access. CEX API keys should normally allow **READ + TRADE only**, never withdrawal. Where possible use exchange-side IP whitelisting to stable uLiquid execution egress addresses.

## 11. Sharding and Blast Radius
Reject both one global HB instance for all users and one full HB API deployment per user. Prefer horizontally scalable shards. Exact accounts-per-shard must be benchmarked. Isolate service credentials, encryption/configuration secrets, monitoring and preferably data domains per shard. uLiquid must be able to rebuild a failed shard and reprovision connections.

## 12. Shared vs Tenant-Specific Data
Market data should be shared wherever practical and consumed by Trading UI, Predictions, Agents, Bots and Risk. Account-specific balances, positions, private orders and fills remain tenant-specific.

## 13. Performance Benchmark
Benchmark concurrent accounts (1/10/25/50/100/250/500), market subscriptions, order throughput and executors. Measure CPU, RAM, DB/MQTT load, WebSocket lag, order latency, fill detection, reconnect/recovery times and errors. Determine shard size from measured evidence, not assumptions.

## 14. Failure Handling and Recovery
Recommended order states:
```text
PENDING_SUBMIT, SUBMITTED, OPEN, PARTIALLY_FILLED, FILLED,
CANCEL_PENDING, CANCELLED, UNKNOWN, RECONCILING, FAILED
```
`UNKNOWN` is critical: a submit timeout must not trigger an automatic duplicate submission. Reconcile first against exchange state/client order ID.

## 15. Idempotency and Order Identity
Every execution receives a uLiquid execution ID before the provider call:
```text
uLiquidExecutionId → Provider ClientOrderId → Exchange OrderId
```
Execution requests carry idempotency keys. SaaS-wide idempotency belongs above Hummingbot.

## 16. Reconciliation Authority
```text
Exchange State            ← highest authority
Provider/Hummingbot State ← execution tracking
uLiquid DB                ← product/audit state
Agent State               ← no execution authority
```
Use realtime private WebSocket events plus periodic REST reconciliation. An LLM never determines whether an order actually filled.

## 17. Kill Switches
Implement independent user, exchange-connection, bot, agent-execution and provider/system kill switches.

## 18. Disaster Recovery
```text
HB shard failure → replacement shard → reprovision connections → reconcile exchange orders/positions → resume
```
Recovery prioritizes exchange state over stale internal state.

## 19. Licensing / OEM
Current analysis: Hummingbot Core and Gateway use Apache 2.0; Hummingbot API uses MIT. These are permissive licenses generally compatible with internal use in a proprietary commercial SaaS subject to applicable notice/license obligations. Maintain `THIRD_PARTY_NOTICES.md`. Exchange API commercial Terms of Service remain a separate production requirement. Obtain final legal/licensing review before launch.

## 20. Bitget Perpetual POC
Compare identical tests against:
```text
A: uLiquid → Native Bitget Adapter → Bitget
B: uLiquid → Exchange Gateway → HB Provider → HB API → Bitget
```
Functional tests: credentials, market data, trading rules, balances, positions, market/limit/cancel, partial/full fills, one-way/hedge, leverage and closing positions.

Failure tests: WebSocket disconnect, API timeout, HB/Desk/DB restart, HTTP 429/5xx, timeout/disconnect during order submission, restart with open/partial order or position. Validate zero duplicate/lost orders, correct positions/balances and complete recovery.

Performance metrics: market/limit submit latency, cancel latency, fill detection, position update, reconnect/restart recovery, RAM, CPU and error rate.

## 21. POC PASS Criteria
| Requirement | Target |
|---|---|
| Duplicate orders after failure | **0** |
| Lost orders after recovery | **0** |
| Position drift | **0** |
| Tenant leakage | **0** |
| Restart recovery | Complete |
| WebSocket reconnect | Automatic |
| REST reconciliation | Required |
| Hedge mode / leverage | Correct where advertised |
| Trading rules | Correct |
| Order/fill mapping | Correct |
| API-key isolation | Verified |
| Latency overhead | Operationally acceptable |
| 100+ accounts | Stable baseline target |
| Resource consumption | Economically viable |

## 22. Decision Outcomes
- **A — Strong:** Use HB Provider for major CEXs.
- **B — Trading good, bot layer weak:** HB for market/manual trading; native bot execution.
- **C — Data good, execution weak:** HB for data/analytics only; native execution.
- **D — Insufficient:** retain native connector layer and use HB as reference only.

## 23. Final Decision for Area 1
**ADOPT**
- uLiquid Exchange Gateway
- Capability Layer
- uLiquid tenant/security authority
- shared market-data principle
- certification framework
- idempotency and reconciliation safety layer

**INTEGRATE / POC**
- Hummingbot as interchangeable CEX provider
- Bitget Perpetual as first benchmark

**ADAPT**
- Hummingbot connector QA concepts
- recovery/reconciliation patterns
- horizontal worker/shard concepts

**RETAIN NATIVE**
- Hyperliquid / HyperCore / HyperEVM / Vault V3 infrastructure
- uLiquid Paper Exchange where appropriate

**REJECT**
- Hummingbot as SaaS tenant/auth authority
- direct frontend/mobile/agent access to Hummingbot
- one global unisolated Hummingbot deployment
- one full Hummingbot API deployment per user

## 24. Overall Assessment
Hummingbot is a strong candidate to reduce uLiquid's CEX integration and maintenance burden, particularly for major Spot/Perpetual exchanges. The preferred model is hybrid: uLiquid retains product, security, risk, AI and Hyperliquid-specific ownership while Hummingbot operates behind a provider abstraction as replaceable CEX infrastructure.

The next analysis area is **02 — Execution Engine & Executors**.
