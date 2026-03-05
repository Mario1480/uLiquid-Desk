import type { BotPluginConfig, BotPluginPolicySnapshot } from "@mm/plugin-sdk";
import { z } from "zod";

const pluginIdSchema = z.string().trim().min(1).max(160);

const pluginPolicySnapshotSchema = z.object({
  plan: z.enum(["free", "pro", "enterprise"]),
  allowedPluginIds: z.array(pluginIdSchema).max(500).nullable(),
  evaluatedAt: z.string().trim().datetime()
});

export const botPluginConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.array(pluginIdSchema).max(200).optional(),
  disabled: z.array(pluginIdSchema).max(200).optional(),
  order: z.array(pluginIdSchema).max(200).optional(),
  overrides: z.record(z.record(z.any())).optional(),
  policySnapshot: pluginPolicySnapshotSchema.optional()
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown, limit = 200): string[] {
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

function normalizePolicySnapshot(value: unknown): BotPluginPolicySnapshot | undefined {
  const parsed = pluginPolicySnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    plan: parsed.data.plan,
    allowedPluginIds: parsed.data.allowedPluginIds ? [...parsed.data.allowedPluginIds] : null,
    evaluatedAt: new Date(parsed.data.evaluatedAt).toISOString()
  };
}

function normalizeOverrides(value: unknown): Record<string, Record<string, unknown>> | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const out: Record<string, Record<string, unknown>> = {};

  for (const [pluginId, raw] of Object.entries(row)) {
    const id = String(pluginId ?? "").trim();
    const entry = asRecord(raw);
    if (!id || !entry) continue;
    out[id] = { ...entry };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeBotPluginConfig(value: unknown): BotPluginConfig | null {
  if (value === undefined || value === null) return null;

  const parsed = botPluginConfigSchema.safeParse(value);
  if (parsed.success) {
    return {
      version: 1,
      enabled: parsed.data.enabled ? normalizeStringList(parsed.data.enabled) : undefined,
      disabled: parsed.data.disabled ? normalizeStringList(parsed.data.disabled) : undefined,
      order: parsed.data.order ? normalizeStringList(parsed.data.order) : undefined,
      overrides: parsed.data.overrides,
      policySnapshot: parsed.data.policySnapshot
    };
  }

  const row = asRecord(value);
  if (!row) return null;

  return {
    version: 1,
    enabled: normalizeStringList(row.enabled),
    disabled: normalizeStringList(row.disabled),
    order: normalizeStringList(row.order),
    overrides: normalizeOverrides(row.overrides),
    policySnapshot: normalizePolicySnapshot(row.policySnapshot)
  };
}

export function readBotPluginConfigFromParams(paramsJson: unknown): BotPluginConfig | null {
  const params = asRecord(paramsJson);
  if (!params) return null;
  return normalizeBotPluginConfig(params.plugins);
}

export function withBotPluginConfigInParams(
  paramsJson: unknown,
  pluginConfig: BotPluginConfig | null
): Record<string, unknown> {
  const params = asRecord(paramsJson) ?? {};
  const out: Record<string, unknown> = { ...params };
  if (!pluginConfig) {
    delete out.plugins;
    return out;
  }
  out.plugins = {
    version: 1,
    enabled: pluginConfig.enabled ?? [],
    disabled: pluginConfig.disabled ?? [],
    order: pluginConfig.order ?? [],
    overrides: pluginConfig.overrides ?? {},
    ...(pluginConfig.policySnapshot ? { policySnapshot: pluginConfig.policySnapshot } : {})
  };
  return out;
}

export function attachPluginPolicySnapshot(
  paramsJson: unknown,
  policySnapshot: BotPluginPolicySnapshot
): Record<string, unknown> {
  const existing = readBotPluginConfigFromParams(paramsJson);
  const next: BotPluginConfig = {
    version: 1,
    enabled: existing?.enabled ?? [],
    disabled: existing?.disabled ?? [],
    order: existing?.order ?? [],
    overrides: existing?.overrides ?? {},
    policySnapshot
  };
  return withBotPluginConfigInParams(paramsJson, next);
}

export function validateBotPluginConfigValue(value: unknown): { ok: true } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true };
  const parsed = botPluginConfigSchema.safeParse(value);
  if (parsed.success) return { ok: true };
  return {
    ok: false,
    message: "invalid plugins configuration"
  };
}
