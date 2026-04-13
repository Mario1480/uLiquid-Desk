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
  snapshotVenueOrdersForRecovery,
  upsertPendingGridExecution
} from "./recovery.js";

const COREWRITER_CLOID_DECIMAL = "208456784328589790982014142665896995042";
const COREWRITER_CLOID_HEX = `0x${BigInt(COREWRITER_CLOID_DECIMAL).toString(16).padStart(32, "0")}`;

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

test("recoverGridPendingExecutions adopts an existing venue order outside a small first page", async () => {
  const created: Array<{ clientOrderId: string; exchangeOrderId: string | null | undefined }> = [];
  const stateJson = upsertPendingGridExecution({}, createPendingGridExecution({
    clientOrderId: "grid-cid-large-page-1",
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
    instanceId: "grid_large_page_1",
    botId: "bot_large_page_1",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_large_page_1",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T10:00:15.000Z"),
    stateJson,
    openOrders: [],
    adapter: {
      listOpenOrders: async () => Array.from({ length: 151 }, (_, index) => ({
        orderId: `venue-${index}`,
        raw: index === 150
          ? { clientOid: "grid-cid-large-page-1" }
          : { clientOid: `other-cid-${index}` }
      }))
    },
    deps: {
      createOrderMapEntry: async (input) => {
        created.push({
          clientOrderId: input.clientOrderId,
          exchangeOrderId: input.exchangeOrderId
        });
      },
      listGridOpenOrders: async () => [{ clientOrderId: "grid-cid-large-page-1", exchangeOrderId: "venue-150" }]
    }
  });

  assert.equal(result.blockedReason, null);
  assert.equal(result.summary.recoveredCount, 1);
  assert.equal(created[0]?.clientOrderId, "grid-cid-large-page-1");
  assert.equal(created[0]?.exchangeOrderId, "venue-150");
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
  assert.equal(pending?.lastError, "recovery_confirmation_timeout");
});

test("recoverGridPendingExecutions clears escalated timeout blocks after a follow-up empty venue confirmation", async () => {
  const staleState = upsertPendingGridExecution({}, {
    ...createPendingGridExecution({
      clientOrderId: "grid-cid-timeout-followup",
      symbol: "BTCUSDT",
      side: "sell",
      orderType: "limit",
      qty: 0.01,
      price: 73000,
      reduceOnly: true,
      gridLeg: "long",
      gridIndex: 14,
      intentType: "rebalance",
      executionExchange: "hyperliquid",
      now: new Date("2026-03-19T09:00:00.000Z")
    }),
    lastError: "adapter_place_order_failed:fetch failed"
  });

  const escalated = await recoverGridPendingExecutions({
    instanceId: "grid_4a",
    botId: "bot_4a",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_4a",
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

  const cleared = await recoverGridPendingExecutions({
    instanceId: "grid_4a",
    botId: "bot_4a",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_4a",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:06:30.000Z"),
    stateJson: escalated.stateJson,
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

  assert.equal(escalated.blockedReason, "grid_execution_manual_intervention_required");
  assert.equal(cleared.blockedReason, null);
  assert.equal(cleared.summary.recoveredCount, 1);
  assert.equal(listPendingGridExecutions(cleared.stateJson).length, 0);
});

test("recoverGridPendingExecutions keeps pending cancel state blocked while venue still shows the order", async () => {
  const stateJson = upsertPendingGridExecution({}, {
    ...createPendingGridExecution({
      clientOrderId: "grid-cid-cancel-pending",
      actionType: "cancel_order",
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "limit",
      qty: 0.01,
      price: 73000,
      gridLeg: "long",
      gridIndex: 9,
      intentType: "entry",
      executionExchange: "hyperliquid",
      now: new Date("2026-03-19T09:00:00.000Z")
    }),
    exchangeOrderId: "venue-cancel-1",
    lastError: "grid_cancel_confirmation_pending:receipt_timeout"
  });

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_cancel_pending_1",
    botId: "bot_cancel_pending_1",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_cancel_pending_1",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:00:30.000Z"),
    stateJson,
    openOrders: [{ clientOrderId: "grid-cid-cancel-pending", exchangeOrderId: "venue-cancel-1" }],
    adapter: {
      listOpenOrders: async () => [{ orderId: "venue-cancel-1", raw: { clientOid: "grid-cid-cancel-pending" } }]
    },
    deps: {
      createOrderMapEntry: async () => undefined,
      listGridOpenOrders: async () => [{ clientOrderId: "grid-cid-cancel-pending", exchangeOrderId: "venue-cancel-1" }]
    }
  });

  assert.equal(result.blockedReason, "grid_cancel_confirmation_pending");
  assert.equal(result.summary.pendingCount, 1);
  const [pending] = listPendingGridExecutions(result.stateJson);
  assert.equal(pending?.actionType, "cancel_order");
  assert.equal(pending?.exchangeOrderId, "venue-cancel-1");
});

test("recoverGridPendingExecutions resolves pending cancel state once venue confirms the order is gone", async () => {
  const updatedStatuses: Array<{ clientOrderId?: string | null; exchangeOrderId?: string | null; status: string }> = [];
  const stateJson = upsertPendingGridExecution({}, {
    ...createPendingGridExecution({
      clientOrderId: "grid-cid-cancel-cleared",
      actionType: "cancel_order",
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "limit",
      qty: 0.01,
      price: 73100,
      gridLeg: "long",
      gridIndex: 10,
      intentType: "entry",
      executionExchange: "hyperliquid",
      now: new Date("2026-03-19T09:00:00.000Z")
    }),
    exchangeOrderId: "venue-cancel-2",
    lastError: "grid_cancel_confirmation_pending:receipt_timeout"
  });

  const result = await recoverGridPendingExecutions({
    instanceId: "grid_cancel_pending_2",
    botId: "bot_cancel_pending_2",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_cancel_pending_2",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:00:45.000Z"),
    stateJson,
    openOrders: [{ clientOrderId: "grid-cid-cancel-cleared", exchangeOrderId: "venue-cancel-2" }],
    adapter: {
      listOpenOrders: async () => []
    },
    deps: {
      createOrderMapEntry: async () => undefined,
      updateOrderMapStatus: async (input) => {
        updatedStatuses.push(input);
      },
      listGridOpenOrders: async () => []
    }
  });

  assert.equal(result.blockedReason, null);
  assert.equal(result.summary.recoveredCount, 1);
  assert.deepEqual(updatedStatuses, [{
    clientOrderId: "grid-cid-cancel-cleared",
    exchangeOrderId: "venue-cancel-2",
    instanceId: "grid_cancel_pending_2",
    status: "canceled"
  }]);
  assert.equal(listPendingGridExecutions(result.stateJson).length, 0);
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

test("snapshotVenueOrdersForRecovery prefers cloid over derived oid fingerprints", async () => {
  const [order] = await snapshotVenueOrdersForRecovery({
    listOpenOrders: async () => [{
      orderId: "98123",
      raw: {
        oid: 98123,
        cloid: COREWRITER_CLOID_HEX,
        side: "B",
        limitPx: "67500",
        sz: "0.001",
        reduceOnly: false
      }
    }]
  });

  assert.equal(order?.exchangeOrderId, "98123");
  assert.equal(order?.clientOrderId, COREWRITER_CLOID_HEX);
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
  assert.equal(first.unknownVenueOrders.length, 0);
});

test("reconcileGridOpenOrdersAgainstVenue matches corewriter cloid decimal against venue hex cloid", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{
      clientOrderId: "grid-cid-core-hex-1",
      exchangeOrderId: `cloid:0:${COREWRITER_CLOID_DECIMAL}`,
      side: "sell",
      price: 66481,
      qty: 0.00069,
      reduceOnly: true
    }],
    venueOrders: [{
      exchangeOrderId: "98234124",
      clientOrderId: COREWRITER_CLOID_HEX,
      side: "sell",
      price: 66481,
      qty: 0.00069,
      reduceOnly: true
    }]
  });

  assert.equal(first.summary.matchedVenueCount, 1);
  assert.equal(first.summary.missingVenueCount, 0);
  assert.equal(first.summary.unknownVenueCount, 0);
  assert.equal(first.unknownVenueOrders.length, 0);
});

test("reconcileGridOpenOrdersAgainstVenue keeps corewriter orders when local and venue refs mix decimal and hex cloid variants", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{
      clientOrderId: COREWRITER_CLOID_HEX,
      exchangeOrderId: `cloid:0:${COREWRITER_CLOID_DECIMAL}`,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }],
    venueOrders: [{
      exchangeOrderId: "98234126",
      clientOrderId: COREWRITER_CLOID_DECIMAL,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }]
  });

  assert.equal(first.summary.matchedVenueCount, 1);
  assert.equal(first.summary.orphanedCount, 0);
  assert.equal(first.summary.unknownVenueCount, 0);
});

test("reconcileGridOpenOrdersAgainstVenue keeps legacy corewriter refs compatible with canonical cloid refs", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{
      clientOrderId: "grid-cid-core-legacy-1",
      exchangeOrderId: `corewriter:0:${COREWRITER_CLOID_DECIMAL}`,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }],
    venueOrders: [{
      exchangeOrderId: "98234127",
      clientOrderId: `cloid:0:${COREWRITER_CLOID_DECIMAL}`,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }]
  });

  assert.equal(first.summary.matchedVenueCount, 1);
  assert.equal(first.summary.orphanedCount, 0);
  assert.equal(first.summary.unknownVenueCount, 0);
});

test("reconcileGridOpenOrdersAgainstVenue does not confuse bare numeric venue ids with bare numeric cloid-like client refs", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [{
      clientOrderId: "123",
      exchangeOrderId: null,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }],
    venueOrders: [{
      exchangeOrderId: "123",
      clientOrderId: null,
      side: "buy",
      price: 66481,
      qty: 0.00069,
      reduceOnly: false
    }]
  });

  assert.equal(first.summary.matchedVenueCount, 0);
  assert.equal(first.summary.unknownVenueCount, 1);
});

test("reconcileGridOpenOrdersAgainstVenue exposes truly unknown venue orders for rehydration", () => {
  const first = reconcileGridOpenOrdersAgainstVenue({
    stateJson: {},
    now: new Date("2026-03-19T10:00:00.000Z"),
    openOrders: [],
    venueOrders: [{
      exchangeOrderId: "98234125",
      clientOrderId: "0x11111111111111111111111111111111",
      side: "sell",
      price: 66500,
      qty: 0.00016,
      reduceOnly: true
    }]
  });

  assert.equal(first.summary.unknownVenueCount, 1);
  assert.equal(first.unknownVenueOrders.length, 1);
  assert.equal(first.unknownVenueOrders[0]?.exchangeOrderId, "98234125");
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
