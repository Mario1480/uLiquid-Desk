import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ULIQ_LOCK_TERMS } from "./presale.service.js";

const migration = readFileSync(
  new URL(
    "../../../../prisma/migrations/20260827143000_uliq_lock_duration_constraint_v1/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("ADR-008 migration replaces and validates the lock-duration constraint", () => {
  assert.match(
    migration,
    /DROP CONSTRAINT IF EXISTS "uliq_lock_positions_duration_allowed"/
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "uliq_lock_positions_duration_allowed"[^;]+NOT VALID/
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "uliq_lock_positions_duration_allowed"/
  );
});

test("ADR-008 migration admits every active lock term and preserves legacy projections", () => {
  const allowedMatch = migration.match(/"duration_days" IN [(]([0-9, ]+)[)]/);
  assert.ok(allowedMatch, "duration constraint must declare its allowed day values");

  const allowedDays = new Set(
    allowedMatch[1]
      .split(",")
      .map((value) => Number(value.trim()))
  );
  const activeDays = ULIQ_LOCK_TERMS.map((term) => term.durationDays);

  assert.deepEqual(activeDays, [31, 184, 366]);
  for (const durationDays of activeDays) {
    assert.equal(allowedDays.has(durationDays), true);
  }
  for (const legacyDurationDays of [30, 90, 180]) {
    assert.equal(allowedDays.has(legacyDurationDays), true);
  }
});
