import crypto from "node:crypto";
import type { ExecutionProvider, BotExecutionStatus, ExecutionProviderLogger } from "./executionProvider.types.js";

type CreateHyperliquidDemoExecutionProviderParams = {
  db: any;
  logger?: ExecutionProviderLogger;
};

type HyperliquidDemoState = {
  status: BotExecutionStatus;
  providerMode: "demo";
  chain: "hyperevm";
  marketDataExchange: "hyperliquid";
  providerVaultId?: string | null;
  providerUnitId?: string | null;
  vaultAddress?: string | null;
  subaccountAddress?: string | null;
  agentWallet?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastAction?: string | null;
};

function buildHash(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function buildAddress(seed: string): string {
  return `0x${buildHash(seed).slice(0, 40)}`;
}

function buildId(prefix: string, seed: string): string {
  return `${prefix}_${buildHash(seed).slice(0, 16)}`;
}

function normalizeAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(raw)) return raw;
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readProviderState(row: any): HyperliquidDemoState {
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
    providerMode: "demo",
    chain: "hyperevm",
    marketDataExchange: "hyperliquid",
    providerVaultId: typeof providerState.providerVaultId === "string" ? providerState.providerVaultId : null,
    providerUnitId: typeof providerState.providerUnitId === "string" ? providerState.providerUnitId : null,
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
  patch: Partial<HyperliquidDemoState>
): Promise<HyperliquidDemoState> {
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
  const next: HyperliquidDemoState = {
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

async function findBotVault(db: any, userId: string, botVaultId: string): Promise<any> {
  const row = await db.botVault.findFirst({
    where: {
      id: botVaultId,
      userId
    },
    select: {
      id: true,
      userId: true,
      masterVaultId: true,
      templateId: true,
      gridInstanceId: true,
      vaultAddress: true,
      agentWallet: true,
      executionStatus: true,
      executionMetadata: true,
      availableUsd: true,
      principalAllocated: true,
      principalReturned: true
    }
  });
  if (!row) throw new Error("bot_vault_not_found");
  return row;
}

export function createHyperliquidDemoExecutionProvider(
  params: CreateHyperliquidDemoExecutionProviderParams
): ExecutionProvider {
  const db = params.db;

  return {
    get key(): ExecutionProvider["key"] {
      return "hyperliquid_demo";
    },

    async createUserVault(input) {
      return {
        providerVaultId: buildId("hldemo_user_vault", `${input.userId}:${input.masterVaultId}`),
        vaultAddress: buildAddress(`hldemo:user_vault:${input.userId}:${input.masterVaultId}`)
      };
    },

    async createBotExecutionUnit(input) {
      const ownerRef = input.gridInstanceId ?? input.botId ?? input.botVaultId;
      const providerUnitId = buildId("hldemo_bot_unit", `${input.botVaultId}:${ownerRef}`);
      const vaultAddress = buildAddress(`hldemo:bot_vault:${input.botVaultId}:${ownerRef}`);
      const subaccountAddress = buildAddress(`hldemo:subaccount:${input.botVaultId}:${ownerRef}`);
      await patchProviderState(db, input.botVaultId, {
        status: "created",
        providerUnitId,
        vaultAddress,
        subaccountAddress,
        lastAction: "createBotExecutionUnit"
      });
      return {
        providerUnitId,
        vaultAddress
      };
    },

    async assignAgent(input) {
      const agentWallet =
        normalizeAddress(input.agentWalletHint)
        ?? buildAddress(`hldemo:agent:${input.userId}:${input.botVaultId}`);
      await patchProviderState(db, input.botVaultId, {
        agentWallet,
        lastAction: "assignAgent"
      });
      return { agentWallet };
    },

    async startBotExecution(input) {
      await patchProviderState(db, input.botVaultId, {
        status: "running",
        lastAction: "startBotExecution"
      });
      return { ok: true };
    },

    async pauseBotExecution(input) {
      await patchProviderState(db, input.botVaultId, {
        status: "paused",
        lastAction: "pauseBotExecution"
      });
      return { ok: true };
    },

    async setBotCloseOnly(input) {
      await patchProviderState(db, input.botVaultId, {
        status: "close_only",
        lastAction: "setBotCloseOnly"
      });
      return { ok: true };
    },

    async closeBotExecution(input) {
      await patchProviderState(db, input.botVaultId, {
        status: "closed",
        lastAction: "closeBotExecution"
      });
      return { ok: true };
    },

    async getBotExecutionState(input) {
      const row = await findBotVault(db, input.userId, input.botVaultId);
      const providerState = readProviderState(row);
      const availableUsd = Number(row.availableUsd ?? 0);
      const principalAllocatedUsd = Number(row.principalAllocated ?? 0);
      const principalReturnedUsd = Number(row.principalReturned ?? 0);
      const outstandingPrincipalUsd = Math.max(0, principalAllocatedUsd - principalReturnedUsd);
      const usedMarginUsd = Math.max(0, outstandingPrincipalUsd - availableUsd);
      const equityUsd = Number((availableUsd + usedMarginUsd).toFixed(6));
      const freeUsd = Number(availableUsd.toFixed(6));
      return {
        status: providerState.status,
        equityUsd,
        freeUsd,
        usedMarginUsd: Number(usedMarginUsd.toFixed(6)),
        positions: [],
        providerMetadata: {
          providerMode: "demo",
          chain: "hyperevm",
          marketDataExchange: "hyperliquid",
          vaultAddress: providerState.vaultAddress ?? row.vaultAddress ?? null,
          subaccountAddress: providerState.subaccountAddress ?? null,
          agentWallet: providerState.agentWallet ?? row.agentWallet ?? null,
          providerUnitId: providerState.providerUnitId ?? null,
          providerVaultId: providerState.providerVaultId ?? null,
          providerState
        },
        observedAt: new Date().toISOString()
      };
    }
  };
}
