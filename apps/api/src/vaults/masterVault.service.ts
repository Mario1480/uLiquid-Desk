import { roundUsd } from "./profitShare.js";
import { logger as defaultLogger } from "../logger.js";

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
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

function normalizeIdempotencyKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key) throw new Error("invalid_idempotency_key");
  return key;
}

export type MasterVaultBalances = {
  id: string;
  userId: string;
  freeBalance: number;
  reservedBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalAllocatedUsd: number;
  totalWithdrawnUsd: number;
  availableUsd: number;
  updatedAt: string | null;
};

type MasterVaultLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
};

type CreateMasterVaultServiceDeps = {
  logger?: MasterVaultLogger;
};

type EnsureMasterVaultParams = {
  userId: string;
  tx?: any;
};

type DepositParams = {
  userId: string;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type ReserveForBotVaultParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type ReleaseFromBotVaultParams = {
  userId: string;
  botVaultId: string;
  releasedReservedUsd: number;
  profitUsd?: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type SettleFromBotVaultParams = {
  userId: string;
  botVaultId: string;
  releasedReservedUsd: number;
  returnedToFreeUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type ValidateWithdrawParams = {
  userId: string;
  amountUsd: number;
  tx?: any;
};

type WithdrawParams = {
  userId: string;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

function mapMasterVaultBalances(row: any): MasterVaultBalances {
  return {
    id: String(row.id),
    userId: String(row.userId),
    freeBalance: Number(row.freeBalance ?? 0),
    reservedBalance: Number(row.reservedBalance ?? 0),
    totalDeposited: Number(row.totalDeposited ?? 0),
    totalWithdrawn: Number(row.totalWithdrawn ?? 0),
    totalAllocatedUsd: Number(row.totalAllocatedUsd ?? 0),
    totalWithdrawnUsd: Number(row.totalWithdrawnUsd ?? 0),
    availableUsd: Number(row.availableUsd ?? 0),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

export function createMasterVaultService(db: any, deps?: CreateMasterVaultServiceDeps) {
  const logger = deps?.logger ?? defaultLogger;

  function emitBalanceChange(params: {
    operation: "deposit" | "reserve" | "release" | "settle" | "withdraw";
    userId: string;
    masterVaultId: string;
    botVaultId?: string | null;
    amountUsd: number;
    idempotencyKey: string;
    before: { freeBalance: number; reservedBalance: number };
    after: { freeBalance: number; reservedBalance: number };
  }) {
    logger.info("vault_master_balance_change", {
      userId: params.userId,
      masterVaultId: params.masterVaultId,
      botVaultId: params.botVaultId ?? null,
      operation: params.operation,
      amountUsd: params.amountUsd,
      idempotencyKey: params.idempotencyKey,
      freeBefore: params.before.freeBalance,
      freeAfter: params.after.freeBalance,
      reservedBefore: params.before.reservedBalance,
      reservedAfter: params.after.reservedBalance
    });
  }

  async function withTx<T>(tx: any | undefined, run: (tx: any) => Promise<T>): Promise<T> {
    if (tx) return run(tx);
    return db.$transaction(async (dbTx: any) => run(dbTx));
  }

  async function getBalancesByMasterVaultId(tx: any, masterVaultId: string): Promise<MasterVaultBalances> {
    const row = await tx.masterVault.findUnique({ where: { id: masterVaultId } });
    if (!row) throw new Error("master_vault_not_found");
    return mapMasterVaultBalances(row);
  }

  async function findByIdempotencyKey(tx: any, idempotencyKey: string): Promise<any | null> {
    return tx.cashEvent.findUnique({
      where: {
        idempotencyKey
      }
    });
  }

  async function createCashEventIfNew(params: {
    tx: any;
    masterVaultId: string;
    botVaultId?: string | null;
    eventType: "DEPOSIT" | "WITHDRAWAL" | "ALLOCATE_TO_BOT" | "RETURN_FROM_BOT";
    amount: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await params.tx.cashEvent.create({
        data: {
          masterVaultId: params.masterVaultId,
          botVaultId: params.botVaultId ?? null,
          eventType: params.eventType,
          amount: params.amount,
          idempotencyKey: params.idempotencyKey,
          metadata: params.metadata ?? null
        }
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return false;
    }
  }

  async function ensureMasterVault(params: EnsureMasterVaultParams): Promise<any> {
    const client = params.tx ?? db;
    const existing = await client.masterVault.findUnique({
      where: { userId: params.userId }
    });
    if (existing) return existing;

    try {
      return await client.masterVault.create({
        data: {
          userId: params.userId
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await client.masterVault.findUnique({
        where: { userId: params.userId }
      });
      if (!raced) throw error;
      return raced;
    }
  }

  async function getBalances(params: { userId: string; tx?: any }): Promise<MasterVaultBalances> {
    const masterVault = await ensureMasterVault(params);
    return mapMasterVaultBalances(masterVault);
  }

  async function deposit(params: DepositParams): Promise<MasterVaultBalances> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) throw new Error("invalid_amount_usd");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    return withTx(params.tx, async (tx) => {
      const masterVault = await ensureMasterVault({ userId: params.userId, tx });
      const before = {
        freeBalance: Number(masterVault.freeBalance ?? 0),
        reservedBalance: Number(masterVault.reservedBalance ?? 0)
      };
      const existingEvent = await findByIdempotencyKey(tx, idempotencyKey);
      if (existingEvent) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const eventCreated = await createCashEventIfNew({
        tx,
        masterVaultId: String(masterVault.id),
        eventType: "DEPOSIT",
        amount: amountUsd,
        idempotencyKey,
        metadata: params.metadata
      });
      if (!eventCreated) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const updated = await tx.masterVault.update({
        where: { id: masterVault.id },
        data: {
          freeBalance: { increment: amountUsd },
          totalDeposited: { increment: amountUsd },
          availableUsd: { increment: amountUsd }
        }
      });
      const after = mapMasterVaultBalances(updated);
      emitBalanceChange({
        operation: "deposit",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        amountUsd,
        idempotencyKey,
        before,
        after
      });
      return after;
    });
  }

  async function reserveForBotVault(params: ReserveForBotVaultParams): Promise<MasterVaultBalances> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) throw new Error("invalid_amount_usd");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    return withTx(params.tx, async (tx) => {
      const masterVault = await ensureMasterVault({ userId: params.userId, tx });
      const before = {
        freeBalance: Number(masterVault.freeBalance ?? 0),
        reservedBalance: Number(masterVault.reservedBalance ?? 0)
      };
      const existingEvent = await findByIdempotencyKey(tx, idempotencyKey);
      if (existingEvent) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const eventCreated = await createCashEventIfNew({
        tx,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        eventType: "ALLOCATE_TO_BOT",
        amount: amountUsd,
        idempotencyKey,
        metadata: params.metadata
      });
      if (!eventCreated) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const updateResult = await tx.masterVault.updateMany({
        where: {
          id: masterVault.id,
          freeBalance: {
            gte: amountUsd
          }
        },
        data: {
          freeBalance: { decrement: amountUsd },
          reservedBalance: { increment: amountUsd },
          totalAllocatedUsd: { increment: amountUsd }
        }
      });

      if (Number(updateResult?.count ?? 0) !== 1) {
        logger.warn("vault_master_balance_change_rejected", {
          operation: "reserve",
          userId: params.userId,
          masterVaultId: String(masterVault.id),
          botVaultId: params.botVaultId,
          amountUsd,
          idempotencyKey,
          reason: "insufficient_free_balance"
        });
        throw new Error("insufficient_free_balance");
      }
      const after = await getBalancesByMasterVaultId(tx, String(masterVault.id));
      emitBalanceChange({
        operation: "reserve",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        amountUsd,
        idempotencyKey,
        before,
        after
      });
      return after;
    });
  }

  async function releaseFromBotVault(params: ReleaseFromBotVaultParams): Promise<MasterVaultBalances> {
    const releasedReservedUsd = toNonNegativeAmount(params.releasedReservedUsd);
    const profitUsd = toNonNegativeAmount(params.profitUsd ?? 0);
    const creditUsd = roundUsd(releasedReservedUsd + profitUsd, 6);
    if (creditUsd <= 0) throw new Error("invalid_release_amount");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    return withTx(params.tx, async (tx) => {
      const masterVault = await ensureMasterVault({ userId: params.userId, tx });
      const before = {
        freeBalance: Number(masterVault.freeBalance ?? 0),
        reservedBalance: Number(masterVault.reservedBalance ?? 0)
      };
      const existingEvent = await findByIdempotencyKey(tx, idempotencyKey);
      if (existingEvent) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const eventCreated = await createCashEventIfNew({
        tx,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        eventType: "RETURN_FROM_BOT",
        amount: creditUsd,
        idempotencyKey,
        metadata: {
          releasedReservedUsd,
          profitUsd,
          ...(params.metadata ?? {})
        }
      });
      if (!eventCreated) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      if (releasedReservedUsd > 0) {
        const updateResult = await tx.masterVault.updateMany({
          where: {
            id: masterVault.id,
            reservedBalance: {
              gte: releasedReservedUsd
            }
          },
          data: {
            reservedBalance: { decrement: releasedReservedUsd },
            freeBalance: { increment: creditUsd },
            availableUsd: { increment: creditUsd }
          }
        });
        if (Number(updateResult?.count ?? 0) !== 1) {
          logger.warn("vault_master_balance_change_rejected", {
            operation: "release",
            userId: params.userId,
            masterVaultId: String(masterVault.id),
            botVaultId: params.botVaultId,
            amountUsd: creditUsd,
            idempotencyKey,
            reason: "insufficient_reserved_balance"
          });
          throw new Error("insufficient_reserved_balance");
        }
      } else {
        await tx.masterVault.update({
          where: { id: masterVault.id },
          data: {
            freeBalance: { increment: creditUsd },
            availableUsd: { increment: creditUsd }
          }
        });
      }

      const after = await getBalancesByMasterVaultId(tx, String(masterVault.id));
      emitBalanceChange({
        operation: "release",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        amountUsd: creditUsd,
        idempotencyKey,
        before,
        after
      });
      return after;
    });
  }

  async function settleFromBotVault(params: SettleFromBotVaultParams): Promise<MasterVaultBalances> {
    const releasedReservedUsd = toNonNegativeAmount(params.releasedReservedUsd);
    const returnedToFreeUsd = toNonNegativeAmount(params.returnedToFreeUsd);
    if (releasedReservedUsd <= 0 && returnedToFreeUsd <= 0) {
      throw new Error("invalid_settlement_amount");
    }
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    return withTx(params.tx, async (tx) => {
      const masterVault = await ensureMasterVault({ userId: params.userId, tx });
      const before = {
        freeBalance: Number(masterVault.freeBalance ?? 0),
        reservedBalance: Number(masterVault.reservedBalance ?? 0)
      };
      const existingEvent = await findByIdempotencyKey(tx, idempotencyKey);
      if (existingEvent) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const pnlDeltaUsd = roundUsd(returnedToFreeUsd - releasedReservedUsd, 6);
      const eventCreated = await createCashEventIfNew({
        tx,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        eventType: "RETURN_FROM_BOT",
        amount: returnedToFreeUsd,
        idempotencyKey,
        metadata: {
          releasedReservedUsd,
          returnedToFreeUsd,
          pnlDeltaUsd,
          ...(params.metadata ?? {})
        }
      });
      if (!eventCreated) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const updateResult = await tx.masterVault.updateMany({
        where: {
          id: masterVault.id,
          reservedBalance: {
            gte: releasedReservedUsd
          }
        },
        data: {
          reservedBalance: { decrement: releasedReservedUsd },
          freeBalance: { increment: returnedToFreeUsd },
          availableUsd: { increment: returnedToFreeUsd }
        }
      });
      if (Number(updateResult?.count ?? 0) !== 1) {
        logger.warn("vault_master_balance_change_rejected", {
          operation: "settle",
          userId: params.userId,
          masterVaultId: String(masterVault.id),
          botVaultId: params.botVaultId,
          amountUsd: returnedToFreeUsd,
          idempotencyKey,
          reason: "insufficient_reserved_balance"
        });
        throw new Error("insufficient_reserved_balance");
      }
      const after = await getBalancesByMasterVaultId(tx, String(masterVault.id));
      emitBalanceChange({
        operation: "settle",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        botVaultId: params.botVaultId,
        amountUsd: returnedToFreeUsd,
        idempotencyKey,
        before,
        after
      });
      return after;
    });
  }

  async function validateWithdraw(params: ValidateWithdrawParams): Promise<{
    ok: boolean;
    reason: string | null;
    freeBalance: number;
    reservedBalance: number;
  }> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) {
      return {
        ok: false,
        reason: "invalid_amount_usd",
        freeBalance: 0,
        reservedBalance: 0
      };
    }

    const balances = await getBalances({
      userId: params.userId,
      tx: params.tx
    });

    if (balances.freeBalance + 0.0000001 < amountUsd) {
      return {
        ok: false,
        reason: "insufficient_free_balance",
        freeBalance: balances.freeBalance,
        reservedBalance: balances.reservedBalance
      };
    }

    return {
      ok: true,
      reason: null,
      freeBalance: balances.freeBalance,
      reservedBalance: balances.reservedBalance
    };
  }

  async function withdraw(params: WithdrawParams): Promise<MasterVaultBalances> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) throw new Error("invalid_amount_usd");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    return withTx(params.tx, async (tx) => {
      const masterVault = await ensureMasterVault({ userId: params.userId, tx });
      const before = {
        freeBalance: Number(masterVault.freeBalance ?? 0),
        reservedBalance: Number(masterVault.reservedBalance ?? 0)
      };
      const existingEvent = await findByIdempotencyKey(tx, idempotencyKey);
      if (existingEvent) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const eventCreated = await createCashEventIfNew({
        tx,
        masterVaultId: String(masterVault.id),
        eventType: "WITHDRAWAL",
        amount: amountUsd,
        idempotencyKey,
        metadata: params.metadata
      });
      if (!eventCreated) {
        return getBalancesByMasterVaultId(tx, String(masterVault.id));
      }

      const updateResult = await tx.masterVault.updateMany({
        where: {
          id: masterVault.id,
          freeBalance: {
            gte: amountUsd
          }
        },
        data: {
          freeBalance: { decrement: amountUsd },
          totalWithdrawn: { increment: amountUsd },
          totalWithdrawnUsd: { increment: amountUsd },
          availableUsd: { decrement: amountUsd }
        }
      });

      if (Number(updateResult?.count ?? 0) !== 1) {
        logger.warn("vault_master_balance_change_rejected", {
          operation: "withdraw",
          userId: params.userId,
          masterVaultId: String(masterVault.id),
          amountUsd,
          idempotencyKey,
          reason: "insufficient_free_balance"
        });
        throw new Error("insufficient_free_balance");
      }
      const after = await getBalancesByMasterVaultId(tx, String(masterVault.id));
      emitBalanceChange({
        operation: "withdraw",
        userId: params.userId,
        masterVaultId: String(masterVault.id),
        amountUsd,
        idempotencyKey,
        before,
        after
      });
      return after;
    });
  }

  return {
    ensureMasterVault,
    getBalances,
    deposit,
    reserveForBotVault,
    releaseFromBotVault,
    settleFromBotVault,
    validateWithdraw,
    withdraw
  };
}

export type MasterVaultService = ReturnType<typeof createMasterVaultService>;
