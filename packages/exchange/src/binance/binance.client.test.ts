import assert from "node:assert/strict";
import test from "node:test";
import { BinanceRestClient } from "./binance.client.js";

test("Binance spot symbol lists use exchange asset metadata and skip malformed rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v3/exchangeInfo");
    return new Response(JSON.stringify({
      symbols: [
        {
          symbol: "BNBPAX",
          status: "BREAK",
          baseAsset: "BNB",
          quoteAsset: "PAX",
          isSpotTradingAllowed: true,
          filters: []
        },
        {
          symbol: "BTCUSDT",
          status: "TRADING",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          isSpotTradingAllowed: true,
          filters: []
        },
        {
          symbol: "UNKNOWNPAIR",
          status: "TRADING",
          isSpotTradingAllowed: true,
          filters: []
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const client = new BinanceRestClient("https://api.binance.test", "", "");
    const details = await client.listSymbolDetails();
    assert.deepEqual(details.map((row) => ({
      symbol: row.symbol,
      exchangeSymbol: row.exchangeSymbol,
      status: row.status,
      tradable: row.tradable,
      baseAsset: row.baseAsset,
      quoteAsset: row.quoteAsset
    })), [
      {
        symbol: "BNB/PAX",
        exchangeSymbol: "BNBPAX",
        status: "offline",
        tradable: false,
        baseAsset: "BNB",
        quoteAsset: "PAX"
      },
      {
        symbol: "BTC/USDT",
        exchangeSymbol: "BTCUSDT",
        status: "online",
        tradable: true,
        baseAsset: "BTC",
        quoteAsset: "USDT"
      }
    ]);
    assert.deepEqual(await client.listSymbols(), ["BTC/USDT"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Binance spot requests trim stored credentials before signing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-MBX-APIKEY"), "api-key");
    return new Response(JSON.stringify({ balances: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const client = new BinanceRestClient(
      " https://api.binance.test/ ",
      " api-key\n",
      " api-secret\n"
    );
    assert.deepEqual(await client.getBalances(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
