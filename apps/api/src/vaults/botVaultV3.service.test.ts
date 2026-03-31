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
