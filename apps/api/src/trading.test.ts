import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPerpTradingContext,
  normalizeOrderBookPayload,
  normalizeTickerPayload,
  normalizeTradesPayload,
  normalizeSymbolInput
} from "./trading.js";

test("normalizeSymbolInput strips separators", () => {
  assert.equal(normalizeSymbolInput("btc_usdt"), "BTCUSDT");
  assert.equal(normalizeSymbolInput("BTC-USDT"), "BTCUSDT");
});

test("normalizeOrderBookPayload parses levels", () => {
  const book = normalizeOrderBookPayload({
    bids: [["100", "2"]],
    asks: [["101", "3"]],
    ts: "123"
  });

  assert.equal(book.bids.length, 1);
  assert.equal(book.asks.length, 1);
  assert.equal(book.bids[0].price, 100);
  assert.equal(book.asks[0].qty, 3);
  assert.equal(book.ts, 123);
});

test("normalizeTickerPayload extracts numeric fields", () => {
  const ticker = normalizeTickerPayload({
    instId: "BTCUSDT",
    lastPr: "101.5",
    markPrice: "101.2",
    bidPr: "101.4",
    askPr: "101.6",
    ts: "99"
  });

  assert.equal(ticker.symbol, "BTCUSDT");
  assert.equal(ticker.last, 101.5);
  assert.equal(ticker.mark, 101.2);
  assert.equal(ticker.bid, 101.4);
  assert.equal(ticker.ask, 101.6);
  assert.equal(ticker.ts, 99);
});

test("normalizeTradesPayload handles array payload", () => {
  const trades = normalizeTradesPayload([
    [1710000000000, "100", "0.5", "buy"],
    { symbol: "BTCUSDT", price: "101", size: "0.4", side: "sell", ts: "1710000001000" }
  ]);

  assert.equal(trades.length, 2);
  assert.equal(trades[0].price, 100);
  assert.equal(trades[0].side, "buy");
  assert.equal(trades[1].symbol, "BTCUSDT");
  assert.equal(trades[1].qty, 0.4);
});

test("buildPerpTradingContext models paper as linked-market-data execution", () => {
  const context = buildPerpTradingContext(
    {
      id: "paper_1",
      userId: "user_1",
      exchange: "paper",
      label: "Paper",
      apiKey: "",
      apiSecret: "",
      passphrase: null,
      marketDataExchangeAccountId: "bitget_1"
    },
    {
      id: "bitget_1",
      userId: "user_1",
      exchange: "bitget",
      label: "Bitget",
      apiKey: "k",
      apiSecret: "s",
      passphrase: "p",
      marketDataExchangeAccountId: null
    }
  );

  assert.equal(context.executionMode, "paper");
  assert.equal(context.executionVenue.kind, "paper");
  assert.equal(context.executionVenue.capabilities.requiresLinkedMarketData, true);
  assert.equal(context.marketDataVenue.kind, "adapter");
  assert.equal(context.marketDataVenue.capabilities.venue, "bitget");
  assert.equal(context.requiresLinkedMarketData, true);
  assert.equal(context.paperContext?.executionVenue, "paper");
  assert.equal(context.paperContext?.marketType, "perp");
  assert.equal(context.paperContext?.runtimeContract, context.executionVenue.paperRuntime);
  assert.equal(context.paperContext?.runtimeContract.executionVenue, "paper");
  assert.equal(context.paperContext?.runtimeContract.marketDataLinkMode, "linked_live_venue");
  assert.equal(context.paperContext?.linkedMarketData.marketDataVenue, "bitget");
  assert.equal(context.paperContext?.linkedMarketData.exchangeAccountId, "bitget_1");
});

test("buildPerpTradingContext keeps live execution and market-data venue aligned", () => {
  const context = buildPerpTradingContext(
    {
      id: "hl_1",
      userId: "user_1",
      exchange: "hyperliquid",
      label: "HL",
      apiKey: "k",
      apiSecret: "s",
      passphrase: null,
      marketDataExchangeAccountId: null
    },
    {
      id: "hl_1",
      userId: "user_1",
      exchange: "hyperliquid",
      label: "HL",
      apiKey: "k",
      apiSecret: "s",
      passphrase: null,
      marketDataExchangeAccountId: null
    }
  );

  assert.equal(context.executionMode, "live");
  assert.equal(context.executionVenue.kind, "adapter");
  assert.equal(context.marketDataVenue.kind, "adapter");
  assert.equal(context.executionVenue.capabilities.venue, "hyperliquid");
  assert.equal(context.marketDataVenue.capabilities.venue, "hyperliquid");
  assert.equal(context.requiresLinkedMarketData, false);
  assert.equal(context.paperContext, null);
});
