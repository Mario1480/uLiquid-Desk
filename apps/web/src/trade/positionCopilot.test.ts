import assert from "node:assert/strict";
import test from "node:test";
import {
  isReadOnlyPositionCopilotNavigation,
  POSITION_COPILOT_ALLOWED_CLIENT_REQUESTS,
  POSITION_COPILOT_MANUAL_REVIEW_HREF
} from "./positionCopilot.js";

test("Position Copilot CTA only navigates to the read-only Agent Chat", () => {
  assert.equal(POSITION_COPILOT_MANUAL_REVIEW_HREF, "/agent-chat");
  assert.equal(isReadOnlyPositionCopilotNavigation(POSITION_COPILOT_MANUAL_REVIEW_HREF), true);
  assert.equal(isReadOnlyPositionCopilotNavigation("/api/orders"), false);
  assert.equal(isReadOnlyPositionCopilotNavigation("/api/positions/close"), false);
});

test("Position Copilot client surface contains no trading or copier write endpoint", () => {
  assert.deepEqual(POSITION_COPILOT_ALLOWED_CLIENT_REQUESTS, [
    "GET /api/position-copilot/settings",
    "PUT /api/position-copilot/settings",
    "POST /api/position-copilot/analyze"
  ]);
  assert.equal(POSITION_COPILOT_ALLOWED_CLIENT_REQUESTS.some((path) => /order|close|leverage|copier/i.test(path)), false);
});
