import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGridExecutionMeta,
  buildPredictionCopierTradeMeta,
  createNormalizedCloseOutcome,
  createNormalizedExecutionResult,
  createNormalizedReconciliationResult
} from "./executionEvents.js";

test("builds normalized prediction copier trade metadata", () => {
  assert.deepEqual(
    buildPredictionCopierTradeMeta({
      stage: "enter",
      symbol: "btc/usdt",
      reason: "signal_flip",
      extra: {
        orderId: "ord_1"
      }
    }),
    {
      domain: "prediction_copier",
      stage: "enter",
      symbol: "BTCUSDT",
      reason: "signal_flip",
      orderId: "ord_1"
    }
  );
});

test("builds normalized grid execution metadata with error messages", () => {
  const meta = buildGridExecutionMeta({
    stage: "plan_blocked_risk_gate",
    symbol: "eth-usdt",
    instanceId: "grid_1",
    reason: "liq_distance",
    error: new Error("planner unavailable"),
    extra: {
      droppedIntents: 3
    }
  });

  assert.deepEqual(meta, {
    domain: "grid",
    stage: "plan_blocked_risk_gate",
    symbol: "ETHUSDT",
    instanceId: "grid_1",
    reason: "liq_distance",
    error: "planner unavailable",
    droppedIntents: 3
  });
});

test("creates normalized execution and reconciliation payloads", () => {
  assert.deepEqual(
    createNormalizedExecutionResult({
      status: "executed",
      reason: "order_placed",
      orderId: "ord_1",
      metadata: { venue: "paper" }
    }),
    {
      status: "executed",
      reason: "order_placed",
      orderId: "ord_1",
      metadata: { venue: "paper" }
    }
  );

  assert.deepEqual(
    createNormalizedReconciliationResult({
      reconciled: true,
      reason: "external_close_reconciled",
      closedCount: 1,
      metadata: { outcome: "tp_hit" }
    }),
    {
      reconciled: true,
      outcome: "reconciled",
      reason: "external_close_reconciled",
      closedCount: 1,
      metadata: { outcome: "tp_hit" }
    }
  );

  assert.deepEqual(
    createNormalizedCloseOutcome({
      closed: false,
      reason: null,
      source: "venue"
    }),
    {
      closed: false,
      outcome: "not_closed",
      reason: null,
      source: "venue",
      orderId: null,
      closedQty: null,
      metadata: {}
    }
  );
});
