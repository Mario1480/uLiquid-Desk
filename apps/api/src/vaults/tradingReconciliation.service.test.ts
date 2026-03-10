import assert from "node:assert/strict";
import test from "node:test";
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
      cursors
    }
  };
}

test("reconcileBotVault writes orders, fills, funding and stays idempotent on rerun", async () => {
  const ctx = createInMemoryDb();
  const service = createBotVaultTradingReconciliationService(ctx.db, {
    async createReadAdapter() {
      return {
        async getOpenOrders() {
          return [
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
          ];
        },
        async getOrderHistory() {
          return [];
        },
        async getFills() {
          return [
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
          ];
        },
        async getFunding() {
          return [
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
          ];
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
