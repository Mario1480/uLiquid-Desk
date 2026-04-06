import assert from "node:assert/strict";
import test from "node:test";
import { createVaultOnchainReconciliationJob } from "./vaultOnchainReconciliationJob.js";
import { GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY } from "../vaults/executionMode.js";

test("vaultOnchainReconciliationJob skips when mode is offchain_shadow", async () => {
  const db = {
    globalSetting: {
      async findUnique() {
        return { value: { mode: "offchain_shadow" }, updatedAt: new Date() };
      }
    }
  } as any;

  const job = createVaultOnchainReconciliationJob(db);
  const result = await job.runCycle("manual");

  assert.equal(result.enabled, false);
  assert.equal(result.mode, "offchain_shadow");

  const status = job.getStatus();
  assert.equal(status.mode, "offchain_shadow");
});

test("vaultOnchainReconciliationJob auto-starts active onchain bot vaults stuck in created execution state", async () => {
  const started: any[] = [];
  const confirmed: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "legacy_master",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              principalAllocated: 111.24,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created",
              fundingStatus: "hyper_evm_confirmed_onchain",
              hypercoreFundingStatus: "pending"
            }
          ];
        }
      },
      onchainAction: {
        async findFirst() {
          return {
            id: "action_1",
            actionType: "create_bot_vault",
            txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          };
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      onchainActionService: {
        async markActionConfirmedByTxHash(input: any) {
          confirmed.push(input);
        }
      } as any,
      executionLifecycleService: {
        async startExecution(input: any) {
          started.push(input);
          return { executionStatus: "running" };
        }
      } as any,
      readBotVaultState: async () => ({
        principalAllocated: 111.24,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 0
      }),
      readBotVaultV3State: async () => ({
        principalAllocated: 111.24,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 2
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.txHash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(started.length, 1);
    assert.equal(started[0]?.userId, "user_1");
    assert.equal(started[0]?.botVaultId, "bv_1");
    assert.equal(started[0]?.reason, "bot_vault_onchain_reconciliation_autostart");
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob does not auto-start unfunded bot_vault_v3 instances", async () => {
  const started: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              principalAllocated: 0,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created",
              fundingStatus: "deployed",
              hypercoreFundingStatus: "not_funded"
            }
          ];
        }
      },
      onchainAction: {
        async findFirst() {
          return null;
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      executionLifecycleService: {
        async startExecution(input: any) {
          started.push(input);
          return { executionStatus: "running" };
        }
      } as any,
      readBotVaultState: async () => ({
        principalAllocated: 0,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 0
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(started.length, 0);
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob keeps bot_vault_v3 in transfer-pending state after same-cycle onchain funding reconciliation", async () => {
  const started: any[] = [];
  const botUpdates: any[] = [];
  const gridUpdates: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              gridInstanceId: "grid_1",
              principalAllocated: 0,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created",
              fundingStatus: "deployed",
              hypercoreFundingStatus: "not_funded"
            }
          ];
        },
        async update(args: any) {
          botUpdates.push(args);
          return args;
        }
      },
      gridBotInstance: {
        async findUnique() {
          return {
            id: "grid_1",
            botId: "bot_1",
            stateJson: {
              provisioning: {
                phase: "pending_reserve_signature"
              }
            }
          };
        },
        async update(args: any) {
          gridUpdates.push(args);
          return args;
        }
      },
      bot: {
        async update() {
          return null;
        }
      },
      onchainAction: {
        async findFirst() {
          return null;
        },
        async updateMany() {
          return { count: 0 };
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      executionLifecycleService: {
        async startExecution(input: any) {
          started.push(input);
          return { executionStatus: "running" };
        }
      } as any,
      readBotVaultV3State: async () => ({
        principalAllocated: 6,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 1
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(started.length, 0);
    const fundingRepair = botUpdates.find((entry) => entry?.data?.fundingStatus === "hyper_evm_confirmed_onchain");
    assert.ok(fundingRepair);
    assert.equal(fundingRepair?.data?.hypercoreFundingStatus, "pending");
    assert.equal(fundingRepair?.data?.executionStatus, "funded");
    assert.equal(gridUpdates.length, 1);
    assert.equal(gridUpdates[0]?.data?.state, "created");
    assert.equal(gridUpdates[0]?.data?.stateJson?.provisioning?.phase, "submitted_waiting_hypercore_funding_indexer");
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob preserves running execution status during v3 funding reconciliation", async () => {
  const botUpdates: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              gridInstanceId: "grid_1",
              principalAllocated: 6,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "running",
              fundingStatus: "hyper_evm_confirmed_onchain",
              hypercoreFundingStatus: "pending"
            }
          ];
        },
        async update(args: any) {
          botUpdates.push(args);
          return args;
        }
      },
      gridBotInstance: {
        async findUnique() {
          return {
            id: "grid_1",
            botId: "bot_1",
            stateJson: {}
          };
        },
        async update() {
          return null;
        }
      },
      bot: {
        async update() {
          return null;
        }
      },
      onchainAction: {
        async findFirst() {
          return null;
        },
        async updateMany() {
          return { count: 0 };
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      readBotVaultV3State: async () => ({
        principalAllocated: 6,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 1
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    const executionRepair = botUpdates.find((entry) => entry?.data?.executionStatus === "running");
    assert.ok(executionRepair);
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob preserves funded hypercore status during v3 funding reconciliation", async () => {
  const botUpdates: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              principalAllocated: 6,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "running",
              fundingStatus: "hyper_evm_confirmed_onchain",
              hypercoreFundingStatus: "funded"
            }
          ];
        },
        async update(args: any) {
          botUpdates.push(args);
          return args;
        }
      },
      onchainAction: {
        async findFirst() {
          return null;
        },
        async updateMany() {
          return { count: 0 };
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      readBotVaultV3State: async () => ({
        principalAllocated: 6,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 1
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    const fundingRepair = botUpdates.find((entry) => entry?.data?.fundingStatus === "hyper_evm_confirmed_onchain");
    assert.ok(fundingRepair);
    assert.equal(fundingRepair?.data?.hypercoreFundingStatus, "funded");
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob confirms submitted v3 funding actions that already have a tx hash", async () => {
  const confirmed: any[] = [];
  const actionUpdates: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              gridInstanceId: "grid_1",
              executionMetadata: {},
              principalAllocated: 0,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created",
              fundingStatus: "deployed",
              hypercoreFundingStatus: "not_funded"
            }
          ];
        },
        async update() {
          return null;
        }
      },
      gridBotInstance: {
        async findUnique() {
          return {
            id: "grid_1",
            botId: "bot_1",
            stateJson: {}
          };
        },
        async update() {
          return null;
        }
      },
      bot: {
        async update() {
          return null;
        }
      },
      onchainAction: {
        async findFirst(args: any) {
          if (String(args?.where?.actionType ?? "") === "fund_bot_vault_v3") {
            return {
              id: "fund_1",
              userId: "user_1",
              txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              metadata: {
                amountAtomic: "6000000"
              }
            };
          }
          return null;
        },
        async updateMany(args: any) {
          actionUpdates.push(args);
          return { count: 0 };
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      onchainActionService: {
        async markActionConfirmedByTxHash(input: any) {
          confirmed.push(input);
        }
      } as any,
      readBotVaultV3State: async () => ({
        principalAllocated: 6,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 1
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.txHash, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.equal(actionUpdates.length, 1);
    assert.equal(actionUpdates[0]?.where?.txHash, null);
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob backfills missing v3 funding tx hashes before clearing unresolved actions", async () => {
  const submitted: any[] = [];
  const confirmed: any[] = [];
  const actionUpdates: any[] = [];
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [];
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultModel: "bot_vault_v3",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              gridInstanceId: "grid_1",
              executionMetadata: {},
              principalAllocated: 0,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created",
              fundingStatus: "deployed",
              hypercoreFundingStatus: "not_funded"
            }
          ];
        },
        async update() {
          return null;
        }
      },
      gridBotInstance: {
        async findUnique() {
          return {
            id: "grid_1",
            botId: "bot_1",
            stateJson: {}
          };
        },
        async update() {
          return null;
        }
      },
      bot: {
        async update() {
          return null;
        }
      },
      onchainAction: {
        async findFirst(args: any) {
          if (String(args?.where?.actionType ?? "") === "fund_bot_vault_v3") {
            return {
              id: "fund_1",
              userId: "user_1",
              txHash: null,
              metadata: {
                amountAtomic: "6000000"
              }
            };
          }
          return null;
        },
        async updateMany(args: any) {
          actionUpdates.push(args);
          return { count: 0 };
        }
      }
    } as any;

    const recoveredTxHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const job = createVaultOnchainReconciliationJob(db, {
      onchainActionService: {
        async submitActionTxHash(input: any) {
          submitted.push(input);
        },
        async markActionConfirmedByTxHash(input: any) {
          confirmed.push(input);
        }
      } as any,
      recoverBotVaultV3FundingTxHash: async () => recoveredTxHash as `0x${string}`,
      readBotVaultV3State: async () => ({
        principalAllocated: 6,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 1
      }),
      readMasterVaultState: async () => ({
        freeBalance: 0,
        reservedBalance: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0], {
      userId: "user_1",
      actionId: "fund_1",
      txHash: recoveredTxHash
    });
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.txHash, recoveredTxHash);
    assert.equal(actionUpdates.length, 1);
    assert.equal(actionUpdates[0]?.where?.txHash, null);
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob repairs drifted master and bot vault state from chain", async () => {
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  const masterUpdates: any[] = [];
  const botUpdates: any[] = [];

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [
            {
              id: "mv_1",
              onchainAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              freeBalance: 10,
              reservedBalance: 200
            }
          ];
        },
        async update(args: any) {
          masterUpdates.push(args);
          return args;
        }
      },
      botVault: {
        async findMany() {
          return [
            {
              id: "bv_1",
              userId: "user_1",
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              principalAllocated: 240,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "running"
            }
          ];
        },
        async update(args: any) {
          botUpdates.push(args);
          return args;
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      readMasterVaultState: async () => ({
        freeBalance: 250,
        reservedBalance: 0
      }),
      readBotVaultState: async () => ({
        principalAllocated: 240,
        principalReturned: 240,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 3
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(result.drifts, 2);
    assert.equal(masterUpdates.length, 1);
    assert.deepEqual(masterUpdates[0]?.data, {
      freeBalance: 250,
      reservedBalance: 0,
      availableUsd: 250
    });
    assert.equal(botUpdates.length, 1);
    assert.deepEqual(botUpdates[0]?.data, {
      principalAllocated: 240,
      principalReturned: 240,
      realizedPnlNet: 0,
      realizedNetUsd: 0,
      feePaidTotal: 0,
      highWaterMark: 0,
      status: "CLOSED"
    });
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob refreshes master agent HYPE balance and dispatches low-HYPE warning once", async () => {
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  const notifications: any[] = [];
  const masterUpdates: any[] = [];
  const stateStore = new Map<string, any>();

  try {
    const db = {
      globalSetting: {
        async findUnique(args: any) {
          if (String(args.where.key) === GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY) {
            return { value: { mode: "onchain_live" }, updatedAt: new Date() };
          }
          return stateStore.get(String(args.where.key)) ?? null;
        },
        async upsert(args: any) {
          const value = { key: args.where.key, value: args.update.value };
          stateStore.set(String(args.where.key), value);
          return value;
        }
      },
      globalSettingAudit: {},
      cashEvent: {
        async findMany() {
          return [];
        }
      },
      masterVault: {
        async findMany() {
          return [
            {
              id: "mv_1",
              userId: "user_1",
              onchainAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              freeBalance: 50,
              reservedBalance: 0,
              agentWallet: "0x1111111111111111111111111111111111111111",
              agentHypeWarnThreshold: 0.05,
              agentLastBalanceAt: null,
              agentLastBalanceWei: null,
              agentLastBalanceFormatted: null
            }
          ];
        },
        async update(args: any) {
          masterUpdates.push(args);
          return args;
        }
      },
      botVault: {
        async findMany() {
          return [];
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      readMasterVaultState: async () => ({
        freeBalance: 50,
        reservedBalance: 0
      }),
      readBotVaultState: async () => ({
        principalAllocated: 0,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 0
      }),
      readNativeBalance: async () => 10_000_000_000_000_000n,
      dispatchAgentLowHypeNotification: async (payload: any) => {
        notifications.push(payload);
      }
    });

    const first = await job.runCycle("manual");
    const second = await job.runCycle("manual");

    assert.equal(first.enabled, true);
    assert.equal(second.enabled, true);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.masterVaultId, "mv_1");
    assert.equal(masterUpdates.length >= 1, true);
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});

test("vaultOnchainReconciliationJob preserves closed recovery compensation above onchain free balance", async () => {
  const previousEnv = {
    VAULT_ONCHAIN_RPC_URL: process.env.VAULT_ONCHAIN_RPC_URL,
    VAULT_ONCHAIN_FACTORY_ADDRESS: process.env.VAULT_ONCHAIN_FACTORY_ADDRESS,
    VAULT_ONCHAIN_USDC_ADDRESS: process.env.VAULT_ONCHAIN_USDC_ADDRESS
  };

  process.env.VAULT_ONCHAIN_RPC_URL = "http://127.0.0.1:8545";
  process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000f1";
  process.env.VAULT_ONCHAIN_USDC_ADDRESS = "0x00000000000000000000000000000000000000c1";

  const masterUpdates: any[] = [];

  try {
    const db = {
      globalSetting: {
        async findUnique() {
          return { value: { mode: "onchain_live" }, updatedAt: new Date() };
        }
      },
      masterVault: {
        async findMany() {
          return [
            {
              id: "mv_1",
              onchainAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              freeBalance: 250,
              reservedBalance: 0
            }
          ];
        },
        async update(args: any) {
          masterUpdates.push(args);
          return args;
        }
      },
      cashEvent: {
        async findMany() {
          return [
            {
              amount: 50,
              metadata: {
                sourceType: "admin_closed_vault_compensation",
                creditToMasterVaultBalance: true
              }
            }
          ];
        }
      },
      botVault: {
        async findMany() {
          return [];
        }
      }
    } as any;

    const job = createVaultOnchainReconciliationJob(db, {
      readMasterVaultState: async () => ({
        freeBalance: 250,
        reservedBalance: 0
      }),
      readBotVaultState: async () => ({
        principalAllocated: 0,
        principalReturned: 0,
        realizedPnlNet: 0,
        feePaidTotal: 0,
        highWaterMark: 0,
        status: 0
      })
    });

    const result = await job.runCycle("manual");

    assert.equal(result.enabled, true);
    assert.equal(result.drifts, 1);
    assert.equal(masterUpdates.length, 1);
    assert.deepEqual(masterUpdates[0]?.data, {
      freeBalance: 300,
      reservedBalance: 0,
      availableUsd: 300
    });
  } finally {
    process.env.VAULT_ONCHAIN_RPC_URL = previousEnv.VAULT_ONCHAIN_RPC_URL;
    process.env.VAULT_ONCHAIN_FACTORY_ADDRESS = previousEnv.VAULT_ONCHAIN_FACTORY_ADDRESS;
    process.env.VAULT_ONCHAIN_USDC_ADDRESS = previousEnv.VAULT_ONCHAIN_USDC_ADDRESS;
  }
});
