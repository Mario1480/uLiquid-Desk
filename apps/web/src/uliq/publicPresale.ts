export type PublicPresaleRoundId = "round-1" | "round-2";

export type PublicPresaleRound = {
  id: PublicPresaleRoundId;
  number: number;
  label: string;
  contractAddress: `0x${string}`;
  vestingAddress: `0x${string}`;
  paymentCustodyAddress: `0x${string}`;
  state: string;
  purchaseEnabled: boolean;
  configurationStatus: "VALID" | "MISMATCH";
  configurationIssues: string[];
  scheduleSource: "ONCHAIN" | "BACKEND_DRAFT" | "NOT_CONFIGURED";
  saleStart: string | null;
  saleEnd: string | null;
  withdrawalPeriodSeconds: string;
  hardCapUsdcRaw: string;
  allocationCapUliqRaw: string;
  priceUsdcRawPerUliq: string;
  minPurchaseUsdcRaw: string;
  maxPurchaseUsdcRaw: string;
  totalRaisedUsdcRaw: string;
  totalSoldUliqRaw: string;
  pendingAllocationUliqRaw: string;
  pendingPurchaseCount: string;
  finalizedAllocationUliqRaw: string;
  withdrawnAllocationUliqRaw: string;
  initialUnlockBps: string;
  cliffSeconds: string;
  linearVestingDurationSeconds: string;
};

export type PublicPresaleOverview = {
  chainId: number;
  tokenAddress: `0x${string}`;
  paymentTokenAddress: `0x${string}`;
  globalListingAddress: `0x${string}`;
  listingTimestamp: string | null;
  explorerUrl: string | null;
  currentRoundId: PublicPresaleRoundId;
  purchasesEnabled: boolean;
  terms: { version: string | null; textHash: string | null; url: string; ready: boolean };
  rounds: PublicPresaleRound[];
  asOfBlock: string;
  blockHash: string;
  asOfTimestamp: string | null;
};

export type PublicPresaleSession = {
  walletAddress: string;
  chainId: number;
  expiresAt: string;
  termsAccepted: boolean;
  terms: PublicPresaleOverview["terms"];
};

export type PublicPreparedTransaction = {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  expectedSender: string | null;
};

export type PublicPurchase = {
  id: string;
  roundId: PublicPresaleRoundId | null;
  purchaseIdOnchain: string;
  transactionHash: string;
  usdcAmountRaw: string;
  uliqAllocationRaw: string;
  status: string;
  confirmationStatus: string;
  withdrawalDeadline: string;
};

export type PublicTrackedPurchase = {
  id: string;
  roundId: PublicPresaleRoundId | null;
  transactionHash: string;
  confirmationStatus: string;
  usdcAmountRaw: string | null;
  uliqAllocationRaw: string | null;
  maxUsdcAmountRaw: string;
  minUliqAllocationRaw: string;
  purchaseIdOnchain: string | null;
  submittedAt: string;
  onchainPurchase: {
    buyer: string;
    usdcAmountRaw: string;
    uliqAllocationRaw: string;
    purchasedAt: string | null;
    withdrawalDeadline: string | null;
    state: string;
  } | null;
};

export type PublicVestingPosition = {
  roundId: PublicPresaleRoundId;
  contractAddress: string;
  walletAddress: string;
  allocatedRaw: string;
  releasedRaw: string;
  unreleasedRaw: string;
  vestedRaw: string;
  claimableRaw: string;
  listingTimestamp: string | null;
  linearVestingStart: string | null;
  vestingEnd: string | null;
};

export type PublicWalletState = {
  walletAddress: string;
  rounds: Array<{ id: PublicPresaleRoundId; purchasedUsdcRaw: string; maximumPurchasableUsdcRaw: string }>;
  purchases: PublicPurchase[];
  trackedPurchases: PublicTrackedPurchase[];
  vesting: PublicVestingPosition[];
  asOfBlock: string;
  blockHash: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function createPublicPresalePreviewOverview(chainId = 42_161): PublicPresaleOverview {
  const token = (value: bigint, decimals: number) => (value * BigInt(10) ** BigInt(decimals)).toString();
  const round = (input: {
    id: PublicPresaleRoundId;
    number: number;
    allocationUliq: bigint;
    priceUsdcRawPerUliq: bigint;
    hardCapUsdc: bigint;
    minPurchaseUsdc: bigint;
    maxPurchaseUsdc: bigint;
    initialUnlockBps: bigint;
    cliffDays: bigint;
    vestingDays: bigint;
  }): PublicPresaleRound => ({
    id: input.id,
    number: input.number,
    label: `Round ${input.number}`,
    contractAddress: ZERO_ADDRESS,
    vestingAddress: ZERO_ADDRESS,
    paymentCustodyAddress: ZERO_ADDRESS,
    state: "DRAFT",
    purchaseEnabled: false,
    configurationStatus: "VALID",
    configurationIssues: [],
    scheduleSource: "NOT_CONFIGURED",
    saleStart: null,
    saleEnd: null,
    withdrawalPeriodSeconds: "0",
    hardCapUsdcRaw: token(input.hardCapUsdc, 6),
    allocationCapUliqRaw: token(input.allocationUliq, 18),
    priceUsdcRawPerUliq: input.priceUsdcRawPerUliq.toString(),
    minPurchaseUsdcRaw: token(input.minPurchaseUsdc, 6),
    maxPurchaseUsdcRaw: token(input.maxPurchaseUsdc, 6),
    totalRaisedUsdcRaw: "0",
    totalSoldUliqRaw: "0",
    pendingAllocationUliqRaw: "0",
    pendingPurchaseCount: "0",
    finalizedAllocationUliqRaw: "0",
    withdrawnAllocationUliqRaw: "0",
    initialUnlockBps: input.initialUnlockBps.toString(),
    cliffSeconds: (input.cliffDays * BigInt(86_400)).toString(),
    linearVestingDurationSeconds: (input.vestingDays * BigInt(86_400)).toString()
  });

  return {
    chainId: chainId === 421_614 ? 421_614 : 42_161,
    tokenAddress: ZERO_ADDRESS,
    paymentTokenAddress: ZERO_ADDRESS,
    globalListingAddress: ZERO_ADDRESS,
    listingTimestamp: null,
    explorerUrl: null,
    currentRoundId: "round-1",
    purchasesEnabled: false,
    terms: { version: null, textHash: null, url: "/presale/terms", ready: false },
    rounds: [
      round({
        id: "round-1",
        number: 1,
        allocationUliq: BigInt(50_000_000),
        priceUsdcRawPerUliq: BigInt(2_000),
        hardCapUsdc: BigInt(100_000),
        minPurchaseUsdc: BigInt(500),
        maxPurchaseUsdc: BigInt(10_000),
        initialUnlockBps: BigInt(500),
        cliffDays: BigInt(90),
        vestingDays: BigInt(548)
      }),
      round({
        id: "round-2",
        number: 2,
        allocationUliq: BigInt(100_000_000),
        priceUsdcRawPerUliq: BigInt(3_500),
        hardCapUsdc: BigInt(350_000),
        minPurchaseUsdc: BigInt(100),
        maxPurchaseUsdc: BigInt(5_000),
        initialUnlockBps: BigInt(2_500),
        cliffDays: BigInt(0),
        vestingDays: BigInt(274)
      })
    ],
    asOfBlock: "0",
    blockHash: "",
    asOfTimestamp: null
  };
}

export function secondsToDays(value: string): number {
  return Math.round(Number(BigInt(value) / BigInt(86_400)));
}

export function progressPercent(valueRaw: string, capRaw: string): number {
  const cap = BigInt(capRaw || "0");
  if (cap === BigInt(0)) return 0;
  return Number(BigInt(valueRaw || "0") * BigInt(10_000) / cap) / 100;
}

export function countdownLabel(target: string | null, nowMs = Date.now()): string | null {
  if (!target) return null;
  const delta = new Date(target).getTime() - nowMs;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const days = Math.floor(delta / 86_400_000);
  const hours = Math.floor((delta % 86_400_000) / 3_600_000);
  const minutes = Math.floor((delta % 3_600_000) / 60_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}
