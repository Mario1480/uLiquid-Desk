import assert from "node:assert/strict";
import test from "node:test";
import { BitgetInvalidParamsError } from "../bitget.errors.js";
import { editBitgetOpenOrder } from "./bitget-order-edit.fix.js";

test("editBitgetOpenOrder rejects when no editable fields are provided", async () => {
  const adapter = {
    productType: "USDT-FUTURES" as const,
    toExchangeSymbol: async (symbol: string) => symbol,
    cancelOrder: async () => {},
    placeOrder: async () => ({ orderId: "replacement" })
  };
  const tradeApi = {
    getOrderDetail: async () => ({}),
    getPendingOrders: async () => [],
    modifyOrder: async () => ({})
  };

  await assert.rejects(
    () =>
      editBitgetOpenOrder({
        adapter,
        tradeApi: tradeApi as any,
        input: {
          symbol: "BTCUSDT",
          orderId: "123"
        }
      }),
    (error: unknown) => error instanceof BitgetInvalidParamsError
  );
});

test("editBitgetOpenOrder retries modify-order with newClientOid when requested", async () => {
  const modifyPayloads: Array<Record<string, unknown>> = [];
  const adapter = {
    productType: "USDT-FUTURES" as const,
    toExchangeSymbol: async (_symbol: string) => "BTCUSDT",
    cancelOrder: async () => {},
    placeOrder: async () => ({ orderId: "replacement" })
  };
  const tradeApi = {
    getOrderDetail: async () => ({
      side: "buy",
      orderType: "limit",
      size: "1",
      price: "100"
    }),
    getPendingOrders: async () => [],
    modifyOrder: async (payload: Record<string, unknown>) => {
      modifyPayloads.push(payload);
      if (modifyPayloads.length === 1) {
        const err = new Error("please pass in newClientOid");
        (err as Error & { options?: { code: string } }).options = { code: "45115" };
        throw err;
      }
      return {};
    }
  };

  const result = await editBitgetOpenOrder({
    adapter,
    tradeApi: tradeApi as any,
    input: {
      symbol: "BTCUSDT",
      orderId: "abc-1",
      takeProfitPrice: 101
    }
  });

  assert.equal(result.orderId, "abc-1");
  assert.equal(modifyPayloads.length, 2);
  assert.equal(modifyPayloads[0].newClientOid, undefined);
  assert.equal(typeof modifyPayloads[1].newClientOid, "string");
  assert.match(String(modifyPayloads[1].newClientOid), /^edit_/);
});

