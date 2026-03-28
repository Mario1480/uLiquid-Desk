import { isAddress, type Hex } from "viem";
import { logger as defaultLogger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode, type VaultExecutionMode } from "./executionMode.js";
import {
  createOnchainProvider,
  createOnchainPublicClient,
  readBotVaultState,
  readMasterVaultSettlementState,
  readMasterVaultProfitShareFeeRatePct,
  readMasterVaultTreasuryRecipient
} from "./onchainProvider.js";
import type { OnchainActionType, OnchainTxRequest } from "./onchainProvider.types.js";
import { normalizeOnchainContractVersion, resolveOnchainAddressBook } from "./onchainAddressBook.js";
import {
  LEGACY_TREASURY_CONTRACT_VERSION,
  LEGACY_TREASURY_PAYOUT_MODEL,
  ONCHAIN_TREASURY_CONTRACT_VERSION,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";
import { DEFAULT_SETTLEMENT_FEE_RATE_PCT } from "./feeSettlement.math.js";
import { roundUsd } from "./profitShare.js";
import { decryptSecret } from "../secret-crypto.js";

const ATOMIC_DECIMALS = 6;

function toAtomicUsd(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_amount_usd");
  const scaled = Math.round(value * 10 ** ATOMIC_DECIMALS);
  if (!Number.isFinite(scaled) || scaled <= 0) throw new Error("invalid_amount_usd");
  return BigInt(scaled);
}

function toAtomicUsdNonNegative(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid_amount_usd");
  const scaled = Math.round(value * 10 ** ATOMIC_DECIMALS);
  if (!Number.isFinite(scaled) || scaled < 0) throw new Error("invalid_amount_usd");
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

function mapBotVaultOnchainStatus(statusIndex: number): "ACTIVE" | "PAUSED" | "CLOSE_ONLY" | "CLOSED" | "UNKNOWN" {
  if (statusIndex === 0) return "ACTIVE";
  if (statusIndex === 1) return "PAUSED";
  if (statusIndex === 2) return "CLOSE_ONLY";
  if (statusIndex === 3) return "CLOSED";
  return "UNKNOWN";
}

export function assertCloseBotVaultPreflight(input: {
  onchainStatus: string;
  releasedReservedUsd: number;
  grossReturnedUsd: number;
  principalOutstandingUsd: number;
  reservedBalanceUsd: number;
  tokenSurplusUsd: number;
}) {
  if (input.onchainStatus !== "CLOSE_ONLY") {
    throw new Error(`bot_vault_onchain_close_only_required:${input.onchainStatus}`);
  }
  if (input.releasedReservedUsd > input.principalOutstandingUsd + 0.000001) {
    throw new Error(
      `bot_vault_released_reserved_exceeds_outstanding:${input.releasedReservedUsd}:${input.principalOutstandingUsd}`
    );
  }
  if (input.releasedReservedUsd > input.reservedBalanceUsd + 0.000001) {
    throw new Error(
      `bot_vault_released_reserved_exceeds_master_reserved:${input.releasedReservedUsd}:${input.reservedBalanceUsd}`
    );
  }
  const maxGrossReturnedUsd = input.releasedReservedUsd + input.tokenSurplusUsd;
  if (input.grossReturnedUsd > maxGrossReturnedUsd + 0.000001) {
    throw new Error(
      `bot_vault_gross_return_exceeds_limit:${input.grossReturnedUsd}:${maxGrossReturnedUsd}`
    );
  }
}

export function assertRecoverClosedBotVaultPreflight(input: {
  onchainStatus: string;
  releasedReservedUsd: number;
  grossReturnedUsd: number;
  principalOutstandingUsd: number;
  reservedBalanceUsd: number;
  tokenSurplusUsd: number;
}) {
  if (input.onchainStatus !== "CLOSED") {
    throw new Error(`bot_vault_onchain_closed_required:${input.onchainStatus}`);
  }
  if (input.releasedReservedUsd > input.principalOutstandingUsd + 0.000001) {
    throw new Error(
      `bot_vault_released_reserved_exceeds_outstanding:${input.releasedReservedUsd}:${input.principalOutstandingUsd}`
    );
  }
  if (input.releasedReservedUsd > input.reservedBalanceUsd + 0.000001) {
    throw new Error(
      `bot_vault_released_reserved_exceeds_master_reserved:${input.releasedReservedUsd}:${input.reservedBalanceUsd}`
    );
  }
  const maxGrossReturnedUsd = input.releasedReservedUsd + input.tokenSurplusUsd;
  if (input.grossReturnedUsd > maxGrossReturnedUsd + 0.000001) {
    throw new Error(
      `bot_vault_gross_return_exceeds_limit:${input.grossReturnedUsd}:${maxGrossReturnedUsd}`
    );
  }
}

export function assertSetBotVaultCloseOnlyPreflight(input: {
  onchainStatus: string;
}) {
  if (input.onchainStatus === "CLOSE_ONLY" || input.onchainStatus === "CLOSED") {
    throw new Error(`bot_vault_onchain_close_only_already_set:${input.onchainStatus}`);
  }
  if (input.onchainStatus !== "ACTIVE" && input.onchainStatus !== "PAUSED") {
    throw new Error(`bot_vault_onchain_close_only_invalid_status:${input.onchainStatus}`);
  }
}

export function deriveCloseBotVaultSettlement(input: {
  dbAvailableUsd: number;
  dbPrincipalAllocatedUsd: number;
  dbPrincipalReturnedUsd: number;
  onchainPrincipalOutstandingUsd: number;
  onchainReservedBalanceUsd: number;
  onchainTokenSurplusUsd: number;
  requestedReleasedReservedUsd?: number;
  requestedGrossReturnedUsd?: number;
}) {
  const onchainPrincipalOutstandingUsd = roundUsd(Math.max(0, Number(input.onchainPrincipalOutstandingUsd ?? 0)), 6);
  const onchainReservedBalanceUsd = roundUsd(Math.max(0, Number(input.onchainReservedBalanceUsd ?? 0)), 6);
  const onchainTokenSurplusUsd = roundUsd(Math.max(0, Number(input.onchainTokenSurplusUsd ?? 0)), 6);

  const maxReleasedReservedUsd = roundUsd(
    Math.min(onchainPrincipalOutstandingUsd, onchainReservedBalanceUsd),
    6
  );
  const defaultReleasedReservedUsd = roundUsd(
    maxReleasedReservedUsd,
    6
  );
  const releasedReservedUsd = input.requestedReleasedReservedUsd == null
    ? defaultReleasedReservedUsd
    : roundUsd(Math.max(0, Number(input.requestedReleasedReservedUsd ?? 0)), 6);

  const maxGrossReturnedUsd = roundUsd(releasedReservedUsd + onchainTokenSurplusUsd, 6);
  const defaultGrossReturnedUsd = roundUsd(
    maxGrossReturnedUsd,
    6
  );
  const grossReturnedUsd = input.requestedGrossReturnedUsd == null
    ? defaultGrossReturnedUsd
    : roundUsd(Math.max(0, Number(input.requestedGrossReturnedUsd ?? 0)), 6);

  return {
    releasedReservedUsd,
    grossReturnedUsd,
    defaults: {
      releasedReservedUsd: defaultReleasedReservedUsd,
      grossReturnedUsd: defaultGrossReturnedUsd
    },
    limits: {
      maxReleasedReservedUsd,
      maxGrossReturnedUsd
    }
  };
}

export function deriveClaimFromBotVaultSettlement(input: {
  dbAvailableUsd: number;
  dbPrincipalAllocatedUsd: number;
  dbPrincipalReturnedUsd: number;
  onchainTokenSurplusUsd: number;
  requestedReleasedReservedUsd?: number;
  requestedGrossReturnedUsd?: number;
}) {
  const dbAvailableUsd = roundUsd(Math.max(0, Number(input.dbAvailableUsd ?? 0)), 6);
  const dbOutstandingUsd = roundUsd(
    Math.max(0, Number(input.dbPrincipalAllocatedUsd ?? 0) - Number(input.dbPrincipalReturnedUsd ?? 0)),
    6
  );
  const dbWithdrawableUsd = roundUsd(Math.max(0, dbAvailableUsd - dbOutstandingUsd), 6);
  const releasedReservedUsd = roundUsd(Math.max(0, Number(input.requestedReleasedReservedUsd ?? 0)), 6);
  const onchainTokenSurplusUsd = roundUsd(Math.max(0, Number(input.onchainTokenSurplusUsd ?? 0)), 6);
  const maxGrossReturnedUsd = roundUsd(releasedReservedUsd + onchainTokenSurplusUsd, 6);
  const defaultGrossReturnedUsd = roundUsd(
    Math.min(dbWithdrawableUsd, maxGrossReturnedUsd),
    6
  );
  const grossReturnedUsd = input.requestedGrossReturnedUsd == null
    ? defaultGrossReturnedUsd
    : roundUsd(Math.max(0, Number(input.requestedGrossReturnedUsd ?? 0)), 6);

  return {
    releasedReservedUsd,
    grossReturnedUsd,
    defaults: {
      releasedReservedUsd: 0,
      grossReturnedUsd: defaultGrossReturnedUsd
    },
    limits: {
      maxGrossReturnedUsd
    }
  };
}

async function ensureMasterVault(tx: any, userId: string): Promise<any> {
  const existing = await tx.masterVault.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.masterVault.create({
    data: {
      userId,
      contractVersion: "v2"
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
    userId: row.userId ? String(row.userId) : null,
    masterVaultId: row.masterVaultId ? String(row.masterVaultId) : null,
    botVaultId: row.botVaultId ? String(row.botVaultId) : null,
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

type TreasuryContractProfile = {
  contractVersion: string;
  treasuryPayoutModel: string;
  treasuryRecipient: string | null;
  feeRatePct: number;
  usesGrossReturnSemantics: boolean;
};

type SettlementPreview = {
  contractVersion: string;
  treasuryPayoutModel: string;
  treasuryRecipient: string | null;
  feeRatePct: number;
  releasedReservedUsd: number;
  grossReturnedUsd: number;
  feeBaseUsd: number;
  feeAmountUsd: number;
  netReturnedUsd: number;
  realizedPnlAfterUsd: number;
  highWaterMarkBeforeUsd: number;
  highWaterMarkAfterUsd: number;
};

function computeSettlementPreview(input: {
  contractVersion: string;
  treasuryPayoutModel: string;
  treasuryRecipient: string | null;
  feeRatePct: number;
  releasedReservedUsd: number;
  grossReturnedUsd: number;
  realizedPnlNetUsd: number;
  highWaterMarkUsd: number;
}) {
  const releasedReservedUsd = roundUsd(Math.max(0, Number(input.releasedReservedUsd ?? 0)), 6);
  const grossReturnedUsd = roundUsd(Math.max(0, Number(input.grossReturnedUsd ?? 0)), 6);
  const highWaterMarkBeforeUsd = roundUsd(Math.max(0, Number(input.highWaterMarkUsd ?? 0)), 6);
  const realizedPnlAfterUsd = roundUsd(
    Number(input.realizedPnlNetUsd ?? 0) + grossReturnedUsd - releasedReservedUsd,
    6
  );
  const realizedPnlAfterPositiveUsd = Math.max(0, realizedPnlAfterUsd);
  const profitComponentUsd = roundUsd(Math.max(0, grossReturnedUsd - releasedReservedUsd), 6);
  const feeableProfitCapacityUsd = roundUsd(Math.max(0, realizedPnlAfterPositiveUsd - highWaterMarkBeforeUsd), 6);
  const feeBaseUsd = roundUsd(Math.min(profitComponentUsd, feeableProfitCapacityUsd), 6);
  const feeRatePct = Math.max(0, Math.min(100, Number(input.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT)));
  const feeAmountUsd = roundUsd(feeBaseUsd * (feeRatePct / 100), 4);
  const netReturnedUsd = roundUsd(Math.max(0, grossReturnedUsd - feeAmountUsd), 6);
  return {
    contractVersion: input.contractVersion,
    treasuryPayoutModel: input.treasuryPayoutModel,
    treasuryRecipient: input.treasuryRecipient,
    releasedReservedUsd,
    grossReturnedUsd,
    feeBaseUsd,
    feeAmountUsd,
    netReturnedUsd,
    realizedPnlAfterUsd,
    highWaterMarkBeforeUsd,
    highWaterMarkAfterUsd: roundUsd(highWaterMarkBeforeUsd + feeBaseUsd, 6),
    feeRatePct
  } satisfies SettlementPreview;
}

type CreateOnchainActionServiceDeps = {
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

export function createOnchainActionService(db: any, deps?: CreateOnchainActionServiceDeps) {
  const logger = deps?.logger ?? defaultLogger;

  async function resolveTreasuryContractProfile(params: {
    mode: VaultExecutionMode;
    masterVaultAddress: `0x${string}`;
    contractVersion?: string;
  }): Promise<TreasuryContractProfile> {
    if (!isOnchainMode(params.mode)) {
      return {
        contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
        treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
        treasuryRecipient: null,
        feeRatePct: DEFAULT_SETTLEMENT_FEE_RATE_PCT,
        usesGrossReturnSemantics: false
      };
    }

    const addressBook = resolveOnchainAddressBook({
      mode: params.mode,
      contractVersion: params.contractVersion ?? "v1"
    });
    const client = createOnchainPublicClient(addressBook);
    const [treasuryRecipient, feeRatePct] = await Promise.all([
      readMasterVaultTreasuryRecipient(client, params.masterVaultAddress).catch(() => null),
      readMasterVaultProfitShareFeeRatePct(client, params.masterVaultAddress).catch(() => null)
    ]);
    if (treasuryRecipient && isAddress(treasuryRecipient)) {
      return {
        contractVersion: ONCHAIN_TREASURY_CONTRACT_VERSION,
        treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
        treasuryRecipient,
        feeRatePct: Number.isFinite(Number(feeRatePct)) ? Number(feeRatePct) : DEFAULT_SETTLEMENT_FEE_RATE_PCT,
        usesGrossReturnSemantics: true
      };
    }

    return {
      contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
      treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
      treasuryRecipient: null,
      feeRatePct: DEFAULT_SETTLEMENT_FEE_RATE_PCT,
      usesGrossReturnSemantics: false
    };
  }

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
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion: "v2" });
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
          contractVersion: "v2",
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
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion: "v2" });
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

  async function buildWithdrawFromMasterVault(params: {
    userId: string;
    amountUsd: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion: "v2" });
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const masterVault = await ensureMasterVault(tx, params.userId);
      const onchainAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!onchainAddress || !isAddress(onchainAddress)) {
        throw new Error("master_vault_onchain_address_missing");
      }
      const amountAtomic = toAtomicUsd(params.amountUsd);
      const actionKey = normalizeActionKey(params.actionKey, `onchain:withdraw:${params.userId}:${params.amountUsd}`);
      const txRequest = await provider.buildWithdrawFromMasterVaultTx({
        masterVaultAddress: onchainAddress as `0x${string}`,
        amountAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "withdraw_master_vault",
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
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

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
              botId: true,
              exchangeAccount: {
                select: {
                  apiKeyEnc: true
                }
              }
            }
          }
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      if (botVault.vaultAddress) throw new Error("bot_vault_onchain_already_created");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);

      const onchainAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!onchainAddress || !isAddress(onchainAddress)) throw new Error("master_vault_onchain_address_missing");

      const allocationAtomic = toAtomicUsd(params.allocationUsd);
      const actionKey = normalizeActionKey(params.actionKey, `onchain:create_bot_vault:${params.botVaultId}:${params.allocationUsd}`);
      const decryptedAgentWallet =
        contractVersion === "v2" && botVault.gridInstance?.exchangeAccount?.apiKeyEnc
          ? String(decryptSecret(String(botVault.gridInstance.exchangeAccount.apiKeyEnc))).trim()
          : "";

      const txRequest = await provider.buildCreateBotVaultTx({
        masterVaultAddress: onchainAddress as `0x${string}`,
        templateId: String(botVault.templateId ?? "legacy_grid_default"),
        botId: String(botVault.gridInstance?.botId ?? botVault.gridInstanceId ?? botVault.id),
        allocationAtomic,
        agentWallet:
          contractVersion === "v2" && isAddress(decryptedAgentWallet)
            ? decryptedAgentWallet as `0x${string}`
            : undefined
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
          contractVersion,
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

  async function buildSetBotVaultCloseOnly(params: {
    userId: string;
    botVaultId: string;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

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
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const client = createOnchainPublicClient(addressBook);
      const onchainBotVaultState = await readBotVaultState(client, botVaultAddress as `0x${string}`);
      const onchainStatus = mapBotVaultOnchainStatus(onchainBotVaultState.status);
      assertSetBotVaultCloseOnlyPreflight({ onchainStatus });

      const actionKey = normalizeActionKey(params.actionKey, `onchain:set_bot_vault_close_only:${params.botVaultId}`);
      const txRequest = await provider.buildSetBotVaultCloseOnlyTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "set_bot_vault_close_only",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          preflight: {
            onchainStatus
          },
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

  async function buildReserveForBotVault(params: {
    userId: string;
    botVaultId: string;
    amountUsd?: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: {
          id: params.botVaultId,
          userId: params.userId
        },
        select: {
          id: true,
          masterVaultId: true,
          gridInstanceId: true,
          vaultAddress: true,
          principalAllocated: true,
          allocatedUsd: true,
          executionMetadata: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const provisioning = botVault.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
        ? (botVault.executionMetadata as Record<string, unknown>).provisioning
        : null;
      const metadataAllocationUsd = provisioning && typeof provisioning === "object" && !Array.isArray(provisioning)
        ? Number((provisioning as Record<string, unknown>).allocationUsd ?? 0)
        : 0;
      const requestedAmountUsd = Number(params.amountUsd ?? metadataAllocationUsd ?? 0);
      if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) throw new Error("invalid_amount_usd");
      const amountUsd = requestedAmountUsd;
      const amountAtomic = toAtomicUsd(amountUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:reserve_for_bot_vault:${params.botVaultId}:${amountUsd}`
      );

      const txRequest = await provider.buildReserveForBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        amountAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "reserve_for_bot_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          amountUsd,
          amountAtomic: amountAtomic.toString(),
          contractVersion,
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

  async function buildFundBotVaultOnHyperCore(params: {
    userId: string;
    botVaultId: string;
    amountUsd?: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: {
          id: params.botVaultId,
          userId: params.userId
        },
        select: {
          id: true,
          masterVaultId: true,
          vaultAddress: true,
          executionMetadata: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      if (contractVersion !== "v2") throw new Error("bot_vault_hypercore_funding_v1_unsupported");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const provisioning = botVault.executionMetadata && typeof botVault.executionMetadata === "object" && !Array.isArray(botVault.executionMetadata)
        ? (botVault.executionMetadata as Record<string, unknown>).provisioning
        : null;
      const metadataAmountUsd = provisioning && typeof provisioning === "object" && !Array.isArray(provisioning)
        ? Number((provisioning as Record<string, unknown>).allocationUsd ?? 0)
        : 0;
      const requestedAmountUsd = Number(params.amountUsd ?? metadataAmountUsd ?? 0);
      if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) throw new Error("invalid_amount_usd");
      const amountUsd = requestedAmountUsd;
      const amountAtomic = toAtomicUsd(amountUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:fund_bot_vault_hypercore:${params.botVaultId}:${amountUsd}`
      );

      const txRequest = await provider.buildFundBotVaultOnHyperCoreTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        amountAtomic
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "fund_bot_vault_hypercore",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          amountUsd,
          amountAtomic: amountAtomic.toString(),
          contractVersion,
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

  async function buildSetBotVaultAgentWallet(params: {
    userId: string;
    botVaultId: string;
    agentWallet: string;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();

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
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      if (contractVersion !== "v2") throw new Error("bot_vault_agent_wallet_v1_unsupported");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const agentWallet = String(params.agentWallet ?? "").trim();
      if (!isAddress(agentWallet)) throw new Error("vault_onchain_agent_wallet_invalid");

      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:set_bot_vault_agent_wallet:${params.botVaultId}:${agentWallet.toLowerCase()}`
      );
      const txRequest = await provider.buildSetBotVaultAgentWalletTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        agentWallet: agentWallet as `0x${string}`
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "set_bot_vault_agent_wallet",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          agentWallet,
          contractVersion,
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

  async function buildSetTreasuryRecipient(params: {
    userId: string;
    treasuryRecipient: `0x${string}`;
    actionKey?: string;
    contractVersion?: string;
  }) {
    const mode = await requireOnchainMode();
    const contractVersion = normalizeOnchainContractVersion(params.contractVersion, "v1");
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
    const provider = createOnchainProvider(addressBook);

    return db.$transaction(async (tx: any) => {
      const actionKey = normalizeActionKey(params.actionKey, `onchain:set_treasury_recipient:${contractVersion}:${params.treasuryRecipient}`);
      const txRequest = await provider.buildSetTreasuryRecipientTx({
        treasuryRecipient: params.treasuryRecipient
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "set_treasury_recipient",
        userId: params.userId,
        txRequest,
        metadata: {
          requestedRecipient: params.treasuryRecipient,
          contractVersion,
          treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
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

  async function buildSetProfitShareFeeRate(params: {
    userId: string;
    feeRatePct: number;
    actionKey?: string;
    contractVersion?: string;
  }) {
    const mode = await requireOnchainMode();
    const contractVersion = normalizeOnchainContractVersion(params.contractVersion, "v1");
    const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
    const provider = createOnchainProvider(addressBook);
    const feeRatePct = Math.trunc(Number(params.feeRatePct));
    if (!Number.isFinite(feeRatePct) || feeRatePct < 0 || feeRatePct > 100) {
      throw new Error("invalid_profit_share_fee_rate_pct");
    }

    return db.$transaction(async (tx: any) => {
      const actionKey = normalizeActionKey(params.actionKey, `onchain:set_profit_share_fee_rate:${contractVersion}:${feeRatePct}`);
      const txRequest = await provider.buildSetProfitShareFeeRateTx({
        feeRatePct: BigInt(feeRatePct)
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "set_profit_share_fee_rate",
        userId: params.userId,
        txRequest,
        metadata: {
          requestedFeeRatePct: feeRatePct,
          feeRatePct,
          contractVersion,
          treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
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
    releasedReservedUsd?: number;
    returnedToFreeUsd?: number;
    grossReturnedUsd?: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: { id: params.botVaultId, userId: params.userId },
        select: {
          id: true,
          masterVaultId: true,
          status: true,
          vaultAddress: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          realizedNetUsd: true,
          highWaterMark: true,
          availableUsd: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const profile = await resolveTreasuryContractProfile({
        mode,
        masterVaultAddress: masterAddress as `0x${string}`
      });
      const requestedGrossReturnedUsd = Number(
        profile.usesGrossReturnSemantics
          ? params.grossReturnedUsd ?? params.returnedToFreeUsd ?? 0
          : params.returnedToFreeUsd ?? params.grossReturnedUsd ?? 0
      );
      const hasExplicitSettlementOverrides =
        params.releasedReservedUsd != null
        || params.returnedToFreeUsd != null
        || params.grossReturnedUsd != null;
      const client = createOnchainPublicClient(addressBook);
      const [onchainBotVaultState, onchainMasterSettlementState] = await Promise.all([
        readBotVaultState(client, botVaultAddress as `0x${string}`),
        readMasterVaultSettlementState(
          client,
          masterAddress as `0x${string}`,
          botVaultAddress as `0x${string}`
        )
      ]);
      const onchainStatus = mapBotVaultOnchainStatus(onchainBotVaultState.status);
      if (onchainStatus === "CLOSED") {
        throw new Error("bot_vault_onchain_claim_not_allowed:CLOSED");
      }
      const derivedSettlement = deriveClaimFromBotVaultSettlement({
        dbAvailableUsd: Number(botVault.availableUsd ?? 0),
        dbPrincipalAllocatedUsd: Number(botVault.principalAllocated ?? 0),
        dbPrincipalReturnedUsd: Number(botVault.principalReturned ?? 0),
        onchainTokenSurplusUsd: onchainMasterSettlementState.tokenSurplus,
        requestedReleasedReservedUsd: params.releasedReservedUsd,
        requestedGrossReturnedUsd: requestedGrossReturnedUsd > 0 ? requestedGrossReturnedUsd : undefined
      });
      const releasedReservedUsd = derivedSettlement.releasedReservedUsd;
      const grossReturnedUsd = derivedSettlement.grossReturnedUsd;
      if (releasedReservedUsd > onchainMasterSettlementState.principalOutstanding + 0.0000001) {
        throw new Error("bot_vault_released_reserved_exceeds_outstanding");
      }
      if (grossReturnedUsd > releasedReservedUsd + onchainMasterSettlementState.tokenSurplus + 0.0000001) {
        throw new Error("bot_vault_gross_return_exceeds_limit");
      }
      if (grossReturnedUsd <= 0 && releasedReservedUsd <= 0) throw new Error("invalid_amount_usd");
      const releasedReservedAtomic = toAtomicUsdNonNegative(releasedReservedUsd);
      const grossReturnedAtomic = toAtomicUsd(grossReturnedUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:claim_bot_vault:${params.botVaultId}:${releasedReservedUsd}:${grossReturnedUsd}`
      );

      const txRequest = await provider.buildClaimFromBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        releasedReservedAtomic,
        grossReturnedAtomic
      });
      const settlementPreview = computeSettlementPreview({
        contractVersion: profile.contractVersion,
        treasuryPayoutModel: profile.treasuryPayoutModel,
        treasuryRecipient: profile.treasuryRecipient,
        feeRatePct: profile.feeRatePct,
        releasedReservedUsd,
        grossReturnedUsd,
        realizedPnlNetUsd: Number(botVault.realizedPnlNet ?? botVault.realizedNetUsd ?? 0),
        highWaterMarkUsd: Number(botVault.highWaterMark ?? 0)
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
          releasedReservedUsd,
          returnedToFreeUsd: profile.usesGrossReturnSemantics
            ? settlementPreview.netReturnedUsd
            : grossReturnedUsd,
          grossReturnedUsd,
          feeRatePct: profile.feeRatePct,
          contractVersion: profile.contractVersion,
          treasuryPayoutModel: profile.treasuryPayoutModel,
          treasuryRecipient: profile.treasuryRecipient,
          settlementPreview,
          defaults: derivedSettlement.defaults,
          limits: derivedSettlement.limits,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest,
        settlementPreview
      };
    });
  }

  async function buildCloseBotVault(params: {
    userId: string;
    botVaultId: string;
    releasedReservedUsd?: number;
    returnedToFreeUsd?: number;
    grossReturnedUsd?: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: { id: params.botVaultId, userId: params.userId },
        select: {
          id: true,
          masterVaultId: true,
          vaultAddress: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          realizedNetUsd: true,
          highWaterMark: true,
          availableUsd: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const profile = await resolveTreasuryContractProfile({
        mode,
        masterVaultAddress: masterAddress as `0x${string}`
      });
      const requestedGrossReturnedUsd = Number(
        profile.usesGrossReturnSemantics
          ? params.grossReturnedUsd ?? params.returnedToFreeUsd ?? 0
          : params.returnedToFreeUsd ?? params.grossReturnedUsd ?? 0
      );
      const client = createOnchainPublicClient(addressBook);
      const [onchainBotVaultState, onchainMasterSettlementState] = await Promise.all([
        readBotVaultState(client, botVaultAddress as `0x${string}`),
        readMasterVaultSettlementState(
          client,
          masterAddress as `0x${string}`,
          botVaultAddress as `0x${string}`
        )
      ]);
      const onchainStatus = mapBotVaultOnchainStatus(onchainBotVaultState.status);
      const derivedSettlement = deriveCloseBotVaultSettlement({
        dbAvailableUsd: Number(botVault.availableUsd ?? 0),
        dbPrincipalAllocatedUsd: Number(botVault.principalAllocated ?? 0),
        dbPrincipalReturnedUsd: Number(botVault.principalReturned ?? 0),
        onchainPrincipalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
        onchainReservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
        onchainTokenSurplusUsd: onchainMasterSettlementState.tokenSurplus,
        requestedReleasedReservedUsd: params.releasedReservedUsd,
        requestedGrossReturnedUsd: requestedGrossReturnedUsd > 0 ? requestedGrossReturnedUsd : undefined
      });
      const releasedReservedUsd = derivedSettlement.releasedReservedUsd;
      const grossReturnedUsd = derivedSettlement.grossReturnedUsd;
      assertCloseBotVaultPreflight({
        onchainStatus,
        releasedReservedUsd,
        grossReturnedUsd,
        principalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
        reservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
        tokenSurplusUsd: onchainMasterSettlementState.tokenSurplus
      });
      const releasedReservedAtomic = toAtomicUsdNonNegative(releasedReservedUsd);
      const grossReturnedAtomic = toAtomicUsdNonNegative(grossReturnedUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:close_bot_vault:${params.botVaultId}:${releasedReservedUsd}:${grossReturnedUsd}`
      );

      const txRequest = await provider.buildCloseBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        releasedReservedAtomic,
        grossReturnedAtomic
      });
      const settlementPreview = computeSettlementPreview({
        contractVersion: profile.contractVersion,
        treasuryPayoutModel: profile.treasuryPayoutModel,
        treasuryRecipient: profile.treasuryRecipient,
        feeRatePct: profile.feeRatePct,
        releasedReservedUsd,
        grossReturnedUsd,
        realizedPnlNetUsd: Number(botVault.realizedPnlNet ?? botVault.realizedNetUsd ?? 0),
        highWaterMarkUsd: Number(botVault.highWaterMark ?? 0)
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
          releasedReservedUsd,
          returnedToFreeUsd: profile.usesGrossReturnSemantics
            ? settlementPreview.netReturnedUsd
            : grossReturnedUsd,
          grossReturnedUsd,
          feeRatePct: profile.feeRatePct,
          contractVersion: profile.contractVersion,
          treasuryPayoutModel: profile.treasuryPayoutModel,
          treasuryRecipient: profile.treasuryRecipient,
          settlementPreview,
          preflight: {
            onchainStatus,
            principalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
            reservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
            tokenSurplusUsd: onchainMasterSettlementState.tokenSurplus
          },
          defaults: derivedSettlement.defaults,
          limits: derivedSettlement.limits,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest,
        settlementPreview
      };
    });
  }

  async function buildRecoverClosedBotVault(params: {
    userId: string;
    botVaultId: string;
    releasedReservedUsd?: number;
    returnedToFreeUsd?: number;
    grossReturnedUsd?: number;
    actionKey?: string;
  }) {
    const mode = await requireOnchainMode();
    const defaultAddressBook = resolveOnchainAddressBook({ mode, contractVersion: "v1" });
    const provider = createOnchainProvider(defaultAddressBook);

    return db.$transaction(async (tx: any) => {
      const botVault = await tx.botVault.findFirst({
        where: { id: params.botVaultId, userId: params.userId },
        select: {
          id: true,
          masterVaultId: true,
          vaultAddress: true,
          principalAllocated: true,
          principalReturned: true,
          realizedPnlNet: true,
          realizedNetUsd: true,
          highWaterMark: true,
          availableUsd: true
        }
      });
      if (!botVault) throw new Error("bot_vault_not_found");
      const botVaultAddress = String(botVault.vaultAddress ?? "").trim();
      if (!botVaultAddress || !isAddress(botVaultAddress)) throw new Error("bot_vault_onchain_address_missing");

      const masterVault = await tx.masterVault.findUnique({ where: { id: botVault.masterVaultId } });
      if (!masterVault) throw new Error("master_vault_not_found");
      const contractVersion = normalizeOnchainContractVersion(masterVault.contractVersion, "v1");
      if (contractVersion !== "v2") {
        throw new Error("unrecoverable_closed_vault");
      }
      const addressBook = resolveOnchainAddressBook({ mode, contractVersion });
      const provider = createOnchainProvider(addressBook);
      const masterAddress = String(masterVault.onchainAddress ?? "").trim();
      if (!masterAddress || !isAddress(masterAddress)) throw new Error("master_vault_onchain_address_missing");

      const profile = await resolveTreasuryContractProfile({
        mode,
        masterVaultAddress: masterAddress as `0x${string}`,
        contractVersion
      });
      const requestedGrossReturnedUsd = Number(
        profile.usesGrossReturnSemantics
          ? params.grossReturnedUsd ?? params.returnedToFreeUsd ?? 0
          : params.returnedToFreeUsd ?? params.grossReturnedUsd ?? 0
      );
      const client = createOnchainPublicClient(addressBook);
      const [onchainBotVaultState, onchainMasterSettlementState] = await Promise.all([
        readBotVaultState(client, botVaultAddress as `0x${string}`),
        readMasterVaultSettlementState(
          client,
          masterAddress as `0x${string}`,
          botVaultAddress as `0x${string}`
        )
      ]);
      const onchainStatus = mapBotVaultOnchainStatus(onchainBotVaultState.status);
      const derivedSettlement = deriveCloseBotVaultSettlement({
        dbAvailableUsd: Number(botVault.availableUsd ?? 0),
        dbPrincipalAllocatedUsd: Number(botVault.principalAllocated ?? 0),
        dbPrincipalReturnedUsd: Number(botVault.principalReturned ?? 0),
        onchainPrincipalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
        onchainReservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
        onchainTokenSurplusUsd: onchainMasterSettlementState.tokenSurplus,
        requestedReleasedReservedUsd: params.releasedReservedUsd,
        requestedGrossReturnedUsd: requestedGrossReturnedUsd > 0 ? requestedGrossReturnedUsd : undefined
      });
      const releasedReservedUsd = derivedSettlement.releasedReservedUsd;
      const grossReturnedUsd = derivedSettlement.grossReturnedUsd;
      assertRecoverClosedBotVaultPreflight({
        onchainStatus,
        releasedReservedUsd,
        grossReturnedUsd,
        principalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
        reservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
        tokenSurplusUsd: onchainMasterSettlementState.tokenSurplus
      });
      const releasedReservedAtomic = toAtomicUsdNonNegative(releasedReservedUsd);
      const grossReturnedAtomic = toAtomicUsdNonNegative(grossReturnedUsd);
      const actionKey = normalizeActionKey(
        params.actionKey,
        `onchain:recover_closed_bot_vault:${params.botVaultId}:${releasedReservedUsd}:${grossReturnedUsd}`
      );

      const txRequest = await provider.buildRecoverClosedBotVaultTx({
        masterVaultAddress: masterAddress as `0x${string}`,
        botVaultAddress: botVaultAddress as `0x${string}`,
        releasedReservedAtomic,
        grossReturnedAtomic
      });
      const settlementPreview = computeSettlementPreview({
        contractVersion: profile.contractVersion,
        treasuryPayoutModel: profile.treasuryPayoutModel,
        treasuryRecipient: profile.treasuryRecipient,
        feeRatePct: profile.feeRatePct,
        releasedReservedUsd,
        grossReturnedUsd,
        realizedPnlNetUsd: Number(botVault.realizedPnlNet ?? botVault.realizedNetUsd ?? 0),
        highWaterMarkUsd: Number(botVault.highWaterMark ?? 0)
      });

      const action = await ensureAction({
        tx,
        actionKey,
        actionType: "recover_closed_bot_vault",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: String(botVault.id),
        txRequest,
        metadata: {
          releasedReservedUsd,
          returnedToFreeUsd: profile.usesGrossReturnSemantics
            ? settlementPreview.netReturnedUsd
            : grossReturnedUsd,
          grossReturnedUsd,
          feeRatePct: profile.feeRatePct,
          contractVersion: profile.contractVersion,
          treasuryPayoutModel: profile.treasuryPayoutModel,
          treasuryRecipient: profile.treasuryRecipient,
          settlementPreview,
          preflight: {
            onchainStatus,
            principalOutstandingUsd: onchainMasterSettlementState.principalOutstanding,
            reservedBalanceUsd: onchainMasterSettlementState.reservedBalance,
            tokenSurplusUsd: onchainMasterSettlementState.tokenSurplus
          },
          defaults: derivedSettlement.defaults,
          limits: derivedSettlement.limits,
          mode
        }
      });

      return {
        mode,
        action: mapActionRow(action),
        txRequest,
        settlementPreview
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
    buildWithdrawFromMasterVault,
    buildCreateBotVault,
    buildReserveForBotVault,
    buildFundBotVaultOnHyperCore,
    buildSetBotVaultCloseOnly,
    buildSetBotVaultAgentWallet,
    buildSetTreasuryRecipient,
    buildSetProfitShareFeeRate,
    buildClaimFromBotVault,
    buildCloseBotVault,
    buildRecoverClosedBotVault,
    submitActionTxHash,
    markActionConfirmedByTxHash,
    listActionsForUser
  };
}

export type OnchainActionService = ReturnType<typeof createOnchainActionService>;
