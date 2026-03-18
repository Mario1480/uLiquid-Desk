import assert from "node:assert/strict";
import test from "node:test";
import { adminBillingPackageSchema } from "./routes.js";

test("adminBillingPackageSchema accepts token fields as numbers or strings", () => {
  const basePayload = {
    code: "free",
    name: "Free",
    kind: "plan",
    priceCents: 0
  };

  const parsedNumbers = adminBillingPackageSchema.safeParse({
    ...basePayload,
    monthlyAiTokens: 1000,
    topupAiTokens: 250
  });
  assert.equal(parsedNumbers.success, true);
  if (parsedNumbers.success) {
    assert.equal(parsedNumbers.data.monthlyAiTokens, "1000");
    assert.equal(parsedNumbers.data.topupAiTokens, "250");
  }

  const parsedStrings = adminBillingPackageSchema.safeParse({
    ...basePayload,
    monthlyAiTokens: "1000",
    topupAiTokens: "250"
  });
  assert.equal(parsedStrings.success, true);
  if (parsedStrings.success) {
    assert.equal(parsedStrings.data.monthlyAiTokens, "1000");
    assert.equal(parsedStrings.data.topupAiTokens, "250");
  }
});
