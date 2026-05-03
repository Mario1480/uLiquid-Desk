import assert from "node:assert/strict";
import test from "node:test";
import {
  getConfiguredSuperadminEmails,
  getPrimarySuperadminEmail,
  isSuperadminEmail
} from "./superadmin.js";

test("superadmin helper parses comma-separated ADMIN_EMAIL as the canonical source", () => {
  const env = {
    ADMIN_EMAIL: " First.Admin@example.com, second.admin@example.com , first.admin@example.com ",
    SUPERADMIN_EMAIL: "legacy@example.com"
  };

  assert.deepEqual(getConfiguredSuperadminEmails(env), [
    "first.admin@example.com",
    "second.admin@example.com"
  ]);
  assert.equal(getPrimarySuperadminEmail(env), "first.admin@example.com");
  assert.equal(isSuperadminEmail("SECOND.ADMIN@example.com", env), true);
  assert.equal(isSuperadminEmail("legacy@example.com", env), false);
});

test("superadmin helper falls back to SUPERADMIN_EMAIL and default address", () => {
  assert.deepEqual(getConfiguredSuperadminEmails({
    SUPERADMIN_EMAIL: " legacy@example.com "
  }), ["legacy@example.com"]);
  assert.equal(isSuperadminEmail("legacy@example.com", {
    SUPERADMIN_EMAIL: " legacy@example.com "
  }), true);
  assert.deepEqual(getConfiguredSuperadminEmails({}), ["admin@uliquid.vip"]);
});
