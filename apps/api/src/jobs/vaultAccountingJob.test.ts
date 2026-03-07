import assert from "node:assert/strict";
import test from "node:test";
import { createVaultAccountingJob } from "./vaultAccountingJob.js";

test("vaultAccountingJob runCycle stores latest summary and cumulative counters", async () => {
  const calls: any[] = [];
  const service: any = {
    processPendingGridFillEvents: async (payload: any) => {
      calls.push(payload);
      return {
        processed: 3,
        realizedEvents: 2,
        realizedNetUsd: 12.5,
        profitShareFeeUsd: 3.75
      };
    }
  };

  const job = createVaultAccountingJob({}, service);
  await job.runCycle("manual");
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(calls.length, 2);
  assert.equal(status.lastProcessedCount, 3);
  assert.equal(status.lastRealizedEvents, 2);
  assert.equal(status.lastRealizedNetUsd, 12.5);
  assert.equal(status.lastProfitShareFeeUsd, 3.75);
  assert.equal(status.totalCycles, 2);
  assert.equal(status.totalProcessedEvents, 6);
  assert.equal(status.totalRealizedEvents, 4);
  assert.equal(status.totalFailedCycles, 0);
});

test("vaultAccountingJob increments failed counters on errors", async () => {
  const service: any = {
    processPendingGridFillEvents: async () => {
      throw new Error("accounting_boom");
    }
  };

  const job = createVaultAccountingJob({}, service);
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.totalCycles, 1);
  assert.equal(status.totalFailedCycles, 1);
  assert.equal(typeof status.lastError, "string");
  assert.equal(String(status.lastError).includes("accounting_boom"), true);
});
