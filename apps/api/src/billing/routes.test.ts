import assert from "node:assert/strict";
import test from "node:test";
import { adminBillingPackageSchema } from "./routes.js";

test("adminBillingPackageSchema accepts plan token fields as numbers or strings", () => {
  const basePayload = {
    code: "free",
    name: "Free",
    kind: "plan",
    priceCents: 0
  };

  const parsedNumbers = adminBillingPackageSchema.safeParse({
    ...basePayload,
    plan: "free",
    monthlyAiTokens: 1000
  });
  assert.equal(parsedNumbers.success, true);
  if (parsedNumbers.success) {
    assert.equal(parsedNumbers.data.monthlyAiTokens, "1000");
  }

  const parsedStrings = adminBillingPackageSchema.safeParse({
    ...basePayload,
    plan: "free",
    monthlyAiTokens: "1000"
  });
  assert.equal(parsedStrings.success, true);
  if (parsedStrings.success) {
    assert.equal(parsedStrings.data.monthlyAiTokens, "1000");
  }
});

test("adminBillingPackageSchema accepts add-on credit fields as numbers or strings", () => {
  const parsed = adminBillingPackageSchema.safeParse({
    code: "ai_credits_250k",
    name: "AI Credits 250k",
    kind: "addon",
    addonType: "ai_credits",
    priceCents: 900,
    aiCredits: "250000"
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.aiCredits, "250000");
  }
});

test("adminBillingPackageSchema requires addonType for add-ons", () => {
  const parsed = adminBillingPackageSchema.safeParse({
    code: "running_bots_1",
    name: "Running Bots +1",
    kind: "addon",
    priceCents: 900
  });
  assert.equal(parsed.success, false);
});
