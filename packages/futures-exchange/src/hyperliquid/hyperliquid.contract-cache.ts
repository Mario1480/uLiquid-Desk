import type { ContractCacheOptions } from "@mm/futures-core";
import { ContractCache } from "@mm/futures-core";
import type { HyperliquidContractInfo, HyperliquidUniverseRaw, HyperliquidAssetCtxRaw } from "./hyperliquid.types.js";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";
import {
  hyperliquidPriceDecimalsForValue,
  hyperliquidPriceTickForValue,
  hyperliquidSizeStepFromSzDecimals
} from "./hyperliquid.precision.js";
import { coinToCanonicalSymbol, normalizeHyperliquidSymbol, toInternalPerpSymbol } from "./hyperliquid.symbols.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toHyperliquidContractInfo(params: {
  index: number;
  universe: HyperliquidUniverseRaw;
  assetCtx: HyperliquidAssetCtxRaw | null;
}): HyperliquidContractInfo {
  const coin = normalizeHyperliquidSymbol(String(params.universe.name ?? ""));
  const canonicalSymbol = coinToCanonicalSymbol(coin);
  const exchangeSymbol = toInternalPerpSymbol(coin);
  const stepSize = hyperliquidSizeStepFromSzDecimals(params.universe.szDecimals);
  const maxLeverage = toNumber(params.universe.maxLeverage);
  const referencePrice = toNumber(params.assetCtx?.markPx) ?? toNumber(params.assetCtx?.oraclePx);
  const priceScale = hyperliquidPriceDecimalsForValue(referencePrice, params.universe.szDecimals, "perp");
  const tickSize = hyperliquidPriceTickForValue(referencePrice, params.universe.szDecimals, "perp");

  return {
    canonicalSymbol,
    exchangeSymbol,
    baseAsset: coin,
    quoteAsset: "USDC",
    apiAllowed: true,
    priceScale,
    volScale: toNumber(params.universe.szDecimals),
    priceUnit: tickSize,
    volUnit: stepSize,
    tickSize,
    stepSize,
    minVol: stepSize,
    maxVol: null,
    minLeverage: 1,
    maxLeverage,
    contractSize: 1,
    makerFeeRate: null,
    takerFeeRate: null,
    updatedAt: new Date().toISOString(),
    assetIndex: params.index,
    coin,
    raw: {
      universe: params.universe,
      assetCtx: params.assetCtx
    }
  };
}

export class HyperliquidContractCache {
  private readonly cache: ContractCache;

  constructor(
    private readonly marketApi: HyperliquidMarketApi,
    options: Pick<ContractCacheOptions, "ttlSeconds" | "now"> = {}
  ) {
    this.cache = new ContractCache({
      ttlSeconds: options.ttlSeconds,
      now: options.now,
      loader: async () => {
        const [meta, assetCtxs] = await this.marketApi.getMetaAndAssetCtxs();
        const universe = Array.isArray(meta?.universe) ? meta.universe : [];
        return universe
          .map((row, index) =>
            toHyperliquidContractInfo({
              index,
              universe: row,
              assetCtx: Array.isArray(assetCtxs) ? (assetCtxs[index] ?? null) : null
            })
          )
          .filter((row) => row.coin.length > 0);
      }
    });
  }

  async warmup(): Promise<void> {
    await this.cache.warmup();
  }

  startBackgroundRefresh(): void {
    this.cache.startBackgroundRefresh();
  }

  stopBackgroundRefresh(): void {
    this.cache.stopBackgroundRefresh();
  }

  async refresh(force = false): Promise<void> {
    await this.cache.refresh(force);
  }

  async getByCanonical(symbol: string): Promise<HyperliquidContractInfo | null> {
    return (await this.cache.getByCanonical(symbol)) as HyperliquidContractInfo | null;
  }

  async getByHyperliquid(symbol: string): Promise<HyperliquidContractInfo | null> {
    return (await this.cache.getByExchange(symbol)) as HyperliquidContractInfo | null;
  }

  snapshot(): HyperliquidContractInfo[] {
    return this.cache.snapshot() as HyperliquidContractInfo[];
  }

  getSymbolRegistry() {
    return this.cache.getSymbolRegistry();
  }
}
