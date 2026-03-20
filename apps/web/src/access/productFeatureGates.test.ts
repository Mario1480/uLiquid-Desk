import assert from "node:assert/strict";
import test from "node:test";
import {
  anyStrategyProductFeatureAllowed,
  isProductFeatureAllowed,
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
  assert.equal(isProductFeatureAllowed(featureGates, "vaults"), true);
  assert.equal(anyStrategyProductFeatureAllowed(featureGates), true);
  assert.equal(titleForProductFeature("grid_bots"), "Grid bots");
});
