import type { BotPluginPolicySnapshot, PlanTier } from "@mm/plugin-sdk";
import { listPluginCatalogForPlan } from "./catalog.js";

export function normalizePlanTier(value: unknown): PlanTier {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

export function buildPluginPolicySnapshot(plan: PlanTier): BotPluginPolicySnapshot {
  const items = listPluginCatalogForPlan(plan);
  if (plan === "pro" || plan === "enterprise") {
    return {
      plan,
      allowedPluginIds: null,
      evaluatedAt: new Date().toISOString()
    };
  }

  return {
    plan,
    allowedPluginIds: items.filter((item) => item.allowed).map((item) => item.id),
    evaluatedAt: new Date().toISOString()
  };
}

export function isPluginAllowedByPolicySnapshot(pluginId: string, snapshot: BotPluginPolicySnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  if (snapshot.allowedPluginIds === null) return true;
  return snapshot.allowedPluginIds.includes(pluginId);
}
