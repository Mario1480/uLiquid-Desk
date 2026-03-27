import { getAddress, isAddress } from "viem";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "./executionMode.js";
import { resolveAllOnchainAddressBooks } from "./onchainAddressBook.js";
import { DEFAULT_SETTLEMENT_FEE_RATE_PCT } from "./feeSettlement.math.js";
import {
  createOnchainPublicClient,
  readFactoryProfitShareFeeRatePct,
  readFactoryTreasuryRecipient
} from "./onchainProvider.js";

export const GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY = "admin.vaultProfitShareTreasury.v1";
export const ONCHAIN_TREASURY_PAYOUT_MODEL = "onchain_treasury_v1";
export const LEGACY_TREASURY_PAYOUT_MODEL = "legacy_no_treasury_payout";
export const ONCHAIN_TREASURY_CONTRACT_VERSION = "master_vault_treasury_v2";
export const LEGACY_TREASURY_CONTRACT_VERSION = "master_vault_legacy_v1";

export type VaultProfitShareTreasurySyncStatus =
  | "missing"
  | "pending"
  | "ready"
  | "drifted"
  | "invalid";

export type VaultProfitShareTreasurySettings = {
  enabled: boolean;
  walletAddress: string | null;
  feeRatePct: number;
  updatedAt: string | null;
  onchainSyncStatus: VaultProfitShareTreasurySyncStatus;
  onchainRecipient: string | null;
  onchainFeeRatePct: number | null;
  feeRateSyncStatus: VaultProfitShareTreasurySyncStatus;
  lastSyncActionId: string | null;
  lastSyncTxHash: string | null;
  onchainFactories?: Array<{
    contractVersion: string;
    factoryAddress: string;
    recipient: string | null;
    feeRatePct: number | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeTreasuryWalletAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!isAddress(raw)) return null;
  return getAddress(raw);
}

export function parseStoredVaultProfitShareTreasurySettings(value: unknown): {
  enabled: boolean;
  walletAddress: string | null;
  feeRatePct: number;
} {
  const record = asRecord(value);
  const feeRatePct = Number(record.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT);
  return {
    enabled: Boolean(record.enabled),
    walletAddress: normalizeTreasuryWalletAddress(record.walletAddress),
    feeRatePct: Number.isInteger(feeRatePct) && feeRatePct >= 0 && feeRatePct <= 100
      ? feeRatePct
      : DEFAULT_SETTLEMENT_FEE_RATE_PCT
  };
}

export function normalizeProfitShareFeeRatePct(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

async function readOnchainTreasuryState(db: any): Promise<{
  recipient: string | null;
  feeRatePct: number | null;
  factories: Array<{
    contractVersion: string;
    factoryAddress: string;
    recipient: string | null;
    feeRatePct: number | null;
  }>;
}> {
  const mode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow" as const);
  if (!isOnchainMode(mode)) return { recipient: null, feeRatePct: null, factories: [] };
  const addressBooks = resolveAllOnchainAddressBooks(mode as any);
  const factories = await Promise.all(
    addressBooks.map(async (addressBook) => {
      const client = createOnchainPublicClient(addressBook);
      const [recipient, feeRatePct] = await Promise.all([
        readFactoryTreasuryRecipient(client, addressBook.factoryAddress),
        readFactoryProfitShareFeeRatePct(client, addressBook.factoryAddress)
      ]);
      return {
        contractVersion: addressBook.contractVersion,
        factoryAddress: addressBook.factoryAddress,
        recipient: recipient ? getAddress(recipient) : null,
        feeRatePct: normalizeProfitShareFeeRatePct(feeRatePct)
      };
    })
  );
  const preferred = factories.find((entry) => entry.contractVersion === "v2") ?? factories[0] ?? null;
  return {
    recipient: preferred?.recipient ?? null,
    feeRatePct: preferred?.feeRatePct ?? null,
    factories
  };
}

function normalizeActionRecipient(action: any): string | null {
  const metadata = asRecord(action?.metadata);
  return normalizeTreasuryWalletAddress(metadata.requestedRecipient ?? metadata.treasuryRecipient);
}

function normalizeActionFeeRate(action: any): number | null {
  const metadata = asRecord(action?.metadata);
  return normalizeProfitShareFeeRatePct(metadata.requestedFeeRatePct ?? metadata.feeRatePct);
}

export async function getVaultProfitShareTreasurySettings(db: any): Promise<VaultProfitShareTreasurySettings> {
  const [row, recentActions, onchainState] = await Promise.all([
    db.globalSetting.findUnique({
      where: { key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY },
      select: { value: true, updatedAt: true }
    }),
    db.onchainAction.findMany({
      where: {
        actionType: {
          in: ["set_treasury_recipient", "set_profit_share_fee_rate"]
        }
      },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        txHash: true,
        status: true,
        metadata: true
      }
    }).catch(() => []),
    readOnchainTreasuryState(db).catch(() => ({ recipient: null, feeRatePct: null, factories: [] }))
  ]);

  const stored = parseStoredVaultProfitShareTreasurySettings(row?.value);
  const walletAddress = stored.walletAddress;
  const feeRatePct = stored.feeRatePct;
  const normalizedOnchainRecipient = normalizeTreasuryWalletAddress(onchainState.recipient);
  const normalizedOnchainFeeRatePct = normalizeProfitShareFeeRatePct(onchainState.feeRatePct);
  const normalizedFactoryRecipients = onchainState.factories.map((entry) => normalizeTreasuryWalletAddress(entry.recipient));
  const normalizedFactoryFeeRates = onchainState.factories.map((entry) => normalizeProfitShareFeeRatePct(entry.feeRatePct));
  const recentRecipientActions = recentActions.filter((action: any) => String(action.actionType) === "set_treasury_recipient");
  const recentFeeRateActions = recentActions.filter((action: any) => String(action.actionType) === "set_profit_share_fee_rate");
  const latestMatchingRecipientAction =
    recentRecipientActions.find((action: any) => normalizeActionRecipient(action) === walletAddress) ?? null;
  const latestMatchingFeeRateAction =
    recentFeeRateActions.find((action: any) => normalizeActionFeeRate(action) === feeRatePct) ?? null;
  const latestAction = latestMatchingRecipientAction ?? latestMatchingFeeRateAction ?? recentActions[0] ?? null;

  let onchainSyncStatus: VaultProfitShareTreasurySyncStatus = "missing";
  if (stored.enabled && !walletAddress) {
    onchainSyncStatus = "invalid";
  } else if (!stored.enabled || !walletAddress) {
    onchainSyncStatus = "missing";
  } else if (normalizedFactoryRecipients.length > 0 && normalizedFactoryRecipients.every((entry) => entry === walletAddress)) {
    onchainSyncStatus = "ready";
  } else if (latestMatchingRecipientAction && latestMatchingRecipientAction.status !== "failed") {
    onchainSyncStatus = "pending";
  } else if (normalizedFactoryRecipients.some(Boolean)) {
    onchainSyncStatus = "drifted";
  } else {
    onchainSyncStatus = "pending";
  }

  let feeRateSyncStatus: VaultProfitShareTreasurySyncStatus = "missing";
  if (!stored.enabled) {
    feeRateSyncStatus = "missing";
  } else if (normalizeProfitShareFeeRatePct(feeRatePct) == null) {
    feeRateSyncStatus = "invalid";
  } else if (normalizedFactoryFeeRates.length > 0 && normalizedFactoryFeeRates.every((entry) => entry === feeRatePct)) {
    feeRateSyncStatus = "ready";
  } else if (latestMatchingFeeRateAction && latestMatchingFeeRateAction.status !== "failed") {
    feeRateSyncStatus = "pending";
  } else if (normalizedFactoryFeeRates.some((entry) => entry != null)) {
    feeRateSyncStatus = "drifted";
  } else {
    feeRateSyncStatus = "pending";
  }

  return {
    enabled: stored.enabled,
    walletAddress,
    feeRatePct,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    onchainSyncStatus,
    onchainRecipient: normalizedOnchainRecipient,
    onchainFeeRatePct: normalizedOnchainFeeRatePct,
    feeRateSyncStatus,
    lastSyncActionId: latestAction?.id ? String(latestAction.id) : null,
    lastSyncTxHash: latestAction?.txHash ? String(latestAction.txHash) : null,
    onchainFactories: onchainState.factories
  };
}

export async function setVaultProfitShareTreasurySettings(
  db: any,
  input: { enabled?: boolean; walletAddress?: string | null; feeRatePct?: number | null }
): Promise<VaultProfitShareTreasurySettings> {
  const enabled = Boolean(input.enabled);
  const walletAddress = normalizeTreasuryWalletAddress(input.walletAddress);
  const feeRatePct = normalizeProfitShareFeeRatePct(input.feeRatePct ?? DEFAULT_SETTLEMENT_FEE_RATE_PCT);
  if (enabled && !walletAddress) {
    throw new Error("invalid_treasury_wallet_address");
  }
  if (feeRatePct == null) {
    throw new Error("invalid_profit_share_fee_rate_pct");
  }

  await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY },
    create: {
      key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY,
      value: {
        enabled,
        walletAddress,
        feeRatePct
      }
    },
    update: {
      value: {
        enabled,
        walletAddress,
        feeRatePct
      }
    }
  });

  return getVaultProfitShareTreasurySettings(db);
}
