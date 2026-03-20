export type PlanTier = "free" | "pro" | "enterprise";

export const CAPABILITY_KEYS = [
  "plugin.signal",
  "plugin.execution",
  "plugin.signal_source",
  "plugin.notification",
  "plugin.exchange_extension",
  "plugin.notification.telegram",
  "plugin.notification.webhook",
  "execution.mode.simple",
  "execution.mode.dca",
  "execution.mode.grid",
  "execution.mode.dip_reversion",
  "backtesting.run",
  "backtesting.compare",
  "strategy.kind.local",
  "strategy.kind.ai",
  "strategy.kind.composite",
  "strategy.kind.prediction_copier",
  "strategy.kind.futures_grid",
  "strategy.model.advanced",
  "product.ai_predictions",
  "product.local_strategies",
  "product.composite_strategies",
  "product.grid_bots",
  "product.vaults",
  "product.paper_trading",
  "product.admin_advanced",
  "notification.send.trade",
  "notification.send.risk",
  "notification.send.error"
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type PlanCapabilities = Record<CapabilityKey, boolean>;

export type CapabilityOverrides = Partial<Record<CapabilityKey, boolean>>;

export type CapabilitySnapshot = {
  version: 1;
  values: CapabilityOverrides;
  evaluatedAt: string;
};

export type CapabilityResolutionInput = {
  plan: PlanTier;
  overrides?: CapabilityOverrides | null;
  snapshot?: CapabilitySnapshot | null;
};

export type CapabilityEvaluation = {
  allowed: boolean;
  capability: CapabilityKey;
  currentPlan: PlanTier;
  requiredPlan: PlanTier | null;
};
