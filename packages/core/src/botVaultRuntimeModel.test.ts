import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_VAULT_RUNTIME_MODEL_V3,
  BOT_VAULT_RUNTIME_MODEL_V4,
  botVaultRuntimeActionType,
  botVaultRuntimeReasonCode,
  isBotVaultRuntimeModel,
  normalizeBotVaultRuntimeModel,
  resolveBotVaultRuntimeModel
} from "./botVaultRuntimeModel.js";

test("isBotVaultRuntimeModel accepts v3 and v4 runtime model strings", () => {
  assert.equal(isBotVaultRuntimeModel("bot_vault_v3"), true);
  assert.equal(isBotVaultRuntimeModel("bot_vault_v4"), true);
  assert.equal(isBotVaultRuntimeModel("legacy_master"), false);
  assert.equal(isBotVaultRuntimeModel(null), false);
  assert.equal(normalizeBotVaultRuntimeModel("BOT_VAULT_V4"), BOT_VAULT_RUNTIME_MODEL_V4);
});

test("resolveBotVaultRuntimeModel treats legacy v3 rows with v4 contract metadata as v4 runtime", () => {
  assert.equal(
    resolveBotVaultRuntimeModel({
      vaultModel: "bot_vault_v3",
      executionMetadata: { onchainContractVersion: "v4" }
    }),
    BOT_VAULT_RUNTIME_MODEL_V4
  );
  assert.equal(
    resolveBotVaultRuntimeModel({
      vaultModel: "bot_vault_v3",
      executionMetadata: { onchainContractVersion: "v3" }
    }),
    BOT_VAULT_RUNTIME_MODEL_V3
  );
});

test("botVaultRuntimeActionType and reason codes are runtime-specific", () => {
  assert.equal(botVaultRuntimeActionType({ runtimeModel: "bot_vault_v3", action: "create" }), "create_bot_vault_v3");
  assert.equal(botVaultRuntimeActionType({ runtimeModel: "bot_vault_v4", action: "create" }), "create_bot_vault_v4");
  assert.equal(botVaultRuntimeActionType({ action: "create" }), "create_bot_vault_v4");
  assert.equal(botVaultRuntimeActionType({ contractVersion: "v4", action: "fund" }), "fund_bot_vault_v4");
  assert.equal(
    botVaultRuntimeReasonCode({ runtimeModel: "bot_vault_v4", suffix: "funding_requested_not_confirmed" }),
    "bot_vault_v4_funding_requested_not_confirmed"
  );
  assert.equal(
    botVaultRuntimeReasonCode({ suffix: "funding_requested_not_confirmed" }),
    "bot_vault_v4_funding_requested_not_confirmed"
  );
});
