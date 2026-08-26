import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultPlanCapabilities } from "./defaults.js";
import {
  capabilityForProductFeature,
  listProductFeatureDefinitions,
  requiredPlanForProductFeature,
  resolveProductFeatureGates
} from "./productGates.js";
import { isPlanAtLeast, normalizePlanTier, planRank } from "./resolver.js";

test("commercial plan normalization is fail-safe and orders Premium below Enterprise", () => {
  assert.equal(normalizePlanTier("premium"), "premium");
  assert.equal(normalizePlanTier("legacy_paid_unknown"), "free");
  assert.equal(planRank("free"), 1);
  assert.equal(planRank("pro"), 2);
  assert.equal(planRank("premium"), 3);
  assert.equal(planRank("enterprise"), 4);
  assert.equal(isPlanAtLeast("premium", "pro"), true);
  assert.equal(isPlanAtLeast("pro", "premium"), false);
  assert.equal(isPlanAtLeast("enterprise", "premium"), true);
});

test("product feature registry maps each feature to a capability", () => {
  const items = listProductFeatureDefinitions();
  assert.equal(items.length, 16);
  assert.equal(capabilityForProductFeature("vaults"), "product.vaults");
  assert.equal(requiredPlanForProductFeature("grid_bots"), "free");
  assert.equal(requiredPlanForProductFeature("ai_prediction_builder"), "pro");
  assert.equal(requiredPlanForProductFeature("ai_position_copilot"), "premium");
  assert.equal(requiredPlanForProductFeature("market_intelligence_advanced"), "premium");
});

test("free plan exposes only conservative product modules", () => {
  const gates = resolveProductFeatureGates({
    plan: "free",
    capabilities: getDefaultPlanCapabilities("free")
  });
  assert.equal(gates.local_strategies.allowed, true);
  assert.equal(gates.paper_trading.allowed, true);
  assert.equal(gates.admin_advanced.allowed, true);
  assert.equal(gates.ai_predictions.allowed, false);
  assert.equal(gates.ai_agent_chat.allowed, false);
  assert.equal(gates.composite_strategies.allowed, false);
  assert.equal(gates.grid_bots.allowed, true);
  assert.equal(gates.vaults.allowed, false);
  assert.equal(gates.market_intelligence.allowed, false);
  assert.equal(gates.ai_prediction_builder.allowed, false);
  assert.equal(gates.ai_position_copilot.allowed, false);
});

test("pro plan enables advanced trading product modules", () => {
  const gates = resolveProductFeatureGates({
    plan: "pro",
    capabilities: getDefaultPlanCapabilities("pro")
  });
  assert.equal(gates.ai_predictions.allowed, true);
  assert.equal(gates.ai_agent_chat.allowed, true);
  assert.equal(gates.local_strategies.allowed, true);
  assert.equal(gates.composite_strategies.allowed, true);
  assert.equal(gates.grid_bots.allowed, true);
  assert.equal(gates.vaults.allowed, true);
  assert.equal(gates.market_intelligence.allowed, true);
  assert.equal(gates.ai_prediction_builder.allowed, true);
  assert.equal(gates.ai_agent_account_reads.allowed, false);
  assert.equal(gates.ai_agent_custom_profiles.allowed, false);
  assert.equal(gates.ai_position_copilot.allowed, false);
  assert.equal(gates.ai_position_monitoring.allowed, false);
  assert.equal(gates.ai_multi_exchange_analysis.allowed, false);
  assert.equal(gates.market_intelligence_advanced.allowed, false);
});

test("Premium unlocks private AI and Enterprise inherits the Premium envelope", () => {
  const premium = getDefaultPlanCapabilities("premium");
  const enterprise = getDefaultPlanCapabilities("enterprise");
  assert.equal(premium["product.ai_agent_account_reads"], true);
  assert.equal(premium["product.ai_agent_custom_profiles"], true);
  assert.equal(premium["product.ai_position_copilot"], true);
  assert.equal(premium["product.ai_position_monitoring"], true);
  assert.equal(premium["product.ai_multi_exchange_analysis"], true);
  assert.equal(premium["product.market_intelligence_advanced"], true);
  assert.deepEqual(enterprise, premium);
});

test("Free Grid and Prediction Copier dependencies resolve through the shared capability registry", () => {
  const free = getDefaultPlanCapabilities("free");
  assert.equal(free["product.grid_bots"], true);
  assert.equal(free["execution.mode.grid"], true);
  assert.equal(free["strategy.kind.futures_grid"], true);
  assert.equal(free["strategy.kind.prediction_copier"], true);
  assert.equal(free["product.vaults"], false);
});
