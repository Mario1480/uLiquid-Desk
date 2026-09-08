-- Distinguish the owner of a workspace from delegated workspace admins.
-- Platform superadmin and backend-admin access remain separate global settings.
INSERT INTO "Role" ("id", "workspaceId", "name", "isSystem", "permissions", "createdAt")
SELECT
  'role_owner_' || md5(w."id"),
  w."id",
  'Owner',
  true,
  COALESCE(
    admin_role."permissions",
    '{"bots.view":true,"bots.create":true,"bots.edit_config":true,"bots.start_pause_stop":true,"bots.delete":true,"trading.manual_limit":true,"trading.manual_market":true,"trading.price_support":true,"exchange_keys.view_present":true,"exchange_keys.edit":true,"risk.edit":true,"presets.view":true,"presets.create":true,"presets.apply":true,"presets.delete":true,"users.manage_members":true,"users.manage_roles":true,"settings.security":true,"audit.view":true}'::jsonb
  ),
  NOW()
FROM "Workspace" w
LEFT JOIN "Role" admin_role
  ON admin_role."workspaceId" = w."id"
 AND admin_role."name" = 'Admin'
ON CONFLICT ("workspaceId", "name") DO NOTHING;

WITH ranked_members AS (
  SELECT
    wm."id",
    wm."workspaceId",
    wm."roleId",
    ROW_NUMBER() OVER (
      PARTITION BY wm."workspaceId"
      ORDER BY wm."createdAt" ASC, wm."id" ASC
    ) AS member_rank
  FROM "WorkspaceMember" wm
),
owner_roles AS (
  SELECT "id", "workspaceId"
  FROM "Role"
  WHERE "name" = 'Owner'
),
admin_roles AS (
  SELECT "id", "workspaceId"
  FROM "Role"
  WHERE "name" = 'Admin'
)
UPDATE "WorkspaceMember" wm
SET "roleId" = owner_roles."id"
FROM ranked_members
JOIN owner_roles
  ON owner_roles."workspaceId" = ranked_members."workspaceId"
JOIN admin_roles
  ON admin_roles."workspaceId" = ranked_members."workspaceId"
 AND admin_roles."id" = ranked_members."roleId"
WHERE wm."id" = ranked_members."id"
  AND ranked_members.member_rank = 1;
