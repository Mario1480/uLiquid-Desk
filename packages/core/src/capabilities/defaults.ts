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
  "execution.mode.dca",
  "execution.mode.grid",
  "execution.mode.dip_reversion",
  "backtesting.run",
  "backtesting.compare",
  "strategy.kind.ai",
  "strategy.kind.composite",
  "strategy.kind.prediction_copier",
  "strategy.kind.futures_grid",
  "strategy.model.advanced",
  "product.ai_predictions",
  "product.composite_strategies",
  "product.grid_bots",
  "product.vaults"
];

const ENTERPRISE_TRUE: CapabilityKey[] = [...PRO_TRUE];

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
