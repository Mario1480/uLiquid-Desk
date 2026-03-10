import assert from "node:assert/strict";
import test from "node:test";
import { createFeeSettlementService } from "./feeSettlement.service.js";
import { createMasterVaultService } from "./masterVault.service.js";

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
  gridInstanceId: string;
  principalAllocated: number;
  principalReturned: number;
  realizedPnlNet: number;
  feePaidTotal: number;
  highWaterMark: number;
  allocatedUsd: number;
  availableUsd: number;
  profitShareAccruedUsd: number;
  withdrawnUsd: number;
  status: string;
  updatedAt: Date;
};

type CashEventRow = {
  id: string;
  idempotencyKey: string | null;
  masterVaultId: string;
  botVaultId: string | null;
  eventType: string;
  amount: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

type FeeEventRow = {
  id: string;
  botVaultId: string;
  eventType: string;
  profitBase: number;
  feeAmount: number;
  sourceKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

type LedgerRow = {
  id: string;
  sourceKey: string;
  userId: string;
  masterVaultId: string;
  botVaultId: string | null;
  gridInstanceId: string | null;
  entryType: string;
  amountUsd: number;
  sourceType: string;
  sourceTs: Date | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
};

function createInMemoryDb() {
  const masterVaults: MasterVaultRow[] = [];
  const botVaults: BotVaultRow[] = [];
  const cashEvents: CashEventRow[] = [];
  const feeEvents: FeeEventRow[] = [];
  const ledgerRows: LedgerRow[] = [];
  let masterSeq = 0;
  let botSeq = 0;
  let cashSeq = 0;
  let feeSeq = 0;
  let ledgerSeq = 0;

  function applyMasterVaultUpdate(row: MasterVaultRow, data: Record<string, any>) {
    for (const [key, value] of Object.entries(data)) {
      const op = value as Record<string, number>;
      if (op && typeof op === "object" && "increment" in op) {
        (row as any)[key] = Number((row as any)[key] ?? 0) + Number(op.increment ?? 0);
      } else if (op && typeof op === "object" && "decrement" in op) {
        (row as any)[key] = Number((row as any)[key] ?? 0) - Number(op.decrement ?? 0);
      } else {
        (row as any)[key] = value;
      }
    }
    row.updatedAt = new Date();
    return row;
  }

  function applyBotVaultUpdate(row: BotVaultRow, data: Record<string, any>) {
    for (const [key, value] of Object.entries(data)) {
      const op = value as Record<string, number>;
      if (op && typeof op === "object" && "increment" in op) {
        (row as any)[key] = Number((row as any)[key] ?? 0) + Number(op.increment ?? 0);
      } else if (op && typeof op === "object" && "decrement" in op) {
        (row as any)[key] = Number((row as any)[key] ?? 0) - Number(op.decrement ?? 0);
      } else {
        (row as any)[key] = value;
      }
    }
    row.updatedAt = new Date();
    return row;
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
        return applyMasterVaultUpdate(row, args?.data ?? {});
      },
      async updateMany(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = masterVaults.find((entry) => entry.id === id);
        if (!row) return { count: 0 };
        const freeGte = Number(args?.where?.freeBalance?.gte ?? Number.NEGATIVE_INFINITY);
        const reservedGte = Number(args?.where?.reservedBalance?.gte ?? Number.NEGATIVE_INFINITY);
        if (row.freeBalance < freeGte) return { count: 0 };
        if (row.reservedBalance < reservedGte) return { count: 0 };
        applyMasterVaultUpdate(row, args?.data ?? {});
        return { count: 1 };
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
        botSeq += 1;
        const row: BotVaultRow = {
          id: `bv_${botSeq}`,
          userId: String(data.userId),
          masterVaultId: String(data.masterVaultId),
          gridInstanceId: String(data.gridInstanceId),
          principalAllocated: Number(data.principalAllocated ?? 0),
          principalReturned: Number(data.principalReturned ?? 0),
          realizedPnlNet: Number(data.realizedPnlNet ?? 0),
          feePaidTotal: Number(data.feePaidTotal ?? 0),
          highWaterMark: Number(data.highWaterMark ?? 0),
          allocatedUsd: Number(data.allocatedUsd ?? 0),
          availableUsd: Number(data.availableUsd ?? 0),
          profitShareAccruedUsd: Number(data.profitShareAccruedUsd ?? 0),
          withdrawnUsd: Number(data.withdrawnUsd ?? 0),
          status: String(data.status ?? "ACTIVE"),
          updatedAt: new Date()
        };
        botVaults.push(row);
        return row;
      },
      async update(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = botVaults.find((entry) => entry.id === id);
        if (!row) throw new Error("bot_vault_not_found");
        return applyBotVaultUpdate(row, args?.data ?? {});
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
          idempotencyKey: key,
          masterVaultId: String(data.masterVaultId),
          botVaultId: data.botVaultId ? String(data.botVaultId) : null,
          eventType: String(data.eventType),
          amount: Number(data.amount ?? 0),
          metadata: (data.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        cashEvents.push(row);
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
          id: `fe_${feeSeq}`,
          botVaultId: String(data.botVaultId),
          eventType: String(data.eventType),
          profitBase: Number(data.profitBase ?? 0),
          feeAmount: Number(data.feeAmount ?? 0),
          sourceKey,
          metadata: (data.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        feeEvents.push(row);
        return row;
      }
    },
    vaultLedgerEntry: {
      async findUnique(args: any) {
        const sourceKey = String(args?.where?.sourceKey ?? "");
        return ledgerRows.find((row) => row.sourceKey === sourceKey) ?? null;
      },
      async create(args: any) {
        const data = args?.data ?? {};
        const sourceKey = String(data.sourceKey ?? "");
        if (ledgerRows.some((row) => row.sourceKey === sourceKey)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        ledgerSeq += 1;
        const row: LedgerRow = {
          id: `led_${ledgerSeq}`,
          sourceKey,
          userId: String(data.userId),
          masterVaultId: String(data.masterVaultId),
          botVaultId: data.botVaultId ? String(data.botVaultId) : null,
          gridInstanceId: data.gridInstanceId ? String(data.gridInstanceId) : null,
          entryType: String(data.entryType),
          amountUsd: Number(data.amountUsd ?? 0),
          sourceType: String(data.sourceType ?? ""),
          sourceTs: data.sourceTs instanceof Date ? data.sourceTs : null,
          metadataJson: (data.metadataJson ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        ledgerRows.push(row);
        return row;
      }
    }
  };

  return {
    db: {
      ...tx,
      async $transaction(run: (tx: any) => Promise<any>) {
        return run(tx);
      }
    },
    state: {
      masterVaults,
      botVaults,
      cashEvents,
      feeEvents,
      ledgerRows
    }
  };
}

function createTestLogger() {
  const infos: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  return {
    logger: {
      info(msg: string, meta?: Record<string, unknown>) {
        infos.push({ msg, meta });
      },
      warn(msg: string, meta?: Record<string, unknown>) {
        warns.push({ msg, meta });
      }
    },
    infos,
    warns
  };
}

async function setupBotVaultScenario(params: {
  availableUsd: number;
  realizedPnlNet: number;
  highWaterMark?: number;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
}) {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);

  const master = await masterVaultService.ensureMasterVault({ userId: "user_1" });
  const botVault = await ctx.db.botVault.create({
    data: {
      userId: "user_1",
      masterVaultId: master.id,
      gridInstanceId: "grid_1",
      principalAllocated: 100,
      principalReturned: 0,
      realizedPnlNet: params.realizedPnlNet,
      feePaidTotal: 0,
      highWaterMark: Number(params.highWaterMark ?? 0),
      allocatedUsd: 100,
      availableUsd: params.availableUsd,
      withdrawnUsd: 0,
      profitShareAccruedUsd: 0,
      status: "ACTIVE"
    }
  });

  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "dep:u1:100"
  });
  await masterVaultService.reserveForBotVault({
    userId: "user_1",
    botVaultId: String(botVault.id),
    amountUsd: 100,
    idempotencyKey: "reserve:u1:bv:100"
  });

  const feeSettlementService = createFeeSettlementService(ctx.db, {
    masterVaultService,
    logger: params.logger
  });

  return {
    ctx,
    masterVaultService,
    feeSettlementService,
    botVaultId: String(botVault.id)
  };
}

test("settleProfitWithdraw books fee event, updates bot vault, and credits master free balance", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 130,
    realizedPnlNet: 40
  });

  const result = await setup.feeSettlementService.settleProfitWithdraw({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    requestedGrossUsd: 20,
    idempotencyKey: "withdraw:grid_1:profit:1"
  });

  assert.equal(result.settlementBreakdown.grossTransferUsd, 20);
  assert.equal(result.settlementBreakdown.feeAmountUsd, 6);
  assert.equal(result.settlementBreakdown.netTransferUsd, 14);
  assert.equal(result.settlementBreakdown.principalComponentUsd, 0);
  assert.equal(result.botVaultSnapshotAfter.availableUsd, 110);
  assert.equal(result.botVaultSnapshotAfter.feePaidTotal, 6);
  assert.equal(result.botVaultSnapshotAfter.highWaterMark, 20);
  assert.equal(result.botVaultSnapshotAfter.withdrawnUsd, 20);

  const balances = await setup.masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 14);
  assert.equal(balances.reservedBalance, 100);

  assert.equal(setup.ctx.state.feeEvents.length, 1);
  assert.equal(setup.ctx.state.feeEvents[0]?.feeAmount, 6);
});

test("settleProfitWithdraw is idempotent by idempotencyKey", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 130,
    realizedPnlNet: 40
  });

  await setup.feeSettlementService.settleProfitWithdraw({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    requestedGrossUsd: 20,
    idempotencyKey: "withdraw:grid_1:profit:idempotent"
  });
  await setup.feeSettlementService.settleProfitWithdraw({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    requestedGrossUsd: 20,
    idempotencyKey: "withdraw:grid_1:profit:idempotent"
  });

  assert.equal(setup.ctx.state.feeEvents.length, 1);
  assert.equal(setup.ctx.state.ledgerRows.filter((row) => row.sourceKey === "withdraw:grid_1:profit:idempotent").length, 1);

  const balances = await setup.masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 14);
});

test("settleProfitWithdraw rejects amount above profit-only withdrawable", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 105,
    realizedPnlNet: 20
  });

  await assert.rejects(
    setup.feeSettlementService.settleProfitWithdraw({
      userId: "user_1",
      botVaultId: setup.botVaultId,
      requestedGrossUsd: 10,
      idempotencyKey: "withdraw:grid_1:profit:too_much"
    }),
    /insufficient_withdrawable_profit/
  );
});

test("settleProfitWithdraw blocks reconciliation-based profit settlement when bot vault is not flat", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 130,
    realizedPnlNet: 40
  });

  const service = createFeeSettlementService(setup.ctx.db, {
    masterVaultService: setup.masterVaultService,
    tradingReconciliationService: {
      async getFeeBasisForBotVault() {
        return {
          source: "reconciliation",
          realizedPnlNetUsd: 40,
          isFlat: false,
          netWithdrawableProfitUsd: 20,
          aggregate: {
            botVaultId: setup.botVaultId
          }
        };
      }
    } as any
  });

  await assert.rejects(
    service.settleProfitWithdraw({
      userId: "user_1",
      botVaultId: setup.botVaultId,
      requestedGrossUsd: 10,
      idempotencyKey: "withdraw:grid_1:profit:not_flat"
    }),
    /bot_vault_not_flat/
  );
});

test("settleFinalClose applies fee on realized profit and releases full reserved capital", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 130,
    realizedPnlNet: 30
  });

  const result = await setup.feeSettlementService.settleFinalClose({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    idempotencyKey: "close:grid_1:gain"
  });

  assert.equal(result.settlementBreakdown.grossTransferUsd, 130);
  assert.equal(result.settlementBreakdown.principalComponentUsd, 100);
  assert.equal(result.settlementBreakdown.reservedReleaseUsd, 100);
  assert.equal(result.settlementBreakdown.feeAmountUsd, 9);
  assert.equal(result.settlementBreakdown.netTransferUsd, 121);

  const balances = await setup.masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 121);
  assert.equal(balances.reservedBalance, 0);

  const updated = setup.ctx.state.botVaults.find((row) => row.id === setup.botVaultId);
  assert.ok(updated);
  assert.equal(updated?.availableUsd, 0);
  assert.equal(updated?.principalReturned, 100);
  assert.equal(updated?.feePaidTotal, 9);
  assert.equal(updated?.highWaterMark, 30);
});

test("settleFinalClose without profit charges no fee and still releases full reserved", async () => {
  const setup = await setupBotVaultScenario({
    availableUsd: 70,
    realizedPnlNet: -30
  });

  const result = await setup.feeSettlementService.settleFinalClose({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    idempotencyKey: "close:grid_1:loss"
  });

  assert.equal(result.settlementBreakdown.feeAmountUsd, 0);
  assert.equal(result.settlementBreakdown.principalComponentUsd, 70);
  assert.equal(result.settlementBreakdown.reservedReleaseUsd, 100);
  assert.equal(result.settlementBreakdown.netTransferUsd, 70);

  const balances = await setup.masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 70);
  assert.equal(balances.reservedBalance, 0);
});

test("emits vault_fee_settlement_applied log on successful settlement", async () => {
  const testLogger = createTestLogger();
  const setup = await setupBotVaultScenario({
    availableUsd: 130,
    realizedPnlNet: 30,
    logger: testLogger.logger
  });

  await setup.feeSettlementService.settleFinalClose({
    userId: "user_1",
    botVaultId: setup.botVaultId,
    idempotencyKey: "close:grid_1:observability"
  });

  const applied = testLogger.infos.find((entry) => entry.msg === "vault_fee_settlement_applied");
  assert.ok(applied);
  assert.equal(applied?.meta?.mode, "FINAL_CLOSE");
  assert.equal(applied?.meta?.feeAmountUsd, 9);
});
