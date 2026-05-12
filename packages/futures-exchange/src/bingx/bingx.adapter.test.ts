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
    return { orderId: "new_1", clientOrderID: payload.clientOrderID };
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
  assert.match(String(calls[1]?.payload.clientOrderID), /^uliq_/);
  assert.equal(calls[1]?.payload.clientOrderId, undefined);
  assert.deepEqual(JSON.parse(String(calls[1]?.payload.takeProfit)), {
    type: "TAKE_PROFIT_MARKET",
    quantity: 0.01,
    stopPrice: 70000,
    workingType: "MARK_PRICE"
  });
  assert.deepEqual(JSON.parse(String(calls[1]?.payload.stopLoss)), {
    type: "STOP_MARKET",
    quantity: 0.01,
    stopPrice: 60000,
    workingType: "MARK_PRICE"
  });

  await adapter.close();
});

test("BingX placeOrder uses Swap V2 clientOrderID and TP/SL quantities", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });
  const placed: Record<string, unknown>[] = [];

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
  (adapter.accountApi as any).getPositionMode = async () => ({
    dualSidePosition: true
  });
  (adapter.tradeApi as any).placeOrder = async (payload: Record<string, unknown>) => {
    placed.push(payload);
    return { orderId: "order_1", clientOrderID: payload.clientOrderID };
  };

  const result = await adapter.placeOrder({
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    qty: 0.01234,
    takeProfitPrice: 70000,
    stopLossPrice: 60000
  });

  assert.equal(result.orderId, "order_1");
  assert.match(String(result.clientOrderId), /^uliq_/);
  const payload = placed[0] ?? {};
  assert.equal(payload.symbol, "BTC-USDT");
  assert.equal(payload.type, "MARKET");
  assert.equal(payload.quantity, 0.0123);
  assert.equal(payload.positionSide, "LONG");
  assert.match(String(payload.clientOrderID), /^uliq_/);
  assert.equal(payload.clientOrderId, undefined);
  assert.deepEqual(JSON.parse(String(payload.takeProfit)), {
    type: "TAKE_PROFIT_MARKET",
    quantity: 0.0123,
    stopPrice: 70000,
    workingType: "MARK_PRICE"
  });
  assert.deepEqual(JSON.parse(String(payload.stopLoss)), {
    type: "STOP_MARKET",
    quantity: 0.0123,
    stopPrice: 60000,
    workingType: "MARK_PRICE"
  });

  await adapter.close();
});

test("BingX setPositionTpSl sends conditional close payloads accepted by Swap V2", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });
  const cancels: Record<string, unknown>[] = [];
  const placements: Record<string, unknown>[] = [];

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
  (adapter as any).listPositions = async () => [{
    symbol: "BTCUSDT",
    side: "long",
    size: 0.01234,
    entryPrice: 65000,
    markPrice: 66000,
    unrealizedPnl: null,
    leverage: null,
    marginMode: null,
    marginUsd: null,
    notionalUsd: null,
    liquidationPrice: null,
    liquidationDistancePct: null,
    roePct: null,
    pnlPct: null,
    takeProfitPrice: null,
    stopLossPrice: null
  }];
  (adapter.accountApi as any).getPositionMode = async () => ({
    dualSidePosition: true
  });
  (adapter.tradeApi as any).getOpenOrders = async () => [
    {
      orderId: "old_tp",
      symbol: "BTC-USDT",
      side: "SELL",
      type: "TAKE_PROFIT_MARKET",
      positionSide: "LONG",
      stopPrice: "69000"
    },
    {
      orderId: "entry_stop",
      symbol: "BTC-USDT",
      side: "BUY",
      type: "STOP_MARKET",
      positionSide: "BOTH",
      stopPrice: "71000"
    },
    {
      orderId: "limit_1",
      symbol: "BTC-USDT",
      side: "SELL",
      type: "LIMIT",
      positionSide: "LONG"
    }
  ];
  (adapter.tradeApi as any).cancelOrder = async (payload: Record<string, unknown>) => {
    cancels.push(payload);
    return {};
  };
  (adapter.tradeApi as any).placeOrder = async (payload: Record<string, unknown>) => {
    placements.push(payload);
    return { orderId: `new_${placements.length}` };
  };

  await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    side: "long",
    takeProfitPrice: 70000,
    stopLossPrice: 60000
  });

  assert.deepEqual(cancels, [{ symbol: "BTC-USDT", orderId: "old_tp" }]);
  assert.deepEqual(placements, [
    {
      symbol: "BTC-USDT",
      side: "SELL",
      type: "TAKE_PROFIT_MARKET",
      quantity: 0.0123,
      stopPrice: 70000,
      workingType: "MARK_PRICE",
      positionSide: "LONG"
    },
    {
      symbol: "BTC-USDT",
      side: "SELL",
      type: "STOP_MARKET",
      quantity: 0.0123,
      stopPrice: 60000,
      workingType: "MARK_PRICE",
      positionSide: "LONG"
    }
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(placements[0], "closePosition"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(placements[0], "clientOrderID"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(placements[0], "clientOrderId"), false);

  await adapter.close();
});
