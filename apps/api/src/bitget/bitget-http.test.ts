import assert from "node:assert/strict";
import test from "node:test";
import {
  BitgetHttpError,
  buildBitgetQueryString,
  requestBitgetApi,
  signBitgetRequest
} from "./bitget-http.js";

test("buildBitgetQueryString sorts keys and omits empty values", () => {
  const query = buildBitgetQueryString({
    symbol: "BTCUSDT",
    productType: "USDT-FUTURES",
    empty: "",
    zero: 0
  });
  assert.equal(query, "productType=USDT-FUTURES&symbol=BTCUSDT&zero=0");
});

test("signBitgetRequest is deterministic", () => {
  const first = signBitgetRequest({
    timestamp: "1700000000000",
    method: "GET",
    path: "/api/v2/mix/account/accounts",
    query: { b: 2, a: 1 },
    secretKey: "secret"
  });
  const second = signBitgetRequest({
    timestamp: "1700000000000",
    method: "GET",
    path: "/api/v2/mix/account/accounts",
    query: { a: 1, b: 2 },
    secretKey: "secret"
  });
  assert.equal(first, second);
});

test("requestBitgetApi retries transient GET errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ code: "40015", msg: "too many requests", data: null }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ code: "00000", msg: "success", data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const data = await requestBitgetApi<{ ok: boolean }>({
      baseUrl: "https://api.bitget.com",
      path: "/api/v2/mix/account/accounts",
      method: "GET",
      maxAttempts: 2,
      retryMode: "safe_get",
      retryDelayMs: 1
    });
    assert.equal(data.ok, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestBitgetApi does not retry POST in safe_get mode", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: "40015", msg: "too many requests", data: null }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        requestBitgetApi({
          baseUrl: "https://api.bitget.com",
          path: "/api/v2/spot/trade/place-order",
          method: "POST",
          body: { symbol: "BTCUSDT" },
          maxAttempts: 2,
          retryMode: "safe_get",
          retryDelayMs: 1
        }),
      (error: unknown) => error instanceof BitgetHttpError && error.code === "bitget_rate_limited"
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

