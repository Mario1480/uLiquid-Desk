import assert from "node:assert/strict";
import test from "node:test";
import { BinanceInvalidParamsError, BinanceRateLimitError } from "./binance.errors.js";
import { mapBinanceError } from "./binance-error.mapper.js";

test("mapBinanceError maps rate limits as retryable", () => {
  const mapped = mapBinanceError(new BinanceRateLimitError("Too many requests", {
    endpoint: "/fapi/v1/order",
    method: "POST",
    status: 429,
    binanceCode: -1003
  }));
  assert.equal(mapped.exchange, "binance");
  assert.equal(mapped.code, "EX_RATE_LIMIT");
  assert.equal(mapped.retryable, true);
  assert.equal(mapped.httpStatus, 429);
});

test("mapBinanceError maps filter failures to precision errors", () => {
  const mapped = mapBinanceError(new BinanceInvalidParamsError("Filter failure: LOT_SIZE", {
    endpoint: "/fapi/v1/order",
    method: "POST",
    status: 400,
    binanceCode: -1111
  }));
  assert.equal(mapped.code, "EX_PRECISION_INVALID");
  assert.equal(mapped.retryable, false);
});

test("mapBinanceError maps unknown order responses", () => {
  const mapped = mapBinanceError(new BinanceInvalidParamsError("Unknown order sent.", {
    endpoint: "/fapi/v1/order",
    method: "DELETE",
    status: 400,
    binanceCode: -2011
  }));
  assert.equal(mapped.code, "EX_ORDER_NOT_FOUND");
  assert.equal(mapped.httpStatus, 400);
});

