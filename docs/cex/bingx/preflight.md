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
