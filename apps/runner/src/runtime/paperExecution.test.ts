import assert from "node:assert/strict";
import test from "node:test";
import {
  getRunnerDefaultPaperBalanceUsd,
  resolveRunnerPaperSimulationPolicy
} from "./paperExecution.js";

test("resolveRunnerPaperSimulationPolicy returns normalized paper defaults", () => {
  const policy = resolveRunnerPaperSimulationPolicy();

  assert.equal(policy.fundingMode, "disabled");
  assert.equal(typeof policy.feeBps, "number");
  assert.equal(typeof policy.slippageBps, "number");
  assert.equal(typeof policy.startBalanceUsd, "number");
  assert.ok(policy.startBalanceUsd >= 0);
});

test("getRunnerDefaultPaperBalanceUsd reuses the centralized paper policy", () => {
  assert.equal(
    getRunnerDefaultPaperBalanceUsd(),
    resolveRunnerPaperSimulationPolicy().startBalanceUsd
  );
});
