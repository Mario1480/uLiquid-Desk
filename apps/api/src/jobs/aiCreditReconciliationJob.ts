import { releaseExpiredAiReservations } from "../ai/credits/creditService.js";
import { logger } from "../logger.js";

const DEFAULT_INTERVAL_MS = 60_000;

export function createAiCreditReconciliationJob(database: any, options: { intervalMs?: number; take?: number } = {}) {
  const configuredInterval = options.intervalMs ?? Number(process.env.AI_CREDIT_RECONCILIATION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const intervalMs = Math.max(10_000, Number.isFinite(configuredInterval) ? configuredInterval : DEFAULT_INTERVAL_MS);
  const take = Math.min(1_000, Math.max(1, options.take ?? 100));
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runCycle(reason: "startup" | "scheduled" | "manual" = "scheduled") {
    if (running) return { skipped: "already_running" as const };
    running = true;
    try {
      const released = await releaseExpiredAiReservations(database, new Date(), take);
      logger.info("ai_credit_reconciliation_cycle", { reason, released });
      return { released };
    } catch (error) {
      logger.warn("ai_credit_reconciliation_cycle_failed", {
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void runCycle("scheduled").catch(() => undefined);
    }, intervalMs);
    timer.unref?.();
    void runCycle("startup").catch(() => undefined);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runCycle, start, stop };
}
