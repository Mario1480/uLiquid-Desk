import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_MARGIN_COIN, HYPERLIQUID_DEFAULT_PRODUCT_TYPE } from "./hyperliquid.constants.js";
import { HyperliquidMarketApi } from "./hyperliquid.market.api.js";
import { coinToCanonicalSymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidPositionRaw, HyperliquidProductType } from "./hyperliquid.types.js";

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class HyperliquidPositionApi {
  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string,
    private readonly marketApi?: HyperliquidMarketApi
  ) {}

  async getAllPositions(params: {
    productType?: HyperliquidProductType;
    marginCoin?: string;
  } = {}): Promise<HyperliquidPositionRaw[]> {
    const state = await this.sdk.info.perpetuals.getClearinghouseState(this.userAddress, true);
    const priceByCoin = new Map<
      string,
      {
        markPrice: number | null;
        priceSource: "markPx" | "mid" | null;
      }
    >();
    if (this.marketApi) {
      const snapshot = await this.marketApi.getMarketSnapshot().catch(() => null);
      if (snapshot) {
        for (const [coin, ticker] of snapshot.tickersByCoin.entries()) {
          priceByCoin.set(coin, {
            markPrice: toNumber(ticker.markPrice),
            priceSource: ticker.priceSource
          });
        }
      }
    }
    if (priceByCoin.size === 0) {
      const allMids = await this.sdk.info.getAllMids(true).catch(() => ({} as Record<string, string>));
      for (const [coin, mark] of Object.entries(allMids)) {
        priceByCoin.set(String(coin).toUpperCase(), {
          markPrice: toNumber(mark),
          priceSource: "mid"
        });
      }
    }

    const rows = Array.isArray(state?.assetPositions) ? state.assetPositions : [];

    const normalized = rows
      .map((row) => {
        const position = row?.position;
        const coin = String(position?.coin ?? "").toUpperCase();
        const szi = toNumber(position?.szi);
        const absSize = Math.abs(szi);
        if (!coin || absSize <= 0) return null;

        const price = priceByCoin.get(coin) ?? null;
        const markPrice = toNumber(price?.markPrice ?? null);

        return {
          symbol: coinToCanonicalSymbol(coin),
          holdSide: szi >= 0 ? "long" : "short",
          total: String(absSize),
          avgOpenPrice: String(position?.entryPx ?? "0"),
          markPrice: markPrice > 0 ? String(markPrice) : undefined,
          markPriceSource: price?.priceSource ?? undefined,
          unrealizedPL: String(position?.unrealizedPnl ?? "0"),
          leverage: String(position?.leverage?.value ?? ""),
          marginMode: String(position?.leverage?.type ?? "cross")
        } satisfies HyperliquidPositionRaw;
      })
      .filter((row) => row !== null);

    return normalized;
  }

  async getPositionsBySymbol(params: {
    symbol: string;
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<HyperliquidPositionRaw[]> {
    const all = await this.getAllPositions({
      productType: params.productType ?? HYPERLIQUID_DEFAULT_PRODUCT_TYPE,
      marginCoin: params.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN
    });
    return all.filter((row) => String(row.symbol ?? "").toUpperCase() === params.symbol.toUpperCase());
  }
}
