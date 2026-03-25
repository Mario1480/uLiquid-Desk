import { logger } from "../logger.js";
import {
  getPlatformAlertRetentionSettings,
  PLATFORM_ALERT_RETENTION_DAYS,
  resolvePlatformAlertRetentionCutoff
} from "../admin/platformAlertRetention.js";

const PLATFORM_ALERT_CLEANUP_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PLATFORM_ALERT_CLEANUP_ENABLED ?? "1").trim().toLowerCase()
);
const PLATFORM_ALERT_CLEANUP_POLL_MS =
  Math.max(300, Number(process.env.PLATFORM_ALERT_CLEANUP_INTERVAL_SECONDS ?? "21600")) * 1000;

export type PlatformAlertCleanupJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  retentionDays: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  totalCycles: number;
  totalDeleted: number;
  lastDeletedCount: number;
  lastSkippedDisabledBySetting: boolean;
};

export function createPlatformAlertCleanupJob(db: any) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let totalCycles = 0;
  let totalDeleted = 0;
  let lastDeletedCount = 0;
  let lastSkippedDisabledBySetting = false;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!PLATFORM_ALERT_CLEANUP_ENABLED) return;
    if (running) return;
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const retention = await getPlatformAlertRetentionSettings(db);
      if (!retention.autoDeleteOlderThan30Days) {
        lastDeletedCount = 0;
        lastSkippedDisabledBySetting = true;
        lastError = null;
        lastErrorAt = null;
        return;
      }

      const cutoff = resolvePlatformAlertRetentionCutoff(new Date(), PLATFORM_ALERT_RETENTION_DAYS);
      const deleted = await db.platformAlert.deleteMany({
        where: {
          createdAt: {
            lt: cutoff
          }
        }
      });

      lastDeletedCount = Number(deleted?.count ?? 0);
      totalDeleted += lastDeletedCount;
      lastSkippedDisabledBySetting = false;
      lastError = null;
      lastErrorAt = null;

      if (lastDeletedCount > 0) {
        logger.info("platform_alert_cleanup_cycle", {
          reason,
          retention_days: PLATFORM_ALERT_RETENTION_DAYS,
          deleted_count: lastDeletedCount
        });
      }
    } catch (error) {
      lastDeletedCount = 0;
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("platform_alert_cleanup_cycle_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!PLATFORM_ALERT_CLEANUP_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, PLATFORM_ALERT_CLEANUP_POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): PlatformAlertCleanupJobStatus {
    return {
      enabled: PLATFORM_ALERT_CLEANUP_ENABLED,
      running,
      pollMs: PLATFORM_ALERT_CLEANUP_POLL_MS,
      retentionDays: PLATFORM_ALERT_RETENTION_DAYS,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      totalCycles,
      totalDeleted,
      lastDeletedCount,
      lastSkippedDisabledBySetting
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
