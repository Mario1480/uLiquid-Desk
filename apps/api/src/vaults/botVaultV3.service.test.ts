import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBotVaultV3ActionFlags,
  buildBotVaultV3HealthSummary,
  buildBotVaultV3ResyncUpdate,
  createBotVaultV3Service
} from "./botVaultV3.service.js";

test("fundBotVault records requested funding without optimistic balance increments", async () => {
  const row = {
    id: "bv_1",
    botId: "bot_1",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: null,
    vaultAddress: null,
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 25,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "deployed",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    status: "ACTIVE",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  let updateArgs: any = null;
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...row };
      },
      async update(args: any) {
        updateArgs = args;
        row.fundingStatus = args.data.fundingStatus;
        row.hypercoreFundingStatus = args.data.hypercoreFundingStatus;
        row.executionStatus = args.data.executionStatus;
        row.updatedAt = new Date("2026-03-02T00:00:00.000Z");
        return { ...row };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  const result = await service.fundBotVault({
    userId: "user_1",
    botId: "bot_1",
    amountUsd: 50,
    moveToHyperCore: true
  });

  assert.equal(updateArgs?.data?.principalAllocated, undefined);
  assert.equal(updateArgs?.data?.allocatedUsd, undefined);
  assert.equal(updateArgs?.data?.availableUsd, undefined);
  assert.equal(row.principalAllocated, 25);
  assert.equal(result.allocatedUsd, 25);
  assert.equal(result.availableUsd, 25);
  assert.equal(result.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(result.hypercoreFundingStatus, "not_funded");
  assert.equal(result.executionStatus, "created");
  assert.equal(result.claimableProfitUsd, 0);
});

test("getBotVaultForBot maps missing status to DEPLOYED instead of ACTIVE", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_2",
          botId: "bot_2",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          beneficiaryAddress: null,
          controllerAddress: null,
          vaultAddress: null,
          agentWallet: null,
          agentWalletVersion: 1,
          agentSecretRef: null,
          allocatedUsd: 0,
          availableUsd: 0,
          principalAllocated: 0,
          principalReturned: 0,
          withdrawnUsd: 0,
          claimedProfitUsd: 0,
          feePaidTotal: 0,
          fundingStatus: "deployed",
          hypercoreFundingStatus: "not_funded",
          executionStatus: "created",
          status: null,
          endedAt: null,
          closedAt: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          updatedAt: new Date("2026-03-01T00:00:00.000Z")
        };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  const result = await service.getBotVaultForBot({
    userId: "user_1",
    botId: "bot_2"
  });

  assert.ok(result);
  assert.equal(result?.status, "DEPLOYED");
});

test("getBotVaultForBot exposes explicit address role aliases without breaking legacy fields", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_addr",
          botId: "bot_addr",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          beneficiaryAddress: null,
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          agentWallet: "0x3333333333333333333333333333333333333333",
          agentWalletVersion: 1,
          agentSecretRef: null,
          allocatedUsd: 0,
          availableUsd: 0,
          principalAllocated: 0,
          principalReturned: 0,
          withdrawnUsd: 0,
          claimedProfitUsd: 0,
          feePaidTotal: 0,
          fundingStatus: "deployed",
          hypercoreFundingStatus: "not_funded",
          executionStatus: "created",
          status: "DEPLOYED",
          endedAt: null,
          closedAt: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          updatedAt: new Date("2026-03-01T00:00:00.000Z")
        };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  const result = await service.getBotVaultForBot({
    userId: "user_1",
    botId: "bot_addr"
  });

  assert.ok(result);
  assert.equal(result?.vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.onchainBotVaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(result?.controllerAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(result?.agentWallet, "0x3333333333333333333333333333333333333333");
  assert.equal(result?.agentWalletAddress, "0x3333333333333333333333333333333333333333");
});

test("buildBotVaultV3ResyncUpdate canonicalizes post-close or post-recover closed state from onchain snapshot", () => {
  const now = new Date("2026-03-03T00:00:00.000Z");
  const result = buildBotVaultV3ResyncUpdate({
    status: "CLOSED",
    principalAllocated: 100,
    principalReturned: 100,
    availableUsd: 0,
    feePaidTotal: 7
  }, now);

  assert.deepEqual(result, {
    status: "CLOSED",
    principalAllocated: 100,
    allocatedUsd: 100,
    principalReturned: 100,
    availableUsd: 0,
    feePaidTotal: 7,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    endedAt: now,
    closedAt: now
  });
});

test("buildBotVaultV3ResyncUpdate canonicalizes post-claim funded state from onchain snapshot", () => {
  const result = buildBotVaultV3ResyncUpdate({
    status: "ACTIVE",
    principalAllocated: 80,
    principalReturned: 0,
    availableUsd: 78.5,
    feePaidTotal: 1.5
  });

  assert.equal(result.status, "ACTIVE");
  assert.equal(result.principalAllocated, 80);
  assert.equal(result.allocatedUsd, 80);
  assert.equal(result.availableUsd, 78.5);
  assert.equal(result.feePaidTotal, 1.5);
  assert.equal(result.fundingStatus, "hyper_evm_confirmed_onchain");
  assert.equal(result.hypercoreFundingStatus, undefined);
});

test("buildBotVaultV3ActionFlags does not treat requested funding as confirmed onchain", () => {
  const result = buildBotVaultV3ActionFlags({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    status: "DEPLOYED",
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    principalAllocated: 0,
    principalReturned: 0,
    availableUsd: 0
  });

  assert.deepEqual(result, {
    hasOnchainVault: true,
    fundingConfirmedOnchain: false,
    canClaim: false,
    canClose: false,
    canRecover: false,
    canSetAgentWallet: true
  });
});

test("buildBotVaultV3ActionFlags exposes claim and close capabilities from canonical funded state", () => {
  const result = buildBotVaultV3ActionFlags({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    status: "ACTIVE",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "pending",
    principalAllocated: 100,
    principalReturned: 0,
    availableUsd: 112
  });

  assert.deepEqual(result, {
    hasOnchainVault: true,
    fundingConfirmedOnchain: true,
    canClaim: true,
    canClose: true,
    canRecover: false,
    canSetAgentWallet: true
  });
});

test("buildBotVaultV3HealthSummary exposes compact lifecycle and funding state for UI consumers", () => {
  const result = buildBotVaultV3HealthSummary({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    agentWallet: "0x3333333333333333333333333333333333333333",
    status: "ACTIVE",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "pending",
    principalAllocated: 100,
    principalReturned: 0,
    availableUsd: 112
  });

  assert.deepEqual(result, {
    lifecycleStatus: "active",
    fundingHealth: "transfer_pending",
    onchainStateKnown: true,
    actionState: "claim_available"
  });
});

test("buildBotVaultV3ActionFlags stays non-optimistic for partial backend state", () => {
  const result = buildBotVaultV3ActionFlags({
    vaultAddress: null,
    status: null,
    fundingStatus: null,
    hypercoreFundingStatus: null,
    principalAllocated: null,
    principalReturned: null,
    availableUsd: null
  });

  assert.equal(result.hasOnchainVault, false);
  assert.equal(result.fundingConfirmedOnchain, false);
  assert.equal(result.canClaim, false);
  assert.equal(result.canClose, false);
  assert.equal(result.canRecover, false);
  assert.equal(result.canSetAgentWallet, true);
});

test("buildBotVaultV3ActionFlags exposes recover capability for execution-closed close-only vaults", () => {
  const result = buildBotVaultV3ActionFlags({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    status: "CLOSE_ONLY",
    executionStatus: "closed",
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    principalAllocated: 100,
    principalReturned: 100,
    availableUsd: 0
  });

  assert.equal(result.hasOnchainVault, true);
  assert.equal(result.fundingConfirmedOnchain, true);
  assert.equal(result.canClaim, false);
  assert.equal(result.canClose, false);
  assert.equal(result.canRecover, true);
  assert.equal(result.canSetAgentWallet, true);
});

test("createUserAgentWallet persists a managed agent wallet and links it to the user", async () => {
  const previousKey = process.env.SECRET_MASTER_KEY;
  process.env.SECRET_MASTER_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
  const createdSecrets: any[] = [];
  const updatedUsers: any[] = [];
  const updatedVaults: any[] = [];
  const tx = {
    agentWalletSecret: {
      async create(args: any) {
        createdSecrets.push(args);
        return args.data;
      }
    },
    user: {
      async update(args: any) {
        updatedUsers.push(args);
        return {
          id: "user_1",
          agentWallet: args.data.agentWallet,
          agentWalletVersion: args.data.agentWalletVersion,
          agentSecretRef: args.data.agentSecretRef,
          agentHypeWarnThreshold: 0.05,
          agentLastBalanceAt: null,
          agentLastBalanceWei: null,
          agentLastBalanceFormatted: null
        };
      }
    },
    botVault: {
      async updateMany(args: any) {
        updatedVaults.push(args);
        return { count: 0 };
      }
    }
  };

  const service = createBotVaultV3Service({
    user: {
      async findUnique() {
        return {
          id: "user_1",
          agentWallet: null,
          agentWalletVersion: 1,
          agentSecretRef: null,
          agentHypeWarnThreshold: 0.05,
          agentLastBalanceAt: null,
          agentLastBalanceWei: null,
          agentLastBalanceFormatted: null
        };
      }
    },
    agentWalletSecret: {
      async findFirst() {
        return null;
      }
    },
    botVault: {
      async updateMany() {
        return { count: 0 };
      }
    },
    async $transaction(callback: (input: any) => Promise<any>) {
      return callback(tx);
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  try {
    const result = await service.createUserAgentWallet({ userId: "user_1" });

    assert.match(String(result.address ?? ""), /^0x[a-fA-F0-9]{40}$/);
    assert.equal(result.version, 1);
    assert.match(String(result.secretRef ?? ""), /^agent_wallet:user_1:1:/);
    assert.equal(createdSecrets.length, 1);
    assert.equal(updatedUsers.length, 1);
    assert.equal(updatedVaults.length, 1);
    assert.equal(createdSecrets[0]?.data?.address, result.address);
    assert.equal(updatedUsers[0]?.data?.agentWallet, result.address);
  } finally {
    if (previousKey == null) delete process.env.SECRET_MASTER_KEY;
    else process.env.SECRET_MASTER_KEY = previousKey;
  }
});

test("controllerCloseBotVault buys exit gas and settles Hypercore exposure before closing", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const systemAddress = "0x4444444444444444444444444444444444444444";
  const closeOnlyTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const dbUpdates: any[] = [];
  const closeCalls: Array<{ symbol: string; side?: "long" | "short" }> = [];
  const usdClassTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const spotTransfers: Array<{ amountUsd: number }> = [];
  const spotBuyCalls: Array<{ symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number }> = [];
  const adapterAccounts: any[] = [];
  let stage: "before_close_only" | "after_close_only" | "after_close" = "before_close_only";
  let listPositionsCallCount = 0;
  let clearinghouseReadCount = 0;
  let sendTransactionCount = 0;
  let coreSpotUsdcBalance = 5;
  let coreSpotHypeBalance = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: "api-key",
              apiSecretEnc: "0x5555555555555555555555555555555555555555555555555555555555555555",
              passphraseEnc: null
            }
          }
        };
      },
      async update(args: any) {
        dbUpdates.push(args);
        return args.data;
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    },
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return stage === "before_close_only" ? 2n : stage === "after_close_only" ? 4n : 5n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "profitShareFeeRatePct":
              return 10n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction() {
          sendTransactionCount += 1;
          if (sendTransactionCount === 1) {
            stage = "after_close_only";
            return closeOnlyTxHash;
          }
          stage = "after_close";
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => {
      clearinghouseReadCount += 1;
      if (clearinghouseReadCount === 1) {
        return {
          withdrawable: "3.96498",
          accountValue: "5.01279",
          totalMarginUsed: "0.523905",
          assetPositions: [{}]
        };
      }
      return {
        withdrawable: "0",
        accountValue: "0",
        totalMarginUsed: "0",
        assetPositions: []
      };
    },
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createVaultSpotClient: () => ({
      async getBalances() {
        return [
          { asset: "USDC", available: String(coreSpotUsdcBalance) },
          { asset: "HYPE", available: String(coreSpotHypeBalance) }
        ];
      },
      async listSymbols() {
        return [{
          symbol: "HYPEUSDC",
          exchangeSymbol: "HYPE/USDC",
          tradable: true,
          stepSize: 0.01,
          minQty: 0.01,
          baseAsset: "HYPE",
          quoteAsset: "USDC"
        }];
      },
      async getLastPrice() {
        return 10;
      },
      async placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number }) {
        spotBuyCalls.push(input);
        coreSpotUsdcBalance = Number((coreSpotUsdcBalance - input.qty * 10).toFixed(6));
        coreSpotHypeBalance = Number((coreSpotHypeBalance + input.qty).toFixed(6));
        return { orderId: "spot_buy_1" };
      }
    }),
    closePositionsMarket: async (_adapter, symbol, side) => {
      closeCalls.push({ symbol, side });
      return ["close_1"];
    },
    createPerpExecutionAdapter: (account) => {
      adapterAccounts.push(account);
      return ({
      async listPositions() {
        listPositionsCallCount += 1;
        return listPositionsCallCount === 1
          ? [{ symbol: "BTCUSDT", size: 0.00015, side: "long" }]
          : [];
      },
      async getAccountState() {
        return { availableMargin: "3.96498" };
      },
      async transferUsdClass(input: { amountUsd: number; toPerp: boolean }) {
        usdClassTransfers.push(input);
        return { ok: true, txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: coreSpotUsdcBalance,
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        spotTransfers.push(input);
        return { ok: true };
      },
      async close() {
        return undefined;
      }
    });
    }
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close"
  });

  assert.equal(result.closeOnlyTxHash, closeOnlyTxHash);
  assert.equal(result.closeTxHash, closeTxHash);
  assert.equal(result.onchainStatusBefore, "ACTIVE");
  assert.equal(result.onchainStatusAfterCloseOnly, "CLOSE_ONLY");
  assert.equal(adapterAccounts.length, 1);
  assert.equal(adapterAccounts[0]?.passphrase, vaultAddress);
  assert.equal(adapterAccounts[0]?.botVaultAddress, vaultAddress);
  assert.deepEqual(closeCalls, [{ symbol: "BTCUSDT", side: "long" }]);
  assert.deepEqual(usdClassTransfers, [{ amountUsd: 3.96498, toPerp: false }]);
  assert.deepEqual(spotBuyCalls, [{
    symbol: "HYPEUSDC",
    side: "buy",
    type: "market",
    qty: 0.05
  }]);
  assert.deepEqual(spotTransfers, [{ amountUsd: 4.5 }]);
  assert.ok(dbUpdates.length >= 1);
});

test("controllerCloseBotVault skips exit gas top-up when Hypercore HYPE already exists", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const systemAddress = "0x4444444444444444444444444444444444444444";
  const spotBuyCalls: Array<{ symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number }> = [];
  let stage: "before_close_only" | "after_close_only" | "after_close" = "before_close_only";
  let clearinghouseReadCount = 0;
  let sendTransactionCount = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: "api-key",
              apiSecretEnc: "0x5555555555555555555555555555555555555555555555555555555555555555",
              passphraseEnc: null
            }
          }
        };
      },
      async update(args: any) {
        return args.data;
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    },
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return stage === "before_close_only" ? 2n : stage === "after_close_only" ? 4n : 5n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "profitShareFeeRatePct":
              return 10n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction() {
          sendTransactionCount += 1;
          if (sendTransactionCount === 1) {
            stage = "after_close_only";
            return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
          }
          stage = "after_close";
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => {
      clearinghouseReadCount += 1;
      if (clearinghouseReadCount === 1) {
        return {
          withdrawable: "1",
          accountValue: "1",
          totalMarginUsed: "0",
          assetPositions: []
        };
      }
      return {
        withdrawable: "0",
        accountValue: "0",
        totalMarginUsed: "0",
        assetPositions: []
      };
    },
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createVaultSpotClient: () => ({
      async getBalances() {
        return [
          { asset: "USDC", available: "5" },
          { asset: "HYPE", available: "0.05" }
        ];
      },
      async listSymbols() {
        return [];
      },
      async getLastPrice() {
        return 0;
      },
      async placeOrder(input: { symbol: string; side: "buy" | "sell"; type: "market" | "limit"; qty: number }) {
        spotBuyCalls.push(input);
        return { orderId: "spot_buy_1" };
      }
    }),
    closePositionsMarket: async () => [],
    createPerpExecutionAdapter: () => ({
      async listPositions() {
        return [];
      },
      async getAccountState() {
        return { availableMargin: "1" };
      },
      async transferUsdClass() {
        return { ok: true };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: 5,
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdcSpotToEvm() {
        return { ok: true };
      },
      async close() {
        return undefined;
      }
    })
  });

  await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close"
  });

  assert.deepEqual(spotBuyCalls, []);
});
