const BILLING_GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1_000;

export function addBillingMonths(base: Date, months: number): Date {
  const count = Math.max(1, Math.trunc(months));
  const sourceDay = base.getUTCDate();
  const next = new Date(base);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    0,
    next.getUTCHours(),
    next.getUTCMinutes(),
    next.getUTCSeconds(),
    next.getUTCMilliseconds()
  )).getUTCDate();
  next.setUTCDate(Math.min(sourceDay, lastDay));
  return next;
}

export function addBillingGracePeriod(base: Date): Date {
  return new Date(base.getTime() + BILLING_GRACE_PERIOD_MS);
}

export function planSubscriptionTermWindow(params: {
  now: Date;
  billingMonths: number;
  latestTerm?: { endsAt: Date; graceEndsAt: Date } | null;
  legacyValidUntil?: Date | null;
}): { startsAt: Date; endsAt: Date; graceEndsAt: Date } {
  let startsAt = params.now;
  if (params.latestTerm && params.latestTerm.graceEndsAt.getTime() > params.now.getTime()) {
    startsAt = params.latestTerm.endsAt;
  } else if (
    params.legacyValidUntil
    && addBillingGracePeriod(params.legacyValidUntil).getTime() > params.now.getTime()
  ) {
    startsAt = params.legacyValidUntil;
  }
  const endsAt = addBillingMonths(startsAt, params.billingMonths);
  return { startsAt, endsAt, graceEndsAt: addBillingGracePeriod(endsAt) };
}
