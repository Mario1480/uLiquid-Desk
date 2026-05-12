import assert from "node:assert/strict";
import test from "node:test";
import { BingxAccountApi } from "./bingx.account.api.js";
import { BingxFuturesAdapter, toBingxContractInfo } from "./bingx.adapter.js";
import { BingxTradeApi } from "./bingx.trade.api.js";

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

test("BingxTradeApi sends order placement as signed JSON body", async () => {
  let request: Record<string, unknown> | null = null;
  const api = new BingxTradeApi({
    requestPrivate: async (params: Record<string, unknown>) => {
      request = params;
      return { orderId: "order_1" };
    }
  } as any);

  await api.placeOrder({
    symbol: "ETH-USDT",
    side: "BUY",
    positionSide: "LONG",
    type: "MARKET",
    quantity: 0.01
  });

  assert.deepEqual(request, {
    method: "POST",
    endpoint: "/openApi/swap/v2/trade/order",
    query: {
      symbol: "ETH-USDT",
      side: "BUY",
      positionSide: "LONG",
      type: "MARKET",
      quantity: 0.01
    },
    bodyFormat: "json"
  });
});

test("BingxTradeApi sends cancel client references as clientOrderId", async () => {
  let request: Record<string, unknown> | null = null;
  const api = new BingxTradeApi({
    requestPrivate: async (params: Record<string, unknown>) => {
      request = params;
      return {};
    }
  } as any);

  await api.cancelOrder({
    symbol: "BTC-USDT",
    clientOrderID: "uliq_abc"
  });

  assert.deepEqual(request, {
    method: "DELETE",
    endpoint: "/openApi/swap/v2/trade/order",
    query: {
      symbol: "BTC-USDT",
      clientOrderId: "uliq_abc"
    }
  });
});

test("BingxAccountApi sends leverage and margin writes as signed JSON body", async () => {
  const requests: Record<string, unknown>[] = [];
  const api = new BingxAccountApi({
    requestPrivate: async (params: Record<string, unknown>) => {
      requests.push(params);
      return {};
    }
  } as any);

  await api.setMarginType("ETH-USDT", "ISOLATED");
  await api.setLeverage("ETH-USDT", 5, "LONG");

  assert.deepEqual(requests, [
    {
      method: "POST",
      endpoint: "/openApi/swap/v2/trade/marginType",
      query: {
        symbol: "ETH-USDT",
        marginType: "ISOLATED"
      },
      bodyFormat: "json"
    },
    {
      method: "POST",
      endpoint: "/openApi/swap/v2/trade/leverage",
      query: {
        symbol: "ETH-USDT",
        leverage: 5,
        side: "LONG"
      },
      bodyFormat: "json"
    }
  ]);
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

  assert.match(String(result.orderId), /^uliq_/);
  assert.equal(result.orderId, result.clientOrderId);
  assert.equal(calls[0]?.kind, "cancel");
  assert.deepEqual(calls[0]?.payload, {
    symbol: "BTC-USDT",
    clientOrderId: "old_1"
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

  assert.match(String(result.clientOrderId), /^uliq_/);
  assert.equal(result.orderId, result.clientOrderId);
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

test("BingX placeOrder falls back to clientOrderID when ack omits venue order id", async () => {
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
    return {};
  };

  const result = await adapter.placeOrder({
    symbol: "BTCUSDT",
    side: "buy",
    type: "market",
    qty: 0.01234
  });

  assert.match(String(result.clientOrderId), /^uliq_/);
  assert.equal(result.orderId, result.clientOrderId);
  assert.equal(result.confirmationSource, "venue_ack");
  assert.equal(result.status, "confirmed");

  await adapter.close();
});

test("BingX listOpenOrders exposes client order ids as action references", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });

  (adapter.contractCache as any).refresh = async () => undefined;
  (adapter as any).toExchangeSymbol = async () => "BTC-USDT";
  (adapter as any).toCanonicalSymbol = () => "BTCUSDT";
  (adapter.tradeApi as any).getOpenOrders = async () => [{
    orderId: "1736011869418901234",
    clientOrderId: "uliq_abc",
    symbol: "BTC-USDT",
    side: "BUY",
    type: "LIMIT",
    status: "PENDING",
    price: "65000",
    origQty: "0.01"
  }];

  const orders = await adapter.listOpenOrders({ symbol: "BTCUSDT" });

  assert.equal(orders[0]?.orderId, "uliq_abc");
  assert.equal((orders[0]?.raw as any).orderId, "1736011869418901234");

  await adapter.close();
});

test("BingX cancelOrderByParams prefers exact client ids over venue order ids", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });
  let cancelPayload: Record<string, unknown> | null = null;

  (adapter as any).toExchangeSymbol = async () => "BTC-USDT";
  (adapter as any).listOpenOrders = async () => [{
    orderId: "venue_1",
    symbol: "BTCUSDT",
    side: "buy",
    type: "limit",
    status: "open",
    price: null,
    qty: null,
    triggerPrice: null,
    takeProfitPrice: null,
    stopLossPrice: null,
    reduceOnly: null,
    createdAt: null,
    raw: {
      orderId: "venue_1",
      clientOrderID: "uliq_abc"
    }
  }];
  (adapter.tradeApi as any).cancelOrder = async (payload: Record<string, unknown>) => {
    cancelPayload = payload;
    return {};
  };

  const result = await adapter.cancelOrderByParams({
    symbol: "BTCUSDT",
    orderId: "uliq_abc"
  });

  assert.deepEqual(cancelPayload, {
    symbol: "BTC-USDT",
    clientOrderId: "uliq_abc"
  });
  assert.equal(result.orderId, "uliq_abc");
  assert.equal(result.clientOrderId, "uliq_abc");

  await adapter.close();
});

test("BingX cancelOrderByParams sends generated client ids with BingX cancel casing", async () => {
  const adapter = new BingxFuturesAdapter({
    apiKey: "key",
    apiSecret: "secret",
    writeEnabled: true
  });
  let cancelPayload: Record<string, unknown> | null = null;

  (adapter as any).toExchangeSymbol = async () => "BTC-USDT";
  (adapter as any).listOpenOrders = async () => [{
    orderId: "uliq_abc",
    symbol: "BTCUSDT",
    side: "buy",
    type: "limit",
    status: "open",
    price: null,
    qty: null,
    triggerPrice: null,
    takeProfitPrice: null,
    stopLossPrice: null,
    reduceOnly: null,
    createdAt: null,
    raw: {
      clientOrderID: "uliq_abc"
    }
  }];
  (adapter.tradeApi as any).cancelOrder = async (payload: Record<string, unknown>) => {
    cancelPayload = payload;
    return {};
  };

  const result = await adapter.cancelOrderByParams({
    symbol: "BTCUSDT",
    orderId: "uliq_abc"
  });

  assert.deepEqual(cancelPayload, {
    symbol: "BTC-USDT",
    clientOrderId: "uliq_abc"
  });
  assert.equal(result.orderId, "uliq_abc");
  assert.equal(result.clientOrderId, "uliq_abc");

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
