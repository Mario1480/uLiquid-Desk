import assert from "node:assert/strict";
import test from "node:test";
import { createPerpExecutionService } from "./perp-execution-service.js";

test("perp execution service blocks unsupported paper market-data links before placing orders", async () => {
  let placePaperOrderCalls = 0;

  const service = createPerpExecutionService({
    isPaperTradingAccount: () => true,
    createPerpExecutionAdapter: () => {
      throw new Error("should_not_create_live_adapter");
    },
    createPerpMarketDataClient: () => ({
      close: async () => undefined
    } as any),
    placePaperOrder: async () => {
      placePaperOrderCalls += 1;
      return { orderId: "paper_1" };
    }
  });

  await assert.rejects(
    () => service.placeOrder({
      resolved: {
        selectedAccount: {
          id: "paper_exec",
          userId: "user_1",
          exchange: "paper",
          label: "Paper",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        },
        marketDataAccount: {
          id: "paper_md",
          userId: "user_1",
          exchange: "paper",
          label: "Paper MD",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        }
      },
      symbol: "BTCUSDT",
      side: "buy",
      type: "market",
      qty: 1
    }),
    (error: any) => {
      assert.equal(error?.code, "paper_perp_requires_supported_market_data");
      return true;
    }
  );

  assert.equal(placePaperOrderCalls, 0);
});

test("perp execution service blocks unsupported order editing before adapter calls", async () => {
  let editCalls = 0;

  const service = createPerpExecutionService({
    isPaperTradingAccount: () => false,
    createPerpExecutionAdapter: () => ({
      exchangeId: "hyperliquid",
      close: async () => undefined
    } as any),
    createPerpMarketDataClient: () => ({
      close: async () => undefined
    } as any),
    editOpenOrder: async () => {
      editCalls += 1;
      return { orderId: "edited_1" };
    }
  });

  await assert.rejects(
    () => service.editOrder({
      resolved: {
        selectedAccount: {
          id: "acc_live",
          userId: "user_1",
          exchange: "hyperliquid",
          label: "HL",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        },
        marketDataAccount: {
          id: "acc_live",
          userId: "user_1",
          exchange: "hyperliquid",
          label: "HL",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        }
      },
      symbol: "BTCUSDT",
      orderId: "ord_1",
      price: 65000
    }),
    (error: any) => {
      assert.equal(error?.code, "venue_order_editing_unsupported");
      assert.match(String(error?.message ?? ""), /does not support order editing/i);
      return true;
    }
  );

  assert.equal(editCalls, 0);
});

test("perp execution service blocks unsupported position tpsl controls before adapter calls", async () => {
  let setTpSlCalls = 0;

  const service = createPerpExecutionService({
    isPaperTradingAccount: () => false,
    createPerpExecutionAdapter: () => ({
      exchangeId: "mexc",
      close: async () => undefined
    } as any),
    createPerpMarketDataClient: () => ({
      close: async () => undefined
    } as any),
    setPositionTpSl: async () => {
      setTpSlCalls += 1;
      return { ok: true };
    }
  });

  await assert.rejects(
    () => service.setPositionTpSl({
      resolved: {
        selectedAccount: {
          id: "acc_mexc",
          userId: "user_1",
          exchange: "mexc",
          label: "MEXC",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        },
        marketDataAccount: {
          id: "acc_mexc",
          userId: "user_1",
          exchange: "mexc",
          label: "MEXC",
          apiKey: "key",
          apiSecret: "secret",
          passphrase: null,
          marketDataExchangeAccountId: null
        }
      },
      symbol: "BTCUSDT",
      takeProfitPrice: 70000
    }),
    (error: any) => {
      assert.equal(error?.code, "venue_position_tpsl_unsupported");
      assert.match(String(error?.message ?? ""), /does not support position tp\/sl/i);
      return true;
    }
  );

  assert.equal(setTpSlCalls, 0);
});
