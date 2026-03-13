import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import { createPerpMarketDataClient } from "../perp/perp-market-data.client.js";
import type { SpotClient } from "../spot/spot-client-factory.js";
import { createSpotClient } from "../spot/spot-client-factory.js";
import {
  marketTimeframeToBitgetSpotGranularity,
  normalizeSpotSymbol,
  splitCanonicalSymbol
} from "../spot/bitget-spot.mapper.js";
import {
  assertPaperLinkedMarketDataSupport,
  resolvePaperLinkedMarketDataSupport
} from "../paper/policy.js";
import {
  ManualTradingError,
  type TradingAccount,
  type TradingSettings
} from "../trading.js";

const MEXC_SPOT_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.MEXC_SPOT_ENABLED ?? "1").trim().toLowerCase()
);

const MEXC_PERP_ENABLED =
  typeof process.env.MEXC_PERP_ENABLED === "string"
    ? !["0", "false", "off", "no"].includes(
        String(process.env.MEXC_PERP_ENABLED ?? "0").trim().toLowerCase()
      )
    : !["0", "false", "off", "no"].includes(
        String(process.env.MEXC_FUTURES_ENABLED ?? "0").trim().toLowerCase()
      );

const MANUAL_TRADING_SPOT_ENABLED = !["0", "false", "off", "no"].includes(
  String(
    process.env.MANUAL_TRADING_SPOT_ENABLED ??
      process.env.ENABLE_MANUAL_TRADING_SPOT ??
      "1"
  ).trim().toLowerCase()
);

export type ManualResolvedTradingAccountPair = {
  selectedAccount: TradingAccount;
  marketDataAccount: TradingAccount;
};

function normalizeManualMarketType(value: unknown): "spot" | "perp" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "spot") return "spot";
  if (normalized === "perp") return "perp";
  return null;
}

export function resolveManualMarketType(input: {
  requested: unknown;
  settings: TradingSettings;
}): "spot" | "perp" {
  const requested = normalizeManualMarketType(input.requested);
  if (requested) return requested;
  return input.settings.marketType === "spot" ? "spot" : "perp";
}

export function resolveManualOrderSide(
  side: "long" | "short" | "buy" | "sell",
  marketType: "spot" | "perp"
): "buy" | "sell" {
  if (marketType === "spot") {
    if (side === "sell" || side === "short") return "sell";
    return "buy";
  }
  if (side === "buy" || side === "long") return "buy";
  return "sell";
}

export function resolveManualSpotSupport(params: {
  exchange: string;
  marketDataExchange?: string | null;
}): boolean {
  if (!MANUAL_TRADING_SPOT_ENABLED) return false;
  const exchange = String(params.exchange ?? "").toLowerCase();
  const marketDataExchange = String(params.marketDataExchange ?? exchange).toLowerCase();
  if (exchange === "binance") return false;
  if (exchange === "bitget" && marketDataExchange === "bitget") return true;
  if (exchange === "mexc" && marketDataExchange === "mexc") return MEXC_SPOT_ENABLED;
  if (exchange === "paper") {
    return resolvePaperLinkedMarketDataSupport({
      marketType: "spot",
      marketDataExchange
    }).supported;
  }
  return false;
}

export function resolveManualPerpSupport(params: {
  exchange: string;
  marketDataExchange?: string | null;
}): boolean {
  const exchange = String(params.exchange ?? "").toLowerCase();
  const marketDataExchange = String(params.marketDataExchange ?? exchange).toLowerCase();
  if (exchange === "binance") return false;
  if (exchange === "paper") {
    return resolvePaperLinkedMarketDataSupport({
      marketType: "perp",
      marketDataExchange
    }).supported;
  }
  if (exchange === "mexc") return MEXC_PERP_ENABLED;
  return true;
}

export function ensureManualSpotEligibility(resolved: ManualResolvedTradingAccountPair) {
  if (!MANUAL_TRADING_SPOT_ENABLED) {
    throw new ManualTradingError(
      "manual_spot_trading_disabled",
      400,
      "manual_spot_trading_disabled"
    );
  }

  const selected = String(resolved.selectedAccount.exchange ?? "").toLowerCase();
  const marketData = String(resolved.marketDataAccount.exchange ?? "").toLowerCase();

  if (selected === "binance") {
    throw new ManualTradingError(
      "binance_market_data_only",
      400,
      "binance_market_data_only"
    );
  }

  if (selected === "bitget" && marketData === "bitget") return;
  if (selected === "mexc" && marketData === "mexc") {
    if (!MEXC_SPOT_ENABLED) {
      throw new ManualTradingError(
        "mexc_spot_disabled",
        403,
        "mexc_spot_disabled"
      );
    }
    return;
  }
  if (selected === "paper") {
    assertPaperLinkedMarketDataSupport({
      marketType: "spot",
      marketDataExchange: marketData
    });
    return;
  }
  throw new ManualTradingError(
    "spot_mode_not_supported_for_exchange",
    400,
    "spot_mode_not_supported_for_exchange"
  );
}

export function ensureManualPerpEligibility(resolved: ManualResolvedTradingAccountPair) {
  const selected = String(resolved.selectedAccount.exchange ?? "").toLowerCase();
  const marketData = String(resolved.marketDataAccount.exchange ?? "").toLowerCase();

  if (selected === "binance") {
    throw new ManualTradingError(
      "binance_market_data_only",
      400,
      "binance_market_data_only"
    );
  }

  if (selected === "paper") {
    assertPaperLinkedMarketDataSupport({
      marketType: "perp",
      marketDataExchange: marketData
    });
    return;
  }

  if (selected === "mexc" && !MEXC_PERP_ENABLED) {
    throw new ManualTradingError(
      "mexc_perp_disabled",
      400,
      "mexc_perp_disabled"
    );
  }
}

export function createManualSpotClient(
  account: TradingAccount,
  endpoint: string
): SpotClient {
  return createSpotClient(account, { endpoint });
}

export function createManualPerpMarketDataClient(
  account: TradingAccount,
  _endpoint: string
): PerpMarketDataClient {
  return createPerpMarketDataClient(account);
}

export function inferSpotSummaryCurrency(symbol: string): string {
  const pair = splitCanonicalSymbol(symbol);
  return pair.quoteAsset ?? "USDT";
}

export function parseSpotOrderType(raw: string | null | undefined): "market" | "limit" {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "market" ? "market" : "limit";
}

export async function listBitgetSpotPositions(params: {
  client: SpotClient;
  symbol?: string | null;
  preferredQuoteAsset?: string | null;
}): Promise<Array<{
  symbol: string;
  side: "long";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: null;
  takeProfitPrice: null;
  stopLossPrice: null;
}>> {
  const balances = await params.client.getBalances();
  const normalizedSymbol = normalizeSpotSymbol(params.symbol);
  const requestedPair = normalizedSymbol ? splitCanonicalSymbol(normalizedSymbol) : null;
  const quoteAsset = requestedPair?.quoteAsset ?? String(params.preferredQuoteAsset ?? "USDT").toUpperCase();

  const rows = balances.filter((row) => {
    const asset = String(row.coin ?? row.asset ?? "").trim().toUpperCase();
    if (!asset) return false;
    if (asset === quoteAsset || asset === "USDT" || asset === "USDC") return false;
    if (requestedPair?.baseAsset && requestedPair.baseAsset !== asset) return false;
    const available = Number(row.available ?? 0);
    const frozen = Number(row.frozen ?? row.locked ?? row.lock ?? 0);
    return Number.isFinite(available + frozen) && available + frozen > 0;
  });

  const items = await Promise.all(rows.map(async (row) => {
    const baseAsset = String(row.coin ?? row.asset ?? "").trim().toUpperCase();
    const symbol = `${baseAsset}${quoteAsset}`;
    let markPrice: number | null = null;
    try {
      markPrice = await params.client.getLastPrice(symbol);
    } catch {
      markPrice = null;
    }
    const size = Number((Number(row.available ?? 0) + Number(row.frozen ?? row.locked ?? row.lock ?? 0)).toFixed(8));
    return {
      symbol,
      side: "long" as const,
      size,
      entryPrice: markPrice,
      markPrice,
      unrealizedPnl: null,
      takeProfitPrice: null,
      stopLossPrice: null
    };
  }));

  return normalizedSymbol ? items.filter((row) => row.symbol === normalizedSymbol) : items;
}

export {
  MANUAL_TRADING_SPOT_ENABLED,
  MEXC_PERP_ENABLED,
  MEXC_SPOT_ENABLED,
  marketTimeframeToBitgetSpotGranularity,
  normalizeSpotSymbol,
  splitCanonicalSymbol
};
