import assert from "node:assert/strict";
import test from "node:test";
import { createVaultService } from "./service.js";

function createUniqueCreateFn() {
  const seen = new Set<string>();
  return async (args: any) => {
    const key = String(args?.data?.sourceKey ?? "");
    if (seen.has(key)) {
      const error: any = new Error("unique");
      error.code = "P2002";
      throw error;
    }
    seen.add(key);
    return {
      id: `ledger_${seen.size}`,
      ...args.data,
      createdAt: new Date()
    };
  };
}

test("ensureBotVaultForGridInstance triggers reserve via masterVaultService", async () => {
  const calls: Array<{ method: string; payload: any }> = [];
  const masterVault = {
    id: "mv_1",
    userId: "user_1"
  };
  let storedBotVault: any = null;

  const db: any = {
    masterVault: {
      async findUnique(args: any) {
        if (args?.where?.userId === "user_1") return masterVault;
        return null;
      },
      async create() {
        return masterVault;
      }
    },
    botVault: {
      async findUnique(args: any) {
        if (args?.where?.gridInstanceId) {
          if (storedBotVault && String(storedBotVault.gridInstanceId) === String(args.where.gridInstanceId)) {
            return storedBotVault;
          }
          return null;
        }
        if (args?.where?.id) {
          if (storedBotVault && String(storedBotVault.id) === String(args.where.id)) {
            return storedBotVault;
          }
          return null;
        }
        return null;
      },
      async create(args: any) {
        storedBotVault = {
          id: "bv_1",
          userId: "user_1",
          masterVaultId: "mv_1",
          templateId: "legacy_grid_default",
          gridInstanceId: "grid_1",
          allocatedUsd: Number(args?.data?.allocatedUsd ?? 0),
          availableUsd: Number(args?.data?.availableUsd ?? 0),
          matchingStateJson: args?.data?.matchingStateJson ?? null,
          agentWallet: null
        };
        return storedBotVault;
      },
      async update(args: any) {
        storedBotVault = {
          ...(storedBotVault ?? { id: "bv_1" }),
          ...args.data
        };
        return storedBotVault;
      },
      async findFirst(args: any) {
        if (!storedBotVault) return null;
        if (args?.where?.id && String(args.where.id) !== String(storedBotVault.id)) return null;
        if (args?.where?.userId && String(args.where.userId) !== String(storedBotVault.userId)) return null;
        return storedBotVault;
      }
    },
    gridBotInstance: {
      async findUnique() {
        return {
          id: "grid_1",
          userId: "user_1",
          templateId: "legacy_grid_default",
          leverage: 3,
          investUsd: 100,
          extraMarginUsd: 10,
          template: { symbol: "BTCUSDT" },
          exchangeAccount: { exchange: "hyperliquid" }
        };
      }
    },
    botTemplate: {
      async findUnique() {
        return {
          id: "legacy_grid_default",
          isActive: true,
          allowedSymbols: [],
          minAllocationUsd: 0.01,
          maxAllocationUsd: 1000000,
          maxLeverage: 125
        };
      }
    },
    vaultLedgerEntry: {
      create: createUniqueCreateFn()
    }
  };

  const service = createVaultService(db, {
    masterVaultService: {
      ensureMasterVault: async () => masterVault,
      getBalances: async () => ({}) as any,
      reserveForBotVault: async (payload: any) => {
        calls.push({ method: "reserve", payload });
        return {} as any;
      },
      releaseFromBotVault: async () => ({} as any),
      settleFromBotVault: async () => ({} as any),
      validateWithdraw: async () => ({ ok: true, reason: null, freeBalance: 0, reservedBalance: 0 }),
      withdraw: async () => ({} as any)
    }
  });

  await service.ensureBotVaultForGridInstance({
    userId: "user_1",
    gridInstanceId: "grid_1",
    allocatedUsd: 110
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "reserve");
  assert.equal(calls[0]?.payload?.idempotencyKey, "grid_instance:grid_1:allocation:v1");
});

test("withdrawFromGridInstance delegates settlement to feeSettlementService", async () => {
  const calls: Array<{ method: string; payload: any }> = [];
  const masterVault = {
    id: "mv_1",
    userId: "user_1"
  };

  let currentBotVault: any = {
    id: "bv_1",
    userId: "user_1",
    masterVaultId: "mv_1",
    gridInstanceId: "grid_1",
    principalAllocated: 100,
    principalReturned: 100,
    realizedPnlNet: 20,
    feePaidTotal: 0,
    highWaterMark: 0,
    allocatedUsd: 110,
    realizedGrossUsd: 20,
    realizedFeesUsd: 0,
    realizedNetUsd: 20,
    profitShareAccruedUsd: 0,
    withdrawnUsd: 0,
    availableUsd: 20,
    status: "ACTIVE",
    lastAccountingAt: null,
    updatedAt: new Date()
  };

  const db: any = {
    async $transaction(run: (tx: any) => Promise<any>) {
      return run(this);
    },
    gridBotInstance: {
      async findFirst() {
        return {
          id: "grid_1",
          userId: "user_1"
        };
      }
    },
    botVault: {
      async findUnique() {
        return currentBotVault;
      },
      async update(args: any) {
        const data = args?.data ?? {};
        currentBotVault = {
          ...currentBotVault,
          withdrawnUsd: currentBotVault.withdrawnUsd + Number(data?.withdrawnUsd?.increment ?? 0),
          availableUsd: currentBotVault.availableUsd - Number(data?.availableUsd?.decrement ?? 0),
          updatedAt: new Date()
        };
        return currentBotVault;
      }
    },
    masterVault: {
      async findUnique(args: any) {
        if (args?.where?.userId === "user_1") return masterVault;
        if (args?.where?.id === "mv_1") return masterVault;
        return null;
      },
      async create() {
        return masterVault;
      }
    },
    vaultLedgerEntry: {
      create: createUniqueCreateFn()
    }
  };

  const service = createVaultService(db, {
    masterVaultService: {
      ensureMasterVault: async () => masterVault,
      getBalances: async () => ({}) as any,
      deposit: async () => ({} as any),
      reserveForBotVault: async () => ({} as any),
      releaseFromBotVault: async () => ({} as any),
      settleFromBotVault: async () => ({} as any),
      validateWithdraw: async () => ({ ok: true, reason: null, freeBalance: 0, reservedBalance: 0 }),
      withdraw: async () => ({} as any)
    },
    feeSettlementService: {
      preview: () => ({} as any),
      settleFinalClose: async () => ({} as any),
      settleProfitWithdraw: async (payload: any) => {
        calls.push({ method: "settleProfitWithdraw", payload });
        currentBotVault = {
          ...currentBotVault,
          withdrawnUsd: 10,
          availableUsd: 10,
          feePaidTotal: 3,
          profitShareAccruedUsd: 3,
          highWaterMark: 10,
          updatedAt: new Date()
        };
        return {
          settlementBreakdown: {
            mode: "PROFIT_ONLY_WITHDRAW",
            requestedGrossUsd: 10,
            grossTransferUsd: 10,
            reservedReleaseUsd: 0,
            principalComponentUsd: 0,
            realizedProfitComponentUsd: 10,
            feeableProfitCapacityBeforeUsd: 10,
            feeBaseUsd: 10,
            feeAmountUsd: 3,
            netTransferUsd: 7,
            highWaterMarkBeforeUsd: 0,
            highWaterMarkAfterUsd: 10,
            maxProfitOnlyWithdrawableUsd: 20,
            feeRatePct: 30
          },
          botVaultSnapshotAfter: currentBotVault
        };
      }
    } as any
  });

  const result = await service.withdrawFromGridInstance({
    userId: "user_1",
    gridInstanceId: "grid_1",
    amountUsd: 10,
    sourceKey: "withdraw:grid_1:test"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "settleProfitWithdraw");
  assert.equal(calls[0]?.payload?.idempotencyKey, "withdraw:grid_1:test");
  assert.equal(result.botVault.withdrawnUsd, 10);
  assert.equal(result.settlement.feeAmountUsd, 3);
});

test("getMasterVaultSummary hydrates missing onchain address from factory when wallet is linked", async () => {
  const masterVault: any = {
    id: "mv_1",
    userId: "user_1",
    onchainAddress: null,
    freeBalance: 0,
    reservedBalance: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalAllocatedUsd: 0,
    totalRealizedNetUsd: 0,
    totalProfitShareAccruedUsd: 0,
    totalWithdrawnUsd: 0,
    availableUsd: 0,
    status: "active",
    updatedAt: new Date("2026-03-10T20:00:00.000Z")
  };

  const db: any = {
    user: {
      async findUnique(args: any) {
        if (args?.where?.id === "user_1") {
          return { walletAddress: "0x4444444444444444444444444444444444444444" };
        }
        return null;
      }
    },
    masterVault: {
      async findUnique(args: any) {
        if (args?.where?.userId === "user_1") return masterVault;
        return null;
      },
      async findFirst() {
        return null;
      },
      async create() {
        return masterVault;
      },
      async update(args: any) {
        masterVault.onchainAddress = args?.data?.onchainAddress ?? null;
        return masterVault;
      }
    },
    botVault: {
      async count() {
        return 0;
      }
    },
    globalSetting: {
      async findUnique() {
        return null;
      }
    }
  };

  const previousMode = process.env.VAULT_EXECUTION_MODE;
  process.env.VAULT_EXECUTION_MODE = "onchain_live";

  try {
    const service = createVaultService(db, {
      readOnchainMasterVaultForOwner: async ({ ownerAddress, mode }) => {
        assert.equal(ownerAddress, "0x4444444444444444444444444444444444444444");
        assert.equal(mode, "onchain_live");
        return "0x5555555555555555555555555555555555555555";
      }
    });

    const result = await service.getMasterVaultSummary({ userId: "user_1" });

    assert.equal(result.onchainAddress, "0x5555555555555555555555555555555555555555");
    assert.equal(masterVault.onchainAddress, "0x5555555555555555555555555555555555555555");
  } finally {
    process.env.VAULT_EXECUTION_MODE = previousMode;
  }
});
