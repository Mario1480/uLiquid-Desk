import assert from "node:assert/strict";
import test from "node:test";
import { BingxRestClient } from "./bingx.rest.js";

test("BingxRestClient preserves large BingX order IDs as strings", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '{"code":0,"msg":"","data":{"orders":[{"symbol":"BTC-USDT","orderId":1736011869418901234,"clientOrderId":"uliq_abc"}]}}',
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const client = new BingxRestClient({
      apiKey: "key",
      apiSecret: "secret",
      recvWindowMs: 5000
    });
    const data = await client.requestPrivate<{ orders: Array<{ orderId: string; clientOrderId: string }> }>({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/openOrders",
      query: { symbol: "BTC-USDT" }
    });

    assert.equal(data.orders[0]?.orderId, "1736011869418901234");
    assert.equal(data.orders[0]?.clientOrderId, "uliq_abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
