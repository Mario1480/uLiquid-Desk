import assert from "node:assert/strict";
import test from "node:test";
import { createSpotClient } from "./spot-client-factory.js";

test("createSpotClient supports hyperliquid native spot bridge", () => {
  const client = createSpotClient(
    {
      id: "hl_1",
      userId: "user_1",
      exchange: "hyperliquid",
      label: "Hyperliquid",
      apiKey: "0x1111111111111111111111111111111111111111",
      apiSecret: "0x1111111111111111111111111111111111111111111111111111111111111111",
      passphrase: null,
      marketDataExchangeAccountId: null
    },
    {
      forceBackend: "native"
    }
  );

  assert.equal(client.getBackendTag(), "native");
  assert.equal(typeof client.listSymbols, "function");
  assert.equal(typeof client.placeOrder, "function");
});
