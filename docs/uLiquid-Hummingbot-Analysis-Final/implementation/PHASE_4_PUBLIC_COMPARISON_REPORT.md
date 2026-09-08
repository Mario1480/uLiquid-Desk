# Phase 4 Bitget public-data comparison report

Status: `PARTIAL — NATIVE BASELINE OBSERVED; HUMMINGBOT RUNTIME BLOCKED`

Observation time: 2026-09-08T17:41:56.745Z. This report records one bounded public read run. It is not private connector certification, production evidence or a Phase 4 Decision Gate result.

## Reproducible inputs

- uLiquid base: `main` at `d637371e819ebc21f2254bcc8b171dce3d181f25` before this local change.
- Hummingbot: tag `v2.16.0`, commit `8f1906145ba7840c9935cb2151d669e6af21564f`, Apache-2.0.
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
| Sample latency p50 | 307 ms |
| Sample latency p95 | 404 ms |
| Provider timestamp lag | 123–143 ms |
| Order-book levels | 25 bids + 25 asks per sample |
| Funding rate | 0.00009 |
| Funding interval | 8 hours |
| Open interest | 35,075.7059 BTC (provider field `size`) |
| Tick / step / minimum quantity | 0.1 / 0.0001 / 0.0001 |
| Process CPU | 176,713 µs |
| Process RSS at completion | 104,873,984 bytes |

Ticker, non-crossed orderbook, two 1-minute candles, funding, open interest and trading rules were present in every native sample. The observations were fetched concurrently and are not atomic. No claim is made that three samples characterize long-run latency, error rate, reconnect behavior or resource economics.

## Hummingbot attempt

The isolated runner verified that no configured Hummingbot source/runtime was available. The local Docker client is installed, but the Docker daemon socket was unavailable. Therefore the actual connector process could not start, no Hummingbot request was made and there are zero paired samples.

Result: public comparison decision `not_assessed`; full POC status `not_assessed`. Native success is not relabeled as Hummingbot evidence.

## Implemented deterministic evidence

- Fail-closed capability descriptor with execution disabled and certification `not_assessed`.
- Typed provider observations and health states.
- Canonical execution identity and idempotency boundary without an execution router.
- Order-book rejection for malformed, empty and crossed books.
- Explicit missing, future and stale timestamp states.
- Contract-to-base quantity conversion with required contract size.
- Bounded timeout and retry behavior.
- Synthetic tenant/account binding and recursive secret redaction.
- The coordinator rejects Bitget credentials before spawning children, passes an allowlisted environment with an ephemeral home, and requires an exact pristine Hummingbot source pin plus an absolute Python executable path.
- Comparator validates provider identity, status, venue, market, symbol and required sample structure; it preserves observation skew and cannot produce full POC `PASS`.
- A scoped security review found no remaining reportable finding in this manual public-read slice. The unattested Python dependency environment, lack of OS-level resource/egress sandboxing and future authenticated persistence/execution enforcement remain explicit follow-up gates.

## Remaining Phase 4 gates

1. Run the pinned Hummingbot connector in its isolated Python environment and collect paired public samples.
2. Add controlled reconnect/restart/resource observations for the isolated public connector.
3. Obtain separate authorization before any sandbox/demo authentication, account reads or order lifecycle test.
4. Preserve private execution/recovery and multi-account stages from `POC_PLAN.md`; they are required before a full `PASS`, `PARTIAL` or `FAIL` decision.

The current evidence supports continuing the public POC after the runtime prerequisite is available. It does not support Hummingbot adoption, provider switching, production endpoint exposure, TWAP/DCA, additional connectors or Phase 5.
