import assert from "node:assert/strict";
import test from "node:test";
import { CcxtSpotError } from "@mm/exchange";
import { BitgetHttpError } from "./bitget/bitget-http.js";
import { toExchangeSyncError } from "./exchange-sync.js";

test("toExchangeSyncError maps Bitget HTTP rate-limit consistently", () => {
  const error = new BitgetHttpError({
    status: 429,
    code: "bitget_rate_limited",
    message: "rate limit",
    endpoint: "/api/v2/mix/account/accounts",
    method: "GET",
    retryable: true
  });
  const mapped = toExchangeSyncError({
    exchange: "bitget",
    error,
    fallbackMessage: "fallback"
  });
  assert.equal(mapped.code, "bitget_rate_limited");
  assert.equal(mapped.status, 429);
});

test("toExchangeSyncError maps ccxt timeout to exchange timeout code", () => {
  const error = new CcxtSpotError("timeout", "ccxt_spot_timeout", 504);
  const mapped = toExchangeSyncError({
    exchange: "mexc",
    error,
    fallbackMessage: "fallback"
  });
  assert.equal(mapped.code, "mexc_timeout");
  assert.equal(mapped.status, 504);
});

test("toExchangeSyncError maps generic auth/network messages", () => {
  const auth = toExchangeSyncError({
    exchange: "hyperliquid",
    error: new Error("permission denied"),
    fallbackMessage: "fallback"
  });
  assert.equal(auth.code, "hyperliquid_auth_failed");
  assert.equal(auth.status, 401);

  const network = toExchangeSyncError({
    exchange: "binance",
    error: new Error("fetch failed: network"),
    fallbackMessage: "fallback"
  });
  assert.equal(network.code, "binance_network_error");
  assert.equal(network.status, 502);
});

