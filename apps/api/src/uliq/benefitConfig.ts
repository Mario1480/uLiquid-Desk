export const ULIQ_APPROVED_TESTNET_BENEFIT_BPS = [
  { code: "BASIC", subscriptionDiscountBps: 0, aiDiscountBps: 0 },
  { code: "BRONZE", subscriptionDiscountBps: 0, aiDiscountBps: 500 },
  { code: "SILVER", subscriptionDiscountBps: 500, aiDiscountBps: 1_000 },
  { code: "GOLD", subscriptionDiscountBps: 1_000, aiDiscountBps: 1_500 },
  { code: "PLATINUM", subscriptionDiscountBps: 1_500, aiDiscountBps: 2_000 }
] as const;
