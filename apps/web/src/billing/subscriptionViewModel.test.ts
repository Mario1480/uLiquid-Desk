import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLicensePageModel,
  buildOrderPageModel,
  type BillingPackage,
  type SubscriptionPayload
} from "./subscriptionViewModel.js";

function planPackage(input: Partial<BillingPackage> & Pick<BillingPackage, "id" | "plan">): BillingPackage {
  return {
    id: input.id,
    code: `${input.plan}_monthly`,
    name: input.plan ?? "plan",
    description: null,
    kind: "plan",
    addonType: null,
    isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0,
    priceCents: input.priceCents ?? 0,
    billingMonths: 1,
    plan: input.plan,
    maxExchangeAccounts: null,
    maxRunningBots: input.maxRunningBots ?? 0,
    maxRunningPredictionsAi: input.maxRunningPredictionsAi ?? 0,
    maxRunningPredictionsComposite: input.maxRunningPredictionsComposite ?? 0,
    allowedExchanges: ["*"],
    monthlyAiCredits: input.monthlyAiCredits ?? "0",
    aiCredits: "0",
    deltaRunningBots: null,
    deltaRunningPredictionsAi: null,
    deltaRunningPredictionsComposite: null
  };
}

test("order model exposes active Pro and Premium packages but never inactive rollout packages", () => {
  const payload = {
    packages: [
      planPackage({ id: "pro", plan: "pro", priceCents: 2_900, sortOrder: 10 }),
      planPackage({ id: "premium", plan: "premium", priceCents: 6_900, sortOrder: 11 }),
      planPackage({ id: "premium_off", plan: "premium", priceCents: 6_900, isActive: false, sortOrder: 12 })
    ]
  } as SubscriptionPayload;
  const model = buildOrderPageModel(payload);
  assert.deepEqual(model.planPackages.map((pkg) => pkg.id), ["pro", "premium"]);
  assert.equal(model.planPackages[1]?.priceCents, 6_900);
});

test("license model renders Premium as a paid Premium tier", () => {
  const payload = {
    billingEnabled: true,
    plan: "premium",
    status: "active",
    planValidUntil: "2026-09-26T00:00:00.000Z",
    proValidUntil: "2026-09-26T00:00:00.000Z",
    limits: {
      maxExchangeAccounts: null,
      maxRunningBots: 15,
      allowedExchanges: ["*"],
      bots: { maxRunning: 15 },
      predictions: {
        local: { maxRunning: null },
        ai: { maxRunning: 10 },
        composite: { maxRunning: 5 }
      }
    },
    usage: {
      runningBots: 3,
      bots: { running: 3 },
      predictions: {
        local: { running: 0 },
        ai: { running: 2 },
        composite: { running: 1 }
      }
    },
    ai: {
      creditBalance: "12000",
      creditsUsedLifetime: "18000",
      monthlyIncludedCredits: "30000",
      billingEnabled: true
    },
    packages: [],
    orders: []
  } satisfies SubscriptionPayload;
  const model = buildLicensePageModel(payload, null, null);
  assert.equal(model?.plan, "premium");
  assert.equal(model?.features.proPlan, true);
  assert.equal(model?.features.premiumPlan, true);
  assert.equal(model?.limits.bots.maxRunning, 15);
  assert.equal(model?.ai.monthlyIncluded, "30000");
});
