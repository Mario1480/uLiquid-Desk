import { getAddress, isAddress } from "viem";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "./executionMode.js";
import { resolveOnchainAddressBook } from "./onchainAddressBook.js";
import { createOnchainPublicClient, readFactoryTreasuryRecipient } from "./onchainProvider.js";

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
  updatedAt: string | null;
  onchainSyncStatus: VaultProfitShareTreasurySyncStatus;
  onchainRecipient: string | null;
  lastSyncActionId: string | null;
  lastSyncTxHash: string | null;
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
} {
  const record = asRecord(value);
  return {
    enabled: Boolean(record.enabled),
    walletAddress: normalizeTreasuryWalletAddress(record.walletAddress)
  };
}

async function readOnchainRecipient(db: any): Promise<string | null> {
  const mode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow" as const);
  if (!isOnchainMode(mode)) return null;
  const addressBook = resolveOnchainAddressBook(mode as any);
  const client = createOnchainPublicClient(addressBook);
  const recipient = await readFactoryTreasuryRecipient(client, addressBook.factoryAddress);
  return recipient ? getAddress(recipient) : null;
}

function normalizeActionRecipient(action: any): string | null {
  const metadata = asRecord(action?.metadata);
  return normalizeTreasuryWalletAddress(metadata.requestedRecipient ?? metadata.treasuryRecipient);
}

export async function getVaultProfitShareTreasurySettings(db: any): Promise<VaultProfitShareTreasurySettings> {
  const [row, recentActions, onchainRecipient] = await Promise.all([
    db.globalSetting.findUnique({
      where: { key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY },
      select: { value: true, updatedAt: true }
    }),
    db.onchainAction.findMany({
      where: { actionType: "set_treasury_recipient" },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        txHash: true,
        status: true,
        metadata: true
      }
    }).catch(() => []),
    readOnchainRecipient(db).catch(() => null)
  ]);

  const stored = parseStoredVaultProfitShareTreasurySettings(row?.value);
  const walletAddress = stored.walletAddress;
  const normalizedOnchainRecipient = normalizeTreasuryWalletAddress(onchainRecipient);
  const latestMatchingAction = recentActions.find((action: any) => normalizeActionRecipient(action) === walletAddress) ?? null;
  const latestAction = latestMatchingAction ?? recentActions[0] ?? null;

  let onchainSyncStatus: VaultProfitShareTreasurySyncStatus = "missing";
  if (stored.enabled && !walletAddress) {
    onchainSyncStatus = "invalid";
  } else if (!stored.enabled || !walletAddress) {
    onchainSyncStatus = "missing";
  } else if (normalizedOnchainRecipient && normalizedOnchainRecipient === walletAddress) {
    onchainSyncStatus = "ready";
  } else if (latestMatchingAction && latestMatchingAction.status !== "failed") {
    onchainSyncStatus = "pending";
  } else if (normalizedOnchainRecipient) {
    onchainSyncStatus = "drifted";
  } else {
    onchainSyncStatus = "pending";
  }

  return {
    enabled: stored.enabled,
    walletAddress,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    onchainSyncStatus,
    onchainRecipient: normalizedOnchainRecipient,
    lastSyncActionId: latestAction?.id ? String(latestAction.id) : null,
    lastSyncTxHash: latestAction?.txHash ? String(latestAction.txHash) : null
  };
}

export async function setVaultProfitShareTreasurySettings(
  db: any,
  input: { enabled?: boolean; walletAddress?: string | null }
): Promise<VaultProfitShareTreasurySettings> {
  const enabled = Boolean(input.enabled);
  const walletAddress = normalizeTreasuryWalletAddress(input.walletAddress);
  if (enabled && !walletAddress) {
    throw new Error("invalid_treasury_wallet_address");
  }

  await db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY },
    create: {
      key: GLOBAL_SETTING_VAULT_PROFIT_SHARE_TREASURY_KEY,
      value: {
        enabled,
        walletAddress
      }
    },
    update: {
      value: {
        enabled,
        walletAddress
      }
    }
  });

  return getVaultProfitShareTreasurySettings(db);
}
