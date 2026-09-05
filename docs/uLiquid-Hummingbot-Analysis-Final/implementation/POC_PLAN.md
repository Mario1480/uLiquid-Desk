# Hummingbot Provider POC Plan

**Implementation status:** `NOT STARTED`

The POC has not been executed and the Decision Gate remains `GATED`. Start the comparison only after the Phase 1 target-environment closeout and a stable native Bitget baseline.

## Roadmap Placement
This POC is the parallel Phase 4 infrastructure-validation track. It begins only after the Phase 1 contract review and may run alongside the provider-neutral Shared Market Data, existing-AI upgrade and Scanner work. Its result gates production Hummingbot adoption in Phase 5; it does not gate the uLiquid-owned Shared Market Data platform.

## Benchmark
A: uLiquid → Native Bitget → Bitget
B: uLiquid → Exchange Gateway → Hummingbot Provider → Bitget

## Stage 1 — Contracts
Define ExchangeProvider, MarketDataProvider, CapabilityDescriptor, ExecutionIntent and ProviderHealth.

## Stage 2 — Happy Path
Test credentials, ticker/orderbook/candles/funding, trading rules, balances, positions, leverage, one-way/hedge, market/limit orders, cancellation, partial/full fills and close/reduce.

## Stage 3 — Failure/Recovery
Test WS disconnect, timeouts, 429/5xx, HB restart, Desk restart, disconnect after submit, restart with open/partial orders and positions, unknown submission state and duplicate requests.

Required: **0 duplicate orders, 0 lost orders after recovery, 0 unexplained position drift.**

## Stage 4 — Performance
Compare submit/cancel/fill latency, position updates, reconnect/recovery, CPU, RAM and error rate.

## Stage 5 — Multi-Account
Test 1/10/25/50/100/250 accounts and determine empirical shard sizing.

## Stage 6 — Security
Private HB ingress only; strict tenant mapping; no Agent/browser secrets; Read+Trade only; shard isolation; redacted logs; credential re-provisioning.

## Decision
PASS → certify more CEXs/executors.
PARTIAL → use HB only for successful capabilities.
FAIL → retain native execution and use HB selectively/reference-only.
