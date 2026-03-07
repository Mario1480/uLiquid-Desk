import type express from "express";
import { prisma } from "@mm/db";
import {
  createCapabilitySnapshot,
  normalizeCapabilityOverrides,
  normalizeCapabilitySnapshot,
  normalizePlanTier,
  requiredPlanForCapability,
  resolveCapabilities,
  type CapabilityKey,
  type CapabilityOverrides,
  type CapabilitySnapshot,
  type PlanCapabilities,
  type PlanTier
} from "@mm/core";

const db = prisma as any;
const PLAN_CAPABILITY_OVERRIDES_KEY_PREFIX = "plan.capabilities.override.v1:";
const OVERRIDE_CACHE_TTL_MS = 30_000;
const overrideCache = new Map<PlanTier, { expiresAt: number; value: CapabilityOverrides }>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function overrideKeyForPlan(plan: PlanTier): string {
  return `${PLAN_CAPABILITY_OVERRIDES_KEY_PREFIX}${plan}`;
}

export async function loadCapabilityOverridesForPlan(plan: PlanTier): Promise<CapabilityOverrides> {
  const normalizedPlan = normalizePlanTier(plan);
  const cached = overrideCache.get(normalizedPlan);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) {
    return { ...cached.value };
  }

  try {
    const row = await db.globalSetting.findUnique({
      where: { key: overrideKeyForPlan(normalizedPlan) },
      select: { value: true }
    });
    const normalized = normalizeCapabilityOverrides(row?.value);
    overrideCache.set(normalizedPlan, {
      expiresAt: nowMs + OVERRIDE_CACHE_TTL_MS,
      value: normalized
    });
    return { ...normalized };
  } catch {
    return {};
  }
}

export async function resolveCapabilitiesForPlan(params: {
  plan: PlanTier;
  policySnapshot?: { capabilitySnapshot?: unknown } | null;
  now?: Date;
}): Promise<{
  plan: PlanTier;
  capabilities: PlanCapabilities;
  capabilitySnapshot: CapabilitySnapshot;
}> {
  const plan = normalizePlanTier(params.plan);
  const snapshot = normalizeCapabilitySnapshot(asRecord(params.policySnapshot)?.capabilitySnapshot ?? null);
  const overrides = await loadCapabilityOverridesForPlan(plan);
  const capabilities = resolveCapabilities({
    plan,
    overrides,
    snapshot
  });
  return {
    plan,
    capabilities,
    capabilitySnapshot: snapshot ?? createCapabilitySnapshot(capabilities, params.now ?? new Date())
  };
}

export function buildCapabilityDeniedPayload(input: {
  capability: CapabilityKey;
  currentPlan: PlanTier;
  legacyCode?: string;
}): {
  status: 403;
  payload: Record<string, unknown>;
} {
  const currentPlan = normalizePlanTier(input.currentPlan);
  const requiredPlan = requiredPlanForCapability(input.capability);
  return {
    status: 403,
    payload: {
      error: "feature_not_available",
      code: "CAPABILITY_DENIED",
      capability: input.capability,
      requiredPlan,
      currentPlan,
      message: "This feature is not available in your current plan.",
      ...(input.legacyCode ? { legacyCode: input.legacyCode } : {})
    }
  };
}

export function sendCapabilityDenied(
  res: express.Response,
  input: {
    capability: CapabilityKey;
    currentPlan: PlanTier;
    legacyCode?: string;
  }
) {
  const denial = buildCapabilityDeniedPayload(input);
  return res.status(denial.status).json(denial.payload);
}

export function isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean {
  return capabilities[capability] === true;
}
