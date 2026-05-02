import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ROLES, resolveDefaultRoleIds } from "./rbac.js";

test("resolveDefaultRoleIds prefers User for the default self-service role", () => {
  const ids = resolveDefaultRoleIds([
    { id: "role_user", name: "User" },
    { id: "role_admin", name: "Admin" },
    { id: "role_operator", name: "Operator 1" },
    { id: "role_viewer", name: "Viewer" }
  ]);

  assert.equal(ids.adminRoleId, "role_admin");
  assert.equal(ids.userRoleId, "role_user");
});

test("resolveDefaultRoleIds falls back to Admin when User is missing", () => {
  const ids = resolveDefaultRoleIds([
    { id: "role_admin", name: "Admin" },
    { id: "role_operator", name: "Operator 1" }
  ]);

  assert.equal(ids.adminRoleId, "role_admin");
  assert.equal(ids.userRoleId, "role_admin");
});

test("User system role is read-only by default", () => {
  const userRole = DEFAULT_ROLES.find((role) => role.name === "User");
  assert.deepEqual(userRole?.permissions, {
    "bots.view": true,
    "presets.view": true
  });
});
