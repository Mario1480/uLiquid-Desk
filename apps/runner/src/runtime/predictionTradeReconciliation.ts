import type {
  BotTradeHistoryCloseOutcome,
  BotTradeState,
  PredictionGateState,
  RiskEventType
} from "../db.js";
import {
  closeOpenBotTradeHistoryEntries,
  createBotTradeHistoryEntry,
  upsertBotTradeState,
  writeRiskEvent
} from "../db.js";
import {
  buildPredictionCopierTradeMeta,
  createNormalizedReconciliationResult,
  type NormalizedReconciliationResult
} from "./executionEvents.js";

type PredictionCopierSide = "long" | "short";
type PredictionCopierSignal = "up" | "down" | "neutral";

type PredictionTradeDeps = {
  closeOpenBotTradeHistoryEntries: typeof closeOpenBotTradeHistoryEntries;
  createBotTradeHistoryEntry: typeof createBotTradeHistoryEntry;
  upsertBotTradeState: typeof upsertBotTradeState;
  writeRiskEvent: typeof writeRiskEvent;
};

const defaultDeps: PredictionTradeDeps = {
  closeOpenBotTradeHistoryEntries,
  createBotTradeHistoryEntry,
  upsertBotTradeState,
  writeRiskEvent
};

type TradeMetaBuilder = (params: {
  stage: string;
  symbol: string;
  reason?: string | null;
  error?: unknown;
  extra?: Record<string, unknown> | null;
}) => Record<string, unknown>;

type TradeReconciliationRuntime = {
  riskEventType: RiskEventType;
  buildMeta: TradeMetaBuilder;
};

function resolveTradeReconciliationRuntime(params: {
  riskEventType?: RiskEventType;
  buildMeta?: TradeMetaBuilder;
}): TradeReconciliationRuntime {
  return {
    riskEventType: params.riskEventType ?? "PREDICTION_COPIER_TRADE",
    buildMeta: params.buildMeta ?? buildPredictionCopierTradeMeta
  };
}

async function reconcileExternalCloseWithHistory(params: {
  botId: string;
  riskEventType: RiskEventType;
  symbol: string;
  now: Date;
  markPrice: number | null;
  tradeState: BotTradeState;
  inferredClose: {
    outcome: BotTradeHistoryCloseOutcome;
    reason: string;
  };
  buildMeta: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const deps = params.deps ?? defaultDeps;
  const closedHistory = await deps.closeOpenBotTradeHistoryEntries({
    botId: params.botId,
    symbol: params.symbol,
    exitTs: params.now,
    exitPrice: params.markPrice,
    outcome: params.inferredClose.outcome,
    exitReason: params.inferredClose.reason
  });

  if (closedHistory.closedCount <= 0) {
    return createNormalizedReconciliationResult({
      reconciled: false,
      closedCount: 0
    });
  }

  await deps.upsertBotTradeState({
    botId: params.botId,
    symbol: params.symbol,
    dailyResetUtc: params.tradeState.dailyResetUtc,
    dailyTradeCount: params.tradeState.dailyTradeCount,
    lastTradeTs: params.now,
    openSide: null,
    openQty: null,
    openEntryPrice: null,
    openTs: null
  });

  await deps.writeRiskEvent({
    botId: params.botId,
    type: params.riskEventType,
    message: "external_close_reconciled",
    meta: params.buildMeta({
      stage: "external_close_reconciled",
      symbol: params.symbol,
      reason: params.inferredClose.reason,
      extra: {
        closedCount: closedHistory.closedCount,
        outcome: params.inferredClose.outcome,
        exitPrice: Number.isFinite(Number(params.markPrice)) ? Number(params.markPrice) : null
      }
    })
  });

  return createNormalizedReconciliationResult({
    reconciled: true,
    reason: params.inferredClose.reason,
    closedCount: closedHistory.closedCount,
    metadata: {
      outcome: params.inferredClose.outcome,
      exitPrice: Number.isFinite(Number(params.markPrice)) ? Number(params.markPrice) : null
    }
  });
}

async function recordTradeExitHistoryImpl(params: {
  botId: string;
  riskEventType: RiskEventType;
  symbol: string;
  now: Date;
  exitPrice: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  reason: string;
  orderId?: string | null;
  emitOrphanEvent?: boolean;
  buildMeta: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const deps = params.deps ?? defaultDeps;
  try {
    const closedHistory = await deps.closeOpenBotTradeHistoryEntries({
      botId: params.botId,
      symbol: params.symbol,
      exitTs: params.now,
      exitPrice: params.exitPrice,
      outcome: params.outcome,
      exitReason: params.reason,
      exitOrderId: params.orderId ?? null
    });
    if (closedHistory.closedCount === 0) {
      if (params.emitOrphanEvent === false) {
        return createNormalizedReconciliationResult({
          reconciled: false,
          closedCount: 0
        });
      }
      await deps.writeRiskEvent({
        botId: params.botId,
        type: params.riskEventType,
        message: "orphan_exit",
        meta: params.buildMeta({
          stage: "orphan_exit",
          symbol: params.symbol,
          reason: params.reason,
          extra: {
            orderId: params.orderId ?? null
          }
        })
      });
      return createNormalizedReconciliationResult({
        reconciled: false,
        closedCount: 0,
        reason: "orphan_exit",
        metadata: {
          orderId: params.orderId ?? null
        }
      });
    }
    return createNormalizedReconciliationResult({
      reconciled: true,
      closedCount: closedHistory.closedCount,
      reason: params.reason,
      metadata: {
        orderId: params.orderId ?? null,
        outcome: params.outcome
      }
    });
  } catch (error) {
    await deps.writeRiskEvent({
      botId: params.botId,
      type: params.riskEventType,
      message: "history_close_failed",
      meta: params.buildMeta({
        stage: "history_close_failed",
        symbol: params.symbol,
        reason: params.reason,
        error,
        extra: {
          orderId: params.orderId ?? null
        }
      })
    });
    return createNormalizedReconciliationResult({
      reconciled: false,
      closedCount: 0,
      reason: params.reason,
      metadata: {
        orderId: params.orderId ?? null,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

async function recordTradeEntryHistoryImpl(params: {
  botId: string;
  riskEventType: RiskEventType;
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  side: PredictionCopierSide;
  now: Date;
  markPrice: number;
  qty: number;
  tpPrice?: number | null;
  slPrice?: number | null;
  orderId?: string | null;
  prediction: PredictionGateState | null;
  predictionHash: string | null;
  normalizePredictionSignal(signal: string): PredictionCopierSignal;
  confidenceToPct(confidence: number): number;
  buildMeta: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const deps = params.deps ?? defaultDeps;
  try {
    await deps.createBotTradeHistoryEntry({
      botId: params.botId,
      userId: params.userId,
      exchangeAccountId: params.exchangeAccountId,
      symbol: params.symbol,
      marketType: "perp",
      side: params.side,
      entryTs: params.now,
      entryPrice: params.markPrice,
      entryQty: params.qty,
      entryNotionalUsd: Number((params.qty * params.markPrice).toFixed(8)),
      tpPrice: params.tpPrice ?? null,
      slPrice: params.slPrice ?? null,
      entryOrderId: params.orderId ?? null,
      predictionStateId: params.prediction?.id ?? null,
      predictionHash: params.predictionHash,
      predictionSignal: params.prediction
        ? params.normalizePredictionSignal(params.prediction.signal)
        : null,
      predictionConfidence: params.prediction
        ? params.confidenceToPct(params.prediction.confidence)
        : null,
      predictionTags: params.prediction?.tags ?? []
    });
    return createNormalizedReconciliationResult({
      reconciled: true,
      closedCount: 0,
      reason: "history_entry_recorded",
      metadata: {
        side: params.side,
        orderId: params.orderId ?? null
      }
    });
  } catch (error) {
    await deps.writeRiskEvent({
      botId: params.botId,
      type: params.riskEventType,
      message: "history_entry_failed",
      meta: params.buildMeta({
        stage: "history_entry_failed",
        symbol: params.symbol,
        error,
        extra: {
          side: params.side,
          orderId: params.orderId ?? null
        }
      })
    });
    return createNormalizedReconciliationResult({
      reconciled: false,
      closedCount: 0,
      reason: "history_entry_failed",
      metadata: {
        side: params.side,
        orderId: params.orderId ?? null,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

export async function reconcileExternalClose(params: {
  botId: string;
  symbol: string;
  now: Date;
  markPrice: number | null;
  tradeState: BotTradeState;
  inferredClose: {
    outcome: BotTradeHistoryCloseOutcome;
    reason: string;
  };
  riskEventType?: RiskEventType;
  buildMeta?: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const runtime = resolveTradeReconciliationRuntime(params);
  return reconcileExternalCloseWithHistory({
    ...params,
    riskEventType: runtime.riskEventType,
    buildMeta: runtime.buildMeta
  });
}

export async function recordTradeExitHistory(params: {
  botId: string;
  symbol: string;
  now: Date;
  exitPrice: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  reason: string;
  orderId?: string | null;
  emitOrphanEvent?: boolean;
  riskEventType?: RiskEventType;
  buildMeta?: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const runtime = resolveTradeReconciliationRuntime(params);
  return recordTradeExitHistoryImpl({
    ...params,
    riskEventType: runtime.riskEventType,
    buildMeta: runtime.buildMeta
  });
}

export async function recordTradeEntryHistory(params: {
  botId: string;
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  side: PredictionCopierSide;
  now: Date;
  markPrice: number;
  qty: number;
  tpPrice?: number | null;
  slPrice?: number | null;
  orderId?: string | null;
  prediction: PredictionGateState | null;
  predictionHash: string | null;
  normalizePredictionSignal(signal: string): PredictionCopierSignal;
  confidenceToPct(confidence: number): number;
  riskEventType?: RiskEventType;
  buildMeta?: TradeMetaBuilder;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  const runtime = resolveTradeReconciliationRuntime(params);
  return recordTradeEntryHistoryImpl({
    ...params,
    riskEventType: runtime.riskEventType,
    buildMeta: runtime.buildMeta
  });
}

export async function reconcilePredictionCopierExternalClose(params: {
  botId: string;
  symbol: string;
  now: Date;
  markPrice: number | null;
  tradeState: BotTradeState;
  inferredClose: {
    outcome: BotTradeHistoryCloseOutcome;
    reason: string;
  };
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  return reconcileExternalClose(params);
}

export async function recordPredictionCopierExitHistory(params: {
  botId: string;
  symbol: string;
  now: Date;
  exitPrice: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  reason: string;
  orderId?: string | null;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  return recordTradeExitHistory(params);
}

export async function recordPredictionCopierEntryHistory(params: {
  botId: string;
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  side: PredictionCopierSide;
  now: Date;
  markPrice: number;
  qty: number;
  tpPrice?: number | null;
  slPrice?: number | null;
  orderId?: string | null;
  prediction: PredictionGateState | null;
  predictionHash: string | null;
  normalizePredictionSignal(signal: string): PredictionCopierSignal;
  confidenceToPct(confidence: number): number;
  deps?: PredictionTradeDeps;
}): Promise<NormalizedReconciliationResult> {
  return recordTradeEntryHistory(params);
}
