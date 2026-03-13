import { BitgetFuturesAdapter } from "../bitget/bitget.adapter.js";
import {
  BITGET_FUTURES_CAPABILITIES,
  BINANCE_MARKET_DATA_CAPABILITIES,
  HYPERLIQUID_FUTURES_CAPABILITIES,
  MEXC_FUTURES_CAPABILITIES,
  PAPER_FUTURES_CAPABILITIES,
  UNKNOWN_FUTURES_CAPABILITIES,
  type FuturesVenueCapabilities
} from "../core/exchange-capabilities.js";
import { HyperliquidFuturesAdapter } from "../hyperliquid/hyperliquid.adapter.js";
import { MexcFuturesAdapter } from "../mexc/mexc.adapter.js";

export type FuturesAdapterExchange = "bitget" | "hyperliquid" | "mexc" | "binance" | "paper";
export type LiveFuturesAdapterExchange = "bitget" | "hyperliquid" | "mexc";

export type FuturesAdapterAccount = {
  exchange: FuturesAdapterExchange | string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
};

export type CreateFuturesAdapterOptions = {
  allowMexcPerp?: boolean;
  allowBinancePerp?: boolean;
  bitgetProductType?: string;
  bitgetMarginCoin?: string;
  hyperliquidRestBaseUrl?: string;
  hyperliquidMarginCoin?: string;
  mexcRestBaseUrl?: string;
  mexcWsUrl?: string;
  mexcProductType?: string;
  mexcMarginCoin?: string;
};

export type SupportedFuturesAdapter =
  | BitgetFuturesAdapter
  | HyperliquidFuturesAdapter
  | MexcFuturesAdapter;

export type FuturesVenueResolutionCode =
  | "paper_account_requires_market_data_resolution"
  | "mexc_perp_disabled"
  | "binance_market_data_only"
  | "unsupported_exchange";

export type ResolvedFuturesVenue =
  | {
      requestedExchange: string;
      normalizedExchange: LiveFuturesAdapterExchange;
      kind: "adapter";
      code: null;
      capabilities: FuturesVenueCapabilities;
      createAdapter: () => SupportedFuturesAdapter;
    }
  | {
      requestedExchange: string;
      normalizedExchange: "paper" | "binance" | "mexc" | "unknown";
      kind: "paper" | "market_data_only" | "blocked" | "unsupported";
      code: FuturesVenueResolutionCode;
      capabilities: FuturesVenueCapabilities;
    };

export class FuturesAdapterFactoryError extends Error {
  readonly code: FuturesVenueResolutionCode;

  constructor(code: FuturesVenueResolutionCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export function resolveFuturesVenue(
  account: FuturesAdapterAccount,
  options: CreateFuturesAdapterOptions = {}
): ResolvedFuturesVenue {
  const requestedExchange = String(account.exchange ?? "").trim();
  const exchange = requestedExchange.toLowerCase();
  if (exchange === "paper") {
    return {
      requestedExchange,
      normalizedExchange: "paper",
      kind: "paper",
      code: "paper_account_requires_market_data_resolution",
      capabilities: PAPER_FUTURES_CAPABILITIES
    };
  }
  if (exchange === "hyperliquid") {
    return {
      requestedExchange,
      normalizedExchange: "hyperliquid",
      kind: "adapter",
      code: null,
      capabilities: HYPERLIQUID_FUTURES_CAPABILITIES,
      createAdapter: () =>
        new HyperliquidFuturesAdapter({
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          apiPassphrase: account.passphrase ?? undefined,
          restBaseUrl: options.hyperliquidRestBaseUrl ?? process.env.HYPERLIQUID_REST_BASE_URL,
          productType: "USDT-FUTURES",
          marginCoin: options.hyperliquidMarginCoin ?? process.env.HYPERLIQUID_MARGIN_COIN ?? "USDC"
        })
    };
  }
  if (exchange === "mexc") {
    const mexcEnabled = options.allowMexcPerp !== false;
    if (!mexcEnabled) {
      return {
        requestedExchange,
        normalizedExchange: "mexc",
        kind: "blocked",
        code: "mexc_perp_disabled",
        capabilities: MEXC_FUTURES_CAPABILITIES
      };
    }
    return {
      requestedExchange,
      normalizedExchange: "mexc",
      kind: "adapter",
      code: null,
      capabilities: MEXC_FUTURES_CAPABILITIES,
      createAdapter: () =>
        new MexcFuturesAdapter({
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          restBaseUrl: options.mexcRestBaseUrl ?? process.env.MEXC_REST_BASE_URL,
          wsUrl: options.mexcWsUrl ?? process.env.MEXC_WS_URL,
          productType: options.mexcProductType ?? process.env.MEXC_PRODUCT_TYPE ?? "USDT-FUTURES",
          marginCoin: options.mexcMarginCoin ?? process.env.MEXC_MARGIN_COIN ?? "USDT"
        })
    };
  }
  if (exchange === "binance") {
    if (options.allowBinancePerp === true) {
      return {
        requestedExchange,
        normalizedExchange: "binance",
        kind: "unsupported",
        code: "unsupported_exchange",
        capabilities: BINANCE_MARKET_DATA_CAPABILITIES
      };
    }
    return {
      requestedExchange,
      normalizedExchange: "binance",
      kind: "market_data_only",
      code: "binance_market_data_only",
      capabilities: BINANCE_MARKET_DATA_CAPABILITIES
    };
  }
  if (exchange !== "bitget") {
    return {
      requestedExchange,
      normalizedExchange: "unknown",
      kind: "unsupported",
      code: "unsupported_exchange",
      capabilities: UNKNOWN_FUTURES_CAPABILITIES
    };
  }
  return {
    requestedExchange,
    normalizedExchange: "bitget",
    kind: "adapter",
    code: null,
    capabilities: BITGET_FUTURES_CAPABILITIES,
    createAdapter: () =>
      new BitgetFuturesAdapter({
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        apiPassphrase: account.passphrase ?? undefined,
        productType: (options.bitgetProductType as any) ?? (process.env.BITGET_PRODUCT_TYPE as any) ?? "USDT-FUTURES",
        marginCoin: options.bitgetMarginCoin ?? process.env.BITGET_MARGIN_COIN ?? "USDT"
      })
  };
}

export function createFuturesAdapter(
  account: FuturesAdapterAccount,
  options: CreateFuturesAdapterOptions = {}
): SupportedFuturesAdapter {
  const resolved = resolveFuturesVenue(account, options);
  if (resolved.kind !== "adapter") {
    throw new FuturesAdapterFactoryError(resolved.code);
  }
  return resolved.createAdapter();
}
