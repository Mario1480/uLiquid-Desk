import assert from "node:assert/strict";
import test from "node:test";
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

type CashEventRow = {
  id: string;
  masterVaultId: string;
  botVaultId: string | null;
  eventType: string;
  amount: number;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

function createInMemoryDb() {
  const masterVaults: MasterVaultRow[] = [];
  const cashEvents: CashEventRow[] = [];
  let vaultSeq = 0;
  let cashSeq = 0;

  function touch(row: MasterVaultRow): MasterVaultRow {
    row.updatedAt = new Date();
    return row;
  }

  function applyMasterVaultUpdate(row: MasterVaultRow, data: Record<string, any>): MasterVaultRow {
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
    return touch(row);
  }

  const tx = {
    masterVault: {
      async findUnique(args: any) {
        const where = args?.where ?? {};
        if (where.userId) {
          return masterVaults.find((row) => row.userId === where.userId) ?? null;
        }
        if (where.id) {
          return masterVaults.find((row) => row.id === where.id) ?? null;
        }
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
        vaultSeq += 1;
        const now = new Date();
        const row: MasterVaultRow = {
          id: `mv_${vaultSeq}`,
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
          masterVaultId: String(data.masterVaultId),
          botVaultId: data.botVaultId ? String(data.botVaultId) : null,
          eventType: String(data.eventType),
          amount: Number(data.amount ?? 0),
          idempotencyKey: key,
          metadata: (data.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        cashEvents.push(row);
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
      cashEvents
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

test("ensureMasterVault creates exactly once per user", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  const first = await service.ensureMasterVault({ userId: "user_1" });
  const second = await service.ensureMasterVault({ userId: "user_1" });

  assert.equal(first.id, second.id);
  assert.equal(ctx.state.masterVaults.length, 1);
});

test("deposit updates balances and is idempotent by idempotencyKey", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  const afterFirst = await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });
  const afterDuplicate = await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });

  assert.equal(afterFirst.freeBalance, 100);
  assert.equal(afterFirst.totalDeposited, 100);
  assert.equal(afterFirst.availableUsd, 100);
  assert.equal(afterDuplicate.freeBalance, 100);
  assert.equal(ctx.state.cashEvents.length, 1);
  assert.equal(ctx.state.cashEvents[0]?.eventType, "DEPOSIT");
});

test("reserveForBotVault moves free to reserved and enforces strict free balance", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  await service.deposit({
    userId: "user_1",
    amountUsd: 50,
    idempotencyKey: "deposit:u1:50"
  });

  const balances = await service.reserveForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    amountUsd: 30,
    idempotencyKey: "reserve:u1:bv1:30"
  });

  assert.equal(balances.freeBalance, 20);
  assert.equal(balances.reservedBalance, 30);
  assert.equal(balances.totalAllocatedUsd, 30);
  assert.equal(balances.availableUsd, 50);

  await assert.rejects(
    service.reserveForBotVault({
      userId: "user_1",
      botVaultId: "bv_1",
      amountUsd: 25,
      idempotencyKey: "reserve:u1:bv1:25"
    }),
    /insufficient_free_balance/
  );
});

test("releaseFromBotVault credits free balance and enforces reserved guard", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });
  await service.reserveForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    amountUsd: 60,
    idempotencyKey: "reserve:u1:bv1:60"
  });

  const balances = await service.releaseFromBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    releasedReservedUsd: 10,
    profitUsd: 5,
    idempotencyKey: "release:u1:bv1:10:5"
  });

  assert.equal(balances.freeBalance, 55);
  assert.equal(balances.reservedBalance, 50);
  assert.equal(balances.availableUsd, 115);

  await assert.rejects(
    service.releaseFromBotVault({
      userId: "user_1",
      botVaultId: "bv_1",
      releasedReservedUsd: 100,
      profitUsd: 0,
      idempotencyKey: "release:u1:bv1:100:0"
    }),
    /insufficient_reserved_balance/
  );
});

test("settleFromBotVault supports loss settlement and idempotency", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });
  await service.reserveForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    amountUsd: 60,
    idempotencyKey: "reserve:u1:bv1:60"
  });

  const settled = await service.settleFromBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    releasedReservedUsd: 60,
    returnedToFreeUsd: 45,
    idempotencyKey: "settle:u1:bv1:60:45"
  });
  const duplicate = await service.settleFromBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    releasedReservedUsd: 60,
    returnedToFreeUsd: 45,
    idempotencyKey: "settle:u1:bv1:60:45"
  });

  assert.equal(settled.freeBalance, 85);
  assert.equal(settled.reservedBalance, 0);
  assert.equal(settled.availableUsd, 145);
  assert.equal(duplicate.freeBalance, 85);
  assert.equal(duplicate.reservedBalance, 0);

  const settlementEvents = ctx.state.cashEvents.filter((event) => event.idempotencyKey === "settle:u1:bv1:60:45");
  assert.equal(settlementEvents.length, 1);
  assert.equal(settlementEvents[0]?.eventType, "RETURN_FROM_BOT");
  assert.equal(settlementEvents[0]?.amount, 45);
});

test("withdraw validates free-only and preserves reserved balance", async () => {
  const ctx = createInMemoryDb();
  const service = createMasterVaultService(ctx.db);

  await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });
  await service.reserveForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    amountUsd: 90,
    idempotencyKey: "reserve:u1:bv1:90"
  });

  const valid = await service.validateWithdraw({ userId: "user_1", amountUsd: 10 });
  const invalid = await service.validateWithdraw({ userId: "user_1", amountUsd: 11 });
  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "insufficient_free_balance");

  const afterWithdraw = await service.withdraw({
    userId: "user_1",
    amountUsd: 10,
    idempotencyKey: "withdraw:u1:10"
  });
  const afterWithdrawDuplicate = await service.withdraw({
    userId: "user_1",
    amountUsd: 10,
    idempotencyKey: "withdraw:u1:10"
  });

  assert.equal(afterWithdraw.freeBalance, 0);
  assert.equal(afterWithdraw.reservedBalance, 90);
  assert.equal(afterWithdraw.totalWithdrawn, 10);
  assert.equal(afterWithdraw.totalWithdrawnUsd, 10);
  assert.equal(afterWithdraw.availableUsd, 90);
  assert.equal(afterWithdrawDuplicate.freeBalance, 0);

  await assert.rejects(
    service.withdraw({
      userId: "user_1",
      amountUsd: 1,
      idempotencyKey: "withdraw:u1:1"
    }),
    /insufficient_free_balance/
  );
});

test("emits vault_master_balance_change logs for successful operations", async () => {
  const ctx = createInMemoryDb();
  const testLogger = createTestLogger();
  const service = createMasterVaultService(ctx.db, { logger: testLogger.logger });

  await service.deposit({
    userId: "user_1",
    amountUsd: 100,
    idempotencyKey: "deposit:u1:100"
  });
  await service.reserveForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    amountUsd: 40,
    idempotencyKey: "reserve:u1:bv_1:40"
  });
  await service.withdraw({
    userId: "user_1",
    amountUsd: 10,
    idempotencyKey: "withdraw:u1:10"
  });

  const balanceEvents = testLogger.infos.filter((entry) => entry.msg === "vault_master_balance_change");
  assert.equal(balanceEvents.length, 3);
  assert.equal(balanceEvents[0]?.meta?.operation, "deposit");
  assert.equal(balanceEvents[1]?.meta?.operation, "reserve");
  assert.equal(balanceEvents[2]?.meta?.operation, "withdraw");
});
