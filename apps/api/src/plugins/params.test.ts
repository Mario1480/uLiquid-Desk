import assert from "node:assert/strict";
import test from "node:test";
import { attachPluginPolicySnapshot, normalizeBotPluginConfig, validateBotPluginConfigValue } from "./params.js";

test("validateBotPluginConfigValue accepts valid config", () => {
  const result = validateBotPluginConfigValue({
    version: 1,
    enabled: ["core.signal.legacy_dummy"]
  });
  assert.deepEqual(result, { ok: true });
});

test("normalizeBotPluginConfig compacts invalid values", () => {
  const normalized = normalizeBotPluginConfig({
    enabled: [" core.signal.legacy_dummy ", ""],
    disabled: ["core.execution.futures_engine_legacy", "core.execution.futures_engine_legacy"],
    order: ["core.signal.legacy_dummy"],
    policySnapshot: {
      plan: "free",
      allowedPluginIds: ["core.signal.legacy_dummy"],
      evaluatedAt: new Date().toISOString()
    }
  });

  assert.equal(normalized?.version, 1);
  assert.deepEqual(normalized?.enabled, ["core.signal.legacy_dummy"]);
  assert.deepEqual(normalized?.disabled, ["core.execution.futures_engine_legacy"]);
});

test("attachPluginPolicySnapshot keeps plugin lists and updates policy", () => {
  const out = attachPluginPolicySnapshot({
    plugins: {
      version: 1,
      enabled: ["core.signal.legacy_dummy"]
    },
    other: "value"
  }, {
    plan: "free",
    allowedPluginIds: ["core.signal.legacy_dummy"],
    evaluatedAt: new Date().toISOString()
  });

  assert.equal(out.other, "value");
  assert.deepEqual((out.plugins as any).enabled, ["core.signal.legacy_dummy"]);
  assert.equal(typeof (out.plugins as any).policySnapshot.evaluatedAt, "string");
  assert.equal((out.plugins as any).policySnapshot.capabilitySnapshot?.version, 1);
});
