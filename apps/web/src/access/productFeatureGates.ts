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

export type ProductFeatureGateSnapshot = {
  feature: ProductFeatureKey;
  capability: string;
  title: string;
  allowed: boolean;
  currentPlan: string;
  requiredPlan: string | null;
};

export type ProductFeatureGateMap = Partial<Record<ProductFeatureKey, ProductFeatureGateSnapshot>>;

export function isProductFeatureAllowed(
  featureGates: ProductFeatureGateMap | null | undefined,
  feature: ProductFeatureKey,
  fallback = true
): boolean {
  const gate = featureGates?.[feature];
  return typeof gate?.allowed === "boolean" ? gate.allowed : fallback;
}

export function anyStrategyProductFeatureAllowed(
  featureGates: ProductFeatureGateMap | null | undefined,
  fallback = true
): boolean {
  return (
    isProductFeatureAllowed(featureGates, "local_strategies", fallback)
    || isProductFeatureAllowed(featureGates, "ai_predictions", fallback)
    || isProductFeatureAllowed(featureGates, "composite_strategies", fallback)
  );
}

export function titleForProductFeature(feature: ProductFeatureKey): string {
  if (feature === "ai_predictions") return "AI predictions";
  if (feature === "local_strategies") return "Local strategies";
  if (feature === "composite_strategies") return "Composite strategies";
  if (feature === "grid_bots") return "Grid bots";
  if (feature === "vaults") return "Vaults";
  if (feature === "paper_trading") return "Paper trading";
  return "Advanced admin";
}
