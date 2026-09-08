# Phase 4 Hummingbot Bitget Decision

Status: `COMPLETE — PARTIAL`, 2026-09-08.

Phase 4 is closed with a `PARTIAL` Decision Gate result. The isolated Hummingbot `v2.16.0` Bitget perpetual provider is suitable for continued public-data evaluation behind uLiquid-owned contracts. The evidence does not authorize production routing, private accounts, order execution, TWAP/DCA, additional connectors or Phase 5.

## Evidence

- The provider-neutral capability, health, execution-identity, tenant-binding and diagnostic-redaction contracts are additive and do not change API, runner or product routing.
- Hummingbot source is pinned to commit `8f1906145ba7840c9935cb2151d669e6af21564f`.
- The official runtime is pinned to multi-architecture digest `sha256:e222f070d42814013fb5ea7fe537926f790b259512950369da1e15a69dcbd38f`; the observed ARM64 manifest is `sha256:945c034735d204b3c19d44ad5d7d3f7dbe20e187a3a0bfad84822030d5474dd3`.
- The harness verified all eight Bitget perpetual connector file hashes in the runtime against the pristine pinned source checkout before public network access.
- Native Bitget completed 3/3 BTCUSDT observations with p50/p95 sample latency of 298/632 ms and 18 instrumented HTTP attempts.
- Hummingbot completed 3/3 fresh-container observations with p50/p95 sample latency of 3,007/5,741 ms. The three container wall times were 6,807, 3,930 and 3,825 ms.
- A forced public WebSocket disconnect recovered in 2,713 ms; an initial message, a new connection and a post-reconnect order-book message were observed.
- Hummingbot used 2.683 aggregate CPU seconds across the three fresh processes and at most 147,398,656 bytes RSS. Containers were read-only and bounded to 2 CPUs, 2 GiB RAM and 256 PIDs with all Linux capabilities dropped and privilege escalation disabled.
- The three sequential comparison pairs had 7.4–14.6 seconds of skew. Ticker and top-of-book relative differences were 0–0.0082%; observed funding rates matched. The skew prevents atomic-equality or steady-state latency claims.
- Deterministic checks cover fail-closed capabilities, malformed/empty/crossed books, timestamp quality, quantity units, timeout/retry bounds, credential rejection, tenant/account binding, canonical execution identity and recursive secret redaction.

## Decision

`PARTIAL` applies only to public ticker, orderbook, current funding, mark price, trading rules, bounded process restart and public WebSocket reconnect behavior.

Private authentication, balances, positions, leverage/margin, market/limit orders, cancellation, fills, close/reduce, disconnect-after-submit recovery, duplicate/lost-order guarantees, private restart recovery and 1/10/25/50/100/250-account scaling are `NOT ASSESSED`. No credentials were present, and no demo account, allowed order operations or numerical exposure limits were supplied. Synthetic boundaries do not replace those observations.

The required full-POC guarantees of zero duplicate orders, zero lost orders after recovery and zero unexplained position drift are therefore unproven. Phase 5 remains `GATED`. A later reassessment requires a Bitget demo environment with Read+Trade credentials that cannot withdraw or transfer, explicit allowed operations and limits, and a fresh evidence run.

No deployment, production configuration, migration, provider switch, credential change or capital action occurred.
