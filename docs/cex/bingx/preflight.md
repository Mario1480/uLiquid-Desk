# CEX Preflight — BingX (Spot + USD-M Perp)

Status: implemented for native REST v1. Spot and USD-M perpetual swap public/private REST endpoints are available for the platform paths currently used by manual trading, account sync, Paper-linked market data, Prediction Copier, and Grid.

## Docs / References
- Spot trading symbols: https://bingx-api.github.io/docs-v3/#/en/Spot/Market%20Data/Spot%20trading%20symbols
- Swap contracts: https://bingx-api.github.io/docs-v3/#/en/SwapV2/market-api.html#Contracts
- Signature authentication: https://bingx-api.github.io/docs-v3/#/en/Quick%20Start/Signature%20Authentication
- Symbol price ticker: https://bingx-api.github.io/docs-v3/#/en/Spot/Market%20Data/Symbol%20Price%20Ticker

## Base URLs
- Base (PROD): https://open-api.bingx.com
- Base (VST): https://open-api-vst.bingx.com

## Auth (private endpoints)
- HMAC SHA256 signing with query string.
- Required headers / query:
  - `X-BX-APIKEY` header
  - `timestamp` (ms)
- `recvWindow` (ms), default in runtime: `BINGX_RECV_WINDOW_MS=5000`
  - `signature` (HMAC SHA256 of the sorted query string)
- Signing details (from doc example):
  - Sort params by key.
  - Build `paramsStr` as `k=v&...` and append `timestamp`.
  - Signature = HMAC_SHA256(secret, paramsStr), hex.
  - Request URL: `?{urlParamsStr}&signature={sig}`
  - JSON-valued params such as `takeProfit` / `stopLoss` are signed as raw values and URL-encoded for transport.

## Rate Limits
- IP rate limit: 500 requests / 10 seconds (symbols endpoint).
- 429 handling required.

## Symbols / Precision
- Symbol format in API: "BASE-QUOTE" (e.g., `BTC-USDT`).
- Symbols endpoint: `GET /openApi/spot/v1/common/symbols`
  - Fields: `tickSize`, `stepSize`, `minNotional`, `maxNotional`, `maxMarketNotional`, `status`, `apiStateBuy`, `apiStateSell`, `timeOnline`, `offTime`, `maintainTime`, `displayName`.
  - `minQty`/`maxQty` are deprecated; calculate via notional / price.

## Runtime Defaults

- Venue id: `bingx`
- REST base: `BINGX_REST_BASE_URL=https://open-api.bingx.com`
- Spot flag: `BINGX_SPOT_ENABLED=1`
- Perp flag: `BINGX_PERP_ENABLED=1`
- Perp write kill switch: `BINGX_PERP_WRITE_ENABLED=1` by default; set `0` to block live writes.
- Credentials: `apiKey` + `apiSecret`; no passphrase.
- Canonical symbol: `BTCUSDT`; BingX REST symbol: `BTC-USDT`.

## Required Endpoints (Spot)

### Public
- Symbols / exchange info:
  - GET /openApi/spot/v1/common/symbols
- Ticker / mid price:
  - GET /openApi/spot/v1/ticker/bookTicker
  - Params: symbol (required)
  - Response: bidPrice/bidVolume, askPrice/askVolume
- Orderbook (optional):
  - GET /openApi/spot/v1/market/depth
  - Params: symbol (required), limit (default 20, max 1000)
  - Response: bids/asks arrays [price, qty], ts (ms)
- Recent trades (public):
  - GET /openApi/spot/v1/market/trades
  - Params: symbol (required), limit (default 100, max 500)

### Private
- Balances:
  - GET /openApi/spot/v1/account/balance
  - Params: recvWindow (optional), timestamp (required)
  - Response: balances[] with { asset, free, locked }
- Open orders:
  - GET /openApi/spot/v1/trade/openOrders
  - Params: symbol (optional), recvWindow, timestamp
  - Response: orders[] with orderId, price, origQty, executedQty, cummulativeQuoteQty, status, type, side, time, updateTime
- Query order details:
  - GET /openApi/spot/v1/trade/query
  - Params: symbol (required), orderId or clientOrderID, recvWindow, timestamp
  - Response includes executedQty, avgPrice, fee, feeAsset, status, time, updateTime
- Place order:
  - POST /openApi/spot/v1/trade/order
  - Params:
    - symbol (e.g. BTC-USDT)
    - side: BUY/SELL
    - type: MARKET/LIMIT/TAKE_STOP_LIMIT/TAKE_STOP_MARKET/TRIGGER_LIMIT/TRIGGER_MARKET
    - stopPrice (required for stop/trigger types)
    - quantity or quoteOrderQty (quantity takes priority)
    - price (required for LIMIT types)
    - newClientOrderId (1–40 chars, letters/numbers/_)
    - timeInForce: PostOnly/GTC/IOC/FOK
    - recvWindow (ms)
    - timestamp (ms)
  - Notes:
    - Market BUY requires quoteOrderQty; Market SELL requires quantity.
    - For copy-trading spot traders, SELL may require a different endpoint.
- Cancel order:
  - POST /openApi/spot/v1/trade/cancel
  - Params: symbol, orderId or clientOrderID, cancelRestrictions (optional), recvWindow, timestamp
- Cancel all:
  - POST /openApi/spot/v1/trade/cancelOpenOrders
  - Params: symbol (optional), recvWindow, timestamp
  - Response: order fields (same shape as cancel order)
- Trades / fills:
  - GET /openApi/spot/v1/trade/myTrades
  - Params: symbol, startTime, limit, recvWindow, timestamp
  - Used by native `getMyTrades`; `historyOrders` remains order-history only.

## Required Endpoints (USD-M Perp)

### Public
- Server time: `GET /openApi/swap/v2/server/time`
- Contracts / precision: `GET /openApi/swap/v2/quote/contracts`
- Ticker / mid: `GET /openApi/swap/v2/quote/bookTicker`
- Klines: `GET /openApi/swap/v3/quote/klines`
- Depth: `GET /openApi/swap/v2/quote/depth`
  - Public-depth correction, locally verified 2026-09-06: the normalized perpetual client maps requested coverage to the next supported size in `5, 10, 20, 50, 100, 500`, then trims returned levels to its existing 5–200-level coverage bound. Non-finite requests use 50. A request for 25 therefore fetches 50, not the rejected native limit 25.
  - Provider timestamps remain unchanged; no request-time timestamp or replacement levels are invented. The patched public client smoke returned 25 bids/asks with a provider timestamp and an uncrossed book. Funding/OI support and private signing/execution are unchanged. This is not production deployment or live trading certification; see [local correction evidence](../../archive/tasks/2026-09-06-phase2-copilot-local-corrections.md).
- Recent trades: `GET /openApi/swap/v2/quote/trades`

### Private
- Balance: `GET /openApi/swap/v3/user/balance`
- Positions: `GET /openApi/swap/v2/user/positions`
- Position mode: `GET /openApi/swap/v1/positionSide/dual`
- Open orders: `GET /openApi/swap/v2/trade/openOrders`
- Place order: `POST /openApi/swap/v2/trade/order`
  - Market/limit, `reduceOnly`, `positionSide`
  - Entry TP/SL through JSON `takeProfit` / `stopLoss`
  - Position TP/SL through `STOP_MARKET` / `TAKE_PROFIT_MARKET`, `closePosition=true`
- Cancel order: `DELETE /openApi/swap/v2/trade/order`
- Cancel all: `DELETE /openApi/swap/v2/trade/allOpenOrders`
- Leverage: `POST /openApi/swap/v2/trade/leverage`
- Margin type: `POST /openApi/swap/v2/trade/marginType`

## ClientOrderId Support
- newClientOrderId supported on place order.
- Open orders response example does not show clientOrderID (confirm if available).

## Liquidation Snapshot Contract — Local Correction (2026-09-06)

Status: published and deployed to production API/web on 2026-09-06 at code commit `0128b6f7a`. Runtime health and synthetic checks passed; a fresh authenticated user analysis remains the acceptance follow-up. See the [release evidence](../../archive/tasks/2026-09-06-liquidation-zero-production-release.md).

The native positions endpoint can report a numeric `liquidationPrice: 0`. Preserve that value instead of collapsing it into missing data. The official [BingX account API reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/swap-account/SKILL.md) identifies the positions endpoint and field. The [CCXT BingX parsing discussion](https://github.com/ccxt/ccxt/pull/30034) independently describes a zero-price sentinel; it is not a guarantee about future liquidation risk.

- Shared normalization preserves numeric/string zero and returns a null liquidation distance, even if a conflicting zero distance is supplied.
- BingX Copilot snapshots expose `liquidationStatus: no_liquidation_price`; this state does not cause a proximity warning or a missing-distance warning.
- Missing, blank, invalid and non-finite values remain unavailable. Zero semantics for other venues are not certified by this change and remain degraded in Copilot.
- A positive liquidation price with a genuine zero/negative distance remains critical. Drawdown, missing stop-loss and stale/incomplete data warnings remain active.
- Desktop/mobile positions display a localized no-price label; unavailable distances are not colored as zero-distance alarms.
- Position snapshot/risk routines are `1.1.0`; affected account-position/risk skills are version `2`; built-in Position Copilot is version `6`. The direct Copilot cache namespace is `v3`.
- Existing conversations and Decision Logs remain historical evidence. They are not rewritten; corrected analysis requires a new run after rollout.

Validation: futures-core 19/19; focused futures-exchange contracts/metrics 20/20; Agent Chat 101/101; Copilot/trading 39/39; Agent Chat UI 9/9; futures-exchange build, API typecheck, i18n integrity and whitespace checks passed. Focused tests and Agent Chat completed naturally without forced process termination.

Release validation: API and web typechecks passed on the clean `origin/main` release base, which already contains the independent dashboard layout correction absent from the original local checkout. Both Docker production builds passed. No new migration was introduced or applied; runtime configuration and unrelated service containers remained unchanged.

Remaining acceptance: the initial local browser attempt at `http://127.0.0.1:3107/en/trade` with synthetic-only API data was not established (Turbopack redirect loop; Webpack DOM-readiness timeout). This is not evidence of a production routing failure. A fresh authenticated analysis and desktop/mobile rendering review of the corrected zero-price state remain pending after the successful production deployment. No private position details, exchange writes, or new AI calls were used for release validation.

## Time-in-force / Post-only
- TBD (confirm post-only + TIF values)

## Error Handling
- JSON error payload with code/msg (confirm exact fields).
- 429 indicates rate limit; implement backoff + cache.

## Preflight Checklist
- [x] Confirm public Spot symbols/ticker/kline and Swap contracts/bookTicker/kline return `code:0`
- [x] Confirm symbol format + precision fields
- [x] Implement sorted query signing and JSON-param URL encoding tests
- [x] Implement native Spot balances/orders/cancel/myTrades paths
- [x] Implement native USD-M perp market, account, position, leverage, margin, order, TP/SL and close-position paths
- [ ] Confirm private auth with read-only key smoke
- [ ] Confirm write path with explicit small passive order + cancel only when write flags are enabled
