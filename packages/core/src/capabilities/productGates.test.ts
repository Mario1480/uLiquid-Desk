import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultPlanCapabilities } from "./defaults.js";
import {
  capabilityForProductFeature,
  listProductFeatureDefinitions,
  requiredPlanForProductFeature,
  resolveProductFeatureGates
} from "./productGates.js";

test("product feature registry maps each feature to a capability", () => {
  const items = listProductFeatureDefinitions();
  assert.equal(items.length, 7);
  assert.equal(capabilityForProductFeature("vaults"), "product.vaults");
  assert.equal(requiredPlanForProductFeature("grid_bots"), "pro");
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
  assert.equal(gates.composite_strategies.allowed, false);
  assert.equal(gates.grid_bots.allowed, false);
  assert.equal(gates.vaults.allowed, false);
});

test("pro plan enables advanced trading product modules", () => {
  const gates = resolveProductFeatureGates({
    plan: "pro",
    capabilities: getDefaultPlanCapabilities("pro")
  });
  assert.equal(gates.ai_predictions.allowed, true);
  assert.equal(gates.local_strategies.allowed, true);
  assert.equal(gates.composite_strategies.allowed, true);
  assert.equal(gates.grid_bots.allowed, true);
  assert.equal(gates.vaults.allowed, true);
});
