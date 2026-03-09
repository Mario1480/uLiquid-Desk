export const GLOBAL_SETTING_GRID_HYPERLIQUID_PILOT_KEY = "admin.gridHyperliquidPilot.v1";
const GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY = "admin.backendAccess";

export type GridHyperliquidPilotSettings = {
  enabled: boolean;
  allowedUserIds: string[];
  allowedWorkspaceIds: string[];
  updatedAt?: string | null;
};

export type GridHyperliquidPilotAccess = {
  allowed: boolean;
  reason: "admin" | "allowlist" | "disabled" | "not_listed";
  scope: "global" | "user" | "workspace" | "none";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

function parseAdminBackendAccessSetting(value: unknown): { userIds: string[] } {
  const record = asRecord(value);
  return {
    userIds: normalizeStringList(record.userIds)
  };
}

export function parseStoredGridHyperliquidPilotSettings(value: unknown): GridHyperliquidPilotSettings {
  const record = asRecord(value);
  return {
    enabled: Boolean(record.enabled),
    allowedUserIds: normalizeStringList(record.allowedUserIds),
    allowedWorkspaceIds: normalizeStringList(record.allowedWorkspaceIds),
    updatedAt: null
  };
}

export const DEFAULT_GRID_HYPERLIQUID_PILOT_SETTINGS: GridHyperliquidPilotSettings = {
  enabled: false,
  allowedUserIds: [],
  allowedWorkspaceIds: [],
  updatedAt: null
};

export async function getGridHyperliquidPilotSettings(db: any): Promise<GridHyperliquidPilotSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_GRID_HYPERLIQUID_PILOT_KEY },
    select: { value: true, updatedAt: true }
  });
  const parsed = parseStoredGridHyperliquidPilotSettings(row?.value);
  return {
    ...DEFAULT_GRID_HYPERLIQUID_PILOT_SETTINGS,
    ...parsed,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

export async function setGridHyperliquidPilotSettings(
  db: any,
  input: Partial<Pick<GridHyperliquidPilotSettings, "enabled" | "allowedUserIds" | "allowedWorkspaceIds">>
): Promise<GridHyperliquidPilotSettings> {
  const value = {
    enabled: Boolean(input.enabled),
    allowedUserIds: normalizeStringList(input.allowedUserIds),
    allowedWorkspaceIds: normalizeStringList(input.allowedWorkspaceIds)
  };

  const row = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_GRID_HYPERLIQUID_PILOT_KEY },
    create: {
      key: GLOBAL_SETTING_GRID_HYPERLIQUID_PILOT_KEY,
      value
    },
    update: {
      value
    },
    select: { updatedAt: true }
  });

  return {
    ...value,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

async function hasAdminGridAccess(db: any, userId: string, email?: string | null): Promise<boolean> {
  const superadminEmail = String(process.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  const resolvedEmail = email ?? (
    await db?.user?.findUnique?.({
      where: { id: userId },
      select: { email: true }
    }).catch(() => null)
  )?.email ?? null;
  const normalizedEmail = String(resolvedEmail ?? "").trim().toLowerCase();
  if (superadminEmail && normalizedEmail && normalizedEmail === superadminEmail) return true;

  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY },
    select: { value: true }
  });
  const access = parseAdminBackendAccessSetting(row?.value);
  return access.userIds.includes(String(userId));
}

export async function resolveGridHyperliquidPilotAccess(
  db: any,
  params: { userId: string; email?: string | null }
): Promise<GridHyperliquidPilotAccess> {
  if (await hasAdminGridAccess(db, params.userId, params.email)) {
    return { allowed: true, reason: "admin", scope: "global" };
  }

  const settings = await getGridHyperliquidPilotSettings(db);
  if (!settings.enabled) {
    return { allowed: false, reason: "disabled", scope: "none" };
  }

  const userId = String(params.userId ?? "").trim();
  if (userId && settings.allowedUserIds.includes(userId)) {
    return { allowed: true, reason: "allowlist", scope: "user" };
  }

  if (settings.allowedWorkspaceIds.length > 0) {
    const membership = await db.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId: { in: settings.allowedWorkspaceIds }
      },
      select: { workspaceId: true }
    });
    if (membership?.workspaceId) {
      return { allowed: true, reason: "allowlist", scope: "workspace" };
    }
  }

  return { allowed: false, reason: "not_listed", scope: "none" };
}
