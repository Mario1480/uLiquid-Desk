import assert from "node:assert/strict";
import test from "node:test";
import { resolveFuturesVenue } from "@mm/futures-exchange";
import { resolvePerpMarketStreamingMode } from "./perp-market-data-runtime.js";

function contextForMarketDataExchange(exchange: string): any {
  return {
    marketDataVenue: resolveFuturesVenue({
      exchange,
      apiKey: "key",
      apiSecret: "secret",
      passphrase: null
    })
  };
}

test("BingX perp market streams use REST polling because the adapter has no live websocket stream", () => {
  assert.equal(resolvePerpMarketStreamingMode(contextForMarketDataExchange("bingx")), "market_data_poll");
});

test("venues with live websocket market streams continue to use adapter streaming", () => {
  assert.equal(resolvePerpMarketStreamingMode(contextForMarketDataExchange("binance")), "adapter_stream");
});
