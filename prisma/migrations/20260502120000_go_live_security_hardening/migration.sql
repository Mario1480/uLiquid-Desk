ALTER TABLE "ReauthOtp"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

WITH first_user_members AS (
  SELECT DISTINCT ON (wm."workspaceId")
    wm."id",
    wm."workspaceId"
  FROM "WorkspaceMember" wm
  JOIN "Role" user_role
    ON user_role."id" = wm."roleId"
   AND user_role."name" = 'User'
  ORDER BY wm."workspaceId", wm."createdAt" ASC, wm."id" ASC
),
admin_roles AS (
  SELECT "id", "workspaceId"
  FROM "Role"
  WHERE "name" = 'Admin'
)
UPDATE "WorkspaceMember" wm
SET "roleId" = admin_roles."id"
FROM first_user_members
JOIN admin_roles
  ON admin_roles."workspaceId" = first_user_members."workspaceId"
WHERE wm."id" = first_user_members."id";

UPDATE "Role"
SET "permissions" = '{"bots.view":true,"presets.view":true}'::jsonb
WHERE "name" = 'User';
