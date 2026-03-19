import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter, toMexcContractInfo } from "../mexc/mexc.adapter.js";
import { toBitgetContractInfo } from "../bitget/bitget.contract-cache.js";
import { BitgetRateLimitError } from "../bitget/bitget.errors.js";
import { mapBitgetError } from "../bitget/bitget-error.mapper.js";
import { toHyperliquidContractInfo } from "../hyperliquid/hyperliquid.contract-cache.js";
import { MexcAuthError } from "../mexc/mexc.errors.js";
import { mapMexcError } from "../mexc/mexc-error.mapper.js";

test("normalization contract produces canonical and exchange symbols across adapters", () => {
  const bitget = toBitgetContractInfo(
    {
      symbol: "BTCUSDT",
      baseCoin: "BTC",
      quoteCoin: "USDT",
      minTradeNum: "0.001",
      maxOrderQty: "200",
      minLever: "1",
      maxLever: "125",
      volumePlace: "3",
      pricePlace: "2",
      sizeMultiplier: "0.001",
      symbolStatus: "normal"
    },
    "USDT-FUTURES"
  );
  assert.equal(bitget.canonicalSymbol, "BTCUSDT");
  assert.equal(bitget.exchangeSymbol, "BTCUSDT");

  const mexc = toMexcContractInfo({
    symbol: "ETH_USDT",
    baseCoin: "ETH",
    quoteCoin: "USDT",
    minVol: "1",
    maxVol: "1000",
    priceUnit: "0.01",
    volUnit: "1",
    contractSize: "0.001",
    apiAllowed: true
  });
  assert.equal(mexc.canonicalSymbol, "ETHUSDT");
  assert.equal(mexc.exchangeSymbol, "ETH_USDT");

  const hyper = toHyperliquidContractInfo({
    index: 1,
    universe: { name: "SOL", szDecimals: 2, maxLeverage: 20 },
    assetCtx: null
  });
  assert.equal(hyper.canonicalSymbol, "SOLUSDT");
  assert.equal(hyper.exchangeSymbol, "SOL-PERP");
});

test("error mapping contract is standardized across bitget and mexc", () => {
  const bitgetRate = mapBitgetError(
    new BitgetRateLimitError("too many requests", {
      endpoint: "/api/v2/mix/order/place-order",
      method: "POST",
      status: 429
    })
  );
  assert.equal(bitgetRate.code, "EX_RATE_LIMIT");
  assert.equal(bitgetRate.retryable, true);

  const mexcAuth = mapMexcError(
    new MexcAuthError("signature invalid", {
      endpoint: "/api/v1/private/order/submit",
      method: "POST",
      status: 401
    })
  );
  assert.equal(mexcAuth.code, "EX_AUTH");
  assert.equal(mexcAuth.retryable, false);
});

test("hyperliquid adapter closePosition uses reduce-only market orders against open exposure", async () => {
  const adapter = Object.create(HyperliquidFuturesAdapter.prototype) as HyperliquidFuturesAdapter & {
    getPositions: HyperliquidFuturesAdapter["getPositions"];
    placeOrder: HyperliquidFuturesAdapter["placeOrder"];
    toCanonicalSymbol: HyperliquidFuturesAdapter["toCanonicalSymbol"];
  };
  const placeCalls: any[] = [];

  adapter.toCanonicalSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapter.getPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "long",
      size: 0.25,
      entryPrice: 65000
    }
  ] as any;
  adapter.placeOrder = async (req: any) => {
    placeCalls.push(req);
    return { orderId: "hl_close_1" };
  };

  const result = await adapter.closePosition({ symbol: "BTCUSDT" });
  assert.deepEqual(result, { orderIds: ["hl_close_1"] });
  assert.deepEqual(placeCalls, [
    {
      symbol: "BTCUSDT",
      side: "sell",
      type: "market",
      qty: 0.25,
      reduceOnly: true
    }
  ]);
});

test("hyperliquid adapter setPositionTpSl replaces existing tp/sl plans for the current position side", async () => {
  const adapter = Object.create(HyperliquidFuturesAdapter.prototype) as HyperliquidFuturesAdapter & {
    tradeApi: any;
    marginCoin: string;
    productType: string;
    getPositions: HyperliquidFuturesAdapter["getPositions"];
    toCanonicalSymbol: HyperliquidFuturesAdapter["toCanonicalSymbol"];
    toExchangeSymbol: HyperliquidFuturesAdapter["toExchangeSymbol"];
  };
  const cancelCalls: any[] = [];
  const placeCalls: any[] = [];

  adapter.marginCoin = "USDC";
  adapter.productType = "USDT-FUTURES";
  adapter.tradeApi = {
    getPendingPlanOrders: async () => [
      { orderId: "tp_1", planType: "profit_plan" },
      { orderId: "sl_1", planType: "loss_plan" }
    ],
    cancelPlanOrder: async (params: any) => {
      cancelCalls.push(params);
    },
    placePositionTpSl: async (params: any) => {
      placeCalls.push(params);
      return {};
    }
  };
  adapter.getPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "long",
      size: 0.5,
      entryPrice: 65000
    }
  ] as any;
  adapter.toCanonicalSymbol = (symbol: string) => symbol === "BTC-PERP" ? "BTCUSDT" : symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapter.toExchangeSymbol = async () => "BTC-PERP";

  const result = await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    takeProfitPrice: 70000,
    stopLossPrice: 64000
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(cancelCalls, [
    { symbol: "BTC-PERP", orderId: "tp_1", productType: "USDT-FUTURES" },
    { symbol: "BTC-PERP", orderId: "sl_1", productType: "USDT-FUTURES" }
  ]);
  assert.deepEqual(placeCalls, [
    {
      symbol: "BTC-PERP",
      productType: "USDT-FUTURES",
      marginCoin: "USDC",
      holdSide: "long",
      planType: "profit_plan",
      triggerPrice: "70000"
    },
    {
      symbol: "BTC-PERP",
      productType: "USDT-FUTURES",
      marginCoin: "USDC",
      holdSide: "long",
      planType: "loss_plan",
      triggerPrice: "64000"
    }
  ]);
});

test("mexc adapter closePosition uses reduce-only market orders against open exposure", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as MexcFuturesAdapter & {
    getPositions: MexcFuturesAdapter["getPositions"];
    placeOrder: MexcFuturesAdapter["placeOrder"];
    toCanonicalSymbol: MexcFuturesAdapter["toCanonicalSymbol"];
  };
  const placeCalls: any[] = [];

  adapter.toCanonicalSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapter.getPositions = async () => [
    {
      symbol: "ETHUSDT",
      side: "short",
      size: 1.5,
      entryPrice: 3500
    }
  ] as any;
  adapter.placeOrder = async (req: any) => {
    placeCalls.push(req);
    return { orderId: "mexc_close_1" };
  };

  const result = await adapter.closePosition({ symbol: "ETHUSDT" });
  assert.deepEqual(result, { orderIds: ["mexc_close_1"] });
  assert.deepEqual(placeCalls, [
    {
      symbol: "ETHUSDT",
      side: "buy",
      type: "market",
      qty: 1.5,
      reduceOnly: true
    }
  ]);
});
