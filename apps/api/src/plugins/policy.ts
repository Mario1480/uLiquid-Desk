import type { BotPluginPolicySnapshot, PlanTier } from "@mm/plugin-sdk";
import {
  createCapabilitySnapshot,
  normalizeCapabilitySnapshot,
  normalizePlanTier as normalizePlanTierCore,
  resolveCapabilities,
  type CapabilitySnapshot
} from "@mm/core";
import { listPluginCatalogForCapabilities } from "./catalog.js";

export function normalizePlanTier(value: unknown): PlanTier {
  return normalizePlanTierCore(value);
}

export function buildPluginPolicySnapshot(
  plan: PlanTier,
  capabilitySnapshot?: CapabilitySnapshot | null
): BotPluginPolicySnapshot {
  const normalizedCapabilitySnapshot = normalizeCapabilitySnapshot(capabilitySnapshot);
  const capabilities = resolveCapabilities({
    plan,
    snapshot: normalizedCapabilitySnapshot
  });
  const items = listPluginCatalogForCapabilities(plan, capabilities);
  const allowedPluginIds = items.filter((item) => item.allowed).map((item) => item.id);
  const evaluatedAt = new Date().toISOString();
  const effectiveCapabilitySnapshot = normalizedCapabilitySnapshot ?? createCapabilitySnapshot(capabilities, new Date(evaluatedAt));

  return {
    plan,
    allowedPluginIds: allowedPluginIds.length === items.length ? null : allowedPluginIds,
    evaluatedAt,
    capabilitySnapshot: effectiveCapabilitySnapshot
  };
}

export function isPluginAllowedByPolicySnapshot(pluginId: string, snapshot: BotPluginPolicySnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  if (snapshot.allowedPluginIds === null) return true;
  return snapshot.allowedPluginIds.includes(pluginId);
}
