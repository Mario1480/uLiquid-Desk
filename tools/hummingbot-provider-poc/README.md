# Isolated Hummingbot Bitget public-data POC

This harness compares the existing native uLiquid Bitget path with the actual Hummingbot `bitget_perpetual` connector without production wiring, credentials or private requests. It is disabled unless `ULIQ_HB_POC_ENABLED=true` is supplied explicitly.

## Pinned upstream

- Hummingbot tag: `v2.16.0`
- Hummingbot commit: `8f1906145ba7840c9935cb2151d669e6af21564f`
- Connector: `bitget_perpetual`
- License verified at the tag: Apache-2.0
- Bitget product: `USDT-FUTURES`, V2 public API

The pin is recorded in `versions.json`. The runner rejects a Hummingbot source checkout whose exact `HEAD` differs, whose connector hashes differ, or whose tracked, untracked or ignored files make the worktree non-pristine. The Docker path additionally pins the official multi-architecture image by digest, verifies the local image digest and compares all Bitget perpetual connector source hashes with the pinned checkout before network access. Hummingbot dependencies remain outside npm workspaces, production API/runner images and shared consumer DTOs.

`capabilities.json` is conservative for this authorized slice: ticker, orderbook, funding and mark price are exposed through the pinned connector path; candles, open interest, trades, histories, analytics and every execution capability fail closed. The 2026-09-08 public evidence closes Phase 4 as `partial`; execution remains disabled and unassessed.

## Safety boundary

The harness rejects Bitget credential variables before child processes start. Each child receives an allowlisted environment with an ephemeral home directory, and each probe independently rejects credential-bearing environments. It performs no account, order, cancellation, leverage, margin, position, transfer or other private/capital action. Results contain normalized observations rather than raw provider payloads.

## Deterministic checks

```bash
npm -w packages/futures-exchange run build
node --test tools/hummingbot-provider-poc/comparison.test.mjs \
  tools/hummingbot-provider-poc/run-public-comparison.test.mjs
```

## Bounded public run

Native-only baseline when a Hummingbot runtime is unavailable:

```bash
ULIQ_HB_POC_ENABLED=true node tools/hummingbot-provider-poc/run-public-comparison.mjs \
  --symbol BTCUSDT --samples 3 --depth 25 --timeout-ms 10000
```

For the reproducible Docker comparison, prepare the pinned source checkout, pull the pinned image from `versions.json`, and pass the absolute Docker executable and Unix socket:

```bash
git clone --branch v2.16.0 --depth 1 https://github.com/hummingbot/hummingbot.git /tmp/hummingbot-v2.16.0
test "$(git -C /tmp/hummingbot-v2.16.0 rev-parse HEAD)" = "8f1906145ba7840c9935cb2151d669e6af21564f"
docker pull docker.io/hummingbot/hummingbot@sha256:e222f070d42814013fb5ea7fe537926f790b259512950369da1e15a69dcbd38f
ULIQ_HB_POC_ENABLED=true \
HB_POC_RUNTIME=docker \
HB_POC_HUMMINGBOT_ROOT=/tmp/hummingbot-v2.16.0 \
HB_POC_DOCKER_BIN=/absolute/path/to/docker \
HB_POC_DOCKER_HOST=unix:///absolute/path/to/docker.sock \
node tools/hummingbot-provider-poc/run-public-comparison.mjs \
  --symbol BTCUSDT --samples 3 --depth 25 --timeout-ms 10000 \
  --hummingbot-runs 3
```

Each Hummingbot run starts a fresh read-only container with CPU, RAM, PID, capability and privilege limits. The first run also forces a public WebSocket disconnect and requires a new connection plus a subsequent order-book message. The native side may collect up to ten bounded samples; Docker restarts are capped at three. Missing runtime dependencies remain `blocked`, and an unpaired public result remains `not_assessed`. Public observations never set the full POC to `PASS`.

The original isolated-Python mode remains available by omitting `HB_POC_RUNTIME=docker` and supplying an absolute `HB_POC_PYTHON` from the pinned Hummingbot environment.
