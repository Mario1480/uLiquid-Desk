import type { PlanTier, PluginKind } from "@mm/plugin-sdk";
import {
  capabilityForPlugin,
  isPlanAtLeast,
  resolveCapabilities,
  type PlanCapabilities
} from "@mm/core";

export type PluginCatalogItem = {
  id: string;
  kind: PluginKind;
  version: string;
  description: string;
  minPlan: PlanTier;
  defaultEnabled: boolean;
  capabilities: string[];
};

export type PluginCatalogPlanItem = PluginCatalogItem & {
  allowed: boolean;
  blockedReason: "plan_too_low" | "capability_denied" | null;
};

const BUILTIN_PLUGIN_CATALOG: PluginCatalogItem[] = [
  {
    id: "core.signal.legacy_dummy",
    kind: "signal",
    version: "1.0.0",
    description: "Built-in legacy dummy signal engine",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["runner.signal"]
  },
  {
    id: "core.signal.prediction_copier",
    kind: "signal",
    version: "1.0.0",
    description: "Built-in prediction copier signal engine",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.signal", "prediction.copier"]
  },
  {
    id: "core.execution.simple",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in simple execution mode",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["runner.execution", "execution.simple"]
  },
  {
    id: "core.execution.dca",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in DCA execution mode",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.execution", "execution.dca"]
  },
  {
    id: "core.execution.grid",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in grid execution mode",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.execution", "execution.grid"]
  },
  {
    id: "core.execution.dip_reversion",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in dip reversion execution mode",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.execution", "execution.dip_reversion"]
  },
  {
    id: "core.execution.futures_engine_legacy",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in legacy futures execution mode alias",
    minPlan: "free",
    defaultEnabled: false,
    capabilities: ["runner.execution", "futures.engine"]
  },
  {
    id: "core.execution.prediction_copier",
    kind: "execution",
    version: "1.0.0",
    description: "Built-in prediction copier execution mode",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.execution", "prediction.copier"]
  },
  {
    id: "core.signal_source.none",
    kind: "signal_source",
    version: "1.0.0",
    description: "Built-in neutral signal source",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["runner.signal_source"]
  },
  {
    id: "core.signal_source.prediction_state",
    kind: "signal_source",
    version: "1.0.0",
    description: "Built-in prediction state signal source",
    minPlan: "pro",
    defaultEnabled: true,
    capabilities: ["runner.signal_source", "prediction.state"]
  },
  {
    id: "core.notification.telegram",
    kind: "notification",
    version: "1.0.0",
    description: "Built-in Telegram notification channel",
    minPlan: "free",
    defaultEnabled: true,
    capabilities: ["notification.telegram"]
  },
  {
    id: "core.notification.webhook",
    kind: "notification",
    version: "1.0.0",
    description: "Built-in webhook notification channel",
    minPlan: "pro",
    defaultEnabled: false,
    capabilities: ["notification.webhook"]
  }
];

export function isPluginAllowedForPlan(minPlan: PlanTier, plan: PlanTier): boolean {
  return isPlanAtLeast(plan, minPlan);
}

export function listPluginCatalog(): PluginCatalogItem[] {
  return BUILTIN_PLUGIN_CATALOG.map((item) => ({
    ...item,
    capabilities: [...item.capabilities]
  }));
}

export function listPluginCatalogForPlan(plan: PlanTier): PluginCatalogPlanItem[] {
  const capabilities = resolveCapabilities({ plan });
  return listPluginCatalogForCapabilities(plan, capabilities);
}

export function listPluginCatalogForCapabilities(
  plan: PlanTier,
  capabilities: PlanCapabilities
): PluginCatalogPlanItem[] {
  return listPluginCatalog().map((item) => {
    const pluginCapability = capabilityForPlugin({
      pluginId: item.id,
      kind: item.kind
    });
    const allowedByCapability = pluginCapability ? capabilities[pluginCapability] === true : true;
    const allowedByPlan = isPluginAllowedForPlan(item.minPlan, plan);
    const allowed = allowedByCapability && allowedByPlan;
    return {
      ...item,
      allowed,
      blockedReason: allowed
        ? null
        : (allowedByCapability ? "plan_too_low" : "capability_denied")
    };
  });
}
