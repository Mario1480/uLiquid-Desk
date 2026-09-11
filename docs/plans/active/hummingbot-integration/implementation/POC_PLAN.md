# Hummingbot Provider POC Plan

**Implementation status:** `COMPLETE — DECISION PARTIAL`, 2026-09-08

The bounded public POC and deterministic boundary suite are complete. Ticker, orderbook, current funding, mark price, trading rules, fresh-process restart and public WebSocket reconnect are observed. Private account/execution/recovery and empirical multi-account stages remain `NOT ASSESSED` because no demo credentials, account scope, allowed operations or numerical limits were available. The Decision Gate is closed as `PARTIAL`; Phase 5 remains gated.

On 2026-09-10, Mario deferred the private certification until he can create and use a separate Bitget Demo API Key. The connected Bitget account is live and remains excluded from Hummingbot order, recovery and disruption testing. See the [deferral record](../../../../archive/tasks/2026-09-10-phase4-private-certification-deferred.md).

See the [decision record](../../../../archive/tasks/2026-09-08-phase4-hummingbot-bitget-decision.md) and [public comparison report](PHASE_4_PUBLIC_COMPARISON_REPORT.md).

| Stage | Closeout |
|---|---|
| 1 — Contracts | `COMPLETE` for additive local contracts |
| 2 — Happy Path | `PARTIAL`: public market data observed; every private/account/order capability `NOT ASSESSED` |
| 3 — Failure/Recovery | `PARTIAL`: deterministic failures, fresh-process restart and public WebSocket reconnect observed; execution recovery `NOT ASSESSED` |
| 4 — Performance | `PARTIAL`: bounded cold-process public latency/CPU/RAM recorded; private submit/cancel/fill and steady-state scaling `NOT ASSESSED` |
| 5 — Multi-Account | `NOT ASSESSED` |
| 6 — Security | `PARTIAL`: synthetic tenant/identity/redaction and isolated public container boundaries verified; private credential lifecycle and shard isolation `NOT ASSESSED` |

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
