import { logger } from "../logger.js";
import { getUliqAutoFinalizerSettings, UliqAutoFinalizerService } from "../uliq/autoFinalizer.service.js";
import { expireUliqBenefitReservations } from "../uliq/benefitReservation.service.js";
import { getUliqFeatureFlags, getUliqRuntimeConfig } from "../uliq/config.js";
import { UliqIndexerService } from "../uliq/indexer.service.js";
import { UliqPurchaseTrackingService } from "../uliq/purchaseTracking.service.js";
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

export function createUliqJobs(db: any) {
  let indexer: UliqIndexerService | null = null;
  let purchaseTracking: UliqPurchaseTrackingService | null = null;
  let reconciliation: UliqReconciliationService | null = null;
  let autoFinalizer: UliqAutoFinalizerService | null = null;
  const getIndexer = () => indexer ??= new UliqIndexerService(db, getUliqRuntimeConfig());
  const getPurchaseTracking = () => purchaseTracking ??= new UliqPurchaseTrackingService(db, getUliqRuntimeConfig());
  const getReconciliation = () => reconciliation ??= new UliqReconciliationService(db, getUliqRuntimeConfig());
  const getAutoFinalizer = () => autoFinalizer ??= new UliqAutoFinalizerService(db, getUliqRuntimeConfig());
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
