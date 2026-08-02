import assert from "node:assert/strict";
import test from "node:test";
import { createBillingOnchainJob } from "./billingOnchainJob.js";

test("billing onchain job discovers missed transfers before reconciling submitted transactions", async () => {
  const calls: string[] = [];
  const job = createBillingOnchainJob({
    isBillingEnabled: async () => true,
    discoverMissingBillingTransactions: async () => {
      calls.push("discover");
      return { discovered: 1 };
    },
    reconcilePendingBillingPayments: async () => {
      calls.push("reconcile");
      return { confirmed: 1 };
    },
    runSubscriptionLifecycle: async () => ({})
  });
  const result = await job.runReconcileCycle("manual");
  assert.deepEqual(calls, ["discover", "reconcile"]);
  assert.deepEqual(result, {
    discovered: { discovered: 1 },
    reconciled: { confirmed: 1 }
  });
});

test("checkout disablement does not stop payment obligations or subscription lifecycle", async () => {
  let sideEffects = 0;
  const job = createBillingOnchainJob({
    isBillingEnabled: async () => false,
    discoverMissingBillingTransactions: async () => { sideEffects += 1; },
    reconcilePendingBillingPayments: async () => { sideEffects += 1; },
    runSubscriptionLifecycle: async () => { sideEffects += 1; }
  });
  await job.runReconcileCycle("manual");
  await job.runLifecycleCycle("manual");
  assert.equal(sideEffects, 3);
});

test("billing reconciliation does not overlap within one process", async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const job = createBillingOnchainJob({
    isBillingEnabled: async () => true,
    discoverMissingBillingTransactions: async () => gate,
    reconcilePendingBillingPayments: async () => undefined,
    runSubscriptionLifecycle: async () => undefined
  });
  const first = job.runReconcileCycle("manual");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await job.runReconcileCycle("manual"), { skipped: "already_running" });
  release?.();
  await first;
});

test("discovery failure cannot block confirmation of already submitted transaction hashes", async () => {
  const calls: string[] = [];
  const job = createBillingOnchainJob({
    isBillingEnabled: async () => true,
    discoverMissingBillingTransactions: async () => {
      calls.push("discover");
      throw new Error("eth_getLogs rate limited");
    },
    reconcilePendingBillingPayments: async () => {
      calls.push("reconcile");
      return { paid: 1 };
    },
    runSubscriptionLifecycle: async () => undefined
  });
  const result = await job.runReconcileCycle("manual");
  assert.deepEqual(calls, ["discover", "reconcile"]);
  assert.deepEqual(result, {
    discovered: null,
    reconciled: { paid: 1 },
    discoveryError: "eth_getLogs rate limited"
  });
});
