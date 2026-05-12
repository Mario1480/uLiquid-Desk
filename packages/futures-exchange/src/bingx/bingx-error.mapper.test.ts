import assert from "node:assert/strict";
import test from "node:test";
import { BingxInvalidParamsError, BingxRateLimitError } from "./bingx.errors.js";
import { mapBingxError } from "./bingx-error.mapper.js";

test("mapBingxError maps rate limits as retryable", () => {
  const mapped = mapBingxError(new BingxRateLimitError("Too many requests", {
    endpoint: "/openApi/swap/v2/trade/order",
    method: "POST",
    status: 429,
    bingxCode: 100410
  }));
  assert.equal(mapped.exchange, "bingx");
  assert.equal(mapped.code, "EX_RATE_LIMIT");
  assert.equal(mapped.retryable, true);
  assert.equal(mapped.httpStatus, 429);
});

test("mapBingxError maps BingX 100410 HTTP 500 disabled period as 429", () => {
  const mapped = mapBingxError(new BingxRateLimitError(
    "code:100410:The endpoint trigger frequency limit rule is currently in the disabled period and will be unblocked after 1778582037390",
    {
      endpoint: "/openApi/swap/v2/trade/openOrders",
      method: "GET",
      status: 500,
      bingxCode: 100410
    }
  ));

  assert.equal(mapped.code, "EX_RATE_LIMIT");
  assert.equal(mapped.retryable, true);
  assert.equal(mapped.httpStatus, 429);
});

test("mapBingxError maps precision style messages", () => {
  const mapped = mapBingxError(new BingxInvalidParamsError("precision invalid: step size", {
    endpoint: "/openApi/swap/v2/trade/order",
    method: "POST",
    status: 400,
    bingxCode: 100400
  }));
  assert.equal(mapped.code, "EX_PRECISION_INVALID");
  assert.equal(mapped.retryable, false);
});

test("mapBingxError maps missing orders", () => {
  const mapped = mapBingxError(new BingxInvalidParamsError("Order does not exist", {
    endpoint: "/openApi/swap/v2/trade/order",
    method: "DELETE",
    status: 400,
    bingxCode: 80016
  }));
  assert.equal(mapped.code, "EX_ORDER_NOT_FOUND");
  assert.equal(mapped.httpStatus, 400);
});
