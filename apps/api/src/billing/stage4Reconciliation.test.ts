import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_STAGE4_PACKAGES, canonicalPackageByCode } from "./canonicalPackages.js";
import { isCapacityGrantScopeCompatible } from "./service.js";
import {
  buildCanonicalPackageMutations,
  buildStage4SubscriptionDecision,
  buildStage4TermDecision,
  classifySubscriptionTermPlan,
  runStage4Reconciliation
} from "./stage4Reconciliation.js";

test("Stage 4 canonical catalog matches the approved package and add-on matrix", () => {
  const free = canonicalPackageByCode("free");
  const pro = canonicalPackageByCode("pro_monthly");
  const premium = canonicalPackageByCode("premium_monthly");

  assert.deepEqual(
    [free.priceCents, free.maxRunningBots, free.maxRunningPredictionsAi, free.maxRunningPredictionsComposite, free.monthlyAiCredits, free.maxExchangeAccounts],
    [0, 2, 0, 0, 0n, 1]
  );
  assert.deepEqual(
    [pro.priceCents, pro.maxRunningBots, pro.maxRunningPredictionsAi, pro.maxRunningPredictionsComposite, pro.monthlyAiCredits, pro.maxExchangeAccounts],
    [2_900, 5, 3, 2, 10_000n, null]
  );
  assert.deepEqual(
    [premium.priceCents, premium.maxRunningBots, premium.maxRunningPredictionsAi, premium.maxRunningPredictionsComposite, premium.monthlyAiCredits, premium.maxExchangeAccounts],
    [6_900, 15, 10, 5, 30_000n, null]
  );
  assert.equal(premium.isActive, false);

  const capacity = CANONICAL_STAGE4_PACKAGES.filter((item) => item.addonType?.startsWith("RUNNING_"));
  assert.equal(capacity.length, 3);
  assert.equal(capacity.every((item) => item.priceCents === 500 && item.plan === null), true);
  const topups = CANONICAL_STAGE4_PACKAGES.filter((item) => item.addonType === "AI_CREDITS");
  assert.deepEqual(topups.map((item) => [item.aiCredits, item.priceCents]), [
    [10_000n, 1_000],
    [25_000n, 2_500],
    [50_000n, 5_000],
    [100_000n, 10_000]
  ]);
});

test("canonical package reconciliation creates Premium and removes exact-plan scope from capacity add-ons", () => {
  const mutations = buildCanonicalPackageMutations([
    {
      id: "pkg_pro",
      code: "pro_monthly",
      name: "Old Pro",
      kind: "PLAN",
      plan: "PRO",
      maxRunningBots: 3,
      monthlyAiCredits: 10_000n
    },
    {
      id: "pkg_capacity",
      code: "capacity_topup_bots_unit",
      name: "Capacity Topup Bots Unit",
      description: "Adds bot capacity until plan end",
      kind: "ADDON",
      addonType: "RUNNING_BOTS",
      isActive: true,
      sortOrder: 31,
      priceCents: 500,
      billingMonths: 1,
      plan: "PRO",
      maxExchangeAccounts: null,
      maxRunningBots: null,
      maxRunningPredictionsAi: null,
      maxRunningPredictionsComposite: null,
      allowedExchanges: ["*"],
      monthlyAiCredits: 0n,
      aiCredits: 0n,
      deltaRunningBots: 1,
      deltaRunningPredictionsAi: 0,
      deltaRunningPredictionsComposite: 0,
      meta: { billingAddonType: "running_bots" }
    }
  ]);

  const premium = mutations.find((item) => item.id === "premium_monthly");
  const pro = mutations.find((item) => item.id === "pkg_pro");
  const capacity = mutations.find((item) => item.id === "pkg_capacity");
  assert.equal(premium?.changedFields.includes("create"), true);
  assert.equal(premium?.data.isActive, false);
  assert.equal(pro?.data.maxRunningBots, 5);
  assert.equal(capacity?.data.plan, null);
  assert.equal(capacity?.changedFields.includes("plan"), true);
});

test("canonical package reconciliation is a no-op when repeated against its projected state", () => {
  const canonicalRows = CANONICAL_STAGE4_PACKAGES.map((item, index) => ({
    id: `pkg_${index}`,
    ...item
  }));
  assert.deepEqual(buildCanonicalPackageMutations(canonicalRows), []);
});

test("term plan backfill is strict, conflict-aware and preserves order/add-on evidence", () => {
  const lines = [{ quantity: 2, package: { code: "capacity_topup_bots_unit", kind: "addon" } }];
  const term = {
    id: "term_1",
    userId: "user_1",
    plan: null,
    status: "ACTIVE",
    monthlyAiCredits: 5_000n,
    entitlementSnapshot: {
      plan: "PRO",
      packageCode: "pro_monthly",
      maxRunningBots: 3,
      lines
    }
  };
  const decision = buildStage4TermDecision(term);
  assert.equal(decision.review, null);
  assert.deepEqual(decision.mutation?.changedFields, ["plan", "entitlementSnapshot", "monthlyAiCredits"]);
  assert.equal(decision.mutation?.data.plan, "PRO");
  const snapshot = decision.mutation?.data.entitlementSnapshot as Record<string, unknown>;
  assert.equal(snapshot.maxRunningBots, 5);
  assert.equal(snapshot.maxExchangeAccounts, null);
  assert.equal(snapshot.monthlyAiCredits, "10000");
  assert.equal(snapshot.priceCents, 2_900);
  assert.equal(snapshot.billingMonths, 1);
  assert.deepEqual(snapshot.lines, lines);

  const reconciled = buildStage4TermDecision({
    ...term,
    plan: "PRO",
    monthlyAiCredits: 10_000n,
    entitlementSnapshot: snapshot
  });
  assert.equal(reconciled.mutation, null);

  const conflict = classifySubscriptionTermPlan({
    ...term,
    plan: "FREE"
  });
  assert.equal(conflict.plan, null);
  assert.equal(conflict.reason, "term_plan_conflict");
});

test("subscription backfill updates entitlement fields without touching balances, orders or ledger state", () => {
  const free = buildStage4SubscriptionDecision({
    id: "sub_free",
    userId: "user_free",
    effectivePlan: "FREE",
    maxExchangeAccounts: null,
    maxRunningBots: 1,
    maxRunningPredictionsAi: null,
    maxRunningPredictionsComposite: null,
    allowedExchanges: ["*"],
    monthlyAiCreditsIncluded: 1_000n,
    aiCreditBalance: 55_000n,
    terms: []
  });
  assert.equal(free.mutation?.data.maxExchangeAccounts, 1);
  assert.equal(free.mutation?.data.maxRunningBots, 2);
  assert.equal(free.mutation?.data.monthlyAiCreditsIncluded, 0n);
  assert.equal("aiCreditBalance" in (free.mutation?.data ?? {}), false);

  const paidEnd = new Date("2026-10-01T00:00:00.000Z");
  const pro = buildStage4SubscriptionDecision({
    id: "sub_pro",
    userId: "user_pro",
    effectivePlan: "PRO",
    status: "ACTIVE",
    maxExchangeAccounts: 1,
    maxRunningBots: 3,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2,
    allowedExchanges: ["*"],
    monthlyAiCreditsIncluded: 10_000n,
    aiCreditBalance: 99_000n,
    terms: [{
      id: "term_pro",
      plan: null,
      status: "ACTIVE",
      endsAt: paidEnd,
      entitlementSnapshot: { plan: "PRO", packageCode: "pro_monthly" }
    }]
  });
  assert.equal(pro.mutation?.data.maxExchangeAccounts, null);
  assert.equal(pro.mutation?.data.maxRunningBots, 5);
  assert.equal(pro.mutation?.data.planValidUntil, paidEnd);
  assert.equal(pro.mutation?.data.proValidUntil, paidEnd);
  assert.equal("aiCreditBalance" in (pro.mutation?.data ?? {}), false);

  const inactivePro = buildStage4SubscriptionDecision({
    id: "sub_inactive_pro",
    userId: "user_inactive_pro",
    effectivePlan: "PRO",
    status: "INACTIVE",
    maxRunningBots: 3,
    terms: []
  });
  assert.equal(inactivePro.mutation, null);
});

test("legacy paid capacity grants remain compatible across Pro and Premium without opening them to Free", () => {
  assert.equal(isCapacityGrantScopeCompatible("PREMIUM", "PRO"), true);
  assert.equal(isCapacityGrantScopeCompatible("PRO", "PREMIUM"), true);
  assert.equal(isCapacityGrantScopeCompatible("PRO", null), true);
  assert.equal(isCapacityGrantScopeCompatible("FREE", "PRO"), false);
  assert.equal(isCapacityGrantScopeCompatible("FREE", null), false);
  assert.equal(isCapacityGrantScopeCompatible("FREE", "FREE"), true);
});

test("the default Stage 4 dry-run projects before/after aggregates without opening a write transaction", async () => {
  let transactionCalls = 0;
  const database = {
    billingPackage: {
      findMany: async () => []
    },
    subscriptionTerm: {
      findMany: async () => [{
        id: "term_1",
        userId: "user_1",
        plan: null,
        status: "ACTIVE",
        monthlyAiCredits: 5_000n,
        entitlementSnapshot: {
          plan: "PRO",
          packageCode: "pro_monthly",
          maxRunningBots: 3,
          maxRunningPredictionsAi: 3,
          maxRunningPredictionsComposite: 2
        }
      }]
    },
    userSubscription: {
      findMany: async () => [{
        id: "sub_1",
        userId: "user_1",
        effectivePlan: "PRO",
        status: "ACTIVE",
        maxExchangeAccounts: 1,
        maxRunningBots: 3,
        maxRunningPredictionsAi: 3,
        maxRunningPredictionsComposite: 2,
        allowedExchanges: ["*"],
        monthlyAiCreditsIncluded: 5_000n,
        terms: [{
          id: "term_1",
          plan: null,
          status: "ACTIVE",
          endsAt: new Date("2026-10-01T00:00:00.000Z"),
          entitlementSnapshot: { plan: "PRO", packageCode: "pro_monthly" }
        }]
      }]
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("dry_run_must_not_write");
    }
  };

  const report = await runStage4Reconciliation({
    database,
    now: new Date("2026-08-26T00:00:00.000Z")
  });
  assert.equal(report.mode, "dry-run");
  assert.equal(transactionCalls, 0);
  assert.equal(report.packages.create, CANONICAL_STAGE4_PACKAGES.length);
  assert.equal(report.aggregates.terms.before.runningBotsTotal, 3);
  assert.equal(report.aggregates.terms.projectedAfter.runningBotsTotal, 5);
  assert.equal(report.aggregates.subscriptions.before.monthlyAiCreditsTotal, "5000");
  assert.equal(report.aggregates.subscriptions.projectedAfter.monthlyAiCreditsTotal, "10000");
});
