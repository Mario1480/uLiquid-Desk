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
  private resolvedAgentMasterPromise: Promise<string | null> | null = null;

  constructor(
    private readonly sdk: Hyperliquid,
    private readonly userAddress: string,
    private readonly walletAddress?: string | null
  ) {}

  private async readClearinghouseState(address: string) {
    return this.sdk.info.perpetuals.getClearinghouseState(address, true);
  }

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

  async getAccounts(_productType: HyperliquidProductType = HYPERLIQUID_DEFAULT_PRODUCT_TYPE): Promise<HyperliquidAccountRaw[]> {
    let equity = "0";
    let available = "0";
    const readAddresses = await this.getReadAddresses();
    for (const address of readAddresses) {
      const state = await this.readClearinghouseState(address);
      const nextEquity = state?.marginSummary?.accountValue ?? state?.crossMarginSummary?.accountValue ?? "0";
      const nextAvailable = state?.withdrawable ?? "0";
      const nextEquityNumber = Number(nextEquity);
      const nextAvailableNumber = Number(nextAvailable);
      const hasPositions = Array.isArray(state?.assetPositions) && state.assetPositions.length > 0;
      if (equity === "0" && available === "0") {
        equity = nextEquity;
        available = nextAvailable;
      }
      if (
        (Number.isFinite(nextEquityNumber) && nextEquityNumber > 0) ||
        (Number.isFinite(nextAvailableNumber) && nextAvailableNumber > 0) ||
        hasPositions
      ) {
        equity = nextEquity;
        available = nextAvailable;
        break;
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
