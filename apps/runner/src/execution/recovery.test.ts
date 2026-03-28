import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeExecutionRetry,
  createPendingGridExecution,
  listPendingGridExecutions,
  mergeGridExecutionRecoveryState,
  recordGridFillSyncRecoveryState,
  reconcileGridOpenOrdersAgainstVenue,
  recoverGridPendingExecutions,
  upsertPendingGridExecution
} from "./recovery.js";

test("categorizeExecutionRetry distinguishes safe, unsafe, and manual categories", () => {
  assert.deepEqual(
    categorizeExecutionRetry({
      executionExchange: "paper",
      error: new Error("request timeout")
    }),
    {
      category: "safe_retry",
      reasonCode: "transport_retryable"
    }
  );

  assert.deepEqual(
    categorizeExecutionRetry({
      executionExchange: "hyperliquid",
      error: new Error("fetch failed")
    }),
    {
      category: "unsafe_retry",
      reasonCode: "acceptance_unknown"
    }
  );

  assert.deepEqual(
    categorizeExecutionRetry({
      executionExchange: "hyperliquid",
      error: new Error("invalid size")
    }),
    {
      category: "manual_intervention_required",
      reasonCode: "retry_not_safe"
    }
  );
});

test("recoverGridPendingExecutions prevents duplicate submission by adopting an existing venue order", async () => {
  const created: Array<{ clientOrderId: string; exchangeOrderId: string | null | undefined }> = [];
  const stateJson = upsertPendingGridExecution({}, createPendingGridExecution({
    clientOrderId: "grid-cid-1",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    qty: 0.01,
    price: 67000,
    gridLeg: "long",
    gridIndex: 1,
    intentType: "entry",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T10:00:00.000Z")
  }));

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_1",
    botId: "bot_1",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_1",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T10:00:15.000Z"),
    stateJson,
    openOrders: [],
    adapter: {
      listOpenOrders: async () => [{ orderId: "venue-ord-1", raw: { clientOid: "grid-cid-1" } }]
    },
    deps: {
      createOrderMapEntry: async (input) => {
        created.push({
          clientOrderId: input.clientOrderId,
          exchangeOrderId: input.exchangeOrderId
        });
      },
      listGridOpenOrders: async () => [{ clientOrderId: "grid-cid-1", exchangeOrderId: "venue-ord-1" }]
    }
  });

  assert.equal(result.blockedReason, null);
  assert.equal(result.summary.recoveredCount, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.clientOrderId, "grid-cid-1");
  assert.equal(created[0]?.exchangeOrderId, "venue-ord-1");
  assert.equal(listPendingGridExecutions(result.stateJson).length, 0);
});

test("mergeGridExecutionRecoveryState preserves non-recovery planner flags", () => {
  const currentStateJson = upsertPendingGridExecution({
    initialSeedExecuted: true,
    initialSeedNeedsReseed: false,
    initialSeedAt: "2026-03-28T09:34:16.000Z"
  }, createPendingGridExecution({
    clientOrderId: "grid-cid-seed-1",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    qty: 0.01,
    price: 67000,
    gridLeg: "long",
    gridIndex: 1,
    intentType: "entry",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-28T09:34:16.000Z")
  }));

  const merged = mergeGridExecutionRecoveryState({
    windowCenterIndex: 6,
    lastPlanIntents: 0
  }, currentStateJson);

  assert.equal(merged.initialSeedExecuted, true);
  assert.equal(merged.initialSeedNeedsReseed, false);
  assert.equal(merged.initialSeedAt, "2026-03-28T09:34:16.000Z");
  assert.equal(merged.windowCenterIndex, 6);
  assert.equal(merged.lastPlanIntents, 0);
  assert.equal(listPendingGridExecutions(merged).length, 1);
});

test("recoverGridPendingExecutions safely retries paper limit orders after a restart", async () => {
  const created: Array<{ clientOrderId: string; exchangeOrderId: string | null | undefined }> = [];
  const stateJson = upsertPendingGridExecution({}, createPendingGridExecution({
    clientOrderId: "paper-cid-1",
    symbol: "ETHUSDT",
    side: "sell",
    orderType: "limit",
    qty: 0.5,
    price: 3500,
    reduceOnly: true,
    gridLeg: "short",
    gridIndex: 4,
    intentType: "tp",
    executionExchange: "paper",
    now: new Date("2026-03-19T10:00:00.000Z")
  }));

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_2",
    botId: "bot_2",
    botSymbol: "ETHUSDT",
    exchangeAccountId: "paper_acc",
    executionExchange: "paper",
    now: new Date("2026-03-19T10:00:10.000Z"),
    stateJson,
    openOrders: [],
    deps: {
      placePaperLimitOrder: async () => ({ orderId: "paper-order-1" }),
      createOrderMapEntry: async (input) => {
        created.push({
          clientOrderId: input.clientOrderId,
          exchangeOrderId: input.exchangeOrderId
        });
      },
      listGridOpenOrders: async () => [{ clientOrderId: "paper-cid-1", exchangeOrderId: "paper-order-1" }]
    }
  });

  assert.equal(result.blockedReason, null);
  assert.equal(result.summary.recoveredCount, 1);
  assert.equal(created[0]?.clientOrderId, "paper-cid-1");
  assert.equal(created[0]?.exchangeOrderId, "paper-order-1");
  assert.equal(listPendingGridExecutions(result.stateJson).length, 0);
});

test("recoverGridPendingExecutions escalates unresolved stale submissions to manual intervention", async () => {
  const staleState = upsertPendingGridExecution({}, {
    ...createPendingGridExecution({
      clientOrderId: "grid-cid-stale",
      symbol: "SOLUSDT",
      side: "buy",
      orderType: "limit",
      qty: 4,
      price: 150,
      gridLeg: "long",
      gridIndex: 2,
      intentType: "entry",
      executionExchange: "hyperliquid",
      now: new Date("2026-03-19T09:00:00.000Z")
    }),
    lastError: "adapter_place_order_failed:fetch failed"
  });

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_3",
    botId: "bot_3",
    botSymbol: "SOLUSDT",
    exchangeAccountId: "acc_3",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:05:30.000Z"),
    stateJson: staleState,
    openOrders: [],
    adapter: {
      listOpenOrders: async () => []
    },
    manualInterventionAfterMs: 60_000,
    deps: {
      createOrderMapEntry: async () => undefined,
      listGridOpenOrders: async () => []
    }
  });

  assert.equal(result.blockedReason, "grid_execution_manual_intervention_required");
  assert.equal(result.summary.manualInterventionCount, 1);
  const [pending] = listPendingGridExecutions(result.stateJson);
  assert.equal(pending?.status, "manual_intervention_required");
  assert.equal(pending?.retryCategory, "manual_intervention_required");
});

test("recoverGridPendingExecutions clears timed-out manual intervention once venue confirms nothing is open", async () => {
  const staleState = upsertPendingGridExecution({}, {
    ...createPendingGridExecution({
      clientOrderId: "grid-cid-timeout-clear",
      symbol: "BTCUSDT",
      side: "sell",
      orderType: "limit",
      qty: 0.01,
      price: 73000,
      reduceOnly: true,
      gridLeg: "long",
      gridIndex: 13,
      intentType: "rebalance",
      executionExchange: "hyperliquid",
      now: new Date("2026-03-19T09:00:00.000Z")
    }),
    status: "manual_intervention_required",
    retryCategory: "manual_intervention_required",
    lastError: "recovery_confirmation_timeout"
  });

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_4",
    botId: "bot_4",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_4",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:05:30.000Z"),
    stateJson: staleState,
    openOrders: [],
    adapter: {
      listOpenOrders: async () => []
    },
    manualInterventionAfterMs: 60_000,
    deps: {
      createOrderMapEntry: async () => undefined,
      listGridOpenOrders: async () => []
    }
  });

  assert.equal(result.blockedReason, null);
  assert.equal(result.summary.recoveredCount, 1);
  assert.equal(listPendingGridExecutions(result.stateJson).length, 0);
});

test("reconcileGridOpenOrdersAgainstVenue waits one cycle before canceling orphaned grid order state", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-2", exchangeOrderId: "venue-2" }],
    venueOrders: []
  });

  assert.equal(first.summary.missingVenueCount, 1);
  assert.equal(first.summary.orphanedCount, 0);

  const second = reconcileGridOpenOrdersAgainstVenue({
    stateJson: first.stateJson,
    now: new Date("2026-03-19T10:00:05.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-2", exchangeOrderId: "venue-2" }],
    venueOrders: []
  });

  assert.equal(second.summary.orphanedCount, 1);
  assert.deepEqual(second.staleOrders, [{ clientOrderId: "grid-cid-2", exchangeOrderId: "venue-2" }]);
});

test("reconcileGridOpenOrdersAgainstVenue resets missed counter when delayed venue order reappears", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-3", exchangeOrderId: "venue-3" }],
    venueOrders: []
  });

  const second = reconcileGridOpenOrdersAgainstVenue({
    stateJson: first.stateJson,
    now: new Date("2026-03-19T10:00:05.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-3", exchangeOrderId: "venue-3" }],
    venueOrders: [{ clientOrderId: "grid-cid-3", exchangeOrderId: "venue-3" }]
  });

  assert.equal(second.summary.matchedVenueCount, 1);
  assert.equal(second.summary.orphanedCount, 0);
});

test("reconcileGridOpenOrdersAgainstVenue keeps hypercore ladder orders when venue only exposes order fingerprint", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{
      clientOrderId: "grid-cid-core-1",
      exchangeOrderId: "cloid:0:208456784328589790982014142665896995042",
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }],
    venueOrders: [{
      exchangeOrderId: "98234123",
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }]
  });

  assert.equal(first.summary.matchedVenueCount, 1);
  assert.equal(first.summary.missingVenueCount, 0);
  assert.equal(first.summary.orphanedCount, 0);
});

test("recordGridFillSyncRecoveryState tracks failure and later recovery", () => {
  const failed = recordGridFillSyncRecoveryState({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    error: new Error("timeout")
  });
  const recovered = recordGridFillSyncRecoveryState({
    stateJson: failed,
    now: new Date("2026-03-19T10:00:10.000Z"),
    summary: { fetched: 12, inserted: 2, duplicates: 1 }
  });

  const pending = listPendingGridExecutions(recovered);
  assert.equal(pending.length, 0);
  assert.deepEqual((recovered as any).executionRecovery.fillSync.consecutiveFailures, 0);
  assert.equal((recovered as any).executionRecovery.fillSync.lastInsertedCount, 2);
  assert.equal(typeof (recovered as any).executionRecovery.fillSync.lastSuccessAt, "string");
});
