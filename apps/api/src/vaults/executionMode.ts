export type VaultExecutionMode = "offchain_shadow" | "onchain_simulated" | "onchain_live";

export const GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY = "admin.vaultExecutionMode.v1";

const MODES: VaultExecutionMode[] = ["offchain_shadow", "onchain_simulated", "onchain_live"];

function normalizeMode(value: unknown): VaultExecutionMode | null {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "offchain_shadow") return "offchain_shadow";
  if (mode === "onchain_simulated") return "onchain_simulated";
  if (mode === "onchain_live") return "onchain_live";
  return null;
}

export function resolveDefaultVaultExecutionMode(envValue: unknown = process.env.VAULT_EXECUTION_MODE): VaultExecutionMode {
  return normalizeMode(envValue) ?? "offchain_shadow";
}

export function isOnchainMode(mode: VaultExecutionMode): boolean {
  return mode === "onchain_simulated" || mode === "onchain_live";
}

export type VaultExecutionModePayload = {
  mode: VaultExecutionMode;
  source: "db" | "env";
  updatedAt: string | null;
  defaults: { mode: VaultExecutionMode };
  availableModes: VaultExecutionMode[];
};

function parseStoredMode(value: unknown): VaultExecutionMode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return normalizeMode((value as Record<string, unknown>).mode);
}

export async function getVaultExecutionModeSettings(db: any): Promise<VaultExecutionModePayload> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY },
    select: { value: true, updatedAt: true }
  });

  const storedMode = parseStoredMode(row?.value);
  const defaultMode = resolveDefaultVaultExecutionMode();
  const mode = storedMode ?? defaultMode;

  return {
    mode,
    source: storedMode ? "db" : "env",
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    defaults: { mode: defaultMode },
    availableModes: [...MODES]
  };
}

export async function setVaultExecutionModeSettings(db: any, mode: VaultExecutionMode): Promise<VaultExecutionModePayload> {
  const normalized = normalizeMode(mode);
  if (!normalized) throw new Error("invalid_vault_execution_mode");

  const updated = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY },
    create: {
      key: GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY,
      value: { mode: normalized }
    },
    update: {
      value: { mode: normalized }
    },
    select: { updatedAt: true }
  });

  return {
    mode: normalized,
    source: "db",
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : null,
    defaults: { mode: resolveDefaultVaultExecutionMode() },
    availableModes: [...MODES]
  };
}

export async function getEffectiveVaultExecutionMode(db: any): Promise<VaultExecutionMode> {
  const settings = await getVaultExecutionModeSettings(db);
  return settings.mode;
}
