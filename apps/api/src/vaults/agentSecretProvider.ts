import { decryptSecretWithKey, resolveSecretKeyFromEnv } from "../secret-crypto.js";

export type AgentCredentials = {
  address: string;
  privateKey: string;
  version: number;
  secretRef?: string | null;
};

export interface AgentSecretProvider {
  getAgentCredentials(input: {
    userId?: string | null;
    masterVaultId?: string | null;
    botVaultId?: string | null;
    agentWalletAddress?: string | null;
    agentWalletVersion?: number | null;
    agentSecretRef?: string | null;
  }): Promise<AgentCredentials | null>;
}

type EnvAgentSecretsMap = Record<string, AgentCredentials[]>;

type EncryptedAgentSecretRow = {
  version: number;
  address: string;
  encryptedPrivateKey: string;
  secretRef?: string | null;
};

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

function candidateIds(input: {
  userId?: string | null;
  masterVaultId?: string | null;
  botVaultId?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [input.userId, input.masterVaultId, input.botVaultId]) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseEnvAgentSecrets(raw: string): EnvAgentSecretsMap {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const toEntry = (id: string, row: unknown): [string, AgentCredentials] | null => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const address = normalizeAddress(record.address ?? record.agentWallet ?? record.walletAddress);
    const privateKey = String(record.privateKey ?? record.apiSecret ?? "").trim();
    const secretRef = String(record.secretRef ?? record.ref ?? "").trim() || null;
    const version = normalizeVersion(record.version);
    if (!id.trim() || !address || !isHexPrivateKey(privateKey)) return null;
    return [id, { address, privateKey, version, secretRef }];
  };

  const out: EnvAgentSecretsMap = {};
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const id = String(record.userId ?? record.masterVaultId ?? record.botVaultId ?? record.id ?? "").trim();
      const entry = toEntry(id, row);
      if (!entry) continue;
      out[entry[0]] = [...(out[entry[0]] ?? []), entry[1]].sort((left, right) => right.version - left.version);
    }
    return out;
  }

  if (!parsed || typeof parsed !== "object") return {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[id] = value
        .map((entry) => toEntry(id, entry)?.[1] ?? null)
        .filter((entry): entry is AgentCredentials => Boolean(entry))
        .sort((left, right) => right.version - left.version);
      continue;
    }
    const entry = toEntry(id, value);
    if (!entry) continue;
    out[id] = [entry[1]];
  }
  return out;
}

function parseEncryptedEnvAgentSecrets(raw: string): Record<string, EncryptedAgentSecretRow[]> {
  if (!String(raw).trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
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
      const id = String(record.userId ?? record.masterVaultId ?? record.botVaultId ?? record.id ?? "").trim();
      if (!id) continue;
      const entry = toRow(row);
      if (!entry) continue;
      out[id] = [...(out[id] ?? []), entry].sort((left, right) => right.version - left.version);
    }
    return out;
  }

  if (!parsed || typeof parsed !== "object") return {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[id] = value
        .map((entry) => toRow(entry))
        .filter((entry): entry is EncryptedAgentSecretRow => Boolean(entry))
        .sort((left, right) => right.version - left.version);
      continue;
    }
    const entry = toRow(value);
    if (!entry) continue;
    out[id] = [entry];
  }
  return out;
}

function resolveMatch<T extends { version: number; address: string; secretRef?: string | null }>(
  rows: T[],
  input: {
    agentWalletAddress?: string | null;
    agentWalletVersion?: number | null;
    agentSecretRef?: string | null;
  }
): T | null {
  const requestedVersion = normalizeVersion(input.agentWalletVersion);
  const match = rows.find((row) => row.version === requestedVersion) ?? rows[0] ?? null;
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
}

export function createApiAgentSecretProvider(): AgentSecretProvider {
  const providerKey = String(process.env.API_AGENT_SECRET_PROVIDER ?? process.env.RUNNER_AGENT_SECRET_PROVIDER ?? "encrypted_env")
    .trim()
    .toLowerCase();

  if (providerKey === "env") {
    const secrets = parseEnvAgentSecrets(String(process.env.HYPERLIQUID_AGENT_SECRETS_JSON ?? ""));
    return {
      async getAgentCredentials(input) {
        for (const id of candidateIds(input)) {
          const rows = secrets[id] ?? [];
          const match = resolveMatch(rows, input);
          if (match) return match;
        }
        return null;
      }
    };
  }

  const secrets = parseEncryptedEnvAgentSecrets(String(process.env.HYPERLIQUID_AGENT_SECRETS_ENCRYPTED_JSON ?? ""));
  const key = resolveSecretKeyFromEnv("AGENT_SECRET_ENCRYPTION_KEY", "SECRET_MASTER_KEY");
  return {
    async getAgentCredentials(input) {
      for (const id of candidateIds(input)) {
        const rows = secrets[id] ?? [];
        const match = resolveMatch(rows, input);
        if (!match) continue;
        const privateKey = decryptSecretWithKey(match.encryptedPrivateKey, key).trim();
        if (!isHexPrivateKey(privateKey)) {
          throw new Error("agent_secret_invalid_format");
        }
        return {
          address: match.address,
          privateKey,
          version: match.version,
          secretRef: match.secretRef ?? null
        };
      }
      return null;
    }
  };
}
