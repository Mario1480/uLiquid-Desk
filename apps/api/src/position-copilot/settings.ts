import type { PositionCopilotPreferenceMode } from "./core.js";

export type PositionCopilotSettings = {
  version: 1;
  mode: PositionCopilotPreferenceMode;
  inAppEnabled: boolean;
  telegramEnabled: boolean;
  cooldownMinutes: number;
  periodicMinutes: number;
};

export const DEFAULT_POSITION_COPILOT_SETTINGS: PositionCopilotSettings = {
  version: 1,
  mode: "important_changes",
  inAppEnabled: true,
  telegramEnabled: false,
  cooldownMinutes: 15,
  periodicMinutes: 60
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export function positionCopilotSettingsKey(userId: string): string {
  return `settings.positionCopilot.v1:${userId}`;
}

export function parsePositionCopilotSettings(value: unknown): PositionCopilotSettings {
  const record = asRecord(value);
  const mode: PositionCopilotPreferenceMode = record.mode === "critical_only"
    || record.mode === "important_changes"
    || record.mode === "periodic_summary"
    || record.mode === "off"
    ? record.mode
    : DEFAULT_POSITION_COPILOT_SETTINGS.mode;
  return {
    version: 1,
    mode,
    inAppEnabled: typeof record.inAppEnabled === "boolean"
      ? record.inAppEnabled
      : DEFAULT_POSITION_COPILOT_SETTINGS.inAppEnabled,
    telegramEnabled: typeof record.telegramEnabled === "boolean"
      ? record.telegramEnabled
      : DEFAULT_POSITION_COPILOT_SETTINGS.telegramEnabled,
    cooldownMinutes: boundedInt(record.cooldownMinutes, DEFAULT_POSITION_COPILOT_SETTINGS.cooldownMinutes, 5, 240),
    periodicMinutes: boundedInt(record.periodicMinutes, DEFAULT_POSITION_COPILOT_SETTINGS.periodicMinutes, 15, 1440)
  };
}

export async function loadPositionCopilotSettings(db: any, userId: string): Promise<PositionCopilotSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: positionCopilotSettingsKey(userId) },
    select: { value: true }
  });
  return parsePositionCopilotSettings(row?.value);
}

export async function savePositionCopilotSettings(
  db: any,
  userId: string,
  value: unknown
): Promise<PositionCopilotSettings> {
  const settings = parsePositionCopilotSettings(value);
  await db.globalSetting.upsert({
    where: { key: positionCopilotSettingsKey(userId) },
    update: { value: settings },
    create: { key: positionCopilotSettingsKey(userId), value: settings }
  });
  return settings;
}
