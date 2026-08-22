import {
  ULIQ_ENTITLEMENT_TTL_MS,
  ULIQ_REFERENCE_PRICE_USD,
  type UliqRuntimeConfig
} from "./config.js";
import { parseDecimalToScale } from "./uint256.js";

const MARKET_OBSERVATION_MS = 30 * 24 * 60 * 60 * 1_000;
const MARKET_STALE_MS = 30 * 60 * 1_000;
const MARKET_TWAP_SECONDS = 24 * 60 * 60;
const MARKET_MIN_LIQUIDITY_SCALED = 50_000n * 10n ** 18n;

export type UliqPriceDecision = {
  id: string;
  priceUsd: string;
  mode: "PRESALE_REFERENCE" | "MARKET_OBSERVATION" | "MARKET_REFERENCE";
  qualityStatus: "HEALTHY" | "DEGRADED" | "STALE" | "INVALID";
  degradationReason: string | null;
  observedAt: Date;
  validUntil: Date;
  blockNumber: bigint;
  blockHash: string;
};

export type MarketPriceCandidate = {
  priceUsd: string;
  spotPriceUsd: string;
  twapWindowSeconds: number;
  spotTwapDeviationBps: number;
  liquidityUsd: string;
  poolAgeSeconds: number;
  observedAt: Date;
  validUntil: Date;
};

export function validateMarketPriceCandidate(candidate: MarketPriceCandidate, now = new Date()): string | null {
  if (candidate.twapWindowSeconds !== MARKET_TWAP_SECONDS) return "twap_window_not_24h";
  if (candidate.poolAgeSeconds < MARKET_OBSERVATION_MS / 1_000) return "pool_age_below_30d";
  if (parseDecimalToScale(candidate.liquidityUsd) < MARKET_MIN_LIQUIDITY_SCALED) return "pool_tvl_below_50000_usd";
  if (candidate.spotTwapDeviationBps > 2_500) return "spot_twap_deviation_above_25pct";
  if (candidate.observedAt.getTime() < now.getTime() - MARKET_STALE_MS) return "price_older_than_30m";
  if (candidate.validUntil <= now) return "price_snapshot_expired";
  if (parseDecimalToScale(candidate.priceUsd) <= 0n) return "price_not_positive";
  return null;
}

function mapSnapshot(row: any): UliqPriceDecision {
  return {
    id: String(row.id),
    priceUsd: String(row.priceUsd),
    mode: row.mode,
    qualityStatus: row.qualityStatus,
    degradationReason: row.degradationReason ?? null,
    observedAt: row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt),
    validUntil: row.validUntil instanceof Date ? row.validUntil : new Date(row.validUntil),
    blockNumber: BigInt(row.blockNumber),
    blockHash: String(row.blockHash)
  };
}

export async function resolveUliqPriceSnapshot(params: {
  db: any;
  config: UliqRuntimeConfig;
  blockNumber: bigint;
  blockHash: string;
  dexLaunchTimestamp: bigint;
  now?: Date;
}): Promise<UliqPriceDecision> {
  const now = params.now ?? new Date();
  const launchMs = Number(params.dexLaunchTimestamp) * 1_000;
  const observationActive = launchMs > 0 && now.getTime() < launchMs + MARKET_OBSERVATION_MS;
  const observationEnded = launchMs > 0 && !observationActive;
  const latestMarket = await params.db.uliqPriceSnapshot.findFirst({
    where: {
      chainId: params.config.chainId,
      mode: "MARKET_REFERENCE",
      blockNumber: { lte: params.blockNumber }
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }]
  });

  if (!observationActive && latestMarket) {
    const candidate: MarketPriceCandidate = {
      priceUsd: String(latestMarket.priceUsd),
      spotPriceUsd: String(latestMarket.spotPriceUsd ?? latestMarket.priceUsd),
      twapWindowSeconds: Number(latestMarket.twapWindowSeconds ?? 0),
      spotTwapDeviationBps: Number(latestMarket.spotTwapDeviationBps ?? Number.MAX_SAFE_INTEGER),
      liquidityUsd: String(latestMarket.liquidityUsd ?? "0"),
      poolAgeSeconds: Number(latestMarket.poolAgeSeconds ?? 0),
      observedAt: latestMarket.observedAt,
      validUntil: latestMarket.validUntil
    };
    const reason = validateMarketPriceCandidate(candidate, now);
    if (!reason && latestMarket.qualityStatus === "HEALTHY") return mapSnapshot(latestMarket);
  }

  const mode = observationActive ? "MARKET_OBSERVATION" : "PRESALE_REFERENCE";
  const degradationReason = observationEnded
    ? latestMarket
      ? validateMarketPriceCandidate({
      priceUsd: String(latestMarket.priceUsd),
      spotPriceUsd: String(latestMarket.spotPriceUsd ?? latestMarket.priceUsd),
      twapWindowSeconds: Number(latestMarket.twapWindowSeconds ?? 0),
      spotTwapDeviationBps: Number(latestMarket.spotTwapDeviationBps ?? Number.MAX_SAFE_INTEGER),
      liquidityUsd: String(latestMarket.liquidityUsd ?? "0"),
      poolAgeSeconds: Number(latestMarket.poolAgeSeconds ?? 0),
      observedAt: latestMarket.observedAt,
      validUntil: latestMarket.validUntil
      }, now) ?? "market_reference_not_admin_approved"
      : "market_reference_unavailable_after_observation"
    : null;
  const qualityStatus = degradationReason ? "DEGRADED" : "HEALTHY";
  const validUntil = new Date(now.getTime() + ULIQ_ENTITLEMENT_TTL_MS);
  const created = await params.db.uliqPriceSnapshot.create({
    data: {
      chainId: params.config.chainId,
      poolAddress: null,
      baseTokenAddress: params.config.contracts.token.toLowerCase(),
      quoteTokenAddress: params.config.contracts.usdc.toLowerCase(),
      priceUsd: ULIQ_REFERENCE_PRICE_USD,
      mode,
      source: mode === "MARKET_OBSERVATION" ? "presale_reference_during_observation" : "presale_utility_reference",
      twapWindowSeconds: null,
      spotPriceUsd: null,
      spotTwapDeviationBps: null,
      liquidityUsd: null,
      poolAgeSeconds: launchMs > 0 ? Math.max(0, Math.floor((now.getTime() - launchMs) / 1_000)) : null,
      blockNumber: params.blockNumber,
      blockHash: params.blockHash,
      qualityStatus,
      degradationReason,
      observedAt: now,
      validUntil
    }
  });
  return mapSnapshot(created);
}
