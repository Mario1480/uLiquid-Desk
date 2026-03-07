import { isAddress, type Hex } from "viem";
import { logger as defaultLogger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode, type VaultExecutionMode } from "./executionMode.js";
import { createOnchainProvider } from "./onchainProvider.js";
import type { OnchainActionType, OnchainTxRequest } from "./onchainProvider.types.js";
import { resolveOnchainAddressBook } from "./onchainAddressBook.js";

const ATOMIC_DECIMALS = 6;

function toAtomicUsd(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_amount_usd");
  const scaled = Math.round(value * 10 ** ATOMIC_DECIMALS);
  if (!Number.isFinite(scaled) || scaled <= 0) throw new Error("invalid_amount_usd");
  return BigInt(scaled);
}

function normalizeActionKey(input: unknown, fallbackPrefix: string): string {
  const raw = String(input ?? "").trim();
  if (raw) return raw;
  return `${fallbackPrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTxHash(value: unknown): Hex {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("invalid_tx_hash");
  return raw as Hex;
}

async function ensureMasterVault(tx: any, userId: string): Promise<any> {
  const existing = await tx.masterVault.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.masterVault.create({
    data: {
      userId
    }
  });
}

async function getUserWithWallet(tx: any, userId: string): Promise<any> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      walletAddress: true
    }
  });
  if (!user) throw new Error("user_not_found");
  return user;
}

function mapActionRow(row: any) {
  return {
    id: String(row.id),
    actionKey: String(row.actionKey),
    actionType: String(row.actionType),
    status: String(row.status),
    chainId: Number(row.chainId),
    txHash: row.txHash ? String(row.txHash) : null,
    toAddress: String(row.toAddress),
    dataHex: String(row.dataHex),
    valueWei: String(row.valueWei),
    metadata: row.metadata ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

type CreateOnchainActionServiceDeps = {
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

export function createOnchainActionService(db: any, deps?: CreateOnchainActionServiceDeps) {
  const logger = deps?.logger ?? defaultLogger;

  async function getMode(): Promise<VaultExecutionMode> {
    return getEffectiveVaultExecutionMode(db);
  }

  async function requireOnchainMode(): Promise<VaultExecutionMode> {
    const mode = await getMode();
    if (!isOnchainMode(mode)) {
      throw new Error("vault_execution_mode_offchain_shadow");
    }
    return mode;
  }

  async function ensureAction(params: {
    tx: any;
    actionKey: string;
    actionType: OnchainActionType;
    userId: string;
    masterVaultId?: string | null;
    botVaultId?: string | null;
    txRequest: OnchainTxRequest;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await params.tx.onchainAction.findUnique({
      where: { actionKey: params.actionKey }
    });
    if (existing) return existing;

    try {
      return await params.tx.onchainAction.create({
        data: {
          actionKey: params.actionKey,
          actionType: params.actionType,
          status: "prepared",
          userId: params.userId,
          masterVaultId: params.masterVaultId ?? null,
          botVaultId: params.botVaultId ?? null,
          chainId: params.txRequest.chainId,
          toAddress: params.txRequest.to,
          dataHex: params.txRequest.data,
          valueWei: params.txRequest.value,
          metadata: params.metadata ?? null
        }
      });
    } catch (error) {
      if (String((error as any)?.code ?? "") !== "P2002") throw error;
      return params.tx.onchainAction.findUnique({ where: { actionKey: params.actionKey } });
    }
  }

  async function buildCreateMasterVaultForUser(params: {
    userId: string;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook(mode);
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const user = await getUserWithWallet(tx, params.userId);
      const walletAddress = String(user.walletAddress ?? "").trim();
      if (!walletAddress || !isAddress(walletAddress)) {
        throw new Error("wallet_address_required");
      }

      const masterVault = await ensureMasterVault(tx, params.userId);
      const actionKey = normalizeActionKey(params.actionKey, `onchain:create_master_vault:${params.userId}`);
      const txRequest = await provider.buildCreateMasterVaultTx({
        ownerAddress: walletAddress as `0x${string}`
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "create_master_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        txRequest,
        metadata: {
          ownerAddress: walletAddress,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest
      };
    });
  }

  async function buildDepositToMasterVault(params: {
    userId: string;
    amountUsd: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook(mode);
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const masterVault = await ensureMasterVault(tx, params.userId);
      const onchainAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!onchainAddress || !isAddress(onchainAddress)) {
        throw new Error("master_vault_onchain_address_missing");
      }
      const amountAtomic = toAtomicUsd(params.amountUsd);
      const actionKey = normalizeActionKey(params.actionKey, `onchain:deposit:${params.userId}:${params.amountUsd}`);
      const txRequest = await provider.buildDepositToMasterVaultTx({
        masterVaultAddress: onchainAddress as `0x${string}`,
        amountAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "deposit_master_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        txRequest,
        metadata: {
          amountUsd: params.amountUsd,
          amountAtomic: amountAtomic.toString(),
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest
      };
    });
  }

  async function buildCreateBotVault(params: {
    userId: string;
    botVaultId: string;
    allocationUsd: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook(mode);
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: {
          id: params.botVaultId,
          userId: params.userId
        },
        select: {
          id: true,
          masterVaultId: true,
          templateId: true,
          gridInstanceId: true,
          vaultAddress: true,
          gridInstance: {
            select: {
              botId: true
            }
          }
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      if (botVault.vaultAddress) throw new Error("bot_vault_onchain_already_created");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");

      const onchainAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!onchainAddress || !isAddress(onchainAddress)) throw new Error("master_vault_onchain_address_missing");

      const allocationAtomic = toAtomicUsd(params.allocationUsd);
      const actionKey = normalizeActionKey(params.actionKey, `onchain:create_bot_vault:${params.botVaultId}:${params.allocationUsd}`);

      const txRequest = await provider.buildCreateBotVaultTx({
        masterVaultAddress: onchainAddress as `0x${string}`,
        templateId: String(botVault.templateId ?? "legacy_grid_default"),
        botId: String(botVault.gridInstance?.botId ?? botVault.gridInstanceId ?? botVault.id),
        allocationAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "create_bot_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          allocationUsd: params.allocationUsd,
          allocationAtomic: allocationAtomic.toString(),
          templateId: String(botVault.templateId ?? "legacy_grid_default"),
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest
      };
    });
  }

  async function buildClaimFromBotVault(params: {
    userId: string;
    botVaultId: string;
    releasedReservedUsd: number;
    returnedToFreeUsd: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook(mode);
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: { id: params.botVaultId, userId: params.userId },
        select: {
          id: true,
          masterVaultId: true,
          vaultAddress: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const releasedReservedAtomic = toAtomicUsd(params.releasedReservedUsd);
      const returnedToFreeAtomic = toAtomicUsd(params.returnedToFreeUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:claim_bot_vault:${params.botVaultId}:${params.releasedReservedUsd}:${params.returnedToFreeUsd}`
      );

      const txRequest = await provider.buildClaimFromBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        releasedReservedAtomic,
        returnedToFreeAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "claim_from_bot_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          releasedReservedUsd: params.releasedReservedUsd,
          returnedToFreeUsd: params.returnedToFreeUsd,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest
      };
    });
  }

  async function buildCloseBotVault(params: {
    userId: string;
    botVaultId: string;
    releasedReservedUsd: number;
    returnedToFreeUsd: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook(mode);
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: { id: params.botVaultId, userId: params.userId },
        select: {
          id: true,
          masterVaultId: true,
          vaultAddress: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const releasedReservedAtomic = toAtomicUsd(params.releasedReservedUsd);
      const returnedToFreeAtomic = toAtomicUsd(params.returnedToFreeUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:close_bot_vault:${params.botVaultId}:${params.releasedReservedUsd}:${params.returnedToFreeUsd}`
      );

      const txRequest = await provider.buildCloseBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        releasedReservedAtomic,
        returnedToFreeAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "close_bot_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          releasedReservedUsd: params.releasedReservedUsd,
          returnedToFreeUsd: params.returnedToFreeUsd,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest
      };
    });
  }

  async function submitActionTxHash(params: {
    userId: string;
    actionId: string;
    txHash: string;
  }) {
    const txHash = normalizeTxHash(params.txHash);

    return db.$transaction(async (tx: any) => {
      const action = await tx.onchainAction.findFirst({
        where: {
          id: params.actionId,
          userId: params.userId
        }
      });
      if (!action) throw new Error("onchain_action_not_found");

      const existing = await tx.onchainAction.findFirst({
        where: {
          txHash,
          id: {
            not: action.id
          }
        },
        select: { id: true }
      });
      if (existing) {
        throw new Error("tx_hash_already_linked");
      }

      const next = await tx.onchainAction.update({
        where: { id: action.id },
        data: {
          txHash,
          status: action.status === "confirmed" ? "confirmed" : "submitted"
        }
      });

      logger.info("vault_onchain_action_tx_submitted", {
        actionId: next.id,
        actionType: next.actionType,
        txHash
      });

      return mapActionRow(next);
    });
  }

  async function markActionConfirmedByTxHash(params: {
    txHash: string;
    status?: "confirmed" | "failed";
  }): Promise<void> {
    const status = params.status ?? "confirmed";
    await db.onchainAction.updateMany({
      where: {
        txHash: normalizeTxHash(params.txHash),
        status: {
          not: "confirmed"
        }
      },
      data: {
        status
      }
    });
  }

  async function listActionsForUser(params: { userId: string; limit?: number }) {
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit ?? 50))));
    const rows = await db.onchainAction.findMany({
      where: {
        userId: params.userId
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
    return rows.map(mapActionRow);
  }

  return {
    getMode,
    buildCreateMasterVaultForUser,
    buildDepositToMasterVault,
    buildCreateBotVault,
    buildClaimFromBotVault,
    buildCloseBotVault,
    submitActionTxHash,
    markActionConfirmedByTxHash,
    listActionsForUser
  };
}

export type OnchainActionService = ReturnType<typeof createOnchainActionService>;
