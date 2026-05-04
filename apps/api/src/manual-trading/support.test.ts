import assert from "node:assert/strict";
import test from "node:test";

process.env.BINANCE_SPOT_ENABLED = "1";
process.env.BINANCE_PERP_ENABLED = "1";

const {
  ensureManualPerpEligibility,
  ensureManualSpotEligibility,
  resolveManualPerpSupport,
  resolveManualSpotSupport
} = await import("./support.js");

test("resolveManualSpotSupport allows direct hyperliquid spot accounts", () => {
  assert.equal(
    resolveManualSpotSupport({
      exchange: "hyperliquid",
      marketDataExchange: "hyperliquid"
    }),
    true
  );
});

test("ensureManualSpotEligibility accepts hyperliquid market/execution alignment", () => {
  assert.doesNotThrow(() =>
    ensureManualSpotEligibility({
      selectedAccount: {
        id: "hl_1",
        userId: "user_1",
        exchange: "hyperliquid",
        label: "HL",
        apiKey: "0x1111111111111111111111111111111111111111",
        apiSecret: "0x1111111111111111111111111111111111111111111111111111111111111111",
        passphrase: null,
        marketDataExchangeAccountId: null
      },
      marketDataAccount: {
        id: "hl_1",
        userId: "user_1",
        exchange: "hyperliquid",
        label: "HL",
        apiKey: "0x1111111111111111111111111111111111111111",
        apiSecret: "0x1111111111111111111111111111111111111111111111111111111111111111",
        passphrase: null,
        marketDataExchangeAccountId: null
      }
    })
  );
});

test("manual support includes direct Binance spot and perp accounts", () => {
  assert.equal(
    resolveManualSpotSupport({
      exchange: "binance",
      marketDataExchange: "binance"
    }),
    true
  );
  assert.equal(
    resolveManualPerpSupport({
      exchange: "binance",
      marketDataExchange: "binance"
    }),
    true
  );
});

test("manual eligibility accepts direct Binance spot and perp accounts", () => {
  const selectedAccount = {
    id: "bn_1",
    userId: "user_1",
    exchange: "binance",
    label: "Binance",
    apiKey: "key",
    apiSecret: "secret",
    passphrase: null,
    marketDataExchangeAccountId: null
  };
  const resolved = {
    selectedAccount,
    marketDataAccount: selectedAccount
  };
  assert.doesNotThrow(() => ensureManualSpotEligibility(resolved));
  assert.doesNotThrow(() => ensureManualPerpEligibility(resolved));
});
