import type { BotPluginConfig, BotPluginPolicySnapshot } from "@mm/plugin-sdk";
import { normalizeCapabilitySnapshot } from "@mm/core";
import type { ActiveFuturesBot } from "../db.js";

const MAX_LIST_ITEMS = 100;

type NormalizedBotPluginConfig = {
  version: 1;
  enabled: string[];
  disabled: string[];
  order: string[];
  overrides: Record<string, Record<string, unknown>>;
  policySnapshot: BotPluginPolicySnapshot | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizePluginId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizePluginId(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

function normalizePlan(value: unknown): "free" | "pro" | "enterprise" | null {
  if (value === "free" || value === "pro" || value === "enterprise") return value;
  return null;
}

function normalizePolicySnapshot(value: unknown): BotPluginPolicySnapshot | null {
  const row = asRecord(value);
  if (!row) return null;
  const plan = normalizePlan(row.plan);
  if (!plan) return null;

  let allowedPluginIds: string[] | null = null;
  if (row.allowedPluginIds === null || row.allowedPluginIds === undefined) {
    allowedPluginIds = null;
  } else {
    allowedPluginIds = normalizeIdList(row.allowedPluginIds);
  }

  const evaluatedAtRaw = String(row.evaluatedAt ?? "").trim();
  const evaluatedAtDate = new Date(evaluatedAtRaw);
  const evaluatedAt = Number.isFinite(evaluatedAtDate.getTime())
    ? evaluatedAtDate.toISOString()
    : new Date(0).toISOString();
  const capabilitySnapshot = normalizeCapabilitySnapshot(row.capabilitySnapshot);

  return {
    plan,
    allowedPluginIds,
    evaluatedAt,
    ...(capabilitySnapshot ? { capabilitySnapshot } : {})
  };
}

function normalizeOverrides(value: unknown): Record<string, Record<string, unknown>> {
  const row = asRecord(value);
  if (!row) return {};

  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(row)) {
    const normalizedKey = normalizePluginId(key);
    const entryRow = asRecord(entry);
    if (!normalizedKey || !entryRow) continue;
    out[normalizedKey] = { ...entryRow };
  }
  return out;
}

export function normalizeBotPluginConfig(value: unknown): NormalizedBotPluginConfig {
  const row = asRecord(value);
  if (!row) {
    return {
      version: 1,
      enabled: [],
      disabled: [],
      order: [],
      overrides: {},
      policySnapshot: null
    };
  }

  const version = Number(row.version);
  return {
    version: version === 1 ? 1 : 1,
    enabled: normalizeIdList(row.enabled),
    disabled: normalizeIdList(row.disabled),
    order: normalizeIdList(row.order),
    overrides: normalizeOverrides(row.overrides),
    policySnapshot: normalizePolicySnapshot(row.policySnapshot)
  };
}

export function readBotPluginConfig(bot: ActiveFuturesBot): NormalizedBotPluginConfig {
  const params = asRecord(bot.paramsJson);
  return normalizeBotPluginConfig(params?.plugins);
}

export function toBotPluginConfig(config: NormalizedBotPluginConfig): BotPluginConfig {
  return {
    version: 1,
    enabled: config.enabled,
    disabled: config.disabled,
    order: config.order,
    overrides: config.overrides,
    policySnapshot: config.policySnapshot ?? undefined
  };
}
