export const PRODUCT_FEATURE_KEYS = [
  "ai_predictions",
  "ai_prediction_builder",
  "market_intelligence",
  "market_intelligence_advanced",
  "ai_agent_chat",
  "ai_agent_account_reads",
  "ai_agent_custom_profiles",
  "ai_position_copilot",
  "ai_position_monitoring",
  "ai_multi_exchange_analysis",
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
  fallback = false
): boolean {
  const gate = featureGates?.[feature];
  return typeof gate?.allowed === "boolean" ? gate.allowed : fallback;
}

export function anyStrategyProductFeatureAllowed(
  featureGates: ProductFeatureGateMap | null | undefined,
  fallback = false
): boolean {
  return (
    isProductFeatureAllowed(featureGates, "local_strategies", fallback)
    || isProductFeatureAllowed(featureGates, "ai_predictions", fallback)
    || isProductFeatureAllowed(featureGates, "composite_strategies", fallback)
  );
}

export function titleForProductFeature(feature: ProductFeatureKey): string {
  if (feature === "ai_predictions") return "AI predictions";
  if (feature === "ai_prediction_builder") return "AI prediction builder";
  if (feature === "market_intelligence") return "Market Intelligence";
  if (feature === "market_intelligence_advanced") return "Advanced Market Intelligence";
  if (feature === "ai_agent_chat") return "AI Agent Chat";
  if (feature === "ai_agent_account_reads") return "AI agent account reads";
  if (feature === "ai_agent_custom_profiles") return "Custom AI agent profiles";
  if (feature === "ai_position_copilot") return "Position Copilot";
  if (feature === "ai_position_monitoring") return "AI position monitoring";
  if (feature === "ai_multi_exchange_analysis") return "Multi-exchange AI analysis";
  if (feature === "local_strategies") return "Local strategies";
  if (feature === "composite_strategies") return "Composite strategies";
  if (feature === "grid_bots") return "Grid bots";
  if (feature === "vaults") return "Vaults";
  if (feature === "paper_trading") return "Paper trading";
  return "Advanced admin";
}
