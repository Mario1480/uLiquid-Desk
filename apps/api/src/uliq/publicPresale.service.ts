import {
  decodeEventLog,
  encodeFunctionData,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import {
  uliqGlobalListingAbi,
  uliqPresaleRoundAbi,
  uliqPresaleRoundVestingAbi,
  uliqTokenAbi
} from "./abi.js";
import {
  getUliqPublicPresaleConfig,
  type UliqPublicPresaleConfig,
  type UliqPublicPresaleRoundConfig,
  type UliqPublicPresaleRoundId
} from "./publicPresale.config.js";
import { getUliqPresaleRoundSchedule } from "./presaleRoundSchedule.js";
import { mapUliqPurchaseTrackingForApi } from "./purchaseTracking.service.js";
import {
  createUliqRpcPair,
  getConsistentBlockAt,
  getConsistentFinalizedBlock,
  getConsistentSafeBlock,
  withUliqRpcFailover,
  type UliqRpcPair
} from "./rpc.js";
import {
  databaseUint256Decimal,
  normalizeUliqAddress,
  parseDatabaseUint256Decimal,
  parseUint256Decimal
} from "./uint256.js";

const SALE_STATES = [
  "DRAFT",
  "READY",
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "LISTING_PENDING",
  "LISTING_LAUNCHED",
  "COMPLETED"
] as const;
const PURCHASE_STATES = ["PENDING_WITHDRAWAL", "WITHDRAWN", "FINALIZED"] as const;
const ACTIVE_TRACKING_STATUSES = ["SUBMITTED", "SOFT_CONFIRMED", "SAFE"] as const;
const RECEIPT_REVIEW_AFTER_MS = 30 * 60 * 1_000;

function timestamp(value: bigint): string | null {
  return value === 0n ? null : new Date(Number(value) * 1_000).toISOString();
}

function transactionRequest(chainId: number, to: `0x${string}`, data: `0x${string}`, expectedSender?: string) {
  return { chainId, to, data, value: "0", expectedSender: expectedSender ?? null };
}

function sameAddress(left: unknown, right: unknown): boolean {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function comparableRpcValue(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "bigint") return nested.toString();
    if (typeof nested === "string" && nested.startsWith("0x")) return nested.toLowerCase();
    return nested;
  });
}

function roundIdForContract(config: UliqPublicPresaleConfig, address: unknown): UliqPublicPresaleRoundId | null {
  return config.rounds.find((round) => sameAddress(round.contractAddress, address))?.id ?? null;
}

function normalizedTransactionHash(value: unknown): Hex {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) throw new Error("invalid_transaction_hash");
  return normalized as Hex;
}

function purchaseCreatedFromReceipt(receipt: any, round: UliqPublicPresaleRoundConfig) {
  const matches: Array<{ args: any; logIndex: number }> = [];
  for (const log of receipt.logs ?? []) {
    if (!sameAddress(log.address, round.contractAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: uliqPresaleRoundAbi,
        data: log.data,
        topics: log.topics,
        strict: true
      });
      if (decoded.eventName !== "PurchaseCreated" || typeof log.logIndex !== "number") continue;
      if (Number(decoded.args.roundId) !== round.number) continue;
      matches.push({ args: decoded.args, logIndex: log.logIndex });
    } catch {
      // Other events from the same round contract are not purchase evidence.
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function isReceiptNotFound(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isReceiptNotFound);
  const reason = `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : String(error)}`;
  return /TransactionReceiptNotFound|transaction receipt.*not found|receipt.*could not be found/i.test(reason);
}

async function getConsistentTransactionReceipt(rpc: UliqRpcPair, transactionHash: Hex): Promise<any> {
  const results = await Promise.allSettled([
    rpc.primary.getTransactionReceipt({ hash: transactionHash }),
    rpc.secondary.getTransactionReceipt({ hash: transactionHash })
  ]);
  if (results[0].status === "rejected" && results[1].status === "rejected") {
    throw new AggregateError([results[0].reason, results[1].reason], "uliq_rpc_unavailable");
  }
  if (results[0].status !== "fulfilled" || results[1].status !== "fulfilled") {
    throw new Error("uliq_rpc_receipt_mismatch");
  }
  if (comparableRpcValue(results[0].value) !== comparableRpcValue(results[1].value)) {
    throw new Error("uliq_rpc_receipt_mismatch");
  }
  return results[0].value;
}

async function readRoundAtBlock(
  client: PublicClient,
  config: UliqPublicPresaleConfig,
  round: UliqPublicPresaleRoundConfig,
  blockNumber: bigint
) {
  const [roundValues, vestingValues] = await Promise.all([
    Promise.all([
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "roundId", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "uliq", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "usdc", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "paymentCustody", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "vesting", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "globalListing", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "predecessor", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "state", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleStart", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "saleEnd", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "withdrawalPeriodSeconds", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "hardCapUsdcRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "allocationCapUliqRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "priceUsdcRawPerUliq", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "minPurchaseUsdcRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "maxPurchaseUsdcRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "totalRaisedUsdcRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "totalSoldUliqRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "pendingAllocationUliqRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "pendingPurchaseCount", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "finalizedAllocationUliqRaw", blockNumber }),
      client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "withdrawnAllocationUliqRaw", blockNumber })
    ]),
    Promise.all([
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "token", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "globalListing", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "presale", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "initialUnlockBps", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "cliffSeconds", blockNumber }),
      client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "linearVestingDurationSeconds", blockNumber })
    ])
  ]);

  const issues: string[] = [];
  const expectedPredecessor = round.number === 1 ? zeroAddress : config.rounds[0].contractAddress;
  const addressChecks: Array<[unknown, unknown, string]> = [
    [roundValues[1], config.tokenAddress, "token_address_mismatch"],
    [roundValues[2], config.usdcAddress, "payment_token_address_mismatch"],
    [roundValues[3], round.paymentCustodyAddress, "payment_custody_address_mismatch"],
    [roundValues[4], round.vestingAddress, "vesting_address_mismatch"],
    [roundValues[5], config.globalListingAddress, "listing_address_mismatch"],
    [roundValues[6], expectedPredecessor, "predecessor_address_mismatch"],
    [vestingValues[0], config.tokenAddress, "vesting_token_address_mismatch"],
    [vestingValues[1], config.globalListingAddress, "vesting_listing_address_mismatch"],
    [vestingValues[2], round.contractAddress, "vesting_presale_address_mismatch"]
  ];
  for (const [actual, expected, reason] of addressChecks) if (!sameAddress(actual, expected)) issues.push(reason);
  const numericChecks: Array<[unknown, bigint, string]> = [
    [roundValues[0], BigInt(round.number), "round_id_mismatch"],
    [roundValues[11], round.expected.hardCapUsdcRaw, "hard_cap_mismatch"],
    [roundValues[12], round.expected.allocationUliqRaw, "allocation_cap_mismatch"],
    [roundValues[13], round.expected.priceUsdcRawPerUliq, "price_mismatch"],
    [roundValues[14], round.expected.minPurchaseUsdcRaw, "minimum_purchase_mismatch"],
    [roundValues[15], round.expected.maxPurchaseUsdcRaw, "maximum_purchase_mismatch"],
    [vestingValues[3], round.expected.initialUnlockBps, "initial_unlock_mismatch"],
    [vestingValues[4], round.expected.cliffSeconds, "cliff_mismatch"],
    [vestingValues[5], round.expected.linearVestingDurationSeconds, "vesting_duration_mismatch"]
  ];
  for (const [actual, expected, reason] of numericChecks) if (BigInt(actual as bigint) !== expected) issues.push(reason);

  return {
    paymentCustodyAddress: String(roundValues[3]),
    state: SALE_STATES[Number(roundValues[7])] ?? "UNKNOWN",
    saleStartRaw: BigInt(roundValues[8] as bigint),
    saleEndRaw: BigInt(roundValues[9] as bigint),
    withdrawalPeriodSeconds: BigInt(roundValues[10] as bigint),
    hardCapUsdcRaw: BigInt(roundValues[11] as bigint),
    allocationCapUliqRaw: BigInt(roundValues[12] as bigint),
    priceUsdcRawPerUliq: BigInt(roundValues[13] as bigint),
    minPurchaseUsdcRaw: BigInt(roundValues[14] as bigint),
    maxPurchaseUsdcRaw: BigInt(roundValues[15] as bigint),
    totalRaisedUsdcRaw: BigInt(roundValues[16] as bigint),
    totalSoldUliqRaw: BigInt(roundValues[17] as bigint),
    pendingAllocationUliqRaw: BigInt(roundValues[18] as bigint),
    pendingPurchaseCount: BigInt(roundValues[19] as bigint),
    finalizedAllocationUliqRaw: BigInt(roundValues[20] as bigint),
    withdrawnAllocationUliqRaw: BigInt(roundValues[21] as bigint),
    initialUnlockBps: BigInt(vestingValues[3]),
    cliffSeconds: BigInt(vestingValues[4] as bigint),
    linearVestingDurationSeconds: BigInt(vestingValues[5] as bigint),
    issues
  };
}

export class UliqPublicPresaleService {
  constructor(
    private readonly db: any,
    private readonly config: UliqPublicPresaleConfig = getUliqPublicPresaleConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async getOverview() {
    const [head, schedule] = await Promise.all([
      getConsistentFinalizedBlock(this.rpc),
      getUliqPresaleRoundSchedule(this.db)
    ]);
    const readSnapshot = (client: PublicClient) => Promise.all([
      Promise.all([
        client.readContract({ address: this.config.globalListingAddress, abi: uliqGlobalListingAbi, functionName: "roundOne", blockNumber: head.number }),
        client.readContract({ address: this.config.globalListingAddress, abi: uliqGlobalListingAbi, functionName: "roundTwo", blockNumber: head.number }),
        client.readContract({ address: this.config.globalListingAddress, abi: uliqGlobalListingAbi, functionName: "listingTimestamp", blockNumber: head.number })
      ]),
      Promise.all(this.config.rounds.map((round) => readRoundAtBlock(client, this.config, round, head.number)))
    ]);
    const [primarySnapshot, secondarySnapshot] = await Promise.all([
      readSnapshot(this.rpc.primary),
      readSnapshot(this.rpc.secondary)
    ]);
    if (comparableRpcValue(primarySnapshot) !== comparableRpcValue(secondarySnapshot)) {
      throw new Error("uliq_public_presale_rpc_state_mismatch");
    }
    const [listing, rounds] = primarySnapshot;

    const listingIssues: string[] = [];
    if (!sameAddress(listing[0], this.config.rounds[0].contractAddress)) listingIssues.push("listing_round_1_mismatch");
    if (!sameAddress(listing[1], this.config.rounds[1].contractAddress)) listingIssues.push("listing_round_2_mismatch");
    const scheduleById = new Map(schedule.rounds.map((round: any) => [round.id, round]));
    const mappedRounds = this.config.rounds.map((round, index) => {
      const read = rounds[index];
      const draft = scheduleById.get(round.id) as any;
      const onchainScheduled = read.saleStartRaw > 0n && read.saleEndRaw > 0n;
      const issues = [...listingIssues, ...read.issues];
      const purchaseEnabled = Boolean(
        this.config.purchasesEnabled
        && this.config.terms.ready
        && issues.length === 0
        && read.state === "ACTIVE"
        && head.timestamp >= read.saleStartRaw
        && head.timestamp < read.saleEndRaw
      );
      return {
        id: round.id,
        number: round.number,
        label: `Round ${round.number}`,
        contractAddress: round.contractAddress,
        vestingAddress: round.vestingAddress,
        paymentCustodyAddress: read.paymentCustodyAddress,
        state: read.state,
        purchaseEnabled,
        configurationStatus: issues.length === 0 ? "VALID" : "MISMATCH",
        configurationIssues: issues,
        scheduleSource: onchainScheduled ? "ONCHAIN" : draft?.saleStart && draft?.saleEnd ? "BACKEND_DRAFT" : "NOT_CONFIGURED",
        saleStart: onchainScheduled ? timestamp(read.saleStartRaw) : draft?.saleStart ?? null,
        saleEnd: onchainScheduled ? timestamp(read.saleEndRaw) : draft?.saleEnd ?? null,
        withdrawalPeriodSeconds: read.withdrawalPeriodSeconds.toString(),
        hardCapUsdcRaw: read.hardCapUsdcRaw.toString(),
        allocationCapUliqRaw: read.allocationCapUliqRaw.toString(),
        priceUsdcRawPerUliq: read.priceUsdcRawPerUliq.toString(),
        minPurchaseUsdcRaw: read.minPurchaseUsdcRaw.toString(),
        maxPurchaseUsdcRaw: read.maxPurchaseUsdcRaw.toString(),
        totalRaisedUsdcRaw: read.totalRaisedUsdcRaw.toString(),
        totalSoldUliqRaw: read.totalSoldUliqRaw.toString(),
        pendingAllocationUliqRaw: read.pendingAllocationUliqRaw.toString(),
        pendingPurchaseCount: read.pendingPurchaseCount.toString(),
        finalizedAllocationUliqRaw: read.finalizedAllocationUliqRaw.toString(),
        withdrawnAllocationUliqRaw: read.withdrawnAllocationUliqRaw.toString(),
        initialUnlockBps: read.initialUnlockBps.toString(),
        cliffSeconds: read.cliffSeconds.toString(),
        linearVestingDurationSeconds: read.linearVestingDurationSeconds.toString()
      };
    });
    const active = mappedRounds.find((round) => round.state === "ACTIVE")
      ?? mappedRounds.find((round) => !["COMPLETED", "LISTING_LAUNCHED"].includes(round.state))
      ?? mappedRounds[1];
    return {
      chainId: this.config.chainId,
      tokenAddress: this.config.tokenAddress,
      paymentTokenAddress: this.config.usdcAddress,
      globalListingAddress: this.config.globalListingAddress,
      listingTimestamp: timestamp(BigInt(listing[2] as bigint)),
      explorerUrl: this.config.explorerUrl || null,
      currentRoundId: active.id,
      purchasesEnabled: this.config.purchasesEnabled,
      terms: this.config.terms,
      rounds: mappedRounds,
      asOfBlock: head.number.toString(),
      blockHash: head.hash,
      asOfTimestamp: timestamp(head.timestamp)
    };
  }

  async getWalletState(walletInput: unknown) {
    const walletAddress = normalizeUliqAddress(walletInput, "wallet_address").toLowerCase();
    const head = await getConsistentFinalizedBlock(this.rpc);
    const addresses = this.config.rounds.map((round) => round.contractAddress.toLowerCase());
    const [purchases, trackedPurchases, walletReads, vesting] = await Promise.all([
      this.db.uliqPresalePurchase.findMany({
        where: {
          chainId: this.config.chainId,
          walletAddress,
          presaleContractAddress: { in: addresses }
        },
        orderBy: [{ purchaseBlockNumber: "desc" }, { logIndex: "desc" }]
      }),
      this.db.uliqPurchaseTracking.findMany({
        where: {
          chainId: this.config.chainId,
          walletAddress,
          presaleContractAddress: { in: addresses }
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: 100
      }),
      withUliqRpcFailover(this.rpc, (client) => Promise.all(this.config.rounds.map((round) => Promise.all([
        client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "purchasedUsdcRawByBuyer", args: [walletAddress as `0x${string}`], blockNumber: head.number }),
        client.readContract({ address: round.contractAddress, abi: uliqPresaleRoundAbi, functionName: "maximumPurchasableUsdcRaw", args: [walletAddress as `0x${string}`], blockNumber: head.number })
      ])))).then((result) => result.value),
      this.readVestingAtBlock(walletAddress as `0x${string}`, head.number)
    ]);
    const canonicalHashes = new Set(purchases.map((row: any) => String(row.transactionHash).toLowerCase()));
    const mappedTrackedPurchases = await Promise.all(trackedPurchases
      .filter((row: any) => !canonicalHashes.has(String(row.transactionHash).toLowerCase()))
      .map(async (row: any) => {
        const round = this.config.rounds.find((item) => sameAddress(item.contractAddress, row.presaleContractAddress));
        let onchainPurchase = null;
        if (round && row.purchaseIdOnchain !== null && row.purchaseIdOnchain !== undefined) {
          try {
            onchainPurchase = await this.readPurchase(
              round,
              parseDatabaseUint256Decimal(row.purchaseIdOnchain, "tracking_purchase_id_onchain")
            );
          } catch {
            onchainPurchase = null;
          }
        }
        return {
          ...mapUliqPurchaseTrackingForApi(row),
          roundId: round?.id ?? null,
          onchainPurchase
        };
      }));
    return {
      walletAddress,
      rounds: this.config.rounds.map((round, index) => ({
        id: round.id,
        purchasedUsdcRaw: BigInt(walletReads[index][0] as bigint).toString(),
        maximumPurchasableUsdcRaw: BigInt(walletReads[index][1] as bigint).toString()
      })),
      purchases: purchases.map((row: any) => ({
        ...row,
        id: String(row.id),
        roundId: roundIdForContract(this.config, row.presaleContractAddress),
        purchaseIdOnchain: databaseUint256Decimal(row.purchaseIdOnchain, "purchase_id_onchain"),
        usdcAmountRaw: databaseUint256Decimal(row.usdcAmountRaw, "purchase_usdc_amount_raw"),
        uliqAllocationRaw: databaseUint256Decimal(row.uliqAllocationRaw, "purchase_uliq_allocation_raw"),
        purchaseBlockNumber: BigInt(row.purchaseBlockNumber).toString(),
        confirmationStatus: "FINALIZED"
      })),
      trackedPurchases: mappedTrackedPurchases,
      vesting,
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
  }

  async getWalletStateForUser(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true }
    });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    return this.getWalletState(user.walletAddress);
  }

  async quote(roundId: unknown, walletInput: unknown, requestedUsdcRawInput: unknown) {
    const round = this.round(roundId);
    const wallet = normalizeUliqAddress(walletInput, "wallet_address").toLowerCase() as `0x${string}`;
    const requestedUsdcRaw = parseUint256Decimal(requestedUsdcRawInput, "requested_usdc_raw");
    const overview = await this.getOverview();
    const roundOverview = overview.rounds.find((item) => item.id === round.id)!;
    if (!roundOverview.purchaseEnabled) throw new Error("uliq_public_presale_round_not_active");
    const blockNumber = BigInt(overview.asOfBlock);
    const quoteRequest = (client: PublicClient) => client.readContract({
      address: round.contractAddress,
      abi: uliqPresaleRoundAbi,
      functionName: "quotePurchase",
      args: [wallet, requestedUsdcRaw],
      blockNumber
    });
    const [primaryQuote, secondaryQuote] = await Promise.all([
      quoteRequest(this.rpc.primary),
      quoteRequest(this.rpc.secondary)
    ]);
    if (comparableRpcValue(primaryQuote) !== comparableRpcValue(secondaryQuote)) {
      throw new Error("uliq_public_presale_rpc_quote_mismatch");
    }
    const [acceptedUsdcRaw, uliqAllocationRaw] = primaryQuote;
    return {
      roundId: round.id,
      requestedUsdcRaw: requestedUsdcRaw.toString(),
      acceptedUsdcRaw: BigInt(acceptedUsdcRaw).toString(),
      uliqAllocationRaw: BigInt(uliqAllocationRaw).toString(),
      partialFill: BigInt(acceptedUsdcRaw) < requestedUsdcRaw,
      asOfBlock: overview.asOfBlock,
      blockHash: overview.blockHash
    };
  }

  async preparePurchase(params: {
    roundId: unknown;
    walletAddress: unknown;
    maxUsdcAmountRaw: unknown;
    minUliqAllocationRaw: unknown;
  }) {
    const round = this.round(params.roundId);
    const wallet = normalizeUliqAddress(params.walletAddress, "wallet_address").toLowerCase();
    const maxUsdcAmountRaw = parseUint256Decimal(params.maxUsdcAmountRaw, "max_usdc_amount_raw");
    const minUliqAllocationRaw = parseUint256Decimal(params.minUliqAllocationRaw, "min_uliq_allocation_raw");
    const quote = await this.quote(round.id, wallet, maxUsdcAmountRaw);
    if (BigInt(quote.acceptedUsdcRaw) === 0n || BigInt(quote.uliqAllocationRaw) < minUliqAllocationRaw) {
      throw new Error("uliq_public_presale_quote_mismatch");
    }
    const overview = await this.getOverview();
    const roundOverview = overview.rounds.find((item) => item.id === round.id)!;
    return {
      approval: transactionRequest(this.config.chainId, this.config.usdcAddress, encodeFunctionData({
        abi: uliqTokenAbi,
        functionName: "approve",
        args: [roundOverview.paymentCustodyAddress as `0x${string}`, maxUsdcAmountRaw]
      }), wallet),
      purchase: transactionRequest(this.config.chainId, round.contractAddress, encodeFunctionData({
        abi: uliqPresaleRoundAbi,
        functionName: "buy",
        args: [maxUsdcAmountRaw, minUliqAllocationRaw]
      }), wallet)
    };
  }

  async prepareWithdraw(roundId: unknown, walletInput: unknown, purchaseIdInput: unknown) {
    const round = this.round(roundId);
    const wallet = normalizeUliqAddress(walletInput, "wallet_address").toLowerCase();
    const purchaseId = parseUint256Decimal(purchaseIdInput, "purchase_id");
    const purchase = await this.readPurchase(round, purchaseId);
    if (purchase.buyer !== wallet) throw new Error("purchase_wallet_mismatch");
    if (purchase.state !== "PENDING_WITHDRAWAL") throw new Error("purchase_not_pending");
    return transactionRequest(this.config.chainId, round.contractAddress, encodeFunctionData({
      abi: uliqPresaleRoundAbi,
      functionName: "withdrawPurchase",
      args: [purchaseId]
    }), wallet);
  }

  async prepareFinalize(roundId: unknown, purchaseIdInput: unknown) {
    const round = this.round(roundId);
    const purchaseId = parseUint256Decimal(purchaseIdInput, "purchase_id");
    const purchase = await this.readPurchase(round, purchaseId);
    if (purchase.state !== "PENDING_WITHDRAWAL") throw new Error("purchase_not_pending");
    return transactionRequest(this.config.chainId, round.contractAddress, encodeFunctionData({
      abi: uliqPresaleRoundAbi,
      functionName: "finalizePurchase",
      args: [purchaseId]
    }));
  }

  async prepareClaim(roundId: unknown, walletInput: unknown) {
    const round = this.round(roundId);
    const wallet = normalizeUliqAddress(walletInput, "wallet_address").toLowerCase();
    return transactionRequest(this.config.chainId, round.vestingAddress, encodeFunctionData({
      abi: uliqPresaleRoundVestingAbi,
      functionName: "claim"
    }), wallet);
  }

  async trackSubmitted(params: {
    roundId: unknown;
    walletAddress: unknown;
    transactionHash: unknown;
    maxUsdcAmountRaw: unknown;
    minUliqAllocationRaw: unknown;
  }) {
    const round = this.round(params.roundId);
    const walletAddress = normalizeUliqAddress(params.walletAddress, "wallet_address").toLowerCase();
    const transactionHash = normalizedTransactionHash(params.transactionHash);
    const maxUsdcAmountRaw = parseUint256Decimal(params.maxUsdcAmountRaw, "max_usdc_amount_raw");
    const minUliqAllocationRaw = parseUint256Decimal(params.minUliqAllocationRaw, "min_uliq_allocation_raw");
    if (maxUsdcAmountRaw === 0n || minUliqAllocationRaw === 0n) throw new Error("invalid_purchase_tracking_amount");
    const existing = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (existing) {
      if (!sameAddress(existing.walletAddress, walletAddress) || !sameAddress(existing.presaleContractAddress, round.contractAddress)) {
        throw new Error("purchase_tracking_owner_mismatch");
      }
      return { ...mapUliqPurchaseTrackingForApi(existing), roundId: round.id };
    }
    const linkedUser = await this.db.user.findFirst({
      where: { walletAddress: { equals: walletAddress, mode: "insensitive" } },
      select: { id: true }
    });
    const created = await this.db.uliqPurchaseTracking.create({
      data: {
        chainId: this.config.chainId,
        presaleContractAddress: round.contractAddress.toLowerCase(),
        transactionHash,
        userId: linkedUser?.id ?? null,
        walletAddress,
        status: "SUBMITTED",
        maxUsdcAmountRaw: maxUsdcAmountRaw.toString(),
        minUliqAllocationRaw: minUliqAllocationRaw.toString()
      }
    });
    return { ...mapUliqPurchaseTrackingForApi(created), roundId: round.id };
  }

  async refreshTracking(roundId: unknown, walletInput: unknown, transactionHashInput: unknown) {
    const round = this.round(roundId);
    const walletAddress = normalizeUliqAddress(walletInput, "wallet_address").toLowerCase();
    const transactionHash = normalizedTransactionHash(transactionHashInput);
    const row = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (!row || !sameAddress(row.walletAddress, walletAddress) || !sameAddress(row.presaleContractAddress, round.contractAddress)) {
      throw new Error("purchase_tracking_not_found");
    }
    const reconciled = await this.reconcileRow(row, round, new Date());
    return { ...mapUliqPurchaseTrackingForApi(reconciled), roundId: round.id };
  }

  async replaceTracking(params: {
    roundId: unknown;
    walletAddress: unknown;
    transactionHash: unknown;
    replacementTransactionHash: unknown;
    reason?: "cancelled" | "replaced" | "repriced";
  }) {
    const round = this.round(params.roundId);
    const walletAddress = normalizeUliqAddress(params.walletAddress, "wallet_address").toLowerCase();
    const transactionHash = normalizedTransactionHash(params.transactionHash);
    const replacementTransactionHash = normalizedTransactionHash(params.replacementTransactionHash);
    if (transactionHash === replacementTransactionHash) return this.refreshTracking(round.id, walletAddress, transactionHash);
    const existing = await this.db.uliqPurchaseTracking.findUnique({
      where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash } }
    });
    if (!existing || !sameAddress(existing.walletAddress, walletAddress) || !sameAddress(existing.presaleContractAddress, round.contractAddress)) {
      throw new Error("purchase_tracking_not_found");
    }
    const replacement = await this.db.$transaction(async (tx: any) => {
      if (params.reason === "cancelled") {
        return tx.uliqPurchaseTracking.update({
          where: { id: existing.id },
          data: { status: "FAILED", statusReason: `transaction_cancelled_by:${replacementTransactionHash}`, lastCheckedAt: new Date() }
        });
      }
      const duplicate = await tx.uliqPurchaseTracking.findUnique({
        where: { chainId_transactionHash: { chainId: this.config.chainId, transactionHash: replacementTransactionHash } }
      });
      if (duplicate && (!sameAddress(duplicate.walletAddress, walletAddress) || !sameAddress(duplicate.presaleContractAddress, round.contractAddress))) {
        throw new Error("purchase_tracking_owner_mismatch");
      }
      const next = duplicate ?? await tx.uliqPurchaseTracking.create({
        data: {
          chainId: existing.chainId,
          presaleContractAddress: existing.presaleContractAddress,
          transactionHash: replacementTransactionHash,
          userId: existing.userId ?? null,
          walletAddress: existing.walletAddress,
          status: "SUBMITTED",
          maxUsdcAmountRaw: existing.maxUsdcAmountRaw,
          minUliqAllocationRaw: existing.minUliqAllocationRaw
        }
      });
      await tx.uliqPurchaseTracking.update({
        where: { id: existing.id },
        data: { status: "FAILED", statusReason: `transaction_${params.reason ?? "replaced"}_by:${replacementTransactionHash}`, lastCheckedAt: new Date() }
      });
      return next;
    });
    return { ...mapUliqPurchaseTrackingForApi(replacement), roundId: round.id };
  }

  async reconcilePending(limit = 100) {
    const rows = await this.db.uliqPurchaseTracking.findMany({
      where: {
        chainId: this.config.chainId,
        presaleContractAddress: { in: this.config.rounds.map((round) => round.contractAddress.toLowerCase()) },
        OR: [
          { status: { in: [...ACTIVE_TRACKING_STATUSES] } },
          { status: "FINALIZED", statusReason: "network_finalized" }
        ]
      },
      orderBy: [{ lastCheckedAt: "asc" }, { submittedAt: "asc" }],
      take: Math.max(1, Math.min(500, limit))
    });
    let checked = 0;
    let errors = 0;
    for (const row of rows) {
      const round = this.config.rounds.find((item) => sameAddress(item.contractAddress, row.presaleContractAddress));
      if (!round) continue;
      try {
        await this.reconcileRow(row, round, new Date());
        checked += 1;
      } catch {
        errors += 1;
      }
    }
    return { checked, errors };
  }

  private async readVestingAtBlock(wallet: `0x${string}`, blockNumber: bigint) {
    const listing = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: this.config.globalListingAddress,
      abi: uliqGlobalListingAbi,
      functionName: "listingTimestamp",
      blockNumber
    }));
    const listingTimestamp = BigInt(listing.value);
    return withUliqRpcFailover(this.rpc, async (client) => Promise.all(this.config.rounds.map(async (round) => {
      const values = await Promise.all([
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "allocated", args: [wallet], blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "released", args: [wallet], blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "unreleased", args: [wallet], blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "vested", args: [wallet], blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "claimable", args: [wallet], blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "linearVestingStart", blockNumber }),
        client.readContract({ address: round.vestingAddress, abi: uliqPresaleRoundVestingAbi, functionName: "vestingEnd", blockNumber })
      ]).then((result) => result.map((value) => BigInt(value as bigint)));
      return {
        roundId: round.id,
        contractAddress: round.vestingAddress,
        walletAddress: wallet,
        allocatedRaw: values[0].toString(),
        releasedRaw: values[1].toString(),
        unreleasedRaw: values[2].toString(),
        vestedRaw: values[3].toString(),
        claimableRaw: values[4].toString(),
        listingTimestamp: timestamp(listingTimestamp),
        linearVestingStart: timestamp(values[5]),
        vestingEnd: timestamp(values[6])
      };
    }))).then((result) => result.value);
  }

  private async readPurchase(round: UliqPublicPresaleRoundConfig, purchaseId: bigint) {
    const result = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: round.contractAddress,
      abi: uliqPresaleRoundAbi,
      functionName: "purchases",
      args: [purchaseId]
    }));
    return {
      buyer: normalizeUliqAddress(result.value[0], "purchase_buyer").toLowerCase(),
      usdcAmountRaw: BigInt(result.value[1]),
      uliqAllocationRaw: BigInt(result.value[2]),
      purchasedAt: timestamp(BigInt(result.value[3])),
      withdrawalDeadline: timestamp(BigInt(result.value[4])),
      state: PURCHASE_STATES[Number(result.value[5])] ?? "UNKNOWN"
    };
  }

  private async reconcileRow(row: any, round: UliqPublicPresaleRoundConfig, now: Date): Promise<any> {
    const canonical = await this.db.uliqPresalePurchase.findFirst({
      where: {
        chainId: this.config.chainId,
        presaleContractAddress: round.contractAddress.toLowerCase(),
        transactionHash: row.transactionHash
      }
    });
    if (canonical) {
      if (!sameAddress(canonical.walletAddress, row.walletAddress)) {
        return this.updateTracking(row.id, "REVIEW_REQUIRED", "canonical_wallet_mismatch", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: {
          status: "FINALIZED",
          actualUsdcAmountRaw: canonical.usdcAmountRaw,
          actualUliqAllocationRaw: canonical.uliqAllocationRaw,
          purchaseIdOnchain: canonical.purchaseIdOnchain,
          logIndex: canonical.logIndex,
          receiptBlockNumber: canonical.purchaseBlockNumber,
          receiptBlockHash: canonical.purchaseBlockHash,
          statusReason: "canonical_indexer_matched",
          lastCheckedAt: now,
          networkFinalizedAt: row.networkFinalizedAt ?? now
        }
      });
    }

    if (row.status === "SUBMITTED") {
      let receipt: any;
      try {
        receipt = await getConsistentTransactionReceipt(this.rpc, row.transactionHash as Hex);
      } catch (error) {
        if (!isReceiptNotFound(error)) throw error;
        if (now.getTime() - new Date(row.submittedAt).getTime() >= RECEIPT_REVIEW_AFTER_MS) {
          return this.updateTracking(row.id, "REVIEW_REQUIRED", "receipt_not_found_after_30m", now);
        }
        return this.db.uliqPurchaseTracking.update({ where: { id: row.id }, data: { lastCheckedAt: now } });
      }
      if (receipt.status !== "success") return this.updateTracking(row.id, "FAILED", "transaction_reverted", now);
      if (typeof receipt.blockNumber !== "bigint" || !/^0x[0-9a-fA-F]{64}$/.test(String(receipt.blockHash ?? ""))) {
        return this.updateTracking(row.id, "REVIEW_REQUIRED", "receipt_block_identity_invalid", now);
      }
      const event = purchaseCreatedFromReceipt(receipt, round);
      if (!event) return this.updateTracking(row.id, "REVIEW_REQUIRED", "purchase_event_missing_or_ambiguous", now);
      const buyer = normalizeUliqAddress(event.args.buyer, "purchase_buyer").toLowerCase();
      const usdcAmountRaw = BigInt(String(event.args.usdcAmountRaw));
      const uliqAllocationRaw = BigInt(String(event.args.uliqAllocationRaw));
      const maxUsdcAmountRaw = parseDatabaseUint256Decimal(row.maxUsdcAmountRaw, "tracking_max_usdc_amount_raw");
      const minUliqAllocationRaw = parseDatabaseUint256Decimal(row.minUliqAllocationRaw, "tracking_min_uliq_allocation_raw");
      if (!sameAddress(buyer, row.walletAddress)) return this.updateTracking(row.id, "REVIEW_REQUIRED", "receipt_buyer_mismatch", now);
      if (usdcAmountRaw === 0n || usdcAmountRaw > maxUsdcAmountRaw || uliqAllocationRaw < minUliqAllocationRaw) {
        return this.updateTracking(row.id, "REVIEW_REQUIRED", "receipt_amount_mismatch", now);
      }
      row = await this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: {
          status: "SOFT_CONFIRMED",
          actualUsdcAmountRaw: usdcAmountRaw.toString(),
          actualUliqAllocationRaw: uliqAllocationRaw.toString(),
          purchaseIdOnchain: String(event.args.purchaseId),
          logIndex: event.logIndex,
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: String(receipt.blockHash).toLowerCase(),
          receiptObservedAt: now,
          lastCheckedAt: now,
          statusReason: null
        }
      });
    }

    if (!row.receiptBlockNumber || !row.receiptBlockHash || !["SOFT_CONFIRMED", "SAFE"].includes(row.status)) return row;
    const receiptBlockNumber = BigInt(row.receiptBlockNumber);
    const finalizedHead = await getConsistentFinalizedBlock(this.rpc);
    if (finalizedHead.number >= receiptBlockNumber) {
      const canonicalBlock = await getConsistentBlockAt(this.rpc, receiptBlockNumber);
      if (!sameAddress(canonicalBlock.hash, row.receiptBlockHash)) {
        return this.updateTracking(row.id, "REORGED", "receipt_block_reorged", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: { status: "FINALIZED", statusReason: "network_finalized", lastCheckedAt: now, networkFinalizedAt: now }
      });
    }
    const safeHead = await getConsistentSafeBlock(this.rpc);
    if (safeHead.number >= receiptBlockNumber) {
      const canonicalBlock = await getConsistentBlockAt(this.rpc, receiptBlockNumber);
      if (!sameAddress(canonicalBlock.hash, row.receiptBlockHash)) {
        return this.updateTracking(row.id, "REORGED", "receipt_block_reorged", now);
      }
      return this.db.uliqPurchaseTracking.update({
        where: { id: row.id },
        data: { status: "SAFE", statusReason: null, lastCheckedAt: now }
      });
    }
    return this.db.uliqPurchaseTracking.update({ where: { id: row.id }, data: { lastCheckedAt: now } });
  }

  private updateTracking(id: string, status: string, statusReason: string, now: Date) {
    return this.db.uliqPurchaseTracking.update({
      where: { id },
      data: { status, statusReason: statusReason.slice(0, 191), lastCheckedAt: now }
    });
  }

  private round(value: unknown): UliqPublicPresaleRoundConfig {
    const id = String(value ?? "").trim();
    const round = this.config.rounds.find((candidate) => candidate.id === id);
    if (!round) throw new Error("invalid_presale_round");
    return round;
  }
}
