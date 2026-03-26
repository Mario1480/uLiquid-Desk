import crypto from "node:crypto";
import { HyperliquidFuturesAdapter } from "@mm/futures-exchange";
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
    vaultAddress: typeof providerState.vaultAddress === "string" ? providerState.vaultAddress : row?.vaultAddress ?? null,
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

async function findHyperliquidAccountForUser(db: any, userId: string): Promise<HyperliquidCredentials> {
  const account = await db.exchangeAccount.findFirst({
    where: {
      userId,
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
  return decodeHyperliquidSecrets({
    id: String(account.id),
    apiKeyEnc: String(account.apiKeyEnc),
    apiSecretEnc: String(account.apiSecretEnc),
    passphraseEnc: account.passphraseEnc ? String(account.passphraseEnc) : null
  });
}

async function findBotVaultContext(db: any, userId: string, botVaultId: string): Promise<{
  id: string;
  userId: string;
  gridInstanceId: string | null;
  botId: string | null;
  vaultAddress: string | null;
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
    vaultAddress: normalizeAddress(row.vaultAddress) ?? null,
    agentWallet: normalizeAddress(row.agentWallet) ?? null,
    executionStatus: row.executionStatus ? String(row.executionStatus) : null,
    executionMetadata: toRecord(row.executionMetadata),
    exchangeAccount: decodeHyperliquidSecrets({
      id: String(account.id),
      apiKeyEnc: String(account.apiKeyEnc),
      apiSecretEnc: String(account.apiSecretEnc),
      passphraseEnc: account.passphraseEnc ? String(account.passphraseEnc) : null
    })
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
      const context = await findBotVaultContext(db, input.userId, input.botVaultId);
      const providerUnitId = buildId(
        "hl_bot_unit",
        `${input.botVaultId}:${context.exchangeAccount.exchangeAccountId}`
      );
      await patchProviderState(db, input.botVaultId, {
        status: "created",
        providerUnitId,
        providerAccountId: context.exchangeAccount.exchangeAccountId,
        vaultAddress: context.exchangeAccount.vaultAddress,
        subaccountAddress: null,
        agentWallet: context.exchangeAccount.apiKey,
        lastAction: "createBotExecutionUnit"
      });
      return {
        providerUnitId
      };
    },

    async assignAgent(input) {
      const context = await findBotVaultContext(db, input.userId, input.botVaultId);
      await patchProviderState(db, input.botVaultId, {
        providerAccountId: context.exchangeAccount.exchangeAccountId,
        vaultAddress: context.exchangeAccount.vaultAddress,
        agentWallet: context.exchangeAccount.apiKey,
        subaccountAddress: null,
        lastAction: "assignAgent"
      });
      return { agentWallet: context.exchangeAccount.apiKey };
    },

    async startBotExecution(input) {
      await findBotVaultContext(db, input.userId, input.botVaultId);
      await patchProviderState(db, input.botVaultId, {
        status: "running",
        lastAction: "startBotExecution"
      });
      return { ok: true };
    },

    async pauseBotExecution(input) {
      await findBotVaultContext(db, input.userId, input.botVaultId);
      await patchProviderState(db, input.botVaultId, {
        status: "paused",
        lastAction: "pauseBotExecution"
      });
      return { ok: true };
    },

    async setBotCloseOnly(input) {
      await findBotVaultContext(db, input.userId, input.botVaultId);
      await patchProviderState(db, input.botVaultId, {
        status: "close_only",
        lastAction: "setBotCloseOnly"
      });
      return { ok: true };
    },

    async closeBotExecution(input) {
      await findBotVaultContext(db, input.userId, input.botVaultId);
      await patchProviderState(db, input.botVaultId, {
        status: "closed",
        lastAction: "closeBotExecution"
      });
      return { ok: true };
    },

    async getBotExecutionState(input) {
      const context = await findBotVaultContext(db, input.userId, input.botVaultId);
      const providerState = readProviderState({
        executionMetadata: context.executionMetadata,
        executionStatus: context.executionStatus,
        vaultAddress: context.vaultAddress,
        agentWallet: context.agentWallet
      });
      const adapter = new HyperliquidFuturesAdapter({
        apiKey: context.exchangeAccount.apiKey,
        apiSecret: context.exchangeAccount.apiSecret,
        apiPassphrase: context.exchangeAccount.vaultAddress ?? undefined,
        restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL
      });
      try {
        const [accountState, positions] = await Promise.all([
          adapter.getAccountState(),
          adapter.getPositions()
        ]);
        const equityUsd = Number.isFinite(Number(accountState.equity)) ? Number(accountState.equity) : null;
        const freeUsd = Number.isFinite(Number(accountState.availableMargin))
          ? Number(accountState.availableMargin)
          : null;
        const usedMarginUsd =
          equityUsd != null && freeUsd != null
            ? Math.max(0, Number((equityUsd - freeUsd).toFixed(6)))
            : null;
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
            vaultAddress: context.exchangeAccount.vaultAddress,
            subaccountAddress: null,
            agentWallet: context.exchangeAccount.apiKey,
            providerUnitId: providerState.providerUnitId ?? null,
            providerVaultId: providerState.providerVaultId ?? null,
            providerAccountId: context.exchangeAccount.exchangeAccountId,
            providerState
          },
          observedAt: new Date().toISOString()
        };
      } finally {
        await adapter.close().catch(() => {});
      }
    }
  };
}
