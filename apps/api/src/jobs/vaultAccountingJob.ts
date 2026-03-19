import { logger } from "../logger.js";
import type { VaultReconciliationStatus } from "../vaults/reconciliation.js";
import { createVaultService, type VaultService } from "../vaults/service.js";

const VAULT_ACCOUNTING_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.VAULT_ACCOUNTING_ENABLED ?? "1").trim().toLowerCase()
);
const VAULT_ACCOUNTING_POLL_MS =
  Math.max(5, Number(process.env.VAULT_ACCOUNTING_INTERVAL_SECONDS ?? "15")) * 1000;
const VAULT_ACCOUNTING_BATCH_LIMIT = Math.max(
  1,
  Math.min(500, Math.trunc(Number(process.env.VAULT_ACCOUNTING_BATCH_LIMIT ?? "100")))
);

export type VaultAccountingJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  batchLimit: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessedCount: number;
  lastRealizedEvents: number;
  lastRealizedNetUsd: number;
  lastProfitShareFeeUsd: number;
  lastStatus: VaultReconciliationStatus;
  totalCycles: number;
  totalProcessedEvents: number;
  totalRealizedEvents: number;
  totalFailedCycles: number;
};

export function createVaultAccountingJob(db: any, vaultService?: VaultService) {
  const service = vaultService ?? createVaultService(db);
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastProcessedCount = 0;
  let lastRealizedEvents = 0;
  let lastRealizedNetUsd = 0;
  let lastProfitShareFeeUsd = 0;
  let totalCycles = 0;
  let totalProcessedEvents = 0;
  let totalRealizedEvents = 0;
  let totalFailedCycles = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!VAULT_ACCOUNTING_ENABLED) return;
    if (running) return;
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();
    try {
      const summary = await service.processPendingGridFillEvents({
        limit: VAULT_ACCOUNTING_BATCH_LIMIT
      });
      lastProcessedCount = summary.processed;
      lastRealizedEvents = summary.realizedEvents;
      lastRealizedNetUsd = summary.realizedNetUsd;
      lastProfitShareFeeUsd = summary.profitShareFeeUsd;
      totalProcessedEvents += Number(summary.processed ?? 0);
      totalRealizedEvents += Number(summary.realizedEvents ?? 0);
      lastError = null;
      lastErrorAt = null;
      if (summary.processed > 0) {
        logger.info("vault_accounting_cycle", {
          reason,
          processed: summary.processed,
          realized_events: summary.realizedEvents,
          realized_net_usd: summary.realizedNetUsd,
          profit_share_fee_usd: summary.profitShareFeeUsd
        });
      }
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      logger.warn("vault_accounting_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!VAULT_ACCOUNTING_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, VAULT_ACCOUNTING_POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): VaultAccountingJobStatus {
    return {
      enabled: VAULT_ACCOUNTING_ENABLED,
      running,
      pollMs: VAULT_ACCOUNTING_POLL_MS,
      batchLimit: VAULT_ACCOUNTING_BATCH_LIMIT,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastProcessedCount,
      lastRealizedEvents,
      lastRealizedNetUsd,
      lastProfitShareFeeUsd,
      lastStatus: lastError ? "blocked" : "clean",
      totalCycles,
      totalProcessedEvents,
      totalRealizedEvents,
      totalFailedCycles
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
