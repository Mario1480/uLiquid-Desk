import type { ExecutionProviderKey } from "./executionProvider.types.js";

export const GLOBAL_SETTING_VAULT_EXECUTION_PROVIDER_KEY = "admin.vaultExecutionProvider.v1";

const AVAILABLE_PROVIDER_KEYS = ["mock", "hyperliquid_demo", "hyperliquid"] as const satisfies readonly ExecutionProviderKey[];

export type VaultExecutionProviderPayload = {
  provider: ExecutionProviderKey;
  source: "db" | "env";
  updatedAt: string | null;
  defaults: { provider: ExecutionProviderKey };
  availableProviders: ExecutionProviderKey[];
};

function normalizeProviderKey(value: unknown): ExecutionProviderKey | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "mock") return "mock";
  if (normalized === "hyperliquid_demo") return "hyperliquid_demo";
  if (normalized === "hyperliquid") return "hyperliquid";
  return null;
}

function parseStoredProvider(value: unknown): ExecutionProviderKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return normalizeProviderKey((value as Record<string, unknown>).provider);
}

export function resolveDefaultExecutionProvider(
  envValue: unknown = process.env.VAULT_EXECUTION_PROVIDER
): ExecutionProviderKey {
  const normalized = normalizeProviderKey(envValue);
  if (normalized === "hyperliquid_demo" || normalized === "hyperliquid") return normalized;
  return "mock";
}

export async function getVaultExecutionProviderSettings(db: any): Promise<VaultExecutionProviderPayload> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_VAULT_EXECUTION_PROVIDER_KEY },
    select: { value: true, updatedAt: true }
  });

  const storedProvider = parseStoredProvider(row?.value);
  const defaultProvider = resolveDefaultExecutionProvider();
  const provider =
    storedProvider === "hyperliquid_demo" || storedProvider === "hyperliquid"
      ? storedProvider
      : defaultProvider;

  return {
    provider,
    source: storedProvider ? "db" : "env",
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    defaults: { provider: defaultProvider },
    availableProviders: [...AVAILABLE_PROVIDER_KEYS]
  };
}

export async function setVaultExecutionProviderSettings(
  db: any,
  provider: ExecutionProviderKey
): Promise<VaultExecutionProviderPayload> {
  const normalized = normalizeProviderKey(provider);
  if (normalized !== "mock" && normalized !== "hyperliquid_demo" && normalized !== "hyperliquid") {
    throw new Error("invalid_vault_execution_provider");
  }

  const updated = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_VAULT_EXECUTION_PROVIDER_KEY },
    create: {
      key: GLOBAL_SETTING_VAULT_EXECUTION_PROVIDER_KEY,
      value: { provider: normalized }
    },
    update: {
      value: { provider: normalized }
    },
    select: { updatedAt: true }
  });

  return {
    provider: normalized,
    source: "db",
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : null,
    defaults: { provider: resolveDefaultExecutionProvider() },
    availableProviders: [...AVAILABLE_PROVIDER_KEYS]
  };
}

export async function getEffectiveVaultExecutionProvider(db: any): Promise<ExecutionProviderKey> {
  const settings = await getVaultExecutionProviderSettings(db);
  return settings.provider;
}
