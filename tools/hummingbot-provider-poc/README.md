# Isolated Hummingbot Bitget public-data POC

This harness compares the existing native uLiquid Bitget path with the actual Hummingbot `bitget_perpetual` connector without production wiring, credentials or private requests. It is disabled unless `ULIQ_HB_POC_ENABLED=true` is supplied explicitly.

## Pinned upstream

- Hummingbot tag: `v2.16.0`
- Hummingbot commit: `8f1906145ba7840c9935cb2151d669e6af21564f`
- Connector: `bitget_perpetual`
- License verified at the tag: Apache-2.0
- Bitget product: `USDT-FUTURES`, V2 public API

The pin is recorded in `versions.json`. The runner rejects a Hummingbot source checkout whose exact `HEAD` differs or whose tracked, untracked or ignored files make the worktree non-pristine. It also requires an absolute Python executable path. Hummingbot dependencies remain outside npm workspaces, production API/runner images and shared consumer DTOs; the public comparison still records the separately installed Python environment as an unattested runtime prerequisite.

`capabilities.json` is conservative for this authorized slice: ticker, orderbook, funding and mark price are exposed through the pinned connector path; candles, open interest, trades, histories, analytics and every execution capability fail closed. Certification starts as `not_assessed`.

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

For a full public comparison, prepare an isolated Hummingbot source checkout at the pinned commit and use the Python executable from its installed Hummingbot environment:

```bash
git clone --branch v2.16.0 --depth 1 https://github.com/hummingbot/hummingbot.git /tmp/hummingbot-v2.16.0
test "$(git -C /tmp/hummingbot-v2.16.0 rev-parse HEAD)" = "8f1906145ba7840c9935cb2151d669e6af21564f"
ULIQ_HB_POC_ENABLED=true \
HB_POC_HUMMINGBOT_ROOT=/tmp/hummingbot-v2.16.0 \
HB_POC_PYTHON=/path/to/hummingbot/python \
node tools/hummingbot-provider-poc/run-public-comparison.mjs \
  --symbol BTCUSDT --samples 3 --depth 25 --timeout-ms 10000
```

The Hummingbot probe intentionally produces one connector observation per run. The native side may collect up to ten bounded samples. Missing runtime dependencies remain `blocked`, and an unpaired public result remains `not_assessed`. Public observations never set the full POC to `PASS`.
