import assert from "node:assert/strict";
import test from "node:test";
import { clearHyperliquidReadCoordinatorForTests, HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import { syncExchangeAccount } from "./exchange-sync.js";
import { HyperliquidSpotClient } from "./spot/hyperliquid-spot.client.js";

test.afterEach(() => {
  clearHyperliquidReadCoordinatorForTests();
});

test("syncExchangeAccount falls back to read-only hyperliquid sync when signing path returns opaque hyperliquid error", async () => {
  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalGetSummary = HyperliquidSpotClient.prototype.getSummary;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    if ((this as any).config?.apiSecret) {
      throw new Error("An unknown error occurred");
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

test("syncExchangeAccount reuses stale cached hyperliquid snapshot on 429", async () => {
  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalGetSummary = HyperliquidSpotClient.prototype.getSummary;
  const originalDateNow = Date.now;
  let call = 0;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    call += 1;
    if (call === 1) {
      return { equity: 200, availableMargin: 150, marginMode: undefined };
    }
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    return [];
  };
  HyperliquidSpotClient.prototype.getSummary = async function () {
    return { equity: 25, available: 20, currency: "USDC" } as any;
  };

  try {
    const first = await syncExchangeAccount({
      exchange: "hyperliquid",
      apiKey: "0x1111111111111111111111111111111111111111",
      apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      passphrase: "0x2222222222222222222222222222222222222222"
    });
    const now = originalDateNow();
    Date.now = () => now + 16_000;
    const second = await syncExchangeAccount({
      exchange: "hyperliquid",
      apiKey: "0x1111111111111111111111111111111111111111",
      apiSecret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      passphrase: "0x2222222222222222222222222222222222222222"
    });

    assert.equal(first.futuresBudget.equity, 200);
    assert.equal(second.futuresBudget.equity, 200);
    assert.equal(call, 2);
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidSpotClient.prototype.getSummary = originalGetSummary;
    Date.now = originalDateNow;
  }
});
