import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultTradingReconciliationJob } from "./botVaultTradingReconciliationJob.js";

test("botVaultTradingReconciliationJob stores latest summary and cumulative counters", async () => {
  const calls: any[] = [];
  const service: any = {
    reconcileHyperliquidBotVaults: async (payload: any) => {
      calls.push(payload);
      return {
        scanned: 3,
        processed: 2,
        failed: 1,
        newOrders: 4,
        newFills: 5,
        newFundingEvents: 2
      };
    }
  };

  const job = createBotVaultTradingReconciliationJob({}, service);
  await job.runCycle("manual");
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(calls.length, 2);
  assert.equal(status.lastScanned, 3);
  assert.equal(status.lastProcessed, 2);
  assert.equal(status.lastFailed, 1);
  assert.equal(status.lastNewOrders, 4);
  assert.equal(status.lastNewFills, 5);
  assert.equal(status.lastNewFundingEvents, 2);
  assert.equal(status.totalCycles, 2);
  assert.equal(status.totalProcessedVaults, 4);
  assert.equal(status.totalNewOrders, 8);
  assert.equal(status.totalNewFills, 10);
  assert.equal(status.totalNewFundingEvents, 4);
});

test("botVaultTradingReconciliationJob increments failed cycles on errors", async () => {
  const service: any = {
    reconcileHyperliquidBotVaults: async () => {
      throw new Error("reconciliation_boom");
    }
  };

  const job = createBotVaultTradingReconciliationJob({}, service);
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.totalCycles, 1);
  assert.equal(status.totalFailedCycles, 1);
  assert.equal(String(status.lastError).includes("reconciliation_boom"), true);
});
