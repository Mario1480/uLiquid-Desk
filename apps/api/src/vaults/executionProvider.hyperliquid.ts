import crypto from "node:crypto";
import {
  buildHyperliquidReadKey,
  executeHyperliquidRead,
  HyperliquidFuturesAdapter
} from "@mm/futures-exchange";
import { decryptSecret } from "../secret-crypto.js";
import type { ExecutionProvider, BotExecutionPosition, BotExecutionStatus } from "./executionProvider.types.js";

type CreateHyperliquidExecutionProviderParams = {
  db: any;
};

type HyperliquidLiveState = {
  status: BotExecutionStatus;
  providerMode: "live";
  chain: "hyperevm";
  marketDataExchange: "hyperliquid";
  providerVaultId?: string | null;
  providerUnitId?: string | null;
  providerAccountId?: string | null;
  vaultAddress?: string | null;
  subaccountAddress?: string | null;
  agentWallet?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastAction?: string | null;
};

type HyperliquidCredentials = {
  exchangeAccountId: string;
  apiKey: string;
  apiSecret: string;
  vaultAddress: string | null;
};

function buildHash(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function buildId(prefix: string, seed: string): string {
  return `${prefix}_${buildHash(seed).slice(0, 16)}`;
}

function normalizeAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

function normalizePrivateKey(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) return null;
  return withPrefix;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeProviderReadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? "unknown_error");
}

function readErrorCategory(error: unknown): string | null {
  if (error && typeof error === "object" && "category" in error) {
    const value = String((error as Record<string, unknown>).category ?? "").trim();
    return value || null;
  }
  return null;
}

function readProviderState(row: any): HyperliquidLiveState {
  const metadata = toRecord(row?.executionMetadata);
  const providerState = toRecord(metadata.providerState);
  const statusRaw = String(providerState.status ?? row?.executionStatus ?? "created").trim().toLowerCase();
  const status: BotExecutionStatus =
    statusRaw === "running"
      ? "running"
      : statusRaw === "paused"
        ? "paused"
        : statusRaw === "close_only"
          ? "close_only"
          : statusRaw === "closed"
            ? "closed"
            : statusRaw === "error"
              ? "error"
              : "created";
  return {
    status,
    providerMode: "live",
    chain: "hyperevm",
    marketDataExchange: "hyperliquid",
    providerVaultId: typeof providerState.providerVaultId === "string" ? providerState.providerVaultId : null,
    providerUnitId: typeof providerState.providerUnitId === "string" ? providerState.providerUnitId : null,
    providerAccountId: typeof providerState.providerAccountId === "string" ? providerState.providerAccountId : null,
    vaultAddress: typeof providerState.vaultAddress === "string" ? providerState.vaultAddress : null,
    subaccountAddress: typeof providerState.subaccountAddress === "string" ? providerState.subaccountAddress : null,
    agentWallet: typeof providerState.agentWallet === "string" ? providerState.agentWallet : row?.agentWallet ?? null,
    createdAt: typeof providerState.createdAt === "string" ? providerState.createdAt : undefined,
    updatedAt: typeof providerState.updatedAt === "string" ? providerState.updatedAt : undefined,
    lastAction: typeof providerState.lastAction === "string" ? providerState.lastAction : null
  };
}

async function patchProviderState(
  db: any,
  botVaultId: string,
  patch: Partial<HyperliquidLiveState>
): Promise<HyperliquidLiveState> {
  const current = await db.botVault.findUnique({
    where: { id: botVaultId },
    select: {
      executionMetadata: true,
      executionStatus: true,
      vaultAddress: true,
      agentWallet: true
    }
  });
  if (!current) throw new Error("bot_vault_not_found");

  const metadata = toRecord(current.executionMetadata);
  const existing = readProviderState(current);
  const now = new Date().toISOString();
  const next: HyperliquidLiveState = {
    ...existing,
    ...patch,
    updatedAt: now,
    createdAt: existing.createdAt ?? now
  };

  await db.botVault.update({
    where: { id: botVaultId },
    data: {
      executionMetadata: {
        ...metadata,
        providerState: next,
        updatedAt: now
      }
    }
  });

  return next;
}

function decodeHyperliquidSecrets(account: {
  id: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
}): HyperliquidCredentials {
  const apiKey = normalizeAddress(decryptSecret(account.apiKeyEnc));
  const apiSecret = normalizePrivateKey(decryptSecret(account.apiSecretEnc));
  const vaultAddress = account.passphraseEnc ? normalizeAddress(decryptSecret(account.passphraseEnc)) : null;
  if (!apiKey) throw new Error("hyperliquid_api_key_invalid");
  if (!apiSecret) throw new Error("hyperliquid_api_secret_invalid");
  return {
    exchangeAccountId: String(account.id),
    apiKey,
    apiSecret,
    vaultAddress
  };
}

async function findHyperliquidAccountForUser(db: any, _userId: string): Promise<HyperliquidCredentials> {
  const account = await db.exchangeAccount.findFirst({
    where: {
      userId: _userId,
      exchange: "hyperliquid"
    },
    select: {
      id: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!account) throw new Error("hyperliquid_exchange_account_missing");
  const decoded = decodeHyperliquidSecrets({
    id: String(account.id),
    apiKeyEnc: String(account.apiKeyEnc),
    apiSecretEnc: String(account.apiSecretEnc),
    passphraseEnc: account.passphraseEnc ? String(account.passphraseEnc) : null
  });
  return decoded;
}

function readStoredExecutionVaultAddress(value: unknown): string | null {
  const metadata = toRecord(value);
  const providerState = toRecord(metadata.providerState);
  return normalizeAddress(providerState.vaultAddress) ?? null;
}

async function findBotVaultContext(db: any, userId: string, botVaultId: string): Promise<{
  id: string;
  userId: string;
  gridInstanceId: string | null;
  botId: string | null;
  botVaultAddress: string | null;
  executionVaultAddress: string | null;
  masterVaultAddress: string | null;
  agentWallet: string | null;
  executionStatus: string | null;
  executionMetadata: Record<string, unknown> | null;
  exchangeAccount: HyperliquidCredentials;
}> {
  const row = await db.botVault.findFirst({
    where: {
      id: botVaultId,
      userId
    },
    select: {
      id: true,
      userId: true,
      gridInstanceId: true,
      botId: true,
      vaultAddress: true,
      agentWallet: true,
      executionStatus: true,
      executionMetadata: true,
      masterVault: {
        select: {
          onchainAddress: true
        }
      },
      gridInstance: {
        select: {
          exchangeAccount: {
            select: {
              id: true,
              exchange: true,
              apiKeyEnc: true,
              apiSecretEnc: true,
              passphraseEnc: true
            }
          }
        }
      },
      bot: {
        select: {
          exchangeAccount: {
            select: {
              id: true,
              exchange: true,
              apiKeyEnc: true,
              apiSecretEnc: true,
              passphraseEnc: true
            }
          }
        }
      }
    }
  });
  if (!row) throw new Error("bot_vault_not_found");
  const account = row.gridInstance?.exchangeAccount ?? row.bot?.exchangeAccount;
  if (!account || String(account.exchange ?? "").trim().toLowerCase() !== "hyperliquid") {
    throw new Error("hyperliquid_exchange_account_missing");
  }
  return {
    id: String(row.id),
    userId: String(row.userId),
    gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
    botId: row.botId ? String(row.botId) : null,
    botVaultAddress: normalizeAddress(row.vaultAddress) ?? null,
    executionVaultAddress: readStoredExecutionVaultAddress(row.executionMetadata),
    agentWallet: normalizeAddress(row.agentWallet) ?? null,
    executionStatus: row.executionStatus ? String(row.executionStatus) : null,
    executionMetadata: toRecord(row.executionMetadata),
    exchangeAccount: decodeHyperliquidSecrets({
      id: String(account.id),
      apiKeyEnc: String(account.apiKeyEnc),
      apiSecretEnc: String(account.apiSecretEnc),
      passphraseEnc: account.passphraseEnc ? String(account.passphraseEnc) : null
    }),
    masterVaultAddress: normalizeAddress(row.masterVault?.onchainAddress) ?? null
  };
}

function mapExecutionPositions(positions: Awaited<ReturnType<HyperliquidFuturesAdapter["getPositions"]>>): BotExecutionPosition[] {
  return positions.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    qty: Number(row.size ?? 0),
    entryPrice: row.entryPrice ?? null,
    markPrice: row.markPrice ?? null,
    unrealizedPnlUsd: row.unrealizedPnl ?? null
  }));
}

function resolveExecutionVaultAddress(context: {
  botVaultAddress: string | null;
  masterVaultAddress: string | null;
  exchangeAccount: HyperliquidCredentials;
  executionVaultAddress?: string | null;
}): string | null {
  if (context.botVaultAddress) return context.botVaultAddress;
  const explicitAccountVault = context.exchangeAccount.vaultAddress;
  if (
    explicitAccountVault
    && context.masterVaultAddress
    && explicitAccountVault.toLowerCase() === context.masterVaultAddress.toLowerCase()
  ) {
    return context.executionVaultAddress ?? null;
  }
  return explicitAccountVault ?? context.executionVaultAddress ?? null;
}

export function createHyperliquidExecutionProvider(
  params: CreateHyperliquidExecutionProviderParams
): ExecutionProvider {
  const db = params.db;

  return {
    get key(): ExecutionProvider["key"] {
      return "hyperliquid";
    },

    async createUserVault(input) {
      const account = await findHyperliquidAccountForUser(db, input.userId);
      return {
        providerVaultId: buildId(
          "hl_user_vault",
          `${input.userId}:${input.masterVaultId}:${account.exchangeAccountId}`
        ),
        vaultAddress: account.vaultAddress
      };
    },

    async createBotExecutionUnit(input) {
      const dbLike = input.tx ?? db;
      const context = await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      const executionVaultAddress = resolveExecutionVaultAddress(context);
      const providerUnitId = buildId(
        "hl_bot_unit",
        `${input.botVaultId}:${context.exchangeAccount.exchangeAccountId}`
      );
      await patchProviderState(dbLike, input.botVaultId, {
        status: "created",
        providerUnitId,
        providerAccountId: context.exchangeAccount.exchangeAccountId,
        vaultAddress: executionVaultAddress,
        subaccountAddress: null,
        agentWallet: context.exchangeAccount.apiKey,
        lastAction: "createBotExecutionUnit"
      });
      return {
        providerUnitId
      };
    },

    async assignAgent(input) {
      const dbLike = input.tx ?? db;
      const context = await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      const executionVaultAddress = resolveExecutionVaultAddress(context);
      await patchProviderState(dbLike, input.botVaultId, {
        providerAccountId: context.exchangeAccount.exchangeAccountId,
        vaultAddress: executionVaultAddress,
        agentWallet: context.exchangeAccount.apiKey,
        subaccountAddress: null,
        lastAction: "assignAgent"
      });
      return { agentWallet: context.exchangeAccount.apiKey };
    },

    async startBotExecution(input) {
      const dbLike = input.tx ?? db;
      await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      await patchProviderState(dbLike, input.botVaultId, {
        status: "running",
        lastAction: "startBotExecution"
      });
      return { ok: true };
    },

    async pauseBotExecution(input) {
      const dbLike = input.tx ?? db;
      await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      await patchProviderState(dbLike, input.botVaultId, {
        status: "paused",
        lastAction: "pauseBotExecution"
      });
      return { ok: true };
    },

    async setBotCloseOnly(input) {
      const dbLike = input.tx ?? db;
      await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      await patchProviderState(dbLike, input.botVaultId, {
        status: "close_only",
        lastAction: "setBotCloseOnly"
      });
      return { ok: true };
    },

    async closeBotExecution(input) {
      const dbLike = input.tx ?? db;
      await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      await patchProviderState(dbLike, input.botVaultId, {
        status: "closed",
        lastAction: "closeBotExecution"
      });
      return { ok: true };
    },

    async getBotExecutionState(input) {
      const dbLike = input.tx ?? db;
      const context = await findBotVaultContext(dbLike, input.userId, input.botVaultId);
      const executionVaultAddress = resolveExecutionVaultAddress(context);
      const providerState = readProviderState({
        executionMetadata: context.executionMetadata,
        executionStatus: context.executionStatus,
        vaultAddress: executionVaultAddress,
        agentWallet: context.agentWallet
      });
      const adapter = new HyperliquidFuturesAdapter({
        apiKey: context.exchangeAccount.apiKey,
        apiSecret: context.exchangeAccount.apiSecret,
        apiPassphrase: executionVaultAddress ?? undefined,
        restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL
      });
      try {
        const readIdentity = `${input.botVaultId}:${context.exchangeAccount.exchangeAccountId}`;
        const [accountResult, positionsResult] = await Promise.allSettled([
          executeHyperliquidRead({
            key: buildHyperliquidReadKey({
              scope: "vault-execution-state",
              identity: readIdentity,
              endpoint: "accountState"
            }),
            ttlMs: 10_000,
            staleMs: 60_000,
            cooldownMs: 15_000,
            retryAttempts: 2,
            retryBaseDelayMs: 250,
            read: () => adapter.getAccountState()
          }),
          executeHyperliquidRead({
            key: buildHyperliquidReadKey({
              scope: "vault-execution-state",
              identity: readIdentity,
              endpoint: "positions"
            }),
            ttlMs: 10_000,
            staleMs: 60_000,
            cooldownMs: 15_000,
            retryAttempts: 2,
            retryBaseDelayMs: 250,
            read: () => adapter.getPositions()
          })
        ]);
        if (accountResult.status === "rejected" && positionsResult.status === "rejected") {
          throw new Error(
            [
              normalizeProviderReadError(accountResult.reason),
              normalizeProviderReadError(positionsResult.reason)
            ].join(" | ")
          );
        }
        const accountRead = accountResult.status === "fulfilled" ? accountResult.value : null;
        const positionsRead = positionsResult.status === "fulfilled" ? positionsResult.value : null;
        const accountState = accountRead?.value ?? null;
        const positions = positionsRead?.value ?? [];
        const equityUsd = Number.isFinite(Number(accountState?.equity)) ? Number(accountState?.equity) : null;
        const freeUsd = Number.isFinite(Number(accountState?.availableMargin))
          ? Number(accountState?.availableMargin)
          : null;
        const usedMarginUsd =
          equityUsd != null && freeUsd != null
            ? Math.max(0, Number((equityUsd - freeUsd).toFixed(6)))
            : null;
        const degradedRead =
          accountResult.status !== "fulfilled" ||
          positionsResult.status !== "fulfilled" ||
          Boolean(accountRead?.degraded) ||
          Boolean(positionsRead?.degraded);
        const readErrors = [
          accountResult.status === "rejected"
            ? {
                scope: "account",
                reason: normalizeProviderReadError(accountResult.reason)
              }
            : accountRead?.degraded && accountRead.reason
              ? {
                  scope: "account",
                  reason: accountRead.reason
                }
              : null,
          positionsResult.status === "rejected"
            ? {
                scope: "positions",
                reason: normalizeProviderReadError(positionsResult.reason)
              }
            : positionsRead?.degraded && positionsRead.reason
              ? {
                  scope: "positions",
                  reason: positionsRead.reason
                }
              : null
        ].filter((item): item is { scope: string; reason: string } => item !== null);
        const cacheAgeMsCandidates = [
          accountRead?.cacheAgeMs ?? null,
          positionsRead?.cacheAgeMs ?? null
        ].filter((value): value is number => Number.isFinite(value));
        const cacheAgeMs = cacheAgeMsCandidates.length > 0 ? Math.max(...cacheAgeMsCandidates) : null;
        const rateLimited =
          Boolean(accountRead?.rateLimited) ||
          Boolean(positionsRead?.rateLimited) ||
          readErrorCategory(accountResult.status === "rejected" ? accountResult.reason : null) === "rate_limited" ||
          readErrorCategory(positionsResult.status === "rejected" ? positionsResult.reason : null) === "rate_limited";
        return {
          status: providerState.status,
          equityUsd,
          freeUsd,
          usedMarginUsd,
          positions: mapExecutionPositions(positions),
          providerMetadata: {
            providerMode: "live",
            chain: "hyperevm",
            marketDataExchange: "hyperliquid",
            vaultAddress: executionVaultAddress,
            subaccountAddress: null,
            agentWallet: context.exchangeAccount.apiKey,
            providerUnitId: providerState.providerUnitId ?? null,
            providerVaultId: providerState.providerVaultId ?? null,
            providerAccountId: context.exchangeAccount.exchangeAccountId,
            providerState,
            degradedRead,
            readErrors,
            cacheAgeMs,
            rateLimited
          },
          observedAt: new Date().toISOString()
        };
      } finally {
        await adapter.close().catch(() => {});
      }
    }
  };
}
