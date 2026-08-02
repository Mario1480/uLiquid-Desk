export function isBillingPaymentExpired(
  expiresAt: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!expiresAt) return true;
  const expiresAtMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

export async function executeBillingWriteIfFresh<T>(params: {
  expiresAt: string | null | undefined;
  now?: () => number;
  write: () => Promise<T>;
}): Promise<{ status: "expired" } | { status: "sent"; value: T }> {
  if (isBillingPaymentExpired(params.expiresAt, (params.now ?? Date.now)())) {
    return { status: "expired" };
  }
  return { status: "sent", value: await params.write() };
}

export function shouldResumeBillingCheckout(params: {
  status: string;
  hasOnchainPayment: boolean;
  hasStoredTxHash: boolean;
}): boolean {
  if (!params.hasOnchainPayment) return false;
  if (["pending", "confirming", "review_required"].includes(params.status)) return true;
  return params.hasStoredTxHash && ["expired", "failed"].includes(params.status);
}

export function selectResumableBillingCheckout<T extends {
  status: string;
  hasOnchainPayment: boolean;
  hasStoredTxHash: boolean;
}>(orders: readonly T[]): T | null {
  return orders.find((order) => (
    order.hasOnchainPayment
    && ["pending", "confirming", "review_required"].includes(order.status)
  )) ?? orders.find((order) => shouldResumeBillingCheckout(order)) ?? null;
}
