import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import { createBotVaultTradingReconciliationService } from "./tradingReconciliation.service.js";

type BotVaultRow = {
  id: string;
  userId: string;
  gridInstanceId: string;
  agentWallet: string | null;
  vaultAddress: string | null;
  executionProvider: string | null;
  executionStatus: string | null;
  executionMetadata: Record<string, unknown> | null;
  principalAllocated: number;
  principalReturned: number;
  availableUsd: number;
  realizedPnlNet: number;
  feePaidTotal: number;
  profitShareAccruedUsd: number;
  realizedGrossUsd: number;
  realizedFeesUsd: number;
  realizedNetUsd: number;
  lastAccountingAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  gridInstance: {
    id: string;
    template: { symbol: string | null };
    exchangeAccount: { exchange: string | null };
  };
};

type BotOrderRow = Record<string, any>;

type BotFillRow = Record<string, any>;

type BotFundingRow = Record<string, any>;

type AggregateRow = Record<string, any>;

type CursorRow = Record<string, any>;

type AdapterScenario = {
  openOrders?: unknown[];
  orderHistory?: unknown[];
  fills?: unknown[];
  funding?: unknown[];
  positions?: Array<Record<string, unknown>>;
  accountState?: Record<string, unknown>;
};

function createInMemoryDb() {
  const botVaults: BotVaultRow[] = [
    {
      id: "bv_1",
      userId: "user_1",
      gridInstanceId: "grid_1",
      agentWallet: "0x1111111111111111111111111111111111111111",
      vaultAddress: "0x2222222222222222222222222222222222222222",
      executionProvider: "hyperliquid",
      executionStatus: "running",
      executionMetadata: null,
      principalAllocated: 100,
      principalReturned: 0,
      availableUsd: 115,
      realizedPnlNet: 0,
      feePaidTotal: 0,
      profitShareAccruedUsd: 0,
      realizedGrossUsd: 0,
      realizedFeesUsd: 0,
      realizedNetUsd: 0,
      lastAccountingAt: null,
      status: "ACTIVE",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      gridInstance: {
        id: "grid_1",
        template: { symbol: "BTCUSDC" },
        exchangeAccount: { exchange: "hyperliquid" }
      }
    }
  ];
  const botOrders: BotOrderRow[] = [];
  const botFills: BotFillRow[] = [];
  const botFundingEvents: BotFundingRow[] = [];
  const pnlAggregates = new Map<string, AggregateRow>();
  const cursors = new Map<string, CursorRow>();
  const feeEvents: any[] = [];
  let orderSeq = 0;
  let fillSeq = 0;
  let fundingSeq = 0;

  const db: any = {
    globalSetting: {
      async findUnique() {
        return {
          value: { mode: "onchain_live" },
          updatedAt: new Date()
        };
      }
    },
    botVault: {
      async findMany(args: any) {
        return botVaults.filter((row) => {
          const where = args?.where ?? {};
          if (where.status?.not && row.status === where.status.not) return false;
          if (where.executionProvider?.equals && row.executionProvider?.toLowerCase() !== String(where.executionProvider.equals).toLowerCase()) return false;
          if (where.agentWallet?.not === null && row.agentWallet == null) return false;
          return true;
        }).slice(0, Number(args?.take ?? botVaults.length));
      },
      async findFirst(args: any) {
        const where = args?.where ?? {};
        return botVaults.find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.userId && row.userId !== where.userId) return false;
          return true;
        }) ?? null;
      },
      async update(args: any) {
        const row = botVaults.find((entry) => entry.id === args?.where?.id);
        if (!row) throw new Error("bot_vault_not_found");
        const data = args?.data ?? {};
        for (const [key, value] of Object.entries(data)) {
          (row as any)[key] = value;
        }
        row.updatedAt = new Date();
        return row;
      }
    },
    botOrder: {
      async findFirst(args: any) {
        const where = args?.where ?? {};
        return botOrders.find((row) => {
          if (where.botVaultId && row.botVaultId !== where.botVaultId) return false;
          const ors = Array.isArray(where.OR) ? where.OR : [];
          if (ors.length === 0) return false;
          return ors.some((entry) => {
            if (entry.exchangeOrderId && row.exchangeOrderId === entry.exchangeOrderId) return true;
            if (entry.clientOrderId && row.clientOrderId === entry.clientOrderId) return true;
            return false;
          });
        }) ?? null;
      },
      async create(args: any) {
        orderSeq += 1;
        const row = { id: `bo_${orderSeq}`, ...args.data };
        botOrders.push(row);
        return row;
      },
      async update(args: any) {
        const row = botOrders.find((entry) => entry.id === args?.where?.id);
        if (!row) throw new Error("bot_order_not_found");
        Object.assign(row, args.data ?? {});
        return row;
      },
      async findMany(args: any) {
        const where = args?.where ?? {};
        const lt = where.createdAt?.lt;
        return botOrders
          .filter((row) => row.botVaultId === where.botVaultId)
          .filter((row) => !lt || row.createdAt < lt)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, Number(args?.take ?? botOrders.length));
      }
    },
    botFill: {
      async findFirst(args: any) {
        const where = args?.where ?? {};
        return botFills.find((row) => {
          if (row.botVaultId !== where.botVaultId) return false;
          if (where.exchangeFillId && row.exchangeFillId === where.exchangeFillId) return true;
          return row.exchangeOrderId === where.exchangeOrderId
            && row.price === where.price
            && row.qty === where.qty
            && row.fillTs.getTime() === where.fillTs.getTime();
        }) ?? null;
      },
      async create(args: any) {
        fillSeq += 1;
        const row = { id: `bf_${fillSeq}`, ...args.data };
        botFills.push(row);
        return row;
      },
      async findMany(args: any) {
        const where = args?.where ?? {};
        const lt = where.fillTs?.lt;
        return botFills
          .filter((row) => row.botVaultId === where.botVaultId)
          .filter((row) => !lt || row.fillTs < lt)
          .sort((a, b) => b.fillTs.getTime() - a.fillTs.getTime())
          .slice(0, Number(args?.take ?? botFills.length));
      }
    },
    botFundingEvent: {
      async create(args: any) {
        const data = args?.data ?? {};
        if (botFundingEvents.some((row) => row.sourceKey === data.sourceKey)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        fundingSeq += 1;
        const row = { id: `fund_${fundingSeq}`, ...data };
        botFundingEvents.push(row);
        return row;
      },
      async findMany(args: any) {
        const where = args?.where ?? {};
        const lt = where.fundingTs?.lt;
        return botFundingEvents
          .filter((row) => row.botVaultId === where.botVaultId)
          .filter((row) => !lt || row.fundingTs < lt)
          .sort((a, b) => b.fundingTs.getTime() - a.fundingTs.getTime())
          .slice(0, Number(args?.take ?? botFundingEvents.length));
      }
    },
    botVaultPnlAggregate: {
      async findUnique(args: any) {
        return pnlAggregates.get(String(args?.where?.botVaultId ?? "")) ?? null;
      },
      async upsert(args: any) {
        const key = String(args?.where?.botVaultId ?? args?.create?.botVaultId ?? "");
        const next = { ...(pnlAggregates.get(key) ?? {}), ...(pnlAggregates.has(key) ? args.update : args.create) };
        pnlAggregates.set(key, next);
        return next;
      }
    },
    botVaultReconciliationCursor: {
      async findUnique(args: any) {
        return cursors.get(String(args?.where?.id ?? "")) ?? null;
      },
      async upsert(args: any) {
        const key = String(args?.where?.id ?? "");
        const next = { ...(cursors.get(key) ?? {}), id: key, ...(cursors.has(key) ? args.update : args.create) };
        cursors.set(key, next);
        return next;
      }
    },
    feeEvent: {
      async findMany(args: any) {
        return feeEvents.filter((row) => row.botVaultId === args?.where?.botVaultId);
      }
    },
    async $transaction<T>(callback: (tx: any) => Promise<T>) {
      return callback(db);
    }
  };

  return {
    db,
    state: {
      botVaults,
      botOrders,
      botFills,
      botFundingEvents,
      pnlAggregates,
      cursors,
      feeEvents
    }
  };
}

function createServiceWithScenario(
  ctx: ReturnType<typeof createInMemoryDb>,
  getScenario: () => AdapterScenario
) {
  return createBotVaultTradingReconciliationService(ctx.db, {
    async createReadAdapter() {
      return {
        async getOpenOrders() {
          return getScenario().openOrders ?? [];
        },
        async getOrderHistory() {
          return getScenario().orderHistory ?? [];
        },
        async getFills() {
          return getScenario().fills ?? [];
        },
        async getFunding() {
          return getScenario().funding ?? [];
        },
        async getPositions() {
          return getScenario().positions ?? [];
        },
        async getAccountState() {
          return getScenario().accountState ?? {
            equity: 115,
            availableMargin: 115
          };
        },
        toCanonicalSymbol(value: string) {
          return `${value}USDC`;
        },
        async close() {
          return;
        }
      };
    }
  });
}

test("reconcileBotVault writes orders, fills, funding and stays idempotent on rerun", async () => {
  const ctx = createInMemoryDb();
  const service = createServiceWithScenario(ctx, () => ({
    openOrders: [
      {
        oid: "1001",
        cloid: "client-1",
        coin: "BTC",
        side: "B",
        limitPx: "42000",
        sz: "0.01",
        reduceOnly: false,
        isTrigger: false,
        timestamp: Date.parse("2026-03-10T09:00:00.000Z")
      }
    ],
    fills: [
      {
        oid: "1001",
        tid: "fill-1",
        coin: "BTC",
        side: "B",
        px: "42000",
        sz: "0.01",
        fee: "1.5",
        closedPnl: "20",
        time: Date.parse("2026-03-10T09:05:00.000Z")
      }
    ],
    funding: [
      {
        hash: "funding-1",
        time: Date.parse("2026-03-10T09:10:00.000Z"),
        delta: {
          coin: "BTC",
          fundingRate: "0.0001",
          szi: "0",
          usdc: "-2"
        }
      }
    ]
  }));

  const first = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(first.newOrders, 1);
  assert.equal(first.newFills, 1);
  assert.equal(first.newFundingEvents, 1);
  assert.equal(first.aggregate.realizedPnlNet, 16.5);
  assert.equal(first.aggregate.isFlat, true);
  assert.equal(first.aggregate.netWithdrawableProfit, 15);

  const second = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(second.newOrders, 0);
  assert.equal(second.newFills, 0);
  assert.equal(second.newFundingEvents, 0);
  assert.equal(ctx.state.botFills.length, 1);
  assert.equal(ctx.state.botFundingEvents.length, 1);

  const report = await service.getBotVaultPnlReport({
    userId: "user_1",
    botVaultId: "bv_1",
    fillsLimit: 10
  });
  assert.equal(report.realizedPnlNet, 16.5);
  assert.equal(report.isFlat, true);
  assert.equal(report.fillsPreview.length, 1);

  const audit = await service.getBotVaultAudit({
    userId: "user_1",
    botVaultId: "bv_1",
    limit: 10
  });
  assert.equal(audit.items.length >= 3, true);
  assert.equal(audit.items.some((item) => item.kind === "fill"), true);
  assert.equal(audit.items.some((item) => item.kind === "funding"), true);
});

test("reconcileBotVault flags realized pnl drift when a missed fill arrives after prior accounting", async () => {
  const ctx = createInMemoryDb();
  ctx.state.botVaults[0]!.realizedPnlNet = 0;
  ctx.state.botVaults[0]!.lastAccountingAt = new Date("2026-03-10T08:59:00.000Z");
  ctx.state.pnlAggregates.set("bv_1", {
    botVaultId: "bv_1",
    grossRealizedPnl: 0,
    tradingFeesTotal: 0,
    fundingTotal: 0,
    realizedPnlNet: 0,
    netWithdrawableProfit: 0,
    isFlat: true,
    openPositionCount: 0,
    lastReconciledAt: new Date("2026-03-10T08:59:00.000Z"),
    sourceVersion: 1,
    metadata: null
  });

  const service = createServiceWithScenario(ctx, () => ({
    fills: [
      {
        oid: "1002",
        tid: "missed-fill-1",
        coin: "BTC",
        side: "S",
        px: "42500",
        sz: "0.01",
        fee: "1",
        closedPnl: "25",
        time: Date.parse("2026-03-10T09:01:00.000Z")
      }
    ],
    positions: [],
    accountState: {
      equity: 115,
      availableMargin: 115
    }
  }));

  const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(result.newFills, 1);
  assert.equal(result.reconciliation.status, "drift_detected");
  assert.equal(
    result.reconciliation.items.some((item) => item.kind === "realized_pnl" && item.status === "drift_detected"),
    true
  );
});

test("reconcileBotVault flags open exposure drift on partial fill scenarios", async () => {
  const ctx = createInMemoryDb();
  ctx.state.botVaults[0]!.lastAccountingAt = new Date("2026-03-10T08:55:00.000Z");
  ctx.state.pnlAggregates.set("bv_1", {
    botVaultId: "bv_1",
    grossRealizedPnl: 0,
    tradingFeesTotal: 0,
    fundingTotal: 0,
    realizedPnlNet: 0,
    netWithdrawableProfit: 0,
    isFlat: true,
    openPositionCount: 0,
    lastReconciledAt: new Date("2026-03-10T08:55:00.000Z"),
    sourceVersion: 1,
    metadata: null
  });

  const service = createServiceWithScenario(ctx, () => ({
    orderHistory: [
      {
        oid: "1003",
        cloid: "client-partial",
        coin: "BTC",
        side: "B",
        limitPx: "42000",
        sz: "0.02",
        reduceOnly: false,
        status: "partiallyFilled",
        timestamp: Date.parse("2026-03-10T09:00:00.000Z")
      }
    ],
    fills: [
      {
        oid: "1003",
        tid: "partial-fill-1",
        coin: "BTC",
        side: "B",
        px: "42000",
        sz: "0.01",
        fee: "0",
        closedPnl: "0",
        time: Date.parse("2026-03-10T09:01:00.000Z")
      }
    ],
    positions: [
      {
        coin: "BTC",
        size: 0.01
      }
    ],
    accountState: {
      equity: 115,
      availableMargin: 115
    }
  }));

  const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(result.reconciliation.status, "drift_detected");
  const exposureItem = result.reconciliation.items.find((item) => item.kind === "open_position_exposure");
  assert.ok(exposureItem);
  assert.equal(exposureItem.status, "drift_detected");
  assert.equal(exposureItem.actual, 1);
});

test("reconcileBotVault prefers execution provider vault address over onchain bot vault address", async () => {
  const ctx = createInMemoryDb();
  ctx.state.botVaults[0]!.vaultAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  ctx.state.botVaults[0]!.executionMetadata = {
    providerState: {
      vaultAddress: "0x2222222222222222222222222222222222222222"
    }
  };

  let capturedVaultAddress: string | null = null;
  const service = createBotVaultTradingReconciliationService(ctx.db, {
    async createReadAdapter(params) {
      capturedVaultAddress = params.vaultAddress;
      return {
        async getOpenOrders() {
          return [];
        },
        async getOrderHistory() {
          return [];
        },
        async getFills() {
          return [];
        },
        async getFunding() {
          return [];
        },
        async getPositions() {
          return [];
        },
        async getAccountState() {
          return {
            equity: 115,
            availableMargin: 115
          };
        },
        async close() {
          return;
        }
      };
    }
  });

  await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(capturedVaultAddress, "0x2222222222222222222222222222222222222222");
});

test("reconcileBotVault backtracks cursors so delayed fills are still ingested", async () => {
  const ctx = createInMemoryDb();
  ctx.state.botVaults[0]!.lastAccountingAt = new Date("2026-03-10T09:00:00.000Z");
  ctx.state.pnlAggregates.set("bv_1", {
    botVaultId: "bv_1",
    grossRealizedPnl: 0,
    tradingFeesTotal: 0,
    fundingTotal: 0,
    realizedPnlNet: 0,
    netWithdrawableProfit: 0,
    isFlat: true,
    openPositionCount: 0,
    lastReconciledAt: new Date("2026-03-10T09:00:00.000Z"),
    sourceVersion: 1,
    metadata: null
  });
  ctx.state.cursors.set("bv_1:fills", {
    id: "bv_1:fills",
    botVaultId: "bv_1",
    streamType: "fills",
    cursorTs: new Date("2026-03-10T09:10:00.000Z"),
    cursorValue: null
  });

  let callCount = 0;
  const service = createBotVaultTradingReconciliationService(ctx.db, {
    async createReadAdapter() {
      return {
        async getOpenOrders() {
          return [];
        },
        async getOrderHistory() {
          return [];
        },
        async getFills(params) {
          callCount += 1;
          assert.equal(params.startTime, Date.parse("2026-03-10T09:05:00.000Z"));
          return [
            {
              oid: "1004",
              tid: "delayed-fill-1",
              coin: "BTC",
              side: "S",
              px: "43000",
              sz: "0.01",
              fee: "0.5",
              closedPnl: "10",
              time: Date.parse("2026-03-10T09:08:00.000Z")
            }
          ];
        },
        async getFunding() {
          return [];
        },
        async getPositions() {
          return [];
        },
        async getAccountState() {
          return {
            equity: 115,
            availableMargin: 115
          };
        },
        toCanonicalSymbol(value: string) {
          return `${value}USDC`;
        },
        async close() {
          return;
        }
      };
    }
  });

  const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(callCount, 1);
  assert.equal(result.newFills, 1);
  assert.equal(ctx.state.botFills.length, 1);
  assert.equal(result.reconciliation.status, "drift_detected");
});

test("reconcileBotVault suppresses duplicate fill events from the same ingestion batch", async () => {
  const ctx = createInMemoryDb();
  const service = createServiceWithScenario(ctx, () => ({
    fills: [
      {
        oid: "1005",
        tid: "duplicate-fill-1",
        coin: "BTC",
        side: "B",
        px: "42010",
        sz: "0.01",
        fee: "0",
        closedPnl: "0",
        time: Date.parse("2026-03-10T09:05:00.000Z")
      },
      {
        oid: "1005",
        tid: "duplicate-fill-1",
        coin: "BTC",
        side: "B",
        px: "42010",
        sz: "0.01",
        fee: "0",
        closedPnl: "0",
        time: Date.parse("2026-03-10T09:05:00.000Z")
      }
    ],
    positions: [],
    accountState: {
      equity: 115,
      availableMargin: 115
    }
  }));

  const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(result.newFills, 1);
  assert.equal(ctx.state.botFills.length, 1);
  assert.equal(result.reconciliation.status, "clean");

  const rerun = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(rerun.newFills, 0);
  assert.equal(ctx.state.botFills.length, 1);
});

test("reconcileBotVault tolerates flaky non-critical Hyperliquid history reads on fresh vaults", async () => {
  const ctx = createInMemoryDb();
  const service = createBotVaultTradingReconciliationService(ctx.db, {
    async createReadAdapter() {
      return {
        async getOpenOrders() {
          throw new Error("HyperliquidAPIError: Failed to deserialize the JSON body into the target type");
        },
        async getOrderHistory() {
          throw new Error("HyperliquidAPIError: Failed to deserialize the JSON body into the target type");
        },
        async getFills() {
          throw new Error("HyperliquidAPIError: Failed to deserialize the JSON body into the target type");
        },
        async getFunding() {
          throw new Error("HyperliquidAPIError: Failed to deserialize the JSON body into the target type");
        },
        async getPositions() {
          return [];
        },
        async getAccountState() {
          return {
            equity: 115,
            availableMargin: 115
          };
        },
        toCanonicalSymbol(value: string) {
          return `${value}USDC`;
        },
        async close() {
          return;
        }
      };
    }
  });

  const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
  assert.equal(result.newOrders, 0);
  assert.equal(result.newFills, 0);
  assert.equal(result.newFundingEvents, 0);
  assert.equal(result.reconciliation.status, "clean");
  assert.ok(ctx.state.pnlAggregates.get("bv_1"));
  assert.ok(ctx.state.botVaults[0]?.lastAccountingAt instanceof Date);
});

test("default Hyperliquid reconciliation adapter uses historicalOrders and filters stale entries locally", async () => {
  const ctx = createInMemoryDb();
  const service = createBotVaultTradingReconciliationService(ctx.db);

  const originalFetch = globalThis.fetch;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalToCanonicalSymbol = HyperliquidFuturesAdapter.prototype.toCanonicalSymbol;
  const originalClose = HyperliquidFuturesAdapter.prototype.close;
  const seenPayloads: any[] = [];
  const startTime = Date.parse("2026-03-10T00:00:00.000Z");
  const inRangeTs = Date.parse("2026-03-10T09:00:00.000Z");
  const staleTs = Date.parse("2026-02-10T09:00:00.000Z");

  HyperliquidFuturesAdapter.prototype.getPositions = async function getPositionsMock() {
    return [];
  };
  HyperliquidFuturesAdapter.prototype.getAccountState = async function getAccountStateMock() {
    return {
      equity: 115,
      availableMargin: 115,
      marginMode: undefined
    } as any;
  };
  HyperliquidFuturesAdapter.prototype.toCanonicalSymbol = function toCanonicalSymbolMock(value: string) {
    return `${value}USDC`;
  };
  HyperliquidFuturesAdapter.prototype.close = async function closeMock() {
    return;
  };

  globalThis.fetch = (async (_input: any, init?: any) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    seenPayloads.push(payload);
    if (payload.type === "historicalOrders") {
      return {
        ok: true,
        text: async () =>
          JSON.stringify([
            {
              order: {
                oid: "in-range-order",
                coin: "BTC",
                side: "B",
                limitPx: "42000",
                sz: "0.01",
                timestamp: inRangeTs
              },
              status: "open",
              statusTimestamp: inRangeTs
            },
            {
              order: {
                oid: "stale-order",
                coin: "BTC",
                side: "B",
                limitPx: "41000",
                sz: "0.01",
                timestamp: staleTs
              },
              status: "filled",
              statusTimestamp: staleTs
            }
          ])
      } as any;
    }
    return {
      ok: true,
      text: async () => "[]"
    } as any;
  }) as typeof globalThis.fetch;

  try {
    ctx.state.botVaults[0]!.createdAt = new Date(startTime);
    const result = await service.reconcileBotVault({ botVaultId: "bv_1" });
    assert.equal(result.newOrders, 1);
    assert.equal(ctx.state.botOrders.length, 1);
    assert.equal(ctx.state.botOrders[0]?.exchangeOrderId, "in-range-order");
    assert.equal(seenPayloads.some((payload) => payload.type === "userOrderHistory"), false);
    assert.equal(seenPayloads.some((payload) => payload.type === "historicalOrders"), true);
  } finally {
    globalThis.fetch = originalFetch;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.toCanonicalSymbol = originalToCanonicalSymbol;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
  }
});
