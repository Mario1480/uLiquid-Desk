import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRID_HYPERLIQUID_PILOT_SETTINGS,
  getGridHyperliquidPilotSettings,
  resolveGridHyperliquidPilotAccess,
  setGridHyperliquidPilotSettings
} from "./gridHyperliquidPilot.settings.js";

function createDb(initialValue: unknown = null, adminUserIds: string[] = [], memberships: Array<{ userId: string; workspaceId: string }> = []) {
  let value = initialValue;
  let updatedAt: Date | null = null;
  return {
    globalSetting: {
      async findUnique(args: any) {
        if (args?.where?.key === "admin.backendAccess") {
          return { value: { userIds: adminUserIds } };
        }
        if (args?.where?.key !== "admin.gridHyperliquidPilot.v1" || value == null) return null;
        return { value, updatedAt };
      },
      async upsert(args: any) {
        value = args.update.value;
        updatedAt = new Date("2026-03-09T12:00:00.000Z");
        return { updatedAt };
      }
    },
    workspaceMember: {
      async findFirst(args: any) {
        const userId = String(args?.where?.userId ?? "");
        const allowedWorkspaceIds = Array.isArray(args?.where?.workspaceId?.in) ? args.where.workspaceId.in.map(String) : [];
        return memberships.find((row) => row.userId === userId && allowedWorkspaceIds.includes(row.workspaceId)) ?? null;
      }
    }
  } as any;
}

test("grid hyperliquid pilot defaults to disabled", async () => {
  const db = createDb();
  const settings = await getGridHyperliquidPilotSettings(db);
  assert.deepEqual(settings, DEFAULT_GRID_HYPERLIQUID_PILOT_SETTINGS);

  const access = await resolveGridHyperliquidPilotAccess(db, { userId: "user_1", email: "user@example.com" });
  assert.deepEqual(access, { allowed: false, reason: "disabled", scope: "none" });
});

test("grid hyperliquid pilot persists allowlists", async () => {
  const db = createDb();
  const saved = await setGridHyperliquidPilotSettings(db, {
    enabled: true,
    allowedUserIds: ["user_1", "user_1", " user_2 "],
    allowedWorkspaceIds: ["ws_1", " ws_1 ", "ws_2"]
  });

  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.allowedUserIds, ["user_1", "user_2"]);
  assert.deepEqual(saved.allowedWorkspaceIds, ["ws_1", "ws_2"]);

  const loaded = await getGridHyperliquidPilotSettings(db);
  assert.deepEqual(loaded.allowedUserIds, ["user_1", "user_2"]);
  assert.deepEqual(loaded.allowedWorkspaceIds, ["ws_1", "ws_2"]);
});

test("grid hyperliquid pilot always allows admin backend users", async () => {
  const db = createDb(null, ["admin_user"]);
  const access = await resolveGridHyperliquidPilotAccess(db, { userId: "admin_user", email: "admin@example.com" });
  assert.deepEqual(access, { allowed: true, reason: "admin", scope: "global" });
});

test("grid hyperliquid pilot allows allowlisted user and workspace", async () => {
  const db = createDb(
    {
      enabled: true,
      allowedUserIds: ["pilot_user"],
      allowedWorkspaceIds: ["ws_pilot"]
    },
    [],
    [{ userId: "workspace_user", workspaceId: "ws_pilot" }]
  );

  const directUser = await resolveGridHyperliquidPilotAccess(db, { userId: "pilot_user", email: "pilot@example.com" });
  assert.deepEqual(directUser, { allowed: true, reason: "allowlist", scope: "user" });

  const workspaceUser = await resolveGridHyperliquidPilotAccess(db, { userId: "workspace_user", email: "workspace@example.com" });
  assert.deepEqual(workspaceUser, { allowed: true, reason: "allowlist", scope: "workspace" });
});

test("grid hyperliquid pilot denies non-listed users when enabled", async () => {
  const db = createDb({ enabled: true, allowedUserIds: [], allowedWorkspaceIds: [] });
  const access = await resolveGridHyperliquidPilotAccess(db, { userId: "user_9", email: "user9@example.com" });
  assert.deepEqual(access, { allowed: false, reason: "not_listed", scope: "none" });
});
