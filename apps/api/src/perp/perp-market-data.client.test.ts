import assert from "node:assert/strict";
import test from "node:test";
import { createPerpMarketDataClient } from "./perp-market-data.client.js";
import type { TradingAccount } from "../trading.js";

const originalFetch = globalThis.fetch;

function account(exchange: string): TradingAccount {
  return {
    id: `${exchange}-account`,
    userId: "u1",
    exchange,
    label: exchange,
    apiKey: "key",
    apiSecret: "secret",
    passphrase: null,
    marketDataExchangeAccountId: null
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("BingX candles use public market data without contract warmup", async (t) => {
  const calls: string[] = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.toString()}`);
    assert.equal(url.pathname, "/openApi/swap/v3/quote/klines");
    assert.equal(url.searchParams.get("symbol"), "BTC-USDT");
    assert.equal(url.searchParams.get("interval"), "1h");
    return jsonResponse({
      code: 0,
      msg: "",
      data: [
        {
          time: 1778662800000,
          open: "81155.0",
          high: "81267.3",
          low: "81128.6",
          close: "81266.5",
          volume: "104.6612"
        }
      ]
    });
  }) as typeof fetch;

  const client = createPerpMarketDataClient(account("bingx"));
  const candles = await client.getCandles({
    symbol: "BTCUSDT",
    granularity: "1H",
    limit: 500
  });

  assert.deepEqual(candles, [
    {
      time: 1778662800000,
      open: "81155.0",
      high: "81267.3",
      low: "81128.6",
      close: "81266.5",
      volume: "104.6612"
    }
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.includes("/contracts")), false);
});

test("BingX symbols and ticker map native payloads", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/openApi/swap/v2/quote/contracts") {
      return jsonResponse({
        code: 0,
        data: [
          {
            symbol: "BTC-USDT",
            quantityPrecision: 4,
            pricePrecision: 1,
            tradeMinQuantity: 0.0001,
            currency: "USDT",
            asset: "BTC",
            status: 1,
            apiStateOpen: "true",
            apiStateClose: "true"
          }
        ]
      });
    }
    if (url.pathname === "/openApi/swap/v2/quote/bookTicker") {
      return jsonResponse({
        code: 0,
        data: {
          book_ticker: {
            symbol: "BTC-USDT",
            bid_price: 81232.3,
            ask_price: 81232.5,
            time: 1778663499130
          }
        }
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  }) as typeof fetch;

  const client = createPerpMarketDataClient(account("bingx"));

  assert.deepEqual(await client.listSymbols(), [
    {
      symbol: "BTCUSDT",
      exchangeSymbol: "BTC-USDT",
      status: "1",
      tradable: true,
      tickSize: 0.1,
      stepSize: 0.0001,
      minQty: 0.0001,
      maxQty: null,
      minLeverage: null,
      maxLeverage: null,
      quoteAsset: "USDT",
      baseAsset: "BTC"
    }
  ]);

  assert.deepEqual(await client.getTicker("BTCUSDT"), {
    symbol: "BTCUSDT",
    last: 81232.4,
    mark: 81232.4,
    bid: 81232.3,
    ask: 81232.5,
    ts: 1778663499130,
    raw: {
      book_ticker: {
        symbol: "BTC-USDT",
        bid_price: 81232.3,
        ask_price: 81232.5,
        time: 1778663499130
      }
    }
  });
});

test("Binance candles route through the lightweight public client", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/fapi/v1/klines");
    assert.equal(url.searchParams.get("symbol"), "BTCUSDT");
    assert.equal(url.searchParams.get("interval"), "1h");
    return jsonResponse([[1778662800000, "81155.0", "81267.3", "81128.6", "81266.5", "104.6612"]]);
  }) as typeof fetch;

  const client = createPerpMarketDataClient(account("binance"));
  assert.deepEqual(await client.getCandles({ symbol: "BTC-USDT", granularity: "1H" }), [
    [1778662800000, "81155.0", "81267.3", "81128.6", "81266.5", "104.6612"]
  ]);
});
