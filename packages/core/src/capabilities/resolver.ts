import { getDefaultPlanCapabilities } from "./defaults.js";
import {
  CAPABILITY_KEYS,
  type CapabilityEvaluation,
  type CapabilityKey,
  type CapabilityOverrides,
  type CapabilityResolutionInput,
  type CapabilitySnapshot,
  type PlanCapabilities,
  type PlanTier
} from "./types.js";

export function normalizePlanTier(value: unknown): PlanTier {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return "pro";
}

export function planRank(plan: PlanTier): number {
  if (plan === "enterprise") return 3;
  if (plan === "pro") return 2;
  return 1;
}

export function isPlanAtLeast(plan: PlanTier, minPlan: PlanTier | null | undefined): boolean {
  if (!minPlan) return true;
  return planRank(plan) >= planRank(minPlan);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeCapabilityOverrides(value: unknown): CapabilityOverrides {
  const row = asRecord(value);
  if (!row) return {};

  const out: CapabilityOverrides = {};
  for (const key of CAPABILITY_KEYS) {
    const raw = row[key];
    if (typeof raw !== "boolean") continue;
    out[key] = raw;
  }
  return out;
}

export function normalizeCapabilitySnapshot(value: unknown): CapabilitySnapshot | null {
  const row = asRecord(value);
  if (!row) return null;
  if (Number(row.version) !== 1) return null;
  const values = normalizeCapabilityOverrides(row.values);
  const evaluatedAtRaw = String(row.evaluatedAt ?? "").trim();
  const parsed = new Date(evaluatedAtRaw);
  const evaluatedAt = Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date(0).toISOString();
  return {
    version: 1,
    values,
    evaluatedAt
  };
}

export function createCapabilitySnapshot(
  values: Partial<Record<CapabilityKey, boolean>>,
  now: Date = new Date()
): CapabilitySnapshot {
  return {
    version: 1,
    values: normalizeCapabilityOverrides(values),
    evaluatedAt: now.toISOString()
  };
}

function applyOverrides(target: PlanCapabilities, overrides: CapabilityOverrides): void {
  for (const key of CAPABILITY_KEYS) {
    const value = overrides[key];
    if (typeof value !== "boolean") continue;
    target[key] = value;
  }
}

export function resolveCapabilities(input: CapabilityResolutionInput): PlanCapabilities {
  const plan = normalizePlanTier(input.plan);
  const out = getDefaultPlanCapabilities(plan);
  applyOverrides(out, normalizeCapabilityOverrides(input.overrides));
  const snapshot = normalizeCapabilitySnapshot(input.snapshot);
  if (snapshot) {
    applyOverrides(out, snapshot.values);
  }
  return out;
}

export function hasCapability(capabilities: PlanCapabilities, key: CapabilityKey): boolean {
  return capabilities[key] === true;
}

export function requiredPlanForCapability(key: CapabilityKey): PlanTier | null {
  if (PLAN_ORDERED_BY_STRENGTH.free[key]) return "free";
  if (PLAN_ORDERED_BY_STRENGTH.pro[key]) return "pro";
  if (PLAN_ORDERED_BY_STRENGTH.enterprise[key]) return "enterprise";
  return null;
}

const PLAN_ORDERED_BY_STRENGTH = {
  free: getDefaultPlanCapabilities("free"),
  pro: getDefaultPlanCapabilities("pro"),
  enterprise: getDefaultPlanCapabilities("enterprise")
} as const;

export function evaluateCapability(params: {
  plan: PlanTier;
  capabilities: PlanCapabilities;
  capability: CapabilityKey;
}): CapabilityEvaluation {
  return {
    allowed: hasCapability(params.capabilities, params.capability),
    capability: params.capability,
    currentPlan: normalizePlanTier(params.plan),
    requiredPlan: requiredPlanForCapability(params.capability)
  };
}

const PLUGIN_ID_CAPABILITY_MAP: Record<string, CapabilityKey> = {
  "core.signal.legacy_dummy": "plugin.signal",
  "core.signal.prediction_copier": "strategy.kind.prediction_copier",
  "core.execution.simple": "execution.mode.simple",
  "core.execution.dca": "execution.mode.dca",
  "core.execution.grid": "execution.mode.grid",
  "core.execution.dip_reversion": "execution.mode.dip_reversion",
  "core.execution.futures_engine_legacy": "execution.mode.simple",
  "core.execution.prediction_copier": "strategy.kind.prediction_copier",
  "core.execution.futures_grid": "strategy.kind.futures_grid",
  "core.signal_source.none": "plugin.signal_source",
  "core.signal_source.prediction_state": "strategy.kind.prediction_copier",
  "core.notification.telegram": "plugin.notification.telegram",
  "core.notification.webhook": "plugin.notification.webhook"
};

export function capabilityForPlugin(params: {
  pluginId: string;
  kind?: "signal" | "execution" | "notification" | "exchange_extension" | "signal_source" | string | null;
}): CapabilityKey | null {
  const byId = PLUGIN_ID_CAPABILITY_MAP[params.pluginId];
  if (byId) return byId;

  const kind = typeof params.kind === "string" ? params.kind : "";
  if (kind === "signal") return "plugin.signal";
  if (kind === "execution") return "plugin.execution";
  if (kind === "signal_source") return "plugin.signal_source";
  if (kind === "notification") return "plugin.notification";
  if (kind === "exchange_extension") return "plugin.exchange_extension";
  return null;
}

export type CapabilityDeniedError = Error & {
  code: "CAPABILITY_DENIED";
  capability: CapabilityKey;
  currentPlan: PlanTier;
  requiredPlan: PlanTier | null;
};

export function createCapabilityDeniedError(input: {
  capability: CapabilityKey;
  currentPlan: PlanTier;
  requiredPlan?: PlanTier | null;
  message?: string;
}): CapabilityDeniedError {
  const requiredPlan = input.requiredPlan ?? requiredPlanForCapability(input.capability);
  const err = new Error(
    input.message
    ?? `Capability '${input.capability}' is not available for plan '${input.currentPlan}'.`
  ) as CapabilityDeniedError;
  err.code = "CAPABILITY_DENIED";
  err.capability = input.capability;
  err.currentPlan = normalizePlanTier(input.currentPlan);
  err.requiredPlan = requiredPlan;
  return err;
}

export function assertCapability(params: {
  capabilities: PlanCapabilities;
  capability: CapabilityKey;
  plan: PlanTier;
}): void {
  const evaluation = evaluateCapability({
    capabilities: params.capabilities,
    capability: params.capability,
    plan: params.plan
  });
  if (evaluation.allowed) return;
  throw createCapabilityDeniedError({
    capability: evaluation.capability,
    currentPlan: evaluation.currentPlan,
    requiredPlan: evaluation.requiredPlan
  });
}
