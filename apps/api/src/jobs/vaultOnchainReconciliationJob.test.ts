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
