import assert from "node:assert/strict";
import test from "node:test";
import { createBotVaultRiskJob } from "./botVaultRiskJob.js";

test("botVaultRiskJob runCycle stores enforcement summary", async () => {
  const calls: any[] = [];
  const service: any = {
    enforceRuntimeGuardrailsForActiveVaults: async (payload: any) => {
      calls.push(payload);
      return {
        scanned: 4,
        breached: 2,
        paused: 2,
        failed: 0
      };
    }
  };

  const job = createBotVaultRiskJob({}, service);
  await job.runCycle("manual");
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(Array.isArray(calls), true);
  assert.equal(calls.length, 2);
  assert.equal(status.lastSummary.scanned, 4);
  assert.equal(status.lastSummary.paused, 2);
  assert.equal(status.lastError, null);
  assert.equal(status.totalCycles, 2);
  assert.equal(status.totalBreaches, 4);
  assert.equal(status.totalAutoPauses, 4);
  assert.equal(status.totalFailedCycles, 0);
});

test("botVaultRiskJob captures errors and keeps running=false", async () => {
  const service: any = {
    enforceRuntimeGuardrailsForActiveVaults: async () => {
      throw new Error("boom");
    }
  };

  const job = createBotVaultRiskJob({}, service);
  await job.runCycle("manual");

  const status = job.getStatus();
  assert.equal(status.running, false);
  assert.equal(typeof status.lastError, "string");
  assert.equal(String(status.lastError).includes("boom"), true);
  assert.equal(status.totalCycles, 1);
  assert.equal(status.totalFailedCycles, 1);
});
