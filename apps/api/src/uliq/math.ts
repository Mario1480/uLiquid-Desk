export type UliqDiscountAllocation = {
  baseAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
};

export const ULIQ_LOCK_GATE_VERSION = "LOCK_GATE_V1" as const;
export const ULIQ_REQUIRED_LOCK_SHARE_BPS = 2_500;
export const ULIQ_PLATFORM_FEE_DISCOUNT_BPS = 0;

export type UliqLockGateFailureCode =
  | "uliq_lock_required"
  | "uliq_lock_amount_insufficient"
  | "uliq_lock_term_insufficient"
  | "uliq_lock_state_stale";

export type UliqLockGatePosition = {
  lockId: string;
  amountRaw: bigint;
  unlockAt: Date;
  withdrawn: boolean;
};

export type UliqLockGateDecision = {
  version: typeof ULIQ_LOCK_GATE_VERSION;
  qualifies: boolean;
  requiredLockedRaw: string;
  qualifyingLockedRaw: string;
  qualifyingLockIds: string[];
  requiredBenefitUntil: Date;
  coverageShareBps: number;
  failureReason: UliqLockGateFailureCode | null;
};

export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) throw new Error("uliq_invalid_unsigned_ratio");
  if (value === 0n) return 0n;
  return (value + divisor - 1n) / divisor;
}

export function calculateRequiredLockRaw(params: {
  tierMinimumUsdScaled: bigint;
  referencePriceUsdScaled: bigint;
  coverageShareBps?: number;
}): bigint {
  const coverageShareBps = params.coverageShareBps ?? ULIQ_REQUIRED_LOCK_SHARE_BPS;
  if (!Number.isSafeInteger(coverageShareBps) || coverageShareBps < 0 || coverageShareBps > 10_000) {
    throw new Error("uliq_invalid_lock_share_bps");
  }
  if (params.tierMinimumUsdScaled < 0n || params.referencePriceUsdScaled <= 0n) {
    throw new Error("uliq_invalid_lock_gate_price");
  }
  const tokenScale = 10n ** 18n;
  const tierMinimumRaw = ceilDiv(
    params.tierMinimumUsdScaled * tokenScale,
    params.referencePriceUsdScaled
  );
  return ceilDiv(tierMinimumRaw * BigInt(coverageShareBps), 10_000n);
}

export function decideUliqLockGate(params: {
  requiredLockedRaw: bigint;
  requiredBenefitUntil: Date;
  positions: UliqLockGatePosition[];
  stateFresh: boolean;
  coverageShareBps?: number;
}): UliqLockGateDecision {
  if (params.requiredLockedRaw < 0n || Number.isNaN(params.requiredBenefitUntil.getTime())) {
    throw new Error("uliq_invalid_lock_gate_input");
  }
  const coverageShareBps = params.coverageShareBps ?? ULIQ_REQUIRED_LOCK_SHARE_BPS;
  const active = params.positions.filter((position) => !position.withdrawn && position.amountRaw > 0n);
  const qualifying = active.filter((position) => (
    position.unlockAt.getTime() >= params.requiredBenefitUntil.getTime()
  ));
  const qualifyingLockedRaw = qualifying.reduce((sum, position) => sum + position.amountRaw, 0n);
  const qualifies = params.stateFresh
    && qualifying.length > 0
    && qualifyingLockedRaw >= params.requiredLockedRaw;
  let failureReason: UliqLockGateFailureCode | null = null;
  if (!params.stateFresh) failureReason = "uliq_lock_state_stale";
  else if (!qualifies && active.length === 0) failureReason = "uliq_lock_required";
  else if (!qualifies && qualifying.length === 0) failureReason = "uliq_lock_term_insufficient";
  else if (!qualifies) failureReason = "uliq_lock_amount_insufficient";
  return {
    version: ULIQ_LOCK_GATE_VERSION,
    qualifies,
    requiredLockedRaw: params.requiredLockedRaw.toString(),
    qualifyingLockedRaw: qualifyingLockedRaw.toString(),
    qualifyingLockIds: qualifying.map((position) => position.lockId),
    requiredBenefitUntil: params.requiredBenefitUntil,
    coverageShareBps,
    failureReason
  };
}

export function calculateUliqDiscountCents(baseAmountCents: number, discountBps: number): UliqDiscountAllocation {
  if (!Number.isSafeInteger(baseAmountCents) || baseAmountCents <= 0) throw new Error("uliq_invalid_base_amount");
  if (!Number.isSafeInteger(discountBps) || discountBps < 0 || discountBps > 10_000) {
    throw new Error("uliq_invalid_discount_bps");
  }
  const discountAmountCents = Number(BigInt(baseAmountCents) * BigInt(discountBps) / 10_000n);
  const finalAmountCents = baseAmountCents - discountAmountCents;
  if (finalAmountCents <= 0) throw new Error("uliq_zero_amount_checkout_not_supported");
  return { baseAmountCents, discountAmountCents, finalAmountCents };
}

export function allocateUliqDiscountAcrossLines(
  lineBaseAmountsCents: number[],
  discountAmountCents: number
): Array<UliqDiscountAllocation> {
  if (lineBaseAmountsCents.length === 0) throw new Error("uliq_empty_cart");
  if (lineBaseAmountsCents.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("uliq_invalid_line_amount");
  }
  const total = lineBaseAmountsCents.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || discountAmountCents < 0 || discountAmountCents >= total) {
    throw new Error("uliq_invalid_discount_amount");
  }
  let allocated = 0;
  return lineBaseAmountsCents.map((baseAmountCents, index) => {
    const discount = index === lineBaseAmountsCents.length - 1
      ? discountAmountCents - allocated
      : Number(BigInt(discountAmountCents) * BigInt(baseAmountCents) / BigInt(total));
    allocated += discount;
    return {
      baseAmountCents,
      discountAmountCents: discount,
      finalAmountCents: baseAmountCents - discount
    };
  });
}
