import assert from "node:assert/strict";
import test from "node:test";
import { createVaultOnchainReconciliationJob } from "./vaultOnchainReconciliationJob.js";

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
              vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              principalAllocated: 111.24,
              principalReturned: 0,
              realizedPnlNet: 0,
              feePaidTotal: 0,
              highWaterMark: 0,
              status: "ACTIVE",
              executionStatus: "created"
            }
          ];
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
        principalAllocated: 111.24,
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
                sourceType: "admin_closed_vault_compensation"
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
