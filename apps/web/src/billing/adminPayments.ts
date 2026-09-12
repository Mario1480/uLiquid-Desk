export const ORDER_STATUSES = ["PENDING", "CONFIRMING", "PAID", "FAILED", "EXPIRED", "REVIEW_REQUIRED"] as const;
export type AdminPaymentOrder = {
  id: string; merchantOrderId: string; provider: string; status: string;
  createdAt: string | null; updatedAt: string | null; paidAt: string | null; expiresAt: string | null;
  user: { id: string; email: string };
  amountCents: number; currency: string; baseAmountCents: number | null;
  discountAmountCents: number | null; finalAmountCents: number | null; paymentStatusRaw: string | null;
  items: Array<{ id: string; name: string; code: string; kind: string; quantity: number;
    catalogFallback: boolean; unitPriceCents: number; lineAmountCents: number;
    discountAmountCents: number | null; finalAmountCents: number | null; currency: string }>;
  payment: { chainId: number; txHash: string | null; explorerUrl: string | null; verifiedAt: string | null;
    confirmations: number; expectedAmountRaw: string; tokenDecimals: number; tokenAddress: string;
    expectedSenderAddress: string; treasuryAddress: string; treasuryConfigRevision: number;
    blockNumber: string | null; blockHash: string | null; verificationAttempts: number;
    lastCheckedAt: string | null; nextRetryAt: string | null; discoveredAt: string | null } | null;
  activation: {
    evidence: "TERM_RECORDED" | "ENTRIES_RECORDED" | "NO_LINKED_EVIDENCE";
    term: { id: string; plan: string | null; status: string; startsAt: string | null; endsAt: string | null;
      graceEndsAt: string | null; activatedAt: string | null; expiredAt: string | null } | null;
    capacityGrantCount: number; creditEntryCount: number;
    subscriptionSync: { id: string; entitlementSyncPending: boolean; entitlementSyncAttempts: number;
      entitlementSyncedAt: string | null } | null;
  };
};
export type AdminPaymentDetail = AdminPaymentOrder & {
  capacityGrants: Array<{ id: string; createdAt: string | null; validUntil: string | null; planScope: string | null;
    deltaRunningBots: number; deltaRunningPredictionsAi: number; deltaRunningPredictionsComposite: number }>;
  creditEntries: Array<{ id: string; createdAt: string | null; reason: string; deltaCredits: string }>;
};
export type AdminPaymentList = { items: AdminPaymentOrder[]; page: number; pageSize: number; total: number; totalPages: number };

export function formatBillingAmount(cents: number, currency: string, locale: string): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
}

export function formatBillingToken(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return raw;
  if (!decimals) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

export function paymentEvidence(payment: AdminPaymentOrder["payment"]): "VERIFIED" | "SUBMITTED" | "AWAITING" | "PROVIDER" {
  return !payment ? "PROVIDER" : payment.verifiedAt ? "VERIFIED" : payment.txHash ? "SUBMITTED" : "AWAITING";
}

export function subscriptionSyncEvidence(sync: AdminPaymentOrder["activation"]["subscriptionSync"]): "PENDING" | "SYNCED" | "UNKNOWN" {
  return sync?.entitlementSyncPending ? "PENDING" : sync?.entitlementSyncedAt ? "SYNCED" : "UNKNOWN";
}
