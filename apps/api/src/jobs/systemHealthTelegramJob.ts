import { logger } from "../logger.js";

export type SystemHealthStateValue = "healthy" | "unhealthy" | "skipped";

export type StoredSystemHealthState = {
  state: SystemHealthStateValue;
  checkedAt: string;
  message: string;
  rawState?: SystemHealthStateValue;
  rawStateStreak?: number;
};

export type SystemHealthStateStore = Partial<Record<"ai" | "saladRuntime" | "fmp" | "ccpay", StoredSystemHealthState>>;

export type SystemHealthTelegramJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  totalCycles: number;
  totalFailedCycles: number;
  consecutiveFailedCycles: number;
  totalLagAlerts: number;
  lastCheckCount: number;
  lastHealthyCount: number;
  lastUnhealthyCount: number;
  lastSkippedCount: number;
  lastTransitionCount: number;
  lastAlertSentCount: number;
  lastResolvedCount: number;
};

export const SYSTEM_HEALTH_STATE_SETTING_KEY = "system.health.telegramMonitor.v1";

type ExternalHealthCheckLike = {
  state: SystemHealthStateValue;
  checkedAt: string;
  message: string;
  latencyMs?: number;
  httpStatus?: number;
  source?: string | null;
  details?: Record<string, unknown>;
};

type ExternalHealthSnapshotLike = {
  ai: ExternalHealthCheckLike;
  saladRuntime: ExternalHealthCheckLike;
  fmp: ExternalHealthCheckLike;
  ccpay: ExternalHealthCheckLike;
};

export type CreateSystemHealthTelegramJobDeps = {
  externalHealthService: {
    checkAll(): Promise<ExternalHealthSnapshotLike>;
  };
  resolveSystemTelegramConfig(): Promise<{ botToken: string; telegramChatId: string } | null>;
  sendTelegramMessage(params: { telegramBotToken: string; telegramChatId: string; text: string }): Promise<void>;
};

function parseStoredSystemHealthState(value: unknown): SystemHealthStateStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: SystemHealthStateStore = {};
  for (const key of ["ai", "saladRuntime", "fmp", "ccpay"] as const) {
    const raw = record[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const state = entry.state === "healthy" || entry.state === "unhealthy" || entry.state === "skipped"
      ? entry.state
      : null;
    const rawState = entry.rawState === "healthy" || entry.rawState === "unhealthy" || entry.rawState === "skipped"
      ? entry.rawState
      : undefined;
    const rawStateStreak = Number(entry.rawStateStreak);
    const checkedAt = typeof entry.checkedAt === "string" ? entry.checkedAt.trim() : "";
    const message = typeof entry.message === "string" ? entry.message.trim() : "";
    if (!state || !checkedAt) continue;
    out[key] = {
      state,
      checkedAt,
      message,
      ...(rawState ? { rawState } : {}),
      ...(Number.isFinite(rawStateStreak) && rawStateStreak >= 1
        ? { rawStateStreak: Math.trunc(rawStateStreak) }
        : {})
    };
  }
  return out;
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.trunc(parsed);
}

function buildAlertTitle(checkId: keyof SystemHealthStateStore): string {
  return `System health incident: ${checkId}`;
}

function buildTelegramMessage(params: {
  checkId: keyof SystemHealthStateStore;
  event: "incident" | "recovery";
  result: ExternalHealthCheckLike;
}): string {
  const headline = params.event === "incident"
    ? "uLiquid Desk system health alert"
    : "uLiquid Desk system health recovered";
  return [
    headline,
    `Check: ${params.checkId}`,
    `State: ${params.result.state}`,
    `Message: ${params.result.message}`,
    `Time: ${params.result.checkedAt}`,
    ...(typeof params.result.latencyMs === "number" ? [`Latency: ${params.result.latencyMs}ms`] : []),
    ...(typeof params.result.httpStatus === "number" ? [`HTTP: ${params.result.httpStatus}`] : [])
  ].join("\n");
}

export function createSystemHealthTelegramJob(
  db: any,
  deps: CreateSystemHealthTelegramJobDeps
) {
  const SYSTEM_HEALTH_TELEGRAM_ENABLED = !["0", "false", "off", "no"].includes(
    String(process.env.SYSTEM_HEALTH_TELEGRAM_ENABLED ?? "1").trim().toLowerCase()
  );
  const SYSTEM_HEALTH_TELEGRAM_INTERVAL_MS =
    Math.max(15, Number(process.env.SYSTEM_HEALTH_TELEGRAM_INTERVAL_SECONDS ?? "60")) * 1000;
  const SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED =
    parsePositiveIntEnv(process.env.SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED, 2);
  const SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED =
    parsePositiveIntEnv(process.env.SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED, 2);

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let totalCycles = 0;
  let totalFailedCycles = 0;
  let consecutiveFailedCycles = 0;
  let lastCheckCount = 0;
  let lastHealthyCount = 0;
  let lastUnhealthyCount = 0;
  let lastSkippedCount = 0;
  let lastTransitionCount = 0;
  let lastAlertSentCount = 0;
  let lastResolvedCount = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!SYSTEM_HEALTH_TELEGRAM_ENABLED) return;
    if (running) return;
    running = true;
    lastStartedAt = new Date();
    totalCycles += 1;

    try {
      const [snapshot, systemTelegramConfig, row] = await Promise.all([
        deps.externalHealthService.checkAll(),
        deps.resolveSystemTelegramConfig(),
        db.globalSetting.findUnique({
          where: { key: SYSTEM_HEALTH_STATE_SETTING_KEY },
          select: { value: true }
        })
      ]);

      const previous = parseStoredSystemHealthState(row?.value);
      const nextObservedState: ExternalHealthSnapshotLike = {
        ai: snapshot.ai,
        saladRuntime: snapshot.saladRuntime,
        fmp: snapshot.fmp,
        ccpay: snapshot.ccpay
      };
      const nextState: SystemHealthStateStore = {};

      let healthyCount = 0;
      let unhealthyCount = 0;
      let skippedCount = 0;
      let transitionCount = 0;
      let alertSentCount = 0;
      let resolvedCount = 0;

      for (const [checkId, observedResult] of Object.entries(nextObservedState) as Array<[keyof SystemHealthStateStore, ExternalHealthCheckLike]>) {
        const previousEntry = previous[checkId];
        const previousState = previousEntry?.state ?? null;
        const previousRawState = previousEntry?.rawState ?? previousState;
        const previousRawStateStreak = Number(previousEntry?.rawStateStreak);
        const rawStateStreak =
          previousRawState === observedResult.state
            ? (Number.isFinite(previousRawStateStreak) && previousRawStateStreak >= 1
                ? Math.trunc(previousRawStateStreak) + 1
                : 2)
            : 1;
        let effectiveState = observedResult.state;
        if (
          previousState
          && previousState !== "unhealthy"
          && observedResult.state === "unhealthy"
          && rawStateStreak < SYSTEM_HEALTH_UNHEALTHY_STREAK_REQUIRED
        ) {
          effectiveState = previousState;
        } else if (
          previousState === "unhealthy"
          && observedResult.state === "healthy"
          && rawStateStreak < SYSTEM_HEALTH_HEALTHY_STREAK_REQUIRED
        ) {
          effectiveState = previousState;
        }
        const result: ExternalHealthCheckLike = {
          ...observedResult,
          state: effectiveState
        };
        nextState[checkId] = {
          state: effectiveState,
          checkedAt: observedResult.checkedAt,
          message: observedResult.message,
          rawState: observedResult.state,
          rawStateStreak
        };

        if (!result) continue;
        if (result.state === "healthy") healthyCount += 1;
        else if (result.state === "unhealthy") unhealthyCount += 1;
        else skippedCount += 1;
        if (previousState === result.state) {
          if (result.state === "unhealthy") {
            await db.platformAlert.updateMany({
              where: {
                source: "system",
                type: "system_health",
                title: buildAlertTitle(checkId),
                status: { in: ["open", "acknowledged"] }
              },
              data: {
                message: result.message,
                metadata: {
                  checkId,
                  state: result.state,
                  checkedAt: result.checkedAt,
                  latencyMs: result.latencyMs ?? null,
                  httpStatus: result.httpStatus ?? null,
                  source: result.source ?? null,
                  details: result.details ?? null
                }
              }
            });
          }
          continue;
        }

        transitionCount += 1;
        if (result.state === "unhealthy") {
          const existing = await db.platformAlert.findFirst({
            where: {
              source: "system",
              type: "system_health",
              title: buildAlertTitle(checkId),
              status: { in: ["open", "acknowledged"] }
            },
            select: { id: true }
          });
          if (!existing) {
            await db.platformAlert.create({
              data: {
                severity: "critical",
                status: "open",
                type: "system_health",
                source: "system",
                title: buildAlertTitle(checkId),
                message: result.message,
                metadata: {
                  checkId,
                  state: result.state,
                  checkedAt: result.checkedAt,
                  latencyMs: result.latencyMs ?? null,
                  httpStatus: result.httpStatus ?? null,
                  source: result.source ?? null,
                  details: result.details ?? null
                }
              }
            });
          } else {
            await db.platformAlert.update({
              where: { id: existing.id },
              data: {
                message: result.message,
                metadata: {
                  checkId,
                  state: result.state,
                  checkedAt: result.checkedAt,
                  latencyMs: result.latencyMs ?? null,
                  httpStatus: result.httpStatus ?? null,
                  source: result.source ?? null,
                  details: result.details ?? null
                }
              }
            });
          }

          if (systemTelegramConfig) {
            await deps.sendTelegramMessage({
              telegramBotToken: systemTelegramConfig.botToken,
              telegramChatId: systemTelegramConfig.telegramChatId,
              text: buildTelegramMessage({
                checkId,
                event: "incident",
                result
              })
            });
            alertSentCount += 1;
          }
        } else if (previousState === "unhealthy") {
          const existing = await db.platformAlert.findFirst({
            where: {
              source: "system",
              type: "system_health",
              title: buildAlertTitle(checkId),
              status: { in: ["open", "acknowledged"] }
            },
            select: { id: true }
          });
          if (existing) {
            await db.platformAlert.update({
              where: { id: existing.id },
              data: {
                status: "resolved",
                resolvedAt: new Date(),
                message: result.message,
                metadata: {
                  checkId,
                  state: result.state,
                  checkedAt: result.checkedAt,
                  latencyMs: result.latencyMs ?? null,
                  httpStatus: result.httpStatus ?? null,
                  source: result.source ?? null,
                  details: result.details ?? null
                }
              }
            });
            resolvedCount += 1;
          }

          if (result.state === "healthy" && systemTelegramConfig) {
            await deps.sendTelegramMessage({
              telegramBotToken: systemTelegramConfig.botToken,
              telegramChatId: systemTelegramConfig.telegramChatId,
              text: buildTelegramMessage({
                checkId,
                event: "recovery",
                result
              })
            });
            alertSentCount += 1;
          }
        }
      }

      await db.globalSetting.upsert({
        where: { key: SYSTEM_HEALTH_STATE_SETTING_KEY },
        create: { key: SYSTEM_HEALTH_STATE_SETTING_KEY, value: nextState },
        update: { value: nextState }
      });

      lastCheckCount = 4;
      lastHealthyCount = healthyCount;
      lastUnhealthyCount = unhealthyCount;
      lastSkippedCount = skippedCount;
      lastTransitionCount = transitionCount;
      lastAlertSentCount = alertSentCount;
      lastResolvedCount = resolvedCount;
      consecutiveFailedCycles = 0;
      lastError = null;
      lastErrorAt = null;

      logger.info("system_health_telegram_cycle", {
        reason,
        healthy_count: healthyCount,
        unhealthy_count: unhealthyCount,
        skipped_count: skippedCount,
        transition_count: transitionCount,
        alert_sent_count: alertSentCount,
        resolved_count: resolvedCount
      });
    } catch (error) {
      totalFailedCycles += 1;
      consecutiveFailedCycles += 1;
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("system_health_telegram_cycle_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!SYSTEM_HEALTH_TELEGRAM_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, SYSTEM_HEALTH_TELEGRAM_INTERVAL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): SystemHealthTelegramJobStatus {
    return {
      enabled: SYSTEM_HEALTH_TELEGRAM_ENABLED,
      running,
      pollMs: SYSTEM_HEALTH_TELEGRAM_INTERVAL_MS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      totalCycles,
      totalFailedCycles,
      consecutiveFailedCycles,
      totalLagAlerts: 0,
      lastCheckCount,
      lastHealthyCount,
      lastUnhealthyCount,
      lastSkippedCount,
      lastTransitionCount,
      lastAlertSentCount,
      lastResolvedCount
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
