import assert from "node:assert/strict";
import test from "node:test";
import { ExchangeError } from "@mm/futures-exchange";
import { buildManualTradingErrorResponse } from "./manual-trading-error.js";
import { ManualTradingError } from "./trading.js";

test("manual trading error response keeps standardized ExchangeError payload", () => {
  const exchangeError = new ExchangeError({
    exchange: "bitget",
    code: "EX_RATE_LIMIT",
    message: "too many requests",
    retryable: true,
    httpStatus: 429
  });

  const result = buildManualTradingErrorResponse(exchangeError);
  assert.equal(result.status, 429);
  assert.deepEqual(result.payload, {
    error: "exchange_error",
    code: "EX_RATE_LIMIT",
    message: "too many requests",
    exchange: "bitget",
    retryable: true
  });
});

test("manual trading error response keeps ManualTradingError shape", () => {
  const manual = new ManualTradingError("symbol_required", 400, "symbol_required");
  const result = buildManualTradingErrorResponse(manual);

  assert.equal(result.status, 400);
  assert.deepEqual(result.payload, {
    error: "symbol_required",
    code: "symbol_required",
    message: "symbol_required"
  });
});

test("manual trading error response maps generic upstream error to exchange_error contract", () => {
  const result = buildManualTradingErrorResponse({
    status: 502,
    code: "50000",
    message: "Bitget upstream maintenance",
    exchange: "bitget"
  });

  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "exchange_error");
  assert.equal(result.payload.code, "EX_UPSTREAM_UNAVAILABLE");
  assert.equal(result.payload.exchange, "bitget");
  assert.equal(result.payload.retryable, true);
});

test("manual trading error response maps BingX 100410 HTTP 500 as rate limited", () => {
  const result = buildManualTradingErrorResponse({
    status: 500,
    message: "code:100410:The endpoint trigger frequency limit rule is currently in the disabled period and will be unblocked after 1778582037390",
    exchange: "bingx"
  });

  assert.equal(result.status, 429);
  assert.equal(result.payload.error, "exchange_error");
  assert.equal(result.payload.code, "EX_RATE_LIMIT");
  assert.equal(result.payload.exchange, "bingx");
  assert.equal(result.payload.retryable, true);
});
