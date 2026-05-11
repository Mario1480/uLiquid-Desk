import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter, toMexcContractInfo } from "../mexc/mexc.adapter.js";
import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import { BinanceFuturesAdapter } from "../binance/binance.adapter.js";
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
  assert.equal(hyper.canonicalSymbol, "SOLUSDC");
  assert.equal(hyper.exchangeSymbol, "SOL-PERP");
  assert.equal(hyper.quoteAsset, "USDC");
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
      endpoint: "/api/v1/private/order/create",
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
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId: "hl_close_1",
      clientOrderId: undefined
    };
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
  const adapter = Object.create(HyperliquidFuturesAdapter.prototype) as HyperliquidFuturesAdapter;
  const adapterAny = adapter as any;
  const cancelCalls: any[] = [];
  const placeCalls: any[] = [];

  adapterAny.marginCoin = "USDC";
  adapterAny.productType = "USDT-FUTURES";
  adapterAny.tradeApi = {
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
  adapterAny.getPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "long",
      size: 0.5,
      entryPrice: 65000
    }
  ] as any;
  adapterAny.ensureSdkPerpAssetMapReady = async () => {};
  adapterAny.toCanonicalSymbol = (symbol: string) => symbol === "BTC-PERP" ? "BTCUSDT" : symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapterAny.toExchangeSymbol = async () => "BTC-PERP";

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

test("mexc adapter setPositionTpSl replaces existing tp/sl plans for the current position side", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as MexcFuturesAdapter & {
    tradingApi: any;
    tradeApi: any;
    accountApi: any;
    toCanonicalSymbol: MexcFuturesAdapter["toCanonicalSymbol"];
    toExchangeSymbol: MexcFuturesAdapter["toExchangeSymbol"];
  };
  const cancelCalls: any[] = [];
  const placeCalls: any[] = [];

  adapter.tradingApi = {
    listStopOrders: async () => [
      { id: "tp_1", positionId: "position-1", takeProfitPrice: 70000 },
      { id: "sl_1", positionId: "position-1", stopLossPrice: 64000 },
      { id: "other_side", positionId: "position-2", takeProfitPrice: 71000 }
    ],
    cancelStopOrder: async (params: any) => {
      cancelCalls.push(params);
    },
    placeStopOrder: async (params: any) => {
      placeCalls.push(params);
      return {};
    }
  };
  adapter.tradeApi = adapter.tradingApi;
  adapter.accountApi = {
    getOpenPositions: async () => [
      {
        symbol: "BTC_USDT",
        positionId: "position-1",
        positionType: 1,
        holdVol: 5
      }
    ]
  };
  adapter.toCanonicalSymbol = (symbol: string) => symbol === "BTC_USDT" ? "BTCUSDT" : symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapter.toExchangeSymbol = async () => "BTC_USDT";

  const result = await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    takeProfitPrice: 70000,
    stopLossPrice: 64000
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(cancelCalls, [
    [{ stopPlanOrderId: "tp_1" }, { stopPlanOrderId: "sl_1" }]
  ]);
  assert.deepEqual(placeCalls, [
    {
      positionId: "position-1",
      vol: 5,
      volType: 2,
      profitTrend: 1,
      lossTrend: 1,
      takeProfitPrice: 70000,
      stopLossPrice: 64000
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
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId: "mexc_close_1",
      clientOrderId: undefined
    };
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

test("mexc adapter listPositions overlays active tp/sl stop orders onto open positions", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as any;

  adapter.contractCache = {
    refresh: async () => undefined
  };
  adapter.accountApi = {
    getOpenPositions: async () => [
      {
        symbol: "BTC_USDT",
        positionId: "position-1",
        positionType: 1,
        openType: 1,
        holdVol: 5,
        openAvgPrice: 65000,
        fairPrice: 65250,
        unrealizedPnl: 12.5,
        leverage: 10,
        positionMargin: 32.625,
        liquidatePrice: 60000
      }
    ]
  };
  adapter.tradingApi = {
    listStopOrders: async () => [
      {
        id: "stop-1",
        positionId: "position-1",
        takeProfitPrice: 70000
      },
      {
        id: "stop-2",
        positionId: "position-1",
        stopLossPrice: 64000
      }
    ]
  };
  adapter.resolveContractSize = () => 0.001;
  adapter.toCanonicalSymbol = (symbol: string) => symbol === "BTC_USDT" ? "BTCUSDT" : symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  adapter.toExchangeSymbol = async () => "BTC_USDT";

  const rows = await adapter.listPositions({ symbol: "BTCUSDT" });
  const notionalUsd = 0.005 * 65250;
  const marginUsd = 32.625;

  assert.deepEqual(rows, [
    {
      symbol: "BTCUSDT",
      side: "long",
      size: 0.005,
      entryPrice: 65000,
      markPrice: 65250,
      unrealizedPnl: 12.5,
      leverage: 10,
      marginMode: "isolated",
      marginUsd,
      notionalUsd,
      liquidationPrice: 60000,
      liquidationDistancePct: ((65250 - 60000) / 65250) * 100,
      roePct: (12.5 / marginUsd) * 100,
      pnlPct: (12.5 / notionalUsd) * 100,
      takeProfitPrice: 70000,
      stopLossPrice: 64000
    }
  ]);
});

test("bitget adapter listPositions canonicalizes legacy position symbols before filtering", async () => {
  const adapter = Object.create(BitgetFuturesAdapter.prototype) as any;

  adapter.productType = "USDT-FUTURES";
  adapter.marginCoin = "USDT";
  adapter.contractCache = {
    refresh: async () => undefined
  };
  adapter.positionApi = {
    getAllPositions: async () => [
      {
        symbol: "BTCUSDT_UMCBL",
        holdSide: "long",
        total: "0.01",
        openPriceAvg: "65000",
        markPrice: "65100",
        unrealizedPL: "1.2",
        leverage: "5",
        marginMode: "crossed",
        marginSize: "130.2",
        liquidationPrice: "60000",
        takeProfit: "70000",
        stopLoss: "64000"
      }
    ]
  };
  adapter.toCanonicalSymbol = (symbol: string) => (
    symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === "BTCUSDT" ? "BTCUSDT" : null
  );

  const rows = await adapter.listPositions({ symbol: "BTCUSDT" });
  const notionalUsd = 0.01 * 65100;
  const marginUsd = 130.2;

  assert.deepEqual(rows, [
    {
      symbol: "BTCUSDT",
      side: "long",
      size: 0.01,
      entryPrice: 65000,
      markPrice: 65100,
      unrealizedPnl: 1.2,
      leverage: 5,
      marginMode: "cross",
      marginUsd,
      notionalUsd,
      liquidationPrice: 60000,
      liquidationDistancePct: ((65100 - 60000) / 65100) * 100,
      roePct: (1.2 / marginUsd) * 100,
      pnlPct: (1.2 / notionalUsd) * 100,
      takeProfitPrice: 70000,
      stopLossPrice: 64000
    }
  ]);
});

test("bitget adapter listPositions maps one-way sell hold side as short", async () => {
  const adapter = Object.create(BitgetFuturesAdapter.prototype) as any;

  adapter.productType = "USDT-FUTURES";
  adapter.marginCoin = "USDT";
  adapter.contractCache = {
    refresh: async () => undefined
  };
  adapter.positionApi = {
    getAllPositions: async () => [
      {
        symbol: "ETHUSDT",
        holdSide: "sell",
        total: "0.2",
        openPriceAvg: "3000",
        markPrice: "2900"
      }
    ]
  };
  adapter.toCanonicalSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  const rows = await adapter.listPositions({ symbol: "ETHUSDT" });

  assert.equal(rows[0]?.side, "short");
});

test("bitget adapter setPositionTpSl uses position TPSL simultaneous endpoint", async () => {
  const adapter = Object.create(BitgetFuturesAdapter.prototype) as any;
  const cancelCalls: any[] = [];
  const placeCalls: any[] = [];

  adapter.productType = "USDT-FUTURES";
  adapter.marginCoin = "USDT";
  adapter.defaultPositionMode = "one-way";
  adapter.positionModeHint = null;
  adapter.accountApi = {
    getPositionMode: async () => ({ posMode: "hedge_mode" })
  };
  adapter.tradeApi = {
    getPendingPlanOrders: async (params: any) => {
      assert.equal(params.planType, "profit_loss");
      return [
      { orderId: "tp_1", planType: "profit_plan", holdSide: "long" },
      { orderId: "sl_1", planType: "loss_plan", holdSide: "long" },
      { orderId: "short_tp", planType: "profit_plan", holdSide: "short" }
      ];
    },
    cancelPlanOrder: async (params: any) => {
      cancelCalls.push(params);
    },
    placePositionTpSl: async (params: any) => {
      placeCalls.push(params);
      return {};
    }
  };
  adapter.toExchangeSymbol = async () => "BTCUSDT";
  adapter.mapError = (error: unknown) => error;

  const result = await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    side: "long",
    takeProfitPrice: 70000,
    stopLossPrice: 64000
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(cancelCalls, [
    {
      symbol: "BTCUSDT",
      orderId: "tp_1",
      marginCoin: "USDT",
      planType: "profit_plan",
      productType: "USDT-FUTURES"
    },
    {
      symbol: "BTCUSDT",
      orderId: "sl_1",
      marginCoin: "USDT",
      planType: "loss_plan",
      productType: "USDT-FUTURES"
    }
  ]);
  assert.deepEqual(placeCalls, [
    {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
      holdSide: "long",
      stopSurplusTriggerPrice: "70000",
      stopSurplusTriggerType: "mark_price",
      stopLossTriggerPrice: "64000",
      stopLossTriggerType: "mark_price"
    }
  ]);
});

test("bitget adapter setPositionTpSl maps holdSide for one-way position mode", async () => {
  const adapter = Object.create(BitgetFuturesAdapter.prototype) as any;
  const placeCalls: any[] = [];

  adapter.productType = "USDT-FUTURES";
  adapter.marginCoin = "USDT";
  adapter.defaultPositionMode = "one-way";
  adapter.positionModeHint = null;
  adapter.accountApi = {
    getPositionMode: async () => ({ posMode: "one_way_mode" })
  };
  adapter.tradeApi = {
    getPendingPlanOrders: async () => [],
    cancelPlanOrder: async () => undefined,
    placePositionTpSl: async (params: any) => {
      placeCalls.push(params);
      return {};
    }
  };
  adapter.toExchangeSymbol = async () => "BTCUSDT";
  adapter.mapError = (error: unknown) => error;

  const result = await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    side: "long",
    stopLossPrice: 64000
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(placeCalls, [
    {
      symbol: "BTCUSDT",
      productType: "USDT-FUTURES",
      marginCoin: "USDT",
      holdSide: "buy",
      stopSurplusTriggerPrice: undefined,
      stopSurplusTriggerType: undefined,
      stopLossTriggerPrice: "64000",
      stopLossTriggerType: "mark_price"
    }
  ]);
});

test("bitget adapter setPositionTpSl falls back to position posMode for holdSide", async () => {
  const adapter = Object.create(BitgetFuturesAdapter.prototype) as any;
  const placeCalls: any[] = [];

  adapter.productType = "USDT-FUTURES";
  adapter.marginCoin = "USDT";
  adapter.defaultPositionMode = "one-way";
  adapter.positionModeHint = null;
  adapter.accountApi = {
    getPositionMode: async () => {
      throw new Error("Request URL NOT FOUND");
    }
  };
  adapter.positionApi = {
    getAllPositions: async (params: any) => {
      assert.deepEqual(params, { productType: "USDT-FUTURES", marginCoin: "USDT" });
      return [{ symbol: "BTCUSDT", holdSide: "long", total: "1", posMode: "hedge_mode" }];
    }
  };
  adapter.tradeApi = {
    getPendingPlanOrders: async () => [],
    cancelPlanOrder: async () => undefined,
    placePositionTpSl: async (params: any) => {
      placeCalls.push(params);
      return {};
    }
  };
  adapter.toExchangeSymbol = async () => "BTCUSDT";
  adapter.mapError = (error: unknown) => error;

  const result = await adapter.setPositionTpSl({
    symbol: "BTCUSDT",
    side: "long",
    stopLossPrice: 64000
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(placeCalls[0]?.holdSide, "long");
});

test("binance adapter listPositions exposes leverage margin and liquidation risk fields", async () => {
  const adapter = Object.create(BinanceFuturesAdapter.prototype) as any;

  adapter.contractCache = {
    refresh: async () => undefined
  };
  adapter.toExchangeSymbol = async () => "BNBUSDT";
  adapter.accountApi = {
    getPositionRisk: async () => [
      {
        symbol: "BNBUSDT",
        positionSide: "BOTH",
        positionAmt: "5",
        entryPrice: "643.53",
        markPrice: "643.99",
        unRealizedProfit: "2.29",
        notional: "3219.95",
        leverage: "10",
        marginType: "isolated",
        isolatedMargin: "321.995",
        liquidationPrice: "579.13"
      }
    ]
  };
  adapter.tradeApi = {
    getOpenOrders: async () => []
  };

  const rows = await adapter.listPositions({ symbol: "BNBUSDT" });

  assert.deepEqual(rows, [
    {
      symbol: "BNBUSDT",
      side: "long",
      size: 5,
      entryPrice: 643.53,
      markPrice: 643.99,
      unrealizedPnl: 2.29,
      leverage: 10,
      marginMode: "isolated",
      marginUsd: 321.995,
      notionalUsd: 3219.95,
      liquidationPrice: 579.13,
      liquidationDistancePct: ((643.99 - 579.13) / 643.99) * 100,
      roePct: (2.29 / 321.995) * 100,
      pnlPct: (2.29 / 3219.95) * 100,
      takeProfitPrice: null,
      stopLossPrice: null
    }
  ]);
});
