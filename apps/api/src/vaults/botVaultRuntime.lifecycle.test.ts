import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBotVaultRuntimeMismatch,
  createBotVaultFundingLifecycleMetadata,
  findBotVaultFundingLifecyclePath,
  readBotVaultFundingLifecycleState
} from "./botVaultRuntime.lifecycle.js";

test("bot vault runtime lifecycle aliases preserve the v4 funding path", () => {
  assert.deepEqual(findBotVaultFundingLifecyclePath("deployed", "execution_ready"), [
    "deployed",
    "funding_requested",
    "hyper_evm_confirmed",
    "hypercore_funded",
    "perp_margin_transferred",
    "hype_reserve_ready",
    "execution_ready"
  ]);

  const metadata = createBotVaultFundingLifecycleMetadata("hype_reserve_ready", "2026-04-29T00:00:00.000Z");
  const lifecycle = readBotVaultFundingLifecycleState({ executionMetadata: metadata });

  assert.equal(lifecycle.stage, "hype_reserve_ready");
  assert.equal(lifecycle.updatedAt, "2026-04-29T00:00:00.000Z");
});

test("bot vault runtime mismatch alias exposes the pragmatic v4 categories", () => {
  const localAhead = classifyBotVaultRuntimeMismatch({
    reason: "funding_lifecycle_execution_ready_counterevidence",
    detail: "venue state supports perp_margin_transferred, but not execution_ready"
  });
  const readGap = classifyBotVaultRuntimeMismatch({
    reason: "execution_state_unavailable",
    detail: "execution state could not be read for reconciliation"
  });

  assert.equal(localAhead?.category, "local_ahead_of_observed_state");
  assert.equal(localAhead?.recoveryAction, "degrade");
  assert.equal(readGap?.category, "observed_state_incomplete");
  assert.equal(readGap?.recoveryAction, "retry");
});
