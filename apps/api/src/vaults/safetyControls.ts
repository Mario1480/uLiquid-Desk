export const GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY = "admin.vaultSafetyControls.v1";

export type VaultSafetyControls = {
  haltNewOrders: boolean;
  closeOnlyAllUserIds: string[];
  updatedByUserId: string | null;
  updatedAt: string | null;
  reason: string | null;
};

export function parseVaultSafetyControls(value: unknown): VaultSafetyControls {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const userIds = Array.isArray(record.closeOnlyAllUserIds)
    ? Array.from(new Set(record.closeOnlyAllUserIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)))
    : [];
  return {
    haltNewOrders: record.haltNewOrders === true,
    closeOnlyAllUserIds: userIds,
    updatedByUserId: typeof record.updatedByUserId === "string" && record.updatedByUserId.trim()
      ? record.updatedByUserId.trim()
      : null,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : null,
    reason: typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : null
  };
}

export function buildVaultSafetyControls(input: {
  haltNewOrders?: boolean;
  closeOnlyAllUserIds?: string[];
  updatedByUserId?: string | null;
  reason?: string | null;
}): VaultSafetyControls {
  return {
    haltNewOrders: input.haltNewOrders === true,
    closeOnlyAllUserIds: Array.from(new Set((input.closeOnlyAllUserIds ?? []).map((entry) => String(entry ?? "").trim()).filter(Boolean))),
    updatedByUserId: input.updatedByUserId?.trim() || null,
    updatedAt: new Date().toISOString(),
    reason: input.reason?.trim() || null
  };
}
