export const CROSS_MARKET_VENUES = ["binance", "bitget", "hyperliquid", "mexc", "bingx"] as const;

export type CrossMarketVenue = typeof CROSS_MARKET_VENUES[number];
export type CrossMarketQuality = "fresh" | "degraded" | "stale";

export type CrossMarketBook = {
  venue: CrossMarketVenue;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  observedAt: string | null;
  fetchedAt: string;
  ageMs: number | null;
  quality: CrossMarketQuality;
  warnings: string[];
  snapshotId: string;
  providerId: string;
};

export type CrossMarketFeeProfile = {
  makerBps: number;
  takerBps: number;
  source: "default_assumption" | "request_override";
};

export type CrossMarketInventory = {
  quoteUsd?: number;
  baseUnits?: number;
};

export type InventoryReadiness = {
  state: "ready" | "insufficient" | "unknown";
  model: "spot_prefunded" | "perp_conservative_1x";
  requirements: Array<{
    venue: CrossMarketVenue;
    asset: "base" | "quote";
    required: number;
    available: number | null;
    ready: boolean | null;
  }>;
};

export type CrossMarketScanOptions = {
  symbol: string;
  marketType: "spot" | "perp";
  targetNotionalUsd: number;
  safetyBufferBps: number;
  minNetEdgeBps: number;
  maxBookAgeMs: number;
  maxObservationSkewMs: number;
  books: CrossMarketBook[];
  feeProfiles: Partial<Record<CrossMarketVenue, CrossMarketFeeProfile>>;
  inventory?: Partial<Record<CrossMarketVenue, CrossMarketInventory>>;
};

type Fill = {
  requestedBase: number;
  filledBase: number;
  quote: number;
  vwap: number | null;
  complete: boolean;
  coverage: number;
  slippageBps: number;
};

export type ArbitrageOpportunity = {
  id: string;
  buyVenue: CrossMarketVenue;
  sellVenue: CrossMarketVenue;
  buyPrice: number;
  sellPrice: number;
  buyVwap: number;
  sellVwap: number;
  baseSize: number;
  capitalUsd: number;
  executableUsd: number;
  grossEdgeBps: number;
  slippageBps: number;
  feeBps: number;
  safetyBufferBps: number;
  netEdgeBps: number;
  expectedNetUsd: number;
  depthCoverage: number;
  inventory: InventoryReadiness;
  score: number;
  status: "candidate" | "below_threshold" | "blocked";
  warnings: string[];
};

export type XemmOpportunity = {
  id: string;
  makerVenue: CrossMarketVenue;
  takerVenue: CrossMarketVenue;
  makerSide: "buy" | "sell";
  makerPrice: number;
  hedgeVwap: number;
  baseSize: number;
  capitalUsd: number;
  executableUsd: number;
  makerSpreadBps: number;
  takerSpreadBps: number;
  grossEdgeBps: number;
  hedgeSlippageBps: number;
  feeBps: number;
  safetyBufferBps: number;
  netEdgeBps: number;
  expectedNetUsd: number;
  depthCoverage: number;
  inventory: InventoryReadiness;
  score: number;
  status: "candidate" | "below_threshold" | "blocked";
  warnings: string[];
};

export const DEFAULT_CROSS_MARKET_FEE: CrossMarketFeeProfile = {
  makerBps: 2,
  takerBps: 10,
  source: "default_assumption"
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function round(value: number, decimals = 8): number {
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function feeFor(options: CrossMarketScanOptions, venue: CrossMarketVenue): CrossMarketFeeProfile {
  return options.feeProfiles[venue] ?? DEFAULT_CROSS_MARKET_FEE;
}

function normalizeLevels(levels: Array<[number, number]>, side: "bids" | "asks"): Array<[number, number]> {
  return levels
    .filter(([price, qty]) => finitePositive(price) && finitePositive(qty))
    .sort((a, b) => side === "asks" ? a[0] - b[0] : b[0] - a[0]);
}

function fillBase(levels: Array<[number, number]>, requestedBase: number, side: "buy" | "sell"): Fill {
  const sorted = normalizeLevels(levels, side === "buy" ? "asks" : "bids");
  const best = sorted[0]?.[0] ?? null;
  let remaining = requestedBase;
  let filledBase = 0;
  let quote = 0;
  for (const [price, availableBase] of sorted) {
    if (remaining <= 1e-12) break;
    const take = Math.min(remaining, availableBase);
    filledBase += take;
    quote += take * price;
    remaining -= take;
  }
  const vwap = filledBase > 0 ? quote / filledBase : null;
  const coverage = requestedBase > 0 ? clamp(filledBase / requestedBase, 0, 1) : 0;
  const slippageBps = best && vwap
    ? Math.max(0, side === "buy" ? ((vwap / best) - 1) * 10_000 : (1 - (vwap / best)) * 10_000)
    : 0;
  return {
    requestedBase,
    filledBase,
    quote,
    vwap,
    complete: coverage >= 0.999999,
    coverage,
    slippageBps
  };
}

function bookWarnings(book: CrossMarketBook, maxBookAgeMs: number): string[] {
  const warnings = [...book.warnings];
  if (book.quality === "stale" || (book.ageMs !== null && book.ageMs > maxBookAgeMs)) {
    warnings.push(`${book.venue}_book_stale`);
  }
  if (book.observedAt === null) warnings.push(`${book.venue}_provider_timestamp_missing`);
  if (!normalizeLevels(book.bids, "bids").length || !normalizeLevels(book.asks, "asks").length) {
    warnings.push(`${book.venue}_book_empty`);
  }
  return [...new Set(warnings)];
}

function isBookBlocked(book: CrossMarketBook, maxBookAgeMs: number): boolean {
  return book.quality === "stale"
    || (book.ageMs !== null && book.ageMs > maxBookAgeMs)
    || normalizeLevels(book.bids, "bids").length === 0
    || normalizeLevels(book.asks, "asks").length === 0;
}

function observationSkewMs(first: CrossMarketBook, second: CrossMarketBook): number | null {
  const firstAt = first.observedAt ? Date.parse(first.observedAt) : Number.NaN;
  const secondAt = second.observedAt ? Date.parse(second.observedAt) : Number.NaN;
  return Number.isFinite(firstAt) && Number.isFinite(secondAt) ? Math.abs(firstAt - secondAt) : null;
}

function inventoryReadiness(params: {
  options: CrossMarketScanOptions;
  firstVenue: CrossMarketVenue;
  secondVenue: CrossMarketVenue;
  firstAsset: "base" | "quote";
  secondAsset: "base" | "quote";
  firstRequired: number;
  secondRequired: number;
}): InventoryReadiness {
  const model = params.options.marketType === "perp" ? "perp_conservative_1x" : "spot_prefunded";
  const requirements = [
    { venue: params.firstVenue, asset: params.options.marketType === "perp" ? "quote" as const : params.firstAsset, required: params.options.marketType === "perp" ? params.options.targetNotionalUsd : params.firstRequired },
    { venue: params.secondVenue, asset: params.options.marketType === "perp" ? "quote" as const : params.secondAsset, required: params.options.marketType === "perp" ? params.options.targetNotionalUsd : params.secondRequired }
  ].map((requirement) => {
    const inventory = params.options.inventory?.[requirement.venue];
    const available = requirement.asset === "quote" ? inventory?.quoteUsd : inventory?.baseUnits;
    return {
      ...requirement,
      required: round(requirement.required),
      available: available === undefined ? null : round(available),
      ready: available === undefined ? null : available >= requirement.required
    };
  });
  const known = requirements.every((row) => row.available !== null);
  return {
    state: !known ? "unknown" : requirements.every((row) => row.ready) ? "ready" : "insufficient",
    model,
    requirements
  };
}

function opportunityStatus(params: {
  blocked: boolean;
  inventory: InventoryReadiness;
  netEdgeBps: number;
  minNetEdgeBps: number;
}): "candidate" | "below_threshold" | "blocked" {
  if (params.blocked || params.inventory.state === "insufficient") return "blocked";
  return params.netEdgeBps >= params.minNetEdgeBps ? "candidate" : "below_threshold";
}

function opportunityScore(params: {
  netEdgeBps: number;
  minNetEdgeBps: number;
  depthCoverage: number;
  quality: CrossMarketQuality[];
  inventory: InventoryReadiness;
  blocked: boolean;
}): number {
  if (params.blocked) return 0;
  const edgeTarget = Math.max(1, params.minNetEdgeBps || 10);
  const edge = clamp((params.netEdgeBps / edgeTarget) * 35, 0, 55);
  const depth = clamp(params.depthCoverage, 0, 1) * 20;
  const quality = params.quality.every((item) => item === "fresh") ? 15 : 8;
  const inventory = params.inventory.state === "ready" ? 10 : params.inventory.state === "unknown" ? 5 : 0;
  return Math.round(clamp(edge + depth + quality + inventory, 0, 100));
}

function sortOpportunities<T extends { status: string; score: number; netEdgeBps: number }>(items: T[]): T[] {
  const rank = { candidate: 0, below_threshold: 1, blocked: 2 } as Record<string, number>;
  return items.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || b.score - a.score
    || b.netEdgeBps - a.netEdgeBps);
}

export function scanArbitrage(options: CrossMarketScanOptions): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  for (const buyBook of options.books) {
    for (const sellBook of options.books) {
      if (buyBook.venue === sellBook.venue) continue;
      const buyPrice = normalizeLevels(buyBook.asks, "asks")[0]?.[0];
      const sellPrice = normalizeLevels(sellBook.bids, "bids")[0]?.[0];
      if (!buyPrice || !sellPrice) continue;
      const baseSize = options.targetNotionalUsd / buyPrice;
      const targetBuyFill = fillBase(buyBook.asks, baseSize, "buy");
      const targetSellFill = fillBase(sellBook.bids, baseSize, "sell");
      const executableBase = Math.min(targetBuyFill.filledBase, targetSellFill.filledBase);
      if (!finitePositive(executableBase)) continue;
      const buyFill = fillBase(buyBook.asks, executableBase, "buy");
      const sellFill = fillBase(sellBook.bids, executableBase, "sell");
      if (!buyFill.vwap || !sellFill.vwap) continue;
      const depthCoverage = Math.min(targetBuyFill.coverage, targetSellFill.coverage);
      const buyFee = feeFor(options, buyBook.venue);
      const sellFee = feeFor(options, sellBook.venue);
      const feesUsd = buyFill.quote * buyFee.takerBps / 10_000 + sellFill.quote * sellFee.takerBps / 10_000;
      const bufferUsd = buyFill.quote * options.safetyBufferBps / 10_000;
      const expectedNetUsd = sellFill.quote - buyFill.quote - feesUsd - bufferUsd;
      const netEdgeBps = buyFill.quote > 0 ? expectedNetUsd / buyFill.quote * 10_000 : -10_000;
      const feeBps = buyFill.quote > 0 ? feesUsd / buyFill.quote * 10_000 : buyFee.takerBps + sellFee.takerBps;
      const inventory = inventoryReadiness({
        options,
        firstVenue: buyBook.venue,
        secondVenue: sellBook.venue,
        firstAsset: "quote",
        secondAsset: "base",
        firstRequired: buyFill.quote,
        secondRequired: executableBase
      });
      const skewMs = observationSkewMs(buyBook, sellBook);
      const blocked = !targetBuyFill.complete || !targetSellFill.complete
        || isBookBlocked(buyBook, options.maxBookAgeMs)
        || isBookBlocked(sellBook, options.maxBookAgeMs)
        || (skewMs !== null && skewMs > options.maxObservationSkewMs);
      const warnings = [...new Set([
        ...bookWarnings(buyBook, options.maxBookAgeMs),
        ...bookWarnings(sellBook, options.maxBookAgeMs),
        ...(!targetBuyFill.complete || !targetSellFill.complete ? ["target_depth_insufficient"] : []),
        ...(skewMs !== null && skewMs > options.maxObservationSkewMs ? ["book_observation_skew_exceeded"] : []),
        ...(inventory.state === "unknown" ? ["inventory_not_provided"] : []),
        ...(inventory.state === "insufficient" ? ["inventory_insufficient"] : [])
      ])];
      const status = opportunityStatus({ blocked, inventory, netEdgeBps, minNetEdgeBps: options.minNetEdgeBps });
      opportunities.push({
        id: `arb:${options.symbol}:${buyBook.venue}:${sellBook.venue}`,
        buyVenue: buyBook.venue,
        sellVenue: sellBook.venue,
        buyPrice: round(buyPrice),
        sellPrice: round(sellPrice),
        buyVwap: round(buyFill.vwap),
        sellVwap: round(sellFill.vwap),
        baseSize: round(executableBase),
        capitalUsd: round(buyFill.quote, 2),
        executableUsd: round(executableBase * buyFill.vwap, 2),
        grossEdgeBps: round(((sellPrice / buyPrice) - 1) * 10_000, 4),
        slippageBps: round(buyFill.slippageBps + sellFill.slippageBps, 4),
        feeBps: round(feeBps, 4),
        safetyBufferBps: options.safetyBufferBps,
        netEdgeBps: round(netEdgeBps, 4),
        expectedNetUsd: round(expectedNetUsd, 2),
        depthCoverage: round(depthCoverage, 4),
        inventory,
        score: opportunityScore({ netEdgeBps, minNetEdgeBps: options.minNetEdgeBps, depthCoverage,
          quality: [buyBook.quality, sellBook.quality], inventory, blocked }),
        status,
        warnings
      });
    }
  }
  return sortOpportunities(opportunities);
}

function xemmCandidate(options: CrossMarketScanOptions, makerBook: CrossMarketBook, takerBook: CrossMarketBook,
  makerSide: "buy" | "sell"): XemmOpportunity | null {
  const makerBids = normalizeLevels(makerBook.bids, "bids");
  const makerAsks = normalizeLevels(makerBook.asks, "asks");
  const takerBids = normalizeLevels(takerBook.bids, "bids");
  const takerAsks = normalizeLevels(takerBook.asks, "asks");
  const makerPrice = makerSide === "buy" ? makerBids[0]?.[0] : makerAsks[0]?.[0];
  if (!makerPrice || !makerBids[0] || !makerAsks[0] || !takerBids[0] || !takerAsks[0]) return null;
  const targetBaseSize = options.targetNotionalUsd / makerPrice;
  const targetHedgeFill = fillBase(makerSide === "buy" ? takerBook.bids : takerBook.asks, targetBaseSize,
    makerSide === "buy" ? "sell" : "buy");
  const baseSize = targetHedgeFill.filledBase;
  const hedgeFill = fillBase(makerSide === "buy" ? takerBook.bids : takerBook.asks, baseSize,
    makerSide === "buy" ? "sell" : "buy");
  if (!hedgeFill.vwap) return null;
  const makerQuote = makerPrice * baseSize;
  const makerFee = makerQuote * feeFor(options, makerBook.venue).makerBps / 10_000;
  const takerFee = hedgeFill.quote * feeFor(options, takerBook.venue).takerBps / 10_000;
  const bufferUsd = makerQuote * options.safetyBufferBps / 10_000;
  const grossPnl = makerSide === "buy" ? hedgeFill.quote - makerQuote : makerQuote - hedgeFill.quote;
  const expectedNetUsd = grossPnl - makerFee - takerFee - bufferUsd;
  const netEdgeBps = expectedNetUsd / makerQuote * 10_000;
  const feesBps = (makerFee + takerFee) / makerQuote * 10_000;
  const inventory = inventoryReadiness({
    options,
    firstVenue: makerBook.venue,
    secondVenue: takerBook.venue,
    firstAsset: makerSide === "buy" ? "quote" : "base",
    secondAsset: makerSide === "buy" ? "base" : "quote",
    firstRequired: makerSide === "buy" ? makerQuote : baseSize,
    secondRequired: makerSide === "buy" ? baseSize : hedgeFill.quote
  });
  const skewMs = observationSkewMs(makerBook, takerBook);
  const blocked = !targetHedgeFill.complete
    || isBookBlocked(makerBook, options.maxBookAgeMs)
    || isBookBlocked(takerBook, options.maxBookAgeMs)
    || (skewMs !== null && skewMs > options.maxObservationSkewMs);
  const warnings = [...new Set([
    ...bookWarnings(makerBook, options.maxBookAgeMs),
    ...bookWarnings(takerBook, options.maxBookAgeMs),
    "maker_fill_not_guaranteed",
    ...(!targetHedgeFill.complete ? ["hedge_depth_insufficient"] : []),
    ...(skewMs !== null && skewMs > options.maxObservationSkewMs ? ["book_observation_skew_exceeded"] : []),
    ...(inventory.state === "unknown" ? ["inventory_not_provided"] : []),
    ...(inventory.state === "insufficient" ? ["inventory_insufficient"] : [])
  ])];
  const status = opportunityStatus({ blocked, inventory, netEdgeBps, minNetEdgeBps: options.minNetEdgeBps });
  return {
    id: `xemm:${options.symbol}:${makerBook.venue}:${takerBook.venue}:${makerSide}`,
    makerVenue: makerBook.venue,
    takerVenue: takerBook.venue,
    makerSide,
    makerPrice: round(makerPrice),
    hedgeVwap: round(hedgeFill.vwap),
    baseSize: round(baseSize),
    capitalUsd: round(makerQuote, 2),
    executableUsd: round(hedgeFill.filledBase * makerPrice, 2),
    makerSpreadBps: round(((makerAsks[0][0] / makerBids[0][0]) - 1) * 10_000, 4),
    takerSpreadBps: round(((takerAsks[0][0] / takerBids[0][0]) - 1) * 10_000, 4),
    grossEdgeBps: round(grossPnl / makerQuote * 10_000, 4),
    hedgeSlippageBps: round(hedgeFill.slippageBps, 4),
    feeBps: round(feesBps, 4),
    safetyBufferBps: options.safetyBufferBps,
    netEdgeBps: round(netEdgeBps, 4),
    expectedNetUsd: round(expectedNetUsd, 2),
    depthCoverage: round(targetHedgeFill.coverage, 4),
    inventory,
    score: opportunityScore({ netEdgeBps, minNetEdgeBps: options.minNetEdgeBps, depthCoverage: targetHedgeFill.coverage,
      quality: [makerBook.quality, takerBook.quality], inventory, blocked }),
    status,
    warnings
  };
}

export function scanXemm(options: CrossMarketScanOptions): XemmOpportunity[] {
  const opportunities: XemmOpportunity[] = [];
  for (const makerBook of options.books) {
    for (const takerBook of options.books) {
      if (makerBook.venue === takerBook.venue) continue;
      for (const side of ["buy", "sell"] as const) {
        const candidate = xemmCandidate(options, makerBook, takerBook, side);
        if (candidate) opportunities.push(candidate);
      }
    }
  }
  return sortOpportunities(opportunities);
}
