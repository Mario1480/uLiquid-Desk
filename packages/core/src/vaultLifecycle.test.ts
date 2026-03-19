import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBotVaultLifecycleTransition,
  buildBotVaultLifecycleMetadata,
  canTransitionBotVaultLifecycle,
  deriveBotVaultLifecycleState,
  deriveMasterVaultLifecycleState
} from "./vaultLifecycle.js";

test("deriveBotVaultLifecycleState resolves active execution and close-only pause modes", () => {
  const active = deriveBotVaultLifecycleState({
    status: "ACTIVE",
    executionStatus: "running"
  });
  assert.equal(active.state, "execution_active");
  assert.equal(active.mode, "normal");
  assert.equal(active.canAcceptNewOrders, true);

  const closeOnly = deriveBotVaultLifecycleState({
    status: "CLOSE_ONLY",
    executionStatus: "close_only"
  });
  assert.equal(closeOnly.state, "paused");
  assert.equal(closeOnly.mode, "close_only");
  assert.equal(closeOnly.canAcceptNewOrders, false);
});

test("deriveBotVaultLifecycleState overlays settling and withdraw pending", () => {
  const settling = deriveBotVaultLifecycleState({
    status: "CLOSE_ONLY",
    executionStatus: "close_only",
    executionMetadata: {
      lifecycleOverrideState: "settling"
    }
  });
  assert.equal(settling.state, "settling");

  const withdrawPending = deriveBotVaultLifecycleState({
    status: "ACTIVE",
    executionStatus: "paused",
    pendingActionType: "claim_from_bot_vault",
    pendingActionStatus: "submitted"
  });
  assert.equal(withdrawPending.state, "withdraw_pending");
});

test("buildBotVaultLifecycleMetadata emits normalized lifecycle payload", () => {
  const metadata = buildBotVaultLifecycleMetadata({
    status: "ACTIVE",
    executionStatus: "created",
    updatedAt: "2026-03-19T12:00:00.000Z"
  });
  assert.deepEqual(metadata, {
    lifecycle: {
      state: "bot_activation",
      baseState: "bot_activation",
      mode: "normal",
      status: "ACTIVE",
      executionStatus: "created",
      pendingActionType: null,
      pendingActionStatus: null,
      overrideState: null,
      needsIntervention: false,
      isTerminal: false,
      canAcceptNewOrders: false,
      updatedAt: "2026-03-19T12:00:00.000Z"
    }
  });
});

test("bot vault lifecycle transition matrix blocks invalid transitions", () => {
  assert.equal(canTransitionBotVaultLifecycle({ fromState: "execution_active", toState: "paused" }), true);
  assert.equal(canTransitionBotVaultLifecycle({ fromState: "paused", toState: "closed" }), true);
  assert.equal(canTransitionBotVaultLifecycle({ fromState: "execution_active", toState: "closed" }), false);

  assert.throws(
    () => assertBotVaultLifecycleTransition({ fromState: "execution_active", toState: "closed" }),
    /vault_lifecycle_transition_not_allowed/
  );
});

test("deriveMasterVaultLifecycleState marks funding and withdraw pending overlays", () => {
  const funding = deriveMasterVaultLifecycleState({
    status: "active",
    pendingActionType: "deposit_master_vault",
    pendingActionStatus: "prepared"
  });
  assert.equal(funding.state, "master_funding");

  const withdraw = deriveMasterVaultLifecycleState({
    status: "active",
    pendingActionType: "withdraw_master_vault",
    pendingActionStatus: "submitted"
  });
  assert.equal(withdraw.state, "withdraw_pending");

  const ready = deriveMasterVaultLifecycleState({
    status: "active"
  });
  assert.equal(ready.state, "ready");
});
