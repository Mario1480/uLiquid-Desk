import {
  capabilityForPlugin,
  isPlanAtLeast,
  normalizeCapabilitySnapshot,
  normalizePlanTier,
  resolveCapabilities,
  type CapabilityKey,
  type CapabilitySnapshot,
  type PlanCapabilities,
  type PlanTier
} from "@mm/core";
import type { ActiveFuturesBot } from "../db.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export type RunnerCapabilityPolicy = {
  plan: PlanTier;
  allowedPluginIds: string[] | null;
  capabilities: PlanCapabilities;
  capabilitySnapshot: CapabilitySnapshot | null;
};

export function readRunnerCapabilityPolicy(bot: ActiveFuturesBot): RunnerCapabilityPolicy {
  const params = asRecord(bot.paramsJson);
  const plugins = asRecord(params?.plugins);
  const policySnapshot = asRecord(plugins?.policySnapshot);
  const plan = normalizePlanTier(policySnapshot?.plan);
  const allowedRaw = policySnapshot?.allowedPluginIds;
  const allowedPluginIds =
    allowedRaw === null || allowedRaw === undefined
      ? null
      : normalizeStringList(allowedRaw);
  const capabilitySnapshot = normalizeCapabilitySnapshot(policySnapshot?.capabilitySnapshot ?? null);
  const capabilities = resolveCapabilities({
    plan,
    snapshot: capabilitySnapshot
  });
  return {
    plan,
    allowedPluginIds,
    capabilities,
    capabilitySnapshot
  };
}

export function isAllowedByPolicySnapshot(pluginId: string, allowedPluginIds: string[] | null): boolean {
  if (allowedPluginIds === null) return true;
  return allowedPluginIds.includes(pluginId);
}

export function isPluginCapabilityAllowed(params: {
  pluginId: string;
  kind?: "signal" | "execution" | "notification" | "exchange_extension" | "signal_source" | string;
  capabilities: PlanCapabilities;
}): {
  allowed: boolean;
  capability: CapabilityKey | null;
} {
  const capability = capabilityForPlugin({
    pluginId: params.pluginId,
    kind: params.kind
  });
  if (!capability) {
    return { allowed: true, capability: null };
  }
  return {
    allowed: params.capabilities[capability] === true,
    capability
  };
}

export function isAllowedByMinPlan(minPlan: PlanTier | undefined, plan: PlanTier): boolean {
  if (!minPlan) return true;
  return isPlanAtLeast(plan, minPlan);
}
