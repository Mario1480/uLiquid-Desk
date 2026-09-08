import assert from "node:assert/strict";
import test from "node:test";
import { buildPermissions, DEFAULT_ROLES, PERMISSION_KEYS, resolveDefaultRoleIds } from "./rbac.js";

test("resolveDefaultRoleIds keeps workspace owner, admin, and user roles distinct", () => {
  const ids = resolveDefaultRoleIds([
    { id: "role_owner", name: "Owner" },
    { id: "role_user", name: "User" },
    { id: "role_admin", name: "Admin" },
    { id: "role_operator", name: "Operator 1" },
    { id: "role_viewer", name: "Viewer" }
  ]);

  assert.equal(ids.ownerRoleId, "role_owner");
  assert.equal(ids.adminRoleId, "role_admin");
  assert.equal(ids.userRoleId, "role_user");
});

test("resolveDefaultRoleIds falls back to Admin when User is missing", () => {
  const ids = resolveDefaultRoleIds([
    { id: "role_admin", name: "Admin" },
    { id: "role_operator", name: "Operator 1" }
  ]);

  assert.equal(ids.adminRoleId, "role_admin");
  assert.equal(ids.ownerRoleId, "role_admin");
  assert.equal(ids.userRoleId, "role_admin");
});

test("Owner system role has full workspace permissions", () => {
  const ownerRole = DEFAULT_ROLES.find((role) => role.name === "Owner");
  assert.deepEqual(ownerRole?.permissions, buildPermissions(PERMISSION_KEYS));
});

test("User system role can view and create self-service presets", () => {
  const userRole = DEFAULT_ROLES.find((role) => role.name === "User");
  assert.deepEqual(userRole?.permissions, {
    "bots.view": true,
    "presets.view": true,
    "presets.create": true
  });
});
