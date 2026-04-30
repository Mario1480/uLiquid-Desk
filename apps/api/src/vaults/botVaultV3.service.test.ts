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
  assert.equal(result.statusCategory, "user_action_required");
  assert.equal(result.healthSummary.statusCategory, "user_action_required");
  assert.equal(result.executionReadiness.statusCategory, "pending");
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

test("reconcileBotVaultV3ById escalates stale pending funding intents into recovery_required", async () => {
  const staleRequestedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const staleTimeoutAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const botVaultRow: any = {
    id: "bv_timeout",
    botId: "bot_timeout",
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
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    executionMetadata: {
      fundingLifecycle: {
        stage: "funding_requested",
        updatedAt: staleRequestedAt,
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      fundingIntent: {
        sourceKey: "bot_vault_v3_funding:bv_timeout:50",
        actionKey: "bot_vault_v3_funding:bv_timeout:50",
        amountUsd: 50,
        actionStatus: "submitted",
        requestedAt: staleRequestedAt,
        lastBoundAt: staleRequestedAt,
        timeoutAt: staleTimeoutAt,
        verificationState: "requested"
      }
    },
    status: "DEPLOYED",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  const botVaultUpdates: any[] = [];
  const actionUpdates: any[] = [];
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        botVaultUpdates.push(args);
        Object.assign(botVaultRow, args.data);
        if (args.data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = args.data.executionMetadata;
        }
        return { ...botVaultRow };
      }
    },
    onchainAction: {
      async findFirst() {
        return {
          id: "oa_timeout",
          actionKey: "bot_vault_v3_funding:bv_timeout:50",
          status: "submitted"
        };
      },
      async updateMany(args: any) {
        actionUpdates.push(args);
        return { count: 1 };
      }
    }
  } as any);

  const summary = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_timeout"
  });

  assert.ok(summary);
  assert.equal(summary?.fundingLifecycleStage, "recovery_required");
  assert.equal(summary?.healthSummary.fundingHealth, "recovery_required");
  assert.equal(summary?.executionReadiness.reason, "bot_vault_v3_execution_blocked");
  assert.match(String(summary?.executionReadiness.detail), /bot_vault_v3_funding_intent_timeout:submitted/);
  assert.equal(botVaultUpdates.length > 0, true);
  assert.equal(actionUpdates.length, 1);
  assert.equal(actionUpdates[0]?.data?.status, "failed");
  assert.equal((botVaultRow.executionMetadata as any)?.fundingIntent?.actionStatus, "timed_out");
});

test("reconcileBotVaultV3ById does not escalate funding intents that already progressed past funding_requested", async () => {
  const staleRequestedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const staleTimeoutAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const botVaultRow: any = {
    id: "bv_timeout_safe",
    botId: "bot_timeout_safe",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: null,
    vaultAddress: null,
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 0,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "pending",
    executionStatus: "created",
    executionMetadata: {
      fundingLifecycle: {
        stage: "hyper_evm_confirmed",
        updatedAt: staleRequestedAt,
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      fundingIntent: {
        sourceKey: "bot_vault_v3_funding:bv_timeout_safe:50",
        actionKey: "bot_vault_v3_funding:bv_timeout_safe:50",
        amountUsd: 50,
        actionStatus: "submitted",
        requestedAt: staleRequestedAt,
        lastBoundAt: staleRequestedAt,
        timeoutAt: staleTimeoutAt,
        verificationState: "requested"
      }
    },
    status: "FUNDED",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };

  let recoveryEscalated = false;
  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        if (args.data?.executionMetadata?.fundingLifecycle?.stage === "recovery_required") {
          recoveryEscalated = true;
        }
        Object.assign(botVaultRow, args.data);
        if (args.data.executionMetadata !== undefined) {
          botVaultRow.executionMetadata = args.data.executionMetadata;
        }
        return { ...botVaultRow };
      }
    }
  } as any);

  const summary = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_timeout_safe"
  });

  assert.ok(summary);
  assert.equal(summary?.fundingLifecycleStage, "hyper_evm_confirmed");
  assert.equal(recoveryEscalated, false);
});

test("fundBotVault retries from a timed-out recovery_required funding intent", async () => {
  const staleRequestedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const staleTimeoutAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const row = {
    id: "bv_timeout_retry",
    botId: "bot_timeout_retry",
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
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    executionMetadata: {
      fundingLifecycle: {
        stage: "recovery_required",
        updatedAt: staleTimeoutAt,
        failureReason: null,
        recoveryReason: "bot_vault_v3_funding_intent_timeout:submitted",
        history: []
      },
      fundingIntent: {
        sourceKey: "bot_vault_v3_funding:bv_timeout_retry:50",
        actionKey: "bot_vault_v3_funding:bv_timeout_retry:50",
        amountUsd: 50,
        moveToHyperCore: true,
        actionStatus: "timed_out",
        requestedAt: staleRequestedAt,
        lastBoundAt: staleRequestedAt,
        timeoutAt: staleTimeoutAt,
        timedOutAt: staleTimeoutAt,
        timeoutReason: "bot_vault_v3_funding_intent_timeout:submitted",
        retryAttempt: 0,
        verificationState: "timed_out"
      }
    },
    status: "DEPLOYED",
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const failedAction = {
    id: "oa_timeout_retry",
    actionKey: "bot_vault_v3_funding:bv_timeout_retry:50",
    actionType: "fund_bot_vault_v3",
    status: "failed",
    txHash: null,
    metadata: {
      amountUsd: 50
    }
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
            id: "oa_timeout_retry_1",
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
    botId: "bot_timeout_retry",
    amountUsd: 50,
    moveToHyperCore: true
  });

  assert.equal(result.fundingStatus, "hyper_evm_funding_requested");
  assert.equal(result.fundingLifecycleStage, "funding_requested");
  assert.equal(buildArgs?.actionKey, "bot_vault_v3_funding:bv_timeout_retry:50:retry:1");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.retryAttempt, 1);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.actionStatus, "prepared");
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.timeoutReason, null);
  assert.equal(updateArgs?.data?.executionMetadata?.fundingIntent?.timedOutAt, null);
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

test("evaluateBotVaultV3ExecutionReadiness blocks v4 vaults until the HYPE reserve is ready", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"7".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified",
        hypeReserveState: "pending"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v3_hype_reserve_not_ready");
  assert.equal(readiness.stage, "verification");
  assert.equal(readiness.statusCategory, "retryable");
});

test("evaluateBotVaultV3ExecutionReadiness marks fully verified v4 funding as ready", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"8".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    reconciliation: {
      status: "ok",
      checkedAt: "2026-04-29T00:00:00.000Z",
      detail: null,
      autoApplied: false,
      issues: [],
      sourceOfTruth: {
        principalAllocated: "onchain",
        principalReturned: "onchain",
        availableUsd: "onchain",
        claimedProfitUsd: "local_settlement",
        feePaidTotal: "onchain",
        fundingLifecycle: "derived",
        hypercoreFundingLifecycle: "derived",
        executionBalances: "execution"
      },
      onchainSnapshot: null,
      executionSnapshot: {
        state: "ok",
        coreSpotUsd: 2,
        perpAvailableMarginUsd: 25,
        perpEquityUsd: 25,
        totalVisibleUsd: 27,
        detail: null
      }
    },
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-29T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified",
        verificationBlockingReason: null,
        fundingVerified: true,
        marginFundingVerified: true,
        transferObserved: true,
        finalPerpStateReadable: true,
        finalStateResynced: true,
        pauseStateSafe: true,
        hypeReserveState: "ready",
        hypeReserveReady: true,
        perpAvailableMarginAfterUsd: 25,
        perpEquityAfterUsd: 25
      }
    }
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
  assert.equal(readiness.stage, "ready");
  assert.equal(readiness.statusCategory, "execution_ready");
});

test("evaluateBotVaultV3ExecutionReadiness rejects formal v4 execution_ready without verified reserve metadata", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"9".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-29T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified",
        verificationBlockingReason: null,
        hypeReserveState: "ready"
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v4_hype_reserve_not_verified");
  assert.equal(readiness.stage, "verification");
  assert.equal(readiness.statusCategory, "retryable");
});

test("evaluateBotVaultV3ExecutionReadiness rejects v4 when reconcile is ok but perp margin metadata is incomplete", () => {
  const readiness = evaluateBotVaultV3ExecutionReadiness({
    vaultModel: "bot_vault_v3",
    vaultAddress: `0x${"a".repeat(40)}`,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    status: "ACTIVE",
    reconciliation: {
      status: "ok",
      checkedAt: "2026-04-29T00:00:00.000Z",
      detail: null,
      autoApplied: false,
      issues: [],
      sourceOfTruth: {
        principalAllocated: "onchain",
        principalReturned: "onchain",
        availableUsd: "onchain",
        claimedProfitUsd: "local_settlement",
        feePaidTotal: "onchain",
        fundingLifecycle: "derived",
        hypercoreFundingLifecycle: "derived",
        executionBalances: "execution"
      },
      onchainSnapshot: null,
      executionSnapshot: {
        state: "ok",
        coreSpotUsd: 2,
        perpAvailableMarginUsd: 25,
        perpEquityUsd: 25,
        totalVisibleUsd: 27,
        detail: null
      }
    },
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-29T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      },
      marginAddFinalization: {
        verificationState: "funding_verified",
        verificationBlockingReason: null,
        fundingVerified: true,
        marginFundingVerified: true,
        transferObserved: true,
        finalPerpStateReadable: false,
        finalStateResynced: true,
        pauseStateSafe: true,
        hypeReserveState: "ready",
        hypeReserveReady: true,
        perpAvailableMarginAfterUsd: 25,
        perpEquityAfterUsd: 25
      }
    }
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "bot_vault_v4_perp_margin_not_verified");
  assert.equal(readiness.stage, "verification");
  assert.equal(readiness.statusCategory, "retryable");
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

test("evaluateBotVaultV3ExecutionReadiness derives legacy ready state from verified v3 funding metadata", () => {
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

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, "bot_vault_v3_ready");
  assert.equal(readiness.stage, "ready");
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

function usdcAtomic(amountUsd: number): bigint {
  return BigInt(Math.round(amountUsd * 1_000_000));
}

function createBotVaultV3ReconcileHarness(
  botVaultRow: any,
  options: {
    onchain?: {
      status: bigint;
      principalAllocatedUsd: number;
      principalReturnedUsd?: number;
      availableUsd: number;
      feePaidTotalUsd?: number;
    };
    execution?: {
      coreSpotUsd: number;
      perpAvailableMarginUsd: number;
      perpEquityUsd: number;
    };
  }
) {
  if (options.execution) {
    const executionPrivateKey = `0x${"1".repeat(64)}`;
    const executionAddress = privateKeyToAccount(executionPrivateKey as `0x${string}`).address;
    botVaultRow.bot = {
      symbol: "BTCUSDT",
      exchangeAccount: {
        id: "acct_reconcile",
        exchange: "hyperliquid",
        apiKeyEnc: executionAddress,
        apiSecretEnc: executionPrivateKey,
        passphraseEnc: null
      }
    };
  }

  return createBotVaultV3Service({
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
      account: { address: botVaultRow.controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          if (!options.onchain) throw new Error("onchain_snapshot_unavailable");
          switch (args.functionName) {
            case "status":
              return options.onchain.status;
            case "principalDeposited":
              return usdcAtomic(options.onchain.principalAllocatedUsd);
            case "principalReturned":
              return usdcAtomic(options.onchain.principalReturnedUsd ?? 0);
            case "feePaidTotal":
              return usdcAtomic(options.onchain.feePaidTotalUsd ?? 0);
            case "balanceOf":
              return usdcAtomic(options.onchain.availableUsd);
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
        return { amountUsd: options.execution?.coreSpotUsd ?? 0 };
      },
      async getAccountState() {
        return {
          availableMargin: options.execution?.perpAvailableMarginUsd ?? 0,
          equity: options.execution?.perpEquityUsd ?? 0
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
}

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
  assert.equal(result?.fundingLifecycleStage, "perp_margin_transferred");
  assert.equal(result?.reconciliation?.status, "warning");
  assert.ok(result?.reconciliation?.issues.some((issue) => issue.code === "db_onchain_principal_allocated_mismatch"));
  assert.ok(result?.reconciliation?.issues.some((issue) => issue.code === "hypercore_funding_status_out_of_sync"));
  assert.equal(result?.reconciliation?.executionSnapshot.state, "ok");
  assert.equal(result?.reconciliation?.executionSnapshot.totalVisibleUsd, 20);
});

test("reconcileBotVaultV3ById moves locally over-advanced lifecycle to recovery when funding is not observable", async () => {
  const botVaultRow: any = {
    id: "bv_reconcile_no_funding",
    botId: "bot_reconcile_no_funding",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: "0x2222222222222222222222222222222222222222",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 0,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "hypercore_funded",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      }
    },
    status: "ACTIVE",
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const service = createBotVaultV3ReconcileHarness(botVaultRow, {
    onchain: {
      status: 0n,
      principalAllocatedUsd: 0,
      availableUsd: 0
    },
    execution: {
      coreSpotUsd: 0,
      perpAvailableMarginUsd: 0,
      perpEquityUsd: 0
    }
  });

  const result = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_reconcile_no_funding"
  });

  assert.equal(result?.fundingLifecycleStage, "recovery_required");
  assert.equal(result?.healthSummary.fundingHealth, "recovery_required");
  assert.equal(result?.reconciliation?.status, "blocking");
  const issue = result?.reconciliation?.issues.find((entry) => entry.code === "funding_lifecycle_funding_counterevidence");
  assert.ok(issue);
  assert.equal(issue?.mismatchCategory, "local_ahead_of_observed_state");
  assert.equal(issue?.recoveryAction, "recovery_required");
  assert.equal(issue?.recoveryHint, "run_recovery");
  assert.equal(result?.statusReason, "funding_lifecycle_funding_counterevidence");
  assert.equal(result?.statusMismatchCategory, "local_ahead_of_observed_state");
  assert.equal(result?.statusRecoveryAction, "recovery_required");
  assert.equal(result?.statusRecoveryHint, "run_recovery");
});

test("reconcileBotVaultV3ById blocks execution_ready when venue margin prerequisites disappeared", async () => {
  const botVaultRow: any = {
    id: "bv_reconcile_no_margin",
    botId: "bot_reconcile_no_margin",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: "0x2222222222222222222222222222222222222222",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 0,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "running",
    executionMetadata: {
      onchainContractVersion: "v4",
      marginAddFinalization: {
        verificationState: "funding_verified"
      },
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      }
    },
    status: "ACTIVE",
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const service = createBotVaultV3ReconcileHarness(botVaultRow, {
    onchain: {
      status: 1n,
      principalAllocatedUsd: 25,
      availableUsd: 25
    },
    execution: {
      coreSpotUsd: 0,
      perpAvailableMarginUsd: 0,
      perpEquityUsd: 0
    }
  });

  const result = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_reconcile_no_margin"
  });

  assert.equal(result?.fundingLifecycleStage, "recovery_required");
  assert.equal(result?.executionReadiness.reason, "bot_vault_v3_execution_blocked");
  assert.equal(result?.reconciliation?.status, "blocking");
  const issue = result?.reconciliation?.issues.find((entry) => entry.code === "funding_lifecycle_hypercore_counterevidence");
  assert.ok(issue);
  assert.equal(issue?.mismatchCategory, "local_ahead_of_observed_state");
  assert.equal(issue?.recoveryAction, "recovery_required");
  assert.equal(issue?.recoveryHint, "run_recovery");
  assert.equal(result?.statusReason, "funding_lifecycle_hypercore_counterevidence");
  assert.equal(result?.statusMismatchCategory, "local_ahead_of_observed_state");
  assert.equal(result?.statusRecoveryAction, "recovery_required");
  assert.equal(result?.statusRecoveryHint, "run_recovery");
});

test("reconcileBotVaultV3ById downgrades execution_ready to observed v4 reserve stage", async () => {
  const botVaultRow: any = {
    id: "bv_reconcile_v4_reserve",
    botId: "bot_reconcile_v4_reserve",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: "0x2222222222222222222222222222222222222222",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 0,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    executionMetadata: {
      onchainContractVersion: "v4",
      marginAddFinalization: {
        verificationState: "funding_verified",
        hypeReserveState: "pending"
      },
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      }
    },
    status: "ACTIVE",
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const service = createBotVaultV3ReconcileHarness(botVaultRow, {
    onchain: {
      status: 2n,
      principalAllocatedUsd: 25,
      availableUsd: 0
    },
    execution: {
      coreSpotUsd: 0,
      perpAvailableMarginUsd: 18,
      perpEquityUsd: 20
    }
  });

  const result = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_reconcile_v4_reserve"
  });

  assert.equal(result?.fundingLifecycleStage, "perp_margin_transferred");
  assert.equal(result?.executionReadiness.reason, "bot_vault_v3_hype_reserve_not_ready");
  assert.equal(result?.executionReadiness.statusCategory, "retryable");
  assert.equal(result?.reconciliation?.status, "warning");
  assert.equal(result?.reconciliation?.statusCategory, "recovery_required");
  const issue = result?.reconciliation?.issues.find((entry) => entry.code === "funding_lifecycle_execution_ready_counterevidence");
  assert.ok(issue);
  assert.equal(issue?.statusCategory, "recovery_required");
  assert.equal(issue?.mismatchCategory, "local_ahead_of_observed_state");
  assert.equal(issue?.recoveryAction, "degrade");
  assert.equal(issue?.recoveryHint, "degrade_to_observed_state");
  assert.equal(result?.statusReason, "funding_lifecycle_execution_ready_counterevidence");
  assert.equal(result?.statusMismatchCategory, "local_ahead_of_observed_state");
  assert.equal(result?.statusRecoveryAction, "degrade");
  assert.equal(result?.statusRecoveryHint, "degrade_to_observed_state");
});

test("reconcileBotVaultV3ById does not degrade optimistic lifecycle on execution read failure", async () => {
  const botVaultRow: any = {
    id: "bv_reconcile_read_failure",
    botId: "bot_reconcile_read_failure",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    beneficiaryAddress: null,
    controllerAddress: "0x2222222222222222222222222222222222222222",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    agentWallet: null,
    agentWalletVersion: 1,
    agentSecretRef: null,
    allocatedUsd: 25,
    availableUsd: 0,
    principalAllocated: 25,
    principalReturned: 0,
    withdrawnUsd: 0,
    claimedProfitUsd: 0,
    feePaidTotal: 0,
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    executionMetadata: {
      onchainContractVersion: "v4",
      fundingLifecycle: {
        stage: "execution_ready",
        updatedAt: "2026-04-15T00:00:00.000Z",
        failureReason: null,
        recoveryReason: null,
        history: []
      }
    },
    status: "ACTIVE",
    bot: null,
    gridInstance: null,
    endedAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z")
  };
  const service = createBotVaultV3ReconcileHarness(botVaultRow, {
    onchain: {
      status: 1n,
      principalAllocatedUsd: 25,
      availableUsd: 25
    }
  });

  const result = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_reconcile_read_failure"
  });

  assert.equal(result?.fundingLifecycleStage, "execution_ready");
  assert.equal(result?.reconciliation?.executionSnapshot.state, "unavailable");
  assert.equal(result?.reconciliation?.status, "blocking");
  assert.equal(result?.reconciliation?.statusCategory, "blocked");
  const readIssue = result?.reconciliation?.issues.find((issue) => issue.code === "execution_state_unavailable");
  assert.equal(readIssue?.statusCategory, "retryable");
  assert.equal(readIssue?.mismatchCategory, "observed_state_incomplete");
  assert.equal(readIssue?.recoveryAction, "retry");
  assert.equal(readIssue?.recoveryHint, "retry_reconcile");
  assert.equal(result?.reconciliation?.issues.some((issue) => issue.code === "funding_lifecycle_hypercore_counterevidence"), false);
  assert.equal(result?.reconciliation?.issues.some((issue) => issue.code === "funding_lifecycle_funding_counterevidence"), false);
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
    },
    feeEvent: {
      async create() {
        return {};
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

test("claimProfit resumes fee-event post-processing after a receipt-side persistence failure", async () => {
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
  let failFeeEventCreate = true;

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
          async create(args: any) {
            if (failFeeEventCreate) {
              failFeeEventCreate = false;
              throw new Error("fee_event_write_failed");
            }
            const sourceKey = String(args?.data?.sourceKey ?? "");
            feeEvents.set(sourceKey, args.data);
            return args.data;
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

  const summary = await service.reconcileBotVaultV3ById({
    userId: "user_1",
    botVaultId: "bv_claim_fee_pending"
  });

  assert.equal(botVaultRow.claimedProfitUsd, 1);
  assert.equal(botVaultRow.withdrawnUsd, 0.7);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.stage, "applied");
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.lastError, null);
  assert.deepEqual(botVaultRow.executionMetadata?.claimSettlement?.postProcessing?.pendingSteps, []);
  assert.equal(feeEvents.size, 1);
  assert.equal(
    [...feeEvents.keys()][0],
    "bot_vault_v3:bv_claim_fee_pending:claim_profit:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:settlement:fee_event"
  );
  assert.equal(summary?.reconciliation?.issues.some((issue: any) => issue.code === "claim_profit_post_processing_pending_apply"), true);
});

test("claimProfit keeps fee-event post-processing pending when fee-event persistence is unavailable", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const botVaultRow: any = {
    id: "bv_claim_fee_unavailable",
    botId: "bot_claim_fee_unavailable",
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
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
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
      }
    }),
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
          return "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
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
    botId: "bot_claim_fee_unavailable",
    amountUsd: 1
  });

  assert.equal(result.postProcessingStage, "pending");
  assert.match(String(result.postProcessingReason), /bot_vault_v3_fee_event_persistence_unavailable/);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.stage, "applied");
  assert.deepEqual(botVaultRow.executionMetadata?.claimSettlement?.postProcessing?.pendingSteps, ["fee_event"]);
  assert.match(String(botVaultRow.executionMetadata?.claimSettlement?.lastError ?? ""), /bot_vault_v3_fee_event_persistence_unavailable/);
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

test("reconcileBotVaultV3ById clears stale fee-event pending state without duplicating an existing fee event", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const sourceKey = "bot_vault_v3:bv_claim_fee_existing:claim_profit:0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff:settlement:fee_event";
  const feeEvents = new Map<string, any>([
    [sourceKey, {
      botVaultId: "bv_claim_fee_existing",
      eventType: "PROFIT_SHARE",
      sourceKey
    }]
  ]);
  let createCalls = 0;
  const botVaultRow: any = {
    id: "bv_claim_fee_existing",
    botId: "bot_claim_fee_existing",
    userId: "user_1",
    vaultModel: "bot_vault_v3",
    controllerAddress,
    vaultAddress,
    principalReturned: 0,
    availableUsd: 4,
    withdrawnUsd: 0.7,
    claimedProfitUsd: 1,
    feePaidTotal: 0.3,
    fundingStatus: "settled",
    hypercoreFundingStatus: "withdrawn",
    executionStatus: "closed",
    status: "CLOSED",
    executionMetadata: {
      claimSettlement: {
        sourceAction: "claim_profit",
        sourceKey: "bot_vault_v3:bv_claim_fee_existing:claim_profit:0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff:settlement",
        feeEventSourceKey: sourceKey,
        claimTxHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        feeRatePct: 30,
        treasuryRecipient: "0x4444444444444444444444444444444444444444",
        grossAmountUsd: 1,
        feeAmountUsd: 0.3,
        netReturnedUsd: 0.7,
        excludedPrincipalUsd: 0,
        stage: "applied",
        preparedAt: new Date("2026-04-14T00:00:00.000Z").toISOString(),
        confirmedAt: new Date("2026-04-14T00:00:01.000Z").toISOString(),
        appliedAt: new Date("2026-04-14T00:00:02.000Z").toISOString(),
        updatedAt: new Date("2026-04-14T00:00:02.000Z").toISOString(),
        lastError: "duplicate_fee_event_retry",
        postProcessing: {
          state: "pending",
          pendingSteps: ["fee_event"],
          lastError: "duplicate_fee_event_retry",
          updatedAt: new Date("2026-04-14T00:00:02.000Z").toISOString()
        }
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
      async findUnique(args: any) {
        return feeEvents.get(String(args?.where?.sourceKey ?? "")) ?? null;
      },
      async create() {
        createCalls += 1;
        throw new Error("should_not_create_duplicate_fee_event");
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
    botVaultId: "bv_claim_fee_existing"
  });

  assert.equal(createCalls, 0);
  assert.equal(feeEvents.size, 1);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.postProcessing?.state, "complete");
  assert.deepEqual(botVaultRow.executionMetadata?.claimSettlement?.postProcessing?.pendingSteps, []);
  assert.equal(botVaultRow.executionMetadata?.claimSettlement?.lastError, null);
  assert.ok(summary);
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
    actionState: "claim_available",
    statusCategory: "pending",
    statusReason: "claim_available",
    statusDetail: "hypercore_funded",
    statusMismatchCategory: null,
    statusRecoveryAction: null,
    statusRecoveryHint: null
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

test("createAffiliatePayoutWallet persists a managed payout wallet on the affiliate profile", async () => {
  const previousKey = process.env.SECRET_MASTER_KEY;
  process.env.SECRET_MASTER_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
  const createdSecrets: any[] = [];
  const updatedProfiles: any[] = [];
  const profileRow = {
    id: "aff_profile_1",
    userId: "user_1",
    code: "ULQ-TEST",
    status: "ACTIVE",
    metadata: null
  };
  const tx = {
    agentWalletSecret: {
      async create(args: any) {
        createdSecrets.push(args);
        return args.data;
      }
    },
    affiliateProfile: {
      async update(args: any) {
        updatedProfiles.push(args);
        return {
          ...profileRow,
          metadata: args.data.metadata
        };
      }
    }
  };

  const service = createBotVaultV3Service({
    affiliateProfile: {
      async findUnique() {
        return profileRow;
      }
    },
    agentWalletSecret: {
      async findFirst() {
        return null;
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
    const result = await service.createAffiliatePayoutWallet({ userId: "user_1" });

    assert.match(String(result.address ?? ""), /^0x[a-fA-F0-9]{40}$/);
    assert.equal(result.version, 1);
    assert.match(String(result.secretRef ?? ""), /^affiliate_payout_wallet:user_1:1:/);
    assert.equal(createdSecrets.length, 1);
    assert.equal(updatedProfiles.length, 1);
    assert.equal(createdSecrets[0]?.data?.address, result.address);
    assert.equal(updatedProfiles[0]?.data?.metadata?.payoutWallet?.address, result.address);
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

test("finalizeMarginAdd bootstraps a v4 HYPE reserve before marking execution ready", async () => {
  const previousTarget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
  const previousBudget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = "0.25";
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = "2";

  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const sentCalls: string[] = [];
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 0.25;
  let hypeBalance = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: "bv_margin_v4",
            vaultAddress,
            controllerAddress,
            executionMetadata: {
              onchainContractVersion: "v4"
            },
            hypercoreFundingStatus: "not_funded",
            executionStatus: "created",
            status: "ACTIVE"
          };
        }
        return {
          id: "bv_margin_v4",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            onchainContractVersion: "v4"
          },
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
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => {
      if (asset === "HYPE") return hypeBalance;
      if (asset === "USDC") return spotBalanceUsd;
      return 0;
    },
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [{
          symbol: "HYPE/USDC",
          assetIndex: 7,
          stepSize: 0.01,
          minQty: 0.01,
          tradable: true,
          baseAsset: "HYPE",
          quoteAsset: "USDC"
        }];
      },
      async getLastPrice() {
        return 4;
      }
    }),
    createVaultCoreWriter: () => ({
      async placeLimitOrder() {
        hypeBalance = 0.3;
        spotBalanceUsd = 0.75;
        return {
          status: "confirmed",
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        };
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
            case "balanceOf":
              return 30_000_000n;
            case "principalDeposited":
              return 167_500_000n;
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
          sentCalls.push(String(decoded.functionName));
          assert.equal(decoded.functionName, "depositUsdcToHyperCore");
          assert.equal(decoded.args?.[0], 16_750_000n);
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
      },
      async transferUsdClass(input: { amountUsd: number; toPerp: boolean }) {
        assert.deepEqual(input, { amountUsd: 15, toPerp: true });
        spotBalanceUsd = 2;
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

  try {
    const result = await service.finalizeMarginAdd({
      userId: "user_1",
      botVaultId: "bv_margin_v4",
      amountUsd: 15
    });

    assert.deepEqual(sentCalls, ["depositUsdcToHyperCore"]);
    assert.equal(result.depositedAmountUsd, 16.75);
    assert.equal(result.transferToPerpAmountUsd, 15);
    assert.equal(result.hypeReserveState, "ready");
    assert.equal(result.hypeReserveTarget, 0.25);
    assert.equal(result.hypeReserveBudgetUsd, 2);
    assert.equal(result.hypeReserveFailureClass, null);
    assert.equal(result.hypeReserveReasonCode, null);
    assert.equal(result.hypeReserveStatusCategory, "execution_ready");
    assert.equal(result.hypeReserveCanRetry, false);
    assert.equal(result.hypeReserveNeedsUserAction, false);
    assert.equal(result.hypeBalanceAfter, 0.3);
    const finalUpdate = dbUpdates[dbUpdates.length - 1]?.data;
    const metadata = finalUpdate?.executionMetadata;
    assert.equal(finalUpdate?.hypercoreFundingStatus, "funded");
    assert.equal(metadata?.fundingLifecycle?.stage, "execution_ready");
    assert.equal(metadata?.fundingLifecycle?.recoveryReason, null);
    assert.equal(metadata?.lastAction, "bot_vault_v3_margin_add_verified");
    assert.equal(metadata?.marginAddFinalization?.verificationState, "funding_verified");
    assert.equal(metadata?.marginAddFinalization?.verificationBlockingReason, null);
    assert.equal(metadata?.marginAddFinalization?.hypeReserveState, "ready");
    assert.equal(metadata?.marginAddFinalization?.hypeReserveReady, true);
    assert.equal(metadata?.marginAddFinalization?.hypeReserveFailureClass, null);
    assert.equal(metadata?.marginAddFinalization?.hypeReserveStatusCategory, "execution_ready");
  } finally {
    if (previousTarget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = previousTarget;
    if (previousBudget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = previousBudget;
  }
});

async function runV4HypeReserveFailureScenario(mode: "retryable" | "user_action_required" | "recovery_required") {
  const previousTarget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
  const previousBudget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = "0.25";
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = "2";

  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let coreSpotBalanceUsd = 0.25;
  let reserveSpotUsdcUsd = mode === "user_action_required" ? 0 : 2;
  let hypeBalance = 0;
  let reserveOrderCalls = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.controllerAddress) {
          return {
            id: `bv_margin_v4_${mode}`,
            vaultAddress,
            controllerAddress,
            executionMetadata: {
              onchainContractVersion: "v4"
            },
            hypercoreFundingStatus: "not_funded",
            executionStatus: "created",
            status: "ACTIVE"
          };
        }
        return {
          id: `bv_margin_v4_${mode}`,
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            onchainContractVersion: "v4"
          },
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
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => {
      if (asset === "HYPE") return hypeBalance;
      if (asset === "USDC") return reserveSpotUsdcUsd;
      return 0;
    },
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [{
          symbol: "HYPE/USDC",
          assetIndex: 7,
          stepSize: 0.01,
          minQty: 0.01,
          tradable: true,
          baseAsset: "HYPE",
          quoteAsset: "USDC"
        }];
      },
      async getLastPrice() {
        return 4;
      }
    }),
    createVaultCoreWriter: mode === "recovery_required"
      ? () => null
      : () => ({
          async placeLimitOrder() {
            reserveOrderCalls += 1;
            if (mode === "retryable") {
              return {
                status: "pending_timeout",
                errorMessage: "bot_vault_v3_hypercore_exit_gas_confirmation_pending"
              };
            }
            hypeBalance = 0.3;
            reserveSpotUsdcUsd = 0.75;
            return {
              status: "confirmed",
              confirmationSource: "receipt",
              receiptStatus: "success",
              txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
            };
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
            case "balanceOf":
              return 30_000_000n;
            case "principalDeposited":
              return 167_500_000n;
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
          assert.equal(decoded.args?.[0], 16_750_000n);
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: coreSpotBalanceUsd };
      },
      async transferUsdClass() {
        coreSpotBalanceUsd = 2;
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

  try {
    const result = await service.finalizeMarginAdd({
      userId: "user_1",
      botVaultId: `bv_margin_v4_${mode}`,
      amountUsd: 15
    });
    return { result, dbUpdates, reserveOrderCalls };
  } finally {
    if (previousTarget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = previousTarget;
    if (previousBudget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = previousBudget;
  }
}

test("finalizeMarginAdd classifies retryable v4 HYPE reserve bootstrap failures", async () => {
  const { result, dbUpdates, reserveOrderCalls } = await runV4HypeReserveFailureScenario("retryable");
  const metadata = dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata;

  assert.equal(reserveOrderCalls, 1);
  assert.equal(result.hypeReserveState, "retryable_error");
  assert.equal(result.hypeReserveFailureClass, "retryable");
  assert.equal(result.hypeReserveReasonCode, "bot_vault_v4_hype_reserve_confirmation_pending");
  assert.equal(result.hypeReserveStatusCategory, "retryable");
  assert.equal(result.hypeReserveMismatchCategory, "reserve_bootstrap_incomplete");
  assert.equal(result.hypeReserveRecoveryAction, "retry");
  assert.equal(result.hypeReserveCanRetry, true);
  assert.equal(result.hypeReserveNeedsUserAction, false);
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "pending");
  assert.equal(metadata?.fundingLifecycle?.stage, "perp_margin_transferred");
  assert.equal(metadata?.marginAddFinalization?.verificationState, "hype_reserve_retryable");
  assert.equal(metadata?.marginAddFinalization?.verificationBlockingReason, "bot_vault_v4_hype_reserve_confirmation_pending");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveStatusCategory, "retryable");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveMismatchCategory, "reserve_bootstrap_incomplete");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveRecoveryAction, "retry");
});

test("finalizeMarginAdd classifies unmet v4 HYPE reserve prerequisites as user action required", async () => {
  const { result, dbUpdates, reserveOrderCalls } = await runV4HypeReserveFailureScenario("user_action_required");
  const metadata = dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata;

  assert.equal(reserveOrderCalls, 0);
  assert.equal(result.hypeReserveState, "user_action_required");
  assert.equal(result.hypeReserveFailureClass, "user_action_required");
  assert.equal(result.hypeReserveReasonCode, "bot_vault_v4_hype_reserve_core_spot_usdc_missing");
  assert.equal(result.hypeReserveStatusCategory, "user_action_required");
  assert.equal(result.hypeReserveMismatchCategory, "manual_intervention_required");
  assert.equal(result.hypeReserveRecoveryAction, "user_action_required");
  assert.equal(result.hypeReserveCanRetry, false);
  assert.equal(result.hypeReserveNeedsUserAction, true);
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, undefined);
  assert.equal(metadata?.fundingLifecycle?.stage, "recovery_required");
  assert.equal(metadata?.fundingLifecycle?.recoveryReason, "bot_vault_v4_hype_reserve_core_spot_usdc_missing");
  assert.equal(metadata?.marginAddFinalization?.verificationState, "hype_reserve_user_action_required");
  assert.equal(metadata?.marginAddFinalization?.verificationBlockingReason, "bot_vault_v4_hype_reserve_core_spot_usdc_missing");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveStatusCategory, "user_action_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveMismatchCategory, "manual_intervention_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveRecoveryAction, "user_action_required");
});

test("finalizeMarginAdd escalates non-recoverable v4 HYPE reserve bootstrap failures", async () => {
  const { result, dbUpdates } = await runV4HypeReserveFailureScenario("recovery_required");
  const metadata = dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata;

  assert.equal(result.hypeReserveState, "recovery_required");
  assert.equal(result.hypeReserveFailureClass, "recovery_required");
  assert.equal(result.hypeReserveReasonCode, "bot_vault_v4_hype_reserve_corewriter_missing");
  assert.equal(result.hypeReserveStatusCategory, "recovery_required");
  assert.equal(result.hypeReserveMismatchCategory, "manual_intervention_required");
  assert.equal(result.hypeReserveRecoveryAction, "recovery_required");
  assert.equal(result.hypeReserveCanRetry, false);
  assert.equal(result.hypeReserveNeedsUserAction, false);
  assert.equal(metadata?.fundingLifecycle?.stage, "recovery_required");
  assert.equal(metadata?.fundingLifecycle?.recoveryReason, "bot_vault_v4_hype_reserve_corewriter_missing");
  assert.equal(metadata?.marginAddFinalization?.verificationState, "hype_reserve_recovery_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveStatusCategory, "recovery_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveMismatchCategory, "manual_intervention_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveRecoveryAction, "recovery_required");
  assert.equal(metadata?.marginAddFinalization?.hypeReserveRequiresRecovery, true);
});

test("finalizeMarginAdd retries a retryable v4 HYPE reserve state during resume", async () => {
  const previousTarget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
  const previousBudget = process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = "0.25";
  process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = "2";

  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let reserveOrderCalls = 0;
  let transferCalls = 0;
  let hypeBalance = 0;
  let reserveSpotUsdcUsd = 2;
  const pendingMetadata = {
    onchainContractVersion: "v4",
    fundingLifecycle: {
      stage: "perp_margin_transferred",
      updatedAt: "2026-04-20T00:00:00.000Z",
      failureReason: null,
      recoveryReason: null,
      history: []
    },
    marginAddFinalization: {
      contractVersion: "v4",
      requestedAmountUsd: 15,
      depositedAmountUsd: 16.75,
      transferToPerpAmountUsd: 15,
      initialStatus: "ACTIVE",
      depositTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      transferResultStatus: "confirmed",
      transferSubmitted: true,
      transferTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      transferObserved: true,
      marginFundingVerified: true,
      verificationState: "hype_reserve_retryable",
      verificationBlockingReason: "bot_vault_v4_hype_reserve_confirmation_pending",
      hypeReserveState: "retryable_error",
      hypeReserveFailureClass: "retryable",
      hypeReserveReasonCode: "bot_vault_v4_hype_reserve_confirmation_pending",
      hypeReserveCanRetry: true,
      hypeReserveNeedsUserAction: false,
      hypeReserveRequiresRecovery: false,
      hypeReserveError: "bot_vault_v3_hypercore_exit_gas_confirmation_pending",
      coreSpotBalanceBeforeUsd: 0.25,
      coreSpotExpectedAfterUsd: 2,
      coreSpotBalanceAfterUsd: 2,
      perpEquityBeforeUsd: 25
    }
  };

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.gridInstance || args?.select?.bot) {
          return {
            id: "bv_margin_v4_retry_resume",
            userId: "user_1",
            vaultAddress,
            executionMetadata: pendingMetadata,
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
            },
            bot: null
          };
        }
        return {
          id: "bv_margin_v4_retry_resume",
          vaultAddress,
          controllerAddress,
          executionMetadata: pendingMetadata,
          hypercoreFundingStatus: "pending",
          executionStatus: "created",
          status: "ACTIVE"
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
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => {
      if (asset === "HYPE") return hypeBalance;
      if (asset === "USDC") return reserveSpotUsdcUsd;
      return 0;
    },
    createVaultSpotClient: () => ({
      async listSymbols() {
        return [{
          symbol: "HYPE/USDC",
          assetIndex: 7,
          stepSize: 0.01,
          minQty: 0.01,
          tradable: true,
          baseAsset: "HYPE",
          quoteAsset: "USDC"
        }];
      },
      async getLastPrice() {
        return 4;
      }
    }),
    createVaultCoreWriter: () => ({
      async placeLimitOrder() {
        reserveOrderCalls += 1;
        hypeBalance = 0.3;
        reserveSpotUsdcUsd = 0.75;
        return {
          status: "confirmed",
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        };
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
            case "balanceOf":
              return 0n;
            case "principalDeposited":
              return 15_000_000n;
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
          throw new Error("unexpected_controller_transaction");
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: 2 };
      },
      async getAccountState() {
        return {
          availableMargin: 40,
          equity: 40
        };
      },
      async transferUsdClass() {
        transferCalls += 1;
        throw new Error("unexpected_transfer_retry");
      },
      async close() {
        return undefined;
      }
    })
  });

  try {
    const result = await service.finalizeMarginAdd({
      userId: "user_1",
      botVaultId: "bv_margin_v4_retry_resume",
      amountUsd: 15
    });
    const metadata = dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata;

    assert.equal(transferCalls, 0);
    assert.equal(reserveOrderCalls, 1);
    assert.equal(result.hypeReserveState, "ready");
    assert.equal(result.hypeReserveFailureClass, null);
    assert.equal(metadata?.fundingLifecycle?.stage, "execution_ready");
    assert.equal(metadata?.marginAddFinalization?.verificationState, "funding_verified");
    assert.equal(metadata?.marginAddFinalization?.hypeReserveFailureClass, null);
    assert.equal(metadata?.marginAddFinalization?.resumedAt != null, true);
  } finally {
    if (previousTarget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_TARGET = previousTarget;
    if (previousBudget == null) delete process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND;
    else process.env.BOT_VAULT_V4_HYPERCORE_HYPE_RESERVE_MAX_USDC_SPEND = previousBudget;
  }
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

test("finalizeMarginAdd resumes a pending transfer without submitting it again", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let transferCalls = 0;

  const pendingMetadata = {
    fundingLifecycle: {
      stage: "perp_margin_transferred",
      updatedAt: "2026-04-20T00:00:00.000Z",
      failureReason: null,
      recoveryReason: null,
      history: []
    },
    marginAddFinalization: {
      contractVersion: "v3",
      requestedAmountUsd: 15,
      depositedAmountUsd: 13,
      transferToPerpAmountUsd: 15,
      initialStatus: "ACTIVE",
      activateTxHash: null,
      depositTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      pauseTxHash: null,
      restoredPaused: false,
      transferResultStatus: "confirmed",
      transferSubmitted: true,
      transferTxHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      transferObserved: false,
      verificationState: "transfer_submitted",
      verificationBlockingReason: "transfer_not_yet_observed",
      coreSpotBalanceBeforeUsd: 2,
      coreSpotExpectedAfterUsd: 0,
      coreSpotBalanceAfterUsd: 15,
      perpEquityBeforeUsd: 25
    }
  };

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.gridInstance || args?.select?.bot) {
          return {
            id: "bv_margin_resume",
            userId: "user_1",
            vaultAddress,
            executionMetadata: pendingMetadata,
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
            },
            bot: null
          };
        }
        return {
          id: "bv_margin_resume",
          vaultAddress,
          controllerAddress,
          executionMetadata: pendingMetadata,
          hypercoreFundingStatus: "pending",
          executionStatus: "created",
          status: "ACTIVE"
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
              return 0n;
            case "principalDeposited":
              return 15_000_000n;
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
          throw new Error("unexpected_controller_transaction");
        }
      }
    }),
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: 0 };
      },
      async getAccountState() {
        return {
          availableMargin: 40,
          equity: 40
        };
      },
      async transferUsdClass() {
        transferCalls += 1;
        throw new Error("unexpected_transfer_retry");
      },
      async close() {
        return undefined;
      }
    })
  });

  const result = await service.finalizeMarginAdd({
    userId: "user_1",
    botVaultId: "bv_margin_resume",
    amountUsd: 15
  });

  assert.equal(transferCalls, 0);
  assert.equal(result.depositedAmountUsd, 13);
  assert.equal(result.transferToPerpAmountUsd, 15);
  assert.equal(result.coreSpotBalanceAfterUsd, 0);
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.hypercoreFundingStatus, "funded");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.verificationState, "funding_verified");
  assert.equal(dbUpdates[dbUpdates.length - 1]?.data?.executionMetadata?.marginAddFinalization?.resumedAt != null, true);
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
  assert.equal(result.flowState, "transfer_verified");
  assert.equal(result.statusReason, "transfer_verified");
  assert.equal(result.transferResultStatus, "confirmed");
  assert.equal(result.finalPerpStateReadable, true);
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.stage === "verified"),
    true
  );
});

test("reduceMargin drains released v4 margin from HyperCore spot back to EVM", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const usdTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const spotToEvmTransfers: Array<{ amountUsd: number }> = [];
  const dbUpdates: any[] = [];
  let spotBalanceUsd = 1;
  let evmBalanceRaw = 12_000_000n;
  let availableMarginUsd = 10;
  let equityUsd = 10;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: "bv_reduce_v4",
            vaultAddress,
            controllerAddress,
            status: "ACTIVE",
            executionMetadata: {
              onchainContractVersion: "v4"
            }
          };
        }
        return {
          id: "bv_reduce_v4",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            onchainContractVersion: "v4"
          },
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
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => asset === "HYPE" ? 1 : 0,
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          if (args.functionName === "balanceOf") return evmBalanceRaw;
          throw new Error(`unexpected_function:${String(args.functionName)}`);
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
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        spotToEvmTransfers.push(input);
        spotBalanceUsd = 1;
        evmBalanceRaw = 17_000_000n;
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
    botVaultId: "bv_reduce_v4",
    amountUsd: 5
  });

  assert.deepEqual(usdTransfers, [{ amountUsd: 5, toPerp: false }]);
  assert.deepEqual(spotToEvmTransfers, [{ amountUsd: 5 }]);
  assert.equal(result.coreSpotBalanceBeforeUsd, 1);
  assert.equal(result.coreSpotBalanceAfterUsd, 1);
  assert.equal(result.evmBalanceBeforeUsd, 12);
  assert.equal(result.evmBalanceAfterUsd, 17);
  assert.equal(result.spotToEvmAmountUsd, 5);
  assert.equal(result.spotToEvmTransferStatus, "confirmed");
  assert.equal(result.statusCategory, "execution_ready");
  assert.equal(result.verificationState, "reduction_verified");
  assert.equal(result.verificationBlockingReason, null);
  assert.equal(result.flowState, "evm_return_verified");
  assert.equal(result.statusReason, "evm_return_verified");
  assert.equal(result.transferVerificationState, "reduction_verified");
  assert.equal(result.postReconcileState, "applied");
  assert.equal(result.postReconcileStatusCategory, "execution_ready");
  assert.equal(result.postReconcileReason, null);
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.spotToEvmTransferStatus === "confirmed"),
    true
  );
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.stage === "verified"),
    true
  );
  assert.equal(
    dbUpdates.some((entry) => entry?.data?.executionMetadata?.reduceMarginFinalization?.postReconcileState === "applied"),
    true
  );
});

function createV4ReduceMarginPostReconcileHarness(options?: {
  id?: string;
  initialMetadata?: Record<string, unknown>;
  failReconcilePersist?: boolean;
  initialEvmBalanceUsd?: number;
  evmReflectsDrain?: boolean;
}) {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const botVaultId = options?.id ?? "bv_reduce_v4_post_reconcile";
  const metadata = options?.initialMetadata ?? {
    onchainContractVersion: "v4"
  };
  const dbUpdates: any[] = [];
  const loggerWarnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const usdTransfers: Array<{ amountUsd: number; toPerp: boolean }> = [];
  const spotToEvmTransfers: Array<{ amountUsd: number }> = [];
  let updateCalls = 0;
  let spotBalanceUsd = 1;
  let evmBalanceRaw = BigInt(Math.round((options?.initialEvmBalanceUsd ?? 12) * 1_000_000));
  let availableMarginUsd = 10;
  let equityUsd = 10;

  const buildRow = (executionMetadata = metadata) => ({
    id: botVaultId,
    userId: "user_1",
    botId: "bot_1",
    vaultModel: "bot_vault_v3",
    vaultAddress,
    controllerAddress,
    status: "ACTIVE",
    executionStatus: "running",
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    principalAllocated: 20,
    principalReturned: 0,
    availableUsd: Number(evmBalanceRaw) / 1_000_000,
    feePaidTotal: 0,
    executionMetadata,
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
    },
    bot: null
  });

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: botVaultId,
            vaultAddress,
            controllerAddress,
            status: "ACTIVE",
            executionMetadata: metadata
          };
        }
        return buildRow(metadata);
      },
      async update(args: any) {
        updateCalls += 1;
        if (options?.failReconcilePersist && updateCalls === 3) {
          throw new Error("reconcile_persist_unavailable");
        }
        dbUpdates.push(args);
        return buildRow(args?.data?.executionMetadata ?? metadata);
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
    logger: {
      warn(msg: string, meta?: Record<string, unknown>) {
        loggerWarnings.push({ msg, meta });
      }
    },
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => asset === "HYPE" ? 1 : 0,
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          if (args.functionName === "balanceOf") return evmBalanceRaw;
          throw new Error(`unexpected_function:${String(args.functionName)}`);
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
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        spotToEvmTransfers.push(input);
        spotBalanceUsd = 1;
        if (options?.evmReflectsDrain !== false) {
          evmBalanceRaw = 17_000_000n;
        }
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

  return {
    service,
    dbUpdates,
    loggerWarnings,
    usdTransfers,
    spotToEvmTransfers,
    get updateCalls() {
      return updateCalls;
    }
  };
}

test("reduceMargin marks v4 transfer verified but post-reconcile pending when reconcile persist fails", async () => {
  const harness = createV4ReduceMarginPostReconcileHarness({
    id: "bv_reduce_v4_reconcile_pending",
    failReconcilePersist: true
  });

  const result = await harness.service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_v4_reconcile_pending",
    amountUsd: 5
  });
  const finalization = harness.dbUpdates[harness.dbUpdates.length - 1]?.data?.executionMetadata?.reduceMarginFinalization;

  assert.equal(result.transferVerificationState, "reduction_verified");
  assert.equal(result.verificationState, "post_reconcile_pending");
  assert.equal(result.verificationBlockingReason, "bot_vault_v3_reduce_margin_post_reconcile_failed");
  assert.equal(result.flowState, "post_reconcile_pending");
  assert.equal(result.statusReason, "post_reconcile_pending");
  assert.equal(result.statusCategory, "retryable");
  assert.equal(result.postReconcileState, "pending");
  assert.equal(result.postReconcileStatusCategory, "retryable");
  assert.equal(result.postReconcileMismatchCategory, "post_transfer_reconcile_failed");
  assert.equal(result.postReconcileRecoveryAction, "retry");
  assert.equal(result.postReconcileCanRetry, true);
  assert.equal(finalization?.stage, "post_reconcile_pending");
  assert.equal(finalization?.flowState, "post_reconcile_pending");
  assert.equal(finalization?.statusReason, "post_reconcile_pending");
  assert.equal(finalization?.statusCategory, "retryable");
  assert.equal(finalization?.transferVerificationState, "reduction_verified");
  assert.equal(finalization?.postReconcileState, "pending");
  assert.equal(finalization?.postReconcileStatusCategory, "retryable");
  assert.equal(finalization?.postReconcileMismatchCategory, "post_transfer_reconcile_failed");
  assert.equal(finalization?.postReconcileRecoveryAction, "retry");
  assert.equal(finalization?.postReconcileCanRetry, true);
  assert.equal(
    harness.loggerWarnings.some((entry) => entry.msg === "bot_vault_v3_reduce_margin_post_reconcile_pending"),
    true
  );
  assert.equal(
    harness.loggerWarnings.some((entry) => entry.msg === "bot_vault_v3_reduce_margin_transfer_verified"),
    true
  );
  assert.equal(
    harness.loggerWarnings.some((entry) => entry.msg === "bot_vault_v4_reduce_margin_evm_return_verified"),
    true
  );
});

test("reduceMargin resumes v4 post-reconcile pending state without re-sending transfers", async () => {
  const harness = createV4ReduceMarginPostReconcileHarness({
    id: "bv_reduce_v4_reconcile_resume",
    initialEvmBalanceUsd: 17,
    initialMetadata: {
      onchainContractVersion: "v4",
      reduceMarginFinalization: {
        contractVersion: "v4",
        releasedAmountUsd: 5,
        coreSpotBalanceBeforeUsd: 1,
        coreSpotExpectedAfterUsd: 6,
        coreSpotBalanceAfterUsd: 1,
        evmBalanceBeforeUsd: 12,
        evmExpectedAfterUsd: 17,
        evmBalanceAfterUsd: 17,
        evmTransferObserved: true,
        transferObserved: true,
        transferResultStatus: "confirmed",
        spotToEvmAmountUsd: 5,
        spotToEvmTransferStatus: "confirmed",
        finalPerpStateReadable: true,
        transferVerificationState: "reduction_verified",
        verificationState: "post_reconcile_pending",
        verificationBlockingReason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
        postReconcileState: "pending",
        postReconcileReason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
        postReconcileCanRetry: true,
        stage: "post_reconcile_pending",
        updatedAt: new Date().toISOString()
      }
    }
  });

  const result = await harness.service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_v4_reconcile_resume",
    amountUsd: 5
  });
  const finalization = harness.dbUpdates[harness.dbUpdates.length - 1]?.data?.executionMetadata?.reduceMarginFinalization;

  assert.equal(harness.usdTransfers.length, 0);
  assert.equal(harness.spotToEvmTransfers.length, 0);
  assert.equal(result.verificationState, "reduction_verified");
  assert.equal(result.flowState, "evm_return_verified");
  assert.equal(result.statusReason, "evm_return_verified");
  assert.equal(result.postReconcileState, "applied");
  assert.equal(result.postReconcileMismatchCategory, null);
  assert.equal(result.postReconcileRecoveryAction, null);
  assert.equal(finalization?.stage, "verified");
  assert.equal(finalization?.flowState, "evm_return_verified");
  assert.equal(finalization?.statusReason, "evm_return_verified");
  assert.equal(finalization?.postReconcileState, "applied");
});

test("reduceMargin treats verified v4 transfer with pending post-reconcile as resumable", async () => {
  const harness = createV4ReduceMarginPostReconcileHarness({
    id: "bv_reduce_v4_verified_reconcile_resume",
    initialEvmBalanceUsd: 17,
    initialMetadata: {
      onchainContractVersion: "v4",
      reduceMarginFinalization: {
        contractVersion: "v4",
        releasedAmountUsd: 5,
        coreSpotBalanceBeforeUsd: 1,
        coreSpotExpectedAfterUsd: 1,
        coreSpotBalanceAfterUsd: 1,
        evmBalanceBeforeUsd: 12,
        evmExpectedAfterUsd: 17,
        evmBalanceAfterUsd: 17,
        evmTransferObserved: true,
        transferObserved: true,
        transferResultStatus: "confirmed",
        spotToEvmAmountUsd: 5,
        spotToEvmTransferStatus: "confirmed",
        finalPerpStateReadable: true,
        transferVerificationState: "reduction_verified",
        verificationState: "post_reconcile_pending",
        verificationBlockingReason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
        flowState: "post_reconcile_pending",
        statusReason: "post_reconcile_pending",
        postReconcileState: "pending",
        postReconcileReason: "bot_vault_v3_reduce_margin_post_reconcile_failed",
        postReconcileCanRetry: true,
        stage: "verified",
        updatedAt: new Date().toISOString()
      }
    }
  });

  const result = await harness.service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_v4_verified_reconcile_resume",
    amountUsd: 5
  });
  const finalization = harness.dbUpdates[harness.dbUpdates.length - 1]?.data?.executionMetadata?.reduceMarginFinalization;

  assert.equal(harness.usdTransfers.length, 0);
  assert.equal(harness.spotToEvmTransfers.length, 0);
  assert.equal(result.verificationState, "reduction_verified");
  assert.equal(result.flowState, "evm_return_verified");
  assert.equal(result.postReconcileState, "applied");
  assert.equal(finalization?.stage, "verified");
  assert.equal(finalization?.postReconcileState, "applied");
});

test("reduceMargin keeps v4 post-reconcile not required while EVM balance reflection is delayed", async () => {
  const harness = createV4ReduceMarginPostReconcileHarness({
    id: "bv_reduce_v4_evm_pending",
    evmReflectsDrain: false
  });

  const result = await harness.service.reduceMargin({
    userId: "user_1",
    botVaultId: "bv_reduce_v4_evm_pending",
    amountUsd: 5
  });
  const finalization = harness.dbUpdates[harness.dbUpdates.length - 1]?.data?.executionMetadata?.reduceMarginFinalization;

  assert.equal(result.transferVerificationState, "evm_transfer_submitted");
  assert.equal(result.verificationState, "evm_transfer_submitted");
  assert.equal(result.verificationBlockingReason, "spot_to_evm_not_yet_observed");
  assert.equal(result.flowState, "evm_return_pending");
  assert.equal(result.statusReason, "evm_return_pending");
  assert.equal(result.postReconcileState, "not_required");
  assert.equal(result.postReconcileCanRetry, false);
  assert.equal(finalization?.stage, "submitted");
  assert.equal(finalization?.flowState, "evm_return_pending");
  assert.equal(finalization?.statusReason, "evm_return_pending");
  assert.equal(finalization?.postReconcileState, "not_required");
  assert.equal(finalization?.evmTransferObserved, false);
  assert.equal(
    harness.loggerWarnings.some((entry) => entry.msg === "bot_vault_v4_reduce_margin_evm_return_pending"),
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
  assert.equal(result.flowState, "transfer_submitted");
  assert.equal(result.statusReason, "transfer_submitted");
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

test("reduceMargin resumes a pending v4 drain by sending spot USDC to EVM without re-sending the perp transfer", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const agentPrivateKey = `0x${"1".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const tradingDeskPrivateKey = `0x${"2".repeat(64)}` as const;
  const tradingDeskAddress = privateKeyToAccount(tradingDeskPrivateKey).address;
  const dbUpdates: any[] = [];
  let transferCalls = 0;
  let spotToEvmCalls = 0;
  let spotBalanceUsd = 6;
  let evmBalanceRaw = 12_000_000n;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst(args: any) {
        if (args?.select?.vaultAddress && !args?.select?.gridInstance && !args?.select?.bot) {
          return {
            id: "bv_reduce_resume_v4",
            vaultAddress,
            controllerAddress,
            status: "ACTIVE",
            executionMetadata: {
              onchainContractVersion: "v4",
              reduceMarginFinalization: {
                contractVersion: "v4",
                releasedAmountUsd: 5,
                coreSpotBalanceBeforeUsd: 1,
                transferObserved: true,
                stage: "submitted",
                transferResultStatus: "confirmed",
                evmBalanceBeforeUsd: 12,
                spotToEvmAmountUsd: 5
              }
            }
          };
        }
        return {
          id: "bv_reduce_resume_v4",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            onchainContractVersion: "v4",
            reduceMarginFinalization: {
              contractVersion: "v4",
              releasedAmountUsd: 5,
              coreSpotBalanceBeforeUsd: 1,
              transferObserved: true,
              stage: "submitted",
              transferResultStatus: "confirmed",
              evmBalanceBeforeUsd: 12,
              spotToEvmAmountUsd: 5
            }
          },
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
    readHyperliquidSpotAssetBalance: async (_vaultAddress: string, asset: string) => asset === "HYPE" ? 1 : 0,
    buildControllerWalletClient: () => ({
      account: { address: controllerAddress },
      chain: { id: 999 },
      publicClient: {
        async readContract(args: any) {
          if (args.functionName === "balanceOf") return evmBalanceRaw;
          throw new Error(`unexpected_function:${String(args.functionName)}`);
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
    createPerpExecutionAdapter: () => ({
      async getCoreUsdcSpotBalance() {
        return { amountUsd: spotBalanceUsd };
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
      async transferUsdcSpotToEvm(input: { amountUsd: number }) {
        spotToEvmCalls += 1;
        assert.deepEqual(input, { amountUsd: 5 });
        spotBalanceUsd = 1;
        evmBalanceRaw = 17_000_000n;
        return {
          status: "confirmed",
          submitted: true,
          confirmationSource: "receipt",
          receiptStatus: "success",
          txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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
    botVaultId: "bv_reduce_resume_v4",
    amountUsd: 5
  });

  assert.equal(transferCalls, 0);
  assert.equal(spotToEvmCalls, 1);
  assert.equal(result.coreSpotBalanceBeforeUsd, 1);
  assert.equal(result.coreSpotBalanceAfterUsd, 1);
  assert.equal(result.evmBalanceAfterUsd, 17);
  assert.equal(result.spotToEvmTransferStatus, "confirmed");
  assert.equal(result.verificationState, "reduction_verified");
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
          executionMetadata: {
            lifecycleOverrideState: "settling",
            settlementStage: "spot_to_evm_pending",
            settlementSpotToEvmAmountUsd: 6,
            settlementSpotToEvmTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            settlementSpotToEvmStatus: "confirmed",
            reconciliationMonitor: {
              status: "critical",
              blockingReason: "grid_vault_balance_reconciliation_required"
            },
            lifecycle: {
              mode: "close_only",
              state: "settling",
              status: "CLOSE_ONLY",
              updatedAt: "2026-04-19T10:51:37.634Z",
              isTerminal: false,
              executionStatus: "close_only",
              canAcceptNewOrders: false
            }
          },
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
  assert.equal(settlementUpdate?.data?.executionMetadata?.lifecycleOverrideState, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.settlementStage, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.settlementLastUpdatedAt, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.settlementSpotToEvmAmountUsd, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.settlementSpotToEvmTxHash, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.settlementSpotToEvmStatus, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.reconciliationMonitor, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.lifecycle?.state, "closed");
  assert.equal(settlementUpdate?.data?.executionMetadata?.lifecycle?.overrideState, null);
  assert.equal(settlementUpdate?.data?.executionMetadata?.lifecycle?.executionStatus, "closed");
  assert.equal(settlementUpdate?.data?.executionMetadata?.lifecycle?.isTerminal, true);
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
          onchainPayoutModel: "onchain_treasury_v1",
          treasuryRecipient,
          feeRatePct: 30,
          txHash: closeTxHash,
          sourceAction: "close_vault",
          grossAmountUsd: 25.454059,
          netReturnedUsd: 25.317842,
          netAmountUsd: 25.317842,
          platformFeeAmountUsd: undefined,
          affiliateFeeAmountUsd: undefined,
          excludedPrincipalUsd: 1,
          beneficiary: null
        }
      }
    }
  ]);
});

test("controllerCloseBotVault decorates fee events with affiliate metadata and creates an affiliate accrual", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const affiliateAccruals: any[] = [];
  let stage: "before_close" | "after_close" = "before_close";

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close_affiliate",
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
      async findUnique() {
        return {
          id: "bv_close_affiliate",
          userId: "user_1"
        };
      },
      async update(args: any) {
        return args.data;
      }
    },
    feeEvent: {
      async findUnique() {
        return null;
      },
      async create(args: any) {
        return {
          id: "fe_affiliate_1",
          ...args.data
        };
      }
    },
    globalSetting: {
      async findUnique(args: any) {
        if (String(args?.where?.key ?? "") !== "admin.affiliateProgram.v1") return null;
        return {
          key: "admin.affiliateProgram.v1",
          value: {
            enabled: true,
            platformFeeRatePct: 20,
            defaultAffiliateFeeRatePct: 10
          },
          updatedAt: new Date("2026-04-18T10:00:00.000Z")
        };
      }
    },
    affiliateReferral: {
      async findUnique() {
        return {
          affiliateUserId: "user_aff",
          status: "ACTIVE"
        };
      }
    },
    affiliateRateOverride: {
      async findUnique() {
        return null;
      }
    },
    affiliateAccrual: {
      async findUnique() {
        return null;
      },
      async create(args: any) {
        affiliateAccruals.push(args.data);
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

  await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close_affiliate"
  });

  assert.equal(affiliateAccruals.length, 1);
  assert.equal(affiliateAccruals[0]?.affiliateUserId, "user_aff");
  assert.equal(affiliateAccruals[0]?.referredUserId, "user_1");
  assert.equal(affiliateAccruals[0]?.affiliateFeeRatePct, 10);
  assert.equal(affiliateAccruals[0]?.grossFeeUsd, 0.1362);
  assert.equal(affiliateAccruals[0]?.affiliateAmountUsd, 0.0454);
  assert.equal(affiliateAccruals[0]?.platformAmountUsd, 0.0908);
});

test("controllerCloseBotVault marks v4 affiliate splits as paid onchain", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const treasuryRecipient = "0x4444444444444444444444444444444444444444";
  const affiliateRecipient = "0x5555555555555555555555555555555555555555";
  const closeTxHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const affiliateAccruals: any[] = [];
  const feeEvents: any[] = [];
  let stage: "before_close" | "after_close" = "before_close";

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close_affiliate_v4",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          executionMetadata: {
            onchainContractVersion: "v4",
            hypercoreAccountingFeeUsd: 1,
            feeConfig: {
              platformFeeRatePct: 20,
              affiliateFeeRatePct: 10,
              totalFeeRatePct: 30,
              affiliateUserId: "user_aff",
              affiliateRecipientAddress: affiliateRecipient,
              feeConfigLockedAt: "2026-04-18T10:00:00.000Z"
            }
          }
        };
      },
      async findUnique() {
        return {
          id: "bv_close_affiliate_v4",
          userId: "user_1",
          executionMetadata: {
            onchainContractVersion: "v4",
            feeConfig: {
              platformFeeRatePct: 20,
              affiliateFeeRatePct: 10,
              totalFeeRatePct: 30,
              affiliateUserId: "user_aff",
              affiliateRecipientAddress: affiliateRecipient,
              feeConfigLockedAt: "2026-04-18T10:00:00.000Z"
            }
          }
        };
      },
      async update(args: any) {
        return args.data;
      }
    },
    feeEvent: {
      async findUnique() {
        return null;
      },
      async create(args: any) {
        feeEvents.push(args.data);
        return {
          id: "fe_affiliate_v4_1",
          ...args.data
        };
      }
    },
    globalSetting: {
      async findUnique(args: any) {
        if (String(args?.where?.key ?? "") !== "admin.affiliateProgram.v1") return null;
        return {
          key: "admin.affiliateProgram.v1",
          value: {
            enabled: true,
            platformFeeRatePct: 20,
            defaultAffiliateFeeRatePct: 10
          },
          updatedAt: new Date("2026-04-18T10:00:00.000Z")
        };
      }
    },
    affiliateReferral: {
      async findUnique() {
        return {
          affiliateUserId: "user_aff",
          status: "ACTIVE"
        };
      }
    },
    affiliateRateOverride: {
      async findUnique() {
        return null;
      }
    },
    affiliateAccrual: {
      async findUnique() {
        return null;
      },
      async create(args: any) {
        affiliateAccruals.push(args.data);
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

  await service.controllerCloseBotVault({
    userId: "user_1",
    botVaultId: "bv_close_affiliate_v4"
  });

  assert.equal(feeEvents[0]?.metadata?.onchainPayoutModel, "direct_split_v4");
  assert.equal(feeEvents[0]?.metadata?.affiliateRecipientAddress, affiliateRecipient);
  assert.equal(feeEvents[0]?.metadata?.platformFeeAmountUsd, 0.0908);
  assert.equal(feeEvents[0]?.metadata?.affiliateFeeAmountUsd, 0.0454);
  assert.equal(affiliateAccruals.length, 1);
  assert.equal(affiliateAccruals[0]?.status, "PAID");
  assert.ok(affiliateAccruals[0]?.paidAt instanceof Date);
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

test("controllerCloseBotVault stops before spot exit when a close-only vault lacks HyperCore exit gas", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const agentPrivateKey = `0x${"4".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const systemAddress = "0x2000000000000000000000000000000000000000";
  let transferAttempts = 0;

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
          agentSecretRef: "agent-secret-ref",
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: agentAddress,
              apiSecretEnc: agentPrivateKey,
              passphraseEnc: vaultAddress
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
        return {
          privateKey: agentPrivateKey,
          version: 1
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
    readHyperliquidSpotUsdcBalance: async () => "27.64210668",
    readHyperliquidSpotAssetBalance: async (_address, asset) => asset === "HYPE" ? "0" : "0",
    decryptSecret: (value) => value,
    sleep: async () => {},
    cancelAllOrders: async () => ({ requested: 0, cancelled: 0, failed: 0 }),
    createPerpExecutionAdapter: () => ({
      async listPositions() {
        return [];
      },
      async getAccountState() {
        return { availableMargin: "0" };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: 27.64210668,
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdcSpotToEvm() {
        transferAttempts += 1;
        return { status: "confirmed" };
      },
      async close() {
        return undefined;
      }
    })
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_close"
    }),
    /settlementStep=ensure_hypercore_exit_gas:.*settlementError=bot_vault_v3_hypercore_exit_gas_missing_in_close_only/
  );
  assert.equal(transferAttempts, 0);
});

test("controllerCloseBotVault does not enter close-only when active HyperCore exit still lacks gas", async () => {
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const controllerAddress = "0x2222222222222222222222222222222222222222";
  const factoryAddress = "0x3333333333333333333333333333333333333333";
  const agentPrivateKey = `0x${"4".repeat(64)}` as const;
  const agentAddress = privateKeyToAccount(agentPrivateKey).address;
  const systemAddress = "0x2000000000000000000000000000000000000000";
  let sendTransactionCount = 0;

  const service = createBotVaultV3Service({
    botVault: {
      async findFirst() {
        return {
          id: "bv_close_active",
          userId: "user_1",
          botId: "bot_1",
          vaultModel: "bot_vault_v3",
          vaultAddress,
          controllerAddress,
          agentWallet: agentAddress,
          agentWalletVersion: 1,
          agentSecretRef: "agent-secret-ref",
          executionMetadata: {},
          gridInstance: {
            template: {
              symbol: "BTCUSDT"
            },
            exchangeAccount: {
              id: "ea_1",
              exchange: "hyperliquid",
              apiKeyEnc: agentAddress,
              apiSecretEnc: agentPrivateKey,
              passphraseEnc: vaultAddress
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
        return {
          privateKey: agentPrivateKey,
          version: 1
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
              return 2n;
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
          sendTransactionCount += 1;
          return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        }
      }
    }),
    readHyperliquidClearinghouseState: async () => ({
      withdrawable: "0",
      accountValue: "0",
      totalMarginUsed: "0",
      assetPositions: []
    }),
    readHyperliquidSpotUsdcBalance: async () => "27.64210668",
    readHyperliquidSpotAssetBalance: async (_address, asset) => asset === "HYPE" ? "0" : "27.64210668",
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
      async placeLimitOrder() {
        return {
          status: "failed",
          errorMessage: "bot_vault_v3_hypercore_exit_gas_confirmation_pending"
        };
      }
    }),
    createPerpExecutionAdapter: () => ({
      async listPositions() {
        return [];
      },
      async getAccountState() {
        return { availableMargin: "0" };
      },
      async getCoreUsdcSpotBalance() {
        return {
          amountUsd: 27.64210668,
          token: "USDC:0",
          systemAddress
        };
      },
      async transferUsdcSpotToEvm() {
        return { status: "confirmed" };
      },
      async close() {
        return undefined;
      }
    })
  });

  await assert.rejects(
    service.controllerCloseBotVault({
      userId: "user_1",
      botVaultId: "bv_close_active"
    }),
    /settlementStep=ensure_hypercore_exit_gas:.*settlementError=Error%3A%20bot_vault_v3_hypercore_exit_gas_confirmation_pending/
  );
  assert.equal(sendTransactionCount, 0);
});
