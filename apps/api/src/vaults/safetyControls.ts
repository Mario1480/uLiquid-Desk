export const GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY = "admin.vaultSafetyControls.v1";

export type VaultSafetyControls = {
  haltNewOrders: boolean;
  depositsDisabled: boolean;
  withdrawsDisabled: boolean;
  gridStartsDisabled: boolean;
  profitClaimsDisabled: boolean;
  closeOnlyAllUserIds: string[];
  updatedByUserId: string | null;
  updatedAt: string | null;
  reason: string | null;
};

function envFlag(name: string): boolean {
  const normalized = String(process.env[name] ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function parseVaultSafetyControls(value: unknown): VaultSafetyControls {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const userIds = Array.isArray(record.closeOnlyAllUserIds)
    ? Array.from(new Set(record.closeOnlyAllUserIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)))
    : [];
  const globalDisabled = envFlag("TRADING_GLOBAL_DISABLED") || envFlag("BOTVAULT_GLOBAL_DISABLED");
  return {
    haltNewOrders: record.haltNewOrders === true || globalDisabled,
    depositsDisabled: record.depositsDisabled === true || envFlag("BOTVAULT_DEPOSITS_DISABLED") || globalDisabled,
    withdrawsDisabled: record.withdrawsDisabled === true || envFlag("BOTVAULT_WITHDRAWS_DISABLED") || globalDisabled,
    gridStartsDisabled: record.gridStartsDisabled === true || envFlag("GRIDBOT_STARTS_DISABLED") || globalDisabled,
    profitClaimsDisabled: record.profitClaimsDisabled === true || envFlag("BOTVAULT_PROFIT_CLAIMS_DISABLED") || globalDisabled,
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
  depositsDisabled?: boolean;
  withdrawsDisabled?: boolean;
  gridStartsDisabled?: boolean;
  profitClaimsDisabled?: boolean;
  closeOnlyAllUserIds?: string[];
  updatedByUserId?: string | null;
  reason?: string | null;
}): VaultSafetyControls {
  return {
    haltNewOrders: input.haltNewOrders === true,
    depositsDisabled: input.depositsDisabled === true,
    withdrawsDisabled: input.withdrawsDisabled === true,
    gridStartsDisabled: input.gridStartsDisabled === true,
    profitClaimsDisabled: input.profitClaimsDisabled === true,
    closeOnlyAllUserIds: Array.from(new Set((input.closeOnlyAllUserIds ?? []).map((entry) => String(entry ?? "").trim()).filter(Boolean))),
    updatedByUserId: input.updatedByUserId?.trim() || null,
    updatedAt: new Date().toISOString(),
    reason: input.reason?.trim() || null
  };
}
