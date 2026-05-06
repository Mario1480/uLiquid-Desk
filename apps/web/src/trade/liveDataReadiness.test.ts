import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveTableReadiness,
  isLiveTableFailureBlocking
} from "./liveDataReadiness";

test("blocks open-order failures until the first fresh snapshot is loaded", () => {
  const readiness = createLiveTableReadiness();

  assert.equal(isLiveTableFailureBlocking("openOrders", readiness), true);
});

test("keeps a later open-order refresh failure non-blocking when a snapshot is available", () => {
  const readiness = createLiveTableReadiness();
  readiness.openOrders = true;

  assert.equal(isLiveTableFailureBlocking("openOrders", readiness), false);
});

test("does not block trading for summary or position refresh failures", () => {
  const readiness = createLiveTableReadiness();

  assert.equal(isLiveTableFailureBlocking("summary", readiness), false);
  assert.equal(isLiveTableFailureBlocking("positions", readiness), false);
});
