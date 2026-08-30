import assert from "node:assert/strict";
import test from "node:test";
import {
  anyStrategyProductFeatureAllowed,
  isProductFeatureAllowed,
  isProductFeatureAvailable,
  titleForProductFeature
} from "./productFeatureGates.js";

test("product feature gate helpers respect explicit allow/deny values", () => {
  const featureGates = {
    ai_predictions: {
      feature: "ai_predictions" as const,
      capability: "product.ai_predictions",
      title: "AI predictions",
      allowed: false,
      currentPlan: "free",
      requiredPlan: "pro"
    },
    local_strategies: {
      feature: "local_strategies" as const,
      capability: "product.local_strategies",
      title: "Local strategies",
      allowed: true,
      currentPlan: "free",
      requiredPlan: "free"
    }
  };

  assert.equal(isProductFeatureAllowed(featureGates, "ai_predictions"), false);
  assert.equal(isProductFeatureAllowed(featureGates, "vaults"), false);
  assert.equal(isProductFeatureAllowed(featureGates, "vaults", true), true);
  assert.equal(anyStrategyProductFeatureAllowed(featureGates), true);
  assert.equal(titleForProductFeature("grid_bots"), "Grid bots");
  assert.equal(titleForProductFeature("ai_position_copilot"), "Position Copilot");
});

test("runtime-backed product features fail closed unless entitlement and runtime gates allow them", () => {
  const featureGates = {
    ai_position_copilot: {
      feature: "ai_position_copilot" as const,
      capability: "product.ai_position_copilot",
      title: "Position Copilot",
      allowed: true,
      currentPlan: "premium",
      requiredPlan: "premium"
    }
  };

  assert.equal(isProductFeatureAvailable(featureGates, undefined, "ai_position_copilot"), false);
  assert.equal(isProductFeatureAvailable(featureGates, {
    ai_position_copilot: false
  }, "ai_position_copilot"), false);
  assert.equal(isProductFeatureAvailable(featureGates, {
    ai_position_copilot: true
  }, "ai_position_copilot"), true);
  assert.equal(isProductFeatureAvailable({
    ai_position_copilot: { ...featureGates.ai_position_copilot, allowed: false }
  }, {
    ai_position_copilot: true
  }, "ai_position_copilot"), false);
});
