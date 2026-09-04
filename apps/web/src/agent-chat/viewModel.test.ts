import assert from "node:assert/strict";
import test from "node:test";
import { activityTone, canSendAgentMessage, requiresSelectedExchangeAccount, selectDecisionLog } from "./viewModel";

test("account-read profiles require an explicitly selected account", () => {
  const profile = { actionLevel: "account_read" } as any;
  assert.equal(requiresSelectedExchangeAccount(profile, null), true);
  assert.equal(requiresSelectedExchangeAccount(profile, "acct_1"), false);
  assert.equal(canSendAgentMessage({ content: "Analyze", loading: false, profile, selectedExchangeAccountId: null }), false);
  assert.equal(canSendAgentMessage({ content: "Analyze", loading: false, profile, selectedExchangeAccountId: "acct_1" }), true);
});

test("decision log selection defaults to the newest run and supports recent-run selection", () => {
  const logs = [{ runId: "new" }, { runId: "old" }] as any;
  assert.equal(selectDecisionLog(logs, null)?.runId, "new");
  assert.equal(selectDecisionLog(logs, "old")?.runId, "old");
  assert.equal(selectDecisionLog([], null), null);
});

test("activity status maps unknown states to loading", () => {
  assert.equal(activityTone("success"), "success");
  assert.equal(activityTone("queued"), "loading");
  assert.equal(activityTone("blocked"), "blocked");
});
