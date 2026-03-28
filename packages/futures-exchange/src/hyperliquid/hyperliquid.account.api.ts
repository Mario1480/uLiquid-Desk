import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_MARGIN_COIN, HYPERLIQUID_DEFAULT_PRODUCT_TYPE } from "./hyperliquid.constants.js";
import { parseCoinFromAnySymbol, toInternalPerpSymbol } from "./hyperliquid.symbols.js";
import type { HyperliquidAccountRaw, HyperliquidProductType } from "./hyperliquid.types.js";

function toStringNumber(value: unknown, fallback = "0"): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}

export class HyperliquidAccountApi {
  private readonly marginModeBySymbol = new Map<string, "isolated" | "crossed">();

  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string,
    private readonly walletAddress?: string | null
  ) {}

  private async readClearinghouseState(address: string) {
    return this.sdk.info.perpetuals.getClearinghouseState(address, true);
  }

  async getAccounts(_productType: HyperliquidProductType = HYPERLIQUID_DEFAULT_PRODUCT_TYPE): Promise<HyperliquidAccountRaw[]> {
    let state = await this.readClearinghouseState(this.userAddress);
    let equity = state?.marginSummary?.accountValue ?? state?.crossMarginSummary?.accountValue ?? "0";
    let available = state?.withdrawable ?? "0";
    const primaryEquity = Number(equity);
    const primaryAvailable = Number(available);

    if (
      this.walletAddress &&
      this.walletAddress !== this.userAddress &&
      Number.isFinite(primaryEquity) &&
      Number.isFinite(primaryAvailable) &&
      primaryEquity <= 0 &&
      primaryAvailable <= 0
    ) {
      const walletState = await this.readClearinghouseState(this.walletAddress);
      const walletEquity = walletState?.marginSummary?.accountValue ?? walletState?.crossMarginSummary?.accountValue ?? "0";
      const walletAvailable = walletState?.withdrawable ?? "0";
      const walletEquityNumber = Number(walletEquity);
      const walletAvailableNumber = Number(walletAvailable);
      if (
        (Number.isFinite(walletEquityNumber) && walletEquityNumber > 0) ||
        (Number.isFinite(walletAvailableNumber) && walletAvailableNumber > 0)
      ) {
        state = walletState;
        equity = walletEquity;
        available = walletAvailable;
      }
    }

    return [
      {
        marginCoin: HYPERLIQUID_DEFAULT_MARGIN_COIN,
        available: toStringNumber(available),
        crossAvailable: toStringNumber(available),
        accountEquity: toStringNumber(equity)
      }
    ];
  }

  async getAccount(params: {
    symbol?: string;
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<HyperliquidAccountRaw> {
    const rows = await this.getAccounts(params.productType);
    return rows[0] ?? {
      marginCoin: params.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN,
      available: "0",
      crossAvailable: "0",
      accountEquity: "0"
    };
  }

  async setLeverage(params: {
    symbol: string;
    leverage: number;
    productType?: HyperliquidProductType;
    marginCoin?: string;
    holdSide?: "long" | "short";
  }): Promise<unknown> {
    const marginMode = this.marginModeBySymbol.get(params.symbol) ?? "crossed";
    const leverageMode = marginMode === "isolated" ? "isolated" : "cross";
    const coin = parseCoinFromAnySymbol(params.symbol);
    return this.sdk.exchange.updateLeverage(toInternalPerpSymbol(coin), leverageMode, Math.max(1, Math.trunc(params.leverage)));
  }

  async setMarginMode(params: {
    symbol: string;
    marginMode: "isolated" | "crossed";
    productType?: HyperliquidProductType;
    marginCoin?: string;
  }): Promise<unknown> {
    this.marginModeBySymbol.set(params.symbol, params.marginMode);
    return { ok: true };
  }

  async getPositionMode(_productType: HyperliquidProductType = HYPERLIQUID_DEFAULT_PRODUCT_TYPE): Promise<{ posMode?: string }> {
    return { posMode: "one_way_mode" };
  }

  async setPositionMode(_params: {
    productType?: HyperliquidProductType;
    posMode: "one_way_mode" | "hedge_mode";
  }): Promise<unknown> {
    return { ok: true };
  }

  async addPositionMargin(params: {
    symbol: string;
    amountUsd: number;
    marginMode?: "isolated" | "crossed";
  }): Promise<unknown> {
    const amount = Math.max(0, Number(params.amountUsd ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("hyperliquid_invalid_margin_amount");
    }
    const coin = parseCoinFromAnySymbol(params.symbol);
    const internalSymbol = toInternalPerpSymbol(coin);
    const exchangeAny = (this.sdk as any)?.exchange;
    if (!exchangeAny || typeof exchangeAny !== "object") {
      throw new Error("hyperliquid_add_margin_unsupported");
    }

    const attempts: Array<() => Promise<unknown>> = [
      async () => {
        if (typeof exchangeAny.updateIsolatedMargin !== "function") throw new Error("missing_updateIsolatedMargin");
        return exchangeAny.updateIsolatedMargin(internalSymbol, amount);
      },
      async () => {
        if (typeof exchangeAny.updateIsolatedMargin !== "function") throw new Error("missing_updateIsolatedMargin");
        return exchangeAny.updateIsolatedMargin({ symbol: internalSymbol, amount, isAdd: true });
      },
      async () => {
        if (typeof exchangeAny.adjustMargin !== "function") throw new Error("missing_adjustMargin");
        return exchangeAny.adjustMargin(internalSymbol, amount, true);
      },
      async () => {
        if (typeof exchangeAny.updateMargin !== "function") throw new Error("missing_updateMargin");
        return exchangeAny.updateMargin(internalSymbol, amount, true);
      }
    ];

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`hyperliquid_add_margin_failed:${String(lastError)}`);
  }
}
