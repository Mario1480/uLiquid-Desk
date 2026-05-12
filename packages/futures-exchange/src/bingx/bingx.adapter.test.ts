import assert from "node:assert/strict";
import test from "node:test";
import { BingxFuturesAdapter, toBingxContractInfo } from "./bingx.adapter.js";

test("toBingxContractInfo maps BingX USD-M contract precision and symbols", () => {
  const mapped = toBingxContractInfo({
    symbol: "BTC-USDT",
    asset: "BTC",
    currency: "USDT",
    status: 1,
    apiStateOpen: "true",
    apiStateClose: "true",
    size: "0.0001",
    pricePrecision: 1,
    quantityPrecision: 4,
    tradeMinQuantity: "0.0001",
    tradeMinUSDT: "2",
    makerFeeRate: "0.0002",
    takerFeeRate: "0.0005"
  });

  assert.equal(mapped.canonicalSymbol, "BTCUSDT");
  assert.equal(mapped.exchangeSymbol, "BTC-USDT");
  assert.equal(mapped.tickSize, 0.1);
  assert.equal(mapped.stepSize, 0.0001);
  assert.equal(mapped.minVol, 0.0001);
  assert.equal(mapped.minNotional, 2);
  assert.equal(mapped.apiAllowed, true);
});

test("BingX editOrder replaces open limit order with normalized payload", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });
  const calls: Array<{ kind: "cancel" | "place"; payload: Record<string, unknown> }> = [];

  (adapter.contractCache as any).getByCanonical = async () => ({
    canonicalSymbol: "BTCUSDT",
    exchangeSymbol: "BTC-USDT",
    minVol: 0.0001,
    maxVol: null,
    tickSize: 0.1,
    stepSize: 0.0001,
    minLeverage: 1,
    maxLeverage: 125,
    apiAllowed: true,
    minNotional: null
  });
  (adapter.tradeApi as any).getOrder = async () => ({
    orderId: "old_1",
    symbol: "BTC-USDT",
    side: "BUY",
    type: "LIMIT",
    price: "65000",
    origQty: "0.01234",
    executedQty: "0.00234",
    takeProfit: JSON.stringify({ type: "TAKE_PROFIT_MARKET", stopPrice: 70000 })
  });
  (adapter.accountApi as any).getPositionMode = async () => ({
    dualSidePosition: true
  });
  (adapter.tradeApi as any).cancelOrder = async (payload: Record<string, unknown>) => {
    calls.push({ kind: "cancel", payload });
    return {};
  };
  (adapter.tradeApi as any).placeOrder = async (payload: Record<string, unknown>) => {
    calls.push({ kind: "place", payload });
    return { orderId: "new_1", clientOrderId: payload.clientOrderId };
  };

  const result = await adapter.editOrder({
    symbol: "BTCUSDT",
    orderId: "old_1",
    price: 66000,
    stopLossPrice: 60000
  });

  assert.equal(result.orderId, "new_1");
  assert.equal(calls[0]?.kind, "cancel");
  assert.deepEqual(calls[0]?.payload, {
    symbol: "BTC-USDT",
    orderId: "old_1"
  });
  assert.equal(calls[1]?.kind, "place");
  assert.equal(calls[1]?.payload.symbol, "BTC-USDT");
  assert.equal(calls[1]?.payload.side, "BUY");
  assert.equal(calls[1]?.payload.type, "LIMIT");
  assert.equal(calls[1]?.payload.quantity, 0.01);
  assert.equal(calls[1]?.payload.price, 66000);
  assert.equal(calls[1]?.payload.positionSide, "LONG");
  assert.match(String(calls[1]?.payload.takeProfit), /70000/);
  assert.match(String(calls[1]?.payload.stopLoss), /60000/);

  await adapter.close();
});
