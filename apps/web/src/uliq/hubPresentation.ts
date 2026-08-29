export type UliqNextAction = "RECONCILE_PURCHASE" | "SETTLE_PURCHASE" | "CLAIM_VESTING" | "BUY_ROUND" | "MANAGE_LOCK" | "NONE";

const TERMINAL_SALE_STATES = new Set(["DEX_LAUNCHED", "COMPLETED", "CANCELLED"]);
const OPEN_TRACKING_STATES = new Set(["SUBMITTED", "SOFT_CONFIRMED", "SAFE", "REVIEW_REQUIRED"]);

export function deriveUliqHubPresentation(input: {
  saleState?: string | null;
  vestingEnd?: string | null;
  unreleasedRaw?: string | null;
  claimableRaw?: string | null;
  purchaseStatuses?: string[];
  trackedPurchaseStatuses?: string[];
  pendingClaim?: boolean;
  lockPositionCount?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const hasPendingSettlement = (input.purchaseStatuses ?? []).includes("PENDING_WITHDRAWAL");
  const hasTrackedPurchase = (input.trackedPurchaseStatuses ?? []).some((status) => OPEN_TRACKING_STATES.has(status));
  const vestingEnded = Boolean(input.vestingEnd && new Date(input.vestingEnd).getTime() <= now.getTime());
  const vestingSettled = vestingEnded
    && BigInt(input.unreleasedRaw ?? "0") === BigInt(0)
    && BigInt(input.claimableRaw ?? "0") === BigInt(0)
    && !input.pendingClaim;
  const saleTerminal = TERMINAL_SALE_STATES.has(input.saleState ?? "");
  const presaleVisible = !(saleTerminal && vestingSettled && !hasPendingSettlement && !hasTrackedPurchase);
  const vestingVisible = !vestingSettled;

  let nextAction: UliqNextAction = "NONE";
  if (hasTrackedPurchase) nextAction = "RECONCILE_PURCHASE";
  else if (hasPendingSettlement) nextAction = "SETTLE_PURCHASE";
  else if (input.pendingClaim || BigInt(input.claimableRaw ?? "0") > BigInt(0)) nextAction = "CLAIM_VESTING";
  else if (input.saleState === "ACTIVE") nextAction = "BUY_ROUND";
  else if ((input.lockPositionCount ?? 0) === 0) nextAction = "MANAGE_LOCK";

  return {
    purchaseVisible: input.saleState === "ACTIVE",
    presaleVisible,
    vestingVisible,
    nextAction
  };
}
