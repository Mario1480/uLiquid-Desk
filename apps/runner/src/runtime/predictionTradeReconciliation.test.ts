import assert from "node:assert/strict";
import test from "node:test";
import {
  recordTradeEntryHistory,
  recordTradeExitHistory,
  reconcileExternalClose,
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

test("recordTradeEntryHistory treats duplicate entry recording as idempotent success", async () => {
  const result = await recordTradeEntryHistory({
    botId: "bot_1",
    userId: "user_1",
    exchangeAccountId: "acc_1",
    symbol: "btcusdt",
    side: "long",
    now: new Date("2026-03-19T10:00:00.000Z"),
    markPrice: 67500,
    qty: 0.01,
    orderId: "ord_duplicate",
    prediction: null,
    predictionHash: null,
    normalizePredictionSignal: () => "neutral",
    confidenceToPct: () => 0,
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => {
        throw new Error("duplicate_trade_history_entry");
      },
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "history_entry_already_recorded");
});

test("stale reconciliation catch-up closes orphaned open history after a restart", async () => {
  const result = await reconcileExternalClose({
    botId: "bot_restart",
    symbol: "solusdt",
    now: new Date("2026-03-19T10:00:00.000Z"),
    markPrice: 155,
    tradeState: {
      botId: "bot_restart",
      symbol: "SOLUSDT",
      lastPredictionHash: null,
      lastSignal: null,
      lastSignalTs: null,
      lastTradeTs: null,
      dailyTradeCount: 1,
      dailyResetUtc: new Date("2026-03-19T00:00:00.000Z"),
      openSide: "long",
      openQty: 4,
      openEntryPrice: 150,
      openTs: new Date("2026-03-19T09:00:00.000Z")
    },
    inferredClose: {
      outcome: "tp_hit",
      reason: "restart_stale_reconciliation"
    },
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 1 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async () => undefined
    }
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "restart_stale_reconciliation");
});

test("generic reconciliation helpers preserve the normalized contract", async () => {
  const close = await reconcileExternalClose({
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
  const exit = await recordTradeExitHistory({
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
  const entry = await recordTradeEntryHistory({
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

test("generic reconciliation helpers accept custom runtime metadata for non-prediction domains", async () => {
  const events: Array<{ type: string; meta: Record<string, unknown> }> = [];
  await recordTradeExitHistory({
    botId: "grid_bot_1",
    symbol: "solusdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    exitPrice: 155,
    outcome: "manual_exit",
    reason: "grid_termination",
    riskEventType: "GRID_TERMINATED",
    buildMeta: ({ stage, symbol, reason }) => ({
      domain: "grid",
      stage,
      symbol,
      reason,
      instanceId: "instance_1"
    }),
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async (payload) => {
        events.push({
          type: payload.type,
          meta: payload.meta as Record<string, unknown>
        });
      }
    }
  });

  assert.equal(events[0]?.type, "GRID_TERMINATED");
  assert.equal(events[0]?.meta.domain, "grid");
  assert.equal(events[0]?.meta.instanceId, "instance_1");
});

test("recordTradeExitHistory can suppress orphan events for grid-style best-effort close sync", async () => {
  const events: Array<{ message: string }> = [];
  const result = await recordTradeExitHistory({
    botId: "grid_bot_2",
    symbol: "adausdt",
    now: new Date("2026-03-13T10:00:00.000Z"),
    exitPrice: 0.75,
    outcome: "manual_exit",
    reason: "grid_terminated",
    emitOrphanEvent: false,
    riskEventType: "GRID_TERMINATED",
    buildMeta: ({ stage }) => ({ domain: "grid", stage, instanceId: "instance_2" }),
    deps: {
      closeOpenBotTradeHistoryEntries: async () => ({ closedCount: 0 }),
      createBotTradeHistoryEntry: async () => undefined,
      upsertBotTradeState: async () => undefined,
      writeRiskEvent: async (payload) => {
        events.push({ message: payload.message });
      }
    }
  });

  assert.equal(result.outcome, "noop");
  assert.equal(events.length, 0);
});
