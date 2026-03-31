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
  private resolvedAgentMasterPromise: Promise<string | null> | null = null;

  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string,
    private readonly marketApi?: HyperliquidMarketApi,
    private readonly walletAddress?: string | null
  ) {}

  private async resolveAgentMasterAddress(): Promise<string | null> {
    if (this.resolvedAgentMasterPromise) return this.resolvedAgentMasterPromise;
    this.resolvedAgentMasterPromise = (async () => {
      if (!this.walletAddress) return null;
      const response = await (this.sdk.info as any).getUserRole(this.walletAddress, true).catch(() => null);
      const role = String((response as any)?.role ?? response ?? "").trim().toLowerCase();
      const master = String((response as any)?.data?.user ?? "").trim().toLowerCase();
      if (role !== "agent" || !/^0x[a-f0-9]{40}$/.test(master)) return null;
      return master;
    })();
    return this.resolvedAgentMasterPromise;
  }

  private async getReadAddresses(): Promise<string[]> {
    const candidates = [
      this.userAddress,
      await this.resolveAgentMasterAddress(),
      this.walletAddress ?? null
    ];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      ordered.push(normalized);
    }
    return ordered;
  }

  async getAllPositions(params: {
    productType?: HyperliquidProductType;
    marginCoin?: string;
  } = {}): Promise<HyperliquidPositionRaw[]> {
    const readAddresses = await this.getReadAddresses();
    let state: any = null;
    for (const address of readAddresses) {
      const candidate = await this.sdk.info.perpetuals.getClearinghouseState(address, true);
      const hasBalances =
        Number(candidate?.marginSummary?.accountValue ?? candidate?.crossMarginSummary?.accountValue ?? "0") > 0
        || Number(candidate?.withdrawable ?? "0") > 0;
      const hasPositions = Array.isArray(candidate?.assetPositions) && candidate.assetPositions.length > 0;
      if (!state) state = candidate;
      if (hasBalances || hasPositions) {
        state = candidate;
        break;
      }
    }
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
      .map((row: any) => {
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
      .filter((row: HyperliquidPositionRaw | null): row is HyperliquidPositionRaw => row !== null);

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
