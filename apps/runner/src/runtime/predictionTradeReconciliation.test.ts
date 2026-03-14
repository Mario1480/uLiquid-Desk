import assert from "node:assert/strict";
import test from "node:test";
import {
  recordTradeEntryHistoryResult,
  recordTradeExitHistoryResult,
  reconcileExternalCloseWithTradeHistory,
  recordPredictionCopierEntryHistory,
  recordPredictionCopierExitHistory,
  reconcilePredictionCopierExternalClose
} from "./predictionTradeReconciliation.js";

test("reconcilePredictionCopierExternalClose returns normalized reconciled result", async () => {
  const events: Array<{ type: string; message: string; meta: Record<string, unknown> }> = [];
  const result = await reconcilePredictionCopierExternalClose({
    botId: "bot_1",
    symbol: "btcusdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    markPrice: 67500,
    tradeState: {
      botId: "bot_1",
      symbol: "BTCUSDT",
      lastPredictionHash: null,
      lastSignal: null,
      lastSignalTs: null,
      lastTradeTs: null,
      dailyTradeCount: 1,
      dailyResetUtc: new Date("2026-03-13T00:00:00.000Z"),
      openSide: "long",
      openQty: 0.1,
      openEntryPrice: 67000,
      openTs: new Date("2026-03-13T09:00:00.000Z")
    },
    inferredClose: {
      outcome: "tp_hit",
      reason: "tp_hit_external"
    },
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 1 }),
      createBotTradeHistoryEntry: async () => {
        throw new Error("not_used");
      },
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async (payload) => {
        events.push({
          type: payload.type,
          message: payload.message,
          meta: payload.meta as Record<string, unknown>
        });
      }
    }
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.outcome, "reconciled");
  assert.equal(result.closedCount, 1);
  assert.equal(events[0]?.message, "external_close_reconciled");
});

test("recordPredictionCopierExitHistory returns orphan result when nothing closes", async () => {
  const events: Array<{ message: string; meta: Record<string, unknown> }> = [];
  const result = await recordPredictionCopierExitHistory({
    botId: "bot_1",
    symbol: "ethusdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    exitPrice: 2100,
    outcome: "signal_exit",
    reason: "signal_flip",
    orderId: "ord_1",
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => {
        throw new Error("not_used");
      },
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async (payload) => {
        events.push({
          message: payload.message,
          meta: payload.meta as Record<string, unknown>
        });
      }
    }
  });

  assert.equal(result.reconciled, false);
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "orphan_exit");
  assert.equal(events[0]?.message, "orphan_exit");
});

test("recordPredictionCopierEntryHistory returns normalized success result", async () => {
  const result = await recordPredictionCopierEntryHistory({
    botId: "bot_1",
    userId: "user_1",
    exchangeAccountId: "acc_1",
    symbol: "btcusdt",
    side: "long",
    now: new Date("2026-03-13T10:00:00.000Z"),
    markPrice: 67500,
    qty: 0.01,
    prediction: null,
    predictionHash: null,
    normalizePredictionSignal: () => "neutral",
    confidenceToPct: () => 0,
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "history_entry_recorded");
});

test("generic reconciliation helpers preserve the normalized contract", async () => {
  const close = await reconcileExternalCloseWithTradeHistory({
    botId: "bot_1",
    symbol: "btcusdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    markPrice: 67500,
    tradeState: {
      botId: "bot_1",
      symbol: "BTCUSDT",
      lastPredictionHash: null,
      lastSignal: null,
      lastSignalTs: null,
      lastTradeTs: null,
      dailyTradeCount: 1,
      dailyResetUtc: new Date("2026-03-13T00:00:00.000Z"),
      openSide: "long",
      openQty: 0.1,
      openEntryPrice: 67000,
      openTs: new Date("2026-03-13T09:00:00.000Z")
    },
    inferredClose: {
      outcome: "tp_hit",
      reason: "tp_hit_external"
    },
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 1 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });
  const exit = await recordTradeExitHistoryResult({
    botId: "bot_1",
    symbol: "ethusdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    exitPrice: 2100,
    outcome: "signal_exit",
    reason: "signal_flip",
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 1 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });
  const entry = await recordTradeEntryHistoryResult({
    botId: "bot_1",
    userId: "user_1",
    exchangeAccountId: "acc_1",
    symbol: "btcusdt",
    side: "long",
    now: new Date("2026-03-13T10:00:00.000Z"),
    markPrice: 67500,
    qty: 0.01,
    prediction: null,
    predictionHash: null,
    normalizePredictionSignal: () => "neutral",
    confidenceToPct: () => 0,
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });

  assert.equal(close.outcome, "reconciled");
  assert.equal(exit.outcome, "reconciled");
  assert.equal(entry.outcome, "reconciled");
});
