import assert from "node:assert/strict";
import test from "node:test";
import { createMasterVaultService } from "./masterVault.service.js";
import { createFeeSettlementService } from "./feeSettlement.service.js";
import { createBotVaultLifecycleService } from "./botVaultLifecycle.service.js";

type MasterVaultRow = {
  id: string;
  userId: string;
  freeBalance: number;
  reservedBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalAllocatedUsd: number;
  totalWithdrawnUsd: number;
  availableUsd: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type BotVaultRow = {
  id: string;
  userId: string;
  masterVaultId: string;
  templateId: string;
  gridInstanceId: string;
  principalAllocated: number;
  principalReturned: number;
  realizedPnlNet: number;
  feePaidTotal: number;
  highWaterMark: number;
  allocatedUsd: number;
  availableUsd: number;
  realizedNetUsd: number;
  profitShareAccruedUsd: number;
  withdrawnUsd: number;
  status: string;
  matchingStateJson: Record<string, unknown> | null;
  executionProvider: string | null;
  executionUnitId: string | null;
  executionStatus: string | null;
  agentWallet: string | null;
  updatedAt: Date;
};

type LedgerRow = {
  id: string;
  sourceKey: string;
  entryType: string;
  amountUsd: number;
  metadataJson: Record<string, unknown> | null;
};

type FeeEventRow = {
  id: string;
  botVaultId: string;
  eventType: string;
  profitBase: number;
  feeAmount: number;
  sourceKey: string | null;
  createdAt: Date;
};

type CashEventRow = {
  id: string;
  eventType: string;
  masterVaultId: string;
  botVaultId: string | null;
  idempotencyKey: string | null;
  amount: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

function createInMemoryDb() {
  const masterVaults: MasterVaultRow[] = [];
  const botVaults: BotVaultRow[] = [];
  const ledgers: LedgerRow[] = [];
  const feeEvents: FeeEventRow[] = [];
  const cashEvents: CashEventRow[] = [];
  let masterSeq = 0;
  let botSeq = 0;
  let ledgerSeq = 0;
  let feeSeq = 0;
  let cashSeq = 0;

  const gridInstances = [
    {
      id: "grid_1",
      userId: "user_1",
      templateId: "legacy_grid_default",
      leverage: 3,
      investUsd: 100,
      extraMarginUsd: 0,
      template: { symbol: "BTCUSDT" },
      exchangeAccount: { exchange: "hyperliquid" }
    }
  ];

  const templates = new Map<string, any>([
    [
      "legacy_grid_default",
      {
        id: "legacy_grid_default",
        isActive: true,
        allowedSymbols: [],
        minAllocationUsd: 0.01,
        maxAllocationUsd: 1_000_000,
        maxLeverage: 125
      }
    ]
  ]);

  function applyOps(row: Record<string, any>, data: Record<string, any>) {
    for (const [key, value] of Object.entries(data)) {
      const op = value as Record<string, number>;
      if (op && typeof op === "object" && "increment" in op) {
        row[key] = Number(row[key] ?? 0) + Number(op.increment ?? 0);
      } else if (op && typeof op === "object" && "decrement" in op) {
        row[key] = Number(row[key] ?? 0) - Number(op.decrement ?? 0);
      } else {
        row[key] = value;
      }
    }
  }

  const tx = {
    masterVault: {
      async findUnique(args: any) {
        const where = args?.where ?? {};
        if (where.userId) return masterVaults.find((row) => row.userId === where.userId) ?? null;
        if (where.id) return masterVaults.find((row) => row.id === where.id) ?? null;
        return null;
      },
      async create(args: any) {
        const userId = String(args?.data?.userId ?? "");
        const existing = masterVaults.find((row) => row.userId === userId);
        if (existing) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        masterSeq += 1;
        const now = new Date();
        const row: MasterVaultRow = {
          id: `mv_${masterSeq}`,
          userId,
          freeBalance: 0,
          reservedBalance: 0,
          totalDeposited: 0,
          totalWithdrawn: 0,
          totalAllocatedUsd: 0,
          totalWithdrawnUsd: 0,
          availableUsd: 0,
          status: "active",
          createdAt: now,
          updatedAt: now
        };
        masterVaults.push(row);
        return row;
      },
      async update(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = masterVaults.find((entry) => entry.id === id);
        if (!row) throw new Error("master_vault_not_found");
        applyOps(row as any, args?.data ?? {});
        row.updatedAt = new Date();
        return row;
      },
      async updateMany(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = masterVaults.find((entry) => entry.id === id);
        if (!row) return { count: 0 };
        const freeGte = Number(args?.where?.freeBalance?.gte ?? Number.NEGATIVE_INFINITY);
        const reservedGte = Number(args?.where?.reservedBalance?.gte ?? Number.NEGATIVE_INFINITY);
        if (row.freeBalance < freeGte) return { count: 0 };
        if (row.reservedBalance < reservedGte) return { count: 0 };
        applyOps(row as any, args?.data ?? {});
        row.updatedAt = new Date();
        return { count: 1 };
      }
    },
    cashEvent: {
      async findUnique(args: any) {
        const key = args?.where?.idempotencyKey;
        if (!key) return null;
        return cashEvents.find((row) => row.idempotencyKey === key) ?? null;
      },
      async create(args: any) {
        const data = args?.data ?? {};
        const key = data.idempotencyKey ? String(data.idempotencyKey) : null;
        if (key && cashEvents.some((row) => row.idempotencyKey === key)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        cashSeq += 1;
        const row: CashEventRow = {
          id: `ce_${cashSeq}`,
          eventType: String(data.eventType ?? ""),
          masterVaultId: String(data.masterVaultId ?? ""),
          botVaultId: data.botVaultId ? String(data.botVaultId) : null,
          idempotencyKey: key,
          amount: Number(data.amount ?? 0),
          metadata: (data.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        cashEvents.push(row);
        return row;
      }
    },
    gridBotInstance: {
      async findUnique(args: any) {
        const id = String(args?.where?.id ?? "");
        return gridInstances.find((row) => row.id === id) ?? null;
      }
    },
    botTemplate: {
      async findUnique(args: any) {
        const id = String(args?.where?.id ?? "");
        return templates.get(id) ?? null;
      }
    },
    botVault: {
      async findUnique(args: any) {
        const where = args?.where ?? {};
        if (where.id) return botVaults.find((row) => row.id === where.id) ?? null;
        if (where.gridInstanceId) return botVaults.find((row) => row.gridInstanceId === where.gridInstanceId) ?? null;
        return null;
      },
      async findFirst(args: any) {
        const where = args?.where ?? {};
        return botVaults.find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.userId && row.userId !== where.userId) return false;
          return true;
        }) ?? null;
      },
      async create(args: any) {
        const data = args?.data ?? {};
        if (botVaults.some((row) => row.gridInstanceId === String(data.gridInstanceId))) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        botSeq += 1;
        const row: BotVaultRow = {
          id: `bv_${botSeq}`,
          userId: String(data.userId),
          masterVaultId: String(data.masterVaultId),
          templateId: String(data.templateId ?? "legacy_grid_default"),
          gridInstanceId: String(data.gridInstanceId),
          principalAllocated: Number(data.principalAllocated ?? 0),
          principalReturned: Number(data.principalReturned ?? 0),
          realizedPnlNet: Number(data.realizedPnlNet ?? 0),
          feePaidTotal: Number(data.feePaidTotal ?? 0),
          highWaterMark: Number(data.highWaterMark ?? 0),
          allocatedUsd: Number(data.allocatedUsd ?? 0),
          availableUsd: Number(data.availableUsd ?? 0),
          realizedNetUsd: Number(data.realizedNetUsd ?? 0),
          profitShareAccruedUsd: Number(data.profitShareAccruedUsd ?? 0),
          withdrawnUsd: Number(data.withdrawnUsd ?? 0),
          status: String(data.status ?? "ACTIVE"),
          matchingStateJson: (data.matchingStateJson ?? null) as Record<string, unknown> | null,
          executionProvider: data.executionProvider ? String(data.executionProvider) : null,
          executionUnitId: data.executionUnitId ? String(data.executionUnitId) : null,
          executionStatus: data.executionStatus ? String(data.executionStatus) : null,
          agentWallet: data.agentWallet ? String(data.agentWallet) : null,
          updatedAt: new Date()
        };
        botVaults.push(row);
        return row;
      },
      async update(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = botVaults.find((entry) => entry.id === id);
        if (!row) throw new Error("bot_vault_not_found");
        applyOps(row as any, args?.data ?? {});
        row.updatedAt = new Date();
        return row;
      }
    },
    vaultLedgerEntry: {
      async findUnique(args: any) {
        const sourceKey = String(args?.where?.sourceKey ?? "");
        return ledgers.find((row) => row.sourceKey === sourceKey) ?? null;
      },
      async findFirst(args: any) {
        const sourceKey = String(args?.where?.sourceKey ?? "");
        return ledgers.find((row) => row.sourceKey === sourceKey) ?? null;
      },
      async findMany(args: any) {
        const sourceKey = String(args?.where?.sourceKey ?? "");
        return ledgers.filter((row) => row.sourceKey === sourceKey).slice(0, Number(args?.take ?? 200));
      },
      async create(args: any) {
        const data = args?.data ?? {};
        const sourceKey = String(data.sourceKey ?? "");
        if (ledgers.some((row) => row.sourceKey === sourceKey)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        ledgerSeq += 1;
        const row: LedgerRow = {
          id: `ledger_${ledgerSeq}`,
          sourceKey,
          entryType: String(data.entryType ?? ""),
          amountUsd: Number(data.amountUsd ?? 0),
          metadataJson: (data.metadataJson ?? null) as Record<string, unknown> | null
        };
        ledgers.push(row);
        return row;
      }
    },
    feeEvent: {
      async create(args: any) {
        const data = args?.data ?? {};
        const sourceKey = data.sourceKey ? String(data.sourceKey) : null;
        if (sourceKey && feeEvents.some((row) => row.sourceKey === sourceKey)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        feeSeq += 1;
        const row: FeeEventRow = {
          id: `fee_${feeSeq}`,
          botVaultId: String(data.botVaultId ?? ""),
          eventType: String(data.eventType ?? ""),
          profitBase: Number(data.profitBase ?? 0),
          feeAmount: Number(data.feeAmount ?? 0),
          sourceKey,
          createdAt: new Date()
        };
        feeEvents.push(row);
        return row;
      },
      async findMany(args: any) {
        const botVaultId = String(args?.where?.botVaultId ?? "");
        return feeEvents.filter((row) => row.botVaultId === botVaultId);
      }
    }
  };

  return {
    db: {
      ...tx,
      async $transaction(run: (txParam: any) => Promise<any>) {
        return run(tx);
      }
    },
    state: {
      masterVaults,
      botVaults,
      ledgers,
      feeEvents,
      cashEvents
    }
  };
}

test("mvp flow deposit -> create bot vault -> close -> fee -> withdraw stays consistent", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  const feeSettlementService = createFeeSettlementService(ctx.db, {
    masterVaultService
  });

  const executionLifecycleService = {
    provisionIdentityForBotVault: async (params: any) => {
      return ctx.db.botVault.update({
        where: { id: params.botVaultId },
        data: {
          executionProvider: "mock",
          executionUnitId: `unit_${params.botVaultId}`,
          executionStatus: "created"
        }
      });
    },
    assignAgentWallet: async (params: any) => {
      return ctx.db.botVault.update({
        where: { id: params.botVaultId },
        data: {
          agentWallet: params.agentWalletHint ?? "0xcccccccccccccccccccccccccccccccccccccccc"
        }
      });
    },
    pauseExecution: async () => ({}),
    startExecution: async () => ({}),
    setCloseOnly: async () => ({}),
    closeExecution: async () => ({}),
    syncExecutionState: async () => ({
      status: "closed",
      equityUsd: null,
      freeUsd: null,
      usedMarginUsd: null,
      positions: [],
      observedAt: new Date().toISOString()
    })
  } as any;

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    feeSettlementService,
    executionLifecycleService
  });

  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:mvp"
  });

  await ctx.db.botVault.update({
    where: { id: created.id },
    data: {
      availableUsd: { increment: 30 },
      realizedPnlNet: { increment: 30 },
      realizedNetUsd: { increment: 30 }
    }
  });

  await lifecycle.setCloseOnly({
    userId: "user_1",
    botVaultId: String(created.id)
  });

  await lifecycle.close({
    userId: "user_1",
    botVaultId: String(created.id),
    idempotencyKey: "grid_instance:grid_1:close:mvp"
  });

  const afterCloseBalances = await masterVaultService.getBalances({
    userId: "user_1"
  });
  assert.equal(afterCloseBalances.freeBalance, 221);
  assert.equal(afterCloseBalances.reservedBalance, 0);

  await masterVaultService.withdraw({
    userId: "user_1",
    amountUsd: 50,
    idempotencyKey: "withdraw:u1:50"
  });

  const finalBalances = await masterVaultService.getBalances({
    userId: "user_1"
  });
  assert.equal(finalBalances.freeBalance, 171);
  assert.equal(finalBalances.reservedBalance, 0);
  assert.equal(finalBalances.totalWithdrawn, 50);

  const updatedBotVault = ctx.state.botVaults.find((row) => row.id === String(created.id));
  assert.ok(updatedBotVault);
  assert.equal(updatedBotVault?.status, "CLOSED");
  assert.equal(updatedBotVault?.feePaidTotal, 9);
  assert.equal(updatedBotVault?.highWaterMark, 30);
  assert.equal(updatedBotVault?.principalReturned, 100);
  assert.equal(updatedBotVault?.availableUsd, 0);

  assert.equal(ctx.state.feeEvents.length, 1);
  assert.equal(ctx.state.feeEvents[0]?.eventType, "PROFIT_SHARE");
  assert.equal(ctx.state.feeEvents[0]?.feeAmount, 9);

  const cashEventTypes = new Set(ctx.state.cashEvents.map((row) => row.eventType));
  assert.equal(cashEventTypes.has("DEPOSIT"), true);
  assert.equal(cashEventTypes.has("ALLOCATE_TO_BOT"), true);
  assert.equal(cashEventTypes.has("RETURN_FROM_BOT"), true);
  assert.equal(cashEventTypes.has("WITHDRAWAL"), true);

  const ledgerTypes = new Set(ctx.state.ledgers.map((row) => row.entryType));
  assert.equal(ledgerTypes.has("ALLOCATION"), true);
  assert.equal(ledgerTypes.has("WITHDRAWAL"), true);
  assert.equal(ledgerTypes.has("PROFIT_SHARE_ACCRUAL"), true);
});
