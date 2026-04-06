import assert from "node:assert/strict";
import test from "node:test";
import { isGridInstanceExecutionEligible } from "./db.js";

test("isGridInstanceExecutionEligible only allows live running grid instances", () => {
  assert.equal(isGridInstanceExecutionEligible(null), true);
  assert.equal(isGridInstanceExecutionEligible(undefined), true);
  assert.equal(isGridInstanceExecutionEligible({ state: "running", archivedAt: null }), true);
  assert.equal(isGridInstanceExecutionEligible({ state: "RUNNING", archivedAt: null }), true);
  assert.equal(isGridInstanceExecutionEligible({ state: "stopped", archivedAt: null }), false);
  assert.equal(isGridInstanceExecutionEligible({ state: "archived", archivedAt: null }), false);
  assert.equal(isGridInstanceExecutionEligible({ state: "running", archivedAt: new Date() }), false);
  assert.equal(isGridInstanceExecutionEligible({ state: "running", archivedAt: "2026-04-06T00:00:00.000Z" }), false);
});
