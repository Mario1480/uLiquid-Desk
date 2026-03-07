import { FuturesEngine } from "@mm/futures-engine";
import type { ActiveFuturesBot } from "../db.js";
import { log } from "../logger.js";
import { readExecutionSettings } from "../execution/config.js";
import { createDcaExecutionMode } from "../execution/dcaExecutionMode.js";
import { createDipReversionExecutionMode } from "../execution/dipReversionExecutionMode.js";
import { createGridExecutionMode } from "../execution/gridExecutionMode.js";
import { createSimpleExecutionMode } from "../execution/simpleExecutionMode.js";
import type { ExecutionMode } from "../execution/types.js";
import { createLegacyDummySignalEngine } from "../signal/legacyDummySignalEngine.js";
import type { SignalEngine } from "../signal/types.js";
import { BacktestClock } from "./clock.js";
import { BacktestMarketDataReplay } from "./marketDataReplay.js";
import { buildBacktestKpi } from "./report.js";
import { SimulatedBacktestExchangeAdapter } from "./simulatedExchangeAdapter.js";
import {
  loadBacktestBot,
  loadBacktestRunRecord,
  loadBacktestSnapshotCandles,
  saveBacktestReport,
  tryClaimBacktestRun,
  updateBacktestRunRecord
} from "./store.js";
import type { BacktestReportV1, BacktestRunRecordV1 } from "./types.js";

const BACKTEST_WORKER_PREFIX = "backtest";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = asRecord(next[key]) ?? {};
      next[key] = deepMerge(existing, value as Record<string, unknown>);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function buildBacktestBot(base: ActiveFuturesBot, run: BacktestRunRecordV1): ActiveFuturesBot {
  const override = asRecord(run.paramsOverride) ?? {};
  const mergedParams = deepMerge(base.paramsJson ?? {}, override);
  return {
    ...base,
    id: `backtest:${run.runId}:${base.id}`,
    paramsJson: mergedParams
  };
}

function resolveSignalEngine(bot: ActiveFuturesBot): SignalEngine {
  if (bot.strategyKey === "prediction_copier") {
    throw new Error("backtest_prediction_copier_not_supported_yet");
  }
  return createLegacyDummySignalEngine({
    writeRiskEventFn: async () => undefined
  });
}

function resolveExecutionMode(bot: ActiveFuturesBot, engine: FuturesEngine): ExecutionMode {
  if (bot.strategyKey === "prediction_copier") {
    throw new Error("backtest_prediction_copier_not_supported_yet");
  }

  const simple = createSimpleExecutionMode({
    engine,
    key: "simple_backtest",
    writeRiskEventFn: async () => undefined
  });
  const settings = readExecutionSettings(bot);
  if (settings.mode === "dca") return createDcaExecutionMode({ simpleMode: simple });
  if (settings.mode === "grid") return createGridExecutionMode({ simpleMode: simple });
  if (settings.mode === "dip_reversion") return createDipReversionExecutionMode({ simpleMode: simple });
  return simple;
}

async function executeClaimedRun(run: BacktestRunRecordV1, workerId: string): Promise<void> {
  const bot = await loadBacktestBot(run);
  if (!bot) {
    await updateBacktestRunRecord(run.runId, {
      status: "failed",
      error: "bot_not_found_for_backtest",
      finishedAt: new Date().toISOString()
    });
    return;
  }

  const btBot = buildBacktestBot(bot, run);
  const candles = await loadBacktestSnapshotCandles(run.fingerprints.dataHash);
  if (!candles || candles.length < 2) {
    await updateBacktestRunRecord(run.runId, {
      status: "failed",
      error: "backtest_snapshot_missing_or_too_short",
      finishedAt: new Date().toISOString()
    });
    return;
  }

  const replay = new BacktestMarketDataReplay(candles);
  const first = candles[0];
  const assumptions = run.assumptions;
  const adapter = new SimulatedBacktestExchangeAdapter({
    symbol: btBot.symbol,
    initialMarkPrice: first.close,
    feeBps: assumptions.feeBps,
    slippageBps: assumptions.slippageBps
  });

  const engine = new FuturesEngine(adapter as any, {
    isTradingEnabled: () => true
  });
  const signalEngine = resolveSignalEngine(btBot);
  const executionMode = resolveExecutionMode(btBot, engine);

  const clock = new BacktestClock(first.ts);
  const trades: BacktestReportV1["trades"] = [];
  const equityCurve: BacktestReportV1["equityCurve"] = [];
  const diagnostics: BacktestReportV1["diagnostics"] = {
    guardBlocks: {},
    executionDecisions: {},
    warnings: []
  };

  let iteration = 0;
  for (const frame of replay.frames()) {
    iteration += 1;
    if (iteration % 50 === 0) {
      const latest = await loadBacktestRunRecord(run.runId);
      if (!latest) break;
      if (latest.cancelRequested) {
        await updateBacktestRunRecord(run.runId, {
          status: "cancelled",
          error: null,
          finishedAt: new Date().toISOString()
        });
        return;
      }
    }

    clock.setTs(frame.now.ts);
    const now = clock.now();
    const signal = await signalEngine.decide({
      bot: btBot,
      now,
      workerId: `${BACKTEST_WORKER_PREFIX}:${workerId}`
    });

    adapter.setFillContext({
      markPrice: frame.now.close,
      fillPrice: frame.next.open,
      ts: frame.next.ts,
      reason: signal.reason
    });

    const execution = await executionMode.execute(signal, {
      bot: btBot,
      now,
      workerId: `${BACKTEST_WORKER_PREFIX}:${workerId}`
    });

    diagnostics.executionDecisions[execution.status] = (diagnostics.executionDecisions[execution.status] ?? 0) + 1;
    if (execution.status === "blocked") {
      const reason = String(execution.reason ?? "blocked");
      diagnostics.guardBlocks[reason] = (diagnostics.guardBlocks[reason] ?? 0) + 1;
    }

    trades.push(...adapter.drainClosedTrades());
    const account = await adapter.getAccountState();
    equityCurve.push({
      ts: frame.now.ts,
      equityUsd: Number(Number(account.equity ?? 0).toFixed(8))
    });
  }

  const last = replay.lastCandle();
  if (last) {
    adapter.setFillContext({
      markPrice: last.close,
      fillPrice: last.close,
      ts: last.ts,
      reason: "backtest_last_mark"
    });
    const account = await adapter.getAccountState();
    equityCurve.push({
      ts: last.ts,
      equityUsd: Number(Number(account.equity ?? 0).toFixed(8))
    });
    trades.push(...adapter.drainClosedTrades());
  }

  const initialEquity = 10_000;
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equityUsd : initialEquity;
  const kpi = buildBacktestKpi({
    initialEquityUsd: initialEquity,
    finalEquityUsd: finalEquity,
    trades,
    equityCurve
  });

  const finishedAt = new Date().toISOString();
  const report: BacktestReportV1 = {
    runId: run.runId,
    botId: run.botId,
    userId: run.userId,
    status: "completed",
    period: run.period,
    market: run.market,
    fingerprints: run.fingerprints,
    assumptions: run.assumptions,
    kpi,
    equityCurve,
    trades,
    diagnostics,
    createdAt: run.requestedAt,
    finishedAt
  };

  const chunkCount = await saveBacktestReport(report);
  await updateBacktestRunRecord(run.runId, {
    status: "completed",
    finishedAt,
    error: null,
    reportChunkCount: chunkCount,
    reportVersion: 1,
    kpi
  });
}

export async function executeBacktestRun(runId: string, workerId: string): Promise<void> {
  const claimed = await tryClaimBacktestRun(runId);
  if (!claimed) return;

  try {
    await executeClaimedRun(claimed, workerId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn({ runId, err: reason }, "backtest run failed");
    await updateBacktestRunRecord(runId, {
      status: "failed",
      error: reason,
      finishedAt: new Date().toISOString()
    });
  }
}

