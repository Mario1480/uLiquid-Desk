import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionProviderOrchestrator } from "./executionProvider.orchestrator.js";
import type { ExecutionProvider } from "./executionProvider.types.js";

test("execution orchestrator is fail-open and persists provider error metadata", async () => {
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const gridUpdates: any[] = [];

  const provider: ExecutionProvider = {
    key: "mock",
    async createUserVault() {
      return { providerVaultId: "mock_user" };
    },
    async createBotExecutionUnit() {
      return { providerUnitId: "mock_unit" };
    },
    async assignAgent() {
      return { agentWallet: null };
    },
    async startBotExecution() {
      throw new Error("provider_start_failed");
    },
    async pauseBotExecution() {
      return { ok: true };
    },
    async setBotCloseOnly() {
      return { ok: true };
    },
    async closeBotExecution() {
      return { ok: true };
    },
    async getBotExecutionState() {
      return {
        status: "created",
        equityUsd: null,
        freeUsd: null,
        usedMarginUsd: null,
        positions: [],
        observedAt: new Date().toISOString()
      };
    }
  };

  const db = {
    botVault: {
      async findUnique() {
        return { gridInstanceId: "grid_1" };
      }
    },
    gridBotInstance: {
      async findUnique() {
        return { id: "grid_1", stateJson: { existing: true } };
      },
      async update(args: any) {
        gridUpdates.push(args);
        return args;
      }
    }
  };

  const orchestrator = new ExecutionProviderOrchestrator({
    db,
    provider,
    logger: {
      warn(msg, meta) {
        warns.push({ msg, meta });
      }
    }
  });

  const result = await orchestrator.safeStart({
    userId: "user_1",
    botVaultId: "bot_vault_1"
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /provider_start_failed/i);
  }

  assert.equal(gridUpdates.length, 1);
  assert.equal(gridUpdates[0]?.where?.id, "grid_1");
  assert.equal(gridUpdates[0]?.data?.stateJson?.existing, true);
  assert.equal(gridUpdates[0]?.data?.stateJson?.executionProvider?.providerKey, "mock");
  assert.equal(gridUpdates[0]?.data?.stateJson?.executionProvider?.action, "startBotExecution");
  assert.equal(typeof gridUpdates[0]?.data?.stateJson?.executionProvider?.lastErrorAt, "string");

  assert.equal(warns.some((entry) => entry.msg === "vault_execution_provider_error"), true);
});

test("execution orchestrator returns provider payload on success", async () => {
  const provider: ExecutionProvider = {
    key: "mock",
    async createUserVault() {
      return { providerVaultId: "ok" };
    },
    async createBotExecutionUnit() {
      return { providerUnitId: "ok" };
    },
    async assignAgent() {
      return { agentWallet: null };
    },
    async startBotExecution() {
      return { ok: true };
    },
    async pauseBotExecution() {
      return { ok: true };
    },
    async setBotCloseOnly() {
      return { ok: true };
    },
    async closeBotExecution() {
      return { ok: true };
    },
    async getBotExecutionState() {
      return {
        status: "running",
        equityUsd: 100,
        freeUsd: 50,
        usedMarginUsd: 50,
        positions: [],
        observedAt: new Date().toISOString()
      };
    }
  };

  const orchestrator = new ExecutionProviderOrchestrator({
    db: {
      botVault: { findUnique: async () => null },
      gridBotInstance: {
        findUnique: async () => null,
        update: async () => null
      }
    },
    provider,
    logger: { warn: () => {} }
  });

  const result = await orchestrator.safeGetState({
    userId: "user_1",
    botVaultId: "bot_vault_1"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.status, "running");
    assert.equal(result.providerKey, "mock");
  }
});
