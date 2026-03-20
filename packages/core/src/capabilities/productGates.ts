import {
  evaluateCapability,
  requiredPlanForCapability
} from "./resolver.js";
import type {
  CapabilityEvaluation,
  CapabilityKey,
  PlanCapabilities,
  PlanTier
} from "./types.js";

export const PRODUCT_FEATURE_KEYS = [
  "ai_predictions",
  "local_strategies",
  "composite_strategies",
  "grid_bots",
  "vaults",
  "paper_trading",
  "admin_advanced"
] as const;

export type ProductFeatureKey = (typeof PRODUCT_FEATURE_KEYS)[number];

export type ProductFeatureDefinition = {
  key: ProductFeatureKey;
  capability: CapabilityKey;
  title: string;
};

export type ProductFeatureGate = CapabilityEvaluation & {
  feature: ProductFeatureKey;
  title: string;
};

const PRODUCT_FEATURE_DEFINITIONS: Record<ProductFeatureKey, ProductFeatureDefinition> = {
  ai_predictions: {
    key: "ai_predictions",
    capability: "product.ai_predictions",
    title: "AI predictions"
  },
  local_strategies: {
    key: "local_strategies",
    capability: "product.local_strategies",
    title: "Local strategies"
  },
  composite_strategies: {
    key: "composite_strategies",
    capability: "product.composite_strategies",
    title: "Composite strategies"
  },
  grid_bots: {
    key: "grid_bots",
    capability: "product.grid_bots",
    title: "Grid bots"
  },
  vaults: {
    key: "vaults",
    capability: "product.vaults",
    title: "Vaults"
  },
  paper_trading: {
    key: "paper_trading",
    capability: "product.paper_trading",
    title: "Paper trading"
  },
  admin_advanced: {
    key: "admin_advanced",
    capability: "product.admin_advanced",
    title: "Advanced admin"
  }
};

export function listProductFeatureDefinitions(): ProductFeatureDefinition[] {
  return PRODUCT_FEATURE_KEYS.map((key) => PRODUCT_FEATURE_DEFINITIONS[key]);
}

export function getProductFeatureDefinition(feature: ProductFeatureKey): ProductFeatureDefinition {
  return PRODUCT_FEATURE_DEFINITIONS[feature];
}

export function capabilityForProductFeature(feature: ProductFeatureKey): CapabilityKey {
  return PRODUCT_FEATURE_DEFINITIONS[feature].capability;
}

export function requiredPlanForProductFeature(feature: ProductFeatureKey): PlanTier | null {
  return requiredPlanForCapability(capabilityForProductFeature(feature));
}

export function evaluateProductFeature(params: {
  feature: ProductFeatureKey;
  capabilities: PlanCapabilities;
  plan: PlanTier;
}): ProductFeatureGate {
  const definition = getProductFeatureDefinition(params.feature);
  const evaluation = evaluateCapability({
    plan: params.plan,
    capabilities: params.capabilities,
    capability: definition.capability
  });
  return {
    ...evaluation,
    feature: definition.key,
    title: definition.title
  };
}

export function resolveProductFeatureGates(params: {
  capabilities: PlanCapabilities;
  plan: PlanTier;
}): Record<ProductFeatureKey, ProductFeatureGate> {
  const out = {} as Record<ProductFeatureKey, ProductFeatureGate>;
  for (const key of PRODUCT_FEATURE_KEYS) {
    out[key] = evaluateProductFeature({
      feature: key,
      capabilities: params.capabilities,
      plan: params.plan
    });
  }
  return out;
}
