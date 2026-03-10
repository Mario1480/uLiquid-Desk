import { log } from "../logger.js";
import { decryptSecretWithKey, resolveSecretKeyFromEnv } from "../secret-crypto.js";

export type AgentCredentials = {
  address: string;
  privateKey: string;
  version: number;
  secretRef?: string | null;
};

export interface AgentSecretProvider {
  readonly key: string;
  getAgentCredentials(input: {
    botVaultId: string;
    agentWalletAddress?: string | null;
    agentWalletVersion?: number | null;
    agentSecretRef?: string | null;
  }): Promise<AgentCredentials | null>;
  listAvailableAgents?(): Promise<Array<{ botVaultId: string; address: string; version: number; secretRef?: string | null }>>;
}

type EnvAgentSecretsMap = Record<string, AgentCredentials[]>;

function normalizeAddress(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isHexPrivateKey(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeVersion(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function sanitizeErrorCode(error: unknown): string {
  const raw = String(error ?? "").trim().toLowerCase();
  if (raw.includes("mismatch")) return "agent_wallet_secret_mismatch";
  if (raw.includes("decrypt")) return "agent_secret_decrypt_failed";
  if (raw.includes("format")) return "agent_secret_invalid_format";
  return "agent_secret_invalid";
}

function parseEnvAgentSecrets(raw: string): EnvAgentSecretsMap {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    log.warn({ code: "agent_secrets_json_parse_failed" }, "failed to parse HYPERLIQUID_AGENT_SECRETS_JSON");
    return {};
  }

  const toEntry = (botVaultId: string, row: unknown): [string, AgentCredentials] | null => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const address = normalizeAddress(record.address ?? record.agentWallet ?? record.walletAddress);
    const privateKey = String(record.privateKey ?? record.apiSecret ?? "").trim();
    const secretRef = String(record.secretRef ?? record.ref ?? "").trim() || null;
    const version = normalizeVersion(record.version);
    if (!botVaultId.trim() || !address || !isHexPrivateKey(privateKey)) return null;
    return [botVaultId, { address, privateKey, version, secretRef }];
  };

  if (Array.isArray(parsed)) {
    const out: EnvAgentSecretsMap = {};
    for (const row of parsed) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const botVaultId = String(record.botVaultId ?? record.id ?? "").trim();
      const entry = toEntry(botVaultId, row);
      if (!entry) continue;
      out[entry[0]] = [...(out[entry[0]] ?? []), entry[1]].sort((left, right) => right.version - left.version);
    }
    return out;
  }

  if (!parsed || typeof parsed !== "object") return {};
  const out: EnvAgentSecretsMap = {};
  for (const [botVaultId, row] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(row)) {
      out[botVaultId] = row
        .map((entry) => toEntry(botVaultId, entry)?.[1] ?? null)
        .filter((entry): entry is AgentCredentials => Boolean(entry))
        .sort((left, right) => right.version - left.version);
      continue;
    }
    const entry = toEntry(botVaultId, row);
    if (!entry) continue;
    out[botVaultId] = [entry[1]];
  }
  return out;
}

export function createEnvAgentSecretProvider(envRaw = process.env.HYPERLIQUID_AGENT_SECRETS_JSON ?? ""): AgentSecretProvider {
  const secrets = parseEnvAgentSecrets(String(envRaw));
  return {
    key: "env",
    async getAgentCredentials(input) {
      const versions = secrets[input.botVaultId] ?? [];
      const requestedVersion = normalizeVersion(input.agentWalletVersion);
      const match = versions.find((row) => row.version === requestedVersion) ?? versions[0] ?? null;
      if (!match) return null;
      const expectedAddress = normalizeAddress(input.agentWalletAddress);
      if (expectedAddress && expectedAddress !== match.address) {
        throw new Error("agent_wallet_secret_mismatch");
      }
      const expectedRef = String(input.agentSecretRef ?? "").trim();
      if (expectedRef && expectedRef !== String(match.secretRef ?? "")) {
        throw new Error("agent_wallet_secret_mismatch");
      }
      return match;
    },
    async listAvailableAgents() {
      return Object.entries(secrets).flatMap(([botVaultId, versions]) =>
        versions.map((row) => ({
          botVaultId,
          address: row.address,
          version: row.version,
          secretRef: row.secretRef ?? null
        }))
      );
    }
  };
}

type EncryptedAgentSecretRow = {
  version: number;
  address: string;
  encryptedPrivateKey: string;
  secretRef?: string | null;
};

function parseEncryptedEnvAgentSecrets(raw: string): Record<string, EncryptedAgentSecretRow[]> {
  if (!String(raw).trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    log.warn({ code: "agent_secrets_encrypted_json_parse_failed" }, "failed to parse HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON");
    return {};
  }

  const toRow = (row: unknown): EncryptedAgentSecretRow | null => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const address = normalizeAddress(record.address ?? record.agentWallet ?? record.walletAddress);
    const encryptedPrivateKey = String(record.encryptedPrivateKey ?? record.privateKeyEnc ?? "").trim();
    const version = normalizeVersion(record.version);
    const secretRef = String(record.secretRef ?? record.ref ?? "").trim() || null;
    if (!address || !encryptedPrivateKey) return null;
    return { address, encryptedPrivateKey, version, secretRef };
  };

  const out: Record<string, EncryptedAgentSecretRow[]> = {};
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const botVaultId = String(record.botVaultId ?? record.id ?? "").trim();
      if (!botVaultId) continue;
      const entry = toRow(row);
      if (!entry) continue;
      out[botVaultId] = [...(out[botVaultId] ?? []), entry].sort((left, right) => right.version - left.version);
    }
    return out;
  }

  if (!parsed || typeof parsed !== "object") return {};
  for (const [botVaultId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[botVaultId] = value
        .map((row) => toRow(row))
        .filter((row): row is EncryptedAgentSecretRow => Boolean(row))
        .sort((left, right) => right.version - left.version);
      continue;
    }
    const entry = toRow(value);
    if (!entry) continue;
    out[botVaultId] = [entry];
  }
  return out;
}

export function createEncryptedEnvAgentSecretProvider(envRaw = process.env.HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON ?? ""): AgentSecretProvider {
  const secrets = parseEncryptedEnvAgentSecrets(String(envRaw));
  const key = resolveSecretKeyFromEnv("AGENT_SECRET_ENCRYPTION_KEY", "SECRET_MASTER_KEY");
  return {
    key: "encrypted_env",
    async getAgentCredentials(input) {
      const versions = secrets[input.botVaultId] ?? [];
      const requestedVersion = normalizeVersion(input.agentWalletVersion);
      const match = versions.find((row) => row.version === requestedVersion) ?? versions[0] ?? null;
      if (!match) return null;
      const expectedAddress = normalizeAddress(input.agentWalletAddress);
      if (expectedAddress && expectedAddress !== match.address) {
        throw new Error("agent_wallet_secret_mismatch");
      }
      const expectedRef = String(input.agentSecretRef ?? "").trim();
      if (expectedRef && expectedRef !== String(match.secretRef ?? "")) {
        throw new Error("agent_wallet_secret_mismatch");
      }
      try {
        const privateKey = decryptSecretWithKey(match.encryptedPrivateKey, key).trim();
        if (!isHexPrivateKey(privateKey)) throw new Error("agent_secret_invalid_format");
        return {
          address: match.address,
          privateKey,
          version: match.version,
          secretRef: match.secretRef ?? null
        };
      } catch (error) {
        throw new Error(sanitizeErrorCode(error));
      }
    },
    async listAvailableAgents() {
      return Object.entries(secrets).flatMap(([botVaultId, versions]) =>
        versions.map((row) => ({
          botVaultId,
          address: row.address,
          version: row.version,
          secretRef: row.secretRef ?? null
        }))
      );
    }
  };
}

export function createAgentSecretProvider(): AgentSecretProvider {
  const providerKey = String(process.env.RUNNER_AGENT_SECRET_PROVIDER ?? "encrypted_env").trim().toLowerCase();
  if (providerKey === "encrypted_env") {
    return createEncryptedEnvAgentSecretProvider();
  }
  if (providerKey === "env") {
    return createEnvAgentSecretProvider();
  }
  log.warn({ providerKey }, "unknown RUNNER_AGENT_SECRET_PROVIDER, falling back to encrypted_env");
  return createEncryptedEnvAgentSecretProvider();
}
