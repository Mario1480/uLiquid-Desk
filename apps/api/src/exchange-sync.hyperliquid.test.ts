import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import { syncExchangeAccount } from "./exchange-sync.js";
import { HyperliquidSpotClient } from "./spot/hyperliquid-spot.client.js";

test("syncExchangeAccount falls back to read-only hyperliquid sync when signing path disconnects", async () => {
  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalGetSummary = HyperliquidSpotClient.prototype.getSummary;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    if ((this as any).config?.apiSecret) {
      throw new Error("Hyperliquid API disconnected");
    }
    return { equity: 123.45, availableMargin: 67.89, marginMode: undefined };
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    return [];
  };
  HyperliquidSpotClient.prototype.getSummary = async function () {
    return {
      equity: 10,
      available: 10,
      currency: "USDC"
    } as any;
  };

  try {
    const result = await syncExchangeAccount({
      exchange: "hyperliquid",
      apiKey: "0x1111111111111111111111111111111111111111",
      apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      passphrase: "0x2222222222222222222222222222222222222222"
    });

    assert.equal(result.futuresBudget.equity, 123.45);
    assert.equal(result.futuresBudget.availableMargin, 67.89);
    assert.equal(result.details.exchange, "hyperliquid");
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidSpotClient.prototype.getSummary = originalGetSummary;
  }
});
