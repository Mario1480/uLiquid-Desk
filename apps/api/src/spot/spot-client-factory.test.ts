import assert from "node:assert/strict";
import test from "node:test";

process.env.CEX_SPOT_WRITE_ENABLED = "0";
process.env.CEX_SPOT_WRITE_OVERRIDES = "bitget:1,mexc:1";

const [{ createSpotClient }, { BitgetSpotClient }] = await Promise.all([
  import("./spot-client-factory.js"),
  import("./bitget-spot.client.js")
]);

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

test("createSpotClient honors bitget spot write override", async () => {
  const originalPlaceOrder = BitgetSpotClient.prototype.placeOrder;
  let called = false;

  BitgetSpotClient.prototype.placeOrder = async (input) => {
    called = true;
    assert.equal(input.symbol, "BTCUSDT");
    return { orderId: "bitget_order_1" };
  };

  try {
    const client = createSpotClient(
      {
        id: "bitget_1",
        userId: "user_1",
        exchange: "bitget",
        label: "Bitget",
        apiKey: "bitget-key",
        apiSecret: "bitget-secret",
        passphrase: "bitget-passphrase",
        marketDataExchangeAccountId: null
      },
      {
        forceBackend: "native"
      }
    );

    const placed = await client.placeOrder({
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      qty: 0.001,
      price: 100
    });

    assert.equal(placed.orderId, "bitget_order_1");
    assert.equal(called, true);
  } finally {
    BitgetSpotClient.prototype.placeOrder = originalPlaceOrder;
  }
});
