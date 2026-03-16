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
