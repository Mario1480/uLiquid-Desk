import { type PublicClient } from "viem";
import { uliqLockerAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import {
  ULIQ_ENTITLEMENT_TTL_MS,
  getUliqLockerAddresses,
  getUliqRuntimeConfig,
  type UliqRuntimeConfig
} from "./config.js";
import { resolveUliqPriceSnapshot, type UliqPriceDecision } from "./price.service.js";
import {
  createUliqRpcPair,
  getConsistentBlockAt,
  getConsistentFinalizedBlock,
  withUliqRpcFailover,
  type UliqRpcPair
} from "./rpc.js";
import {
  databaseUint256Decimal,
  formatScaledDecimal,
  parseDatabaseUint256Decimal,
  parseDecimalToScale
} from "./uint256.js";
import {
  ULIQ_LOCK_GATE_VERSION,
  calculateRequiredLockRaw,
  decideUliqLockGate,
  type UliqLockGateDecision
} from "./math.js";

const TOKEN_SCALE = 10n ** 18n;

export type UliqTierDecision = {
  code: string;
  configVersion: number;
  featureFlags: Record<string, unknown>;
  aiDiscountBps: number;
  subscriptionDiscountBps: number;
  minUsdValue: string;
  minimumLockDurationDays: number | null;
  monetaryBenefitCaps: Record<string, unknown> | null;
};

export type UliqEntitlement = {
  id: string;
  userId: string;
  walletAddress: string;
  chainId: number;
  asOfBlock: bigint;
  blockHash: string;
  walletRaw: string;
  vestingRaw: string;
  lockedRaw: string;
  eligibleRaw: string;
  featureEligibleRaw: string;
  monetaryEligibleRaw: string;
  presaleCooldownExemptRaw: string;
  pendingPresaleRaw: string;
  referencePriceUsd: string;
  priceMode: UliqPriceDecision["mode"];
  priceQualityStatus: UliqPriceDecision["qualityStatus"];
  priceSnapshotId: string;
  degradationReason: string | null;
  eligibleUsd: string;
  monetaryEligibleUsd: string;
  baseTier: string;
  lockModifier: string | null;
  effectiveTier: string;
  monetaryTier: string;
  tierConfigVersion: number;
  aiDiscountBps: number;
  subscriptionDiscountBps: number;
  featureFlags: Record<string, unknown>;
  computedAt: Date;
  validUntil: Date;
};

function decimalBigInt(value: unknown): bigint {
  return parseDatabaseUint256Decimal(value ?? "0");
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function calculateEligibleRaw(walletRaw: bigint, vestingRaw: bigint, lockedRaw: bigint): bigint {
  if (walletRaw < 0n || vestingRaw < 0n || lockedRaw < 0n) throw new Error("uliq_negative_balance");
  return walletRaw + vestingRaw + lockedRaw;
}

export function calculateEligibleUsdScaled(eligibleRaw: bigint, priceUsd: string): bigint {
  return eligibleRaw * parseDecimalToScale(priceUsd) / TOKEN_SCALE;
}

export function calculateUntrackedEligibleRaw(eligibleRaw: bigint, trackedRaw: bigint): bigint {
  return trackedRaw < eligibleRaw ? eligibleRaw - trackedRaw : 0n;
}

export function resolveIndexerAlignedEntitlementBlock(params: {
  finalizedBlock: bigint;
  cursor: {
    lastProcessedBlock: unknown;
    failureCount?: unknown;
    lastError?: unknown;
  } | null;
}): bigint {
  if (
    !params.cursor
    || Number(params.cursor.failureCount ?? 0) !== 0
    || params.cursor.lastError
  ) return params.finalizedBlock;
  let processedBlock: bigint;
  try {
    processedBlock = BigInt(String(params.cursor.lastProcessedBlock));
  } catch {
    return params.finalizedBlock;
  }
  if (processedBlock <= 0n || processedBlock >= params.finalizedBlock) {
    return params.finalizedBlock;
  }
  return processedBlock;
}

export async function loadUliqTierConfigs(db: any, now = new Date()): Promise<UliqTierDecision[]> {
  const rows = await db.uliqTierConfig.findMany({
    where: {
      enabled: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }]
    },
    orderBy: [{ version: "desc" }, { minUsdValue: "desc" }]
  });
  const version = rows.length > 0 ? Math.max(...rows.map((row: any) => Number(row.version))) : 0;
  return rows
    .filter((row: any) => Number(row.version) === version)
    .map((row: any) => ({
      code: String(row.code),
      configVersion: Number(row.version),
      featureFlags: jsonObject(row.featureFlags),
      aiDiscountBps: Number(row.aiDiscountBps),
      subscriptionDiscountBps: Number(row.subscriptionDiscountBps),
      minUsdValue: String(row.minUsdValue),
      minimumLockDurationDays: row.minimumLockDurationDays == null ? null : Number(row.minimumLockDurationDays),
      monetaryBenefitCaps: row.monetaryBenefitCaps == null ? null : jsonObject(row.monetaryBenefitCaps)
    }));
}

export function resolveUliqTier(eligibleUsdScaled: bigint, configs: UliqTierDecision[]): UliqTierDecision {
  const sorted = [...configs].sort((left, right) => {
    const a = parseDecimalToScale(left.minUsdValue);
    const b = parseDecimalToScale(right.minUsdValue);
    return a === b ? 0 : a > b ? -1 : 1;
  });
  return sorted.find((config) => eligibleUsdScaled >= parseDecimalToScale(config.minUsdValue)) ?? {
    code: "BASIC",
    configVersion: 0,
    featureFlags: {},
    aiDiscountBps: 0,
    subscriptionDiscountBps: 0,
    minUsdValue: "0",
    minimumLockDurationDays: null,
    monetaryBenefitCaps: null
  };
}

export function resolveEffectiveTierForPrice(params: {
  freshTier: UliqTierDecision;
  configs: UliqTierDecision[];
  priceQualityStatus: UliqPriceDecision["qualityStatus"];
  previousHealthyTierCode?: string | null;
}): UliqTierDecision {
  if (params.priceQualityStatus === "HEALTHY" || !params.previousHealthyTierCode) return params.freshTier;
  return params.configs.find((tier) => tier.code === params.previousHealthyTierCode) ?? params.freshTier;
}

async function readBalancesAtBlock(params: {
  client: PublicClient;
  config: UliqRuntimeConfig;
  wallet: `0x${string}`;
  blockNumber: bigint;
}) {
  const [walletRaw, vestingRaw, lockedBalances, dexLaunchTimestamp] = await Promise.all([
    params.client.readContract({
      address: params.config.contracts.token,
      abi: uliqTokenAbi,
      functionName: "balanceOf",
      args: [params.wallet],
      blockNumber: params.blockNumber
    }),
    params.client.readContract({
      address: params.config.contracts.vesting,
      abi: uliqVestingAbi,
      functionName: "unreleased",
      args: [params.wallet],
      blockNumber: params.blockNumber
    }),
    Promise.all(getUliqLockerAddresses(params.config).map((address) => params.client.readContract({
      address,
      abi: uliqLockerAbi,
      functionName: "lockedBalanceOf",
      args: [params.wallet],
      blockNumber: params.blockNumber
    }))),
    params.client.readContract({
      address: params.config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "dexLaunchTimestamp",
      blockNumber: params.blockNumber
    })
  ]);
  const lockedRaw = lockedBalances.reduce((total, value) => total + BigInt(value), 0n);
  return { walletRaw, vestingRaw, lockedRaw, dexLaunchTimestamp };
}

function mapStoredEntitlement(row: any, tier: UliqTierDecision, monetaryTier: UliqTierDecision): UliqEntitlement {
  return {
    id: String(row.id),
    userId: String(row.userId),
    walletAddress: String(row.walletAddress),
    chainId: Number(row.chainId),
    asOfBlock: BigInt(row.asOfBlock),
    blockHash: String(row.blockHash),
    walletRaw: databaseUint256Decimal(row.walletRaw, "wallet_raw"),
    vestingRaw: databaseUint256Decimal(row.vestingRaw, "vesting_raw"),
    lockedRaw: databaseUint256Decimal(row.lockedRaw, "locked_raw"),
    eligibleRaw: databaseUint256Decimal(row.eligibleRaw, "eligible_raw"),
    featureEligibleRaw: databaseUint256Decimal(row.featureEligibleRaw, "feature_eligible_raw"),
    monetaryEligibleRaw: databaseUint256Decimal(row.monetaryEligibleRaw, "monetary_eligible_raw"),
    presaleCooldownExemptRaw: databaseUint256Decimal(row.presaleCooldownExemptRaw, "presale_cooldown_exempt_raw"),
    pendingPresaleRaw: databaseUint256Decimal(row.pendingPresaleRaw, "pending_presale_raw"),
    referencePriceUsd: String(row.referencePriceUsd),
    priceMode: row.priceMode,
    priceQualityStatus: row.priceQualityStatus,
    priceSnapshotId: String(row.priceSnapshotId),
    degradationReason: row.degradationReason ?? null,
    eligibleUsd: String(row.eligibleUsd),
    monetaryEligibleUsd: formatScaledDecimal(calculateEligibleUsdScaled(decimalBigInt(row.monetaryEligibleRaw), String(row.referencePriceUsd))),
    baseTier: String(row.baseTier),
    lockModifier: row.lockModifier ?? null,
    effectiveTier: String(row.effectiveTier),
    monetaryTier: monetaryTier.code,
    tierConfigVersion: Number(row.tierConfigVersion),
    aiDiscountBps: monetaryTier.aiDiscountBps,
    subscriptionDiscountBps: monetaryTier.subscriptionDiscountBps,
    featureFlags: tier.featureFlags,
    computedAt: row.computedAt instanceof Date ? row.computedAt : new Date(row.computedAt),
    validUntil: row.validUntil instanceof Date ? row.validUntil : new Date(row.validUntil)
  };
}

function mapStoredEntitlementWithTierConfigs(
  row: any,
  tierConfigs: UliqTierDecision[]
): UliqEntitlement {
  const featureTier = tierConfigs.find((tier) => tier.code === row.effectiveTier)
    ?? resolveUliqTier(
      calculateEligibleUsdScaled(decimalBigInt(row.featureEligibleRaw), String(row.referencePriceUsd)),
      tierConfigs
    );
  const monetaryTier = resolveUliqTier(
    calculateEligibleUsdScaled(decimalBigInt(row.monetaryEligibleRaw), String(row.referencePriceUsd)),
    tierConfigs
  );
  return mapStoredEntitlement(row, featureTier, monetaryTier);
}

export async function findCanonicalUliqEntitlementSnapshotAtBlock(params: {
  db: any;
  userId: string;
  walletAddress: string;
  chainId: number;
  asOfBlock: bigint;
  blockHash: string;
}): Promise<any | null> {
  const existing = await params.db.uliqEntitlementSnapshot.findFirst({
    where: {
      userId: params.userId,
      walletAddress: params.walletAddress,
      chainId: params.chainId,
      asOfBlock: params.asOfBlock
    }
  });
  if (!existing) return null;
  if (String(existing.blockHash).toLowerCase() !== params.blockHash.toLowerCase()) {
    throw new Error("uliq_entitlement_snapshot_block_mismatch");
  }
  return existing;
}

export async function createUliqEntitlementSnapshotWithRaceRecovery(params: {
  db: any;
  data: Record<string, unknown>;
}): Promise<any> {
  try {
    return await params.db.uliqEntitlementSnapshot.create({ data: params.data });
  } catch (error) {
    if (String((error as any)?.code ?? "") !== "P2002") throw error;
    const existing = await findCanonicalUliqEntitlementSnapshotAtBlock({
      db: params.db,
      userId: String(params.data.userId),
      walletAddress: String(params.data.walletAddress),
      chainId: Number(params.data.chainId),
      asOfBlock: BigInt(String(params.data.asOfBlock)),
      blockHash: String(params.data.blockHash)
    });
    if (!existing) throw error;
    return existing;
  }
}

export class UliqEntitlementService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async getForUser(userId: string, options: {
    forceRefresh?: boolean;
    alignToIndexer?: boolean;
    now?: Date;
  } = {}): Promise<UliqEntitlement> {
    const now = options.now ?? new Date();
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, walletAddress: true }
    });
    if (!user) throw new Error("user_not_found");
    if (!user.walletAddress) throw new Error("wallet_not_linked");
    const wallet = String(user.walletAddress).toLowerCase() as `0x${string}`;

    const tierConfigs = await loadUliqTierConfigs(this.db, now);
    if (!options.forceRefresh) {
      const cached = await this.db.uliqEntitlementSnapshot.findFirst({
        where: { userId, walletAddress: wallet, validUntil: { gt: now } },
        orderBy: { computedAt: "desc" }
      });
      if (cached) return mapStoredEntitlementWithTierConfigs(cached, tierConfigs);
    }

    const finalizedHead = await getConsistentFinalizedBlock(this.rpc);
    let head = finalizedHead;
    if (options.alignToIndexer) {
      const cursor = await this.db.onchainSyncCursor.findUnique({
        where: { id: `uliq:${this.config.chainId}:all` },
        select: { lastProcessedBlock: true, failureCount: true, lastError: true }
      });
      const alignedBlockNumber = resolveIndexerAlignedEntitlementBlock({
        finalizedBlock: finalizedHead.number,
        cursor
      });
      if (alignedBlockNumber < finalizedHead.number) {
        head = await getConsistentBlockAt(this.rpc, alignedBlockNumber);
      }
    }
    const existingAtHead = await findCanonicalUliqEntitlementSnapshotAtBlock({
      db: this.db,
      userId,
      walletAddress: wallet,
      chainId: this.config.chainId,
      asOfBlock: head.number,
      blockHash: head.hash
    });
    if (existingAtHead) {
      return mapStoredEntitlementWithTierConfigs(existingAtHead, tierConfigs);
    }
    const read = await withUliqRpcFailover(this.rpc, (client) => readBalancesAtBlock({
      client,
      config: this.config,
      wallet,
      blockNumber: head.number
    }));
    const walletRaw = BigInt(read.value.walletRaw);
    const vestingRaw = BigInt(read.value.vestingRaw);
    const lockedRaw = BigInt(read.value.lockedRaw);
    const eligibleRaw = calculateEligibleRaw(walletRaw, vestingRaw, lockedRaw);

    const [pending, exemptLots] = await Promise.all([
      this.db.uliqPresalePurchase.aggregate({
        where: { chainId: this.config.chainId, walletAddress: wallet, status: "PENDING_WITHDRAWAL" },
        _sum: { uliqAllocationRaw: true }
      }),
      this.db.uliqHoldingLot.aggregate({
        where: {
          chainId: this.config.chainId,
          walletAddress: wallet,
          canonical: true,
          provenance: "PRESALE_FINALIZED"
        },
        _sum: { remainingRaw: true }
      })
    ]);
    const pendingPresaleRaw = decimalBigInt(pending?._sum?.uliqAllocationRaw);
    // ADR-008 removes holding age as a monetary authorization gate. The
    // balance remains useful for tier reporting; a benefit-specific canonical
    // lock decision authorizes each monetary reservation separately.
    const monetaryEligibleRaw = eligibleRaw;
    const presaleCooldownExemptRaw = decimalBigInt(exemptLots?._sum?.remainingRaw);
    const price = await resolveUliqPriceSnapshot({
      db: this.db,
      config: this.config,
      blockNumber: head.number,
      blockHash: head.hash,
      dexLaunchTimestamp: BigInt(read.value.dexLaunchTimestamp),
      now
    });
    const eligibleUsdScaled = calculateEligibleUsdScaled(eligibleRaw, price.priceUsd);
    const freshTier = resolveUliqTier(eligibleUsdScaled, tierConfigs);
    const monetaryTier = freshTier;
    let effectiveTier = freshTier;
    if (price.qualityStatus !== "HEALTHY") {
      const previous = await this.db.uliqEntitlementSnapshot.findFirst({
        where: { userId, walletAddress: wallet, priceQualityStatus: "HEALTHY" },
        orderBy: { computedAt: "desc" }
      });
      effectiveTier = resolveEffectiveTierForPrice({
        freshTier,
        configs: tierConfigs,
        priceQualityStatus: price.qualityStatus,
        previousHealthyTierCode: previous?.effectiveTier
      });
    }
    const validUntil = new Date(Math.min(price.validUntil.getTime(), now.getTime() + ULIQ_ENTITLEMENT_TTL_MS));
    const stored = await createUliqEntitlementSnapshotWithRaceRecovery({
      db: this.db,
      data: {
        userId,
        walletAddress: wallet,
        chainId: this.config.chainId,
        asOfBlock: head.number,
        blockHash: head.hash,
        walletRaw: walletRaw.toString(),
        vestingRaw: vestingRaw.toString(),
        lockedRaw: lockedRaw.toString(),
        eligibleRaw: eligibleRaw.toString(),
        featureEligibleRaw: eligibleRaw.toString(),
        monetaryEligibleRaw: monetaryEligibleRaw.toString(),
        holdingCooldownSeconds: 0,
        holdingQualifiedAt: null,
        presaleCooldownExemptRaw: presaleCooldownExemptRaw.toString(),
        pendingPresaleRaw: pendingPresaleRaw.toString(),
        referencePriceUsd: price.priceUsd,
        priceMode: price.mode,
        priceQualityStatus: price.qualityStatus,
        degradationReason: price.degradationReason,
        eligibleUsd: formatScaledDecimal(eligibleUsdScaled),
        baseTier: freshTier.code,
        lockModifier: ULIQ_LOCK_GATE_VERSION,
        effectiveTier: effectiveTier.code,
        tierConfigVersion: effectiveTier.configVersion,
        priceSnapshotId: price.id,
        computedAt: now,
        validUntil
      }
    });
    return mapStoredEntitlement(stored, effectiveTier, monetaryTier);
  }

  async getLockDecisionForBenefit(params: {
    userId: string;
    requiredBenefitUntil: Date;
    entitlement?: UliqEntitlement;
    now?: Date;
  }): Promise<UliqLockGateDecision & {
    tierCode: string;
    tierMinimumUsd: string;
    priceSnapshotId: string;
    configVersion: number;
    lockerContractAddress: string;
    monetaryBenefitCaps: Record<string, unknown> | null;
  }> {
    const now = params.now ?? new Date();
    if (Number.isNaN(params.requiredBenefitUntil.getTime()) || params.requiredBenefitUntil <= now) {
      throw new Error("uliq_invalid_required_benefit_until");
    }
    const entitlement = params.entitlement ?? await this.getForUser(params.userId, { forceRefresh: true, now });
    const configs = await loadUliqTierConfigs(this.db, now);
    const tier = configs.find((candidate) => (
      candidate.code === entitlement.baseTier
      && candidate.configVersion === entitlement.tierConfigVersion
    ));
    if (!tier) throw new Error("uliq_tier_config_missing");
    const requiredLockedRaw = calculateRequiredLockRaw({
      tierMinimumUsdScaled: parseDecimalToScale(tier.minUsdValue),
      referencePriceUsdScaled: parseDecimalToScale(entitlement.referencePriceUsd)
    });
    const [cursor, positions] = await Promise.all([
      this.db.onchainSyncCursor.findUnique({
        where: { id: `uliq:${this.config.chainId}:all` },
        select: { lastProcessedBlock: true, failureCount: true, lastError: true }
      }),
      this.db.uliqLockPosition.findMany({
        where: {
          chainId: this.config.chainId,
          contractAddress: this.config.contracts.locker.toLowerCase(),
          walletAddress: entitlement.walletAddress.toLowerCase(),
          status: { in: ["ACTIVE", "MATURED"] },
          asOfBlock: { lte: entitlement.asOfBlock }
        },
        orderBy: [{ unlockAt: "asc" }, { lockIdOnchain: "asc" }]
      })
    ]);
    const stateFresh = Boolean(
      cursor
      && BigInt(cursor.lastProcessedBlock) >= entitlement.asOfBlock
      && Number(cursor.failureCount ?? 0) === 0
      && !cursor.lastError
    );
    return {
      ...decideUliqLockGate({
        requiredLockedRaw,
        requiredBenefitUntil: params.requiredBenefitUntil,
        stateFresh,
        positions: positions.map((position: any) => ({
          lockId: databaseUint256Decimal(position.lockIdOnchain, "lock_id_onchain"),
          amountRaw: decimalBigInt(position.amountRaw),
          unlockAt: position.unlockAt instanceof Date ? position.unlockAt : new Date(position.unlockAt),
          withdrawn: position.status === "WITHDRAWN" || position.status === "ORPHANED"
        }))
      }),
      tierCode: tier.code,
      tierMinimumUsd: tier.minUsdValue,
      priceSnapshotId: entitlement.priceSnapshotId,
      configVersion: tier.configVersion,
      lockerContractAddress: this.config.contracts.locker.toLowerCase(),
      monetaryBenefitCaps: tier.monetaryBenefitCaps
    };
  }
}
