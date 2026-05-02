import assert from "node:assert/strict";
import test from "node:test";
import type { ContractInfo, TradeIntent } from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest, PlaceOrderResult } from "@mm/futures-exchange";
import type { ActiveFuturesBot } from "../db.js";
import type { SignalDecision } from "../signal/types.js";
import { createSimpleExecutionMode } from "./simpleExecutionMode.js";

const contract: ContractInfo = {
  canonicalSymbol: "BTCUSDT",
  exchangeSymbol: "BTC_USDT",
  apiAllowed: true,
  priceScale: 2,
  volScale: 3,
  priceUnit: 0.01,
  volUnit: 0.001,
  tickSize: null,
  stepSize: null,
  minVol: 0.001,
  maxVol: 100,
  minLeverage: 1,
  maxLeverage: 125,
  contractSize: 1,
  makerFeeRate: null,
  takerFeeRate: null,
  updatedAt: new Date(0).toISOString()
};

function makeBot(overrides: Partial<ActiveFuturesBot> = {}): ActiveFuturesBot {
  return {
    id: "bot_1",
    userId: "user_1",
    name: "Normal bot",
    symbol: "BTCUSDT",
    exchange: "hyperliquid",
    exchangeAccountId: "acc_1",
    strategyKey: "normal_strategy",
    marginMode: "cross",
    leverage: 3,
    paramsJson: {},
    tickMs: 1000,
    credentials: {
      apiKey: "k",
      apiSecret: "s",
      passphrase: null
    },
    marketData: {
      exchange: "hyperliquid",
      exchangeAccountId: "acc_1",
      credentials: {
        apiKey: "k",
        apiSecret: "s",
        passphrase: null
      }
    },
    ...overrides
  };
}

function makeSignal(intent: TradeIntent): SignalDecision {
  return {
    side: intent.type === "open" ? intent.side : "flat",
    confidence: null,
    reason: "signal_ready",
    metadata: {
      gate: {
        applied: false,
        allow: true,
        reason: "gating_disabled",
        sizeMultiplier: 1,
        timeframe: null
      }
    },
    legacyIntent: intent
  };
}

function makeAdapter(options: {
  positions?: Awaited<ReturnType<FuturesExchange["getPositions"]>>;
  placeResult?: PlaceOrderResult;
  onPlace?: (req: PlaceOrderRequest) => void;
} = {}): FuturesExchange & { placeCalls: number; lastPlaceOrder: PlaceOrderRequest | null } {
  return {
    placeCalls: 0,
    lastPlaceOrder: null,
    async getAccountState() {
      return { equity: 1000 };
    },
    async getPositions() {
      return options.positions ?? [];
    },
    async setLeverage() {
      return;
    },
    async placeOrder(req: PlaceOrderRequest) {
      this.placeCalls += 1;
      this.lastPlaceOrder = req;
      options.onPlace?.(req);
      return options.placeResult ?? {
        status: "confirmed",
        submitted: true,
        confirmationSource: "venue_ack",
        receiptStatus: "unknown",
        orderId: "oid_1",
        clientOrderId: req.clientOrderId
      };
    },
    async cancelOrder(orderId: string) {
      return {
        status: "confirmed",
        submitted: true,
        confirmationSource: "venue_ack",
        receiptStatus: "unknown",
        orderId
      };
    },
    async getContractInfo() {
      return contract;
    },
    toCanonicalSymbol(symbol: string) {
      return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    },
    toExchangeSymbol() {
      return "BTC_USDT";
    }
  };
}

test("simple execution uses live adapter and deterministic clientOrderId", async () => {
  let state: unknown = null;
  const adapter = makeAdapter({
    positions: [{ symbol: "BTCUSDT", side: "long", size: 1, entryPrice: 100 }]
  });
  const mode = createSimpleExecutionMode({
    adapterFactory: () => adapter,
    getExecutionModeStateFn: async () => state,
    upsertExecutionModeStateFn: async (_botId, nextState) => {
      state = nextState;
    }
  });

  const result = await mode.execute(makeSignal({
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: { qty: 1 }
  }), { bot: makeBot(), now: new Date("2026-05-02T10:00:00.000Z") });

  assert.equal(result.status, "executed");
  assert.equal(adapter.placeCalls, 1);
  assert.match(String(adapter.lastPlaceOrder?.clientOrderId ?? ""), /^normal-bot_1-simple-BTCUSDT-open-long-1$/);
  assert.deepEqual(Object.keys((state as any).pendingOrders ?? {}), []);
  assert.deepEqual((state as any).openPositionSymbols, ["BTCUSDT"]);
});

test("simple execution blocks live trading when adapter is unavailable", async () => {
  let state: unknown = null;
  const mode = createSimpleExecutionMode({
    adapterFactory: () => null,
    getExecutionModeStateFn: async () => state,
    upsertExecutionModeStateFn: async (_botId, nextState) => {
      state = nextState;
    }
  });

  const result = await mode.execute(makeSignal({
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: { qty: 1 }
  }), { bot: makeBot(), now: new Date("2026-05-02T10:00:00.000Z") });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "execution_adapter_unavailable");
  assert.equal((state as any).lastBlockedReason, "execution_adapter_unavailable");
});

test("simple execution reconciles unresolved pending order instead of resubmitting", async () => {
  let state: unknown = {
    pendingOrders: {
      "normal-existing": {
        clientOrderId: "normal-existing",
        exchangeOrderId: "oid_existing",
        status: "pending_fill_confirmation",
        intentType: "open",
        symbol: "BTCUSDT",
        side: "long",
        orderType: "limit",
        qty: 1,
        price: 100,
        reduceOnly: false,
        attemptSeq: 1,
        createdAt: "2026-05-02T09:00:00.000Z",
        updatedAt: "2026-05-02T09:00:00.000Z",
        lastCheckedAt: null,
        lastReason: null,
        recoveryHint: null
      }
    }
  };
  const adapter = makeAdapter();
  const mode = createSimpleExecutionMode({
    adapterFactory: () => adapter,
    getExecutionModeStateFn: async () => state,
    upsertExecutionModeStateFn: async (_botId, nextState) => {
      state = nextState;
    }
  });

  const result = await mode.execute(makeSignal({
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: { qty: 1 }
  }), { bot: makeBot(), now: new Date("2026-05-02T10:00:00.000Z") });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "pending_order_reconciliation");
  assert.equal(adapter.placeCalls, 0);
  assert.equal((state as any).pendingOrders["normal-existing"].status, "pending_fill_confirmation");
});

test("simple execution keeps accepted order pending until position confirms", async () => {
  let state: unknown = null;
  const adapter = makeAdapter();
  const mode = createSimpleExecutionMode({
    adapterFactory: () => adapter,
    getExecutionModeStateFn: async () => state,
    upsertExecutionModeStateFn: async (_botId, nextState) => {
      state = nextState;
    }
  });

  const result = await mode.execute(makeSignal({
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: { type: "limit", qty: 1, price: 100 }
  }), { bot: makeBot(), now: new Date("2026-05-02T10:00:00.000Z") });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "pending_fill_confirmation");
  assert.equal(adapter.placeCalls, 1);
  assert.deepEqual((state as any).openPositionSymbols, []);
  assert.equal(Object.values((state as any).pendingOrders ?? {}).length, 1);
});

test("simple execution clears pending state after final submit failure", async () => {
  let state: unknown = null;
  const adapter = makeAdapter({
    placeResult: {
      status: "failed",
      submitted: false,
      confirmationSource: "none",
      receiptStatus: "reverted",
      errorCode: "invalid_size",
      errorMessage: "invalid_size"
    }
  });
  const mode = createSimpleExecutionMode({
    adapterFactory: () => adapter,
    getExecutionModeStateFn: async () => state,
    upsertExecutionModeStateFn: async (_botId, nextState) => {
      state = nextState;
    }
  });

  const result = await mode.execute(makeSignal({
    type: "open",
    symbol: "BTCUSDT",
    side: "long",
    order: { qty: 1 }
  }), { bot: makeBot(), now: new Date("2026-05-02T10:00:00.000Z") });

  assert.equal(result.status, "error");
  assert.equal(result.reason, "invalid_size");
  assert.deepEqual(Object.keys((state as any).pendingOrders ?? {}), []);
  assert.equal((state as any).lastBlockedReason, "invalid_size");
});
