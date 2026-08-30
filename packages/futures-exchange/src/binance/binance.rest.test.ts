import assert from "node:assert/strict";
import test from "node:test";
import { BinanceRestClient } from "./binance.rest.js";

test("Binance futures requests trim stored credentials before signing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-MBX-APIKEY"), "api-key");
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const client = new BinanceRestClient({
      restBaseUrl: "https://fapi.binance.test",
      apiKey: " api-key\n",
      apiSecret: " api-secret\n",
      retryAttempts: 1
    });
    await client.requestPrivate({ method: "GET", endpoint: "/fapi/v2/account" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
