import { logger } from "../logger.js";
import { getUliqAutoFinalizerSettings, UliqAutoFinalizerService } from "../uliq/autoFinalizer.service.js";
import { expireUliqBenefitReservations } from "../uliq/benefitReservation.service.js";
import { getUliqFeatureFlags, getUliqRuntimeConfig } from "../uliq/config.js";
import { UliqIndexerService } from "../uliq/indexer.service.js";
import { UliqPurchaseTrackingService } from "../uliq/purchaseTracking.service.js";
import { getUliqPublicPresaleConfig, getUliqPublicPresaleFlags } from "../uliq/publicPresale.config.js";
import { UliqPublicPresaleIndexerService } from "../uliq/publicPresaleIndexer.service.js";
import {
  getUliqPublicPresaleAutoFinalizerSettings,
  UliqPublicPresaleAutoFinalizerService
} from "../uliq/publicPresaleAutoFinalizer.service.js";
import { UliqPublicPresaleService } from "../uliq/publicPresale.service.js";
import { UliqReconciliationService } from "../uliq/reconciliation.service.js";

type JobState = {
  enabled: boolean;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastResult: unknown;
};

function intervalMs(name: string, fallbackSeconds: number): number {
  const parsed = Number(process.env[name] ?? fallbackSeconds);
  return Math.max(5, Number.isFinite(parsed) ? parsed : fallbackSeconds) * 1_000;
}

function safeEnabled(flag: "enabled" | "discountsEnabled"): boolean {
  try {
    const flags = getUliqFeatureFlags();
    return flags.enabled && flags[flag];
  } catch {
    return false;
  }
}

function autoFinalizerEnabled(): boolean {
  try {
    const flags = getUliqFeatureFlags();
    return flags.enabled && flags.presaleEnabled && getUliqAutoFinalizerSettings().enabled;
  } catch {
    return false;
  }
}

function publicPresaleEnabled(): boolean {
  try {
    return getUliqPublicPresaleFlags().enabled;
  } catch {
    return false;
  }
}

function publicPresaleAutoFinalizerEnabled(): boolean {
  try {
    return getUliqPublicPresaleFlags().enabled
      && getUliqPublicPresaleAutoFinalizerSettings().mode !== "OFF";
  } catch {
    return false;
  }
}

function createPollingJob(params: {
  name: string;
  enabled: () => boolean;
  pollMs: number;
  run: () => Promise<unknown>;
}) {
  let timer: NodeJS.Timeout | null = null;
  const state: JobState = {
    enabled: params.enabled(),
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResult: null
  };
  async function runOnce() {
    state.enabled = params.enabled();
    if (!state.enabled || state.running) return null;
    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    try {
      const result = await params.run();
      state.lastResult = result;
      state.lastError = null;
      return result;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.warn(`${params.name}_failed`, { reason: state.lastError });
      return null;
    } finally {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
    }
  }
  return {
    start() {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => { void runOnce(); }, params.pollMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce,
    getStatus: () => ({ ...state, pollMs: params.pollMs })
  };
}

function createDrainingPollingJob(params: {
  name: string;
  enabled: () => boolean;
  pollMs: number;
  drainMs: number;
  run: () => Promise<unknown>;
}) {
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  const state: JobState = {
    enabled: params.enabled(),
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResult: null
  };
  const schedule = (delayMs: number) => {
    if (!started) return;
    timer = setTimeout(() => { void cycle(); }, delayMs);
    timer.unref?.();
  };
  const cycle = async () => {
    timer = null;
    const result = await runOnce();
    const hasMore = Boolean(result && typeof result === "object" && (result as any).hasMore === true);
    schedule(hasMore ? params.drainMs : params.pollMs);
  };
  const runOnce = async () => {
    state.enabled = params.enabled();
    if (!state.enabled || state.running) return null;
    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    try {
      const result = await params.run();
      state.lastResult = result;
      state.lastError = null;
      return result;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger.warn(`${params.name}_failed`, { reason: state.lastError });
      return null;
    } finally {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
    }
  };
  return {
    start() {
      if (started) return;
      started = true;
      void cycle();
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    runOnce,
    getStatus: () => ({ ...state, pollMs: params.pollMs, drainMs: params.drainMs })
  };
}

export function createUliqJobs(db: any) {
  let indexer: UliqIndexerService | null = null;
  let purchaseTracking: UliqPurchaseTrackingService | null = null;
  let reconciliation: UliqReconciliationService | null = null;
  let autoFinalizer: UliqAutoFinalizerService | null = null;
  let publicPresale: UliqPublicPresaleService | null = null;
  let publicPresaleIndexer: UliqPublicPresaleIndexerService | null = null;
  let publicPresaleAutoFinalizer: UliqPublicPresaleAutoFinalizerService | null = null;
  const getIndexer = () => indexer ??= new UliqIndexerService(db, getUliqRuntimeConfig());
  const getPurchaseTracking = () => purchaseTracking ??= new UliqPurchaseTrackingService(db, getUliqRuntimeConfig());
  const getReconciliation = () => reconciliation ??= new UliqReconciliationService(db, getUliqRuntimeConfig());
  const getAutoFinalizer = () => autoFinalizer ??= new UliqAutoFinalizerService(db, getUliqRuntimeConfig());
  const getPublicPresale = () => publicPresale ??= new UliqPublicPresaleService(db);
  const getPublicPresaleIndexer = () => publicPresaleIndexer ??= new UliqPublicPresaleIndexerService(db);
  const getPublicPresaleAutoFinalizer = () => publicPresaleAutoFinalizer
    ??= new UliqPublicPresaleAutoFinalizerService(db);
  const publicAutoFinalizerSettings = getUliqPublicPresaleAutoFinalizerSettings();
  return {
    indexer: createPollingJob({
      name: "uliq_indexer",
      enabled: () => safeEnabled("enabled"),
      pollMs: intervalMs("ULIQ_INDEXER_INTERVAL_SECONDS", 15),
      run: async () => {
        try {
          return await getIndexer().runOnce();
        } catch (error) {
          const config = getUliqRuntimeConfig();
          const reason = error instanceof Error ? error.message : String(error);
          await db.onchainSyncCursor.updateMany({
            where: { id: `uliq:${config.chainId}:all` },
            data: {
              failureCount: { increment: 1 },
              nextRetryAt: new Date(Date.now() + 30_000),
              lastError: reason.slice(0, 1_000),
              leaseExpiresAt: new Date()
            }
          }).catch(() => undefined);
          throw error;
        }
      }
    }),
    purchaseTracking: createPollingJob({
      name: "uliq_purchase_tracking",
      enabled: () => safeEnabled("enabled"),
      pollMs: intervalMs("ULIQ_PURCHASE_TRACKING_INTERVAL_SECONDS", 10),
      run: () => getPurchaseTracking().reconcilePending()
    }),
    publicPresaleTracking: createPollingJob({
      name: "uliq_public_presale_tracking",
      enabled: publicPresaleEnabled,
      pollMs: intervalMs("ULIQ_PUBLIC_PRESALE_TRACKING_INTERVAL_SECONDS", 10),
      run: () => getPublicPresale().reconcilePending()
    }),
    publicPresaleIndexer: createPollingJob({
      name: "uliq_public_presale_indexer",
      enabled: publicPresaleEnabled,
      pollMs: intervalMs("ULIQ_PUBLIC_PRESALE_INDEXER_INTERVAL_SECONDS", 15),
      run: async () => {
        try {
          return await getPublicPresaleIndexer().runOnce();
        } catch (error) {
          const config = getUliqPublicPresaleConfig();
          const reason = error instanceof Error ? error.message : String(error);
          await db.onchainSyncCursor.updateMany({
            where: { id: `uliq-public-presale:${config.chainId}:all` },
            data: {
              failureCount: { increment: 1 },
              nextRetryAt: new Date(Date.now() + 30_000),
              lastError: reason.slice(0, 1_000),
              leaseExpiresAt: new Date()
            }
          }).catch(() => undefined);
          throw error;
        }
      }
    }),
    publicPresaleAutoFinalizer: createDrainingPollingJob({
      name: "uliq_public_presale_auto_finalizer",
      enabled: publicPresaleAutoFinalizerEnabled,
      pollMs: publicAutoFinalizerSettings.intervalMs,
      drainMs: publicAutoFinalizerSettings.drainIntervalMs,
      run: () => getPublicPresaleAutoFinalizer().runOnce()
    }),
    autoFinalizer: createPollingJob({
      name: "uliq_auto_finalizer",
      enabled: autoFinalizerEnabled,
      pollMs: intervalMs("ULIQ_AUTO_FINALIZER_INTERVAL_SECONDS", 30),
      run: () => getAutoFinalizer().runOnce()
    }),
    reconciliation: createPollingJob({
      name: "uliq_reconciliation",
      enabled: () => safeEnabled("enabled"),
      pollMs: intervalMs("ULIQ_RECONCILIATION_INTERVAL_SECONDS", 300),
      run: () => getReconciliation().runOnce()
    }),
    reservationExpiry: createPollingJob({
      name: "uliq_reservation_expiry",
      enabled: () => safeEnabled("discountsEnabled"),
      pollMs: intervalMs("ULIQ_RESERVATION_EXPIRY_INTERVAL_SECONDS", 30),
      run: () => expireUliqBenefitReservations(db)
    })
  };
}
