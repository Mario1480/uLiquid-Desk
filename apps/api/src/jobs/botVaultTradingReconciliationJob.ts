import { logger } from "../logger.js";
import {
  createBotVaultTradingReconciliationService,
  type BotVaultTradingReconciliationService
} from "../vaults/tradingReconciliation.service.js";

const BOT_VAULT_TRADING_RECONCILIATION_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.BOT_VAULT_TRADING_RECONCILIATION_ENABLED ?? "1").trim().toLowerCase()
);
const POLL_MS = Math.max(
  5,
  Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_INTERVAL_SECONDS ?? "30")
) * 1000;
const BATCH_LIMIT = Math.max(
  1,
  Math.min(500, Math.trunc(Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_BATCH_LIMIT ?? "100")))
);
const LAG_ALERT_MS = Math.max(
  10_000,
  Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_LAG_ALERT_SECONDS ?? "120") * 1000
);

function nowMs(): number {
  return Date.now();
}

export type BotVaultTradingReconciliationJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  batchLimit: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastScanned: number;
  lastProcessed: number;
  lastFailed: number;
  lastNewOrders: number;
  lastNewFills: number;
  lastNewFundingEvents: number;
  totalCycles: number;
  totalProcessedVaults: number;
  totalNewOrders: number;
  totalNewFills: number;
  totalNewFundingEvents: number;
  totalFailedCycles: number;
  consecutiveFailedCycles: number;
  totalLagAlerts: number;
};

export function createBotVaultTradingReconciliationJob(
  db: any,
  tradingReconciliationService?: BotVaultTradingReconciliationService
) {
  const service = tradingReconciliationService ?? createBotVaultTradingReconciliationService(db);
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastScanned = 0;
  let lastProcessed = 0;
  let lastFailed = 0;
  let lastNewOrders = 0;
  let lastNewFills = 0;
  let lastNewFundingEvents = 0;
  let totalCycles = 0;
  let totalProcessedVaults = 0;
  let totalNewOrders = 0;
  let totalNewFills = 0;
  let totalNewFundingEvents = 0;
  let totalFailedCycles = 0;
  let consecutiveFailedCycles = 0;
  let totalLagAlerts = 0;
  let lastLagAlertAt = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!BOT_VAULT_TRADING_RECONCILIATION_ENABLED) {
      return {
        scanned: 0,
        processed: 0,
        failed: 0,
        newOrders: 0,
        newFills: 0,
        newFundingEvents: 0
      };
    }
    if (running) {
      return {
        scanned: 0,
        processed: 0,
        failed: 0,
        newOrders: 0,
        newFills: 0,
        newFundingEvents: 0
      };
    }

    if (lastFinishedAt && nowMs() - lastFinishedAt.getTime() > LAG_ALERT_MS && nowMs() - lastLagAlertAt > LAG_ALERT_MS) {
      lastLagAlertAt = nowMs();
      totalLagAlerts += 1;
      logger.warn("vault_reconciliation_lag", {
        lagSeconds: Math.round((nowMs() - lastFinishedAt.getTime()) / 1000),
        thresholdSeconds: Math.round(LAG_ALERT_MS / 1000)
      });
    }

    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();
    try {
      const summary = await service.reconcileHyperliquidBotVaults({
        limit: BATCH_LIMIT
      });
      lastScanned = summary.scanned;
      lastProcessed = summary.processed;
      lastFailed = summary.failed;
      lastNewOrders = summary.newOrders;
      lastNewFills = summary.newFills;
      lastNewFundingEvents = summary.newFundingEvents;
      totalProcessedVaults += summary.processed;
      totalNewOrders += summary.newOrders;
      totalNewFills += summary.newFills;
      totalNewFundingEvents += summary.newFundingEvents;
      consecutiveFailedCycles = 0;
      lastError = null;
      lastErrorAt = null;

      if (summary.processed > 0 || summary.newFills > 0 || summary.newFundingEvents > 0) {
        logger.info("bot_vault_trading_reconciliation_cycle", {
          reason,
          scanned: summary.scanned,
          processed: summary.processed,
          failed: summary.failed,
          newOrders: summary.newOrders,
          newFills: summary.newFills,
          newFundingEvents: summary.newFundingEvents
        });
      }

      return summary;
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      consecutiveFailedCycles += 1;
      logger.warn("bot_vault_trading_reconciliation_cycle_failed", {
        reason,
        error: lastError
      });
      if (consecutiveFailedCycles >= 3) {
        totalLagAlerts += 1;
        logger.warn("vault_reconciliation_stalled", {
          consecutiveFailedCycles,
          error: lastError
        });
      }
      return {
        scanned: 0,
        processed: 0,
        failed: 0,
        newOrders: 0,
        newFills: 0,
        newFundingEvents: 0
      };
    } finally {
      running = false;
      lastFinishedAt = new Date();
    }
  }

  function start() {
    if (!BOT_VAULT_TRADING_RECONCILIATION_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): BotVaultTradingReconciliationJobStatus {
    return {
      enabled: BOT_VAULT_TRADING_RECONCILIATION_ENABLED,
      running,
      pollMs: POLL_MS,
      batchLimit: BATCH_LIMIT,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastScanned,
      lastProcessed,
      lastFailed,
      lastNewOrders,
      lastNewFills,
      lastNewFundingEvents,
      totalCycles,
      totalProcessedVaults,
      totalNewOrders,
      totalNewFills,
      totalNewFundingEvents,
      totalFailedCycles,
      consecutiveFailedCycles,
      totalLagAlerts
    };
  }

  return {
    runCycle,
    start,
    stop,
    getStatus
  };
}
