export type PaperMarketType = "spot" | "perp";

export type PaperRuntimePolicyFlags = {
  manualTradingSpotEnabled: boolean;
  mexcSpotEnabled: boolean;
  mexcPerpEnabled: boolean;
  binanceSpotEnabled: boolean;
  binancePerpEnabled: boolean;
};

export type PaperRuntimeContract = {
  executionVenue: "paper";
  marketDataLinkMode: "linked_live_venue";
  requiresLinkedMarketData: true;
  supportedMarketTypes: PaperMarketType[];
};

export type PaperLinkedMarketDataSupport = {
  supported: boolean;
  code:
    | null
    | "manual_spot_trading_disabled"
    | "paper_spot_requires_supported_market_data"
    | "paper_perp_requires_supported_market_data";
};

export type LinkedMarketDataContext = {
  exchangeAccountId: string | null;
  marketDataVenue: string | null;
  supported: boolean;
  supportCode:
    | null
    | "manual_spot_trading_disabled"
    | "paper_spot_requires_supported_market_data"
    | "paper_perp_requires_supported_market_data";
};

export type PaperSimulationPolicy = {
  feeBps: number;
  slippageBps: number;
  makerFeeBps: number;
  takerFeeBps: number;
  marketOrderSlippageBps: number;
  stopOrderSlippageBps: number;
  limitPartialFillRatio: number;
  initialMarginRatio: number;
  maintenanceMarginRatio: number;
  liquidationSlippageBps: number;
  fundingMode: "disabled" | "fixed_rate";
  fundingRateBpsPerHour: number;
  fundingIntervalMinutes: number;
  startBalanceUsd: number;
};

export type PaperExecutionContext = {
  executionVenue: "paper";
  marketType: PaperMarketType;
  runtimeContract: PaperRuntimeContract;
  linkedMarketData: LinkedMarketDataContext;
  simulationPolicy: PaperSimulationPolicy;
};

export const PAPER_RUNTIME_CONTRACT: PaperRuntimeContract = {
  executionVenue: "paper",
  marketDataLinkMode: "linked_live_venue",
  requiresLinkedMarketData: true,
  supportedMarketTypes: ["spot", "perp"]
};

function normalizeExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
}

function readBpsEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

function readRatioEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, Number(parsed)));
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(Number(parsed)));
}

function readUsdEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed));
}

export function isValidPaperLinkedMarketDataExchange(exchange: unknown): boolean {
  return normalizeExchange(exchange) !== "" && normalizeExchange(exchange) !== "paper";
}

export function resolvePaperLinkedMarketDataSupport(
  params: {
    marketType: PaperMarketType;
    marketDataExchange?: string | null;
  },
  flags: PaperRuntimePolicyFlags
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
    if (marketDataExchange === "mexc" && flags.mexcSpotEnabled) {
      return { supported: true, code: null };
    }
    return {
      supported: false,
      code: "paper_spot_requires_supported_market_data"
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
    code: "paper_perp_requires_supported_market_data"
  };
}

export function readPaperRuntimePolicyFlagsFromEnv(): PaperRuntimePolicyFlags {
  const mexcFuturesEnabledLegacy = readBoolEnv("MEXC_FUTURES_ENABLED", false);

  return {
    manualTradingSpotEnabled: readBoolEnv(
      "MANUAL_TRADING_SPOT_ENABLED",
      readBoolEnv("ENABLE_MANUAL_TRADING_SPOT", true)
    ),
    mexcSpotEnabled: readBoolEnv("MEXC_SPOT_ENABLED", true),
    mexcPerpEnabled: readBoolEnv("MEXC_PERP_ENABLED", mexcFuturesEnabledLegacy),
    binanceSpotEnabled: readBoolEnv("BINANCE_SPOT_ENABLED", true),
    binancePerpEnabled: readBoolEnv("BINANCE_PERP_ENABLED", true)
  };
}

export function resolvePaperSimulationPolicyFromEnv(): PaperSimulationPolicy {
  const feeBpsLegacy = readBpsEnv("PAPER_TRADING_FEE_BPS", Number.NaN);
  const slippageBpsLegacy = readBpsEnv("PAPER_TRADING_SLIPPAGE_BPS", Number.NaN);
  const makerFeeBps = Number.isFinite(feeBpsLegacy)
    ? feeBpsLegacy
    : readBpsEnv("PAPER_TRADING_MAKER_FEE_BPS", 2);
  const takerFeeBps = Number.isFinite(feeBpsLegacy)
    ? feeBpsLegacy
    : readBpsEnv("PAPER_TRADING_TAKER_FEE_BPS", 5);
  const marketOrderSlippageBps = Number.isFinite(slippageBpsLegacy)
    ? slippageBpsLegacy
    : readBpsEnv("PAPER_TRADING_MARKET_SLIPPAGE_BPS", 3);
  const stopOrderSlippageBps = Number.isFinite(slippageBpsLegacy)
    ? slippageBpsLegacy
    : readBpsEnv("PAPER_TRADING_STOP_SLIPPAGE_BPS", Math.max(4, marketOrderSlippageBps));
  const fundingRateBpsPerHour = readBpsEnv("PAPER_TRADING_FUNDING_RATE_BPS_PER_HOUR", 0);
  const explicitFundingMode = String(process.env.PAPER_TRADING_FUNDING_MODE ?? "").trim().toLowerCase();
  const fundingMode: PaperSimulationPolicy["fundingMode"] =
    explicitFundingMode === "fixed_rate" || fundingRateBpsPerHour > 0
      ? "fixed_rate"
      : "disabled";

  return {
    feeBps: takerFeeBps,
    slippageBps: marketOrderSlippageBps,
    makerFeeBps,
    takerFeeBps,
    marketOrderSlippageBps,
    stopOrderSlippageBps,
    limitPartialFillRatio: readRatioEnv("PAPER_TRADING_LIMIT_PARTIAL_FILL_RATIO", 0.5),
    initialMarginRatio: readRatioEnv("PAPER_TRADING_INITIAL_MARGIN_RATIO", 0.1),
    maintenanceMarginRatio: readRatioEnv("PAPER_TRADING_MAINTENANCE_MARGIN_RATIO", 0.05),
    liquidationSlippageBps: readBpsEnv("PAPER_TRADING_LIQUIDATION_SLIPPAGE_BPS", 15),
    fundingMode,
    fundingRateBpsPerHour,
    fundingIntervalMinutes: readPositiveIntegerEnv("PAPER_TRADING_FUNDING_INTERVAL_MINUTES", 60),
    startBalanceUsd: readUsdEnv("PAPER_TRADING_START_BALANCE_USD", 10000)
  };
}

export function createPaperExecutionContext(params: {
  marketType: PaperMarketType;
  marketDataExchange?: string | null;
  marketDataExchangeAccountId?: string | null;
  flags?: PaperRuntimePolicyFlags;
  simulationPolicy?: PaperSimulationPolicy;
}): PaperExecutionContext {
  const support = resolvePaperLinkedMarketDataSupport(
    {
      marketType: params.marketType,
      marketDataExchange: params.marketDataExchange ?? null
    },
    params.flags ?? readPaperRuntimePolicyFlagsFromEnv()
  );

  return {
    executionVenue: "paper",
    marketType: params.marketType,
    runtimeContract: PAPER_RUNTIME_CONTRACT,
    linkedMarketData: {
      exchangeAccountId: params.marketDataExchangeAccountId ?? null,
      marketDataVenue: normalizeExchange(params.marketDataExchange),
      supported: support.supported,
      supportCode: support.code
    },
    simulationPolicy: params.simulationPolicy ?? resolvePaperSimulationPolicyFromEnv()
  };
}
