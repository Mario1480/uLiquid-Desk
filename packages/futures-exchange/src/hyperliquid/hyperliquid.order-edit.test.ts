import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "./hyperliquid.adapter.js";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";

test("Hyperliquid adapter exposes order editing and caches the replacement order", async () => {
  const adapter = Object.create(HyperliquidFuturesAdapter.prototype) as any;
  let modifyPayload: any;
  let cachedOrder: any;

  adapter.requireTradeableContract = async () => ({
    exchangeSymbol: "BTC",
    stepSize: 0.001,
    assetIndex: 0,
    raw: { universe: { szDecimals: 3 } }
  });
  adapter.ensureSdkPerpAssetMapReady = async () => undefined;
  adapter.tradeApi = {
    modifyOrder: async (payload: any) => {
      modifyPayload = payload;
      return { orderId: "replacement-order" };
    }
  };
  adapter.cacheOrderMetadata = (orderId: string, symbol: string, assetIndex: number) => {
    cachedOrder = { orderId, symbol, assetIndex };
  };

  const result = await adapter.editOrder({
    symbol: "BTCUSDT",
    orderId: "old-order",
    qty: 1.2349,
    price: 100,
    takeProfitPrice: 120,
    stopLossPrice: 90
  });

  assert.equal(modifyPayload.symbol, "BTC");
  assert.equal(modifyPayload.newSize, "1.234");
  assert.equal(modifyPayload.newPrice, "100");
  assert.equal(modifyPayload.newPresetStopSurplusPrice, "120");
  assert.equal(modifyPayload.newPresetStopLossPrice, "90");
  assert.deepEqual(cachedOrder, {
    orderId: "replacement-order",
    symbol: "BTC",
    assetIndex: 0
  });
  assert.equal(result.orderId, "replacement-order");
});

test("Hyperliquid replacement preserves requested TP and SL", async () => {
  const tradeApi = Object.create(HyperliquidTradeApi.prototype) as any;
  let replacement: any;

  tradeApi.assertTradingReady = () => undefined;
  tradeApi.getOrderDetail = async () => ({
    size: "1",
    price: "100",
    side: "buy",
    reduceOnly: false,
    orderType: "limit"
  });
  tradeApi.cancelOrder = async () => undefined;
  tradeApi.placeOrder = async (payload: any) => {
    replacement = payload;
    return { orderId: "replacement-order" };
  };

  await tradeApi.modifyOrder({
    symbol: "BTC",
    orderId: "old-order",
    szDecimals: 3,
    newPresetStopSurplusPrice: "120",
    newPresetStopLossPrice: "90"
  });

  assert.equal(replacement.presetStopSurplusPrice, "120");
  assert.equal(replacement.presetStopLossPrice, "90");
});
