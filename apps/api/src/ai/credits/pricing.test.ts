import assert from "node:assert/strict";
import test from "node:test";
import { calculateAiUsageCost, ceilDiv, creditsForRetailMicrousd, type AiPricingSnapshot } from "./pricing.js";
import { routeOpenAiModel } from "./modelRouter.js";

const luna: AiPricingSnapshot = {
  id: "luna-r1",
  provider: "openai",
  model: "gpt-5.6-luna",
  serviceTier: "default",
  processingRegion: "global",
  inputMicrousdPerMillion: 200_000n,
  cachedInputMicrousdPerMillion: 20_000n,
  cacheWriteMicrousdPerMillion: 250_000n,
  outputMicrousdPerMillion: 1_200_000n,
  longContextThresholdTokens: 272_000,
  longInputMultiplierBps: 20_000,
  longOutputMultiplierBps: 15_000,
  markupBps: 22_000,
  revision: 1,
  effectiveFrom: new Date("2026-08-03T00:00:00.000Z"),
  effectiveUntil: null
};

test("BigInt pricing separates cached reads, cache writes and output", () => {
  const result = calculateAiUsageCost({
    pricing: luna,
    usage: { inputTokens: 100_000n, cachedInputTokens: 20_000n, cacheWriteTokens: 10_000n, outputTokens: 10_000n, reasoningTokens: 2_000n }
  });
  assert.equal(result.uncachedInputMicrousd, 14_000n);
  assert.equal(result.cachedInputMicrousd, 400n);
  assert.equal(result.cacheWriteMicrousd, 2_500n);
  assert.equal(result.outputMicrousd, 12_000n);
  assert.equal(result.providerCostMicrousd, 28_900n);
  assert.equal(result.retailCostMicrousd, 63_580n);
  assert.equal(creditsForRetailMicrousd(result.retailCostMicrousd), 64n);
});

test("long context applies 2x input categories and 1.5x output to the whole call", () => {
  const result = calculateAiUsageCost({
    pricing: luna,
    usage: { inputTokens: 300_000n, cachedInputTokens: 100_000n, cacheWriteTokens: 0n, outputTokens: 10_000n, reasoningTokens: 0n }
  });
  assert.equal(result.longContext, true);
  assert.equal(result.uncachedInputMicrousd, 80_000n);
  assert.equal(result.cachedInputMicrousd, 4_000n);
  assert.equal(result.outputMicrousd, 18_000n);
});

test("rounding remains exact beyond Number safe integers", () => {
  assert.equal(ceilDiv(9_007_199_254_740_993n, 1_000n), 9_007_199_254_741n);
});

test("router keeps simple chat on Luna, complex analysis on Terra and gated deep work on Sol", () => {
  const base = { scope: "agent_chat", profile: "market_analyst" as const, requestedSymbols: 1, requestedAccounts: 0, enabledSkills: ["market.get_ohlcv"], createsTradingDraft: false };
  assert.equal(routeOpenAiModel(base).model, "gpt-5.6-luna");
  assert.equal(routeOpenAiModel({ ...base, requestedSymbols: 2 }).model, "gpt-5.6-terra");
  assert.equal(routeOpenAiModel({ ...base, profile: "prediction_builder", scope: "strategy_generate", allowDeep: false }).model, "gpt-5.6-terra");
  assert.equal(routeOpenAiModel({ ...base, profile: "prediction_builder", scope: "strategy_generate", allowDeep: true }).model, "gpt-5.6-sol");
});
