# CEX Integration Playbook — BingX

Preflight: `docs/cex/bingx/preflight.md`

## 1) Goals
- Implement native BingX spot adapter.
- Implement native BingX USD-M perpetual swap adapter.
- Preserve clientOrderId.
- Enforce precision and minNotional.

## 1.0) Base / Auth / Limits / Symbols
- Base URL: https://open-api.bingx.com
- Auth: HMAC SHA256 (query signature)
  - Header: `X-BX-APIKEY`
  - Query: `timestamp`, `recvWindow`, `signature`
  - Signature = HMAC SHA256 of sorted query string (hex)
- Rate limits:
  - Public IP: 500 req / 10s (symbols endpoint)
  - Private UID: 10 req / sec (openOrders, query, historyOrders)
  - Cancel all: 2 req / sec
- Symbol format: `BASE-QUOTE` (e.g., `BTC-USDT`)
- Runtime flags:
  - `BINGX_REST_BASE_URL=https://open-api.bingx.com`
  - `BINGX_SPOT_ENABLED=1`
  - `BINGX_PERP_ENABLED=1`
  - `BINGX_RECV_WINDOW_MS=5000`
  - `BINGX_PERP_WRITE_ENABLED=1`

## 1.1) Endpoints & Fields (from preflight)

Symbol format: `BASE-QUOTE`
Meta fields: `tickSize`, `stepSize`, `minNotional` (minQty/maxQty deprecated)

### Public
- Symbols: `GET /openApi/spot/v1/common/symbols`
- Ticker/mid: `GET /openApi/spot/v1/ticker/bookTicker`
- Orderbook: `GET /openApi/spot/v1/market/depth`
- Recent trades: `GET /openApi/spot/v1/market/trades`

### Private
- Balances: `GET /openApi/spot/v1/account/balance`
- Open orders: `GET /openApi/spot/v1/trade/openOrders`
- Place order: `POST /openApi/spot/v1/trade/order`
  - `newClientOrderId` supported
  - `timeInForce`: PostOnly/GTC/IOC/FOK
- Cancel order: `POST /openApi/spot/v1/trade/cancel`
- Cancel all: `POST /openApi/spot/v1/trade/cancelOpenOrders`
- Order details: `GET /openApi/spot/v1/trade/query`
- Trades/fills:
  - `GET /openApi/spot/v1/trade/myTrades`

### Perp private/public
- Contracts: `GET /openApi/swap/v2/quote/contracts`
- Ticker: `GET /openApi/swap/v2/quote/bookTicker`
- Klines: `GET /openApi/swap/v3/quote/klines`
- Balance: `GET /openApi/swap/v3/user/balance`
- Positions: `GET /openApi/swap/v2/user/positions`
- Open orders: `GET /openApi/swap/v2/trade/openOrders`
- Place/cancel: `POST|DELETE /openApi/swap/v2/trade/order`
- Cancel all: `DELETE /openApi/swap/v2/trade/allOpenOrders`
- Leverage/margin: `/openApi/swap/v2/trade/leverage`, `/openApi/swap/v2/trade/marginType`

## 2) Files to Create / Update
- `packages/exchange/src/bingx/bingx.client.ts`
- `packages/exchange/src/bingx/bingx.signing.ts`
- `packages/exchange/src/bingx/index.ts`
- `packages/futures-exchange/src/bingx/*`
- `packages/exchange/src/index.ts`
- `packages/futures-exchange/src/factory/create-futures-adapter.ts`
- `apps/api/src/index.ts`
- Runner exchange factory

## 3) Implementation Steps
1. REST client with SIGNED + NONE modes.
2. Symbols/meta mapping.
3. Balances / openOrders / place / cancel.
4. Spot `getMyTrades`.
5. USD-M perp adapter: contracts, market data, balances, positions, orders, leverage, margin type, close position, managed TP/SL.
6. Wire registry, factories, manual eligibility, account sync, Paper-linked market data, runner guards.
7. Smoke tests.

## 4) Smoke Test Checklist
- [ ] symbols list
- [ ] mid price
- [ ] balances
- [ ] place/cancel
- [ ] openOrders with clientOrderId
- [ ] manual order
- [ ] getMyTrades
- [ ] perp contracts
- [ ] perp account/positions read
- [ ] perp passive limit order + cancel
- [ ] perp limit order edit via cancel-and-replace

## 5) Notes / Risks
- Open orders response may not include `clientOrderID` consistently; preserve it when present.
- WebSocket is not part of v1. REST snapshots are used for current normalized read/execution paths.
