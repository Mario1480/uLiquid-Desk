import assert from "node:assert/strict";
import test from "node:test";
import { createHyperliquidDemoExecutionProvider } from "./executionProvider.hyperliquidDemo.js";

function createBotVaultDb() {
  const row = {
    id: "bot_vault_1",
    userId: "user_1",
    masterVaultId: "master_1",
    templateId: "legacy_grid_default",
    gridInstanceId: "grid_1",
    vaultAddress: null as string | null,
    agentWallet: null as string | null,
    executionStatus: "created",
    executionMetadata: null as Record<string, unknown> | null,
    availableUsd: 80,
    principalAllocated: 120,
    principalReturned: 0
  };

  return {
    row,
    db: {
      botVault: {
        async findFirst(args: any) {
          if (args?.where?.id === row.id && args?.where?.userId === row.userId) return { ...row };
          return null;
        },
        async findUnique(args: any) {
          if (args?.where?.id !== row.id) return null;
          return { ...row };
        },
        async update(args: any) {
          const data = args?.data ?? {};
          if (data.executionMetadata !== undefined) row.executionMetadata = data.executionMetadata;
          if (data.vaultAddress !== undefined) row.vaultAddress = data.vaultAddress;
          if (data.agentWallet !== undefined) row.agentWallet = data.agentWallet;
          if (data.executionStatus !== undefined) row.executionStatus = data.executionStatus;
          return { ...row };
        }
      }
    }
  };
}

test("hyperliquid demo execution provider persists simulated state transitions", async () => {
  const { db, row } = createBotVaultDb();
  const provider = createHyperliquidDemoExecutionProvider({ db });

  assert.equal(provider.key, "hyperliquid_demo");

  const unit = await provider.createBotExecutionUnit({
    userId: "user_1",
    botVaultId: "bot_vault_1",
    masterVaultId: "master_1",
    templateId: "legacy_grid_default",
    gridInstanceId: "grid_1",
    symbol: "BTCUSDT",
    exchange: "paper"
  });
  assert.equal(typeof unit.providerUnitId, "string");
  assert.equal(typeof unit.vaultAddress, "string");

  const agent = await provider.assignAgent({
    userId: "user_1",
    botVaultId: "bot_vault_1"
  });
  assert.match(String(agent.agentWallet), /^0x[a-f0-9]{40}$/);

  await provider.startBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" });
  await provider.setBotCloseOnly({ userId: "user_1", botVaultId: "bot_vault_1" });
  await provider.pauseBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" });
  await provider.closeBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" });

  const state = await provider.getBotExecutionState({ userId: "user_1", botVaultId: "bot_vault_1" });
  assert.equal(state.status, "closed");
  assert.equal(state.providerMetadata?.providerMode, "demo");
  assert.equal(state.providerMetadata?.chain, "hyperevm");
  assert.equal(state.providerMetadata?.marketDataExchange, "hyperliquid");
  assert.equal(typeof state.providerMetadata?.vaultAddress, "string");
  assert.equal(typeof state.providerMetadata?.agentWallet, "string");
  assert.equal(state.usedMarginUsd, 40);
  assert.equal(state.equityUsd, 120);
  assert.equal(state.freeUsd, 80);
  assert.deepEqual(state.positions, []);

  const providerState = (row.executionMetadata as any)?.providerState;
  assert.equal(providerState?.status, "closed");
  assert.equal(providerState?.lastAction, "closeBotExecution");
});
