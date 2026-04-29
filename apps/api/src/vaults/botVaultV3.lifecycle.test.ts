import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBotVaultV3FundingLifecycleTransition,
  buildBotVaultV3FundingLifecycleTransitionPatch,
  classifyBotVaultV4Mismatch,
  classifyBotVaultV4Status,
  createBotVaultV3FundingLifecycleMetadata,
  findBotVaultV3FundingLifecyclePath,
  readBotVaultV3FundingLifecycleState
} from "./botVaultV3.lifecycle.js";

test("bot vault v3 lifecycle accepts the strict happy-path transitions", () => {
  const path = findBotVaultV3FundingLifecyclePath("deployed", "execution_ready");
  assert.deepEqual(path, [
    "deployed",
    "funding_requested",
    "hyper_evm_confirmed",
    "hypercore_funded",
    "perp_margin_transferred",
    "hype_reserve_ready",
    "execution_ready"
  ]);

  assert.doesNotThrow(() => {
    assertBotVaultV3FundingLifecycleTransition("deployed", "funding_requested");
    assertBotVaultV3FundingLifecycleTransition("funding_requested", "hyper_evm_confirmed");
    assertBotVaultV3FundingLifecycleTransition("hyper_evm_confirmed", "hypercore_funded");
    assertBotVaultV3FundingLifecycleTransition("hypercore_funded", "perp_margin_transferred");
    assertBotVaultV3FundingLifecycleTransition("perp_margin_transferred", "execution_ready");
  });
});

test("bot vault v3 lifecycle rejects backwards or skipped terminal transitions", () => {
  assert.throws(
    () => assertBotVaultV3FundingLifecycleTransition("execution_ready", "hyper_evm_confirmed"),
    /bot_vault_v3_illegal_funding_lifecycle_transition/
  );
  assert.throws(
    () => assertBotVaultV3FundingLifecycleTransition("settled", "execution_ready"),
    /bot_vault_v3_illegal_funding_lifecycle_transition/
  );
});

test("bot vault v3 lifecycle patch records recovered intermediate transitions and keeps execution unstarted", () => {
  const row = {
    fundingStatus: "deployed",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    executionMetadata: createBotVaultV3FundingLifecycleMetadata("deployed")
  };

  const patch = buildBotVaultV3FundingLifecycleTransitionPatch({
    row,
    targetStage: "hypercore_funded",
    source: "test",
    reason: "observed_recovery",
    detail: "replayed_from_chain",
    occurredAt: "2026-04-15T00:00:00.000Z"
  });

  assert.equal(patch.fundingStatus, "hyper_evm_confirmed_onchain");
  assert.equal(patch.hypercoreFundingStatus, "pending");
  assert.equal(patch.executionStatus, "created");

  const lifecycle = readBotVaultV3FundingLifecycleState({
    executionMetadata: patch.executionMetadata
  });
  assert.equal(lifecycle.stage, "hypercore_funded");
  assert.equal(lifecycle.history.length, 3);
  assert.deepEqual(
    lifecycle.history.map((entry) => [entry.from, entry.to, entry.synthetic]),
    [
      ["deployed", "funding_requested", true],
      ["funding_requested", "hyper_evm_confirmed", true],
      ["hyper_evm_confirmed", "hypercore_funded", false]
    ]
  );
});

test("bot vault v3 lifecycle derives legacy v3 verified funding as execution_ready", () => {
  const lifecycle = readBotVaultV3FundingLifecycleState({
    fundingStatus: "hyper_evm_confirmed_onchain",
    hypercoreFundingStatus: "funded",
    executionStatus: "created",
    executionMetadata: {
      marginAddFinalization: {
        verificationState: "funding_verified"
      }
    }
  });

  assert.equal(lifecycle.stage, "execution_ready");
});

test("bot vault v3 lifecycle derives timed-out funding intents as recovery_required", () => {
  const lifecycle = readBotVaultV3FundingLifecycleState({
    fundingStatus: "hyper_evm_funding_requested",
    hypercoreFundingStatus: "not_funded",
    executionStatus: "created",
    executionMetadata: {
      fundingIntent: {
        actionStatus: "timed_out",
        timeoutReason: "bot_vault_v3_funding_intent_timeout:submitted",
        timedOutAt: "2026-04-15T00:30:00.000Z"
      }
    }
  });

  assert.equal(lifecycle.stage, "recovery_required");
});

test("bot vault v4 mismatch classifier keeps read gaps retryable", () => {
  const mismatch = classifyBotVaultV4Mismatch({
    reason: "execution_state_unavailable",
    detail: "execution state could not be read for reconciliation"
  });

  assert.equal(mismatch?.category, "observed_state_incomplete");
  assert.equal(mismatch?.recoveryAction, "retry");
});

test("bot vault v4 mismatch classifier separates counterevidence from reserve user action", () => {
  const localAhead = classifyBotVaultV4Mismatch({
    reason: "funding_lifecycle_execution_ready_counterevidence",
    detail: "venue state supports perp_margin_transferred, but not execution_ready"
  });
  const reserveUserAction = classifyBotVaultV4Mismatch({
    reason: "bot_vault_v4_hype_reserve_core_spot_usdc_missing",
    failureClass: "user_action_required"
  });

  assert.equal(localAhead?.category, "local_ahead_of_observed_state");
  assert.equal(localAhead?.recoveryAction, "degrade");
  assert.equal(reserveUserAction?.category, "manual_intervention_required");
  assert.equal(reserveUserAction?.recoveryAction, "user_action_required");
});

test("bot vault v4 status classifier normalizes pending and retryable states", () => {
  const pending = classifyBotVaultV4Status({
    lifecycleStage: "funding_requested",
    reason: "bot_vault_v3_funding_requested_not_confirmed"
  });
  const retryable = classifyBotVaultV4Status({
    reason: "execution_state_unavailable",
    detail: "execution state could not be read for reconciliation",
    mismatch: classifyBotVaultV4Mismatch({
      reason: "execution_state_unavailable",
      detail: "execution state could not be read for reconciliation"
    })
  });

  assert.equal(pending.category, "pending");
  assert.equal(retryable.category, "retryable");
});

test("bot vault v4 status classifier separates recovery, user action, ready and settled", () => {
  assert.equal(classifyBotVaultV4Status({
    lifecycleStage: "recovery_required",
    reason: "funding_lifecycle_execution_ready_counterevidence",
    mismatch: classifyBotVaultV4Mismatch({
      reason: "funding_lifecycle_execution_ready_counterevidence",
      detail: "venue state supports perp_margin_transferred, but not execution_ready"
    })
  }).category, "recovery_required");

  assert.equal(classifyBotVaultV4Status({
    reason: "bot_vault_v4_hype_reserve_core_spot_usdc_missing",
    recoveryAction: "user_action_required"
  }).category, "user_action_required");

  assert.equal(classifyBotVaultV4Status({
    reason: "bot_vault_v4_hype_reserve_corewriter_missing",
    mismatchCategory: "manual_intervention_required",
    recoveryAction: "recovery_required"
  }).category, "recovery_required");

  assert.equal(classifyBotVaultV4Status({ ready: true, lifecycleStage: "execution_ready" }).category, "execution_ready");
  assert.equal(classifyBotVaultV4Status({ lifecycleStage: "settled" }).category, "settled");
});
