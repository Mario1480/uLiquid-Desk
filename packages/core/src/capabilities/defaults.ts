import { CAPABILITY_KEYS } from "./types.js";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "./types.js";

const FREE_TRUE: CapabilityKey[] = [
  "plugin.signal",
  "plugin.execution",
  "plugin.signal_source",
  "plugin.notification",
  "plugin.exchange_extension",
  "plugin.notification.telegram",
  "execution.mode.simple",
  "strategy.kind.local",
  "product.local_strategies",
  "product.paper_trading",
  "product.admin_advanced",
  "notification.send.trade",
  "notification.send.risk",
  "notification.send.error"
];

const PRO_TRUE: CapabilityKey[] = [
  ...FREE_TRUE,
  "plugin.notification.webhook",
  "execution.mode.grid",
  "execution.mode.dca",
  "execution.mode.dip_reversion",
  "backtesting.run",
  "backtesting.compare",
  "strategy.kind.ai",
  "strategy.kind.composite",
  "strategy.kind.futures_grid",
  "strategy.model.advanced",
  "product.ai_predictions",
  "product.ai_prediction_builder",
  "product.market_intelligence",
  "product.ai_agent_chat",
  "product.ai_position_copilot",
  "product.composite_strategies",
  "product.grid_bots"
];

const PREMIUM_TRUE: CapabilityKey[] = [
  ...PRO_TRUE,
  "strategy.kind.prediction_copier",
  "product.market_intelligence_advanced",
  "product.ai_agent_account_reads",
  "product.ai_agent_custom_profiles",
  "product.ai_position_copilot",
  "product.ai_position_monitoring",
  "product.ai_multi_exchange_analysis"
];
const ENTERPRISE_TRUE: CapabilityKey[] = [...PREMIUM_TRUE];

function buildCapabilityMap(trueKeys: CapabilityKey[]): PlanCapabilities {
  const row: Partial<PlanCapabilities> = {};
  const trueKeySet = new Set<CapabilityKey>(trueKeys);
  for (const key of CAPABILITY_KEYS) {
    row[key] = trueKeySet.has(key);
  }
  return row as PlanCapabilities;
}

export const PLAN_CAPABILITIES_DEFAULTS: Record<PlanTier, PlanCapabilities> = {
  free: buildCapabilityMap(FREE_TRUE),
  pro: buildCapabilityMap(PRO_TRUE),
  premium: buildCapabilityMap(PREMIUM_TRUE),
  enterprise: buildCapabilityMap(ENTERPRISE_TRUE)
};

export function getDefaultPlanCapabilities(plan: PlanTier): PlanCapabilities {
  const source = PLAN_CAPABILITIES_DEFAULTS[plan];
  const out = {} as PlanCapabilities;
  for (const key of Object.keys(source) as CapabilityKey[]) {
    out[key] = source[key] === true;
  }
  return out;
}
