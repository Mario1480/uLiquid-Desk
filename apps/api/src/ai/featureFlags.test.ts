import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiRuntimeFeatureGates } from "./featureFlags.js";

test("AI runtime feature gates reflect explicit Position Copilot rollout flags", () => {
  const previousCopilot = process.env.AI_POSITION_COPILOT_ENABLED;
  const previousMonitoring = process.env.AI_POSITION_MONITORING_ENABLED;
  process.env.AI_POSITION_COPILOT_ENABLED = "false";
  process.env.AI_POSITION_MONITORING_ENABLED = "true";

  try {
    assert.deepEqual(resolveAiRuntimeFeatureGates(), {
      ai_position_copilot: false,
      ai_position_monitoring: true
    });
  } finally {
    if (previousCopilot === undefined) delete process.env.AI_POSITION_COPILOT_ENABLED;
    else process.env.AI_POSITION_COPILOT_ENABLED = previousCopilot;
    if (previousMonitoring === undefined) delete process.env.AI_POSITION_MONITORING_ENABLED;
    else process.env.AI_POSITION_MONITORING_ENABLED = previousMonitoring;
  }
});
