import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultPlanCapabilities } from "@mm/core";
import {
  createResolvedEntitlementContext,
  resolveBillingAuthoritativeCapabilityPlan
} from "./entitlementContext.js";

test("billing is authoritative for commercial capability plans", () => {
  assert.equal(
    resolveBillingAuthoritativeCapabilityPlan({
      billingPlan: "free",
      strategyPlan: "pro"
    }),
    "free"
  );
  assert.equal(
    resolveBillingAuthoritativeCapabilityPlan({
      billingPlan: "premium",
      strategyPlan: "free"
    }),
    "premium"
  );
});

test("an explicit Enterprise license is preserved", () => {
  assert.equal(
    resolveBillingAuthoritativeCapabilityPlan({
      billingPlan: "free",
      strategyPlan: "enterprise"
    }),
    "enterprise"
  );
});

test("unknown commercial plans fail safe to Free", () => {
  assert.equal(
    resolveBillingAuthoritativeCapabilityPlan({
      billingPlan: "legacy_paid_unknown",
      strategyPlan: "pro"
    }),
    "free"
  );
});

test("resolved context carries plan, Enterprise override, capabilities, quotas and usage", () => {
  const capabilities = getDefaultPlanCapabilities("enterprise");
  const context = createResolvedEntitlementContext({
    billingPlan: "premium",
    strategyPlan: "enterprise",
    capabilities,
    capabilitySnapshot: { version: 1 },
    quotas: { bots: { maxRunning: 15 } },
    usage: { bots: { running: 2 } }
  });
  assert.equal(context.commercialPlan, "premium");
  assert.equal(context.capabilityPlan, "enterprise");
  assert.equal(context.enterpriseOverride, true);
  assert.equal(context.capabilities, capabilities);
  assert.deepEqual(context.quotas, { bots: { maxRunning: 15 } });
  assert.deepEqual(context.usage, { bots: { running: 2 } });
});
