import assert from "node:assert/strict";
import test from "node:test";
import { MexcFuturesAdapter } from "./mexc.adapter.js";
import { MexcMaintenanceError } from "./mexc.errors.js";

const openLimitOrder = {
  orderId: "old-order",
  symbol: "BTCUSDT",
  side: "1",
  type: "1",
  status: "open",
  price: 100,
  qty: 2,
  triggerPrice: null,
  takeProfitPrice: 120,
  stopLossPrice: 90,
  reduceOnly: false,
  createdAt: null,
  raw: { side: 1, orderType: 1, openType: 2 }
};

test("MEXC order editing validates the replacement before cancelling", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as any;
  const calls: string[] = [];
  let preparedRequest: any;

  adapter.listOpenOrders = async () => [openLimitOrder];
  adapter.preparePlaceOrder = async (request: any) => {
    calls.push("prepare");
    preparedRequest = request;
    return { symbol: "BTC_USDT", vol: request.qty, price: request.price };
  };
  adapter.cancelOrder = async () => {
    calls.push("cancel");
  };
  adapter.submitPreparedOrder = async () => {
    calls.push("submit");
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId: "new-order"
    };
  };

  const result = await adapter.editOrder({
    symbol: "BTCUSDT",
    orderId: "old-order",
    price: 101,
    stopLossPrice: null
  });

  assert.deepEqual(calls, ["prepare", "cancel", "submit"]);
  assert.equal(preparedRequest.side, "buy");
  assert.equal(preparedRequest.qty, 2);
  assert.equal(preparedRequest.price, 101);
  assert.equal(preparedRequest.marginMode, "cross");
  assert.equal(preparedRequest.takeProfitPrice, 120);
  assert.equal(preparedRequest.stopLossPrice, undefined);
  assert.equal(result.orderId, "new-order");
});

test("MEXC order editing leaves the original order intact when validation fails", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as any;
  let cancelled = false;

  adapter.listOpenOrders = async () => [openLimitOrder];
  adapter.preparePlaceOrder = async () => {
    throw new Error("invalid_replacement");
  };
  adapter.cancelOrder = async () => {
    cancelled = true;
  };

  await assert.rejects(
    () => adapter.editOrder({ symbol: "BTCUSDT", orderId: "old-order", price: -1 }),
    /invalid_replacement/
  );
  assert.equal(cancelled, false);
});

test("MEXC order editing reports a cancelled-original replacement failure", async () => {
  const adapter = Object.create(MexcFuturesAdapter.prototype) as any;
  adapter.listOpenOrders = async () => [openLimitOrder];
  adapter.preparePlaceOrder = async () => ({ symbol: "BTC_USDT", vol: 2, price: 101 });
  adapter.cancelOrder = async () => undefined;
  adapter.submitPreparedOrder = async () => {
    throw new Error("venue_rejected");
  };

  await assert.rejects(
    () => adapter.editOrder({ symbol: "BTCUSDT", orderId: "old-order", price: 101 }),
    (error: unknown) => error instanceof MexcMaintenanceError
      && error.message.includes("cancelled the original order")
  );
});
