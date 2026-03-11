import { bookVaultLedgerEntry } from "./ledger.js";
import {
  computeFeeSettlementMath,
  type FeeSettlementMathResult
} from "./feeSettlement.math.js";
import { createMasterVaultService, type MasterVaultService } from "./masterVault.service.js";
import { roundUsd } from "./profitShare.js";
import {
  createBotVaultTradingReconciliationService,
  type BotVaultTradingReconciliationService
} from "./tradingReconciliation.service.js";
import { logger as defaultLogger } from "../logger.js";
import {
  LEGACY_TREASURY_CONTRACT_VERSION,
  LEGACY_TREASURY_PAYOUT_MODEL
} from "./profitShareTreasury.settings.js";

type CreateFeeSettlementServiceDeps = {
  masterVaultService?: MasterVaultService | null;
  tradingReconciliationService?: BotVaultTradingReconciliationService | null;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

type BaseSettleParams = {
  userId: string;
  botVaultId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type SettleProfitWithdrawParams = BaseSettleParams & {
  requestedGrossUsd: number;
};

type SettleFinalCloseParams = BaseSettleParams;

type PreviewInput = {
  mode: "PROFIT_ONLY_WITHDRAW" | "FINAL_CLOSE";
  requestedGrossUsd?: number;
  availableUsd: number;
  principalAllocatedUsd: number;
  principalReturnedUsd: number;
  realizedPnlNetUsd: number;
  highWaterMarkUsd: number;
  feeRatePct?: number;
};

export type FeeSettlementResult = {
  settlementBreakdown: FeeSettlementMathResult;
  botVaultSnapshotAfter: any;
};

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key) throw new Error("invalid_idempotency_key");
  return key;
}

function toPositiveAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return roundUsd(parsed, 6);
}

function toNonNegativeAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundUsd(parsed, 6);
}

function parseSettlementFromMetadata(value: unknown): FeeSettlementMathResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const settlement = (value as Record<string, unknown>).settlement;
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) return null;
  const row = settlement as Record<string, unknown>;
  if (typeof row.mode !== "string") return null;
  if (!Number.isFinite(Number(row.grossTransferUsd))) return null;
  return row as unknown as FeeSettlementMathResult;
}

async function findBotVaultForUser(tx: any, userId: string, botVaultId: string): Promise<any | null> {
  if (tx?.botVault?.findFirst) {
    return tx.botVault.findFirst({
      where: {
        id: botVaultId,
        userId
      }
    });
  }
  const row = await tx.botVault.findUnique({ where: { id: botVaultId } });
  if (!row) return null;
  if (String(row.userId) !== String(userId)) return null;
  return row;
}

async function findLedgerBySourceKey(tx: any, sourceKey: string): Promise<any | null> {
  if (tx?.vaultLedgerEntry?.findUnique) {
    return tx.vaultLedgerEntry.findUnique({ where: { sourceKey } });
  }
  if (tx?.vaultLedgerEntry?.findFirst) {
    return tx.vaultLedgerEntry.findFirst({ where: { sourceKey } });
  }
  if (tx?.vaultLedgerEntry?.findMany) {
    const rows = await tx.vaultLedgerEntry.findMany({ where: { sourceKey }, take: 1 });
    return rows?.[0] ?? null;
  }
  return null;
}

async function createFeeEventIfNew(params: {
  tx: any;
  botVaultId: string;
  sourceKey: string;
  profitBase: number;
  feeAmount: number;
  metadata?: Record<string, unknown>;
}) {
  if (!params.tx?.feeEvent?.create) return;
  try {
    await params.tx.feeEvent.create({
      data: {
        botVaultId: params.botVaultId,
        eventType: "PROFIT_SHARE",
        profitBase: params.profitBase,
        feeAmount: params.feeAmount,
        sourceKey: params.sourceKey,
        metadata: params.metadata ?? null
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

export function createFeeSettlementService(db: any, deps?: CreateFeeSettlementServiceDeps) {
  const masterVaultService = deps?.masterVaultService ?? createMasterVaultService(db);
  const tradingReconciliationService = deps?.tradingReconciliationService ?? createBotVaultTradingReconciliationService(db);
  const logger = deps?.logger ?? defaultLogger;

  async function withTx<T>(tx: any | undefined, run: (tx: any) => Promise<T>): Promise<T> {
    if (tx) return run(tx);
    return db.$transaction(async (dbTx: any) => run(dbTx));
  }

  function preview(input: PreviewInput): FeeSettlementMathResult {
    const principalOutstandingUsd = toNonNegativeAmount(input.principalAllocatedUsd - input.principalReturnedUsd);
    return computeFeeSettlementMath({
      mode: input.mode,
      requestedGrossUsd: input.requestedGrossUsd,
      availableUsd: input.availableUsd,
      principalOutstandingUsd,
      realizedPnlNetUsd: input.realizedPnlNetUsd,
      highWaterMarkUsd: input.highWaterMarkUsd,
      feeRatePct: input.feeRatePct
    });
  }

  async function resolveFeeBasis(params: {
    tx: any;
    userId: string;
    botVaultId: string;
    botVault: any;
  }) {
    const basis = await tradingReconciliationService.getFeeBasisForBotVault({
      tx: params.tx,
      userId: params.userId,
      botVaultId: params.botVaultId
    });
    if (basis.source === "reconciliation" && !basis.isFlat) {
      throw new Error("bot_vault_not_flat");
    }
    return basis;
  }

  async function settleProfitWithdraw(params: SettleProfitWithdrawParams): Promise<FeeSettlementResult> {
    const requestedGrossUsd = toPositiveAmount(params.requestedGrossUsd);
    if (requestedGrossUsd <= 0) throw new Error("invalid_withdraw_amount");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");
        const existingLedger = await findLedgerBySourceKey(tx, idempotencyKey);
        if (existingLedger) {
          const settlementFromLedger = parseSettlementFromMetadata(existingLedger.metadataJson);
          const currentBotVault = await tx.botVault.findUnique({ where: { id: botVault.id } });
          if (!settlementFromLedger) {
            throw new Error("fee_settlement_metadata_missing");
          }
          return {
            settlementBreakdown: settlementFromLedger,
            botVaultSnapshotAfter: currentBotVault ?? botVault
          };
        }

        const feeBasis = await resolveFeeBasis({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          botVault
        });

        const breakdown = preview({
          mode: "PROFIT_ONLY_WITHDRAW",
          requestedGrossUsd,
          availableUsd: Number(botVault.availableUsd ?? 0),
          principalAllocatedUsd: Number(botVault.principalAllocated ?? 0),
          principalReturnedUsd: Number(botVault.principalReturned ?? 0),
          realizedPnlNetUsd: Number(feeBasis.realizedPnlNetUsd ?? botVault.realizedPnlNet ?? botVault.realizedNetUsd ?? 0),
          highWaterMarkUsd: Number(botVault.highWaterMark ?? 0)
        });

        if (
          feeBasis.source === "reconciliation"
          && Number.isFinite(Number(feeBasis.netWithdrawableProfitUsd))
          && requestedGrossUsd > Number(feeBasis.netWithdrawableProfitUsd ?? 0) + 0.0000001
        ) {
          throw new Error("insufficient_withdrawable_profit");
        }
        if (requestedGrossUsd > breakdown.maxProfitOnlyWithdrawableUsd + 0.0000001) {
          throw new Error("insufficient_withdrawable_profit");
        }
        if (breakdown.grossTransferUsd <= 0) {
          throw new Error("insufficient_withdrawable_profit");
        }

        return applySettlement({
          tx,
          userId: params.userId,
          botVault,
          idempotencyKey,
          mode: "PROFIT_ONLY_WITHDRAW",
          sourceType: "fee_settlement_profit_withdraw",
          breakdown,
          metadata: params.metadata
        });
      });
    } catch (error) {
      logger.warn("vault_fee_settlement_failed", {
        mode: "PROFIT_ONLY_WITHDRAW",
        userId: params.userId,
        botVaultId: params.botVaultId,
        idempotencyKey,
        error: String(error)
      });
      throw error;
    }
  }

  async function settleFinalClose(params: SettleFinalCloseParams): Promise<FeeSettlementResult> {
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");
        const existingLedger = await findLedgerBySourceKey(tx, idempotencyKey);
        if (existingLedger) {
          const settlementFromLedger = parseSettlementFromMetadata(existingLedger.metadataJson);
          const currentBotVault = await tx.botVault.findUnique({ where: { id: botVault.id } });
          if (!settlementFromLedger) {
            throw new Error("fee_settlement_metadata_missing");
          }
          return {
            settlementBreakdown: settlementFromLedger,
            botVaultSnapshotAfter: currentBotVault ?? botVault
          };
        }

        const feeBasis = await resolveFeeBasis({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          botVault
        });

        const breakdown = preview({
          mode: "FINAL_CLOSE",
          availableUsd: Number(botVault.availableUsd ?? 0),
          principalAllocatedUsd: Number(botVault.principalAllocated ?? 0),
          principalReturnedUsd: Number(botVault.principalReturned ?? 0),
          realizedPnlNetUsd: Number(feeBasis.realizedPnlNetUsd ?? botVault.realizedPnlNet ?? botVault.realizedNetUsd ?? 0),
          highWaterMarkUsd: Number(botVault.highWaterMark ?? 0)
        });

        if (breakdown.grossTransferUsd <= 0 && breakdown.reservedReleaseUsd <= 0) {
          return {
            settlementBreakdown: breakdown,
            botVaultSnapshotAfter: botVault
          };
        }

        return applySettlement({
          tx,
          userId: params.userId,
          botVault,
          idempotencyKey,
          mode: "FINAL_CLOSE",
          sourceType: "fee_settlement_final_close",
          breakdown,
          metadata: params.metadata
        });
      });
    } catch (error) {
      logger.warn("vault_fee_settlement_failed", {
        mode: "FINAL_CLOSE",
        userId: params.userId,
        botVaultId: params.botVaultId,
        idempotencyKey,
        error: String(error)
      });
      throw error;
    }
  }

  async function applySettlement(params: {
    tx: any;
    userId: string;
    botVault: any;
    idempotencyKey: string;
    mode: "PROFIT_ONLY_WITHDRAW" | "FINAL_CLOSE";
    sourceType: string;
    breakdown: FeeSettlementMathResult;
    metadata?: Record<string, unknown>;
  }): Promise<FeeSettlementResult> {
    const existingLedger = await findLedgerBySourceKey(params.tx, params.idempotencyKey);
    if (existingLedger) {
      const settlementFromLedger = parseSettlementFromMetadata(existingLedger.metadataJson);
      const currentBotVault = await params.tx.botVault.findUnique({ where: { id: params.botVault.id } });
      return {
        settlementBreakdown: settlementFromLedger ?? params.breakdown,
        botVaultSnapshotAfter: currentBotVault ?? params.botVault
      };
    }

    const ledger = await bookVaultLedgerEntry({
      tx: params.tx,
      userId: params.userId,
      masterVaultId: String(params.botVault.masterVaultId),
      botVaultId: String(params.botVault.id),
      gridInstanceId: String(params.botVault.gridInstanceId),
      entryType: "WITHDRAWAL",
      amountUsd: roundUsd(-params.breakdown.grossTransferUsd, 4),
      sourceType: params.sourceType,
      sourceKey: params.idempotencyKey,
      sourceTs: new Date(),
      metadataJson: {
        mode: params.mode,
        settlement: params.breakdown,
        contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
        treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
        grossReturnedUsd: params.breakdown.grossTransferUsd,
        netReturnedUsd: params.breakdown.netTransferUsd,
        ...(params.metadata ?? {})
      }
    });

    if (!ledger.created) {
      const currentBotVault = await params.tx.botVault.findUnique({ where: { id: params.botVault.id } });
      return {
        settlementBreakdown: params.breakdown,
        botVaultSnapshotAfter: currentBotVault ?? params.botVault
      };
    }

    if (params.breakdown.feeAmountUsd > 0) {
      await bookVaultLedgerEntry({
        tx: params.tx,
        userId: params.userId,
        masterVaultId: String(params.botVault.masterVaultId),
        botVaultId: String(params.botVault.id),
        gridInstanceId: String(params.botVault.gridInstanceId),
        entryType: "PROFIT_SHARE_ACCRUAL",
        amountUsd: roundUsd(-params.breakdown.feeAmountUsd, 4),
        sourceType: "fee_settlement_profit_share",
        sourceKey: `${params.idempotencyKey}:fee_ledger`,
        sourceTs: new Date(),
        metadataJson: {
          mode: params.mode,
          settlement: params.breakdown,
          contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
          treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
          grossReturnedUsd: params.breakdown.grossTransferUsd,
          netReturnedUsd: params.breakdown.netTransferUsd,
          ...(params.metadata ?? {})
        }
      });

      await createFeeEventIfNew({
        tx: params.tx,
        botVaultId: String(params.botVault.id),
        sourceKey: `${params.idempotencyKey}:fee_event`,
        profitBase: params.breakdown.feeBaseUsd,
        feeAmount: params.breakdown.feeAmountUsd,
        metadata: {
          mode: params.mode,
          settlement: params.breakdown,
          contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
          treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
          grossReturnedUsd: params.breakdown.grossTransferUsd,
          netReturnedUsd: params.breakdown.netTransferUsd,
          ...(params.metadata ?? {})
        }
      });
    }

    const botVaultUpdateData: Record<string, unknown> = {
      availableUsd: { decrement: params.breakdown.grossTransferUsd },
      principalReturned: { increment: params.breakdown.reservedReleaseUsd },
      feePaidTotal: { increment: params.breakdown.feeAmountUsd },
      profitShareAccruedUsd: { increment: params.breakdown.feeAmountUsd },
      highWaterMark: params.breakdown.highWaterMarkAfterUsd
    };

    if (params.mode === "PROFIT_ONLY_WITHDRAW") {
      botVaultUpdateData.withdrawnUsd = { increment: params.breakdown.grossTransferUsd };
    }

    const updatedBotVault = await params.tx.botVault.update({
      where: { id: params.botVault.id },
      data: botVaultUpdateData
    });

    await masterVaultService.settleFromBotVault({
      tx: params.tx,
      userId: params.userId,
      botVaultId: String(params.botVault.id),
      releasedReservedUsd: params.breakdown.reservedReleaseUsd,
      returnedToFreeUsd: params.breakdown.netTransferUsd,
      idempotencyKey: `${params.idempotencyKey}:master_settlement`,
      metadata: {
        mode: params.mode,
        grossTransferUsd: params.breakdown.grossTransferUsd,
        feeAmountUsd: params.breakdown.feeAmountUsd,
        netTransferUsd: params.breakdown.netTransferUsd,
        contractVersion: LEGACY_TREASURY_CONTRACT_VERSION,
        treasuryPayoutModel: LEGACY_TREASURY_PAYOUT_MODEL,
        ...(params.metadata ?? {})
      }
    });

    logger.info("vault_fee_settlement_applied", {
      userId: params.userId,
      botVaultId: String(params.botVault.id),
      gridInstanceId: String(params.botVault.gridInstanceId),
      mode: params.mode,
      grossTransferUsd: params.breakdown.grossTransferUsd,
      feeBaseUsd: params.breakdown.feeBaseUsd,
      feeAmountUsd: params.breakdown.feeAmountUsd,
      netTransferUsd: params.breakdown.netTransferUsd,
      hwmBefore: params.breakdown.highWaterMarkBeforeUsd,
      hwmAfter: params.breakdown.highWaterMarkAfterUsd,
      idempotencyKey: params.idempotencyKey
    });

    return {
      settlementBreakdown: params.breakdown,
      botVaultSnapshotAfter: updatedBotVault
    };
  }

  return {
    preview,
    settleProfitWithdraw,
    settleFinalClose
  };
}

export type FeeSettlementService = ReturnType<typeof createFeeSettlementService>;
