import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidFuturesAdapter } from "@mm/futures-exchange";
import { encryptSecret } from "../secret-crypto.js";
import { createHyperliquidExecutionProvider } from "./executionProvider.hyperliquid.js";

function createDb() {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const row: any = {
    id: "bot_vault_1",
    userId: "user_1",
    gridInstanceId: "grid_1",
    executionStatus: "created",
    executionMetadata: {},
    vaultAddress: null,
    agentWallet: null,
    gridInstance: {
      exchangeAccount: {
        id: "acc_hl_1",
        exchange: "hyperliquid",
        apiKeyEnc: encryptSecret("0x1111111111111111111111111111111111111111"),
        apiSecretEnc: encryptSecret("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        passphraseEnc: encryptSecret("0x2222222222222222222222222222222222222222")
      }
    }
  };

  return {
    botVault: {
      async findUnique() {
        return {
          executionMetadata: row.executionMetadata,
          executionStatus: row.executionStatus,
          vaultAddress: row.vaultAddress,
          agentWallet: row.agentWallet
        };
      },
      async findFirst() {
        return row;
      },
      async update(args: any) {
        row.executionMetadata = args.data.executionMetadata ?? row.executionMetadata;
        return row;
      }
    },
    exchangeAccount: {
      async findFirst() {
        return row.gridInstance.exchangeAccount;
      }
    },
    globalSetting: {
      async findUnique() {
        return null;
      }
    }
  } as any;
}

function createGlobalDb() {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const row: any = {
    id: "bot_vault_global_1",
    userId: "user_1",
    gridInstanceId: "grid_1",
    executionStatus: "created",
    executionMetadata: {},
    vaultAddress: null,
    agentWallet: null,
    gridInstance: {
      exchangeAccount: null
    }
  };
  return {
    botVault: {
      async findUnique() {
        return {
          executionMetadata: row.executionMetadata,
          executionStatus: row.executionStatus,
          vaultAddress: row.vaultAddress,
          agentWallet: row.agentWallet
        };
      },
      async findFirst() {
        return row;
      },
      async update(args: any) {
        row.executionMetadata = args.data.executionMetadata ?? row.executionMetadata;
        return row;
      }
    },
    exchangeAccount: {
      async findFirst() {
        return null;
      }
    },
    globalSetting: {
      async findUnique() {
        return {
          value: {
            enabled: true,
            apiKeyEnc: encryptSecret("0x4444444444444444444444444444444444444444"),
            apiSecretEnc: encryptSecret("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            vaultAddressEnc: encryptSecret("0x5555555555555555555555555555555555555555")
          },
          updatedAt: new Date("2026-03-11T10:00:00.000Z")
        };
      }
    }
  } as any;
}

test("hyperliquid execution provider persists live provider metadata and reads live state", async () => {
  const db = createDb();
  const provider = createHyperliquidExecutionProvider({ db });

  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalClose = HyperliquidFuturesAdapter.prototype.close;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    return { equity: 123.45, availableMargin: 67.89, marginMode: undefined };
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    return [
      {
        symbol: "BTCUSDT",
        side: "long",
        size: 0.25,
        entryPrice: 50000,
        markPrice: 51000,
        unrealizedPnl: 250
      }
    ] as any;
  };
  HyperliquidFuturesAdapter.prototype.close = async function () {
    return undefined as any;
  };

  try {
    const created = await provider.createBotExecutionUnit({
      userId: "user_1",
      botVaultId: "bot_vault_1",
      masterVaultId: "mv_1",
      templateId: "tpl_1",
      gridInstanceId: "grid_1",
      symbol: "BTCUSDT",
      exchange: "hyperliquid"
    });
    assert.equal(typeof created.providerUnitId, "string");
    assert.equal(created.vaultAddress, "0x2222222222222222222222222222222222222222");

    const assigned = await provider.assignAgent({
      userId: "user_1",
      botVaultId: "bot_vault_1"
    });
    assert.equal(assigned.agentWallet, "0x1111111111111111111111111111111111111111");

    const state = await provider.getBotExecutionState({
      userId: "user_1",
      botVaultId: "bot_vault_1"
    });
    assert.equal(state.status, "created");
    assert.equal(state.equityUsd, 123.45);
    assert.equal(state.freeUsd, 67.89);
    assert.equal(state.usedMarginUsd, 55.56);
    assert.equal(state.positions.length, 1);
    assert.equal(state.providerMetadata?.providerMode, "live");
    assert.equal(state.providerMetadata?.credentialSource, "user_exchange_account");
    assert.equal(state.providerMetadata?.agentWallet, "0x1111111111111111111111111111111111111111");
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
  }
});

test("hyperliquid execution provider uses global admin credentials for new bot vaults", async () => {
  const db = createGlobalDb();
  const provider = createHyperliquidExecutionProvider({ db });

  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalClose = HyperliquidFuturesAdapter.prototype.close;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    return { equity: 50, availableMargin: 20, marginMode: undefined };
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    return [];
  };
  HyperliquidFuturesAdapter.prototype.close = async function () {
    return undefined as any;
  };

  try {
    await provider.createBotExecutionUnit({
      userId: "user_1",
      botVaultId: "bot_vault_global_1",
      masterVaultId: "mv_1",
      templateId: "tpl_1",
      gridInstanceId: "grid_1",
      symbol: "BTCUSDT",
      exchange: "hyperliquid"
    });
    const state = await provider.getBotExecutionState({
      userId: "user_1",
      botVaultId: "bot_vault_global_1"
    });
    assert.equal(state.providerMetadata?.credentialSource, "global_admin");
    assert.equal(state.providerMetadata?.agentWallet, "0x4444444444444444444444444444444444444444");
    assert.equal(state.providerMetadata?.vaultAddress, "0x5555555555555555555555555555555555555555");
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
  }
});
