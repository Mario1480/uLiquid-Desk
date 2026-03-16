import assert from "node:assert/strict";
import test from "node:test";
import {
  isEnvEnabled,
  validateDomainList,
  validateSecretKeyMaterial,
  validateServiceEnv,
  validateUrlList
} from "./env.js";

test("validateServiceEnv reports required variables", () => {
  assert.throws(
    () =>
      validateServiceEnv("apps/api", [
        {
          names: ["DATABASE_URL"],
          required: true
        }
      ], {}),
    /DATABASE_URL is required/
  );
});

test("validateServiceEnv supports alias variables", () => {
  assert.doesNotThrow(() =>
    validateServiceEnv("apps/runner", [
      {
        names: ["AGENT_SECRET_ENCRYPTION_KEY", "SECRET_MASTER_KEY"],
        required: true
      }
    ], { SECRET_MASTER_KEY: "0123456789abcdef0123456789abcdef" })
  );
});

test("shared validators accept expected formats", () => {
  assert.equal(isEnvEnabled("true"), true);
  assert.equal(isEnvEnabled("0", true), false);
  assert.equal(validateUrlList("https://desk.uliquid.vip,http://localhost:4000"), null);
  assert.equal(validateDomainList("desk.uliquid.vip,api.desk.uliquid.vip"), null);
  assert.equal(validateSecretKeyMaterial("0123456789abcdef0123456789abcdef"), null);
  assert.equal(
    validateSecretKeyMaterial("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    null
  );
});
