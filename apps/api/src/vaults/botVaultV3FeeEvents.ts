import {
  createAffiliateAccrualFromFeeEventIfEligible,
  decorateFeeEventMetadataWithAffiliateContext,
  readLockedAffiliateFeeConfig
} from "../affiliate/program.js";
import { normalizeOnchainContractVersion } from "./onchainAddressBook.js";
import {
  ONCHAIN_AFFILIATE_DIRECT_SPLIT_PAYOUT_MODEL,
  ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
  ONCHAIN_TREASURY_CONTRACT_VERSION_V4,
  ONCHAIN_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";

export type BotVaultV3ProfitShareFeeEventSourceAction =
  | "claim_profit"
  | "close_vault"
  | "recover_closed_funds";

export type CreateBotVaultV3ProfitShareFeeEventParams = {
  dbClient?: any;
  botVaultId: string;
  sourceKey: string;
  profitBaseUsd: number;
  feeAmountUsd: number;
  treasuryRecipient: string | null;
  feeRatePct: number;
  txHash: string | null;
  sourceAction: BotVaultV3ProfitShareFeeEventSourceAction;
  grossAmountUsd: number;
  netReturnedUsd: number;
  excludedPrincipalUsd: number;
};

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readBotVaultV4CreateAccountingFeeMaxUsd(): number {
  const parsed = Number(process.env.BOT_VAULT_V4_CREATE_ACCOUNTING_FEE_MAX_USD ?? "1");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

export function createBotVaultV3FeeEventService(db: any) {
  async function readHypercoreAccountingFeeUsdForBotVault(params: {
    botVaultId: string;
    executionMetadata?: unknown;
  }): Promise<number> {
    const executionMetadata = toRecord(params.executionMetadata);
    const metadataFeeUsd = roundUsd(
      toNonNegativeNumber(executionMetadata.hypercoreAccountingFeeUsd),
      6
    );
    if (metadataFeeUsd > 0) return metadataFeeUsd;
    const maxCreateAccountingFeeUsd = readBotVaultV4CreateAccountingFeeMaxUsd();
    if (maxCreateAccountingFeeUsd > 0 && typeof db?.botVault?.findUnique === "function") {
      const row = await db.botVault.findUnique({
        where: { id: params.botVaultId },
        select: {
          principalAllocated: true,
          gridInstance: {
            select: {
              investUsd: true,
              extraMarginUsd: true
            }
          }
        }
      }).catch(() => null);
      const principalAllocatedUsd = toNonNegativeNumber(row?.principalAllocated);
      const gridFundingUsd = roundUsd(
        toNonNegativeNumber(row?.gridInstance?.investUsd) + toNonNegativeNumber(row?.gridInstance?.extraMarginUsd),
        6
      );
      const impliedCreateAccountingFeeUsd = roundUsd(principalAllocatedUsd - gridFundingUsd, 6);
      if (
        impliedCreateAccountingFeeUsd > 0.000001
        && impliedCreateAccountingFeeUsd <= maxCreateAccountingFeeUsd + 0.000001
      ) {
        return impliedCreateAccountingFeeUsd;
      }
    }
    if (!db?.feeEvent?.findMany) return 0;
    const rows = await db.feeEvent.findMany({
      where: {
        botVaultId: params.botVaultId,
        eventType: "ADJUSTMENT"
      },
      select: {
        feeAmount: true,
        metadata: true
      }
    });
    let totalFeeUsd = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const metadata = toRecord(row?.metadata);
      if (String(metadata.source ?? "") !== "hypercore_account_creation") continue;
      totalFeeUsd += toNonNegativeNumber(row?.feeAmount);
    }
    return roundUsd(totalFeeUsd, 6);
  }

  async function findProfitShareFeeEventBySourceKey(params: {
    dbClient?: any;
    sourceKey: string;
  }): Promise<any | null> {
    const feeDb = params.dbClient ?? db;
    if (!params.sourceKey) return null;
    if (typeof feeDb?.feeEvent?.findUnique === "function") {
      return feeDb.feeEvent.findUnique({
        where: { sourceKey: params.sourceKey }
      });
    }
    if (typeof feeDb?.feeEvent?.findFirst === "function") {
      return feeDb.feeEvent.findFirst({
        where: { sourceKey: params.sourceKey }
      });
    }
    return null;
  }

  async function findBotVaultOwnerUserId(params: {
    dbClient?: any;
    botVaultId: string;
  }): Promise<string | null> {
    const feeDb = params.dbClient ?? db;
    if (!params.botVaultId) return null;
    if (typeof feeDb?.botVault?.findUnique === "function") {
      const row = await feeDb.botVault.findUnique({
        where: { id: params.botVaultId },
        select: { userId: true }
      });
      return toNullableString(row?.userId);
    }
    if (typeof feeDb?.botVault?.findFirst === "function") {
      const row = await feeDb.botVault.findFirst({
        where: { id: params.botVaultId },
        select: { userId: true }
      });
      return toNullableString(row?.userId);
    }
    return null;
  }

  async function findBotVaultExecutionMetadata(params: {
    dbClient?: any;
    botVaultId: string;
  }): Promise<Record<string, unknown>> {
    const feeDb = params.dbClient ?? db;
    if (!params.botVaultId) return {};
    if (typeof feeDb?.botVault?.findUnique === "function") {
      const row = await feeDb.botVault.findUnique({
        where: { id: params.botVaultId },
        select: { executionMetadata: true }
      });
      return toRecord(row?.executionMetadata);
    }
    if (typeof feeDb?.botVault?.findFirst === "function") {
      const row = await feeDb.botVault.findFirst({
        where: { id: params.botVaultId },
        select: { executionMetadata: true }
      });
      return toRecord(row?.executionMetadata);
    }
    return {};
  }

  async function createProfitShareFeeEventIfNew(
    params: CreateBotVaultV3ProfitShareFeeEventParams
  ): Promise<"skipped" | "created" | "existing"> {
    const feeDb = params.dbClient ?? db;
    if (params.feeAmountUsd <= 0) return "skipped";
    const sourceKey = toNullableString(params.sourceKey);
    if (!sourceKey) {
      throw new Error(`bot_vault_v3_fee_event_source_key_missing:${params.sourceAction}:${params.botVaultId}`);
    }

    const existingBeforeCreate = await findProfitShareFeeEventBySourceKey({
      dbClient: feeDb,
      sourceKey
    });
    if (existingBeforeCreate) {
      await createAffiliateAccrualFromFeeEventIfEligible({
        dbClient: feeDb,
        feeEvent: existingBeforeCreate
      });
      return "existing";
    }

    if (!feeDb?.feeEvent?.create) {
      throw new Error(`bot_vault_v3_fee_event_persistence_unavailable:${params.sourceAction}:${params.botVaultId}`);
    }

    const referredUserId = await findBotVaultOwnerUserId({
      dbClient: feeDb,
      botVaultId: params.botVaultId
    });
    const executionMetadata = toRecord(await findBotVaultExecutionMetadata({
      dbClient: feeDb,
      botVaultId: params.botVaultId
    }));
    const lockedFeeConfig = readLockedAffiliateFeeConfig(executionMetadata);
    const contractVersion = normalizeOnchainContractVersion(executionMetadata.onchainContractVersion, "v3");
    const metadata = await decorateFeeEventMetadataWithAffiliateContext({
      dbClient: feeDb,
      referredUserId: referredUserId ?? "",
      feeAmountUsd: roundUsd(params.feeAmountUsd, 6),
      totalFeeRatePct: params.feeRatePct,
      metadata: {
        treasuryPayoutModel: ONCHAIN_TREASURY_PAYOUT_MODEL,
        contractVersion: contractVersion === "v4"
          ? ONCHAIN_TREASURY_CONTRACT_VERSION_V4
          : ONCHAIN_TREASURY_CONTRACT_VERSION_V3,
        onchainPayoutModel: contractVersion === "v4"
          ? ONCHAIN_AFFILIATE_DIRECT_SPLIT_PAYOUT_MODEL
          : ONCHAIN_TREASURY_PAYOUT_MODEL,
        treasuryRecipient: params.treasuryRecipient,
        feeRatePct: params.feeRatePct,
        txHash: params.txHash ?? null,
        sourceAction: params.sourceAction,
        grossAmountUsd: roundUsd(params.grossAmountUsd, 6),
        netReturnedUsd: roundUsd(params.netReturnedUsd, 6),
        netAmountUsd: roundUsd(params.netReturnedUsd, 6),
        excludedPrincipalUsd: roundUsd(params.excludedPrincipalUsd, 6),
        beneficiary: toNullableString(executionMetadata.beneficiaryAddress) ?? null,
        ...(lockedFeeConfig ?? {})
      }
    });
    metadata.platformFeeAmountUsd = metadata.platformAmountUsd;
    metadata.affiliateFeeAmountUsd = metadata.affiliateAmountUsd;

    try {
      const created = await feeDb.feeEvent.create({
        data: {
          botVaultId: params.botVaultId,
          eventType: "PROFIT_SHARE",
          profitBase: roundUsd(params.profitBaseUsd, 6),
          feeAmount: roundUsd(params.feeAmountUsd, 6),
          sourceKey,
          metadata
        }
      });
      await createAffiliateAccrualFromFeeEventIfEligible({
        dbClient: feeDb,
        feeEvent: created
      });
      return "created";
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existingAfterUnique = await findProfitShareFeeEventBySourceKey({
        dbClient: feeDb,
        sourceKey
      });
      if (existingAfterUnique) {
        await createAffiliateAccrualFromFeeEventIfEligible({
          dbClient: feeDb,
          feeEvent: existingAfterUnique
        });
        return "existing";
      }
      throw new Error(`bot_vault_v3_fee_event_duplicate_without_record:${params.sourceAction}:${params.botVaultId}:${sourceKey}`);
    }
  }

  return {
    createProfitShareFeeEventIfNew,
    readHypercoreAccountingFeeUsdForBotVault
  };
}
