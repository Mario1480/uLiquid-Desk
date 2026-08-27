const DURATION_UNITS = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 }
] as const;

export function lockCoverageShortfallSeconds(unlockAt: string, requiredUntil: string): number | null {
  const unlockAtMs = new Date(unlockAt).getTime();
  const requiredUntilMs = new Date(requiredUntil).getTime();
  if (!Number.isFinite(unlockAtMs) || !Number.isFinite(requiredUntilMs)) return null;
  return Math.max(0, Math.ceil((requiredUntilMs - unlockAtMs) / 1_000));
}

export function formatLockDuration(totalSeconds: number, locale: string, maximumParts = 2): string {
  let remaining = Math.max(0, Math.ceil(totalSeconds));
  const parts: string[] = [];

  for (const { unit, seconds } of DURATION_UNITS) {
    const value = Math.floor(remaining / seconds);
    if (value === 0 && parts.length === 0) continue;
    if (value > 0) {
      parts.push(new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "short",
        maximumFractionDigits: 0
      }).format(value));
      remaining -= value * seconds;
    }
    if (parts.length >= Math.max(1, maximumParts)) break;
  }

  if (parts.length > 0) return parts.join(" ");
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "second",
    unitDisplay: "short",
    maximumFractionDigits: 0
  }).format(0);
}
