import assert from "node:assert/strict";
import test from "node:test";
import {
  createVaultOnchainIndexerJob,
  mergeBotVaultExecutionMetadata,
  readDeferredProvisioningAllocationUsd,
  requiresDeferredReserve
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
