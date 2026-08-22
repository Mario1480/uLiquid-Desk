import { type PublicClient } from "viem";
import { uliqLockerAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import {
  ULIQ_ENTITLEMENT_TTL_MS,
  ULIQ_HOLDING_COOLDOWN_SECONDS,
  getUliqRuntimeConfig,
  type UliqRuntimeConfig
} from "./config.js";
import { resolveUliqPriceSnapshot, type UliqPriceDecision } from "./price.service.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, withUliqRpcFailover, type UliqRpcPair } from "./rpc.js";
import { formatScaledDecimal, parseDecimalToScale, parseUint256Decimal } from "./uint256.js";

const TOKEN_SCALE = 10n ** 18n;

export type UliqTierDecision = {
  code: string;
  configVersion: number;
  featureFlags: Record<string, unknown>;
  aiDiscountBps: number;
  subscriptionDiscountBps: number;
  minUsdValue: string;
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
  lockModifier: null;
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
  return parseUint256Decimal(String(value ?? "0"));
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
      minUsdValue: String(row.minUsdValue)
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
    minUsdValue: "0"
  };
}

async function readBalancesAtBlock(params: {
  client: PublicClient;
  config: UliqRuntimeConfig;
  wallet: `0x${string}`;
  blockNumber: bigint;
}) {
  const [walletRaw, vestingRaw, lockedRaw, dexLaunchTimestamp] = await Promise.all([
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
    params.client.readContract({
      address: params.config.contracts.locker,
      abi: uliqLockerAbi,
      functionName: "lockedBalanceOf",
      args: [params.wallet],
      blockNumber: params.blockNumber
    }),
    params.client.readContract({
      address: params.config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "dexLaunchTimestamp",
      blockNumber: params.blockNumber
    })
  ]);
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
    walletRaw: String(row.walletRaw),
    vestingRaw: String(row.vestingRaw),
    lockedRaw: String(row.lockedRaw),
    eligibleRaw: String(row.eligibleRaw),
    featureEligibleRaw: String(row.featureEligibleRaw),
    monetaryEligibleRaw: String(row.monetaryEligibleRaw),
    presaleCooldownExemptRaw: String(row.presaleCooldownExemptRaw),
    pendingPresaleRaw: String(row.pendingPresaleRaw),
    referencePriceUsd: String(row.referencePriceUsd),
    priceMode: row.priceMode,
    priceQualityStatus: row.priceQualityStatus,
    priceSnapshotId: String(row.priceSnapshotId),
    degradationReason: row.degradationReason ?? null,
    eligibleUsd: String(row.eligibleUsd),
    monetaryEligibleUsd: formatScaledDecimal(calculateEligibleUsdScaled(decimalBigInt(row.monetaryEligibleRaw), String(row.referencePriceUsd))),
    baseTier: String(row.baseTier),
    lockModifier: null,
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

export class UliqEntitlementService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async getForUser(userId: string, options: { forceRefresh?: boolean; now?: Date } = {}): Promise<UliqEntitlement> {
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
      if (cached) {
        const featureTier = tierConfigs.find((tier) => tier.code === cached.effectiveTier)
          ?? resolveUliqTier(calculateEligibleUsdScaled(decimalBigInt(cached.featureEligibleRaw), String(cached.referencePriceUsd)), tierConfigs);
        const monetaryTier = resolveUliqTier(
          calculateEligibleUsdScaled(decimalBigInt(cached.monetaryEligibleRaw), String(cached.referencePriceUsd)),
          tierConfigs
        );
        return mapStoredEntitlement(cached, featureTier, monetaryTier);
      }
    }

    const head = await getConsistentFinalizedBlock(this.rpc);
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

    const [pending, qualifiedLots, exemptLots] = await Promise.all([
      this.db.uliqPresalePurchase.aggregate({
        where: { chainId: this.config.chainId, walletAddress: wallet, status: "PENDING_WITHDRAWAL" },
        _sum: { uliqAllocationRaw: true }
      }),
      this.db.uliqHoldingLot.aggregate({
        where: {
          chainId: this.config.chainId,
          walletAddress: wallet,
          canonical: true,
          monetaryEligibleAt: { lte: now }
        },
        _sum: { remainingRaw: true }
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
    const qualifiedRaw = decimalBigInt(qualifiedLots?._sum?.remainingRaw);
    const monetaryEligibleRaw = qualifiedRaw > eligibleRaw ? eligibleRaw : qualifiedRaw;
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
    const monetaryUsdScaled = calculateEligibleUsdScaled(monetaryEligibleRaw, price.priceUsd);
    const freshTier = resolveUliqTier(eligibleUsdScaled, tierConfigs);
    const monetaryTier = resolveUliqTier(monetaryUsdScaled, tierConfigs);
    let effectiveTier = freshTier;
    if (price.qualityStatus !== "HEALTHY") {
      const previous = await this.db.uliqEntitlementSnapshot.findFirst({
        where: { userId, walletAddress: wallet, priceQualityStatus: "HEALTHY" },
        orderBy: { computedAt: "desc" }
      });
      if (previous) {
        effectiveTier = tierConfigs.find((tier) => tier.code === previous.effectiveTier) ?? freshTier;
      }
    }
    const validUntil = new Date(Math.min(price.validUntil.getTime(), now.getTime() + ULIQ_ENTITLEMENT_TTL_MS));
    const stored = await this.db.uliqEntitlementSnapshot.create({
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
        holdingCooldownSeconds: ULIQ_HOLDING_COOLDOWN_SECONDS,
        holdingQualifiedAt: monetaryEligibleRaw > 0n ? now : null,
        presaleCooldownExemptRaw: presaleCooldownExemptRaw.toString(),
        pendingPresaleRaw: pendingPresaleRaw.toString(),
        referencePriceUsd: price.priceUsd,
        priceMode: price.mode,
        priceQualityStatus: price.qualityStatus,
        degradationReason: price.degradationReason,
        eligibleUsd: formatScaledDecimal(eligibleUsdScaled),
        baseTier: freshTier.code,
        lockModifier: null,
        effectiveTier: effectiveTier.code,
        tierConfigVersion: effectiveTier.configVersion,
        priceSnapshotId: price.id,
        computedAt: now,
        validUntil
      }
    });
    return mapStoredEntitlement(stored, effectiveTier, monetaryTier);
  }
}
