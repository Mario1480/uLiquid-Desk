import { logger } from "../logger.js";
import { createVaultService, type RuntimeGuardrailEnforcementSummary, type VaultService } from "../vaults/service.js";

const BOT_VAULT_RISK_GUARD_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.BOT_VAULT_RISK_GUARD_ENABLED ?? "1").trim().toLowerCase()
);
const BOT_VAULT_RISK_GUARD_POLL_MS =
  Math.max(5, Number(process.env.BOT_VAULT_RISK_GUARD_INTERVAL_SECONDS ?? "15")) * 1000;
const BOT_VAULT_RISK_GUARD_BATCH_LIMIT = Math.max(
  1,
  Math.min(500, Math.trunc(Number(process.env.BOT_VAULT_RISK_GUARD_BATCH_LIMIT ?? "100")))
);

export type BotVaultRiskJobStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  batchLimit: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSummary: RuntimeGuardrailEnforcementSummary;
  totalCycles: number;
  totalBreaches: number;
  totalAutoPauses: number;
  totalFailedCycles: number;
};

export function createBotVaultRiskJob(db: any, vaultService?: VaultService) {
  const service = vaultService ?? createVaultService(db);

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastSummary: RuntimeGuardrailEnforcementSummary = {
    scanned: 0,
    breached: 0,
    paused: 0,
    failed: 0
  };
  let totalCycles = 0;
  let totalBreaches = 0;
  let totalAutoPauses = 0;
  let totalFailedCycles = 0;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (!BOT_VAULT_RISK_GUARD_ENABLED) return;
    if (running) return;
    running = true;
    totalCycles += 1;
    lastStartedAt = new Date();

    try {
      const summary = await service.enforceRuntimeGuardrailsForActiveVaults({
        limit: BOT_VAULT_RISK_GUARD_BATCH_LIMIT
      });
      lastSummary = summary;
      totalBreaches += Number(summary.breached ?? 0);
      totalAutoPauses += Number(summary.paused ?? 0);
      lastError = null;
      lastErrorAt = null;

      if (summary.breached > 0 || summary.failed > 0) {
        logger.info("bot_vault_risk_guard_cycle", {
          reason,
          scanned: summary.scanned,
          breached: summary.breached,
          paused: summary.paused,
          failed: summary.failed
        });
      }
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      totalFailedCycles += 1;
      logger.warn("bot_vault_risk_guard_failed", {
        reason,
        error: lastError
      });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!BOT_VAULT_RISK_GUARD_ENABLED) return;
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled");
    }, BOT_VAULT_RISK_GUARD_POLL_MS);
    void runCycle("startup");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): BotVaultRiskJobStatus {
    return {
      enabled: BOT_VAULT_RISK_GUARD_ENABLED,
      running,
      pollMs: BOT_VAULT_RISK_GUARD_POLL_MS,
      batchLimit: BOT_VAULT_RISK_GUARD_BATCH_LIMIT,
      lastStartedAt: lastStartedAt ? lastStartedAt.toISOString() : null,
      lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
      lastError,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      lastSummary,
      totalCycles,
      totalBreaches,
      totalAutoPauses,
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
