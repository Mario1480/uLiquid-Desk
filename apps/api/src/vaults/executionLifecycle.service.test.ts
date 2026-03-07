import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionLifecycleService } from "./executionLifecycle.service.js";

type BotVaultRow = {
  id: string;
  userId: string;
  masterVaultId: string;
  templateId: string;
  gridInstanceId: string;
  vaultAddress: string | null;
  agentWallet: string | null;
  executionProvider: string | null;
  executionUnitId: string | null;
  executionStatus: string | null;
  executionLastSyncedAt: Date | null;
  executionLastError: string | null;
  executionLastErrorAt: Date | null;
  executionMetadata: Record<string, unknown> | null;
};

type GridInstanceRow = {
  id: string;
  templateId: string;
  leverage: number;
  botId: string | null;
  template: { symbol: string };
  exchangeAccount: { exchange: string };
};

type ExecutionEventRow = {
  id: string;
  userId: string;
  botVaultId: string;
  gridInstanceId: string | null;
  botId: string | null;
  providerKey: string | null;
  executionUnitId: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  result: string;
  reason: string | null;
  sourceKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

function createInMemoryDb() {
  const botVaults: BotVaultRow[] = [
    {
      id: "bv_1",
      userId: "user_1",
      masterVaultId: "mv_1",
      templateId: "legacy_grid_default",
      gridInstanceId: "grid_1",
      vaultAddress: null,
      agentWallet: null,
      executionProvider: null,
      executionUnitId: null,
      executionStatus: "created",
      executionLastSyncedAt: null,
      executionLastError: null,
      executionLastErrorAt: null,
      executionMetadata: null
    },
    {
      id: "bv_2",
      userId: "user_1",
      masterVaultId: "mv_1",
      templateId: "legacy_grid_default",
      gridInstanceId: "grid_2",
      vaultAddress: null,
      agentWallet: null,
      executionProvider: null,
      executionUnitId: null,
      executionStatus: "created",
      executionLastSyncedAt: null,
      executionLastError: null,
      executionLastErrorAt: null,
      executionMetadata: null
    }
  ];

  const gridInstances: GridInstanceRow[] = [
    {
      id: "grid_1",
      templateId: "legacy_grid_default",
      leverage: 3,
      botId: "bot_1",
      template: { symbol: "BTCUSDT" },
      exchangeAccount: { exchange: "hyperliquid" }
    },
    {
      id: "grid_2",
      templateId: "legacy_grid_default",
      leverage: 3,
      botId: "bot_2",
      template: { symbol: "ETHUSDT" },
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
        maxAllocationUsd: 1000000,
        maxLeverage: 125
      }
    ]
  ]);

  const executionEvents: ExecutionEventRow[] = [];
  const runtimeRows: Array<{ botId: string; status: string; reason: string }> = [];
  let eventSeq = 0;

  function applyUpdate(row: BotVaultRow, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      (row as any)[key] = value;
    }
    return row;
  }

  const tx = {
    botVault: {
      async findFirst(args: any) {
        const where = args?.where ?? {};
        return botVaults.find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.userId && row.userId !== where.userId) return false;
          if (where.gridInstanceId && row.gridInstanceId !== where.gridInstanceId) return false;
          return true;
        }) ?? null;
      },
      async findUnique(args: any) {
        const where = args?.where ?? {};
        if (where.id) return botVaults.find((row) => row.id === where.id) ?? null;
        if (where.gridInstanceId) return botVaults.find((row) => row.gridInstanceId === where.gridInstanceId) ?? null;
        return null;
      },
      async update(args: any) {
        const id = String(args?.where?.id ?? "");
        const row = botVaults.find((entry) => entry.id === id);
        if (!row) throw new Error("bot_vault_not_found");
        return applyUpdate(row, args?.data ?? {});
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
    botRuntime: {
      async upsert(args: any) {
        const botId = String(args?.where?.botId ?? "");
        const existing = runtimeRows.find((row) => row.botId === botId);
        if (existing) {
          existing.status = String(args?.update?.status ?? existing.status);
          existing.reason = String(args?.update?.reason ?? existing.reason);
          return existing;
        }
        const created = {
          botId,
          status: String(args?.create?.status ?? ""),
          reason: String(args?.create?.reason ?? "")
        };
        runtimeRows.push(created);
        return created;
      }
    },
    botExecutionEvent: {
      async findUnique(args: any) {
        const sourceKey = String(args?.where?.sourceKey ?? "");
        return executionEvents.find((row) => row.sourceKey === sourceKey) ?? null;
      },
      async create(args: any) {
        const data = args?.data ?? {};
        const sourceKey = String(data.sourceKey ?? "");
        if (executionEvents.some((row) => row.sourceKey === sourceKey)) {
          const error: any = new Error("unique");
          error.code = "P2002";
          throw error;
        }
        eventSeq += 1;
        const row: ExecutionEventRow = {
          id: `ev_${eventSeq}`,
          userId: String(data.userId),
          botVaultId: String(data.botVaultId),
          gridInstanceId: data.gridInstanceId ? String(data.gridInstanceId) : null,
          botId: data.botId ? String(data.botId) : null,
          providerKey: data.providerKey ? String(data.providerKey) : null,
          executionUnitId: data.executionUnitId ? String(data.executionUnitId) : null,
          action: String(data.action),
          fromStatus: data.fromStatus ? String(data.fromStatus) : null,
          toStatus: data.toStatus ? String(data.toStatus) : null,
          result: String(data.result),
          reason: data.reason ? String(data.reason) : null,
          sourceKey,
          metadata: (data.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date()
        };
        executionEvents.push(row);
        return row;
      },
      async findMany(args: any) {
        const where = args?.where ?? {};
        const take = Number(args?.take ?? 200);
        return executionEvents
          .filter((row) => row.botVaultId === where.botVaultId)
          .slice(-take)
          .reverse();
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
      botVaults,
      gridInstances,
      templates,
      executionEvents,
      runtimeRows
    }
  };
}

test("provisionIdentityForBotVault persists provider identity idempotent", async () => {
  const ctx = createInMemoryDb();
  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safeCreateBotExecutionUnit: async () => ({
        ok: true,
        providerKey: "mock",
        data: {
          providerUnitId: "unit_1",
          vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      })
    } as any
  });

  const first = await lifecycle.provisionIdentityForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:provision"
  });
  const second = await lifecycle.provisionIdentityForBotVault({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:provision"
  });

  assert.equal(first.executionUnitId, "unit_1");
  assert.equal(first.executionProvider, "mock");
  assert.equal(second.executionUnitId, "unit_1");
  assert.equal(ctx.state.executionEvents.length, 1);
  assert.equal(ctx.state.executionEvents[0]?.action, "provision_identity");
});

test("assignAgentWallet updates botVault and logs event", async () => {
  const ctx = createInMemoryDb();
  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safeAssignAgent: async () => ({
        ok: true,
        providerKey: "mock",
        data: {
          agentWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      })
    } as any
  });

  const row = await lifecycle.assignAgentWallet({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:assign_agent",
    agentWalletHint: null
  });

  assert.equal(row.agentWallet, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(ctx.state.executionEvents.length, 1);
  assert.equal(ctx.state.executionEvents[0]?.action, "assign_agent");
});

test("startExecution is fail-open on provider error but still starts process", async () => {
  const ctx = createInMemoryDb();
  const enqueued: string[] = [];

  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safeStart: async () => ({
        ok: false,
        providerKey: "mock",
        reason: "provider_start_failed"
      })
    } as any,
    processControl: {
      enqueueBotRun: async (botId: string) => {
        enqueued.push(botId);
      }
    }
  });

  const row = await lifecycle.startExecution({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:start"
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0], "bot_1");
  assert.equal(row.executionStatus, "running");
  assert.match(String(row.executionLastError ?? ""), /provider_start_failed/i);
  assert.equal(ctx.state.runtimeRows[0]?.status, "running");
  assert.equal(ctx.state.executionEvents[0]?.result, "failed");
});

test("startExecution blocks when risk policy fails", async () => {
  const ctx = createInMemoryDb();
  const template = ctx.state.templates.get("legacy_grid_default");
  if (!template) throw new Error("missing_template");
  template.maxLeverage = 2;

  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safeStart: async () => ({ ok: true, providerKey: "mock", data: { ok: true } })
    } as any,
    processControl: {
      enqueueBotRun: async () => {
        throw new Error("enqueue_should_not_run_when_risk_fails");
      }
    }
  });

  await assert.rejects(
    lifecycle.startExecution({
      userId: "user_1",
      botVaultId: "bv_1",
      sourceKey: "exec:bv_1:start:risk"
    }),
    /risk_leverage_above_template_max/
  );
});

test("pause/close stop process and keep bot vaults isolated", async () => {
  const ctx = createInMemoryDb();
  const cancelled: string[] = [];
  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safePause: async () => ({ ok: true, providerKey: "mock", data: { ok: true } }),
      safeClose: async () => ({ ok: true, providerKey: "mock", data: { ok: true } })
    } as any,
    processControl: {
      cancelBotRun: async (botId: string) => {
        cancelled.push(botId);
      }
    }
  });

  await lifecycle.pauseExecution({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:pause"
  });
  await lifecycle.closeExecution({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:close"
  });

  const first = ctx.state.botVaults.find((row) => row.id === "bv_1");
  const second = ctx.state.botVaults.find((row) => row.id === "bv_2");
  assert.equal(first?.executionStatus, "closed");
  assert.equal(second?.executionStatus, "created");
  assert.equal(cancelled.includes("bot_1"), true);
  assert.equal(cancelled.includes("bot_2"), false);
});

test("listExecutionEvents enforces ownership", async () => {
  const ctx = createInMemoryDb();
  const lifecycle = createExecutionLifecycleService(ctx.db, {
    executionOrchestrator: {
      safeSetCloseOnly: async () => ({ ok: true, providerKey: "mock", data: { ok: true } })
    } as any
  });

  await lifecycle.setCloseOnly({
    userId: "user_1",
    botVaultId: "bv_1",
    sourceKey: "exec:bv_1:close_only"
  });

  const own = await lifecycle.listExecutionEvents({
    userId: "user_1",
    botVaultId: "bv_1"
  });
  const foreign = await lifecycle.listExecutionEvents({
    userId: "user_2",
    botVaultId: "bv_1"
  });

  assert.equal(own.length, 1);
  assert.equal(foreign.length, 0);
});
