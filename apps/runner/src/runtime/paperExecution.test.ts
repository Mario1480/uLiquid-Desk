import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRunnerPaperExecutionContext,
  getRunnerDefaultPaperBalanceUsd,
  resolveRunnerPaperSimulationPolicy
} from "./paperExecution.js";

test("resolveRunnerPaperSimulationPolicy returns normalized paper defaults", () => {
  const policy = resolveRunnerPaperSimulationPolicy();

  assert.equal(policy.fundingMode, "disabled");
  assert.equal(typeof policy.feeBps, "number");
  assert.equal(typeof policy.slippageBps, "number");
  assert.equal(typeof policy.startBalanceUsd, "number");
  assert.ok(policy.startBalanceUsd >= 0);
});

test("getRunnerDefaultPaperBalanceUsd reuses the centralized paper policy", () => {
  assert.equal(
    getRunnerDefaultPaperBalanceUsd(),
    resolveRunnerPaperSimulationPolicy().startBalanceUsd
  );
});

test("buildRunnerPaperExecutionContext resolves linked market data support from shared paper contract", () => {
  const context = buildRunnerPaperExecutionContext({
    marketType: "perp",
    marketDataExchange: "hyperliquid",
    marketDataExchangeAccountId: "acc_123"
  });

  assert.equal(context.executionVenue, "paper");
  assert.equal(context.runtimeContract.executionVenue, "paper");
  assert.equal(context.runtimeContract.marketDataLinkMode, "linked_live_venue");
  assert.equal(context.linkedMarketData.marketDataVenue, "hyperliquid");
  assert.equal(context.linkedMarketData.exchangeAccountId, "acc_123");
  assert.equal(context.linkedMarketData.supported, true);
});

test("buildRunnerPaperExecutionContext surfaces unsupported linked market data consistently", () => {
  const context = buildRunnerPaperExecutionContext({
    marketType: "perp",
    marketDataExchange: "kraken",
    marketDataExchangeAccountId: "acc_unsupported"
  });

  assert.equal(context.executionVenue, "paper");
  assert.equal(context.linkedMarketData.marketDataVenue, "kraken");
  assert.equal(context.linkedMarketData.supported, false);
  assert.equal(context.linkedMarketData.supportCode, "paper_perp_requires_supported_market_data");
});
