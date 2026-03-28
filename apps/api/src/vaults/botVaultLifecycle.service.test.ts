import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultLifecycleService } from "./botVaultLifecycle.service.js";
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
  templateId: string;
  gridInstanceId: string | null;
  botId: string | null;
  vaultAddress: string | null;
  agentWallet: string | null;
  principalAllocated: number;
  principalReturned: number;
  allocatedUsd: number;
  availableUsd: number;
  status: string;
  matchingStateJson: Record<string, unknown> | null;
  updatedAt: Date;
};

type GridInstanceRow = {
  id: string;
  userId: string;
  templateId: string;
  leverage: number;
  investUsd: number;
  extraMarginUsd: number;
  template: { symbol: string };
  exchangeAccount: { exchange: string };
};

type BotRow = {
  id: string;
  userId: string;
  exchange: string;
  symbol: string;
  futuresConfig: {
    strategyKey: string;
    leverage: number;
  };
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

type LedgerRow = {
  id: string;
  userId: string;
  masterVaultId: string;
  botVaultId: string | null;
  gridInstanceId: string | null;
  entryType: string;
  amountUsd: number;
  sourceType: string;
  sourceKey: string;
  sourceTs: Date | null;
  metadataJson: Record<string, unknown> | null;
  createdAt: Date;
};

function createExecutionOrchestrator(overrides?: Partial<any>) {
  return {
    safeCreateBotExecutionUnit: async () => ({
      ok: true,
      providerKey: "mock",
      data: { providerUnitId: "mock_unit_1", vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    }),
    safeAssignAgent: async () => ({
      ok: true,
      providerKey: "mock",
      data: { agentWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
    }),
    safePause: async () => ({ ok: true, providerKey: "mock", data: { ok: true } }),
    safeStart: async () => ({ ok: true, providerKey: "mock", data: { ok: true } }),
    safeSetCloseOnly: async () => ({ ok: true, providerKey: "mock", data: { ok: true } }),
    safeClose: async () => ({ ok: true, providerKey: "mock", data: { ok: true } }),
    safeGetState: async () => ({
      ok: true,
      providerKey: "mock",
      data: {
        status: "closed",
        equityUsd: null,
        freeUsd: null,
        usedMarginUsd: null,
        positions: [],
        observedAt: new Date().toISOString()
      }
    }),
    ...(overrides ?? {})
  } as any;
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

function createInMemoryDb() {
  const masterVaults: MasterVaultRow[] = [];
  const botVaults: BotVaultRow[] = [];
  const gridInstances: GridInstanceRow[] = [
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
  const bots: BotRow[] = [
    {
      id: "bot_1",
      userId: "user_1",
      exchange: "hyperliquid",
      symbol: "ETHUSDT",
      futuresConfig: {
        strategyKey: "prediction_copier",
        leverage: 5
      }
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
        maxAllocationUsd: 1000000,
        maxLeverage: 125
      }
    ]
  ]);
  const cashEvents: CashEventRow[] = [];
  const ledgers: LedgerRow[] = [];
  let masterSeq = 0;
  let botSeq = 0;
  let cashSeq = 0;
  let ledgerSeq = 0;

  function touchVault(row: MasterVaultRow): MasterVaultRow {
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
    return touchVault(row);
  }

  function applyBotVaultUpdate(row: BotVaultRow, data: Record<string, any>): BotVaultRow {
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
    bot: {
      async findUnique(args: any) {
        const id = String(args?.where?.id ?? "");
        return bots.find((row) => row.id === id) ?? null;
      }
    },
    botVault: {
      async findUnique(args: any) {
        const where = args?.where ?? {};
        if (where.id) return botVaults.find((row) => row.id === where.id) ?? null;
        if (where.gridInstanceId) return botVaults.find((row) => row.gridInstanceId === where.gridInstanceId) ?? null;
        if (where.botId) return botVaults.find((row) => row.botId === where.botId) ?? null;
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
        if (data.gridInstanceId && botVaults.some((row) => row.gridInstanceId === String(data.gridInstanceId))) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        if (data.botId && botVaults.some((row) => row.botId === String(data.botId))) {
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
          gridInstanceId: data.gridInstanceId ? String(data.gridInstanceId) : null,
          botId: data.botId ? String(data.botId) : null,
          vaultAddress: data.vaultAddress ? String(data.vaultAddress) : null,
          agentWallet: data.agentWallet ? String(data.agentWallet) : null,
          principalAllocated: Number(data.principalAllocated ?? 0),
          principalReturned: Number(data.principalReturned ?? 0),
          allocatedUsd: Number(data.allocatedUsd ?? 0),
          availableUsd: Number(data.availableUsd ?? 0),
          status: String(data.status ?? "ACTIVE"),
          matchingStateJson: (data.matchingStateJson ?? null) as Record<string, unknown> | null,
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
    vaultLedgerEntry: {
      async create(args: any) {
        const data = args?.data ?? {};
        const key = String(data.sourceKey ?? "");
        if (ledgers.some((row) => row.sourceKey === key)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        ledgerSeq += 1;
        const row: LedgerRow = {
          id: `ledger_${ledgerSeq}`,
          userId: String(data.userId),
          masterVaultId: String(data.masterVaultId),
          botVaultId: data.botVaultId ? String(data.botVaultId) : null,
          gridInstanceId: data.gridInstanceId ? String(data.gridInstanceId) : null,
          entryType: String(data.entryType),
          amountUsd: Number(data.amountUsd ?? 0),
          sourceType: String(data.sourceType ?? ""),
          sourceKey: key,
          sourceTs: data.sourceTs instanceof Date ? data.sourceTs : null,
          metadataJson: (data.metadataJson ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        ledgers.push(row);
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
      gridInstances,
      bots,
      templates,
      cashEvents,
      ledgers
    }
  };
}

test("create allocates from free to reserved and is idempotent per grid instance", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const first = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 120,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });
  const second = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 120,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  assert.equal(first.id, second.id);
  assert.equal(ctx.state.botVaults.length, 1);
  assert.equal(first.status, "ACTIVE");
  assert.equal(first.principalAllocated, 120);

  const balances = await masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 80);
  assert.equal(balances.reservedBalance, 120);
});

test("createForBot allocates a vault for a new eligible hyperliquid bot", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 250,
    idempotencyKey: "dep:u1:250"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.createForBot({
    userId: "user_1",
    botId: "bot_1",
    allocationUsd: 75,
    idempotencyKey: "bot:bot_1:vault:create:v1"
  });

  assert.equal(created.botId, "bot_1");
  assert.equal(created.gridInstanceId, null);
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.principalAllocated, 75);

  const balances = await masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balances.freeBalance, 175);
  assert.equal(balances.reservedBalance, 75);
});

test("create rejects when free balance is insufficient", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  await assert.rejects(
    lifecycle.create({
      userId: "user_1",
      gridInstanceId: "grid_1",
      allocationUsd: 50,
      idempotencyKey: "grid_instance:grid_1:allocation:v1"
    }),
    /insufficient_free_balance/
  );
});

test("create rejects when allocation exceeds bot template max", async () => {
  const ctx = createInMemoryDb();
  const template = ctx.state.templates.get("legacy_grid_default");
  if (!template) throw new Error("missing_template");
  template.maxAllocationUsd = 60;

  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 500,
    idempotencyKey: "dep:u1:500"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  await assert.rejects(
    lifecycle.create({
      userId: "user_1",
      gridInstanceId: "grid_1",
      allocationUsd: 120,
      idempotencyKey: "grid_instance:grid_1:allocation:max"
    }),
    /risk_allocation_above_maximum/
  );
});

test("create falls back to legacy template when grid template id has no BotTemplate match", async () => {
  const ctx = createInMemoryDb();
  const grid = ctx.state.gridInstances.find((row) => row.id === "grid_1");
  if (!grid) throw new Error("missing_grid_instance");
  grid.templateId = "grid_tpl_without_bot_template";

  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:fallback"
  });

  assert.equal(created.templateId, "legacy_grid_default");
});

test("topUp works on ACTIVE and PAUSED but not CLOSED", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 300,
    idempotencyKey: "dep:u1:300"
  });
  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  let row = await lifecycle.topUp({
    userId: "user_1",
    botVaultId: String(created.id),
    amountUsd: 20,
    idempotencyKey: "grid_instance:grid_1:topup:1"
  });
  assert.equal(row.principalAllocated, 120);

  row = await lifecycle.pause({
    userId: "user_1",
    botVaultId: String(created.id)
  });
  assert.equal(row.status, "PAUSED");

  row = await lifecycle.topUp({
    userId: "user_1",
    botVaultId: String(created.id),
    amountUsd: 10,
    idempotencyKey: "grid_instance:grid_1:topup:2"
  });
  assert.equal(row.principalAllocated, 130);

  await lifecycle.setCloseOnly({
    userId: "user_1",
    botVaultId: String(created.id)
  });
  await lifecycle.close({
    userId: "user_1",
    botVaultId: String(created.id),
    idempotencyKey: "grid_instance:grid_1:close:v1"
  });

  await assert.rejects(
    lifecycle.topUp({
      userId: "user_1",
      botVaultId: String(created.id),
      amountUsd: 5,
      idempotencyKey: "grid_instance:grid_1:topup:3"
    }),
    /bot_vault_already_closed/
  );
});

test("pause and activate enforce status machine", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  const paused = await lifecycle.pause({ userId: "user_1", botVaultId: String(created.id) });
  assert.equal(paused.status, "PAUSED");
  assert.equal((paused as any).executionStatus, "paused");
  assert.equal((paused as any).executionMetadata?.lifecycle?.state, "paused");

  const pausedAgain = await lifecycle.pause({ userId: "user_1", botVaultId: String(created.id) });
  assert.equal(pausedAgain.status, "PAUSED");

  const active = await lifecycle.activate({ userId: "user_1", botVaultId: String(created.id) });
  assert.equal(active.status, "ACTIVE");
  assert.equal((active as any).executionStatus, "running");
  assert.equal((active as any).executionMetadata?.lifecycle?.state, "execution_active");
});

test("stop flattens execution and remains restartable", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200:stop"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:stop"
  });

  const stopped = await lifecycle.stop({ userId: "user_1", botVaultId: String(created.id) });
  assert.equal(stopped.status, "STOPPED");
  assert.equal((stopped as any).executionStatus, "closed");
  assert.equal((stopped as any).executionMetadata?.lifecycle?.state, "paused");
  assert.equal((stopped as any).executionMetadata?.lifecycleTransition?.action, "stop");

  const resumed = await lifecycle.activate({ userId: "user_1", botVaultId: String(created.id) });
  assert.equal(resumed.status, "ACTIVE");
  assert.equal((resumed as any).executionStatus, "running");
  assert.equal((resumed as any).executionMetadata?.lifecycle?.state, "execution_active");
});

test("activate starts a freshly created ACTIVE bot vault that is still in bot_activation", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200:bot_activation"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:bot_activation"
  });

  assert.equal(created.status, "ACTIVE");
  assert.equal((created as any).executionMetadata?.lifecycle?.state, "bot_activation");

  const activated = await lifecycle.activate({
    userId: "user_1",
    botVaultId: String(created.id)
  });

  assert.equal(activated.status, "ACTIVE");
  assert.equal((activated as any).executionStatus, "running");
  assert.equal((activated as any).executionMetadata?.lifecycle?.state, "execution_active");
});

test("activate blocks on risk policy leverage breach", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  await lifecycle.pause({ userId: "user_1", botVaultId: String(created.id) });

  const template = ctx.state.templates.get("legacy_grid_default");
  if (!template) throw new Error("missing_template");
  template.maxLeverage = 2;

  await assert.rejects(
    lifecycle.activate({ userId: "user_1", botVaultId: String(created.id) }),
    /risk_leverage_above_template_max/
  );
});

test("close requires CLOSE_ONLY unless forceClose is used", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  await assert.rejects(
    lifecycle.close({
      userId: "user_1",
      botVaultId: String(created.id),
      idempotencyKey: "grid_instance:grid_1:close:v1"
    }),
    /risk_invalid_status_transition/
  );

  const row = ctx.state.botVaults.find((entry) => String(entry.id) === String(created.id));
  if (!row) throw new Error("missing_bot_vault");
  row.status = "ERROR";

  const forced = await lifecycle.close({
    userId: "user_1",
    botVaultId: String(created.id),
    idempotencyKey: "grid_instance:grid_1:close:v1:force",
    forceClose: true
  });
  assert.equal(forced.status, "CLOSED");
  assert.equal((forced as any).executionMetadata?.lifecycle?.state, "closed");
  assert.equal((forced as any).executionMetadata?.lifecycleTransition?.action, "close_complete");
});

test("close settles profit and loss correctly", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 300,
    idempotencyKey: "dep:u1:300"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator()
  });

  const win = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });
  const winRow = ctx.state.botVaults.find((row) => row.id === String(win.id));
  if (!winRow) throw new Error("missing_win_row");
  winRow.availableUsd = 130;

  await lifecycle.setCloseOnly({ userId: "user_1", botVaultId: String(win.id) });
  await lifecycle.close({
    userId: "user_1",
    botVaultId: String(win.id),
    idempotencyKey: "grid_instance:grid_1:close:win"
  });

  const balancesAfterWin = await masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balancesAfterWin.reservedBalance, 0);
  assert.equal(balancesAfterWin.freeBalance, 330);

  // New instance for loss settlement
  ctx.state.gridInstances.push({
    id: "grid_2",
    userId: "user_1",
    templateId: "legacy_grid_default",
    leverage: 3,
    investUsd: 100,
    extraMarginUsd: 0,
    template: { symbol: "ETHUSDT" },
    exchangeAccount: { exchange: "hyperliquid" }
  });

  const loss = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_2",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_2:allocation:v1"
  });
  const lossRow = ctx.state.botVaults.find((row) => row.id === String(loss.id));
  if (!lossRow) throw new Error("missing_loss_row");
  lossRow.availableUsd = 70;

  await lifecycle.setCloseOnly({ userId: "user_1", botVaultId: String(loss.id) });
  await lifecycle.close({
    userId: "user_1",
    botVaultId: String(loss.id),
    idempotencyKey: "grid_instance:grid_2:close:loss"
  });

  const balancesAfterLoss = await masterVaultService.getBalances({ userId: "user_1" });
  assert.equal(balancesAfterLoss.reservedBalance, 0);
  assert.equal(balancesAfterLoss.freeBalance, 300);
});

test("close blocks when provider state is unavailable unless forceClose", async () => {
  const ctx = createInMemoryDb();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator({
      safeGetState: async () => ({ ok: false, providerKey: "mock", reason: "state_unavailable" })
    })
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:v1"
  });

  await lifecycle.setCloseOnly({ userId: "user_1", botVaultId: String(created.id) });

  await assert.rejects(
    lifecycle.close({
      userId: "user_1",
      botVaultId: String(created.id),
      idempotencyKey: "grid_instance:grid_1:close:v1"
    }),
    /execution_state_unavailable_for_close/
  );

  const closed = await lifecycle.close({
    userId: "user_1",
    botVaultId: String(created.id),
    idempotencyKey: "grid_instance:grid_1:close:v1:force",
    forceClose: true
  });
  assert.equal(closed.status, "CLOSED");
});

test("emits lifecycle transition logs for success and rejected transition", async () => {
  const ctx = createInMemoryDb();
  const testLogger = createTestLogger();
  const masterVaultService = createMasterVaultService(ctx.db);
  await masterVaultService.deposit({
    userId: "user_1",
    amountUsd: 200,
    idempotencyKey: "dep:u1:200"
  });

  const lifecycle = createBotVaultLifecycleService(ctx.db, {
    masterVaultService,
    executionOrchestrator: createExecutionOrchestrator(),
    logger: testLogger.logger
  });

  const created = await lifecycle.create({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocationUsd: 100,
    idempotencyKey: "grid_instance:grid_1:allocation:logs"
  });
  await lifecycle.pause({
    userId: "user_1",
    botVaultId: String(created.id)
  });

  await assert.rejects(
    lifecycle.close({
      userId: "user_1",
      botVaultId: String(created.id),
      idempotencyKey: "grid_instance:grid_1:close:logs"
    }),
    /risk_invalid_status_transition/
  );

  const transitionEvents = testLogger.infos.filter((entry) => entry.msg === "vault_lifecycle_transition");
  const rejectedEvents = testLogger.warns.filter((entry) => entry.msg === "vault_lifecycle_transition_rejected");
  assert.equal(transitionEvents.length >= 2, true);
  assert.equal(rejectedEvents.length >= 1, true);
  assert.equal(rejectedEvents.at(-1)?.meta?.requestedToStatus, "CLOSED");
});
