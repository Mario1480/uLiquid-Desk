import assert from "node:assert/strict";
import test from "node:test";
import {
  isGridProvisioningActionAllowed,
  isGridProvisioningOnchainActionType
} from "./provisioningAuthorization.js";

test("grid provisioning build actions are limited to their exact pending phase", () => {
  assert.equal(isGridProvisioningActionAllowed({ action: "reserve", phase: "pending_reserve_signature" }), true);
  assert.equal(isGridProvisioningActionAllowed({ action: "reserve", phase: "pending_hypercore_funding_signature" }), false);
  assert.equal(isGridProvisioningActionAllowed({ action: "fund_hypercore", phase: "pending_hypercore_funding_signature" }), true);
  assert.equal(isGridProvisioningActionAllowed({ action: "fund_hypercore", phase: "running" }), false);
});

test("grid-scoped transaction updates reject unrelated vault actions", () => {
  for (const actionType of [
    "create_bot_vault",
    "create_bot_vault_v3",
    "create_bot_vault_v4",
    "reserve_for_bot_vault",
    "fund_bot_vault_v3",
    "fund_bot_vault_v4",
    "fund_bot_vault_hypercore"
  ]) {
    assert.equal(isGridProvisioningOnchainActionType(actionType), true);
  }
  for (const actionType of [
    "claim_from_bot_vault",
    "close_bot_vault",
    "withdraw_funding_vault",
    "set_treasury_recipient"
  ]) {
    assert.equal(isGridProvisioningOnchainActionType(actionType), false);
  }
});
