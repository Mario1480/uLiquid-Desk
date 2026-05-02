export type PredictionRefreshStatus = "ok" | "degraded";

export type PredictionRefreshHealthDto = {
  refreshStatus: PredictionRefreshStatus;
  lastRefreshAttemptAt: string | null;
  lastRefreshErrorAt: string | null;
  lastRefreshError: string | null;
  refreshFailureCount: number;
};

function toIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

export function normalizePredictionRefreshStatus(value: unknown): PredictionRefreshStatus {
  return value === "degraded" ? "degraded" : "ok";
}

export function sanitizePredictionRefreshError(error: unknown): string {
  const raw = error instanceof Error && typeof error.message === "string"
    ? error.message
    : String(error ?? "refresh_failed");
  const compact = raw.trim().replace(/\s+/g, " ");
  return (compact || "refresh_failed").slice(0, 240);
}

export function buildPredictionRefreshSuccessPatch(now = new Date()) {
  return {
    refreshStatus: "ok",
    lastRefreshAttemptAt: now,
    lastRefreshErrorAt: null,
    lastRefreshError: null,
    refreshFailureCount: 0
  };
}

export function buildPredictionRefreshFailurePatch(error: unknown, now = new Date()) {
  return {
    refreshStatus: "degraded",
    lastRefreshAttemptAt: now,
    lastRefreshErrorAt: now,
    lastRefreshError: sanitizePredictionRefreshError(error),
    refreshFailureCount: { increment: 1 }
  };
}

export function toPredictionRefreshHealthDto(row: Record<string, unknown>): PredictionRefreshHealthDto {
  const failureCount = Number(row.refreshFailureCount);
  return {
    refreshStatus: normalizePredictionRefreshStatus(row.refreshStatus),
    lastRefreshAttemptAt: toIso(row.lastRefreshAttemptAt),
    lastRefreshErrorAt: toIso(row.lastRefreshErrorAt),
    lastRefreshError:
      typeof row.lastRefreshError === "string" && row.lastRefreshError.trim()
        ? row.lastRefreshError.trim()
        : null,
    refreshFailureCount:
      Number.isFinite(failureCount) && failureCount > 0 ? Math.trunc(failureCount) : 0
  };
}
