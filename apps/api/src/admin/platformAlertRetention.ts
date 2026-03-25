export const PLATFORM_ALERT_RETENTION_SETTING_KEY = "admin.platformAlerts.retention.v1";
export const PLATFORM_ALERT_RETENTION_DAYS = 30;

export type PlatformAlertRetentionSettings = {
  autoDeleteOlderThan30Days: boolean;
  updatedAt: string | null;
  source: "db" | "default";
};

function parseStoredRetention(value: unknown): boolean | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).autoDeleteOlderThan30Days;
  return typeof raw === "boolean" ? raw : null;
}

export async function getPlatformAlertRetentionSettings(db: any): Promise<PlatformAlertRetentionSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: PLATFORM_ALERT_RETENTION_SETTING_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredRetention(row?.value);
  return {
    autoDeleteOlderThan30Days: stored ?? false,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    source: stored === null ? "default" : "db"
  };
}

export async function setPlatformAlertRetentionSettings(
  db: any,
  autoDeleteOlderThan30Days: boolean
): Promise<PlatformAlertRetentionSettings> {
  const updated = await db.globalSetting.upsert({
    where: { key: PLATFORM_ALERT_RETENTION_SETTING_KEY },
    create: {
      key: PLATFORM_ALERT_RETENTION_SETTING_KEY,
      value: { autoDeleteOlderThan30Days }
    },
    update: {
      value: { autoDeleteOlderThan30Days }
    },
    select: { updatedAt: true }
  });

  return {
    autoDeleteOlderThan30Days,
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : null,
    source: "db"
  };
}

export function resolvePlatformAlertRetentionCutoff(
  now: Date = new Date(),
  retentionDays: number = PLATFORM_ALERT_RETENTION_DAYS
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
