import assert from "node:assert/strict";
import test from "node:test";
import { ExchangeError } from "../core/exchange-error.types.js";
import { mapBitgetError } from "./bitget-error.mapper.js";
import {
  BitgetApiError,
  BitgetAuthError,
  BitgetInvalidParamsError,
  BitgetMaintenanceError,
  BitgetRateLimitError
} from "./bitget.errors.js";

const endpoint = "/api/v2/mix/order/place-order";
const method = "POST";

test("mapBitgetError keeps ExchangeError instance", () => {
  const original = new ExchangeError({
    exchange: "bitget",
    code: "EX_UNKNOWN",
    message: "already_mapped",
    retryable: false,
    httpStatus: 500
  });
  const mapped = mapBitgetError(original);
  assert.equal(mapped, original);
});

test("mapBitgetError maps auth/rate-limit/maintenance classes", () => {
  const auth = mapBitgetError(new BitgetAuthError("bad_auth", { endpoint, method, status: 401, code: "40001" }));
  assert.equal(auth.code, "EX_AUTH");
  assert.equal(auth.retryable, false);
  assert.equal(auth.httpStatus, 401);

  const rate = mapBitgetError(new BitgetRateLimitError("too_many", { endpoint, method, status: 429, code: "40015" }));
  assert.equal(rate.code, "EX_RATE_LIMIT");
  assert.equal(rate.retryable, true);
  assert.equal(rate.httpStatus, 429);

  const maintenance = mapBitgetError(new BitgetMaintenanceError("maintenance", { endpoint, method, status: 503, code: "50000" }));
  assert.equal(maintenance.code, "EX_UPSTREAM_UNAVAILABLE");
  assert.equal(maintenance.retryable, true);
  assert.equal(maintenance.httpStatus, 503);
});

test("mapBitgetError maps invalid params and generic api/network failures", () => {
  const invalid = mapBitgetError(
    new BitgetInvalidParamsError("price precision invalid", { endpoint, method, status: 400, code: "40017" })
  );
  assert.equal(invalid.code, "EX_PRECISION_INVALID");
  assert.equal(invalid.retryable, false);
  assert.equal(invalid.httpStatus, 400);

  const network = mapBitgetError(new BitgetApiError("network timeout", { endpoint, method }));
  assert.equal(network.code, "EX_NETWORK");
  assert.equal(network.retryable, true);
});

