import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureManualSpotEligibility,
  resolveManualSpotSupport
} from "./support.js";

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
