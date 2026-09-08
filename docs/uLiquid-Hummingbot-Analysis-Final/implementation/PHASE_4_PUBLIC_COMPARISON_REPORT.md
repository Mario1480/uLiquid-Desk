# Phase 4 Bitget public-data comparison report

Status: `COMPLETE — PUBLIC COMPARISON OBSERVED; PHASE 4 DECISION PARTIAL`

Observation time: 2026-09-08T19:35:23.195Z. This report records one bounded public comparison with three fresh Hummingbot process starts and a controlled public WebSocket reconnect. It is not private connector certification or production evidence.

## Reproducible inputs

- uLiquid base: `main` at `6668b0198bedb9d47f0e0afff77b004a847981db` before the runtime closeout changes.
- Hummingbot: tag `v2.16.0`, commit `8f1906145ba7840c9935cb2151d669e6af21564f`, Apache-2.0.
- Runtime image: `docker.io/hummingbot/hummingbot@sha256:e222f070d42814013fb5ea7fe537926f790b259512950369da1e15a69dcbd38f`; selected ARM64 manifest `sha256:945c034735d204b3c19d44ad5d7d3f7dbe20e187a3a0bfad84822030d5474dd3`.
- Hummingbot connector: `bitget_perpetual`.
- Bitget market: `BTCUSDT`, `USDT-FUTURES`, V2 public API.
- Requested observations: 3; order-book depth: 25; per-request timeout: 10 seconds; at most two native transport attempts.
- No credentials, account data, private requests or execution operations were used.

The pinned Hummingbot connector source exposes public ticker, order-book, funding/mark-price and trading-rule paths. Its selected connector probe does not expose candles or open interest. Those fields fail closed in the POC capability manifest. Upstream source and Bitget documentation were checked on 2026-09-08; future upgrades require a new pin and revalidation.

## Observed native results

| Metric | Result |
|---|---:|
| Successful samples | 3 / 3 |
| HTTP request attempts | 18 |
| Sample latency p50 | 298 ms |
| Sample latency p95 | 632 ms |
| Order-book levels | 25 bids + 25 asks per sample |
| Process CPU | 185,800 µs |
| Process RSS at completion | 105,840,640 bytes |

Ticker, non-crossed orderbook, two 1-minute candles, funding, open interest and trading rules were present in every native sample. The observations were fetched concurrently and are not atomic. No claim is made that three samples characterize long-run latency, error rate, reconnect behavior or resource economics.

## Hummingbot observations

The pinned connector completed 3/3 fresh-container observations. Ticker, non-crossed orderbook, funding, mark price and trading rules were present in every sample. Candles and open interest remain unsupported at this provider boundary. Connector request-attempt instrumentation remains unavailable.

| Metric | Result |
|---|---:|
| Successful samples | 3 / 3 |
| Sample latency p50 | 3,007 ms |
| Sample latency p95 | 5,741 ms |
| Fresh container runs | 3 / 3 successful |
| Container wall times | 6,807 / 3,930 / 3,825 ms |
| Total process CPU | 2.683 seconds |
| Maximum process RSS | 147,398,656 bytes |
| Controlled WebSocket reconnect | initial message, reconnect and post-reconnect message observed in 2,713 ms |

The official image did not carry the Hummingbot commit in its image labels. The harness therefore verifies the immutable image digest and all eight Bitget perpetual connector source hashes against the pristine checkout at the pinned commit before any public network request.

The comparison produced three non-atomic pairs with 7.4–14.6 second observation skew. Ticker and top-of-book relative differences ranged from 0 to 0.0082%; the observed funding rate matched in all three pairs. These differences are descriptive only because the observations were sequential and market state changed between reads. Hummingbot latency includes cold process/container startup and the first-run reconnect check, so it is not a steady-state transport benchmark.

## Implemented deterministic evidence

- Fail-closed capability descriptor with execution disabled and public-slice certification `partial` after the Decision Gate closeout.
- Typed provider observations and health states.
- Canonical execution identity and idempotency boundary without an execution router.
- Order-book rejection for malformed, empty and crossed books.
- Explicit missing, future and stale timestamp states.
- Contract-to-base quantity conversion with required contract size.
- Bounded timeout and retry behavior.
- Synthetic tenant/account binding and recursive secret redaction.
- The coordinator rejects Bitget credentials before spawning children, passes an allowlisted environment with an ephemeral home, and requires an exact pristine Hummingbot source pin plus an absolute runtime executable path.
- Comparator validates provider identity, status, venue, market, symbol and required sample structure; it preserves observation skew and cannot produce full POC `PASS`.
- A scoped security review found no remaining reportable finding in this public-read slice. The Docker process now has read-only filesystem, CPU/RAM/PID, capability and privilege limits. Network egress restriction and future authenticated persistence/execution enforcement remain explicit follow-up gates.

## Decision boundary

The public provider slice passes for ticker, orderbook, current funding, mark price and trading rules. It does not pass candles, open interest, authentication, balances, positions, leverage/margin, order/fill/cancel/close, unknown-submission recovery, private restart recovery or empirical multi-account scaling.

No Bitget credentials are present in the POC environment, and no demo account, allowed order operations or numerical exposure limits were supplied. The Decision Gate therefore closes as `PARTIAL`. Phase 5 remains gated because only a full `PASS` permits production-adoption consideration. See the [dated decision evidence](../../archive/tasks/2026-09-08-phase4-hummingbot-bitget-decision.md).
