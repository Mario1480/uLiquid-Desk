import { logger } from "../logger.js";

const RECONCILE_INTERVAL_MS = 30_000;
const LIFECYCLE_INTERVAL_MS = 60 * 60 * 1000;

type BillingOnchainJobDeps = {
  isBillingEnabled(): Promise<boolean>;
  discoverMissingBillingTransactions(limit?: number): Promise<unknown>;
  reconcilePendingBillingPayments(limit?: number): Promise<unknown>;
  runSubscriptionLifecycle(params?: { now?: Date; limit?: number }): Promise<unknown>;
};

export function createBillingOnchainJob(deps: BillingOnchainJobDeps) {
  let reconcileTimer: NodeJS.Timeout | null = null;
  let lifecycleTimer: NodeJS.Timeout | null = null;
  let reconcileRunning = false;
  let lifecycleRunning = false;

  async function runReconcileCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (reconcileRunning) return { skipped: "already_running" as const };
    reconcileRunning = true;
    try {
      let discovered: unknown = null;
      let discoveryError: string | null = null;
      try {
        discovered = await deps.discoverMissingBillingTransactions(100);
      } catch (error) {
        discoveryError = error instanceof Error ? error.message : String(error);
        logger.warn("billing_onchain_discovery_cycle_failed", { reason, error: discoveryError });
      }

      let reconciled: unknown = null;
      let reconciliationError: string | null = null;
      try {
        reconciled = await deps.reconcilePendingBillingPayments(100);
      } catch (error) {
        reconciliationError = error instanceof Error ? error.message : String(error);
        logger.warn("billing_onchain_submitted_reconcile_cycle_failed", {
          reason,
          error: reconciliationError
        });
      }
      logger.info("billing_onchain_reconcile_cycle", {
        reason,
        discovered,
        reconciled,
        discoveryError,
        reconciliationError
      });
      return {
        discovered,
        reconciled,
        ...(discoveryError ? { discoveryError } : {}),
        ...(reconciliationError ? { reconciliationError } : {})
      };
    } finally {
      reconcileRunning = false;
    }
  }

  async function runLifecycleCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (lifecycleRunning) return { skipped: "already_running" as const };
    lifecycleRunning = true;
    try {
      const result = await deps.runSubscriptionLifecycle({ now: new Date(), limit: 500 });
      logger.info("billing_subscription_lifecycle_cycle", { reason, result });
      return result;
    } catch (error) {
      logger.warn("billing_subscription_lifecycle_cycle_failed", {
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      lifecycleRunning = false;
    }
  }

  function start() {
    if (!reconcileTimer) {
      reconcileTimer = setInterval(() => {
        void runReconcileCycle("scheduled").catch(() => undefined);
      }, RECONCILE_INTERVAL_MS);
    }
    if (!lifecycleTimer) {
      lifecycleTimer = setInterval(() => {
        void runLifecycleCycle("scheduled").catch(() => undefined);
      }, LIFECYCLE_INTERVAL_MS);
    }
    void runReconcileCycle("startup").catch(() => undefined);
    void runLifecycleCycle("startup").catch(() => undefined);
  }

  function stop() {
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (lifecycleTimer) clearInterval(lifecycleTimer);
    reconcileTimer = null;
    lifecycleTimer = null;
  }

  return {
    runReconcileCycle,
    runLifecycleCycle,
    start,
    stop
  };
}
