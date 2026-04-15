import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildBotVaultV3ActionFlags,
  buildBotVaultV3HealthSummary,
  buildBotVaultV3ResyncUpdate,
  createBotVaultV3Service,
  evaluateBotVaultV3ExecutionReadiness,
  readHyperliquidSpotUsdcBalance
} from "./botVaultV3.service.js";
import { resetSerializedControllerTransactionStateForTests } from "./controllerTransaction.js";

test("fundBotVault records requested funding intent without optimistic balance increments", async () => {
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
    executionMetadata: null,
    status: "ACTIVE",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  let updateArgs: any = null;
  const fundingCalls: any[] = [];
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
        row.executionMetadata = args.data.executionMetadata;
        row.updatedAt = new Date("2026-03-02T00:00:00.000Z");
        return { ...row };
      }
    }
  } as any, {
    onchainActionService: {
      async buildReserveForBotVault(input: any) {
        fundingCalls.push(input);
        return {
          action: {
            id: "oa_1",
            actionKey: input.actionKey,
            actionType: "fund_bot_vault_v3",
            status: "prepared",
            txHash: null
          }
        };
      }
    },
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
  assert.equal(fundingCalls.length, 1);
  assert.equal(fundingCalls[0]?.botVaultId, "bv_1");
  assert.equal(fundingCalls[0]?.amountUsd, 50);
  assert.equal(fundingCalls[0]?.actionKey, "bot_vault_v3_funding:bv_1:50");
  assert.equal(result.allocatedUsd, 25);
  assert.equal(result.availableUsd, 25);
  assert.equal(result.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(result.hypercoreFundingStatus, "not_funded");
  assert.equal(result.executionStatus, "created");
  assert.equal(result.claimableProfitUsd, 0);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.sourceKey, "bot_vault_v3_funding:bv_1:50");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionType, "fund_bot_vault_v3");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionStatus, "prepared");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.amountUsd, 50);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.moveToHyperCore, true);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.verificationState, "requested");
});

test("fundBotVault is idempotent for duplicate calls with the same pending funding request", async () => {
  const row = {
    id: "bv_dup",
    botId: "bot_dup",
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
    executionMetadata: null,
    status: "ACTIVE",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  const onchainActionRow = {
    id: "oa_dup",
    actionKey: "bot_vault_v3_funding:bv_dup:50",
    actionType: "fund_bot_vault_v3",
    status: "prepared",
    txHash: null,
    metadata: {
      amountUsd: 50
    },
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  let fundingBuildCount = 0;
  let updateCount = 0;
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...row };
      },
      async update(args: any) {
        updateCount += 1;
        row.fundingStatus = args.data.fundingStatus;
        row.hypercoreFundingStatus = args.data.hypercoreFundingStatus;
        row.executionStatus = args.data.executionStatus;
        row.executionMetadata = args.data.executionMetadata;
        return { ...row };
      }
    },
    onchainAction: {
      async findFirst() {
        return { ...onchainActionRow };
      }
    }
  } as any, {
    onchainActionService: {
      async buildReserveForBotVault() {
        fundingBuildCount += 1;
        return {
          action: { ...onchainActionRow }
        };
      }
    }
  });

  const first = await service.fundBotVault({
    userId: "user_1",
    botId: "bot_dup",
    amountUsd: 50,
    moveToHyperCore: true
  });
  const second = await service.fundBotVault({
    userId: "user_1",
    botId: "bot_dup",
    amountUsd: 50,
    moveToHyperCore: true
  });

  assert.equal(fundingBuildCount, 0);
  assert.equal(updateCount, 2);
  assert.equal(first.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(second.fundingStatus, "hyper_evm_funding_requested");
  assert.equal((row.executionMetadata as any)?.fundingIntent?.actionKey, "bot_vault_v3_funding:bv_dup:50");
  assert.equal((row.executionMetadata as any)?.fundingIntent?.actionStatus, "prepared");
});

test("fundBotVault resumes an existing onchain funding action after an interrupted local update", async () => {
  const row = {
    id: "bv_resume",
    botId: "bot_resume",
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
    executionMetadata: null,
    status: "ACTIVE",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const existingAction = {
    id: "oa_resume",
    actionKey: "bot_vault_v3_funding:bv_resume:75",
    actionType: "fund_bot_vault_v3",
    status: "submitted",
    txHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    metadata: {
      amountUsd: 75
    },
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z")
  };

  let buildCalls = 0;
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
        row.executionMetadata = args.data.executionMetadata;
        return { ...row };
      }
    },
    onchainAction: {
      async findFirst() {
        return { ...existingAction };
      }
    }
  } as any, {
    onchainActionService: {
      async buildReserveForBotVault() {
        buildCalls += 1;
        return {
          action: { ...existingAction }
        };
      }
    }
  });

  const result = await service.fundBotVault({
    userId: "user_1",
    botId: "bot_resume",
    amountUsd: 75,
    moveToHyperCore: false
  });

  assert.equal(buildCalls, 0);
  assert.equal(result.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionId, "oa_resume");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionStatus, "submitted");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.txHash, existingAction.txHash);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.moveToHyperCore, false);
  assert.equal(updateArgs?.data?.executionMetadata?.autoActivateStatus, "skipped");
  assert.equal(updateArgs?.data?.executionMetadata?.autoHypercoreFundingStatus, "skipped");
});

test("fundBotVault creates a fresh retry action after a failed funding attempt", async () => {
  const row = {
    id: "bv_retry",
    botId: "bot_retry",
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
    executionMetadata: {
      fundingIntent: {
        sourceKey: "bot_vault_v3_funding:bv_retry:50",
        amountUsd: 50,
        moveToHyperCore: true,
        retryAttempt: 0
      }
    },
    status: "ACTIVE",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const failedAction = {
    id: "oa_retry_failed",
    actionKey: "bot_vault_v3_funding:bv_retry:50",
    actionType: "fund_bot_vault_v3",
    status: "failed",
    txHash: null,
    metadata: {
      amountUsd: 50
    },
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-02T00:00:00.000Z")
  };

  let buildArgs: any = null;
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
        row.executionMetadata = args.data.executionMetadata;
        return { ...row };
      }
    },
    onchainAction: {
      async findFirst() {
        return { ...failedAction };
      }
    }
  } as any, {
    onchainActionService: {
      async buildReserveForBotVault(input: any) {
        buildArgs = input;
        return {
          action: {
            id: "oa_retry_1",
            actionKey: input.actionKey,
            actionType: "fund_bot_vault_v3",
            status: "prepared",
            txHash: null
          }
        };
      }
    }
  });

  const result = await service.fundBotVault({
    userId: "user_1",
    botId: "bot_retry",
    amountUsd: 50,
    moveToHyperCore: true
  });

  assert.equal(result.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(buildArgs?.actionKey, "bot_vault_v3_funding:bv_retry:50:retry:1");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionKey, "bot_vault_v3_funding:bv_retry:50:retry:1");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.retryAttempt, 1);
});

test("readHyperliquidSpotUsdcBalance uses explicit token indexes from spot metadata", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    if (payload.type === "spotMeta") {
      return {
        ok: true,
        json: async () => ({
          tokens: [{ index: 42, name: "USDC" }]
        })
      } as any;
    }
    if (payload.type === "spotClearinghouseState") {
      return {
        ok: true,
        json: async () => ({
          tokenBalances: [{ token: 42, balance: "5.939281" }]
        })
      } as any;
    }
    throw new Error(`unexpected payload:${JSON.stringify(payload)}`);
  };

  try {
    const balance = await readHyperliquidSpotUsdcBalance(`0x${"1".repeat(40)}`);
    assert.equal(balance, "5.939281");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("evaluateBotVaultV3ExecutionReadiness marks requested funding as not ready", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"1".repeat(40)}`,
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    status: "FUNDED"
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_funding_requested_not_confirmed");
  assert.equal(readiness.stage, "funding");
});

test("evaluateBotVaultV3ExecutionReadiness marks onchain-funded but not transferred vaults as not ready", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"2".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    status: "FUNDED"
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_hypercore_funding_not_started");
  assert.equal(readiness.stage, "transfer");
});

test("evaluateBotVaultV3ExecutionReadiness marks fully funded vaults as ready", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"3".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    executionMetadata: {
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified"
      }
    }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
  assert.equal(readiness.stage, "ready");
});

test("evaluateBotVaultV3ExecutionReadiness keeps funded but non-execution-ready lifecycle states blocked", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"4".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    executionMetadata: {
      fundingLifecycle: {
        stage: "perp_margin_transferred",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_execution_lifecycle_not_ready");
  assert.equal(readiness.stage, "verification");
});

test("evaluateBotVaultV3ExecutionReadiness rejects inconsistent legacy running states without explicit lifecycle readiness", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"5".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "ACTIVE",
    executionMetadata: {
      marginAddFinalization: {
        verificationState: "funding_verified"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_execution_lifecycle_not_ready");
  assert.equal(readiness.stage, "verification");
});

test("evaluateBotVaultV3ExecutionReadiness rejects execution_ready lifecycle when verification is missing", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"6".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    executionMetadata: {
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "transfer_observed",
        verificationBlockingReason: "final_state_resync_unavailable"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_hypercore_final_state_unverified");
  assert.equal(readiness.stage, "transfer");
});

test("getBotVaultForBot reconcile resyncs stale onchain fields and promotes HyperCore funding from execution balances", async () => {
  const executionPrivateKey = `0x${"1".repeat(64)}`;
  const executionAddress = privateKeyToAccount(executionPrivateKey as `0x${string}`).address;
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const botVaultRow: any = {
    id: "bv_reconcile_live",
    botId: "bot_reconcile_live",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress,
    vaultAddress,
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 10,
    availableUsd: 10,
    principalAllocated: 10,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    executionMetadata: {},
    status: "ACTIVE",
    bot: {
      symbol: "BTCUSDT",
      exchangeAccount: {
        id: "acct_1",
        exchange: "hyperliquid",
        apiKeyEnc: executionAddress,
        apiSecretEnc: executionPrivateKey,
        passphraseEnc: null
      }
    },
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        Object.assign(botVaultRow, data);
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        return { ...botVaultRow };
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 25_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            case "balanceOf":
              return 5_000_000n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      },
      walletClient: {
        async sendTransaction() {
          throw new Error("should_not_send_transaction");
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: 0 };
      },
      async getAccountState() {
        return {
          availableMargin: 18,
          equity: 20
        };
      },
      async close() {}
    }),
    decryptSecret: (value) => value,
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  const result = await service.getBotVaultForBot({
    userId: "user_1",
    botId: "bot_reconcile_live",
    reconcile: true
  });

  assert.ok(result);
  assert.equal(result?.allocatedUsd, 25);
  assert.equal(result?.availableUsd, 5);
  assert.equal(result?.fundingStatus, "hyper_evm_confirmed_onchain");
  assert.equal(result?.hypercoreFundingStatus, "pending");
  assert.equal(result?.reconciliation?.status, "warning");
  assert.ok(result?.reconciliation?.issues.some((issue) => issue.code === "db_onchain_principal_allocated_mismatch"));
  assert.ok(result?.reconciliation?.issues.some((issue) => issue.code === "hypercore_funding_status_out_of_sync"));
  assert.equal(result?.reconciliation?.executionSnapshot.state, "ok");
  assert.equal(result?.reconciliation?.executionSnapshot.totalVisibleUsd, 20);
});

test("reconcileBotVaultV3ById resumes confirmed close settlement without double-applying accounting", async () => {
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const botVaultRow: any = {
    id: "bv_reconcile_close_resume",
    botId: "bot_close_resume",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress,
    vaultAddress,
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 26,
    availableUsd: 25.454059,
    principalAllocated: 26,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    executionMetadata: {
      closeSettlement: {
        sourceAction: "close_vault",
        sourceKey: "bot_vault_v3:bv_reconcile_close_resume:close_vault:settlement",
        feeEventSourceKey: "bot_vault_v3:bv_reconcile_close_resume:close_vault:settlement:fee_event",
        closeTxHash: "0xclose",
        feeRatePct: 30,
        treasuryRecipient: "0x4444444444444444444444444444444444444444",
        principalReturnedUsd: 25,
        grossAmountUsd: 25.454059,
        feeAmountUsd: 0.136217,
        netReturnedUsd: 25.317842,
        profitComponentUsd: 0.454059,
        excludedPrincipalUsd: 1,
        stage: "confirmed",
        preparedAt: "2026-04-14T00:00:00.000Z",
        confirmedAt: "2026-04-14T00:01:00.000Z",
        appliedAt: null,
        updatedAt: "2026-04-14T00:01:00.000Z"
      }
    },
    status: "CLOSED",
    bot: {
      symbol: "BTCUSDT",
      exchangeAccount: null
    },
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned?.increment !== undefined) {
          botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
        } else if (data.principalReturned !== undefined) {
          botVaultRow.principalReturned = Number(data.principalReturned);
        }
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal?.increment !== undefined) {
          botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
        } else if (data.feePaidTotal !== undefined) {
          botVaultRow.feePaidTotal = Number(data.feePaidTotal);
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        if (data.principalAllocated !== undefined) {
          botVaultRow.principalAllocated = Number(data.principalAllocated);
          botVaultRow.allocatedUsd = Number(data.allocatedUsd ?? data.principalAllocated);
        }
        return { ...botVaultRow };
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 5n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 25_000_000n;
            case "feePaidTotal":
              return 136_217n;
            case "balanceOf":
              return 0n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      },
      walletClient: {
        async sendTransaction() {
          throw new Error("should_not_send_transaction");
        }
      }
    }),
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    }
  });

  const result = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_reconcile_close_resume"
  });

  assert.ok(result);
  assert.equal(result?.withdrawnUsd, 25.317842);
  assert.equal(result?.claimedProfitUsd, 0.454059);
  assert.equal(result?.feePaidTotal, 0.136217);
  assert.equal(result?.reconciliation?.status, "warning");
  assert.ok(result?.reconciliation?.issues.some((issue) => issue.code === "close_settlement_pending_apply" && issue.autoRecovered));
});

test("getBotVaultForBot excludes Hypercore account creation fee from claimable profit", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_claimable",
          botId: "bot_claimable",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          beneficiaryAddress: null,
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          agentWallet: null,
          agentWalletVersion: 1,
          agentSecretRef: null,
          allocatedUsd: 26,
          availableUsd: 25.454059,
          principalAllocated: 26,
          principalReturned: 0,
          withdrawnUsd: 0,
          claimedProfitUsd: 0,
          feePaidTotal: 0,
          fundingStatus: "hyper_evm_confirmed_onchain",
          hypercoreFundingStatus: "funded",
          executionStatus: "running",
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          },
          status: "ACTIVE",
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
    botId: "bot_claimable"
  });

  assert.ok(result);
  assert.equal(result?.claimableProfitUsd, 0.454059);
});

test("previewClaimProfit returns fee preview against v3 claimable profit excluding Hypercore setup fees", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_preview",
          botId: "bot_preview",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          }
        };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    },
    buildControllerWalletClient: () => ({
      account: { address: "0x2222222222222222222222222222222222222222" },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 237_771n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      },
      walletClient: {}
    })
  });

  const result = await service.previewClaimProfit({
    userId: "user_1",
    botId: "bot_preview",
    amountUsd: 0.4
  });

  assert.equal(result.maxClaimableUsd, 0.454059);
  assert.equal(result.requestedAmountUsd, 0.4);
  assert.equal(result.feeRatePct, 30);
  assert.equal(result.feeAmountUsd, 0.12);
  assert.equal(result.netAmountUsd, 0.28);
  assert.equal(result.excludedPrincipalUsd, 1);
  assert.equal(result.treasuryRecipient, "0x4444444444444444444444444444444444444444");
});

test("previewClaimProfit returns a zero preview instead of failing when no claimable profit exists", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_preview_zero",
          botId: "bot_preview_zero",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          }
        };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    },
    buildControllerWalletClient: () => ({
      account: { address: "0x2222222222222222222222222222222222222222" },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 237_771n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 25_000_000n;
            case "profitShareFeeRatePct":
              return 30n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      },
      walletClient: {}
    })
  });

  const result = await service.previewClaimProfit({
    userId: "user_1",
    botId: "bot_preview_zero",
    amountUsd: null
  });

  assert.equal(result.maxClaimableUsd, 0);
  assert.equal(result.requestedAmountUsd, 0);
  assert.equal(result.feeRatePct, 30);
  assert.equal(result.feeAmountUsd, 0);
  assert.equal(result.netAmountUsd, 0);
  assert.equal(result.excludedPrincipalUsd, 1);
  assert.equal(result.treasuryRecipient, null);
});

test("previewClaimProfit includes realized HyperCore profit while excluding unrealized pnl", async () => {
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_preview_live",
          botId: "bot_preview_live",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress: "0x2222222222222222222222222222222222222222",
          vaultAddress: "0x1111111111111111111111111111111111111111",
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          }
        };
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return null;
      }
    },
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "17.255863",
      accountValue: "26.779303",
      totalMarginUsed: "1.15072",
      assetPositions: [{
        position: {
          unrealizedPnl: "0.98673"
        }
      }]
    }),
    readHyperliquidSpotUsdcBalance: async () => "0",
    buildControllerWalletClient: () => ({
      account: { address: "0x2222222222222222222222222222222222222222" },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 237_771n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 0n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      },
      walletClient: {}
    })
  });

  const result = await service.previewClaimProfit({
    userId: "user_1",
    botId: "bot_preview_live",
    amountUsd: null
  });

  assert.equal(result.maxClaimableUsd, 0.792573);
  assert.equal(result.requestedAmountUsd, 0.792573);
  assert.equal(result.feeAmountUsd, 0.237771);
  assert.equal(result.netAmountUsd, 0.554802);
});

test("claimProfit settles missing HyperCore liquidity back to EVM before sending the claim tx", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const systemAddress = "0x2222222222222222222222222222222222222222";
  let evmBalanceAtomic = 0n;
  let spotUsdcBalance = 0;
  let accountValueUsd = 26.779303;
  let sendTransactionCount = 0;
  const usdTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const spotTransfers: Array<{ amountUsd: number }> = [];

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.where?.id === "bv_claim_live") {
          return {
            id: "bv_claim_live",
            userId: "user_1",
            vaultModel: "bot_vault_v3",
            vaultAddress,
            controllerAddress,
            executionMetadata: {
              hypercoreAccountingFeeUsd: 1
            },
            agentWallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            agentWalletVersion: 1,
            agentSecretRef: null,
            gridInstance: {
              template: {
                symbol: "BTCUSDT"
              },
              exchangeAccount: {
                id: "acc_1",
                exchange: "hyperliquid",
                apiKeyEnc: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                apiSecretEnc: "0x59c6995e998f97a5a0044966f0945382db5d82c6f2cf7fb7f9fce4dc8c7c4b27",
                passphraseEnc: null
              }
            },
            bot: null
          };
        }
        return {
          id: "bv_claim_live",
          botId: "bot_claim_live",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress,
          vaultAddress,
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          }
        };
      },
      async update() {
        return {};
      }
    },
    feeEvent: {
      async create() {
        return {};
      }
    }
  } as any, {
    agentSecretProvider: {
      async getAgentCredentials() {
        return {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          privateKey: "0x59c6995e998f97a5a0044966f0945382db5d82c6f2cf7fb7f9fce4dc8c7c4b27"
        };
      }
    },
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "17.255863",
      accountValue: String(Number(accountValueUsd.toFixed(6))),
      totalMarginUsed: "1.15072",
      assetPositions: [{
        position: {
          unrealizedPnl: "0.98673"
        }
      }]
    }),
    readHyperliquidSpotAssetBalance: async (_address: `0x${string}`, asset: string) => {
      if (asset === "HYPE") return "0.1";
      if (asset === "USDC") return String(spotUsdcBalance);
      return "0";
    },
    readHyperliquidSpotUsdcBalance: async (address: `0x${string}`, asset?: string) => {
      if (asset === "HYPE") return "0.1";
      return String(spotUsdcBalance);
    },
    decryptSecret: (value) => value,
    sleep: async () => {},
    createVaultCoreWriter: () => ({
      async placeLimitOrder() {
        throw new Error("unexpected_gas_order");
      }
    }),
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [];
      },
      async getLastPrice() {
        return 0;
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getAccountState() {
        return { availableMargin: "17.255863" };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: spotUsdcBalance,
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdClass(input: { amountUsd: number; toPerp: boolean }) {
        usdTransfers.push(input);
        spotUsdcBalance = Number((spotUsdcBalance + input.amountUsd).toFixed(6));
        accountValueUsd = Number((accountValueUsd - input.amountUsd).toFixed(6));
        return { status: "confirmed" };
      },
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        spotTransfers.push(input);
        spotUsdcBalance = Number((spotUsdcBalance - input.amountUsd).toFixed(6));
        evmBalanceAtomic += BigInt(Math.round(input.amountUsd * 1_000_000));
        return { status: "confirmed" };
      },
      async close() {
        return undefined;
      }
    }),
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 237_771n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return evmBalanceAtomic;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          sendTransactionCount += 1;
          const decoded = decodeFunctionData({
            abi: parseAbi([
              "function claimProfit(uint256 amount, uint256 feeAmount, uint256 principalPortion)"
            ]),
            data: args.data
          });
          assert.equal(decoded.functionName, "claimProfit");
          assert.equal(decoded.args?.[0], 792573n);
          assert.equal(decoded.args?.[1], 237771n);
          assert.equal(decoded.args?.[2], 0n);
          return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        }
      }
    })
  });

  const result = await service.claimProfit({
    userId: "user_1",
    botId: "bot_claim_live",
    amountUsd: null
  });

  assert.equal(sendTransactionCount, 1);
  assert.deepEqual(usdTransfers, [{ amountUsd: 0.792573, toPerp: false }]);
  assert.deepEqual(spotTransfers, [{ amountUsd: 0.792573 }]);
  assert.equal(result.grossAmountAtomic, "792573");
  assert.equal(result.feeAmountAtomic, "237771");
  assert.equal(result.postProcessingStage, "applied");
  assert.equal(result.postProcessingReason, null);
});

test("claimProfit persists pending post-processing when claim resync fails after receipt", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const botVaultRow: any = {
    id: "bv_claim_resync_pending",
    botId: "bot_claim_resync_pending",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    controllerAddress,
    vaultAddress,
    executionMetadata: {}
  };
  let claimConfirmed = false;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create() {
        return {};
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          if (claimConfirmed) throw new Error("claim_resync_unavailable");
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 1_500_000n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          claimConfirmed = true;
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction() {
          return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "26.0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const result = await service.claimProfit({
    userId: "user_1",
    botId: "bot_claim_resync_pending",
    amountUsd: 1
  });

  assert.equal(result.postProcessingStage, "pending");
  assert.match(String(result.postProcessingReason), /claim_resync_unavailable/);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.stage, "confirmed");
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.claimTxHash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.match(String(botVaultRow.executionMetadata?.claimSettlement?.lastError ?? ""), /claim_resync_unavailable/);
});

test("claimProfit throws when confirmed claim settlement persistence fails", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const botVaultRow: any = {
    id: "bv_claim_persist_fail",
    botId: "bot_claim_persist_fail",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    controllerAddress,
    vaultAddress,
    executionMetadata: {}
  };
  let sendCount = 0;
  let updateCount = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        updateCount += 1;
        const settlementStage = args?.data?.executionMetadata?.claimSettlement?.stage ?? null;
        if (settlementStage === "confirmed") {
          throw new Error("db_claim_settlement_write_failed");
        }
        if (args?.data?.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = args.data.executionMetadata;
        }
        return { ...botVaultRow };
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 300_000n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 4_000_000n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
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
          sendCount += 1;
          return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "26.0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.claimProfit({
      userId: "user_1",
      botId: "bot_claim_persist_fail",
      amountUsd: 1
    }),
    /bot_vault_v3_settlement_persist_failed:claim_profit:confirmed:bv_claim_persist_fail:Error: db_claim_settlement_write_failed/
  );

  assert.equal(sendCount, 1);
  assert.equal(updateCount, 1);
  assert.deepEqual(botVaultRow.executionMetadata, {});
});

test("claimProfit persists pending post-processing when fee event creation fails after receipt", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const feeEvents = new Map<string, any>();
  const botVaultRow: any = {
    id: "bv_claim_fee_pending",
    botId: "bot_claim_fee_pending",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    controllerAddress,
    vaultAddress,
    principalReturned: 0,
    availableUsd: 5,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "ACTIVE",
    executionMetadata: {}
  };

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => {
      const snapshot = structuredClone(botVaultRow);
      const feeSnapshot = new Map(feeEvents);
      const tx = {
        botVault: {
          async findFirst() {
            return { ...botVaultRow };
          },
          async findUnique() {
            return { ...botVaultRow };
          },
          async update(args: any) {
            const data = args.data ?? {};
            if (data.executionMetadata !== undefined) botVaultRow.executionMetadata = data.executionMetadata;
            if (data.withdrawnUsd?.increment !== undefined) botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
            if (data.claimedProfitUsd?.increment !== undefined) botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
            if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
            if (data.principalReturned !== undefined && data.principalReturned?.increment !== undefined) {
              botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
            }
            if (data.feePaidTotal !== undefined) botVaultRow.feePaidTotal = Number(data.feePaidTotal);
            if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
            if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
            if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
            if (data.status !== undefined) botVaultRow.status = data.status;
            return { ...botVaultRow };
          }
        },
        feeEvent: {
          async create() {
            throw new Error("fee_event_write_failed");
          }
        }
      };
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(botVaultRow, snapshot);
        feeEvents.clear();
        for (const [key, value] of feeSnapshot.entries()) feeEvents.set(key, value);
        throw error;
      }
    },
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) botVaultRow.executionMetadata = data.executionMetadata;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 300_000n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 4_000_000n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
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
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "26.0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const result = await service.claimProfit({
    userId: "user_1",
    botId: "bot_claim_fee_pending",
    amountUsd: 1
  });

  assert.equal(result.postProcessingStage, "pending");
  assert.match(String(result.postProcessingReason), /fee_event_write_failed/);
  assert.equal(botVaultRow.claimedProfitUsd, 1);
  assert.equal(botVaultRow.withdrawnUsd, 0.7);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.stage, "applied");
  assert.match(String(botVaultRow.executionMetadata?.claimSettlement?.lastError ?? ""), /fee_event_write_failed/);
  assert.deepEqual(botVaultRow.executionMetadata?.claimSettlement?.postProcessing?.pendingSteps, ["fee_event"]);
  assert.equal(feeEvents.size, 0);
});

test("reconcileBotVaultV3ById resumes confirmed claim-profit post-processing", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const feeEvents = new Map<string, any>();
  const botVaultRow: any = {
    id: "bv_claim_resume",
    botId: "bot_claim_resume",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    controllerAddress,
    vaultAddress,
    principalReturned: 0,
    availableUsd: 5,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0.1,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "ACTIVE",
    executionMetadata: {
      claimSettlement: {
        sourceAction: "claim_profit",
        sourceKey: "bot_vault_v3:bv_claim_resume:claim_profit:0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:settlement",
        feeEventSourceKey: "bot_vault_v3:bv_claim_resume:claim_profit:0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:settlement:fee_event",
        claimTxHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        feeRatePct: 30,
        treasuryRecipient: "0x4444444444444444444444444444444444444444",
        grossAmountUsd: 1,
        feeAmountUsd: 0.3,
        netReturnedUsd: 0.7,
        excludedPrincipalUsd: 0,
        stage: "confirmed",
        preparedAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
        confirmedAt: new Date("2026-04-14T00:00:01.000Z").toISOString(),
        appliedAt: null,
        updatedAt: new Date("2026-04-14T00:00:01.000Z").toISOString(),
        lastError: "fee_event_write_failed"
      }
    }
  };

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) botVaultRow.executionMetadata = data.executionMetadata;
        if (data.withdrawnUsd?.increment !== undefined) botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        if (data.claimedProfitUsd?.increment !== undefined) botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.feePaidTotal !== undefined) botVaultRow.feePaidTotal = Number(data.feePaidTotal);
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 300_000n;
            case "factory":
              return "0x3333333333333333333333333333333333333333";
            case "balanceOf":
              return 4_000_000n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const summary = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_claim_resume"
  });

  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.stage, "applied");
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.lastError, null);
  assert.equal(botVaultRow.withdrawnUsd, 0.7);
  assert.equal(botVaultRow.claimedProfitUsd, 1);
  assert.equal(feeEvents.size, 1);
  assert.equal(summary?.reconciliation?.issues.some((issue: any) => issue.code === "claim_profit_post_processing_pending_apply"), true);
});

test("claimProfit serializes controller nonces across concurrent vault claims", async (t) => {
  resetSerializedControllerTransactionStateForTests();
  t.after(() => resetSerializedControllerTransactionStateForTests());

  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const sentNonces: number[] = [];
  let getTransactionCountCalls = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        const botId = String(args?.where?.botId ?? "");
        if (botId !== "bot_claim_a" && botId !== "bot_claim_b") return null;
        return {
          id: botId === "bot_claim_a" ? "bv_claim_a" : "bv_claim_b",
          botId,
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress,
          vaultAddress: botId === "bot_claim_a"
            ? "0x1111111111111111111111111111111111111111"
            : "0x1212121212121212121212121212121212121212"
        };
      },
      async findUnique(args: any) {
        const id = String(args?.where?.id ?? "");
        if (id === "bv_claim_a") {
          return {
            id: "bv_claim_a",
            botId: "bot_claim_a",
            userId: "user_1",
            vaultModel: "bot_vault_v3",
            controllerAddress,
            vaultAddress: "0x1111111111111111111111111111111111111111",
            executionMetadata: {}
          };
        }
        if (id === "bv_claim_b") {
          return {
            id: "bv_claim_b",
            botId: "bot_claim_b",
            userId: "user_1",
            vaultModel: "bot_vault_v3",
            controllerAddress,
            vaultAddress: "0x1212121212121212121212121212121212121212",
            executionMetadata: {}
          };
        }
        return null;
      },
      async update(args: any) {
        return args.data;
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 25_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 80_000n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return 25_800_000n;
            case "profitShareFeeRatePct":
              return 10n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async getTransactionCount() {
          getTransactionCountCalls += 1;
          return 4100;
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          sentNonces.push(Number(args.nonce));
          return sentNonces.length === 1
            ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    })
  });

  const [first, second] = await Promise.all([
    service.claimProfit({
      userId: "user_1",
      botId: "bot_claim_a",
      amountUsd: 0.5
    }),
    service.claimProfit({
      userId: "user_1",
      botId: "bot_claim_b",
      amountUsd: 0.5
    })
  ]);

  assert.equal(getTransactionCountCalls, 1);
  assert.deepEqual(sentNonces, [4100, 4101]);
  assert.deepEqual(
    [first.claimTxHash, second.claimTxHash].sort(),
    [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]
  );
});

test("claimProfit refreshes serialized controller nonce after nonce sync errors", async (t) => {
  resetSerializedControllerTransactionStateForTests();
  t.after(() => resetSerializedControllerTransactionStateForTests());

  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const sentNonces: number[] = [];
  let getTransactionCountCalls = 0;
  let sendAttempts = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_claim_retry",
          botId: "bot_claim_retry",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress,
          vaultAddress: "0x1111111111111111111111111111111111111111"
        };
      },
      async findUnique(args: any) {
        if (String(args?.where?.id ?? "") !== "bv_claim_retry") return null;
        return {
          id: "bv_claim_retry",
          botId: "bot_claim_retry",
          userId: "user_1",
          vaultModel: "bot_vault_v3",
          controllerAddress,
          vaultAddress: "0x1111111111111111111111111111111111111111",
          executionMetadata: {}
        };
      },
      async update(args: any) {
        return args.data;
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "principalDeposited":
              return 25_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 80_000n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return 25_800_000n;
            case "profitShareFeeRatePct":
              return 10n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async getTransactionCount() {
          getTransactionCountCalls += 1;
          return getTransactionCountCalls === 1 ? 4100 : 4105;
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          sentNonces.push(Number(args.nonce));
          sendAttempts += 1;
          if (sendAttempts === 1) {
            throw new Error("nonce too low");
          }
          return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        }
      }
    })
  });

  const result = await service.claimProfit({
    userId: "user_1",
    botId: "bot_claim_retry",
    amountUsd: 0.5
  });

  assert.equal(getTransactionCountCalls, 2);
  assert.deepEqual(sentNonces, [4100, 4105]);
  assert.equal(result.claimTxHash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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

test("buildBotVaultV3ResyncUpdate canonicalizes economically closed close-only state from onchain snapshot", () => {
  const now = new Date("2026-03-03T00:00:00.000Z");
  const result = buildBotVaultV3ResyncUpdate({
    status: "CLOSE_ONLY",
    principalAllocated: 26,
    principalReturned: 25.454059,
    availableUsd: 0,
    feePaidTotal: 1
  }, now);

  assert.deepEqual(result, {
    status: "CLOSE_ONLY",
    principalAllocated: 26,
    allocatedUsd: 26,
    principalReturned: 25.454059,
    availableUsd: 0,
    feePaidTotal: 1,
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
    lifecycleStatus: "hypercore_funded",
    fundingHealth: "hypercore_funded",
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

test("finalizeMarginAdd activates paused v3 vaults, deposits the missing HyperCore amount, transfers margin to perp, and restores pause", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const sentCalls: string[] = [];
  const usdTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 2;
  let onchainStatus: bigint = 3n;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: "bv_margin",
            vaultAddress,
            controllerAddress,
            executionMetadata: {},
            hypercoreFundingStatus: "not_funded",
            executionStatus: "created",
            status: "PAUSED"
          };
        }
        return {
          id: "bv_margin",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    sleep: async () => {},
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return onchainStatus;
            case "balanceOf":
              return 13_000_000n;
            case "principalDeposited":
              return 135_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          const decoded = decodeFunctionData({
            abi: parseAbi([
              "function activate()",
              "function depositUsdcToHyperCore(uint256 amount)",
              "function pause()"
            ]),
            data: args.data
          });
          sentCalls.push(String(decoded.functionName));
          if (decoded.functionName === "activate") {
            onchainStatus = 2n;
            return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
          }
          if (decoded.functionName === "depositUsdcToHyperCore") {
            assert.equal(decoded.args?.[0], 13_000_000n);
            return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
          }
          if (decoded.functionName === "pause") {
            onchainStatus = 3n;
            return "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
          }
          throw new Error(`unexpected_tx:${String(decoded.functionName)}`);
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async transferUsdClass(input: { amountUsd: number; toPerp: boolean }) {
        usdTransfers.push(input);
        spotBalanceUsd = 0;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        };
      },
      async getAccountState() {
        return {
          availableMargin: 25,
          equity: 25
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.finalizeMarginAdd({
    userId: "user_1",
    botVaultId: "bv_margin",
    amountUsd: 15
  });

  assert.deepEqual(sentCalls, ["activate", "depositUsdcToHyperCore", "pause"]);
  assert.deepEqual(usdTransfers, [{ amountUsd: 15, toPerp: true }]);
  assert.equal(result.depositedAmountUsd, 13);
  assert.equal(result.transferToPerpAmountUsd, 15);
  assert.equal(result.coreSpotBalanceBeforeUsd, 2);
  assert.equal(result.coreSpotBalanceAfterUsd, 0);
  assert.equal(result.restoredPaused, true);
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "funded");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationState, "funding_verified");
});

test("finalizeMarginAdd keeps hypercore funding pending until the perp transfer is visible", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 2;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: "bv_margin_pending",
            vaultAddress,
            controllerAddress,
            executionMetadata: {},
            hypercoreFundingStatus: "not_funded",
            executionStatus: "created",
            status: "ACTIVE"
          };
        }
        return {
          id: "bv_margin_pending",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    sleep: async () => {},
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "balanceOf":
              return 13_000_000n;
            case "principalDeposited":
              return 135_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          const decoded = decodeFunctionData({
            abi: parseAbi(["function depositUsdcToHyperCore(uint256 amount)"]),
            data: args.data
          });
          assert.equal(decoded.functionName, "depositUsdcToHyperCore");
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async getAccountState() {
        return {
          availableMargin: 25,
          equity: 25
        };
      },
      async transferUsdClass() {
        // Transfer has been submitted, but the read path still sees the full spot balance.
        spotBalanceUsd = 15;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  await service.finalizeMarginAdd({
    userId: "user_1",
    botVaultId: "bv_margin_pending",
    amountUsd: 15
  });

  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "pending");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationState, "transfer_submitted");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationBlockingReason, "transfer_not_yet_observed");
});

test("finalizeMarginAdd keeps hypercore funding pending when transfer is observed but final state resync fails", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 2;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: "bv_margin_resync_pending",
            vaultAddress,
            controllerAddress,
            executionMetadata: {},
            hypercoreFundingStatus: "not_funded",
            executionStatus: "created",
            status: "ACTIVE"
          };
        }
        return {
          id: "bv_margin_resync_pending",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    sleep: async () => {},
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 2n;
            case "balanceOf":
              return 13_000_000n;
            case "principalDeposited":
              throw new Error("resync_unavailable");
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
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
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async getAccountState() {
        return {
          availableMargin: 25,
          equity: 25
        };
      },
      async transferUsdClass() {
        spotBalanceUsd = 0;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  await service.finalizeMarginAdd({
    userId: "user_1",
    botVaultId: "bv_margin_resync_pending",
    amountUsd: 15
  });

  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "pending");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationState, "transfer_observed");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationBlockingReason, "final_state_resync_unavailable");
});

test("finalizeMarginAdd does not mark paused vaults funded when pause restoration fails", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 2;
  let onchainStatus: bigint = 3n;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: "bv_margin_pause_pending",
            vaultAddress,
            controllerAddress,
            executionMetadata: {},
            hypercoreFundingStatus: "not_funded",
            executionStatus: "paused",
            status: "PAUSED"
          };
        }
        return {
          id: "bv_margin_pause_pending",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    sleep: async () => {},
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return onchainStatus;
            case "balanceOf":
              return 13_000_000n;
            case "principalDeposited":
              return 135_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt(args: any) {
          if (String(args.hash).startsWith("0xcccc")) {
            throw new Error("pause_receipt_unavailable");
          }
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: any) {
          const decoded = decodeFunctionData({
            abi: parseAbi([
              "function activate()",
              "function depositUsdcToHyperCore(uint256 amount)",
              "function pause()"
            ]),
            data: args.data
          });
          if (decoded.functionName === "activate") {
            onchainStatus = 2n;
            return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
          }
          if (decoded.functionName === "pause") {
            onchainStatus = 3n;
            return "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
          }
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async getAccountState() {
        return {
          availableMargin: 25,
          equity: 25
        };
      },
      async transferUsdClass() {
        spotBalanceUsd = 0;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.finalizeMarginAdd({
    userId: "user_1",
    botVaultId: "bv_margin_pause_pending",
    amountUsd: 15
  });

  assert.equal(result.restoredPaused, false);
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "pending");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationBlockingReason, "paused_restore_unconfirmed");
});

test("reduceMargin transfers margin from perp back to HyperCore spot for v3 vaults", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const usdTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 1;
  let availableMarginUsd = 10;
  let equityUsd = 10;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: "bv_reduce",
            vaultAddress,
            executionMetadata: {}
          };
        }
        return {
          id: "bv_reduce",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async getAccountState() {
        return { availableMargin: availableMarginUsd, equity: equityUsd };
      },
      async transferUsdClass(input: { amountUsd: number; toPerp: boolean }) {
        usdTransfers.push(input);
        spotBalanceUsd = 6;
        availableMarginUsd = 5;
        equityUsd = 5;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ok: true
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce",
    amountUsd: 5
  });

  assert.deepEqual(usdTransfers, [{ amountUsd: 5, toPerp: false }]);
  assert.equal(result.coreSpotBalanceBeforeUsd, 1);
  assert.equal(result.coreSpotBalanceAfterUsd, 6);
  assert.equal(result.releasedAmountUsd, 5);
  assert.equal(result.verificationState, "reduction_verified");
  assert.equal(result.verificationBlockingReason, null);
  assert.equal(result.transferResultStatus, "confirmed");
  assert.equal(result.finalPerpStateReadable, true);
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.stage === "verified"),
    true
  );
});

test("reduceMargin keeps verification pending until the HyperCore spot balance reflects the transfer", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 1;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: "bv_reduce_pending",
            vaultAddress,
            executionMetadata: {}
          };
        }
        return {
          id: "bv_reduce_pending",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async getAccountState() {
        return { availableMargin: 5, equity: 5 };
      },
      async transferUsdClass() {
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ok: true
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_pending",
    amountUsd: 5
  });

  assert.equal(result.coreSpotBalanceBeforeUsd, 1);
  assert.equal(result.coreSpotBalanceAfterUsd, 1);
  assert.equal(result.verificationState, "transfer_submitted");
  assert.equal(result.verificationBlockingReason, "transfer_not_yet_observed");
  assert.equal(result.transferResultStatus, "confirmed");
  assert.equal(result.finalPerpStateReadable, true);
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.stage === "submitted"),
    true
  );
  assert.equal(
    dbUpdates.some(
      (entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.verificationBlockingReason === "transfer_not_yet_observed"
    ),
    true
  );
});

test("reduceMargin resumes a submitted transfer without re-sending when visibility appears after interruption", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let transferCalls = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: "bv_reduce_resume",
            vaultAddress,
            executionMetadata: {
              reduceMarginFinalization: {
                releasedAmountUsd: 5,
                coreSpotBalanceBeforeUsd: 1,
                stage: "submitted",
                transferResultStatus: "confirmed"
              }
            }
          };
        }
        return {
          id: "bv_reduce_resume",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
      }
    },
    decryptSecret: (value) => value,
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: 6 };
      },
      async getAccountState() {
        return { availableMargin: 5, equity: 5 };
      },
      async transferUsdClass() {
        transferCalls += 1;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          ok: true
        };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_resume",
    amountUsd: 5
  });

  assert.equal(transferCalls, 0);
  assert.equal(result.coreSpotBalanceBeforeUsd, 1);
  assert.equal(result.coreSpotBalanceAfterUsd, 6);
  assert.equal(result.verificationState, "reduction_verified");
  assert.equal(result.verificationBlockingReason, null);
  assert.equal(result.transferResultStatus, "confirmed");
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.stage === "verified"),
    true
  );
});

test("controllerCloseBotVault buys exit gas and settles Hypercore exposure before closing", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const systemAddress = "0x4444444444444444444444444444444444444444";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const closeOnlyTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const dbUpdates: any[] = [];
  const closeCalls: Array<{ symbol: string; side?: "long" | "short" }> = [];
  const usdClassTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const spotTransfers: Array<{ amountUsd: number }> = [];
  const coreWriterBuyCalls: Array<{
    asset: number;
    isBuy: boolean;
    limitPx: number;
    sz: number;
    reduceOnly: boolean;
    encodedTif: 1 | 2 | 3;
    clientOrderId: string;
  }> = [];
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
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-1",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
        return {
          address: agentAddress,
          privateKey: agentPrivateKey
        };
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
            case "feePaidTotal":
              return 0n;
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
    readHyperliquidSpotAssetBalance: async (_address, asset) => {
      if (asset === "USDC") return String(coreSpotUsdcBalance);
      if (asset === "HYPE") return String(coreSpotHypeBalance);
      return "0";
    },
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [{
          symbol: "HYPEUSDC",
          exchangeSymbol: "HYPE/USDC",
          assetIndex: 7,
          tradable: true,
          stepSize: 0.01,
          minQty: 0.01,
          baseAsset: "HYPE",
          quoteAsset: "USDC"
        }];
      },
      async getLastPrice() {
        return 10;
      }
    }),
    createVaultCoreWriter: () => ({
      async placeLimitOrder(input) {
        coreWriterBuyCalls.push(input);
        coreSpotUsdcBalance = Number((coreSpotUsdcBalance - input.sz * 10).toFixed(6));
        coreSpotHypeBalance = Number((coreSpotHypeBalance + input.sz).toFixed(6));
        return {
          orderId: "cloid:10007:1",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          clientOrderId: input.clientOrderId
        };
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
  assert.equal(adapterAccounts[0]?.apiKey, agentAddress);
  assert.equal(adapterAccounts[0]?.apiSecret, agentPrivateKey);
  assert.equal(adapterAccounts[0]?.passphrase, vaultAddress);
  assert.equal(adapterAccounts[0]?.botVaultAddress, vaultAddress);
  assert.deepEqual(closeCalls, [{ symbol: "BTCUSDT", side: "long" }]);
  assert.deepEqual(usdClassTransfers, [{ amountUsd: 3.96498, toPerp: false }]);
  assert.equal(coreWriterBuyCalls.length, 1);
  assert.equal(coreWriterBuyCalls[0]?.asset, 10007);
  assert.equal(coreWriterBuyCalls[0]?.isBuy, true);
  assert.equal(coreWriterBuyCalls[0]?.reduceOnly, false);
  assert.equal(coreWriterBuyCalls[0]?.encodedTif, 3);
  assert.equal(coreWriterBuyCalls[0]?.sz, 0.05);
  assert.equal(coreWriterBuyCalls[0]?.limitPx, 10.005);
  assert.match(String(coreWriterBuyCalls[0]?.clientOrderId), /^bot-vault-exit-gas-/);
  assert.deepEqual(spotTransfers, [{ amountUsd: 4.5 }]);
  assert.ok(dbUpdates.length >= 1);
});

test("controllerCloseBotVault persists settled accounting when the contract remains in CLOSE_ONLY after close", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const dbUpdates: any[] = [];
  let stage: "before_close" | "after_close" = "before_close";

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close_only",
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
              return 4n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 0n : 6_000_000n;
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
          stage = "after_close";
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotAssetBalance: async () => "0",
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close_only"
  });

  assert.equal(result.closeOnlyTxHash, null);
  assert.equal(result.onchainStatusBefore, "CLOSE_ONLY");
  assert.equal(result.onchainStatusAfterCloseOnly, "CLOSE_ONLY");
  const resyncUpdate = dbUpdates.find((entry) => entry?.data?.principalAllocated === 6);
  const settlementUpdate = dbUpdates.find((entry) => entry?.data?.withdrawnUsd?.increment === 6);
  assert.ok(resyncUpdate);
  assert.ok(settlementUpdate);
  assert.deepEqual(resyncUpdate?.data, {
    status: "CLOSE_ONLY",
    principalAllocated: 6,
    allocatedUsd: 6,
    principalReturned: 6,
    availableUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    endedAt: resyncUpdate?.data?.endedAt,
    closedAt: resyncUpdate?.data?.closedAt
  });
  assert.deepEqual(settlementUpdate?.data, {
    status: "CLOSE_ONLY",
    principalAllocated: 6,
    allocatedUsd: 6,
    principalReturned: 6,
    availableUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    endedAt: settlementUpdate?.data?.endedAt,
    closedAt: settlementUpdate?.data?.closedAt,
    withdrawnUsd: { increment: 6 },
    claimedProfitUsd: { increment: 0 },
    executionLastError: null,
    executionLastErrorAt: null,
    executionMetadata: settlementUpdate?.data?.executionMetadata
  });
  assert.equal(settlementUpdate?.data?.executionMetadata?.closeSettlement?.stage, "applied");
});

test("controllerCloseBotVault fails closed before sending close tx when prepared settlement persistence fails", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const botVaultRow: any = {
    id: "bv_close_prepare_fail",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {
      hypercoreAccountingFeeUsd: 1
    }
  };
  let sendCount = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const settlementStage = args?.data?.executionMetadata?.closeSettlement?.stage ?? null;
        if (settlementStage === "prepared") {
          throw new Error("db_close_settlement_prepare_failed");
        }
        if (args?.data?.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = args.data.executionMetadata;
        }
        return { ...botVaultRow };
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
              return 4n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return 6_000_000n;
            case "profitShareFeeRatePct":
              return 10n;
            case "treasuryRecipient":
              return "0x4444444444444444444444444444444444444444";
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
          sendCount += 1;
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotAssetBalance: async () => "0",
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_close_prepare_fail"
    }),
    /bot_vault_v3_settlement_persist_failed:close_vault:prepared:bv_close_prepare_fail:Error: db_close_settlement_prepare_failed/
  );

  assert.equal(sendCount, 0);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement, undefined);
});

test("controllerCloseBotVault skips exit gas top-up when Hypercore HYPE already exists", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const systemAddress = "0x4444444444444444444444444444444444444444";
  const coreWriterBuyCalls: Array<{ asset: number }> = [];
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
            case "feePaidTotal":
              return 0n;
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
    readHyperliquidSpotAssetBalance: async (_address, asset) => {
      if (asset === "HYPE") return "0.05";
      if (asset === "USDC") return "5";
      return "0";
    },
    readHyperliquidSpotUsdcBalance: async () => "0",
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [];
      },
      async getLastPrice() {
        return 0;
      }
    }),
    createVaultCoreWriter: () => ({
      async placeLimitOrder(input) {
        coreWriterBuyCalls.push({ asset: input.asset });
        return {
          orderId: "cloid:0:1",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          clientOrderId: input.clientOrderId
        };
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

  assert.deepEqual(coreWriterBuyCalls, []);
});

test("controllerCloseBotVault caps principal returned to gross balance when the vault closes at a loss", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const closeTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closeVaultAbi = parseAbi(["function closeVault(uint256 principalToReturn, uint256 grossAmount, uint256 feeAmount)"]);
  const sentCalls: Array<{ to: string; data: `0x${string}` }> = [];
  const dbUpdates: any[] = [];

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress
        };
      },
      async update(args: any) {
        dbUpdates.push(args);
        return args.data;
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 4n;
            case "principalDeposited":
              return 40_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return 25_454_059n;
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
        async sendTransaction(args: { to: string; data: `0x${string}` }) {
          sentCalls.push(args);
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close"
  });

  assert.equal(result.closeOnlyTxHash, null);
  assert.equal(result.closeTxHash, closeTxHash);
  assert.equal(result.principalToReturnAtomic, "25454059");
  assert.equal(result.grossAmountAtomic, "25454059");
  assert.equal(result.feeAmountAtomic, "0");
  assert.equal(sentCalls.length, 1);

  const decoded = decodeFunctionData({
    abi: closeVaultAbi,
    data: sentCalls[0]!.data
  });
  assert.equal(decoded.functionName, "closeVault");
  assert.deepEqual(decoded.args, [25_454_059n, 25_454_059n, 0n]);
  assert.ok(dbUpdates.length >= 1);
});

test("controllerCloseBotVault excludes Hypercore account creation fee from v3 profit share principal", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const closeTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const closeVaultAbi = parseAbi(["function closeVault(uint256 principalToReturn, uint256 grossAmount, uint256 feeAmount)"]);
  const sentCalls: Array<{ to: string; data: `0x${string}` }> = [];
  const feeEventCreates: any[] = [];
  let stage: "before_close" | "after_close" = "before_close";

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close_profit",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            hypercoreAccountingFeeUsd: 1
          }
        };
      },
      async update(args: any) {
        return args.data;
      }
    },
    feeEvent: {
      async create(args: any) {
        feeEventCreates.push(args);
        return args.data;
      }
    }
  } as any, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 4n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 25_000_000n : 0n;
            case "feePaidTotal":
              return stage === "after_close" ? 136_217n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 0n : 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return treasuryRecipient;
            default:
              throw new Error(`unexpected_function:${String(args.functionName)}`);
          }
        },
        async waitForTransactionReceipt() {
          return { status: "success" };
        }
      },
      walletClient: {
        async sendTransaction(args: { to: string; data: `0x${string}` }) {
          sentCalls.push(args);
          stage = "after_close";
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close_profit"
  });

  assert.equal(result.closeOnlyTxHash, null);
  assert.equal(result.closeTxHash, closeTxHash);
  assert.equal(result.principalToReturnAtomic, "25000000");
  assert.equal(result.grossAmountAtomic, "25454059");
  assert.equal(result.feeAmountAtomic, "136217");
  assert.equal(sentCalls.length, 1);

  const decoded = decodeFunctionData({
    abi: closeVaultAbi,
    data: sentCalls[0]!.data
  });
  assert.equal(decoded.functionName, "closeVault");
  assert.deepEqual(decoded.args, [25_000_000n, 25_454_059n, 136_217n]);
  assert.deepEqual(feeEventCreates, [
    {
      data: {
        botVaultId: "bv_close_profit",
        eventType: "PROFIT_SHARE",
        profitBase: 0.454059,
        feeAmount: 0.136217,
        sourceKey: "bot_vault_v3:bv_close_profit:close_vault:settlement:fee_event",
        metadata: {
          treasuryPayoutModel: "onchain_treasury_v1",
          contractVersion: "bot_vault_treasury_v3",
          treasuryRecipient,
          feeRatePct: 30,
          txHash: closeTxHash,
          sourceAction: "close_vault",
          grossAmountUsd: 25.454059,
          netReturnedUsd: 25.317842,
          excludedPrincipalUsd: 1
        }
      }
    }
  ]);
});

test("controllerCloseBotVault persists recoverable pending state when resync fails after close tx", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const closeTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const botVaultRow: any = {
    id: "bv_retry_safe",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {},
    principalReturned: 0,
    availableUsd: 6,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "CLOSE_ONLY",
    endedAt: null,
    closedAt: null
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_close" | "after_close" = "before_close";
  let failResyncReads = 1;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned?.increment !== undefined) {
          botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
        } else if (data.principalReturned !== undefined) {
          botVaultRow.principalReturned = Number(data.principalReturned);
        }
        if (data.availableUsd !== undefined) {
          botVaultRow.availableUsd = Number(data.availableUsd);
        }
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal?.increment !== undefined) {
          botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
        } else if (data.feePaidTotal !== undefined) {
          botVaultRow.feePaidTotal = Number(data.feePaidTotal);
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };
  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              if (stage === "after_close" && failResyncReads > 0) {
                failResyncReads -= 1;
                throw new Error("resync_failed");
              }
              return stage === "after_close" ? 5n : 4n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 6_000_000n : 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 0n : 6_000_000n;
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
          stage = "after_close";
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_retry_safe"
    }),
    /bot_vault_v3_close_post_processing_pending:bv_retry_safe:Error: resync_failed/
  );
  assert.equal(botVaultRow.withdrawnUsd, 0);
  assert.equal(botVaultRow.claimedProfitUsd, 0);
  assert.equal(botVaultRow.principalReturned, 0);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.stage, "confirmed");
  assert.deepEqual(botVaultRow.executionMetadata?.closeSettlement?.postProcessing?.pendingSteps, ["resync", "apply"]);

  await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_retry_safe"
  });
  assert.equal(botVaultRow.withdrawnUsd, 6);
  assert.equal(botVaultRow.claimedProfitUsd, 0);
  assert.equal(botVaultRow.principalReturned, 6);
  assert.equal(feeEvents.size, 0);
});

test("controllerCloseBotVault resumes settlement after tx success when applied persistence failed once", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const botVaultRow: any = {
    id: "bv_resume_close",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {
      hypercoreAccountingFeeUsd: 1
    },
    principalReturned: 0,
    availableUsd: 25.454059,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "CLOSE_ONLY",
    endedAt: null,
    closedAt: null
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_close" | "after_close" = "before_close";
  let failAppliedOnce = true;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        const settlementStage = data.executionMetadata?.closeSettlement?.stage ?? null;
        if (settlementStage === "applied" && failAppliedOnce) {
          failAppliedOnce = false;
          throw new Error("db_settlement_write_failed");
        }
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned !== undefined) {
          if (data.principalReturned?.increment !== undefined) {
            botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
          } else {
            botVaultRow.principalReturned = Number(data.principalReturned);
          }
        }
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal !== undefined) {
          if (data.feePaidTotal?.increment !== undefined) {
            botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
          } else {
            botVaultRow.feePaidTotal = Number(data.feePaidTotal);
          }
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return stage === "after_close" ? 5n : 4n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 25_000_000n : 0n;
            case "feePaidTotal":
              return stage === "after_close" ? 136_217n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 0n : 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return treasuryRecipient;
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
          stage = "after_close";
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_resume_close"
    }),
    /bot_vault_v3_close_post_processing_pending:bv_resume_close:Error: db_settlement_write_failed/
  );
  assert.equal(botVaultRow.withdrawnUsd, 0);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.stage, "confirmed");
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.feeAmountUsd, 0.136217);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.netReturnedUsd, 25.317842);
  assert.deepEqual(botVaultRow.executionMetadata?.closeSettlement?.postProcessing?.pendingSteps, ["resync", "apply", "fee_event"]);

  await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_resume_close"
  });

  assert.equal(botVaultRow.withdrawnUsd, 25.317842);
  assert.equal(botVaultRow.claimedProfitUsd, 0.454059);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.stage, "applied");
  assert.equal(feeEvents.size, 1);
  assert.equal(
    [...feeEvents.keys()][0],
    "bot_vault_v3:bv_resume_close:close_vault:settlement:fee_event"
  );
});

test("controllerCloseBotVault resumes from stored prepared settlement when confirmed settlement persistence failed", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const botVaultRow: any = {
    id: "bv_resume_close_confirm",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {
      hypercoreAccountingFeeUsd: 1
    },
    principalReturned: 0,
    availableUsd: 25.454059,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    status: "CLOSE_ONLY",
    endedAt: null,
    closedAt: null
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_close" | "after_close" = "before_close";
  let sendCount = 0;
  let failConfirmedOnce = true;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        const settlementStage = data.executionMetadata?.closeSettlement?.stage ?? null;
        if (settlementStage === "confirmed" && failConfirmedOnce) {
          failConfirmedOnce = false;
          throw new Error("db_close_settlement_confirm_failed");
        }
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned !== undefined) {
          if (data.principalReturned?.increment !== undefined) {
            botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
          } else {
            botVaultRow.principalReturned = Number(data.principalReturned);
          }
        }
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal !== undefined) {
          if (data.feePaidTotal?.increment !== undefined) {
            botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
          } else {
            botVaultRow.feePaidTotal = Number(data.feePaidTotal);
          }
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return stage === "after_close" ? 5n : 4n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return stage === "after_close" ? 25_000_000n : 0n;
            case "feePaidTotal":
              return stage === "after_close" ? 136_217n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_close" ? 0n : 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return treasuryRecipient;
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
          sendCount += 1;
          stage = "after_close";
          return closeTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_resume_close_confirm"
    }),
    /bot_vault_v3_settlement_persist_failed:close_vault:confirmed:bv_resume_close_confirm:Error: db_close_settlement_confirm_failed/
  );

  assert.equal(sendCount, 1);
  assert.equal(botVaultRow.withdrawnUsd, 0);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.stage, "prepared");
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.closeTxHash, null);

  const resumed = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_resume_close_confirm"
  });

  assert.equal(resumed.closeTxHash, null);
  assert.equal(sendCount, 1);
  assert.equal(botVaultRow.withdrawnUsd, 25.317842);
  assert.equal(botVaultRow.claimedProfitUsd, 0.454059);
  assert.equal(botVaultRow.executionMetadata?.closeSettlement?.stage, "applied");
  assert.equal(feeEvents.size, 1);
});

test("controllerRecoverClosedBotVault persists recoverable pending state when resync fails after recover tx", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const recoverTxHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const botVaultRow: any = {
    id: "bv_recover_retry_safe",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {},
    principalReturned: 0,
    availableUsd: 6,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    status: "CLOSE_ONLY",
    endedAt: new Date("2026-04-14T00:00:00.000Z"),
    closedAt: new Date("2026-04-14T00:00:00.000Z")
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_recover" | "after_recover" = "before_recover";
  let failResyncReads = 1;
  let sendCount = 0;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned?.increment !== undefined) {
          botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
        } else if (data.principalReturned !== undefined) {
          botVaultRow.principalReturned = Number(data.principalReturned);
        }
        if (data.availableUsd !== undefined) {
          botVaultRow.availableUsd = Number(data.availableUsd);
        }
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal?.increment !== undefined) {
          botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
        } else if (data.feePaidTotal !== undefined) {
          botVaultRow.feePaidTotal = Number(data.feePaidTotal);
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              if (stage === "after_recover" && failResyncReads > 0) {
                failResyncReads -= 1;
                throw new Error("resync_failed");
              }
              return stage === "after_recover" ? 5n : 4n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return stage === "after_recover" ? 6_000_000n : 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_recover" ? 0n : 6_000_000n;
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
          sendCount += 1;
          stage = "after_recover";
          return recoverTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.controllerRecoverClosedBotVault({
      userId: "user_1",
      botVaultId: "bv_recover_retry_safe"
    }),
    /bot_vault_v3_recovery_post_processing_pending:bv_recover_retry_safe:Error: resync_failed/
  );
  assert.equal(botVaultRow.withdrawnUsd, 0);
  assert.equal(botVaultRow.claimedProfitUsd, 0);
  assert.equal(botVaultRow.principalReturned, 0);
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.stage, "confirmed");
  assert.deepEqual(botVaultRow.executionMetadata?.recoverySettlement?.postProcessing?.pendingSteps, ["resync", "apply"]);

  const second = await service.controllerRecoverClosedBotVault({
    userId: "user_1",
    botVaultId: "bv_recover_retry_safe"
  });
  assert.equal(second.recoverTxHash, recoverTxHash);
  assert.equal(botVaultRow.withdrawnUsd, 6);
  assert.equal(botVaultRow.claimedProfitUsd, 0);
  assert.equal(botVaultRow.principalReturned, 6);
  assert.equal(feeEvents.size, 0);
  assert.equal(sendCount, 1);
});

test("controllerRecoverClosedBotVault reuses stored settlement on repeated recovery calls", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const recoverTxHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  const botVaultRow: any = {
    id: "bv_recover_repeat",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {
      hypercoreAccountingFeeUsd: 1
    },
    principalReturned: 0,
    availableUsd: 25.454059,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    status: "CLOSED",
    endedAt: new Date("2026-04-14T00:00:00.000Z"),
    closedAt: new Date("2026-04-14T00:00:00.000Z")
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_recover" | "after_recover" = "before_recover";
  let sendCount = 0;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned !== undefined) {
          if (data.principalReturned?.increment !== undefined) {
            botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
          } else {
            botVaultRow.principalReturned = Number(data.principalReturned);
          }
        }
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal !== undefined) {
          if (data.feePaidTotal?.increment !== undefined) {
            botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
          } else {
            botVaultRow.feePaidTotal = Number(data.feePaidTotal);
          }
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 5n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return stage === "after_recover" ? 25_000_000n : 0n;
            case "feePaidTotal":
              return stage === "after_recover" ? 136_217n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_recover" ? 0n : 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return treasuryRecipient;
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
          sendCount += 1;
          stage = "after_recover";
          return recoverTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  const first = await service.controllerRecoverClosedBotVault({
    userId: "user_1",
    botVaultId: "bv_recover_repeat"
  });
  assert.equal(first.recoverTxHash, recoverTxHash);
  assert.equal(botVaultRow.withdrawnUsd, 25.317842);
  assert.equal(botVaultRow.claimedProfitUsd, 0.454059);
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.stage, "applied");
  assert.equal(feeEvents.size, 1);
  assert.equal(
    [...feeEvents.keys()][0],
    "bot_vault_v3:bv_recover_repeat:recover_closed_funds:settlement:fee_event"
  );

  const second = await service.controllerRecoverClosedBotVault({
    userId: "user_1",
    botVaultId: "bv_recover_repeat"
  });
  assert.equal(second.recoverTxHash, recoverTxHash);
  assert.equal(botVaultRow.withdrawnUsd, 25.317842);
  assert.equal(botVaultRow.claimedProfitUsd, 0.454059);
  assert.equal(feeEvents.size, 1);
  assert.equal(sendCount, 1);
});

test("controllerRecoverClosedBotVault resumes settlement after tx success when applied persistence failed once", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const recoverTxHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const botVaultRow: any = {
    id: "bv_recover_resume",
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    executionMetadata: {
      hypercoreAccountingFeeUsd: 1
    },
    principalReturned: 0,
    availableUsd: 25.454059,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    status: "CLOSED",
    endedAt: new Date("2026-04-14T00:00:00.000Z"),
    closedAt: new Date("2026-04-14T00:00:00.000Z")
  };
  const feeEvents = new Map<string, any>();
  let stage: "before_recover" | "after_recover" = "before_recover";
  let failAppliedOnce = true;

  const dbLayer: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback(dbLayer),
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async findUnique() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        const data = args.data ?? {};
        const settlementStage = data.executionMetadata?.recoverySettlement?.stage ?? null;
        if (settlementStage === "applied" && failAppliedOnce) {
          failAppliedOnce = false;
          throw new Error("db_settlement_write_failed");
        }
        if (data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = data.executionMetadata;
        }
        if (data.principalReturned !== undefined) {
          if (data.principalReturned?.increment !== undefined) {
            botVaultRow.principalReturned = Number((botVaultRow.principalReturned + Number(data.principalReturned.increment)).toFixed(6));
          } else {
            botVaultRow.principalReturned = Number(data.principalReturned);
          }
        }
        if (data.availableUsd !== undefined) botVaultRow.availableUsd = Number(data.availableUsd);
        if (data.withdrawnUsd?.increment !== undefined) {
          botVaultRow.withdrawnUsd = Number((botVaultRow.withdrawnUsd + Number(data.withdrawnUsd.increment)).toFixed(6));
        }
        if (data.claimedProfitUsd?.increment !== undefined) {
          botVaultRow.claimedProfitUsd = Number((botVaultRow.claimedProfitUsd + Number(data.claimedProfitUsd.increment)).toFixed(6));
        }
        if (data.feePaidTotal !== undefined) {
          if (data.feePaidTotal?.increment !== undefined) {
            botVaultRow.feePaidTotal = Number((botVaultRow.feePaidTotal + Number(data.feePaidTotal.increment)).toFixed(6));
          } else {
            botVaultRow.feePaidTotal = Number(data.feePaidTotal);
          }
        }
        if (data.fundingStatus !== undefined) botVaultRow.fundingStatus = data.fundingStatus;
        if (data.hypercoreFundingStatus !== undefined) botVaultRow.hypercoreFundingStatus = data.hypercoreFundingStatus;
        if (data.executionStatus !== undefined) botVaultRow.executionStatus = data.executionStatus;
        if (data.status !== undefined) botVaultRow.status = data.status;
        if (data.endedAt !== undefined) botVaultRow.endedAt = data.endedAt;
        if (data.closedAt !== undefined) botVaultRow.closedAt = data.closedAt;
        return { ...botVaultRow };
      }
    },
    feeEvent: {
      async create(args: any) {
        const sourceKey = String(args?.data?.sourceKey ?? "");
        if (feeEvents.has(sourceKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        feeEvents.set(sourceKey, args.data);
        return args.data;
      }
    }
  };

  const service = createBotVaultV3Service(dbLayer, {
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          switch (args.functionName) {
            case "status":
              return 5n;
            case "principalDeposited":
              return 26_000_000n;
            case "principalReturned":
              return stage === "after_recover" ? 25_000_000n : 0n;
            case "feePaidTotal":
              return stage === "after_recover" ? 136_217n : 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return stage === "after_recover" ? 0n : 25_454_059n;
            case "profitShareFeeRatePct":
              return 30n;
            case "treasuryRecipient":
              return treasuryRecipient;
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
          stage = "after_recover";
          return recoverTxHash;
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "0"
  });

  await assert.rejects(
    service.controllerRecoverClosedBotVault({
      userId: "user_1",
      botVaultId: "bv_recover_resume"
    }),
    /bot_vault_v3_recovery_post_processing_pending:bv_recover_resume:Error: db_settlement_write_failed/
  );
  assert.equal(botVaultRow.withdrawnUsd, 0);
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.stage, "confirmed");
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.feeAmountUsd, 0.136217);
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.netReturnedUsd, 25.317842);
  assert.deepEqual(botVaultRow.executionMetadata?.recoverySettlement?.postProcessing?.pendingSteps, ["resync", "apply", "fee_event"]);

  const resumed = await service.controllerRecoverClosedBotVault({
    userId: "user_1",
    botVaultId: "bv_recover_resume"
  });
  assert.equal(resumed.recoverTxHash, recoverTxHash);
  assert.equal(botVaultRow.withdrawnUsd, 25.317842);
  assert.equal(botVaultRow.claimedProfitUsd, 0.454059);
  assert.equal(botVaultRow.executionMetadata?.recoverySettlement?.stage, "applied");
  assert.equal(feeEvents.size, 1);
  assert.equal(
    [...feeEvents.keys()][0],
    "bot_vault_v3:bv_recover_resume:recover_closed_funds:settlement:fee_event"
  );
});

test("controllerCloseBotVault retries rate-limited Hypercore exit reads", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const sleepCalls: number[] = [];
  let stage: "before_close_only" | "after_close_only" | "after_close" = "before_close_only";
  let sendTransactionCount = 0;
  let exitCheckReadCount = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress
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
            case "feePaidTotal":
              return 0n;
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
      exitCheckReadCount += 1;
      if (exitCheckReadCount <= 2) {
        throw new Error("hyperliquid_info_request_failed:429:null");
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
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    }
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close"
  });

  assert.equal(result.closeTxHash, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(exitCheckReadCount, 4);
  assert.deepEqual(sleepCalls, [750, 1500]);
});

test("controllerCloseBotVault continues spot exit when Hyperliquid position reads fail transiently", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const systemAddress = "0x4444444444444444444444444444444444444444";
  let stage: "before_close_only" | "after_close_only" | "after_close" = "before_close_only";
  let sendTransactionCount = 0;
  let listPositionsCallCount = 0;
  let transferredSpotUsd = 0;
  const initialSpotUsdcBalance = 5.939281;

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
              apiKeyEnc: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              apiSecretEnc: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
            case "feePaidTotal":
              return 0n;
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
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotAssetBalance: async (_address, asset) => {
      if (asset === "HYPE") return "0.05";
      if (asset === "USDC") {
        return String(stage === "after_close_only" ? Math.max(0, initialSpotUsdcBalance - transferredSpotUsd) : 0);
      }
      return "0";
    },
    readHyperliquidSpotUsdcBalance: async () => String(
      stage === "after_close_only"
        ? Math.max(0, initialSpotUsdcBalance - transferredSpotUsd)
        : 0
    ),
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [];
      },
      async getLastPrice() {
        return 0;
      }
    }),
    closePositionsMarket: async () => [],
    createPerpExecutionAdapter: () => ({
      async listPositions() {
        listPositionsCallCount += 1;
        throw new Error("HyperliquidAPIError: An unknown error occurred");
      },
      async getAccountState() {
        return { availableMargin: "0" };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: Math.max(0, initialSpotUsdcBalance - transferredSpotUsd),
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        transferredSpotUsd += Number(input.amountUsd ?? 0);
        return { ok: true };
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close"
  });

  assert.equal(result.closeTxHash, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(listPositionsCallCount, 8);
  assert.equal(Number(transferredSpotUsd.toFixed(6)), initialSpotUsdcBalance);
});

test("controllerCloseBotVault does not fall back to exchange account when agent credentials are missing", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const tradingDeskPrivateKey = `0x${"3".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const expectedAgentAddress = privateKeyToAccount(`0x${"4".repeat(64)}` as const).address;
  let adapterCallCount = 0;

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
          agentWallet: expectedAgentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-missing",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: tradingDeskAddress,
              apiSecretEnc: tradingDeskPrivateKey,
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
              return 4n;
            case "principalDeposited":
              return 6_000_000n;
            case "principalReturned":
              return 0n;
            case "feePaidTotal":
              return 0n;
            case "factory":
              return factoryAddress;
            case "balanceOf":
              return 0n;
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
          throw new Error("unexpected_send_transaction");
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "5.939281",
    decryptSecret: (value) => value,
    sleep: async () => {},
    createPerpExecutionAdapter: () => {
      adapterCallCount += 1;
      throw new Error("unexpected_adapter_creation");
    }
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_close"
    }),
    /bot_vault_v3_hypercore_exit_required/
  );
  assert.equal(adapterCallCount, 0);
});
