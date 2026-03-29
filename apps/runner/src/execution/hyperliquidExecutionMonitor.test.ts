import assert from "node:assert/strict";
import test from "node:test";
import {
  HyperliquidExecutionMonitor
} from "./hyperliquidExecutionMonitor.js";

function createAdapter(overrides: Partial<{
  listOpenOrders: (params?: { symbol?: string }) => Promise<any[]>;
  getRecentFills: (params?: { symbol?: string; limit?: number }) => Promise<any[]>;
  getAccountState: () => Promise<{ equity?: number; availableMargin?: number }>;
  getPositions: () => Promise<any[]>;
  getCoreUsdcSpotBalance: () => Promise<{ amountUsd?: number }>;
}> = {}) {
  return {
    async listOpenOrders() {
      return [];
    },
    async getRecentFills() {
      return [];
    },
    async getAccountState() {
      return { equity: 1200, availableMargin: 900 };
    },
    async getPositions() {
      return [];
    },
    async getCoreUsdcSpotBalance() {
      return { amountUsd: 250 };
    },
    ...overrides
  };
}

test("submitted order becomes open only after HyperCore later exposes it", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 60_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-1",
    exchangeOrderId: "cloid:7:123",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    price: 70000,
    qty: 0.01,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  const first = await monitor.reconcileOrders({
    adapter: createAdapter(),
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-1", exchangeOrderId: "cloid:7:123" }],
    now: new Date("2026-03-29T10:00:05.000Z")
  });
  assert.equal(first.orders[0]?.state, "enqueued");
  assert.equal(monitor.getOrderByCloid("123")?.clientOrderId, "grid-cid-1");

  const second = await monitor.reconcileOrders({
    adapter: createAdapter({
      async listOpenOrders() {
        return [{
          orderId: "98123",
          symbol: "BTCUSDT",
          side: "buy",
          type: "limit",
          status: "open",
          price: 70000,
          qty: 0.01,
          reduceOnly: false,
          createdAt: "2026-03-29T10:00:01.000Z",
          raw: {
            oid: "98123",
            clientOid: "grid-cid-1",
            cloid: "123"
          }
        }];
      }
    }),
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-1", exchangeOrderId: "cloid:7:123" }],
    now: new Date("2026-03-29T10:00:10.000Z")
  });
  assert.equal(second.orders[0]?.state, "open");
  assert.deepEqual(second.statusChanges.at(-1), {
    orderKey: "client:grid-cid-1",
    previousState: "enqueued",
    nextState: "open"
  });
});

test("partial fill is processed without double counting repeated fills", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 60_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-2",
    exchangeOrderId: "cloid:7:222",
    symbol: "ETHUSDT",
    side: "sell",
    orderType: "limit",
    price: 3200,
    qty: 5,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  const adapter = createAdapter({
    async listOpenOrders() {
      return [{
        orderId: "881",
        symbol: "ETHUSDT",
        side: "sell",
        type: "limit",
        status: "open",
        price: 3200,
        qty: 3,
        reduceOnly: false,
        createdAt: "2026-03-29T10:00:01.000Z",
        raw: {
          oid: "881",
          clientOid: "grid-cid-2",
          cloid: "222"
        }
      }];
    },
    async getRecentFills() {
      return [{
        tid: "fill-1",
        oid: "881",
        clientOid: "grid-cid-2",
        cloid: "222",
        coin: "ETH",
        side: "sell",
        px: 3200,
        sz: 2,
        fee: 0.2,
        time: Date.parse("2026-03-29T10:00:03.000Z")
      }];
    }
  });

  const first = await monitor.reconcileOrders({
    adapter,
    symbol: "ETHUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-2", exchangeOrderId: "cloid:7:222" }],
    now: new Date("2026-03-29T10:00:05.000Z")
  });
  assert.equal(first.orders[0]?.state, "partially_filled");
  assert.equal(first.orders[0]?.filledQty, 2);
  assert.equal(first.newFills.length, 1);

  const second = await monitor.reconcileOrders({
    adapter,
    symbol: "ETHUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-2", exchangeOrderId: "cloid:7:222" }],
    now: new Date("2026-03-29T10:00:06.000Z")
  });
  assert.equal(second.orders[0]?.filledQty, 2);
  assert.equal(second.newFills.length, 0);
});

test("cancel arriving late is modeled as delayed first and canceled once the order disappears", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 60_000,
    cancelVisibilityTimeoutMs: 10_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-3",
    exchangeOrderId: "cloid:7:333",
    symbol: "SOLUSDT",
    side: "buy",
    orderType: "limit",
    price: 150,
    qty: 4,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  await monitor.reconcileOrders({
    adapter: createAdapter({
      async listOpenOrders() {
        return [{
          orderId: "991",
          symbol: "SOLUSDT",
          side: "buy",
          type: "limit",
          status: "open",
          price: 150,
          qty: 4,
          reduceOnly: false,
          createdAt: "2026-03-29T10:00:01.000Z",
          raw: {
            oid: "991",
            clientOid: "grid-cid-3",
            cloid: "333"
          }
        }];
      }
    }),
    symbol: "SOLUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-3", exchangeOrderId: "cloid:7:333" }],
    now: new Date("2026-03-29T10:00:05.000Z")
  });

  monitor.recordCancelRequested({
    clientOrderId: "grid-cid-3",
    exchangeOrderId: "cloid:7:333",
    now: new Date("2026-03-29T10:00:06.000Z")
  });

  const delayed = await monitor.reconcileOrders({
    adapter: createAdapter({
      async listOpenOrders() {
        return [{
          orderId: "991",
          symbol: "SOLUSDT",
          side: "buy",
          type: "limit",
          status: "open",
          price: 150,
          qty: 4,
          reduceOnly: false,
          createdAt: "2026-03-29T10:00:01.000Z",
          raw: {
            oid: "991",
            clientOid: "grid-cid-3",
            cloid: "333"
          }
        }];
      }
    }),
    symbol: "SOLUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-3", exchangeOrderId: "cloid:7:333" }],
    now: new Date("2026-03-29T10:00:25.000Z")
  });
  assert.ok(delayed.alerts.some((row) => row.code === "cancel_delayed"));

  const canceled = await monitor.reconcileOrders({
    adapter: createAdapter(),
    symbol: "SOLUSDT",
    localOpenOrders: [],
    now: new Date("2026-03-29T10:00:27.000Z")
  });
  assert.equal(canceled.orders[0]?.state, "canceled");
});

test("detects drift when a local open order is missing on HyperCore", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 5_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-4",
    exchangeOrderId: "cloid:7:444",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    qty: 0.02,
    price: 68000,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  const result = await monitor.reconcileOrders({
    adapter: createAdapter(),
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-4", exchangeOrderId: "cloid:7:444" }],
    now: new Date("2026-03-29T10:00:10.000Z")
  });
  assert.ok(result.drifts.some((row) => row.kind === "local_open_missing_live"));
});

test("detects drift when HyperCore shows an open order that is missing locally", async () => {
  const monitor = new HyperliquidExecutionMonitor();
  const result = await monitor.reconcileOrders({
    adapter: createAdapter({
      async listOpenOrders() {
        return [{
          orderId: "12345",
          symbol: "BTCUSDT",
          side: "buy",
          type: "limit",
          status: "open",
          price: 69000,
          qty: 0.01,
          reduceOnly: false,
          createdAt: "2026-03-29T10:00:00.000Z",
          raw: {
            oid: "12345",
            clientOid: "grid-cid-live-only",
            cloid: "555"
          }
        }];
      }
    }),
    symbol: "BTCUSDT",
    localOpenOrders: [],
    now: new Date("2026-03-29T10:00:05.000Z")
  });
  assert.ok(result.drifts.some((row) => row.kind === "live_open_missing_local"));
});

test("buildVaultSnapshot returns balances, positions, and exposure", async () => {
  const monitor = new HyperliquidExecutionMonitor();
  const snapshot = await monitor.buildVaultSnapshot(createAdapter({
    async getAccountState() {
      return { equity: 1500, availableMargin: 1100 };
    },
    async getPositions() {
      return [{
        symbol: "BTCUSDT",
        side: "long",
        size: 0.02,
        entryPrice: 68000,
        markPrice: 70000,
        unrealizedPnl: 40
      }];
    },
    async getCoreUsdcSpotBalance() {
      return { amountUsd: 420 };
    }
  }), []);

  assert.equal(snapshot?.equityUsd, 1500);
  assert.equal(snapshot?.availableMarginUsd, 1100);
  assert.equal(snapshot?.coreUsdcSpotBalanceUsd, 420);
  assert.equal(snapshot?.totalPositionNotionalUsd, 1400);
  assert.equal(snapshot?.positions[0]?.symbol, "BTCUSDT");
});

test("reconcile remains idempotent for repeated identical snapshots", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 60_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-5",
    exchangeOrderId: "cloid:7:555",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    price: 70000,
    qty: 0.01,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  const adapter = createAdapter({
    async listOpenOrders() {
      return [{
        orderId: "111",
        symbol: "BTCUSDT",
        side: "buy",
        type: "limit",
        status: "open",
        price: 70000,
        qty: 0.01,
        reduceOnly: false,
        createdAt: "2026-03-29T10:00:01.000Z",
        raw: {
          oid: "111",
          clientOid: "grid-cid-5",
          cloid: "555"
        }
      }];
    }
  });

  const first = await monitor.reconcileOrders({
    adapter,
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-5", exchangeOrderId: "cloid:7:555" }],
    now: new Date("2026-03-29T10:00:10.000Z")
  });
  const second = await monitor.reconcileOrders({
    adapter,
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-5", exchangeOrderId: "cloid:7:555" }],
    now: new Date("2026-03-29T10:00:11.000Z")
  });

  assert.equal(first.orders[0]?.state, "open");
  assert.equal(second.orders[0]?.state, "open");
  assert.equal(second.newFills.length, 0);
  assert.equal(second.statusChanges.length, 0);
});

test("reconcileVaultState returns snapshot and drift information together", async () => {
  const monitor = new HyperliquidExecutionMonitor({
    orderVisibilityTimeoutMs: 5_000
  });
  monitor.recordSubmittedOrder({
    clientOrderId: "grid-cid-6",
    exchangeOrderId: "cloid:7:666",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    price: 70500,
    qty: 0.01,
    now: new Date("2026-03-29T10:00:00.000Z")
  });

  const state = await monitor.reconcileVaultState({
    adapter: createAdapter({
      async getPositions() {
        return [{
          symbol: "BTCUSDT",
          side: "long",
          size: 0.01,
          entryPrice: 70000,
          markPrice: 70500,
          unrealizedPnl: 5
        }];
      }
    }),
    symbol: "BTCUSDT",
    localOpenOrders: [{ clientOrderId: "grid-cid-6", exchangeOrderId: "cloid:7:666" }],
    now: new Date("2026-03-29T10:00:10.000Z")
  });

  assert.equal(state.snapshot?.totalPositionNotionalUsd, 705);
  assert.ok(state.drifts.some((row) => row.kind === "local_open_missing_live"));
});
