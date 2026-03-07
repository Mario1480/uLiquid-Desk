import assert from "node:assert/strict";
import test from "node:test";
import { createMockExecutionProvider } from "./executionProvider.mock.js";

test("mock execution provider returns deterministic stub values", async () => {
  const provider = createMockExecutionProvider();

  const userVault = await provider.createUserVault({
    userId: "user_1",
    masterVaultId: "master_1"
  });
  assert.equal(provider.key, "mock");
  assert.equal(typeof userVault.providerVaultId, "string");
  assert.equal(typeof userVault.vaultAddress, "string");

  const unit = await provider.createBotExecutionUnit({
    userId: "user_1",
    botVaultId: "bot_vault_1",
    masterVaultId: "master_1",
    templateId: "legacy_grid_default",
    gridInstanceId: "grid_1",
    symbol: "BTCUSDT",
    exchange: "hyperliquid"
  });
  assert.equal(typeof unit.providerUnitId, "string");
  assert.equal(typeof unit.vaultAddress, "string");

  const assignedFromHint = await provider.assignAgent({
    userId: "user_1",
    botVaultId: "bot_vault_1",
    agentWalletHint: "0x1111111111111111111111111111111111111111"
  });
  assert.equal(assignedFromHint.agentWallet, "0x1111111111111111111111111111111111111111");

  const assignedWithoutHint = await provider.assignAgent({
    userId: "user_1",
    botVaultId: "bot_vault_1"
  });
  assert.equal(assignedWithoutHint.agentWallet, null);

  assert.deepEqual(await provider.startBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" }), { ok: true });
  assert.deepEqual(await provider.pauseBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" }), { ok: true });
  assert.deepEqual(await provider.setBotCloseOnly({ userId: "user_1", botVaultId: "bot_vault_1" }), { ok: true });
  assert.deepEqual(await provider.closeBotExecution({ userId: "user_1", botVaultId: "bot_vault_1" }), { ok: true });

  const state = await provider.getBotExecutionState({ userId: "user_1", botVaultId: "bot_vault_1" });
  assert.equal(state.status, "created");
  assert.equal(state.providerMetadata?.mode, "mock");
  assert.deepEqual(state.positions, []);
});
