import type {
  LinkedMarketDataContext,
  PaperExecutionContext,
  PaperMarketType,
  PaperSimulationPolicy
} from "@mm/futures-exchange";
import { ManualTradingError } from "../trading.js";

export type {
  LinkedMarketDataContext,
  PaperExecutionContext,
  PaperMarketType,
  PaperSimulationPolicy
} from "@mm/futures-exchange";

export type PaperPolicyFlags = {
  manualTradingSpotEnabled: boolean;
  mexcSpotEnabled: boolean;
  mexcPerpEnabled: boolean;
  binanceSpotEnabled: boolean;
  binancePerpEnabled: boolean;
};

export type PaperLinkedMarketDataSupport = {
  supported: boolean;
  code:
    | null
    | "manual_spot_trading_disabled"
    | "paper_spot_requires_supported_market_data"
    | "paper_perp_requires_supported_market_data";
};

export function readPaperPolicyFlagsFromEnv(): PaperPolicyFlags {
  const envEnabled = (name: string, fallback: boolean): boolean => {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
  };

  const mexcFuturesEnabledLegacy = envEnabled("MEXC_FUTURES_ENABLED", false);

  return {
    manualTradingSpotEnabled: envEnabled(
      "MANUAL_TRADING_SPOT_ENABLED",
      envEnabled("ENABLE_MANUAL_TRADING_SPOT", true)
    ),
    mexcSpotEnabled: envEnabled("MEXC_SPOT_ENABLED", true),
    mexcPerpEnabled: envEnabled("MEXC_PERP_ENABLED", mexcFuturesEnabledLegacy),
    binanceSpotEnabled: envEnabled("BINANCE_SPOT_ENABLED", true),
    binancePerpEnabled: envEnabled("BINANCE_PERP_ENABLED", true),
  };
}

function readBpsEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

function readUsdEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

export function resolvePaperSimulationPolicy(): PaperSimulationPolicy {
  return {
    feeBps: readBpsEnv("PAPER_TRADING_FEE_BPS", 0),
    slippageBps: readBpsEnv("PAPER_TRADING_SLIPPAGE_BPS", 0),
    fundingMode: "disabled",
    startBalanceUsd: readUsdEnv("PAPER_TRADING_START_BALANCE_USD", 10000)
  };
}

function normalizeExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidPaperLinkedMarketDataExchange(exchange: unknown): boolean {
  return normalizeExchange(exchange) !== "" && normalizeExchange(exchange) !== "paper";
}

export function resolvePaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: PaperPolicyFlags = readPaperPolicyFlagsFromEnv()
): PaperLinkedMarketDataSupport {
  const marketDataExchange = normalizeExchange(params.marketDataExchange);

  if (params.marketType === "spot") {
    if (!flags.manualTradingSpotEnabled) {
      return { supported: false, code: "manual_spot_trading_disabled" };
    }
    if (marketDataExchange === "bitget") {
      return { supported: true, code: null };
    }
    if (marketDataExchange === "binance" && flags.binanceSpotEnabled) {
      return { supported: true, code: null };
    }
    return {
      supported: false,
      code: "paper_spot_requires_supported_market_data",
    };
  }

  if (
    marketDataExchange === "bitget" ||
    marketDataExchange === "hyperliquid" ||
    (marketDataExchange === "mexc" && flags.mexcPerpEnabled) ||
    (marketDataExchange === "binance" && flags.binancePerpEnabled)
  ) {
    return { supported: true, code: null };
  }

  return {
    supported: false,
    code: "paper_perp_requires_supported_market_data",
  };
}

export function buildPaperExecutionContext(params: {
  marketType: PaperMarketType;
  marketDataExchange?: string | null;
  marketDataExchangeAccountId?: string | null;
  flags?: PaperPolicyFlags;
  simulationPolicy?: PaperSimulationPolicy;
}): PaperExecutionContext {
  const support = resolvePaperLinkedMarketDataSupport(
    {
      marketType: params.marketType,
      marketDataExchange: params.marketDataExchange ?? null
    },
    params.flags ?? readPaperPolicyFlagsFromEnv()
  );

  return {
    executionVenue: "paper",
    marketType: params.marketType,
    linkedMarketData: {
      exchangeAccountId: params.marketDataExchangeAccountId ?? null,
      marketDataVenue: normalizeExchange(params.marketDataExchange),
      supported: support.supported,
      supportCode: support.code
    },
    simulationPolicy: params.simulationPolicy ?? resolvePaperSimulationPolicy()
  };
}

export function assertPaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: PaperPolicyFlags = readPaperPolicyFlagsFromEnv()
): void {
  const support = resolvePaperLinkedMarketDataSupport(params, flags);
  if (support.supported) return;

  if (support.code === "manual_spot_trading_disabled") {
    throw new ManualTradingError(
      support.code,
      400,
      support.code
    );
  }

  throw new ManualTradingError(
    support.code ?? "paper_market_data_unsupported",
    400,
    support.code ?? "paper_market_data_unsupported"
  );
}
