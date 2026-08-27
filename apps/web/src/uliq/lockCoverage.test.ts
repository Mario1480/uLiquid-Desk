import assert from "node:assert/strict";
import test from "node:test";
import { formatLockDuration, lockCoverageShortfallSeconds } from "./lockCoverage.js";

test("lock coverage shortfall reports the exact missing seconds", () => {
  assert.equal(
    lockCoverageShortfallSeconds(
      "2026-09-27T13:48:27.000Z",
      "2026-09-27T14:50:33.000Z"
    ),
    3_726
  );
  assert.equal(
    lockCoverageShortfallSeconds(
      "2026-09-28T13:48:27.000Z",
      "2026-09-27T14:50:33.000Z"
    ),
    0
  );
});

test("lock durations use compact non-rounded units", () => {
  const english = formatLockDuration(30 * 86_400 + 22 * 3_600 + 57 * 60, "en");
  const german = formatLockDuration(3_726, "de");

  assert.match(english, /30/);
  assert.match(english, /22/);
  assert.doesNotMatch(english, /31/);
  assert.match(german, /1/);
  assert.match(german, /2/);
});
