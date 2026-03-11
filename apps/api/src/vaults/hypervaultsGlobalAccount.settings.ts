import crypto from "node:crypto";
import { decryptSecret, encryptSecret } from "../secret-crypto.js";

export const GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY = "admin.hypervaultsExecutionAccount.v1";

type StoredHypervaultsExecutionAccount = {
  enabled: boolean;
  apiKeyEnc: string | null;
  apiSecretEnc: string | null;
  vaultAddressEnc: string | null;
};

export type HypervaultsGlobalAccountPublicState = {
  enabled: boolean;
  configured: boolean;
  valid: boolean;
  status: "missing" | "disabled" | "invalid" | "ready";
  apiKeyMasked: string | null;
  vaultAddressMasked: string | null;
  updatedAt: string | null;
  credentialSource: "global_admin";
  globalExecutionAccountId: string | null;
};

export type ResolvedHypervaultsGlobalAccount = {
  enabled: true;
  apiKey: string;
  apiSecret: string;
  vaultAddress: string | null;
  updatedAt: string | null;
  credentialSource: "global_admin";
  globalExecutionAccountId: string;
};

export type SetHypervaultsGlobalAccountInput = {
  enabled?: boolean;
  apiKey?: string | null;
  apiSecret?: string | null;
  vaultAddress?: string | null;
  clearVaultAddress?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function normalizePrivateKey(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) return null;
  return withPrefix.toLowerCase();
}

function maskAddress(value: string | null): string | null {
  const normalized = normalizeAddress(value);
  if (!normalized) return null;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function parseStoredHypervaultsExecutionAccount(value: unknown): StoredHypervaultsExecutionAccount {
  const record = asRecord(value);
  return {
    enabled: Boolean(record.enabled),
    apiKeyEnc: typeof record.apiKeyEnc === "string" && record.apiKeyEnc.trim() ? record.apiKeyEnc.trim() : null,
    apiSecretEnc: typeof record.apiSecretEnc === "string" && record.apiSecretEnc.trim() ? record.apiSecretEnc.trim() : null,
    vaultAddressEnc:
      typeof record.vaultAddressEnc === "string" && record.vaultAddressEnc.trim()
        ? record.vaultAddressEnc.trim()
        : null
  };
}

function decryptStoredAccountSecrets(
  stored: StoredHypervaultsExecutionAccount
): { apiKey: string | null; apiSecret: string | null; vaultAddress: string | null } {
  try {
    return {
      apiKey: stored.apiKeyEnc ? normalizeAddress(decryptSecret(stored.apiKeyEnc)) : null,
      apiSecret: stored.apiSecretEnc ? normalizePrivateKey(decryptSecret(stored.apiSecretEnc)) : null,
      vaultAddress: stored.vaultAddressEnc ? normalizeAddress(decryptSecret(stored.vaultAddressEnc)) : null
    };
  } catch {
    return {
      apiKey: null,
      apiSecret: null,
      vaultAddress: null
    };
  }
}

function buildGlobalExecutionAccountId(apiKey: string, vaultAddress: string | null): string {
  const seed = `${apiKey}:${vaultAddress ?? ""}`;
  return `hl_global_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function toPublicState(params: {
  stored: StoredHypervaultsExecutionAccount;
  updatedAt: Date | string | null | undefined;
}): HypervaultsGlobalAccountPublicState {
  const decrypted = decryptStoredAccountSecrets(params.stored);
  const configured = Boolean(params.stored.apiKeyEnc && params.stored.apiSecretEnc);
  const valid = Boolean(decrypted.apiKey && decrypted.apiSecret && (!params.stored.vaultAddressEnc || decrypted.vaultAddress));
  const enabled = Boolean(params.stored.enabled);
  const status: HypervaultsGlobalAccountPublicState["status"] =
    !configured
      ? "missing"
      : !enabled
        ? "disabled"
        : valid
          ? "ready"
          : "invalid";
  return {
    enabled,
    configured,
    valid,
    status,
    apiKeyMasked: maskAddress(decrypted.apiKey),
    vaultAddressMasked: maskAddress(decrypted.vaultAddress),
    updatedAt:
      params.updatedAt instanceof Date
        ? params.updatedAt.toISOString()
        : typeof params.updatedAt === "string" && params.updatedAt.trim()
          ? new Date(params.updatedAt).toISOString()
          : null,
    credentialSource: "global_admin",
    globalExecutionAccountId:
      decrypted.apiKey && valid ? buildGlobalExecutionAccountId(decrypted.apiKey, decrypted.vaultAddress) : null
  };
}

export async function getHypervaultsGlobalAccountPublicState(db: any): Promise<HypervaultsGlobalAccountPublicState> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    select: { value: true, updatedAt: true }
  });
  return toPublicState({
    stored: parseStoredHypervaultsExecutionAccount(row?.value),
    updatedAt: row?.updatedAt ?? null
  });
}

export async function resolveHypervaultsGlobalAccount(
  db: any
): Promise<ResolvedHypervaultsGlobalAccount | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredHypervaultsExecutionAccount(row?.value);
  if (!stored.enabled) return null;
  const decrypted = decryptStoredAccountSecrets(stored);
  if (!decrypted.apiKey || !decrypted.apiSecret || (stored.vaultAddressEnc && !decrypted.vaultAddress)) {
    return null;
  }
  return {
    enabled: true,
    apiKey: decrypted.apiKey,
    apiSecret: decrypted.apiSecret,
    vaultAddress: decrypted.vaultAddress,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    credentialSource: "global_admin",
    globalExecutionAccountId: buildGlobalExecutionAccountId(decrypted.apiKey, decrypted.vaultAddress)
  };
}

export async function setHypervaultsGlobalAccount(
  db: any,
  input: SetHypervaultsGlobalAccountInput
): Promise<HypervaultsGlobalAccountPublicState> {
  const currentRow = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    select: { value: true }
  });
  const current = parseStoredHypervaultsExecutionAccount(currentRow?.value);
  const normalizedApiKey = input.apiKey === undefined ? undefined : normalizeAddress(input.apiKey);
  const normalizedApiSecret = input.apiSecret === undefined ? undefined : normalizePrivateKey(input.apiSecret);
  const normalizedVaultAddress =
    input.clearVaultAddress
      ? null
      : input.vaultAddress === undefined
        ? undefined
        : input.vaultAddress === null || String(input.vaultAddress).trim() === ""
          ? null
          : normalizeAddress(input.vaultAddress);

  if (input.apiKey !== undefined && !normalizedApiKey) throw new Error("hypervaults_global_api_key_invalid");
  if (input.apiSecret !== undefined && !normalizedApiSecret) throw new Error("hypervaults_global_api_secret_invalid");
  if (input.vaultAddress !== undefined && input.vaultAddress !== null && String(input.vaultAddress).trim() !== "" && !normalizedVaultAddress) {
    throw new Error("hypervaults_global_vault_address_invalid");
  }

  const next: StoredHypervaultsExecutionAccount = {
    enabled: input.enabled ?? current.enabled,
    apiKeyEnc:
      normalizedApiKey === undefined
        ? current.apiKeyEnc
        : normalizedApiKey
          ? encryptSecret(normalizedApiKey)
          : null,
    apiSecretEnc:
      normalizedApiSecret === undefined
        ? current.apiSecretEnc
        : normalizedApiSecret
          ? encryptSecret(normalizedApiSecret)
          : null,
    vaultAddressEnc:
      normalizedVaultAddress === undefined
        ? current.vaultAddressEnc
        : normalizedVaultAddress
          ? encryptSecret(normalizedVaultAddress)
          : null
  };

  if (next.enabled && (!next.apiKeyEnc || !next.apiSecretEnc)) {
    throw new Error("hypervaults_global_account_incomplete");
  }

  const updated = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    create: {
      key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY,
      value: next
    },
    update: {
      value: next
    },
    select: {
      value: true,
      updatedAt: true
    }
  });

  return toPublicState({
    stored: parseStoredHypervaultsExecutionAccount(updated.value),
    updatedAt: updated.updatedAt
  });
}

export async function disableHypervaultsGlobalAccount(db: any): Promise<HypervaultsGlobalAccountPublicState> {
  const currentRow = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    select: { value: true }
  });
  const current = parseStoredHypervaultsExecutionAccount(currentRow?.value);
  const updated = await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY },
    create: {
      key: GLOBAL_SETTING_HYPERVAULTS_EXECUTION_ACCOUNT_KEY,
      value: {
        ...current,
        enabled: false
      }
    },
    update: {
      value: {
        ...current,
        enabled: false
      }
    },
    select: {
      value: true,
      updatedAt: true
    }
  });
  return toPublicState({
    stored: parseStoredHypervaultsExecutionAccount(updated.value),
    updatedAt: updated.updatedAt
  });
}
