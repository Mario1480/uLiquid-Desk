import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAdminPlanOverride,
  type AdminPlanOverrideSnapshot,
  type ResolvedEffectivePlan
} from "./service.js";

function plan(plan: "free" | "pro" | "premium"): ResolvedEffectivePlan {
  return {
    userId: "user_1",
    plan,
    status: "active",
    planValidUntil: null,
    proValidUntil: null,
    maxExchangeAccounts: plan === "premium" ? 15 : plan === "pro" ? 5 : 1,
    maxRunningBots: plan === "premium" ? 10 : plan === "pro" ? 3 : 1,
    maxRunningPredictionsAi: plan === "premium" ? 10 : plan === "pro" ? 3 : 0,
    maxRunningPredictionsComposite: plan === "premium" ? 5 : plan === "pro" ? 2 : 0,
    allowedExchanges: ["*"],
    aiCreditBalance: 321n,
    aiCreditsUsedLifetime: 123n,
    monthlyAiCreditsIncluded: 77n
  };
}

function override(planValue: "pro" | "premium"): AdminPlanOverrideSnapshot {
  return {
    id: "override_1",
    userId: "user_1",
    plan: planValue,
    validUntil: "2026-12-31T23:59:59.999Z",
    reason: "Support grant",
    active: true,
    grantedByUserId: "admin_1",
    grantedAt: "2026-08-29T10:00:00.000Z",
    revokedByUserId: null,
    revokedAt: null,
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z"
  };
}

test("manual override upgrades Free while preserving the AI credit ledger snapshot", () => {
  const result = applyAdminPlanOverride(plan("free"), override("premium"));
  assert.equal(result.plan, "premium");
  assert.equal(result.maxRunningBots, 10);
  assert.equal(result.aiCreditBalance, 321n);
  assert.equal(result.aiCreditsUsedLifetime, 123n);
  assert.equal(result.monthlyAiCreditsIncluded, 77n);
});

test("manual override never downgrades a paid commercial plan", () => {
  const commercial = plan("premium");
  assert.deepEqual(applyAdminPlanOverride(commercial, override("pro")), commercial);
});
