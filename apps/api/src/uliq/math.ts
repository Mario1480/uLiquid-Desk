export type UliqDiscountAllocation = {
  baseAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
};

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
