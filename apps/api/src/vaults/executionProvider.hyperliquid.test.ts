import assert from "node:assert/strict";
import test from "node:test";
import {
  clearHyperliquidReadCoordinatorForTests,
  HyperliquidFuturesAdapter
} from "@mm/futures-exchange";
import { encryptSecret } from "../secret-crypto.js";
import { createHyperliquidExecutionProvider } from "./executionProvider.hyperliquid.js";

test.afterEach(() => {
  clearHyperliquidReadCoordinatorForTests();
});

function createDb() {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const row: any = {
    id: "bot_vault_1",
    userId: "user_1",
    gridInstanceId: "grid_1",
    executionStatus: "created",
    executionMetadata: {},
    vaultAddress: "0x9999999999999999999999999999999999999999",
    agentWallet: null,
    masterVault: {
      onchainAddress: "0x3333333333333333333333333333333333333333"
    },
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
    return originalClose.call(this);
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
    assert.equal(state.providerMetadata?.vaultAddress, "0x2222222222222222222222222222222222222222");
    assert.equal(state.providerMetadata?.agentWallet, "0x1111111111111111111111111111111111111111");
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
  }
});

test("hyperliquid execution provider can provision inside tx-scoped bot vault creation", async () => {
  process.env.SECRET_MASTER_KEY = process.env.SECRET_MASTER_KEY || "0123456789abcdef0123456789abcdef";
  const rootDb = {
    botVault: {
      async findFirst() {
        return null;
      },
      async findUnique() {
        return null;
      },
      async update() {
        throw new Error("root_db_should_not_update");
      }
    }
  } as any;
  const txRow: any = {
    id: "bot_vault_tx",
    userId: "user_1",
    gridInstanceId: "grid_tx",
    executionStatus: "created",
    executionMetadata: {},
    vaultAddress: "0x9999999999999999999999999999999999999999",
    agentWallet: null,
    masterVault: {
      onchainAddress: "0x3333333333333333333333333333333333333333"
    },
    gridInstance: {
      exchangeAccount: {
        id: "acc_hl_tx",
        exchange: "hyperliquid",
        apiKeyEnc: encryptSecret("0x1111111111111111111111111111111111111111"),
        apiSecretEnc: encryptSecret("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        passphraseEnc: encryptSecret("0x2222222222222222222222222222222222222222")
      }
    }
  };
  const tx = {
    botVault: {
      async findUnique(args: any) {
        if (String(args?.where?.id ?? "") !== txRow.id) return null;
        return {
          executionMetadata: txRow.executionMetadata,
          executionStatus: txRow.executionStatus,
          vaultAddress: txRow.vaultAddress,
          agentWallet: txRow.agentWallet
        };
      },
      async findFirst(args: any) {
        if (String(args?.where?.id ?? "") !== txRow.id) return null;
        return txRow;
      },
      async update(args: any) {
        txRow.executionMetadata = args.data.executionMetadata ?? txRow.executionMetadata;
        txRow.executionStatus = args.data.executionStatus ?? txRow.executionStatus;
        txRow.vaultAddress = args.data.vaultAddress ?? txRow.vaultAddress;
        txRow.agentWallet = args.data.agentWallet ?? txRow.agentWallet;
        return txRow;
      }
    }
  } as any;

  const provider = createHyperliquidExecutionProvider({ db: rootDb });

  const created = await provider.createBotExecutionUnit({
    userId: "user_1",
    botVaultId: "bot_vault_tx",
    masterVaultId: "mv_tx",
    templateId: "tpl_tx",
    gridInstanceId: "grid_tx",
    symbol: "BTCUSDT",
    exchange: "hyperliquid",
    tx
  });

  assert.equal(typeof created.providerUnitId, "string");
  assert.equal(String(txRow.executionMetadata?.providerState?.providerAccountId ?? ""), "acc_hl_tx");
  assert.equal(String(txRow.executionMetadata?.providerState?.vaultAddress ?? ""), "0x2222222222222222222222222222222222222222");
});

test("hyperliquid execution provider serves degraded stale state on rate-limited reads", async () => {
  const db = createDb();
  const provider = createHyperliquidExecutionProvider({ db });

  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalClose = HyperliquidFuturesAdapter.prototype.close;
  const originalDateNow = Date.now;

  let mode: "healthy" | "limited" = "healthy";
  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    if (mode === "healthy") {
      return { equity: 120, availableMargin: 80, marginMode: undefined };
    }
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    if (mode === "healthy") {
      return [
        {
          symbol: "BTCUSDT",
          side: "long",
          size: 0.1,
          entryPrice: 50000,
          markPrice: 50100,
          unrealizedPnl: 10
        }
      ] as any;
    }
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };
  HyperliquidFuturesAdapter.prototype.close = async function () {
    return originalClose.call(this);
  };

  try {
    await provider.getBotExecutionState({
      userId: "user_1",
      botVaultId: "bot_vault_1"
    });
    const now = originalDateNow();
    Date.now = () => now + 11_000;
    mode = "limited";
    const state = await provider.getBotExecutionState({
      userId: "user_1",
      botVaultId: "bot_vault_1"
    });
    assert.equal(state.status, "created");
    assert.equal(state.equityUsd, 120);
    assert.equal(state.freeUsd, 80);
    assert.equal(state.usedMarginUsd, 40);
    assert.equal(state.positions.length, 1);
    assert.equal(state.providerMetadata?.degradedRead, true);
    assert.equal(Array.isArray(state.providerMetadata?.readErrors), true);
    assert.equal((state.providerMetadata?.readErrors as any[])?.length, 2);
    assert.equal(state.providerMetadata?.rateLimited, true);
    assert.equal(typeof state.providerMetadata?.cacheAgeMs, "number");
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
    Date.now = originalDateNow;
  }
});

test("hyperliquid execution provider throws when no usable live or stale state exists", async () => {
  const db = createDb();
  const provider = createHyperliquidExecutionProvider({ db });

  const originalGetAccountState = HyperliquidFuturesAdapter.prototype.getAccountState;
  const originalGetPositions = HyperliquidFuturesAdapter.prototype.getPositions;
  const originalClose = HyperliquidFuturesAdapter.prototype.close;

  HyperliquidFuturesAdapter.prototype.getAccountState = async function () {
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };
  HyperliquidFuturesAdapter.prototype.getPositions = async function () {
    const error = new Error("hyperliquid_info_failed:429:null");
    (error as Error & { status?: number }).status = 429;
    throw error;
  };
  HyperliquidFuturesAdapter.prototype.close = async function () {
    return originalClose.call(this);
  };

  try {
    await assert.rejects(
      () =>
        provider.getBotExecutionState({
          userId: "user_1",
          botVaultId: "bot_vault_1"
        }),
      /hyperliquid_info_failed:429:null/
    );
  } finally {
    HyperliquidFuturesAdapter.prototype.getAccountState = originalGetAccountState;
    HyperliquidFuturesAdapter.prototype.getPositions = originalGetPositions;
    HyperliquidFuturesAdapter.prototype.close = originalClose;
  }
});
