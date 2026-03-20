import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingGridExecution,
  recordGridFillSyncRecoveryState,
  reconcileGridOpenOrdersAgainstVenue,
  recoverGridPendingExecutions,
  upsertPendingGridExecution
} from "./recovery.js";

test("grid runtime recovery rebuilds pending state across restart and then clears stale orphaned local orders", async () => {
  const restartedState = upsertPendingGridExecution({}, createPendingGridExecution({
    clientOrderId: "grid-cid-restart-1",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    qty: 0.01,
    price: 65000,
    gridLeg: "long",
    gridIndex: 3,
    intentType: "entry",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:00:00.000Z")
  }));

  const recovered = await recoverGridPendingExecutions({
    instanceId: "grid_restart_1",
    botId: "bot_restart_1",
    botSymbol: "BTCUSDT",
    exchangeAccountId: "acc_restart_1",
    executionExchange: "hyperliquid",
    now: new Date("2026-03-19T09:00:20.000Z"),
    stateJson: restartedState,
    openOrders: [],
    adapter: {
      listOpenOrders: async () => [{ orderId: "venue-1", raw: { clientOid: "grid-cid-restart-1" } }]
    },
    deps: {
      createOrderMapEntry: async () => undefined,
      listGridOpenOrders: async () => [{ clientOrderId: "grid-cid-restart-1", exchangeOrderId: "venue-1" }]
    }
  });

  const synced = recordGridFillSyncRecoveryState({
    stateJson: recovered.stateJson,
    now: new Date("2026-03-19T09:00:25.000Z"),
    summary: { fetched: 4, inserted: 1, duplicates: 0 }
  });

  const firstMiss = reconcileGridOpenOrdersAgainstVenue({
    stateJson: synced,
    now: new Date("2026-03-19T09:01:00.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-restart-1", exchangeOrderId: "venue-1" }],
    venueOrders: []
  });
  assert.equal(firstMiss.summary.orphanedCount, 0);

  const secondMiss = reconcileGridOpenOrdersAgainstVenue({
    stateJson: firstMiss.stateJson,
    now: new Date("2026-03-19T09:01:05.000Z"),
    openOrders: [{ clientOrderId: "grid-cid-restart-1", exchangeOrderId: "venue-1" }],
    venueOrders: []
  });

  assert.equal(secondMiss.summary.orphanedCount, 1);
  assert.deepEqual(secondMiss.staleOrders, [{ clientOrderId: "grid-cid-restart-1", exchangeOrderId: "venue-1" }]);
  assert.equal((secondMiss.stateJson as any).executionRecovery.fillSync.lastInsertedCount, 1);
});
