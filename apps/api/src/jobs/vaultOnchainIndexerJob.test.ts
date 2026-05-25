import assert from "node:assert/strict";
import test from "node:test";
import {
  createVaultOnchainIndexerJob,
  filterLogsFromBlock,
  mergeBotVaultExecutionMetadata,
  rankSubmittedOnchainActionForIndexer,
  readDeferredProvisioningAllocationUsd,
  requiresDeferredReserve,
  shouldQueueBotVaultV3AutoActivate
} from "./vaultOnchainIndexerJob.js";

test("vaultOnchainIndexerJob skips when mode is offchain_shadow", async () => {
  const db = {
    globalSetting: {
      async findUnique() {
        return { value: { mode: "offchain_shadow" }, updatedAt: new Date() };
      }
    }
  } as any;

  const job = createVaultOnchainIndexerJob(db, {
    onchainActionService: {
      async markActionConfirmedByTxHash() {
        return;
      }
    } as any
  });

  const result = await job.runCycle("manual");
  assert.equal(result.enabled, false);
  assert.equal(result.mode, "offchain_shadow");

  const status = job.getStatus();
  assert.equal(status.mode, "offchain_shadow");
  assert.equal(status.totalLagAlerts, 0);
  assert.equal(status.consecutiveFailedCycles, 0);
});

test("mergeBotVaultExecutionMetadata preserves provider execution vault state", () => {
  const merged = mergeBotVaultExecutionMetadata(
    {
      providerState: {
        vaultAddress: "0x1111111111111111111111111111111111111111",
        status: "running",
        lastAction: "startBotExecution"
      },
      vaultAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chain: "999"
    },
    {
      vaultAddress: "0x2222222222222222222222222222222222222222",
      chain: "998",
      lastAction: "onchain_bot_vault_created"
    }
  );

  assert.equal(merged.vaultAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(merged.chain, "998");
  assert.equal((merged.providerState as Record<string, unknown>).vaultAddress, "0x1111111111111111111111111111111111111111");
  assert.equal((merged.providerState as Record<string, unknown>).lastAction, "startBotExecution");
});

test("readDeferredProvisioningAllocationUsd reads pending reserve allocations from provisioning metadata", () => {
  assert.equal(readDeferredProvisioningAllocationUsd({
    provisioning: {
      phase: "pending_signature",
      allocationUsd: 73
    }
  }), 73);
  assert.equal(readDeferredProvisioningAllocationUsd({
    provisioning: {
      phase: "execution_active"
    }
  }), 0);
});

test("requiresDeferredReserve only returns true while deferred bot vault allocation is still zero", () => {
  assert.equal(requiresDeferredReserve({
    principalAllocated: 0,
    allocatedUsd: 0,
    executionMetadata: {
      provisioning: {
        allocationUsd: 73
      }
    }
  }), true);
  assert.equal(requiresDeferredReserve({
    principalAllocated: 73,
    allocatedUsd: 73,
    executionMetadata: {
      provisioning: {
        allocationUsd: 73
      }
    }
  }), false);
});

test("shouldQueueBotVaultV3AutoActivate only queues unfired V3 auto-activations", () => {
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {}
  }), true);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {
      autoActivateStatus: "pending"
    }
  }), true);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {
      autoActivateStatus: "submitted",
      autoHypercoreFundingStatus: "submitted"
    }
  }), false);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {
      autoActivateStatus: "confirmed",
      autoHypercoreFundingStatus: "pending"
    }
  }), true);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {
      autoActivateStatus: "confirmed",
      autoHypercoreFundingStatus: "confirmed"
    }
  }), false);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "legacy_master",
    executionMetadata: {}
  }), false);
  assert.equal(shouldQueueBotVaultV3AutoActivate({
    vaultModel: "bot_vault_v3",
    executionMetadata: {
      onchainContractVersion: "v4"
    }
  }), true);
});

test("filterLogsFromBlock keeps only logs at or after the requested block", () => {
  const logs = [
    { blockNumber: 100n, logIndex: 0 } as any,
    { blockNumber: 101n, logIndex: 1 } as any,
    { blockNumber: 102n, logIndex: 2 } as any
  ];

  const filtered = filterLogsFromBlock(logs, 101n);

  assert.deepEqual(filtered.map((entry: any) => Number(entry.blockNumber)), [101, 102]);
});

test("rankSubmittedOnchainActionForIndexer prioritizes funding-vault launch confirmations", () => {
  assert.equal(rankSubmittedOnchainActionForIndexer({ actionType: "launch_bot_vault_from_funding_vault" }), 0);
  assert.ok(
    rankSubmittedOnchainActionForIndexer({ actionType: "launch_bot_vault_from_funding_vault" })
      < rankSubmittedOnchainActionForIndexer({ actionType: "create_bot_vault_v4" })
  );
  assert.ok(
    rankSubmittedOnchainActionForIndexer({ actionType: "fund_bot_vault_from_funding_vault" })
      < rankSubmittedOnchainActionForIndexer({ actionType: "withdraw_funding_vault" })
  );
});
