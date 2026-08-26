import { getUliqFeatureFlags, ULIQ_RESERVATION_TTL_MS } from "./config.js";
import { UliqEntitlementService, type UliqEntitlement } from "./entitlement.service.js";
import { calculateUliqDiscountCents, type UliqDiscountAllocation } from "./math.js";
import { parseDatabaseUint256Decimal } from "./uint256.js";
import type { UliqLockGateDecision } from "./math.js";

export type UliqBenefitType = "SUBSCRIPTION_DISCOUNT" | "AI_CREDIT_DISCOUNT";

export type UliqDiscountSelection = {
  benefitType: UliqBenefitType;
  eligibleLineIndexes: number[];
};

export type PreparedUliqBillingBenefit = UliqDiscountAllocation & {
  userId: string;
  walletAddress: string;
  entitlementSnapshotId: string;
  priceSnapshotId: string;
  asOfBlock: bigint;
  configVersion: number;
  tierSnapshot: string;
  benefitType: UliqBenefitType;
  discountBps: number;
  expiresAt: Date;
  priceQualityStatus: string;
  degradationReason: string | null;
  lockDecision: UliqLockGateDecision;
  plannedTermWindow: {
    startsAt: Date;
    endsAt: Date;
    graceEndsAt: Date;
  } | null;
  sourceSubscriptionTermId: string | null;
  aiMonthlyCapCents: number | null;
  lockerContractAddress: string;
};

export class UliqBenefitGateError extends Error {
  constructor(
    code: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code);
    this.name = "UliqBenefitGateError";
  }
}

function centsToUsdDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("uliq_invalid_amount_cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function resolveUliqDiscountSelection(
  lines: Array<{ kind: string; addonType?: string | null }>
): UliqDiscountSelection | null {
  const subscriptionIndexes: number[] = [];
  const aiCreditIndexes: number[] = [];
  lines.forEach((line, index) => {
    const kind = String(line.kind).toLowerCase();
    if (kind === "plan") subscriptionIndexes.push(index);
    if (kind === "addon" && line.addonType === "ai_credits") aiCreditIndexes.push(index);
  });
  if (subscriptionIndexes.length > 0 && aiCreditIndexes.length > 0) {
    throw new Error("uliq_mixed_discount_types_not_supported");
  }
  if (subscriptionIndexes.length > 0) {
    return { benefitType: "SUBSCRIPTION_DISCOUNT", eligibleLineIndexes: subscriptionIndexes };
  }
  if (aiCreditIndexes.length > 0) {
    return { benefitType: "AI_CREDIT_DISCOUNT", eligibleLineIndexes: aiCreditIndexes };
  }
  // Capacity add-ons have no ULIQ discount in the approved v1 pricing model.
  return null;
}

export function selectUliqBenefitType(
  lines: Array<{ kind: string; addonType?: string | null }>
): UliqBenefitType | null {
  return resolveUliqDiscountSelection(lines)?.benefitType ?? null;
}

export async function prepareUliqBillingBenefit(params: {
  db: any;
  userId: string;
  baseAmountCents: number;
  benefitType: UliqBenefitType;
  entitlementService?: Pick<UliqEntitlementService, "getForUser" | "getLockDecisionForBenefit">;
  requiredBenefitUntil?: Date;
  plannedTermWindow?: { startsAt: Date; endsAt: Date; graceEndsAt: Date } | null;
  now?: Date;
}): Promise<PreparedUliqBillingBenefit> {
  const flags = getUliqFeatureFlags();
  if (!flags.enabled || !flags.discountsEnabled) throw new Error("uliq_discounts_disabled");
  const now = params.now ?? new Date();
  const entitlementService = params.entitlementService ?? new UliqEntitlementService(params.db);
  const entitlement = await entitlementService.getForUser(
    params.userId,
    { forceRefresh: true, now }
  );
  if (entitlement.validUntil <= now) throw new Error("uliq_entitlement_expired");
  if (entitlement.priceQualityStatus !== "HEALTHY") throw new Error("uliq_price_degraded");
  let requiredBenefitUntil = params.requiredBenefitUntil ?? null;
  let sourceSubscriptionTermId: string | null = null;
  if (params.benefitType === "AI_CREDIT_DISCOUNT") {
    const activeDiscountedTerm = await params.db.subscriptionTerm.findFirst({
      where: {
        userId: params.userId,
        status: "ACTIVE",
        startsAt: { lte: now },
        endsAt: { gt: now },
        order: {
          uliqBenefitReservation: {
            benefitType: "SUBSCRIPTION_DISCOUNT",
            status: "CONSUMED"
          }
        }
      },
      include: { order: { include: { uliqBenefitReservation: true } } },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }]
    });
    if (!activeDiscountedTerm) throw new UliqBenefitGateError("uliq_ai_discounted_subscription_required");
    requiredBenefitUntil = activeDiscountedTerm.endsAt;
    sourceSubscriptionTermId = String(activeDiscountedTerm.id);
  }
  if (!requiredBenefitUntil || requiredBenefitUntil <= now) {
    throw new UliqBenefitGateError("uliq_lock_term_insufficient", {
      requiredBenefitUntil: requiredBenefitUntil?.toISOString() ?? null
    });
  }
  const lockDecision = await entitlementService.getLockDecisionForBenefit({
    userId: params.userId,
    requiredBenefitUntil,
    entitlement,
    now
  });
  if (!lockDecision.qualifies) {
    throw new UliqBenefitGateError(lockDecision.failureReason ?? "uliq_lock_required", {
      requiredLockedRaw: lockDecision.requiredLockedRaw,
      qualifyingLockedRaw: lockDecision.qualifyingLockedRaw,
      qualifyingLockIds: lockDecision.qualifyingLockIds,
      requiredBenefitUntil: lockDecision.requiredBenefitUntil.toISOString(),
      coverageShareBps: lockDecision.coverageShareBps,
      tier: lockDecision.tierCode
    });
  }
  let aiMonthlyCapCents: number | null = null;
  if (params.benefitType === "AI_CREDIT_DISCOUNT") {
    aiMonthlyCapCents = readAiMonthlyDiscountCapCents(lockDecision.monetaryBenefitCaps);
    if (aiMonthlyCapCents == null) {
      throw new UliqBenefitGateError("uliq_ai_cap_unconfigured", {
        tier: lockDecision.tierCode,
        configVersion: lockDecision.configVersion
      });
    }
  }
  const discountBps = params.benefitType === "AI_CREDIT_DISCOUNT"
    ? entitlement.aiDiscountBps
    : entitlement.subscriptionDiscountBps;
  const amounts = calculateUliqDiscountCents(params.baseAmountCents, discountBps);
  return {
    ...amounts,
    userId: params.userId,
    walletAddress: entitlement.walletAddress.toLowerCase(),
    entitlementSnapshotId: entitlement.id,
    priceSnapshotId: entitlement.priceSnapshotId,
    asOfBlock: entitlement.asOfBlock,
    configVersion: entitlement.tierConfigVersion,
    tierSnapshot: entitlement.monetaryTier,
    benefitType: params.benefitType,
    discountBps,
    expiresAt: new Date(now.getTime() + ULIQ_RESERVATION_TTL_MS),
    priceQualityStatus: entitlement.priceQualityStatus,
    degradationReason: entitlement.degradationReason,
    lockDecision,
    plannedTermWindow: params.plannedTermWindow ?? null,
    sourceSubscriptionTermId,
    aiMonthlyCapCents,
    lockerContractAddress: lockDecision.lockerContractAddress
  };
}

function readAiMonthlyDiscountCapCents(value: Record<string, unknown> | null): number | null {
  const raw = value?.aiCreditDiscountMonthlyCents;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function usdDecimalToCents(value: unknown): number {
  const normalized = String(value ?? "0");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error("uliq_invalid_discount_amount");
  const [whole, fraction = ""] = normalized.split(".");
  const trailing = fraction.slice(2);
  if (trailing && /[1-9]/.test(trailing)) throw new Error("uliq_discount_subcent_not_supported");
  const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("uliq_discount_amount_too_large");
  return Number(cents);
}

function utcMonthWindow(now: Date): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  };
}

async function requireCanonicalLockEvidence(params: {
  tx: any;
  chainId: number;
  lockerContractAddress: string;
  walletAddress: string;
  asOfBlock: bigint;
  requiredBenefitUntil: Date;
  requiredLockedRaw: bigint;
  qualifyingLockIds: string[];
}): Promise<void> {
  const cursor = await params.tx.onchainSyncCursor.findUnique({
    where: { id: `uliq:${params.chainId}:all` }
  });
  if (
    !cursor
    || BigInt(cursor.lastProcessedBlock) < params.asOfBlock
    || Number(cursor.failureCount ?? 0) !== 0
    || cursor.lastError
  ) throw new UliqBenefitGateError("uliq_lock_state_stale");
  const locks = await params.tx.uliqLockPosition.findMany({
    where: {
      chainId: params.chainId,
      contractAddress: params.lockerContractAddress,
      walletAddress: params.walletAddress,
      lockIdOnchain: { in: params.qualifyingLockIds },
      status: { in: ["ACTIVE", "MATURED"] },
      unlockAt: { gte: params.requiredBenefitUntil }
    }
  });
  const qualifyingRaw = locks.reduce(
    (sum: bigint, lock: any) => sum + parseDatabaseUint256Decimal(lock.amountRaw, "lock_amount_raw"),
    0n
  );
  if (qualifyingRaw < params.requiredLockedRaw) {
    throw new UliqBenefitGateError("uliq_lock_amount_insufficient", {
      requiredLockedRaw: params.requiredLockedRaw.toString(),
      qualifyingLockedRaw: qualifyingRaw.toString(),
      requiredBenefitUntil: params.requiredBenefitUntil.toISOString()
    });
  }
}

export async function createUliqBenefitReservationInTransaction(params: {
  tx: any;
  prepared: PreparedUliqBillingBenefit;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  now?: Date;
}): Promise<any> {
  const now = params.now ?? new Date();
  if (params.prepared.expiresAt.getTime() - now.getTime() !== ULIQ_RESERVATION_TTL_MS) {
    throw new Error("uliq_reservation_ttl_invalid");
  }
  const [user, snapshot] = await Promise.all([
    params.tx.user.findUnique({ where: { id: params.prepared.userId }, select: { walletAddress: true } }),
    params.tx.uliqEntitlementSnapshot.findUnique({
      where: { id: params.prepared.entitlementSnapshotId },
      select: {
        userId: true,
        walletAddress: true,
        chainId: true,
        validUntil: true,
        priceSnapshotId: true,
        asOfBlock: true,
        monetaryEligibleRaw: true,
        lockModifier: true
      }
    })
  ]);
  const linkedWallet = String(user?.walletAddress ?? "").toLowerCase();
  if (!linkedWallet || linkedWallet !== params.prepared.walletAddress) throw new Error("uliq_wallet_changed");
  if (
    !snapshot
    || snapshot.userId !== params.prepared.userId
    || String(snapshot.walletAddress).toLowerCase() !== linkedWallet
    || snapshot.validUntil <= now
    || String(snapshot.priceSnapshotId) !== params.prepared.priceSnapshotId
    || BigInt(snapshot.asOfBlock) !== params.prepared.asOfBlock
    || snapshot.lockModifier !== params.prepared.lockDecision.version
  ) {
    throw new Error("uliq_entitlement_invalid");
  }
  await requireCanonicalLockEvidence({
    tx: params.tx,
    chainId: Number(snapshot.chainId),
    lockerContractAddress: params.prepared.lockerContractAddress,
    walletAddress: linkedWallet,
    asOfBlock: params.prepared.asOfBlock,
    requiredBenefitUntil: params.prepared.lockDecision.requiredBenefitUntil,
    requiredLockedRaw: BigInt(params.prepared.lockDecision.requiredLockedRaw),
    qualifyingLockIds: params.prepared.lockDecision.qualifyingLockIds
  });
  const existing = await params.tx.uliqBenefitReservation.findUnique({
    where: { idempotencyKey: params.idempotencyKey }
  });
  if (existing) {
    if (
      existing.userId !== params.prepared.userId
      || existing.referenceType !== params.referenceType
      || existing.referenceId !== params.referenceId
      || existing.benefitType !== params.prepared.benefitType
    ) {
      throw new Error("uliq_idempotency_conflict");
    }
    return existing;
  }
  if (params.prepared.benefitType === "AI_CREDIT_DISCOUNT") {
    const sourceTerm = params.prepared.sourceSubscriptionTermId
      ? await params.tx.subscriptionTerm.findUnique({
        where: { id: params.prepared.sourceSubscriptionTermId },
        include: { order: { include: { uliqBenefitReservation: true } } }
      })
      : null;
    if (
      !sourceTerm
      || sourceTerm.userId !== params.prepared.userId
      || sourceTerm.status !== "ACTIVE"
      || sourceTerm.endsAt.getTime() !== params.prepared.lockDecision.requiredBenefitUntil.getTime()
      || sourceTerm.order?.uliqBenefitReservation?.benefitType !== "SUBSCRIPTION_DISCOUNT"
      || sourceTerm.order?.uliqBenefitReservation?.status !== "CONSUMED"
    ) throw new UliqBenefitGateError("uliq_ai_discounted_subscription_required");
    if (params.prepared.aiMonthlyCapCents == null) throw new UliqBenefitGateError("uliq_ai_cap_unconfigured");
    const month = utcMonthWindow(now);
    const usage = await params.tx.uliqBenefitReservation.aggregate({
      where: {
        userId: params.prepared.userId,
        benefitType: "AI_CREDIT_DISCOUNT",
        status: { in: ["RESERVED", "CONSUMED"] },
        createdAt: { gte: month.startsAt, lt: month.endsAt }
      },
      _sum: { discountAmount: true }
    });
    const usedCents = usdDecimalToCents(usage?._sum?.discountAmount ?? "0");
    if (usedCents + params.prepared.discountAmountCents > params.prepared.aiMonthlyCapCents) {
      throw new UliqBenefitGateError("uliq_ai_cap_exceeded", {
        capCents: params.prepared.aiMonthlyCapCents,
        usedCents,
        requestedDiscountCents: params.prepared.discountAmountCents
      });
    }
  }
  return params.tx.uliqBenefitReservation.create({
    data: {
      userId: params.prepared.userId,
      walletAddress: params.prepared.walletAddress,
      entitlementSnapshotId: params.prepared.entitlementSnapshotId,
      configVersion: params.prepared.configVersion,
      priceSnapshotId: params.prepared.priceSnapshotId,
      asOfBlock: params.prepared.asOfBlock,
      lockGateVersion: params.prepared.lockDecision.version,
      lockContractAddress: params.prepared.lockerContractAddress,
      requiredBenefitUntil: params.prepared.lockDecision.requiredBenefitUntil,
      requiredLockedRaw: params.prepared.lockDecision.requiredLockedRaw,
      qualifyingLockedRaw: params.prepared.lockDecision.qualifyingLockedRaw,
      qualifyingLockIds: params.prepared.lockDecision.qualifyingLockIds,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      benefitType: params.prepared.benefitType,
      currency: "USD",
      baseAmount: centsToUsdDecimal(params.prepared.baseAmountCents),
      discountAmount: centsToUsdDecimal(params.prepared.discountAmountCents),
      finalAmount: centsToUsdDecimal(params.prepared.finalAmountCents),
      status: "RESERVED",
      expiresAt: params.prepared.expiresAt,
      idempotencyKey: params.idempotencyKey,
      metadata: {
        tierSnapshot: params.prepared.tierSnapshot,
        discountBps: params.prepared.discountBps,
        priceQualityStatus: params.prepared.priceQualityStatus,
        degradationReason: params.prepared.degradationReason,
        lockDecision: {
          ...params.prepared.lockDecision,
          requiredBenefitUntil: params.prepared.lockDecision.requiredBenefitUntil.toISOString()
        },
        plannedTermWindow: params.prepared.plannedTermWindow ? {
          startsAt: params.prepared.plannedTermWindow.startsAt.toISOString(),
          endsAt: params.prepared.plannedTermWindow.endsAt.toISOString(),
          graceEndsAt: params.prepared.plannedTermWindow.graceEndsAt.toISOString()
        } : null,
        sourceSubscriptionTermId: params.prepared.sourceSubscriptionTermId,
        aiMonthlyCapCents: params.prepared.aiMonthlyCapCents,
        ttlSeconds: ULIQ_RESERVATION_TTL_MS / 1_000
      }
    }
  });
}

export async function consumeUliqBenefitReservationInTransaction(params: {
  tx: any;
  reservationId: string | null | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!params.reservationId) return false;
  const now = params.now ?? new Date();
  const reservation = await params.tx.uliqBenefitReservation.findUnique({
    where: { id: params.reservationId },
    include: {
      billingOrder: { include: { onchainPayment: true } },
      entitlementSnapshot: { select: { chainId: true } }
    }
  });
  if (!reservation) throw new Error("uliq_reservation_not_found");
  if (reservation.status === "CONSUMED") return false;
  if (reservation.status !== "RESERVED") throw new Error("uliq_reservation_not_consumable");
  const payment = reservation.billingOrder?.onchainPayment;
  // Expiry processing releases a PENDING reservation with no tx hash. Once a
  // hash is claimed, confirmation/finality may legitimately complete after the
  // ten-minute quote window without mutating the agreed payment amount.
  const submittedBeforeExpiry = Boolean(payment?.txHash);
  if (reservation.expiresAt <= now && !submittedBeforeExpiry) throw new Error("uliq_reservation_expired");
  if (
    !reservation.lockGateVersion
    || !reservation.lockContractAddress
    || !reservation.requiredBenefitUntil
    || reservation.requiredLockedRaw == null
    || !Array.isArray(reservation.qualifyingLockIds)
  ) throw new UliqBenefitGateError("uliq_lock_required");
  await requireCanonicalLockEvidence({
    tx: params.tx,
    chainId: Number(reservation.entitlementSnapshot?.chainId),
    lockerContractAddress: String(reservation.lockContractAddress).toLowerCase(),
    walletAddress: String(reservation.walletAddress).toLowerCase(),
    asOfBlock: BigInt(reservation.asOfBlock),
    requiredBenefitUntil: reservation.requiredBenefitUntil instanceof Date
      ? reservation.requiredBenefitUntil
      : new Date(reservation.requiredBenefitUntil),
    requiredLockedRaw: parseDatabaseUint256Decimal(reservation.requiredLockedRaw, "required_locked_raw"),
    qualifyingLockIds: reservation.qualifyingLockIds.map(String)
  });
  const claimed = await params.tx.uliqBenefitReservation.updateMany({
    where: { id: reservation.id, status: "RESERVED" },
    data: { status: "CONSUMED", consumedAt: now }
  });
  if (claimed.count !== 1) throw new Error("uliq_reservation_consume_conflict");
  const metadata = reservation.metadata && typeof reservation.metadata === "object" && !Array.isArray(reservation.metadata)
    ? reservation.metadata as Record<string, unknown>
    : {};
  await params.tx.uliqBenefitLedger.create({
    data: {
      userId: reservation.userId,
      walletAddress: reservation.walletAddress,
      benefitType: reservation.benefitType,
      referenceType: reservation.referenceType,
      referenceId: reservation.referenceId,
      reservationId: reservation.id,
      tierSnapshot: String(metadata.tierSnapshot ?? "BASIC"),
      configVersion: reservation.configVersion,
      priceSnapshotId: reservation.priceSnapshotId,
      entitlementSnapshotId: reservation.entitlementSnapshotId,
      currency: reservation.currency,
      baseAmount: reservation.baseAmount,
      discountAmount: reservation.discountAmount,
      finalAmount: reservation.finalAmount,
      entryType: "CONSUMED",
      idempotencyKey: `reservation:${reservation.id}:consumed`,
      metadata: { consumedAt: now.toISOString() }
    }
  });
  return true;
}

export async function releaseUliqBenefitReservationInTransaction(params: {
  tx: any;
  reservationId: string | null | undefined;
  now?: Date;
  reason: string;
}): Promise<boolean> {
  if (!params.reservationId) return false;
  const now = params.now ?? new Date();
  const released = await params.tx.uliqBenefitReservation.updateMany({
    where: { id: params.reservationId, status: "RESERVED" },
    data: {
      status: "RELEASED",
      releasedAt: now,
      metadata: { releaseReason: params.reason, releasedAt: now.toISOString() }
    }
  });
  return released.count === 1;
}

export async function releaseOpenUliqReservationsForWalletChange(params: {
  db: any;
  userId: string;
  previousWalletAddress: string | null;
  nextWalletAddress: string | null;
  updateWallet: (tx: any) => Promise<unknown>;
  now?: Date;
}): Promise<number> {
  const now = params.now ?? new Date();
  return params.db.$transaction(async (tx: any) => {
    const released = await tx.uliqBenefitReservation.updateMany({
      where: { userId: params.userId, status: "RESERVED" },
      data: {
        status: "RELEASED",
        releasedAt: now,
        metadata: {
          releaseReason: "wallet_changed",
          previousWalletAddress: params.previousWalletAddress,
          nextWalletAddress: params.nextWalletAddress,
          releasedAt: now.toISOString()
        }
      }
    });
    await params.updateWallet(tx);
    return Number(released.count ?? 0);
  });
}

export async function expireUliqBenefitReservations(db: any, now = new Date()): Promise<number> {
  return db.$transaction(async (tx: any) => {
    const rows = await tx.uliqBenefitReservation.findMany({
      where: {
        status: "RESERVED",
        expiresAt: { lte: now },
        OR: [
          { billingOrder: null },
          { billingOrder: { status: { in: ["PENDING", "EXPIRED", "FAILED"] }, onchainPayment: { txHash: null } } }
        ]
      },
      select: { id: true, billingOrder: { select: { id: true, status: true } } },
      take: 250
    });
    let released = 0;
    for (const row of rows) {
      const changed = await tx.uliqBenefitReservation.updateMany({
        where: { id: row.id, status: "RESERVED", expiresAt: { lte: now } },
        data: { status: "RELEASED", releasedAt: now, metadata: { releaseReason: "expired" } }
      });
      if (changed.count !== 1) continue;
      released += 1;
      if (row.billingOrder?.status === "PENDING") {
        await tx.billingOrder.updateMany({
          where: { id: row.billingOrder.id, status: "PENDING", onchainPayment: { txHash: null } },
          data: { status: "EXPIRED", paymentStatusRaw: "uliq_discount_expired" }
        });
      }
    }
    return released;
  });
}

export function mapUliqEntitlementForApi(value: UliqEntitlement): Record<string, unknown> {
  return {
    ...value,
    asOfBlock: value.asOfBlock.toString(),
    computedAt: value.computedAt.toISOString(),
    validUntil: value.validUntil.toISOString()
  };
}
