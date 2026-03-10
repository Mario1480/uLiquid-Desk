import assert from "node:assert/strict";
import test from "node:test";
import { createVaultOnchainIndexerJob } from "./vaultOnchainIndexerJob.js";

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
