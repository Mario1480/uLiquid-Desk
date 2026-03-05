import { prisma } from "@mm/db";

const db = prisma as any;
const NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX = "settings.alerts.notificationPlugins.v1:";

export type NotificationPluginSettings = {
  version: 1;
  enabled: string[];
  disabled: string[];
  order: string[];
};

export function notificationPluginSettingsKey(userId: string): string {
  return `${NOTIFICATION_PLUGIN_SETTINGS_KEY_PREFIX}${userId}`;
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
