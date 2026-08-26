import assert from "node:assert/strict";
import test from "node:test";
import { listPluginCatalogForPlan } from "./catalog.js";
import { buildPluginPolicySnapshot } from "./policy.js";

test("Free plugin catalog enables the complete Grid and Prediction Copier runtime chain", () => {
  const items = new Map(listPluginCatalogForPlan("free").map((item) => [item.id, item]));
  for (const pluginId of [
    "core.signal.prediction_copier",
    "core.execution.grid",
    "core.execution.futures_grid",
    "core.execution.prediction_copier",
    "core.signal_source.prediction_state"
  ]) {
    assert.equal(items.get(pluginId)?.minPlan, "free", pluginId);
    assert.equal(items.get(pluginId)?.allowed, true, pluginId);
  }
  assert.equal(items.get("core.execution.dca")?.allowed, false);
  assert.equal(items.get("core.execution.dca")?.blockedReason, "capability_denied");
});

test("Free bot policy snapshots carry the Grid and Prediction Copier capabilities into the runner", () => {
  const snapshot = buildPluginPolicySnapshot("free");

  assert.equal(snapshot.plan, "free");
  assert.equal(snapshot.capabilitySnapshot?.values["product.grid_bots"], true);
  assert.equal(snapshot.capabilitySnapshot?.values["execution.mode.grid"], true);
  assert.equal(snapshot.capabilitySnapshot?.values["strategy.kind.futures_grid"], true);
  assert.equal(snapshot.capabilitySnapshot?.values["strategy.kind.prediction_copier"], true);
  assert.equal(snapshot.allowedPluginIds?.includes("core.execution.grid"), true);
  assert.equal(snapshot.allowedPluginIds?.includes("core.execution.futures_grid"), true);
  assert.equal(snapshot.allowedPluginIds?.includes("core.execution.prediction_copier"), true);
  assert.equal(snapshot.allowedPluginIds?.includes("core.signal.prediction_copier"), true);
  assert.equal(snapshot.allowedPluginIds?.includes("core.signal_source.prediction_state"), true);
});
