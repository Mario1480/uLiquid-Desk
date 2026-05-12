import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBingxQueryString,
  buildBingxSigningString,
  buildSignedBingxJsonBody,
  buildSignedBingxQuery,
  signBingxQuery
} from "./bingx.signing.js";

test("buildBingxSigningString sorts parameters and preserves raw JSON values", () => {
  assert.equal(
    buildBingxSigningString({
      timestamp: 1700000000000,
      symbol: "BTC-USDT",
      empty: "",
      recvWindow: 5000,
      takeProfit: "{\"type\":\"TAKE_PROFIT_MARKET\",\"stopPrice\":70000}",
      unused: undefined
    }),
    "recvWindow=5000&symbol=BTC-USDT&takeProfit={\"type\":\"TAKE_PROFIT_MARKET\",\"stopPrice\":70000}&timestamp=1700000000000"
  );
});

test("buildBingxQueryString URL-encodes JSON params for transport", () => {
  assert.equal(
    buildBingxQueryString({
      symbol: "BTC-USDT",
      takeProfit: "{\"type\":\"TAKE_PROFIT_MARKET\",\"stopPrice\":70000}"
    }),
    "symbol=BTC-USDT&takeProfit=%7B%22type%22%3A%22TAKE_PROFIT_MARKET%22%2C%22stopPrice%22%3A70000%7D"
  );
});

test("signBingxQuery creates HMAC SHA256 hex signatures", () => {
  const query = "recvWindow=5000&symbol=BTC-USDT&timestamp=1700000000000";
  assert.equal(
    signBingxQuery(query, "secret"),
    "f70971b2211682368f2d05d1ab18d837e4da793c3475e397a9a0451393e487e7"
  );
});

test("buildSignedBingxQuery signs raw params but emits encoded JSON query string", () => {
  const signed = buildSignedBingxQuery({
    params: {
      symbol: "BTC-USDT",
      takeProfit: "{\"type\":\"TAKE_PROFIT_MARKET\",\"stopPrice\":70000}"
    },
    secret: "secret",
    timestampMs: 1700000000000,
    recvWindowMs: 5000
  });
  assert.equal(
    signed,
    "recvWindow=5000&symbol=BTC-USDT&takeProfit=%7B%22type%22%3A%22TAKE_PROFIT_MARKET%22%2C%22stopPrice%22%3A70000%7D&timestamp=1700000000000&signature=3ae62f9fdb5d88e55967a0c7586d6d107a5431655f5463ccfec309bb37aa2fa3"
  );
});

test("buildSignedBingxJsonBody signs sorted params and keeps JSON body fields", () => {
  const signed = buildSignedBingxJsonBody({
    params: {
      symbol: "ETH-USDT",
      side: "BUY",
      positionSide: "LONG",
      type: "MARKET",
      quantity: 0.01
    },
    secret: "secret",
    timestampMs: 1700000000000,
    recvWindowMs: 5000
  });

  assert.deepEqual(signed, {
    positionSide: "LONG",
    quantity: 0.01,
    recvWindow: 5000,
    side: "BUY",
    symbol: "ETH-USDT",
    timestamp: 1700000000000,
    type: "MARKET",
    signature: "f97b42f3b93269f87d8a4c2078a77b654e1efa9165661bfe9d97003cbdaaaeae"
  });
});
