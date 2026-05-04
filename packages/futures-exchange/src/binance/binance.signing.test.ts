import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBinanceQueryString,
  buildSignedBinanceQuery,
  signBinanceQuery
} from "./binance.signing.js";

test("buildBinanceQueryString sorts parameters and skips empty values", () => {
  assert.equal(
    buildBinanceQueryString({
      timestamp: 1700000000000,
      symbol: "BTCUSDT",
      empty: "",
      recvWindow: 5000,
      unused: undefined
    }),
    "recvWindow=5000&symbol=BTCUSDT&timestamp=1700000000000"
  );
});

test("signBinanceQuery creates HMAC SHA256 hex signatures", () => {
  const query = "recvWindow=5000&symbol=BTCUSDT&timestamp=1700000000000";
  assert.equal(
    signBinanceQuery(query, "secret"),
    "5e1ff144a940ffd87f51175de5ebe2f76d4e8fe1951e3c81b001375485bf3430"
  );
});

test("buildSignedBinanceQuery appends timestamp, recvWindow and signature", () => {
  const signed = buildSignedBinanceQuery({
    params: { symbol: "BTCUSDT" },
    secret: "secret",
    timestampMs: 1700000000000,
    recvWindowMs: 5000
  });
  assert.equal(
    signed,
    "recvWindow=5000&symbol=BTCUSDT&timestamp=1700000000000&signature=5e1ff144a940ffd87f51175de5ebe2f76d4e8fe1951e3c81b001375485bf3430"
  );
});

