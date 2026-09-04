export const MARKET_ANALYTICS_ROUTINE_VERSIONS = {
  fundingSnapshot: "derivatives.funding-snapshot.v1",
  openInterestSnapshot: "derivatives.open-interest-snapshot.v1",
  orderbookSnapshot: "orderbook.snapshot.v1"
} as const;

export type AnalyticsQualityState = "fresh" | "stale" | "degraded" | "unavailable";

export type RoutineQuality = {
  state: AnalyticsQualityState;
  reasons: string[];
};

export type FundingSnapshotInput = {
  rate: number | null;
  fundingIntervalHours?: number | null;
};

export type FundingSnapshotAnalysis = {
  routineId: typeof MARKET_ANALYTICS_ROUTINE_VERSIONS.fundingSnapshot;
  rate: number | null;
  rateBps: number | null;
  direction: "positive" | "flat" | "negative" | "unknown";
  fundingIntervalHours: number | null;
  annualizedEstimate: number | null;
  historicalContextAvailable: false;
  quality: RoutineQuality;
};

export type OpenInterestUnit = "base_asset" | "quote_asset" | "contracts" | "provider_native" | "unknown";

export type OpenInterestSnapshotInput = {
  reportedValue: number | null;
  reportedUnit: OpenInterestUnit;
  referencePrice?: number | null;
  contractSize?: number | null;
};

export type OpenInterestSnapshotAnalysis = {
  routineId: typeof MARKET_ANALYTICS_ROUTINE_VERSIONS.openInterestSnapshot;
  reportedValue: number | null;
  reportedUnit: OpenInterestUnit;
  normalizedBaseQuantity: number | null;
  notionalUsd: number | null;
  historicalContextAvailable: false;
  quality: RoutineQuality;
};

export type OrderbookLevel = readonly [number, number];

export type OrderbookDepthBand = {
  bandBps: 10 | 25 | 50 | 100;
  bidDepthUsd: number;
  askDepthUsd: number;
  depthRatio: number | null;
  imbalance: number | null;
};

export type OrderbookSnapshotInput = {
  bids: readonly OrderbookLevel[];
  asks: readonly OrderbookLevel[];
};

export type OrderbookSnapshotAnalysis = {
  routineId: typeof MARKET_ANALYTICS_ROUTINE_VERSIONS.orderbookSnapshot;
  midPrice: number | null;
  spreadBps: number | null;
  weightedMid: number | null;
  bands: OrderbookDepthBand[];
  quality: RoutineQuality;
};

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round(value: number, decimals = 12): number {
  return Number(value.toFixed(decimals));
}

export function analyzeFundingSnapshot(input: FundingSnapshotInput): FundingSnapshotAnalysis {
  const rate = input.rate === null ? null : Number(input.rate);
  const validRate = rate !== null && Number.isFinite(rate) ? rate : null;
  const interval = finitePositive(input.fundingIntervalHours);
  const reasons: string[] = [];
  if (validRate === null) reasons.push("funding_rate_unavailable");
  if (interval === null) reasons.push("funding_interval_unavailable");
  reasons.push("historical_context_unavailable");
  return {
    routineId: MARKET_ANALYTICS_ROUTINE_VERSIONS.fundingSnapshot,
    rate: validRate,
    rateBps: validRate === null ? null : round(validRate * 10_000),
    direction: validRate === null ? "unknown" : validRate > 0 ? "positive" : validRate < 0 ? "negative" : "flat",
    fundingIntervalHours: interval,
    annualizedEstimate: validRate === null || interval === null ? null : round(validRate * (24 / interval) * 365),
    historicalContextAvailable: false,
    quality: {
      state: validRate === null ? "unavailable" : interval === null ? "degraded" : "fresh",
      reasons
    }
  };
}

export function analyzeOpenInterestSnapshot(input: OpenInterestSnapshotInput): OpenInterestSnapshotAnalysis {
  const reported = input.reportedValue === null ? null : Number(input.reportedValue);
  const reportedValue = reported !== null && Number.isFinite(reported) && reported >= 0 ? reported : null;
  const referencePrice = finitePositive(input.referencePrice);
  const contractSize = finitePositive(input.contractSize);
  let normalizedBaseQuantity: number | null = null;
  if (reportedValue !== null && input.reportedUnit === "base_asset") normalizedBaseQuantity = reportedValue;
  if (reportedValue !== null && input.reportedUnit === "contracts" && contractSize !== null) {
    normalizedBaseQuantity = reportedValue * contractSize;
  }
  const notionalUsd = normalizedBaseQuantity !== null && referencePrice !== null
    ? round(normalizedBaseQuantity * referencePrice)
    : input.reportedUnit === "quote_asset" && reportedValue !== null
      ? reportedValue
      : null;
  const reasons: string[] = ["historical_context_unavailable"];
  if (reportedValue === null) reasons.unshift("open_interest_unavailable");
  if (reportedValue !== null && normalizedBaseQuantity === null && input.reportedUnit !== "quote_asset") {
    reasons.unshift("open_interest_unit_not_normalized");
  }
  if (reportedValue !== null && notionalUsd === null) reasons.push("open_interest_notional_unavailable");
  return {
    routineId: MARKET_ANALYTICS_ROUTINE_VERSIONS.openInterestSnapshot,
    reportedValue,
    reportedUnit: input.reportedUnit,
    normalizedBaseQuantity: normalizedBaseQuantity === null ? null : round(normalizedBaseQuantity),
    notionalUsd,
    historicalContextAvailable: false,
    quality: {
      state: reportedValue === null ? "unavailable" : reasons.length > 1 ? "degraded" : "fresh",
      reasons
    }
  };
}

function normalizeLevels(levels: readonly OrderbookLevel[], side: "bid" | "ask"): OrderbookLevel[] {
  const normalized = levels.flatMap((level) => {
    const price = finitePositive(level?.[0]);
    const quantity = finitePositive(level?.[1]);
    return price === null || quantity === null ? [] : [[price, quantity] as const];
  });
  return normalized.sort((left, right) => side === "bid" ? right[0] - left[0] : left[0] - right[0]);
}

export function analyzeOrderbookSnapshot(input: OrderbookSnapshotInput): OrderbookSnapshotAnalysis {
  const bids = normalizeLevels(input.bids, "bid");
  const asks = normalizeLevels(input.asks, "ask");
  const reasons: string[] = [];
  if (bids.length !== input.bids.length || asks.length !== input.asks.length) reasons.push("invalid_levels_removed");
  const bestBid = bids[0] ?? null;
  const bestAsk = asks[0] ?? null;
  if (!bestBid || !bestAsk) {
    return {
      routineId: MARKET_ANALYTICS_ROUTINE_VERSIONS.orderbookSnapshot,
      midPrice: null,
      spreadBps: null,
      weightedMid: null,
      bands: [],
      quality: { state: "degraded", reasons: [...reasons, "orderbook_side_missing"] }
    };
  }
  if (bestBid[0] >= bestAsk[0]) {
    return {
      routineId: MARKET_ANALYTICS_ROUTINE_VERSIONS.orderbookSnapshot,
      midPrice: null,
      spreadBps: null,
      weightedMid: null,
      bands: [],
      quality: { state: "degraded", reasons: [...reasons, "orderbook_crossed"] }
    };
  }
  const midPrice = (bestBid[0] + bestAsk[0]) / 2;
  const topQuantity = bestBid[1] + bestAsk[1];
  const weightedMid = topQuantity > 0
    ? ((bestAsk[0] * bestBid[1]) + (bestBid[0] * bestAsk[1])) / topQuantity
    : null;
  const bands = ([10, 25, 50, 100] as const).map((bandBps): OrderbookDepthBand => {
    const fraction = bandBps / 10_000;
    const bidDepthUsd = bids
      .filter(([price]) => price >= midPrice * (1 - fraction))
      .reduce((sum, [price, quantity]) => sum + price * quantity, 0);
    const askDepthUsd = asks
      .filter(([price]) => price <= midPrice * (1 + fraction))
      .reduce((sum, [price, quantity]) => sum + price * quantity, 0);
    const totalDepth = bidDepthUsd + askDepthUsd;
    if (askDepthUsd <= 0) reasons.push(`depth_ratio_unavailable_${bandBps}bps`);
    if (totalDepth <= 0) reasons.push(`imbalance_unavailable_${bandBps}bps`);
    return {
      bandBps,
      bidDepthUsd: round(bidDepthUsd),
      askDepthUsd: round(askDepthUsd),
      depthRatio: askDepthUsd > 0 ? round(bidDepthUsd / askDepthUsd) : null,
      imbalance: totalDepth > 0 ? round((bidDepthUsd - askDepthUsd) / totalDepth) : null
    };
  });
  return {
    routineId: MARKET_ANALYTICS_ROUTINE_VERSIONS.orderbookSnapshot,
    midPrice: round(midPrice),
    spreadBps: round(((bestAsk[0] - bestBid[0]) / midPrice) * 10_000),
    weightedMid: weightedMid === null ? null : round(weightedMid),
    bands,
    quality: { state: reasons.length > 0 ? "degraded" : "fresh", reasons }
  };
}
