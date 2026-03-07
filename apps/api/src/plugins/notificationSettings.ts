import { prisma } from "@mm/db";

const db = prisma as any;
const NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX = "settings.alerts.notificationPlugins.v1:";
const NOTIFICATION_DESTINATIONS_SETTINGS_KEY_PREFIX = "settings.alerts.notificationDestinations.v1:";

export type NotificationPluginSettings = {
  version: 1;
  enabled: string[];
  disabled: string[];
  order: string[];
};

export type NotificationDestinationsSettings = {
  version: 1;
  webhook: {
    url: string | null;
    headers: Record<string, string>;
  };
};

export function notificationPluginSettingsKey(userId: string): string {
  return `${NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX}${userId}`;
}

export function notificationDestinationsSettingsKey(userId: string): string {
  return `${NOTIFICATION_DESTINATIONS_SETTINGS_KEY_PREFIX}${userId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeList(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = String(entry ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeWebhookUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeHeaders(value: unknown): Record<string, string> {
  const row = asRecord(value);
  if (!row) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(row)) {
    const header = String(key ?? "").trim();
    const val = String(raw ?? "").trim();
    if (!header || !val) continue;
    out[header] = val;
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}

function mergeOrdered(enabled: string[], order: string[]): string[] {
  const out: string[] = [];
  for (const item of order) {
    if (!enabled.includes(item) || out.includes(item)) continue;
    out.push(item);
  }
  for (const item of enabled) {
    if (out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

export function defaultNotificationPluginSettings(): NotificationPluginSettings {
  return {
    version: 1,
    enabled: ["core.notification.telegram"],
    disabled: [],
    order: ["core.notification.telegram"]
  };
}

export function defaultNotificationDestinationsSettings(): NotificationDestinationsSettings {
  return {
    version: 1,
    webhook: {
      url: normalizeWebhookUrl(process.env.NOTIFICATION_WEBHOOK_URL) ?? null,
      headers: {}
    }
  };
}

export function parseStoredNotificationPluginSettings(value: unknown): NotificationPluginSettings {
  const row = asRecord(value);
  if (!row) return defaultNotificationPluginSettings();

  const enabled = normalizeList(row.enabled);
  const disabled = normalizeList(row.disabled);
  const normalizedEnabled = enabled.filter((id) => !disabled.includes(id));
  const order = mergeOrdered(normalizedEnabled, normalizeList(row.order));

  return {
    version: 1,
    enabled: normalizedEnabled,
    disabled,
    order
  };
}

export function parseStoredNotificationDestinationsSettings(value: unknown): NotificationDestinationsSettings {
  const defaults = defaultNotificationDestinationsSettings();
  const row = asRecord(value);
  if (!row) return defaults;

  const webhookRow = asRecord(row.webhook);
  return {
    version: 1,
    webhook: {
      url: normalizeWebhookUrl(webhookRow?.url) ?? defaults.webhook.url,
      headers: normalizeHeaders(webhookRow?.headers)
    }
  };
}

export async function getNotificationPluginSettingsForUser(userId: string): Promise<NotificationPluginSettings> {
  const key = notificationPluginSettingsKey(userId);
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  return parseStoredNotificationPluginSettings(row?.value);
}

export async function updateNotificationPluginSettingsForUser(params: {
  userId: string;
  patch: Record<string, unknown>;
}): Promise<NotificationPluginSettings> {
  const current = await getNotificationPluginSettingsForUser(params.userId);
  const next = parseStoredNotificationPluginSettings({
    ...current,
    ...params.patch
  });

  await db.globalSetting.upsert({
    where: { key: notificationPluginSettingsKey(params.userId) },
    update: {
      value: next
    },
    create: {
      key: notificationPluginSettingsKey(params.userId),
      value: next
    }
  });

  return next;
}

export async function getNotificationDestinationsSettingsForUser(
  userId: string
): Promise<NotificationDestinationsSettings> {
  const key = notificationDestinationsSettingsKey(userId);
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  return parseStoredNotificationDestinationsSettings(row?.value);
}

export async function updateNotificationDestinationsSettingsForUser(params: {
  userId: string;
  patch: Record<string, unknown>;
}): Promise<NotificationDestinationsSettings> {
  const current = await getNotificationDestinationsSettingsForUser(params.userId);
  const next = parseStoredNotificationDestinationsSettings({
    ...current,
    ...params.patch
  });

  await db.globalSetting.upsert({
    where: { key: notificationDestinationsSettingsKey(params.userId) },
    update: {
      value: next
    },
    create: {
      key: notificationDestinationsSettingsKey(params.userId),
      value: next
    }
  });

  return next;
}
