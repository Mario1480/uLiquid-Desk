"use client";

import Link from "next/link";
import { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut, getApiBaseUrl } from "../../lib/api";
import {
  buildTradeDeskPrefillPayload,
  parseTradeDeskPrefill,
  TRADE_DESK_PREFILL_SESSION_KEY,
  type PredictionPrefillSource,
  type TradeDeskPrefillPayload
} from "../../src/schemas/tradeDeskPrefill";
import {
  createLiveTableReadiness,
  isLiveTableFailureBlocking
} from "../../src/trade/liveDataReadiness";
import { estimateLiquidationPrices } from "../../src/trade/liquidationEstimate";
import {
  buildPositionCopilotAgentChatPrefill,
  POSITION_COPILOT_AGENT_CHAT_PREFILL_KEY,
  POSITION_COPILOT_MANUAL_REVIEW_HREF
} from "../../src/trade/positionCopilot";
import { useReconnectingWebSocket } from "../../src/trade/useReconnectingWebSocket";
import {
  DEFAULT_CHART_PREFERENCES,
  type ChartEngine,
  type SelectedTradePosition,
  type TradingChartPreferences
} from "./chartTypes";
import { TradeChart } from "./TradeChart";
import SymbolSearchSelect, { type SymbolSearchOption } from "../../components/SymbolSearchSelect";
import { AppIcon } from "../components/AppIcon";
import { Notice, PageHeader } from "../components/ui";

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  signingAddress?: string | null;
  readAddress?: string | null;
  readAddressSource?: "wallet" | "account_or_vault" | null;
  lastUsedAt: string | null;
  marketDataExchange?: string | null;
  supportsSpotManual?: boolean;
  supportsPerpManual?: boolean;
  systemManaged?: boolean;
};

type TradingSettings = {
  exchangeAccountId: string | null;
  symbol: string | null;
  timeframe: string | null;
  marketType: "spot" | "perp";
  marginMode: MarginModeValue | null;
  leverage: number | null;
  quoteCurrency: string | null;
  timezone: string | null;
  chartEngine: ChartEngine;
  chartPreferences: TradingChartPreferences;
};

type SymbolItem = {
  symbol: string;
  exchangeSymbol: string;
  status: string;
  tradable: boolean;
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  baseAsset?: string | null;
  quoteAsset?: string | null;
};

type AccountSummary = {
  exchangeAccountId: string;
  exchange: string;
  marketType?: "spot" | "perp";
  equity: number | null;
  availableMargin: number | null;
  spotQuoteAsset?: string | null;
  spotQuoteAvailable?: number | null;
  spotBaseAsset?: string | null;
  spotBaseAvailable?: number | null;
  spotBaseTotal?: number | null;
  positionsCount: number;
  updatedAt: string;
  degraded?: boolean;
  hyperliquidSigningAddress?: string | null;
  hyperliquidReadAddress?: string | null;
  hyperliquidReadAddressSource?: "wallet" | "account_or_vault" | null;
};

type PositionItem = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  leverage: number | null;
  marginMode: "isolated" | "cross" | null;
  marginUsd: number | null;
  notionalUsd: number | null;
  liquidationPrice: number | null;
  liquidationDistancePct: number | null;
  roePct: number | null;
  pnlPct: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

type PositionCopilotMode = "critical_only" | "important_changes" | "periodic_summary" | "off";

type PositionCopilotSettings = {
  version: 1;
  mode: PositionCopilotMode;
  inAppEnabled: boolean;
  telegramEnabled: boolean;
  cooldownMinutes: number;
  periodicMinutes: number;
};

type PositionCopilotFinding = {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
};

type PositionCopilotAnalysis = {
  snapshotHash: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  thesisStatus: "intact" | "weakened" | "invalidated" | "unknown";
  summary: string;
  riskFactors: PositionCopilotFinding[];
  events: PositionCopilotFinding[];
  dataQuality: {
    state: "complete" | "degraded";
    missingFields: string[];
    observedAt: string;
  };
  openedByPredictionCopier: boolean;
  readOnly: true;
  generatedAt: string;
};

type PositionCopilotResponse = {
  skipped: boolean;
  reason?: string;
  analysis?: PositionCopilotAnalysis;
  settings: PositionCopilotSettings;
  metadata?: {
    cacheHit: boolean;
    fallbackUsed: boolean;
    rateLimited: boolean;
    fallbackReason: string | null;
    notification: { sent: boolean; reason: string };
  };
};

type OpenOrderItem = {
  orderId: string;
  symbol: string;
  side: string | null;
  type: string | null;
  status: string | null;
  price: number | null;
  qty: number | null;
  triggerPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean | null;
  createdAt: string | null;
};

type TradingLiveStateResponse = {
  summary: AccountSummary & {
    degraded?: boolean;
    error?: string | null;
  };
  positions: {
    items: PositionItem[];
    degraded?: boolean;
    error?: string | null;
  };
  openOrders: {
    items: OpenOrderItem[];
    degraded?: boolean;
    error?: string | null;
  };
  degraded?: boolean;
};

type TickerState = {
  symbol: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  ts: number | null;
};

type WsEnvelope = {
  type: string;
  symbol?: string;
  data?: any;
  message?: string;
};

type PredictionDetailResponse = PredictionPrefillSource & {
  accountId: string | null;
};

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

type OrderTypeValue = "market" | "limit";

type TradeDirection = "long" | "short" | "buy" | "sell";
type MarginModeValue = "cross" | "isolated";
type EntryModeValue = "open" | "close";
type QtyInputModeValue = "quantity" | "cost" | "value";
type MarketTypeValue = "spot" | "perp";

type QtyInputModeOption = {
  value: QtyInputModeValue;
  titleKey: "quantity" | "cost" | "value";
  descriptionKey: "quantityDesc" | "costDesc" | "valueDesc";
  unit: string;
};

const QTY_INPUT_MODE_OPTIONS: QtyInputModeOption[] = [
  {
    value: "quantity",
    titleKey: "quantity",
    descriptionKey: "quantityDesc",
    unit: "BASE"
  },
  {
    value: "cost",
    titleKey: "cost",
    descriptionKey: "costDesc",
    unit: "USDT"
  },
  {
    value: "value",
    titleKey: "value",
    descriptionKey: "valueDesc",
    unit: "USDT"
  }
];

const TICKER_RENDER_THROTTLE_MS = 750;

function toWsBase(url: string): string {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}

function errMsg(e: unknown, apiBase = getApiBaseUrl()): string {
  if (e instanceof TypeError) {
    const msg = String(e.message ?? "");
    if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
      return `API connection failed (${apiBase}). Check if apps/api is running on port 4000.`;
    }
  }
  if (e instanceof ApiError) {
    const text = String(e.message ?? "");
    const code = String(e.payload?.code ?? "");
    if (code === "EX_RATE_LIMIT") {
      const retryAfterAt =
        typeof e.payload?.retryAfterAt === "string" && e.payload.retryAfterAt.trim()
          ? e.payload.retryAfterAt.trim()
          : null;
      const retryAt = retryAfterAt ? new Date(retryAfterAt) : null;
      const suffix = retryAt && Number.isFinite(retryAt.getTime())
        ? ` Retry ab ${retryAt.toLocaleTimeString()}.`
        : "";
      return `Exchange-Rate-Limit aktiv.${suffix}`;
    }
    if (text.toLowerCase().includes("mexc capability") && text.toLowerCase().includes("disabled")) {
      return "MEXC ist aktuell im Read-only Stage-Modus (Order-Writes deaktiviert).";
    }
    if (text.includes("mexc_perp_disabled") || code === "mexc_perp_disabled") {
      return "MEXC Perp ist aktuell deaktiviert.";
    }
    if (text.includes("mexc_spot_disabled") || code === "mexc_spot_disabled") {
      return "MEXC Spot ist aktuell deaktiviert.";
    }
    if (text.includes("hyperliquid_agent_account_address_required") || code === "hyperliquid_agent_account_address_required") {
      return "Hyperliquid snapshot failed: this account looks like an agent wallet. Add the master account or vault address in the passphrase field of the exchange account.";
    }
    if (text.includes("spot_mode_not_supported_for_exchange")) {
      return "Spot mode ist für dieses Konto nicht verfügbar.";
    }
    if (
      text.includes("paper_spot_requires_supported_market_data") ||
      text.includes("paper_spot_requires_bitget_market_data")
    ) {
      return "Paper Spot benötigt ein verknüpftes Bitget- oder Binance-Market-Data-Konto.";
    }
    if (text.includes("paper_perp_requires_supported_market_data")) {
      return "Paper Perp benötigt ein verknüpftes Market-Data-Konto (Bitget/Hyperliquid/MEXC/Binance).";
    }
    if (text.includes("manual_spot_trading_disabled")) {
      return "Spot mode ist aktuell deaktiviert.";
    }
    if (code === "market_data_degraded" || text.includes("market_data_degraded")) {
      return "Market data is degraded; trading is temporarily blocked until the next successful refresh.";
    }
    if (text.includes("leverage_not_supported_for_spot")) {
      return "Leverage ist im Spot-Modus nicht verfügbar.";
    }
    if (text.includes("tpsl_not_supported_for_spot_v1")) {
      return "TP/SL ist im Spot-Modus (v1) noch nicht verfügbar.";
    }
    if (code === "quantity_below_min" || text.includes("quantity_below_min")) {
      return "Menge ist unter dem Minimum für dieses Spot-Symbol.";
    }
    if (code === "quantity_below_min_quote" || text.includes("quantity_below_min_quote")) {
      return "Market-Buy benötigt mindestens 1 USDT Notional.";
    }
    if (code === "quantity_above_max" || text.includes("quantity_above_max")) {
      return "Menge ist über dem Maximum für dieses Spot-Symbol.";
    }
    return `${e.message} (HTTP ${e.status})`;
  }
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function retryAfterMsFromError(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 429 && String(error.payload?.code ?? "") !== "EX_RATE_LIMIT") return null;

  const retryAfterMs = Number(error.payload?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs;
  }

  const retryAfterAt = typeof error.payload?.retryAfterAt === "string"
    ? Date.parse(error.payload.retryAfterAt)
    : NaN;
  if (Number.isFinite(retryAfterAt)) {
    return Math.max(0, retryAfterAt - Date.now());
  }

  return 60_000;
}

function maxRetryAfterMs(errors: unknown[]): number | null {
  let maxMs: number | null = null;
  for (const error of errors) {
    const retryAfterMs = retryAfterMsFromError(error);
    if (retryAfterMs === null) continue;
    maxMs = Math.max(maxMs ?? 0, retryAfterMs);
  }
  return maxMs;
}

function isBingxAccount(account: ExchangeAccountItem | null): boolean {
  const exchange = String(account?.marketDataExchange ?? account?.exchange ?? "").trim().toLowerCase();
  return exchange === "bingx";
}

function shortAddress(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw || "-";
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function createClientIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

function isExecutionAccountEligible(account: ExchangeAccountItem): boolean {
  if (typeof account.supportsSpotManual === "boolean" || typeof account.supportsPerpManual === "boolean") {
    return Boolean(account.supportsSpotManual || account.supportsPerpManual);
  }
  return true;
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function fmtLeverage(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "-";
  return `${Number(value.toFixed(2)).toLocaleString()}x`;
}

function fmtConfidence(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, normalized));
  return `${clamped.toFixed(1)}%`;
}

function fmtIndicator(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Number(value).toFixed(digits);
}

function numericEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tolerance = Math.max(1e-8, Math.abs(a) * 1e-8, Math.abs(b) * 1e-8);
  return Math.abs(a - b) <= tolerance;
}

function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveOrNull(value: unknown): number | null {
  const parsed = toFiniteOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseOptionalPositivePrice(value: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && parsed === 0) return { ok: true, value: null };
  if (Number.isFinite(parsed) && parsed > 0) return { ok: true, value: parsed };
  return { ok: false };
}

function normalizePositionMarginMode(value: unknown): "isolated" | "cross" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("isolated") || normalized === "1") return "isolated";
  if (normalized.includes("cross") || normalized === "2") return "cross";
  return null;
}

function normalizeDeskSymbol(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toUpperCase();
  const withoutSettlement = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
  return withoutSettlement.replace(/[^A-Z0-9]/g, "");
}

function resolveDeskSymbol(value: string | null | undefined, rows: SymbolItem[], fallback: string): string {
  const normalized = normalizeDeskSymbol(value);
  if (!normalized) return fallback;
  const matchingSymbol = rows.find((row) => normalizeDeskSymbol(row.symbol) === normalized);
  return matchingSymbol?.symbol ?? String(value ?? fallback).trim().toUpperCase();
}

function getPositionRowKey(position: PositionItem, index: number): string {
  return `${position.symbol}:${position.side}:${index}`;
}

function filterRowsForDeskSymbol<T extends { symbol?: string | null }>(
  rows: T[],
  symbol: string
): T[] {
  const target = normalizeDeskSymbol(symbol);
  if (!target) return rows;
  return rows.filter((row) => normalizeDeskSymbol(row.symbol) === target);
}

function normalizeDeskPositions(rows: unknown[]): PositionItem[] {
  return rows
    .map((raw) => {
      const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const side: PositionItem["side"] = row.side === "short" ? "short" : "long";
      const size = toFiniteOrNull(row.size) ?? 0;
      const entryPrice = toFiniteOrNull(row.entryPrice);
      const markPrice = toFiniteOrNull(row.markPrice);
      const unrealizedPnl = toFiniteOrNull(row.unrealizedPnl);
      const leverage = toPositiveOrNull(row.leverage);
      const notionalUsd = toPositiveOrNull(row.notionalUsd) ?? (
        size > 0 && (markPrice ?? entryPrice) !== null ? size * ((markPrice ?? entryPrice) as number) : null
      );
      const marginUsd = toPositiveOrNull(row.marginUsd) ?? (
        notionalUsd !== null && leverage !== null ? notionalUsd / leverage : null
      );
      const liquidationPrice = toPositiveOrNull(row.liquidationPrice);
      const liquidationDistancePct = toFiniteOrNull(row.liquidationDistancePct) ?? (
        liquidationPrice !== null && markPrice !== null && markPrice > 0
          ? side === "short"
            ? ((liquidationPrice - markPrice) / markPrice) * 100
            : ((markPrice - liquidationPrice) / markPrice) * 100
          : null
      );
      const pnlPct = toFiniteOrNull(row.pnlPct) ?? (
        unrealizedPnl !== null && notionalUsd !== null && notionalUsd > 0 ? (unrealizedPnl / notionalUsd) * 100 : null
      );
      const roePct = toFiniteOrNull(row.roePct) ?? (
        unrealizedPnl !== null && marginUsd !== null && marginUsd > 0 ? (unrealizedPnl / marginUsd) * 100 : null
      );
      return {
        symbol: String(row.symbol ?? ""),
        side,
        size,
        entryPrice,
        markPrice,
        unrealizedPnl,
        leverage,
        marginMode: normalizePositionMarginMode(row.marginMode),
        marginUsd,
        notionalUsd,
        liquidationPrice,
        liquidationDistancePct,
        roePct,
        pnlPct,
        takeProfitPrice: toPositiveOrNull(row.takeProfitPrice),
        stopLossPrice: toPositiveOrNull(row.stopLossPrice)
      };
    })
    .filter((row) => row.symbol.length > 0 && Number.isFinite(row.size) && row.size > 0);
}

function normalizeDeskOpenOrders(rows: OpenOrderItem[], symbol: string): OpenOrderItem[] {
  return filterRowsForDeskSymbol(
    rows.map((row) => ({
      ...row,
      takeProfitPrice: toPositiveOrNull(row.takeProfitPrice),
      stopLossPrice: toPositiveOrNull(row.stopLossPrice)
    })),
    symbol
  );
}

function sameNullableNumber(left: number | null | undefined, right: number | null | undefined): boolean {
  return Object.is(left ?? null, right ?? null);
}

function sameNullableString(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function accountSummariesEqual(left: AccountSummary | null, right: AccountSummary | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.exchangeAccountId === right.exchangeAccountId
    && left.exchange === right.exchange
    && (left.marketType ?? null) === (right.marketType ?? null)
    && sameNullableNumber(left.equity, right.equity)
    && sameNullableNumber(left.availableMargin, right.availableMargin)
    && sameNullableString(left.spotQuoteAsset, right.spotQuoteAsset)
    && sameNullableNumber(left.spotQuoteAvailable, right.spotQuoteAvailable)
    && sameNullableString(left.spotBaseAsset, right.spotBaseAsset)
    && sameNullableNumber(left.spotBaseAvailable, right.spotBaseAvailable)
    && sameNullableNumber(left.spotBaseTotal, right.spotBaseTotal)
    && left.positionsCount === right.positionsCount
    && Boolean(left.degraded) === Boolean(right.degraded)
    && sameNullableString(left.hyperliquidSigningAddress, right.hyperliquidSigningAddress)
    && sameNullableString(left.hyperliquidReadAddress, right.hyperliquidReadAddress)
    && sameNullableString(left.hyperliquidReadAddressSource, right.hyperliquidReadAddressSource);
}

function positionsEqual(left: PositionItem[], right: PositionItem[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.symbol === other.symbol
      && item.side === other.side
      && sameNullableNumber(item.size, other.size)
      && sameNullableNumber(item.entryPrice, other.entryPrice)
      && sameNullableNumber(item.markPrice, other.markPrice)
      && sameNullableNumber(item.unrealizedPnl, other.unrealizedPnl)
      && sameNullableNumber(item.leverage, other.leverage)
      && item.marginMode === other.marginMode
      && sameNullableNumber(item.marginUsd, other.marginUsd)
      && sameNullableNumber(item.notionalUsd, other.notionalUsd)
      && sameNullableNumber(item.liquidationPrice, other.liquidationPrice)
      && sameNullableNumber(item.liquidationDistancePct, other.liquidationDistancePct)
      && sameNullableNumber(item.roePct, other.roePct)
      && sameNullableNumber(item.pnlPct, other.pnlPct)
      && sameNullableNumber(item.takeProfitPrice, other.takeProfitPrice)
      && sameNullableNumber(item.stopLossPrice, other.stopLossPrice);
  });
}

function openOrdersEqual(left: OpenOrderItem[], right: OpenOrderItem[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.orderId === other.orderId
      && item.symbol === other.symbol
      && sameNullableString(item.side, other.side)
      && sameNullableString(item.type, other.type)
      && sameNullableString(item.status, other.status)
      && sameNullableNumber(item.price, other.price)
      && sameNullableNumber(item.qty, other.qty)
      && sameNullableNumber(item.triggerPrice, other.triggerPrice)
      && sameNullableNumber(item.takeProfitPrice, other.takeProfitPrice)
      && sameNullableNumber(item.stopLossPrice, other.stopLossPrice)
      && (item.reduceOnly ?? null) === (other.reduceOnly ?? null)
      && sameNullableString(item.createdAt, other.createdAt);
  });
}

function tickersEqual(left: TickerState | null, right: TickerState | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.symbol === right.symbol
    && sameNullableNumber(left.last, right.last)
    && sameNullableNumber(left.mark, right.mark)
    && sameNullableNumber(left.bid, right.bid)
    && sameNullableNumber(left.ask, right.ask)
    && sameNullableNumber(left.ts, right.ts);
}

function mergeAccountSummary(
  prev: AccountSummary | null,
  next: AccountSummary,
  options?: {
    preserveNullNumbers?: boolean;
    preserveSpotBalances?: boolean;
  }
): AccountSummary {
  if (!prev) return next;

  const sameAccount =
    prev.exchangeAccountId === next.exchangeAccountId &&
    (prev.marketType ?? null) === (next.marketType ?? null);
  if (!sameAccount) return next;

  const preserveNullNumbers = options?.preserveNullNumbers === true;
  const preserveSpotBalances = options?.preserveSpotBalances === true;
  const preserveNumber = (incoming: number | null | undefined, fallback: number | null | undefined) =>
    incoming !== null && incoming !== undefined && Number.isFinite(incoming)
      ? incoming
      : preserveNullNumbers
        ? (fallback ?? null)
        : (incoming ?? null);

  const nextQuoteAsset = next.spotQuoteAsset ?? prev.spotQuoteAsset ?? null;
  const nextBaseAsset = next.spotBaseAsset ?? prev.spotBaseAsset ?? null;
  const quoteAssetMatches =
    !preserveSpotBalances ||
    !nextQuoteAsset ||
    !prev.spotQuoteAsset ||
    nextQuoteAsset === prev.spotQuoteAsset;
  const baseAssetMatches =
    !preserveSpotBalances ||
    !nextBaseAsset ||
    !prev.spotBaseAsset ||
    nextBaseAsset === prev.spotBaseAsset;

  return {
    ...next,
    equity: preserveNumber(next.equity, prev.equity),
    availableMargin: preserveNumber(next.availableMargin, prev.availableMargin),
    spotQuoteAsset: nextQuoteAsset,
    spotQuoteAvailable:
      quoteAssetMatches
        ? preserveNumber(next.spotQuoteAvailable, prev.spotQuoteAvailable)
        : (next.spotQuoteAvailable ?? null),
    spotBaseAsset: nextBaseAsset,
    spotBaseAvailable:
      baseAssetMatches
        ? preserveNumber(next.spotBaseAvailable, prev.spotBaseAvailable)
        : (next.spotBaseAvailable ?? null),
    spotBaseTotal:
      baseAssetMatches
        ? preserveNumber(next.spotBaseTotal, prev.spotBaseTotal)
        : (next.spotBaseTotal ?? null)
  };
}

function decodeBase64UrlJson(value: string): unknown | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function TradePageContent() {
  const t = useTranslations("system.trade");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBase = getApiBaseUrl();
  const wsBase = useMemo(() => toWsBase(apiBase), [apiBase]);

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<string>("15m");
  const [marketType, setMarketType] = useState<MarketTypeValue>("perp");
  const [chartPreferences, setChartPreferences] = useState<TradingChartPreferences>(
    DEFAULT_CHART_PREFERENCES
  );
  const [chartEngine, setChartEngine] = useState<ChartEngine>("advanced");
  const [selectedPositionKey, setSelectedPositionKey] = useState<string | null>(null);
  const [positionEditDrafts, setPositionEditDrafts] = useState<Record<string, { tp: string; sl: string }>>({});
  const [orderEditDrafts, setOrderEditDrafts] = useState<Record<string, { price: string; qty: string; tp: string; sl: string }>>({});
  const [positionSavingKey, setPositionSavingKey] = useState<string | null>(null);
  const [orderSavingId, setOrderSavingId] = useState<string | null>(null);

  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [positionsDataDegraded, setPositionsDataDegraded] = useState(false);
  const [openOrders, setOpenOrders] = useState<OpenOrderItem[]>([]);
  const [copilotSettings, setCopilotSettings] = useState<PositionCopilotSettings | null>(null);
  const [copilotAnalysis, setCopilotAnalysis] = useState<PositionCopilotAnalysis | null>(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotSettingsSaving, setCopilotSettingsSaving] = useState(false);

  const [ticker, setTicker] = useState<TickerState | null>(null);

  const [orderType, setOrderType] = useState<OrderTypeValue>("limit");
  const [marginMode, setMarginMode] = useState<MarginModeValue>("isolated");
  const [entryMode, setEntryMode] = useState<EntryModeValue>("open");
  const [spotOrderSide, setSpotOrderSide] = useState<"buy" | "sell">("buy");
  const [leverage, setLeverage] = useState("10");
  const [qty, setQty] = useState("0.001");
  const [qtyPercent, setQtyPercent] = useState(0);
  const [qtyInputMode, setQtyInputMode] = useState<QtyInputModeValue>("quantity");
  const [qtyInputModeDraft, setQtyInputModeDraft] = useState<QtyInputModeValue>("quantity");
  const [isQtyModeModalOpen, setIsQtyModeModalOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [tpSlEnabled, setTpSlEnabled] = useState(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketStreamError, setMarketStreamError] = useState<string | null>(null);
  const [userStreamError, setUserStreamError] = useState<string | null>(null);
  const [softWarning, setSoftWarning] = useState<string | null>(null);
  const [dataBlockReason, setDataBlockReason] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApplyingLeverage, setIsApplyingLeverage] = useState(false);
  const [closePendingKey, setClosePendingKey] = useState<string | null>(null);
  const [isCancelAllPending, setIsCancelAllPending] = useState(false);
  const [activePrefill, setActivePrefill] = useState<TradeDeskPrefillPayload | null>(null);
  const [prefillInfo, setPrefillInfo] = useState<string | null>(null);
  const [prefillContextExpanded, setPrefillContextExpanded] = useState(true);

  const refreshTimerRef = useRef<number | null>(null);
  const tickerUpdateTimerRef = useRef<number | null>(null);
  const pendingTickerRef = useRef<TickerState | null>(null);
  const lastTickerCommitAtRef = useRef(0);
  const liveRefreshInFlightRef = useRef<Promise<{ partialFailures: string[] }> | null>(null);
  const liveRefreshBackoffUntilRef = useRef(0);
  const liveTableReadyRef = useRef(createLiveTableReadiness());
  const lastCopilotEventKeyRef = useRef<string | null>(null);
  const copilotRequestSequenceRef = useRef(0);

  const selectedAccount = useMemo(
    () => accounts.find((row) => row.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const selectedAccountIsBingx = isBingxAccount(selectedAccount);
  const spotModeSupportedForAccount = useMemo(() => {
    if (!selectedAccount) return false;
    if (typeof selectedAccount.supportsSpotManual === "boolean") {
      return selectedAccount.supportsSpotManual;
    }
    const exchange = String(selectedAccount.exchange ?? "").toLowerCase();
    if (exchange === "bitget") return true;
    if (exchange === "hyperliquid") return true;
    if (exchange === "mexc") return true;
    if (exchange === "binance") return true;
    if (exchange === "paper" && String(selectedAccount.marketDataExchange ?? "").toLowerCase() === "bitget") {
      return true;
    }
    if (exchange === "paper" && String(selectedAccount.marketDataExchange ?? "").toLowerCase() === "binance") {
      return true;
    }
    return false;
  }, [selectedAccount]);
  const perpModeSupportedForAccount = useMemo(() => {
    if (!selectedAccount) return false;
    if (typeof selectedAccount.supportsPerpManual === "boolean") {
      return selectedAccount.supportsPerpManual;
    }
    const exchange = String(selectedAccount.exchange ?? "").toLowerCase();
    return exchange !== "mexc";
  }, [selectedAccount]);
  const isSpotMode = marketType === "spot";
  const isSpotSell = isSpotMode && spotOrderSide === "sell";

  const selectedSymbolMeta = useMemo(
    () => symbols.find((row) => row.symbol === selectedSymbol) ?? null,
    [symbols, selectedSymbol]
  );
  const symbolOptions = useMemo<SymbolSearchOption[]>(() => {
    const options = symbols.map((row) => {
      const metaParts = [
        row.baseAsset && row.quoteAsset ? `${row.baseAsset}/${row.quoteAsset}` : null,
        row.status && row.status.toLowerCase() !== "online" ? row.status : null
      ].filter(Boolean);
      return {
        symbol: row.symbol,
        label: row.symbol,
        tradable: row.tradable,
        meta: metaParts.length > 0 ? metaParts.join(" · ") : null
      };
    });
    const normalizedSelected = selectedSymbol.trim().toUpperCase();
    if (normalizedSelected && !options.some((row) => row.symbol === normalizedSelected)) {
      return [{ symbol: normalizedSelected, label: normalizedSelected, meta: null }, ...options];
    }
    return options;
  }, [selectedSymbol, symbols]);
  const selectedPosition = useMemo<SelectedTradePosition | null>(() => {
    if (!selectedPositionKey) return null;
    const row = positions.find((item, index) => getPositionRowKey(item, index) === selectedPositionKey);
    if (!row) return null;
    if (normalizeDeskSymbol(row.symbol) !== normalizeDeskSymbol(selectedSymbol)) return null;
    return {
      symbol: row.symbol,
      side: row.side,
      entryPrice: row.entryPrice,
      markPrice: row.markPrice,
      takeProfitPrice: row.takeProfitPrice,
      stopLossPrice: row.stopLossPrice
    };
  }, [positions, selectedPositionKey, selectedSymbol]);
  const copilotPosition = useMemo<PositionItem | null>(() => {
    const selected = selectedPositionKey
      ? positions.find((item, index) => getPositionRowKey(item, index) === selectedPositionKey)
      : null;
    return selected
      ?? positions.find((item) => normalizeDeskSymbol(item.symbol) === normalizeDeskSymbol(selectedSymbol))
      ?? positions[0]
      ?? null;
  }, [positions, selectedPositionKey, selectedSymbol]);
  const copilotSnapshotKey = useMemo(() => copilotPosition && selectedAccountId
    ? JSON.stringify({
        exchangeAccountId: selectedAccountId,
        marketType,
        symbol: normalizeDeskSymbol(copilotPosition.symbol),
        side: copilotPosition.side,
        size: copilotPosition.size,
        entryPrice: copilotPosition.entryPrice,
        leverage: copilotPosition.leverage,
        liquidationRiskBucket: copilotPosition.liquidationDistancePct === null
          ? null
          : Math.floor(copilotPosition.liquidationDistancePct / 2),
        pnlRiskBucket: copilotPosition.pnlPct === null ? null : Math.floor(copilotPosition.pnlPct),
        stopLossPrice: copilotPosition.stopLossPrice,
        takeProfitPrice: copilotPosition.takeProfitPrice,
        dataDegraded: positionsDataDegraded
      })
    : null, [copilotPosition, marketType, positionsDataDegraded, selectedAccountId]);
  const numericLeverage = useMemo(() => {
    const value = Number(leverage);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [leverage]);
  const effectiveLeverage = isSpotMode ? 1 : numericLeverage;

  const analyzeWithPositionCopilot = useCallback(async (
    trigger: "manual" | "event" | "periodic",
    options?: { silent?: boolean }
  ) => {
    if (!copilotPosition || !selectedAccountId) return;
    const requestSequence = ++copilotRequestSequenceRef.current;
    if (!options?.silent) setCopilotLoading(true);
    setCopilotError(null);
    try {
      const observedAt = summary?.updatedAt && Number.isFinite(Date.parse(summary.updatedAt))
        ? new Date(summary.updatedAt).toISOString()
        : new Date().toISOString();
      const response = await apiPost<PositionCopilotResponse>("/api/position-copilot/analyze", {
        trigger,
        language: locale.toLowerCase().startsWith("de") ? "de" : "en",
        snapshot: {
          exchangeAccountId: selectedAccountId,
          marketType,
          symbol: copilotPosition.symbol,
          side: copilotPosition.side,
          size: copilotPosition.size,
          entryPrice: copilotPosition.entryPrice,
          markPrice: copilotPosition.markPrice,
          unrealizedPnlUsd: copilotPosition.unrealizedPnl,
          leverage: copilotPosition.leverage,
          marginMode: copilotPosition.marginMode,
          marginUsd: copilotPosition.marginUsd,
          notionalUsd: copilotPosition.notionalUsd,
          liquidationPrice: copilotPosition.liquidationPrice,
          liquidationDistancePct: copilotPosition.liquidationDistancePct,
          roePct: copilotPosition.roePct,
          pnlPct: copilotPosition.pnlPct,
          stopLossPrice: copilotPosition.stopLossPrice,
          takeProfitPrice: copilotPosition.takeProfitPrice,
          dataDegraded: positionsDataDegraded || Boolean(summary?.degraded),
          observedAt
        }
      });
      if (requestSequence === copilotRequestSequenceRef.current) {
        if (response.analysis) setCopilotAnalysis(response.analysis);
        if (response.settings) setCopilotSettings(response.settings);
      }
    } catch (error) {
      if (!options?.silent) setCopilotError(errMsg(error));
    } finally {
      if (!options?.silent) setCopilotLoading(false);
    }
  }, [copilotPosition, locale, marketType, positionsDataDegraded, selectedAccountId, summary?.degraded, summary?.updatedAt]);

  useEffect(() => {
    copilotRequestSequenceRef.current += 1;
    setCopilotAnalysis(null);
  }, [marketType, selectedAccountId, copilotPosition?.side, copilotPosition?.symbol]);

  const updateCopilotSettings = useCallback(async (patch: Partial<PositionCopilotSettings>) => {
    if (!copilotSettings) return;
    const next = { ...copilotSettings, ...patch };
    setCopilotSettings(next);
    setCopilotSettingsSaving(true);
    setCopilotError(null);
    try {
      const saved = await apiPut<PositionCopilotSettings>("/api/position-copilot/settings", {
        mode: next.mode,
        inAppEnabled: next.inAppEnabled,
        telegramEnabled: next.telegramEnabled,
        cooldownMinutes: next.cooldownMinutes,
        periodicMinutes: next.periodicMinutes
      });
      setCopilotSettings(saved);
    } catch (error) {
      setCopilotSettings(copilotSettings);
      setCopilotError(errMsg(error));
    } finally {
      setCopilotSettingsSaving(false);
    }
  }, [copilotSettings]);

  useEffect(() => {
    let disposed = false;
    apiGet<PositionCopilotSettings>("/api/position-copilot/settings")
      .then((settings) => {
        if (!disposed) setCopilotSettings(settings);
      })
      .catch((error) => {
        if (!disposed) setCopilotError(errMsg(error));
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!copilotSnapshotKey || !copilotSettings || copilotSettings.mode === "off") return;
    if (!copilotSettings.inAppEnabled && !copilotSettings.telegramEnabled) return;
    if (lastCopilotEventKeyRef.current === copilotSnapshotKey) return;
    lastCopilotEventKeyRef.current = copilotSnapshotKey;
    const timer = window.setTimeout(() => {
      void analyzeWithPositionCopilot("event", { silent: true });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [analyzeWithPositionCopilot, copilotSettings, copilotSnapshotKey]);

  useEffect(() => {
    if (!copilotSettings || copilotSettings.mode !== "periodic_summary" || !copilotPosition) return;
    const timer = window.setInterval(() => {
      void analyzeWithPositionCopilot("periodic", { silent: true });
    }, copilotSettings.periodicMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [analyzeWithPositionCopilot, copilotPosition, copilotSettings]);

  const refPrice = useMemo(() => {
    const value = ticker?.mark ?? ticker?.last ?? null;
    return value !== null && Number.isFinite(value) && value > 0 ? value : null;
  }, [ticker]);

  const baseAssetUnit = useMemo(() => {
    const baseAsset = selectedSymbolMeta?.baseAsset;
    if (baseAsset && baseAsset.trim()) return baseAsset.trim().toUpperCase();
    if (selectedSymbol.endsWith("USDT") || selectedSymbol.endsWith("USDC")) {
      return selectedSymbol.slice(0, -4) || selectedSymbol;
    }
    return selectedSymbol;
  }, [selectedSymbol, selectedSymbolMeta]);

  const quoteAssetUnit = useMemo(() => {
    const quoteAsset = selectedSymbolMeta?.quoteAsset;
    if (quoteAsset && quoteAsset.trim()) return quoteAsset.trim().toUpperCase();
    if (selectedSymbol.endsWith("USDC")) return "USDC";
    if (selectedSymbol.endsWith("USDT")) return "USDT";
    return "USD";
  }, [selectedSymbol, selectedSymbolMeta]);

  const spotQuoteAvailable = useMemo(() => {
    if (!summary) return null;
    const value = summary.spotQuoteAvailable ?? summary.availableMargin;
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  }, [summary]);

  const tradingDataBlocked = Boolean(dataBlockReason);

  const spotBaseAvailable = useMemo(() => {
    if (!summary) return null;
    const value = summary.spotBaseAvailable;
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  }, [summary]);

  const effectiveAvailableAmount = useMemo(() => {
    if (isSpotMode) {
      return isSpotSell ? spotBaseAvailable : spotQuoteAvailable;
    }
    const value = summary?.availableMargin;
    return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  }, [isSpotMode, isSpotSell, spotBaseAvailable, spotQuoteAvailable, summary]);

  const availableDisplayUnit = isSpotSell ? baseAssetUnit : quoteAssetUnit;

  const estimatedMaxQty = useMemo(() => {
    const available = effectiveAvailableAmount;
    if (available === null || !Number.isFinite(available) || available <= 0) return null;

    let raw: number;
    if (isSpotSell) {
      raw = available;
    } else {
      if (!effectiveLeverage || !refPrice) return null;
      raw = (available * effectiveLeverage) / refPrice;
    }
    if (!Number.isFinite(raw) || raw <= 0) return null;

    const step = selectedSymbolMeta?.stepSize ?? null;
    if (step !== null && Number.isFinite(step) && step > 0) {
      return Math.floor(raw / step) * step;
    }
    return raw;
  }, [effectiveAvailableAmount, effectiveLeverage, isSpotSell, refPrice, selectedSymbolMeta]);

  const qtyInputModeOption = useMemo(
    () => QTY_INPUT_MODE_OPTIONS.find((item) => item.value === qtyInputMode) ?? QTY_INPUT_MODE_OPTIONS[0],
    [qtyInputMode]
  );

  const qtyDisplayUnit = qtyInputMode === "quantity" ? baseAssetUnit : quoteAssetUnit;

  const qtyInputValue = useMemo(() => {
    const parsed = Number(qty);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [qty]);

  const orderReferencePrice = useMemo(() => {
    if (orderType === "limit") {
      const parsed = Number(price);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return refPrice;
  }, [orderType, price, refPrice]);

  const orderQtyValue = useMemo(() => {
    if (qtyInputValue === null) return null;

    if (qtyInputMode === "quantity") {
      return qtyInputValue;
    }

    if (!orderReferencePrice || !Number.isFinite(orderReferencePrice) || orderReferencePrice <= 0) {
      return null;
    }

    if (qtyInputMode === "cost") {
      if (!effectiveLeverage || !Number.isFinite(effectiveLeverage) || effectiveLeverage <= 0) return null;
      return (qtyInputValue * effectiveLeverage) / orderReferencePrice;
    }

    return qtyInputValue / orderReferencePrice;
  }, [effectiveLeverage, orderReferencePrice, qtyInputMode, qtyInputValue]);

  const estimatedCost = useMemo(() => {
    if (qtyInputValue === null) return null;
    if (qtyInputMode === "cost") return qtyInputValue;
    if (qtyInputMode === "value") {
      if (!effectiveLeverage || !Number.isFinite(effectiveLeverage) || effectiveLeverage <= 0) return null;
      return qtyInputValue / effectiveLeverage;
    }

    if (!orderQtyValue || !orderReferencePrice) return null;
    const notional = orderQtyValue * orderReferencePrice;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    if (!effectiveLeverage || !Number.isFinite(effectiveLeverage) || effectiveLeverage <= 0) return notional;
    return notional / effectiveLeverage;
  }, [effectiveLeverage, orderQtyValue, orderReferencePrice, qtyInputMode, qtyInputValue]);

  const estimatedMaxInputByMode = useMemo(() => {
    const available = effectiveAvailableAmount;
    if (available === null || !Number.isFinite(available) || available <= 0) return null;

    if (qtyInputMode === "quantity") return estimatedMaxQty;
    if (qtyInputMode === "cost") {
      if (isSpotSell) {
        if (!refPrice || !Number.isFinite(refPrice) || refPrice <= 0) return null;
        return available * refPrice;
      }
      return available;
    }

    if (isSpotSell) {
      if (!refPrice || !Number.isFinite(refPrice) || refPrice <= 0) return null;
      return available * refPrice;
    }
    if (!effectiveLeverage || !Number.isFinite(effectiveLeverage) || effectiveLeverage <= 0) return null;
    return available * effectiveLeverage;
  }, [effectiveAvailableAmount, estimatedMaxQty, effectiveLeverage, isSpotSell, qtyInputMode, refPrice]);

  const estimatedLiquidation = useMemo(() => {
    return estimateLiquidationPrices({
      entryPrice: orderReferencePrice,
      quantity: orderQtyValue,
      leverage: numericLeverage,
      marginMode,
      accountEquity: summary?.equity ?? null,
      availableMargin: summary?.availableMargin ?? null
    });
  }, [marginMode, numericLeverage, orderQtyValue, orderReferencePrice, summary?.availableMargin, summary?.equity]);

  const clearPendingTickerUpdate = useCallback(() => {
    if (tickerUpdateTimerRef.current !== null) {
      window.clearTimeout(tickerUpdateTimerRef.current);
      tickerUpdateTimerRef.current = null;
    }
    pendingTickerRef.current = null;
  }, []);

  const applyTickerUpdate = useCallback((nextTicker: TickerState) => {
    const commitTicker = (candidate: TickerState) => {
      lastTickerCommitAtRef.current = Date.now();
      setTicker((prev) => (tickersEqual(prev, candidate) ? prev : candidate));
    };
    const elapsedMs = Date.now() - lastTickerCommitAtRef.current;
    if (elapsedMs >= TICKER_RENDER_THROTTLE_MS) {
      clearPendingTickerUpdate();
      commitTicker(nextTicker);
      return;
    }

    pendingTickerRef.current = nextTicker;
    if (tickerUpdateTimerRef.current !== null) return;
    tickerUpdateTimerRef.current = window.setTimeout(() => {
      tickerUpdateTimerRef.current = null;
      const pending = pendingTickerRef.current;
      pendingTickerRef.current = null;
      if (pending) commitTicker(pending);
    }, Math.max(50, TICKER_RENDER_THROTTLE_MS - elapsedMs));
  }, [clearPendingTickerUpdate]);

  function setQtyFromPercent(nextPercent: number) {
    const clamped = Math.max(0, Math.min(100, nextPercent));
    setQtyPercent(clamped);

    if (!estimatedMaxInputByMode || estimatedMaxInputByMode <= 0) return;
    const next = (estimatedMaxInputByMode * clamped) / 100;

    if (qtyInputMode !== "quantity") {
      if (!Number.isFinite(next) || next <= 0) {
        setQty("");
        return;
      }
      setQty(next.toFixed(4).replace(/\.?0+$/, ""));
      return;
    }

    const step = selectedSymbolMeta?.stepSize ?? null;
    const minQty = selectedSymbolMeta?.minQty ?? null;
    let normalized = next;

    if (step !== null && Number.isFinite(step) && step > 0) {
      normalized = Math.floor(next / step) * step;
    }
    if (clamped > 0 && minQty !== null && Number.isFinite(minQty) && minQty > 0) {
      normalized = Math.max(normalized, minQty);
    }

    if (normalized > 0 && Number.isFinite(normalized)) {
      const decimals =
        step !== null && step > 0 && Number.isFinite(step)
          ? Math.min(8, String(step).split(".")[1]?.length ?? 0)
          : 6;
      setQty(normalized.toFixed(decimals).replace(/\.?0+$/, ""));
    }
  }

  function resetTicketDefaults() {
    setOrderType("limit");
    setMarginMode("isolated");
    setEntryMode("open");
    setLeverage("10");
    setQtyInputMode("quantity");
    setQtyInputModeDraft("quantity");
    setQty("0.001");
    setQtyPercent(0);
    setPrice("");
    setTpSlEnabled(false);
    setTakeProfitPrice("");
    setStopLossPrice("");
    setPrefillInfo(null);
  }

  function applyPrefillTicket(prefill: TradeDeskPrefillPayload) {
    setActivePrefill(prefill);
    setEntryMode("open");
    if (typeof window !== "undefined") {
      setPrefillContextExpanded(!window.matchMedia("(max-width: 700px)").matches);
    }

    if (prefill.timeframe && TIMEFRAMES.includes(prefill.timeframe as any)) {
      setTimeframe(prefill.timeframe);
    }

    if (prefill.symbol) {
      setSelectedPositionKey(null);
      setSelectedSymbol(prefill.symbol.trim().toUpperCase());
    }

    if (prefill.suggestedEntry?.type === "market" || prefill.suggestedEntry?.type === "limit") {
      setOrderType(prefill.suggestedEntry.type);
    }

    if (prefill.suggestedEntry?.type === "limit" && prefill.suggestedEntry.price) {
      setPrice(String(prefill.suggestedEntry.price));
    }

    if (prefill.leverage && Number.isFinite(prefill.leverage) && prefill.leverage >= 1 && prefill.leverage <= 125) {
      setLeverage(String(prefill.leverage));
    }

    if (prefill.suggestedTakeProfit || prefill.suggestedStopLoss) {
      setTpSlEnabled(true);
      setTakeProfitPrice(prefill.suggestedTakeProfit ? String(prefill.suggestedTakeProfit) : "");
      setStopLossPrice(prefill.suggestedStopLoss ? String(prefill.suggestedStopLoss) : "");
    }

    if (prefill.positionSizeHint) {
      if (prefill.positionSizeHint.mode === "percent_balance") {
        setQtyInputMode("cost");
        setQtyInputModeDraft("cost");
        setQtyFromPercent(prefill.positionSizeHint.value);
      } else {
        setQtyInputMode("cost");
        setQtyInputModeDraft("cost");
        setQty(String(prefill.positionSizeHint.value));
        setQtyPercent(0);
      }
    }

    if (prefill.marketType === "spot" && prefill.signal === "down") {
      setPrefillInfo(t("messages.spotShortNotSupported"));
    } else {
      setPrefillInfo(null);
    }
  }

  const persistSettings = useCallback(async (next: Partial<TradingSettings>) => {
    try {
      await apiPost<TradingSettings>("/api/trading/settings", next);
    } catch (e) {
      setSoftWarning(t("messages.settingsSaveFailed", { error: errMsg(e) }));
    }
  }, [t]);

  function selectPositionForChart(position: PositionItem, rowKey: string) {
    if (selectedPositionKey === rowKey) {
      setSelectedPositionKey(null);
      return;
    }

    const nextSymbol = resolveDeskSymbol(position.symbol, symbols, selectedSymbol);
    setSelectedPositionKey(rowKey);
    if (normalizeDeskSymbol(nextSymbol) === normalizeDeskSymbol(selectedSymbol)) return;

    setSelectedSymbol(nextSymbol);
    if (selectedAccountId) {
      void reloadLiveTables(selectedAccountId, nextSymbol);
    }
    void persistSettings({ symbol: nextSymbol });
  }

  function selectDeskSymbol(nextSymbol: string) {
    const next = nextSymbol.trim().toUpperCase();
    if (!next || normalizeDeskSymbol(next) === normalizeDeskSymbol(selectedSymbol)) return;
    setSelectedPositionKey(null);
    setSelectedSymbol(next);
    if (selectedAccountId) {
      void reloadLiveTables(selectedAccountId, next);
    }
    void persistSettings({ symbol: next });
  }

  function applyLiveRefreshFailures(partialFailures: string[], blockingFailures: string[]) {
    if (partialFailures.length > 0) {
      const message = t(
        blockingFailures.length > 0 ? "messages.tradingDataDegraded" : "messages.tradingDataPartial",
        { details: partialFailures.join(", ") }
      );
      setSoftWarning(message);
      setDataBlockReason(blockingFailures.length > 0 ? message : null);
    } else {
      setSoftWarning(null);
      setDataBlockReason(null);
    }
  }

  function applyLiveRefreshBackoff(errors: unknown[]): boolean {
    const retryAfterMs = maxRetryAfterMs(errors);
    if (retryAfterMs === null) return false;

    const backoffUntil = Date.now() + retryAfterMs + 1_000;
    liveRefreshBackoffUntilRef.current = Math.max(liveRefreshBackoffUntilRef.current, backoffUntil);
    return true;
  }

  function markOpenOrdersStale() {
    liveTableReadyRef.current.openOrders = false;
  }

  function liveStateFailureLabel(label: string, degraded?: boolean, error?: string | null): string {
    if (error && error.trim()) return `${label} (${error.trim()})`;
    return degraded ? `${label} (degraded)` : label;
  }

  function applyTradingLiveState(payload: TradingLiveStateResponse, symbol: string): string[] {
    const partialFailures: string[] = [];
    const blockingFailures: string[] = [];

    const summaryDegraded = payload.summary?.degraded === true;
    startTransition(() => {
      setSummary((prev) => {
        const next = mergeAccountSummary(prev, payload.summary, {
          preserveNullNumbers: summaryDegraded,
          preserveSpotBalances: true
        });
        return accountSummariesEqual(prev, next) ? prev : next;
      });
    });
    if (!summaryDegraded) {
      liveTableReadyRef.current.summary = true;
    } else if (!liveTableReadyRef.current.summary) {
      partialFailures.push(liveStateFailureLabel("account summary", true, payload.summary?.error));
    }

    const positionsDegraded = payload.positions?.degraded === true;
    setPositionsDataDegraded(positionsDegraded);
    const positionItems = normalizeDeskPositions(payload.positions?.items ?? []);
    startTransition(() => {
      setPositions((prev) => {
        if (positionsDegraded && liveTableReadyRef.current.positions) return prev;
        return positionsEqual(prev, positionItems) ? prev : positionItems;
      });
    });
    if (!positionsDegraded) {
      liveTableReadyRef.current.positions = true;
    } else if (!liveTableReadyRef.current.positions) {
      partialFailures.push(liveStateFailureLabel("positions", true, payload.positions?.error));
    }

    const openOrdersDegraded = payload.openOrders?.degraded === true;
    const orderItems = normalizeDeskOpenOrders(payload.openOrders?.items ?? [], symbol);
    startTransition(() => {
      setOpenOrders((prev) => {
        if (openOrdersDegraded && liveTableReadyRef.current.openOrders) return prev;
        return openOrdersEqual(prev, orderItems) ? prev : orderItems;
      });
    });
    if (!openOrdersDegraded) {
      liveTableReadyRef.current.openOrders = true;
    } else {
      const failure = liveStateFailureLabel("open orders", true, payload.openOrders?.error);
      partialFailures.push(failure);
      if (isLiveTableFailureBlocking("openOrders", liveTableReadyRef.current)) {
        blockingFailures.push(failure);
      }
    }

    applyLiveRefreshFailures(partialFailures, blockingFailures);
    return partialFailures;
  }

  async function loadPrimaryState(
    preferredAccountId?: string | null,
    prefillPayload?: TradeDeskPrefillPayload | null
  ) {
    setLoading(true);
    setError(null);
    try {
      await apiPost("/exchange-accounts/default-paper", {}).catch(() => null);
      const [accountPayload, settings] = await Promise.all([
        apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts?purpose=execution"),
        apiGet<TradingSettings>("/api/trading/settings")
      ]);

      const accountRows = (accountPayload.items ?? []).filter(isExecutionAccountEligible);
      setAccounts(accountRows);

      const queryAccountId = searchParams.get("exchangeAccountId");
      const explicitAccount =
        preferredAccountId ??
        prefillPayload?.accountId ??
        queryAccountId ??
        "";
      const savedRealAccount = accountRows.find(
        (row) => row.id === settings.exchangeAccountId && !row.systemManaged
      );
      const fallbackAccount = accountRows.find((row) => !row.systemManaged) ?? accountRows[0] ?? null;
      const chosenAccount = accountRows.some((row) => row.id === explicitAccount)
        ? explicitAccount
        : (savedRealAccount?.id ?? fallbackAccount?.id ?? "");

      setSelectedAccountId(chosenAccount);

      if (
        prefillPayload?.timeframe &&
        TIMEFRAMES.includes(prefillPayload.timeframe as any)
      ) {
        setTimeframe(prefillPayload.timeframe);
      } else if (settings.timeframe && TIMEFRAMES.includes(settings.timeframe as any)) {
        setTimeframe(settings.timeframe);
      }

      if (prefillPayload?.marketType === "spot" || prefillPayload?.marketType === "perp") {
        setMarketType(prefillPayload.marketType);
      } else if (settings.marketType === "spot" || settings.marketType === "perp") {
        setMarketType(settings.marketType);
      } else {
        setMarketType("perp");
      }

      if (settings.marginMode === "isolated" || settings.marginMode === "cross") {
        setMarginMode(settings.marginMode);
      } else {
        setMarginMode("isolated");
      }
      if (typeof settings.leverage === "number" && Number.isFinite(settings.leverage)) {
        setLeverage(String(Math.max(1, Math.min(125, Math.round(settings.leverage)))));
      }
      setChartEngine(settings.chartEngine === "lightweight" ? "lightweight" : "advanced");
      setChartPreferences({
        ...DEFAULT_CHART_PREFERENCES,
        ...(settings.chartPreferences ?? {}),
        indicatorToggles: {
          ...DEFAULT_CHART_PREFERENCES.indicatorToggles,
          ...(settings.chartPreferences?.indicatorToggles ?? {})
        }
      });

      if (prefillPayload?.symbol) {
        setSelectedSymbol(prefillPayload.symbol.trim().toUpperCase());
      } else if (settings.symbol) {
        setSelectedSymbol(settings.symbol);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadDeskData(accountId: string, preferredSymbol?: string | null) {
    if (!accountId) return;

    setError(null);
    setSoftWarning(null);
    setDataBlockReason(null);
    try {
      const marketTypeParam = `&marketType=${encodeURIComponent(marketType)}`;
      const symbolPayload = await apiGet<{
        exchangeAccountId: string;
        items: SymbolItem[];
        defaultSymbol: string | null;
      }>(`/api/symbols?exchangeAccountId=${encodeURIComponent(accountId)}${marketTypeParam}`);

      const rows = symbolPayload.items ?? [];
      setSymbols(rows);

      const normalizedPreferred = (preferredSymbol ?? selectedSymbol).trim().toUpperCase();
      const fallbackSymbol = symbolPayload.defaultSymbol ?? rows[0]?.symbol ?? "BTCUSDT";
      const nextSymbol = rows.some((row) => row.symbol === normalizedPreferred)
        ? normalizedPreferred
        : fallbackSymbol;

      setSelectedSymbol(nextSymbol);

      const livePayload = await apiGet<TradingLiveStateResponse>(
        `/api/trading/live-state?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(nextSymbol)}${marketTypeParam}`
      );
      applyTradingLiveState(livePayload, nextSymbol);

      await persistSettings({
        exchangeAccountId: accountId,
        symbol: nextSymbol,
        timeframe,
        marketType
      });
      setError(null);
    } catch (e) {
      applyLiveRefreshBackoff([e]);
      setError(errMsg(e));
      setDataBlockReason(t("messages.tradingDataDegraded", { details: errMsg(e) }));
    }
  }

  async function reloadLiveTables(
    accountId: string,
    symbol: string
  ): Promise<{ partialFailures: string[] }> {
    if (liveRefreshBackoffUntilRef.current > Date.now()) {
      return { partialFailures: [] };
    }

    if (liveRefreshInFlightRef.current) {
      return liveRefreshInFlightRef.current;
    }

    const task = (async () => {
      const marketTypeParam = `&marketType=${encodeURIComponent(marketType)}`;
      try {
        const livePayload = await apiGet<TradingLiveStateResponse>(
          `/api/trading/live-state?exchangeAccountId=${encodeURIComponent(accountId)}&symbol=${encodeURIComponent(symbol)}${marketTypeParam}`
        );
        const partialFailures = applyTradingLiveState(livePayload, symbol);
        return { partialFailures };
      } catch (error) {
        applyLiveRefreshBackoff([error]);
        throw error;
      }
    })();

    liveRefreshInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (liveRefreshInFlightRef.current === task) {
        liveRefreshInFlightRef.current = null;
      }
    }
  }

  useEffect(() => {
    let disposed = false;
    async function bootstrap() {
      let parsedPrefill: TradeDeskPrefillPayload | null = null;
      const prefillParam = searchParams.get("prefill");
      const predictionIdParam = searchParams.get("predictionId");

      if (prefillParam) {
        if (prefillParam === "1") {
          const raw = sessionStorage.getItem(TRADE_DESK_PREFILL_SESSION_KEY);
          sessionStorage.removeItem(TRADE_DESK_PREFILL_SESSION_KEY);
          if (raw) {
            try {
              parsedPrefill = parseTradeDeskPrefill(JSON.parse(raw));
            } catch {
              parsedPrefill = null;
            }
          }
        } else {
          parsedPrefill = parseTradeDeskPrefill(decodeBase64UrlJson(prefillParam));
        }

        if (!parsedPrefill) {
          setSoftWarning(t("messages.invalidPrefillPayload"));
        }
      } else if (predictionIdParam) {
        try {
          const detail = await apiGet<PredictionDetailResponse>(
            `/api/predictions/${encodeURIComponent(predictionIdParam)}`
          );
          if (!detail.accountId) {
            setSoftWarning(t("messages.predictionNoAccountMapping"));
          } else {
            const built = buildTradeDeskPrefillPayload(detail);
            parsedPrefill = built.payload;
            if (built.info) {
              setPrefillInfo(built.info);
            }
          }
        } catch (e) {
          setSoftWarning(t("messages.unableToLoadPredictionPrefill", { error: errMsg(e) }));
        }
      }

      if (disposed) return;
      if (parsedPrefill) {
        applyPrefillTicket(parsedPrefill);
      }
      await loadPrimaryState(parsedPrefill?.accountId ?? null, parsedPrefill);
    }

    void bootstrap();
    return () => {
      disposed = true;
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
      clearPendingTickerUpdate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    if (isSpotMode && !spotModeSupportedForAccount) {
      setMarketType("perp");
      setSoftWarning(t("messages.spotModeNotAvailableForAccount"));
      void persistSettings({ marketType: "perp" });
    }
  }, [isSpotMode, selectedAccountId, spotModeSupportedForAccount]);

  useEffect(() => {
    if (!selectedAccountId) return;
    if (marketType === "perp" && !perpModeSupportedForAccount) {
      setMarketType("spot");
      setSoftWarning(t("messages.perpModeNotAvailableForAccount"));
      void persistSettings({ marketType: "spot" });
    }
  }, [marketType, perpModeSupportedForAccount, selectedAccountId]);

  useEffect(() => {
    if (!isSpotMode) return;
    setEntryMode("open");
    setTpSlEnabled(false);
  }, [isSpotMode]);

  useEffect(() => {
    if (!selectedAccountId) return;
    void loadDeskData(selectedAccountId, activePrefill?.symbol ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, activePrefill?.symbol, marketType]);

  useEffect(() => {
    if (!activePrefill?.positionSizeHint) return;
    if (activePrefill.positionSizeHint.mode !== "percent_balance") return;
    if (!estimatedMaxInputByMode || estimatedMaxInputByMode <= 0) return;
    setQtyFromPercent(activePrefill.positionSizeHint.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePrefill?.predictionId, estimatedMaxInputByMode]);

  const marketStreamUrl = selectedAccountId && selectedSymbol
    ? `${wsBase}/ws/market?exchangeAccountId=${encodeURIComponent(selectedAccountId)}&symbol=${encodeURIComponent(selectedSymbol)}&marketType=${encodeURIComponent(marketType)}`
    : null;
  const userStreamUrl = selectedAccountId
    ? `${wsBase}/ws/user?exchangeAccountId=${encodeURIComponent(selectedAccountId)}&marketType=${encodeURIComponent(marketType)}`
    : null;

  const reconnectMarketStream = useReconnectingWebSocket({
    url: marketStreamUrl,
    onConnected: () => setMarketStreamError(null),
    onDisconnected: () => {
      setMarketStreamError((current) => current ?? t("messages.marketStreamDisconnected"));
    },
    onMessage: (event) => {
      let payload: WsEnvelope | null = null;
      try {
        payload = JSON.parse(event.data) as WsEnvelope;
      } catch {
        return;
      }
      if (!payload) return;

      if (payload.type.includes("ticker") && payload.data) {
        applyTickerUpdate(payload.data as TickerState);
      }

      if (payload.type === "error") {
        setMarketStreamError(payload.message ?? t("messages.marketWebsocketError"));
      }
    }
  });

  useEffect(() => {
    return () => clearPendingTickerUpdate();
  }, [clearPendingTickerUpdate, marketStreamUrl]);

  const reconnectUserStream = useReconnectingWebSocket({
    url: userStreamUrl,
    onConnected: () => setUserStreamError(null),
    onDisconnected: () => {
      setUserStreamError((current) => current ?? t("messages.userStreamDisconnected"));
    },
    onMessage: (event) => {
      let payload: WsEnvelope | null = null;
      try {
        payload = JSON.parse(event.data) as WsEnvelope;
      } catch {
        return;
      }
      if (!payload) return;

      if (payload.type === "error") {
        setUserStreamError(payload.message ?? t("messages.userStreamDisconnected"));
        return;
      }

      if (payload.type === "account" && payload.data) {
        const data = payload.data as {
          equity: number | null;
          availableMargin: number | null;
          spotQuoteAsset?: string | null;
          spotQuoteAvailable?: number | null;
          spotBaseAsset?: string | null;
          spotBaseAvailable?: number | null;
          spotBaseTotal?: number | null;
          positions?: PositionItem[];
          openOrders?: OpenOrderItem[];
        };

        startTransition(() => {
          setSummary((prev) => {
            if (!prev) return prev;
            const next = mergeAccountSummary(prev, {
              ...prev,
              equity: data.equity,
              availableMargin: data.availableMargin,
              spotQuoteAsset: data.spotQuoteAsset !== undefined ? data.spotQuoteAsset : prev.spotQuoteAsset,
              spotQuoteAvailable: data.spotQuoteAvailable !== undefined ? data.spotQuoteAvailable : prev.spotQuoteAvailable,
              spotBaseAsset: data.spotBaseAsset !== undefined ? data.spotBaseAsset : prev.spotBaseAsset,
              spotBaseAvailable: data.spotBaseAvailable !== undefined ? data.spotBaseAvailable : prev.spotBaseAvailable,
              spotBaseTotal: data.spotBaseTotal !== undefined ? data.spotBaseTotal : prev.spotBaseTotal,
              updatedAt: new Date().toISOString()
            }, {
              preserveNullNumbers: true,
              preserveSpotBalances: true
            });
            return accountSummariesEqual(prev, next) ? prev : next;
          });
        });

        if (Array.isArray(data.positions)) {
          const nextPositions = normalizeDeskPositions(data.positions);
          startTransition(() => {
            setPositions((prev) => {
              if (nextPositions.length === 0 && prev.length > 0) return prev;
              return positionsEqual(prev, nextPositions) ? prev : nextPositions;
            });
          });
          liveTableReadyRef.current.positions = true;
        }
        if (Array.isArray(data.openOrders)) {
          const nextOrders = normalizeDeskOpenOrders(data.openOrders, selectedSymbol);
          startTransition(() => {
            setOpenOrders((prev) => (openOrdersEqual(prev, nextOrders) ? prev : nextOrders));
          });
          liveTableReadyRef.current.openOrders = true;
        }
      }

      if (payload.type === "order" || payload.type === "position" || payload.type === "fill") {
        void reloadLiveTables(selectedAccountId, selectedSymbol).catch(() => {
          // ignore transient refresh errors
        });
      }
    }
  });

  useEffect(() => {
    if (!selectedAccountId || !selectedSymbol) return;

    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const liveRefreshMs = selectedAccountIsBingx
      ? (marketType === "spot" ? 45_000 : 30_000)
      : (marketType === "spot" ? 20_000 : 8_000);
    refreshTimerRef.current = window.setInterval(() => {
      void reloadLiveTables(selectedAccountId, selectedSymbol).catch(() => {
        // background refresh should not interrupt user
      });
    }, liveRefreshMs);

    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [selectedAccountId, selectedSymbol, marketType, selectedAccountIsBingx]);

  useEffect(() => {
    setSelectedPositionKey(null);
    setPositionEditDrafts({});
    setOrderEditDrafts({});
    setActionSuccess(null);
    setSpotOrderSide("buy");
    liveTableReadyRef.current = createLiveTableReadiness();
    liveRefreshBackoffUntilRef.current = 0;
    liveRefreshInFlightRef.current = null;
  }, [selectedAccountId, marketType]);

  async function applyLeverage() {
    if (!selectedAccountId) return;
    if (isSpotMode) {
      setActionError(t("messages.leverageNotSupportedForSpot"));
      return;
    }

    const parsedLeverage = Number(leverage);
    if (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > 125) {
      setActionError(t("messages.leverageRangeError"));
      return;
    }

    setActionError(null);
    setIsApplyingLeverage(true);
    try {
      await apiPost("/api/account/leverage", {
        exchangeAccountId: selectedAccountId,
        marketType,
        symbol: selectedSymbol,
        leverage: Math.trunc(parsedLeverage),
        marginMode
      });
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setIsApplyingLeverage(false);
    }
  }

  async function submitOrder(direction: TradeDirection) {
    if (!selectedAccountId) return;
    if (tradingDataBlocked) {
      setActionError(dataBlockReason ?? t("messages.actionDisabledDegraded"));
      return;
    }

    const parsedQtyInput = Number(qty);
    const parsedPrice = Number(price);
    const parsedLeverage = Number(leverage);
    const parsedTakeProfit = parseOptionalPositivePrice(takeProfitPrice);
    const parsedStopLoss = parseOptionalPositivePrice(stopLossPrice);

    if (!Number.isFinite(parsedQtyInput) || parsedQtyInput <= 0) {
      setActionError(t("messages.quantityGtZero"));
      return;
    }

    if (!orderQtyValue || !Number.isFinite(orderQtyValue) || orderQtyValue <= 0) {
      setActionError(t("messages.unableDeriveQty"));
      return;
    }

    const step = selectedSymbolMeta?.stepSize ?? null;
    const minQty = selectedSymbolMeta?.minQty ?? null;
    const maxQty = selectedSymbolMeta?.maxQty ?? null;

    let parsedQty = orderQtyValue;
    if (step !== null && Number.isFinite(step) && step > 0) {
      parsedQty = Math.floor(parsedQty / step) * step;
    }

    if (minQty !== null && Number.isFinite(minQty) && minQty > 0 && parsedQty < minQty) {
      setActionError(t("messages.quantityBelowMin", { min: String(minQty) }));
      return;
    }

    if (maxQty !== null && Number.isFinite(maxQty) && maxQty > 0 && parsedQty > maxQty) {
      parsedQty = maxQty;
    }

    if (isSpotMode && isSpotSell && spotBaseAvailable !== null && parsedQty > spotBaseAvailable + 1e-12) {
      setActionError(
        t("messages.spotInsufficientBaseBalance", {
          available: fmt(spotBaseAvailable, 8),
          asset: baseAssetUnit
        })
      );
      return;
    }

    if (orderType === "limit" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      setActionError(t("messages.limitRequiresPrice"));
      return;
    }

    if (!isSpotMode && (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > 125)) {
      setActionError(t("messages.leverageRangeError"));
      return;
    }

    if (
      !isSpotMode &&
      tpSlEnabled &&
      !parsedTakeProfit.ok
    ) {
      setActionError(t("messages.takeProfitGtZero"));
      return;
    }

    if (
      !isSpotMode &&
      tpSlEnabled &&
      !parsedStopLoss.ok
    ) {
      setActionError(t("messages.stopLossGtZero"));
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    setIsSubmitting(true);

    try {
      const apiSide =
        isSpotMode
          ? (direction === "sell" || direction === "short" ? "sell" : "buy")
          : (direction === "buy" || direction === "long" ? "long" : "short");
      const response = await apiPost<{ orderId: string }>("/api/orders", {
        exchangeAccountId: selectedAccountId,
        marketType,
        symbol: selectedSymbol,
        type: orderType,
        side: apiSide,
        qty: parsedQty,
        price: orderType === "limit" ? parsedPrice : undefined,
        takeProfitPrice:
          !isSpotMode && tpSlEnabled && parsedTakeProfit.ok && parsedTakeProfit.value !== null
            ? parsedTakeProfit.value
            : undefined,
        stopLossPrice:
          !isSpotMode && tpSlEnabled && parsedStopLoss.ok && parsedStopLoss.value !== null
            ? parsedStopLoss.value
            : undefined,
        leverage: !isSpotMode ? Math.trunc(parsedLeverage) : undefined,
        marginMode: !isSpotMode ? marginMode : undefined,
        reduceOnly: !isSpotMode ? entryMode === "close" : undefined,
        idempotencyKey: createClientIdempotencyKey("manual_order")
      });

      markOpenOrdersStale();
      const refreshed = await reloadLiveTables(selectedAccountId, selectedSymbol);
      setActionSuccess(t("messages.orderSubmitted", { orderId: response.orderId }));
      if (refreshed.partialFailures.length > 0) {
        setSoftWarning(t("messages.orderSubmittedRefreshWarning", { details: refreshed.partialFailures.join(", ") }));
      }
      if (orderType === "limit") {
        setPrice("");
      }
    } catch (e) {
      setActionSuccess(null);
      setActionError(errMsg(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function closePosition(position: PositionItem) {
    if (!selectedAccountId) return;
    if (tradingDataBlocked) {
      setActionError(dataBlockReason ?? t("messages.actionDisabledDegraded"));
      return;
    }
    const positionSymbol = position.symbol || selectedSymbol;
    const pendingKey = `${marketType}:${positionSymbol}:${position.side}`;
    if (closePendingKey) return;
    const accountLabel = selectedAccount ? `${selectedAccount.exchange.toUpperCase()} - ${selectedAccount.label}` : selectedAccountId;
    const closeSide = isSpotMode ? "spot" : position.side.toUpperCase();
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("messages.confirmClosePosition", { account: accountLabel, symbol: positionSymbol, side: closeSide }))
    ) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setClosePendingKey(pendingKey);

    try {
      const response = await apiPost<{
        stateSync?: { status?: "synced" | "pending_live_position" | "sync_skipped_read_failed"; error?: string };
      }>("/api/positions/close", {
        exchangeAccountId: selectedAccountId,
        marketType,
        symbol: positionSymbol,
        side: isSpotMode ? undefined : position.side,
        idempotencyKey: createClientIdempotencyKey("manual_close")
      });
      markOpenOrdersStale();
      await reloadLiveTables(selectedAccountId, selectedSymbol);
      if (response.stateSync?.status === "pending_live_position") {
        setSoftWarning(t("messages.closePendingLivePosition"));
      } else if (response.stateSync?.status === "sync_skipped_read_failed") {
        setSoftWarning(t("messages.closeSyncSkipped", { error: response.stateSync.error ?? "unknown" }));
      }
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setClosePendingKey(null);
    }
  }

  async function cancelOrder(orderId: string) {
    if (!selectedAccountId) return;
    if (tradingDataBlocked) {
      setActionError(dataBlockReason ?? t("messages.actionDisabledDegraded"));
      return;
    }
    setActionError(null);

    try {
      await apiPost("/api/orders/cancel", {
        exchangeAccountId: selectedAccountId,
        marketType,
        orderId,
        symbol: selectedSymbol
      });
      markOpenOrdersStale();
      await reloadLiveTables(selectedAccountId, selectedSymbol);
    } catch (e) {
      setActionError(errMsg(e));
    }
  }

  async function cancelAll() {
    if (!selectedAccountId) return;
    if (tradingDataBlocked) {
      setActionError(dataBlockReason ?? t("messages.actionDisabledDegraded"));
      return;
    }
    if (isCancelAllPending) return;
    const accountLabel = selectedAccount ? `${selectedAccount.exchange.toUpperCase()} - ${selectedAccount.label}` : selectedAccountId;
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("messages.confirmCancelAll", { account: accountLabel, symbol: selectedSymbol }))
    ) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setIsCancelAllPending(true);

    try {
      await apiPost(
        `/api/orders/cancel-all?exchangeAccountId=${encodeURIComponent(selectedAccountId)}&symbol=${encodeURIComponent(selectedSymbol)}&marketType=${encodeURIComponent(marketType)}`,
        {
          exchangeAccountId: selectedAccountId,
          marketType,
          symbol: selectedSymbol,
          idempotencyKey: createClientIdempotencyKey("manual_cancel_all")
        }
      );
      markOpenOrdersStale();
      await reloadLiveTables(selectedAccountId, selectedSymbol);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setIsCancelAllPending(false);
    }
  }

  async function savePositionTpSl(position: PositionItem, rowKey: string) {
    if (!selectedAccountId) return;
    if (isSpotMode) {
      setActionError(t("messages.tpSlNotSupportedForSpot"));
      return;
    }
    const draft = positionEditDrafts[rowKey];
    if (!draft) return;
    const parsedTp = parseOptionalPositivePrice(draft.tp);
    const parsedSl = parseOptionalPositivePrice(draft.sl);
    if (!parsedTp.ok) {
      setActionError(t("messages.takeProfitGtZero"));
      return;
    }
    if (!parsedSl.ok) {
      setActionError(t("messages.stopLossGtZero"));
      return;
    }
    const tp = parsedTp.value;
    const sl = parsedSl.value;
    setActionError(null);
    setPositionSavingKey(rowKey);
    try {
      await apiPost("/api/positions/tpsl", {
        exchangeAccountId: selectedAccountId,
        marketType,
        symbol: position.symbol,
        side: position.side,
        takeProfitPrice: tp,
        stopLossPrice: sl
      });
      markOpenOrdersStale();
      await reloadLiveTables(selectedAccountId, selectedSymbol);
      setPositionEditDrafts((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setPositionSavingKey(null);
    }
  }

  async function saveOrderEdit(order: OpenOrderItem) {
    if (!selectedAccountId) return;
    const draft = orderEditDrafts[order.orderId];
    if (!draft) return;
    const payload: Record<string, unknown> = {
      exchangeAccountId: selectedAccountId,
      marketType,
      orderId: order.orderId,
      symbol: order.symbol
    };
    let hasEditableChange = false;
    if (draft.price.trim() !== "") {
      const value = Number(draft.price);
      if (!Number.isFinite(value) || value <= 0) {
        setActionError(t("messages.limitRequiresPrice"));
        return;
      }
      if (!numericEqual(value, order.price)) {
        payload.price = value;
        hasEditableChange = true;
      }
    }
    if (draft.qty.trim() !== "") {
      const value = Number(draft.qty);
      if (!Number.isFinite(value) || value <= 0) {
        setActionError(t("messages.quantityGtZero"));
        return;
      }
      if (!numericEqual(value, order.qty)) {
        payload.qty = value;
        hasEditableChange = true;
      }
    }
    if (!isSpotMode) {
      const parsedTp = parseOptionalPositivePrice(draft.tp);
      const parsedSl = parseOptionalPositivePrice(draft.sl);
      if (!parsedTp.ok) {
        setActionError(t("messages.takeProfitGtZero"));
        return;
      }
      if (!parsedSl.ok) {
        setActionError(t("messages.stopLossGtZero"));
        return;
      }
      if (parsedTp.value !== null) {
        const value = parsedTp.value;
        payload.takeProfitPrice = value;
        if (!numericEqual(value, order.takeProfitPrice)) {
          hasEditableChange = true;
        }
      } else {
        payload.takeProfitPrice = null;
        if (order.takeProfitPrice !== null) {
          hasEditableChange = true;
        }
      }
      if (parsedSl.value !== null) {
        const value = parsedSl.value;
        payload.stopLossPrice = value;
        if (!numericEqual(value, order.stopLossPrice)) {
          hasEditableChange = true;
        }
      } else {
        payload.stopLossPrice = null;
        if (order.stopLossPrice !== null) {
          hasEditableChange = true;
        }
      }
    }

    if (!hasEditableChange) {
      setActionError(t("messages.noChanges"));
      return;
    }

    setActionError(null);
    setOrderSavingId(order.orderId);
    try {
      await apiPost("/api/orders/edit", payload);
      markOpenOrdersStale();
      await reloadLiveTables(selectedAccountId, selectedSymbol);
      setOrderEditDrafts((prev) => {
        const next = { ...prev };
        delete next[order.orderId];
        return next;
      });
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setOrderSavingId(null);
    }
  }

  function clearPrefill() {
    setActivePrefill(null);
    resetTicketDefaults();

    const params = new URLSearchParams(searchParams.toString());
    params.delete("prefill");
    params.delete("predictionId");
    if (!params.get("exchangeAccountId") && selectedAccountId) {
      params.set("exchangeAccountId", selectedAccountId);
    }

    const nextPath = params.toString() ? `/trade?${params.toString()}` : "/trade";
    router.replace(nextPath);
  }

  const handleChartEngineChange = useCallback((next: ChartEngine) => {
    setChartEngine(next);
    void persistSettings({ chartEngine: next });
  }, [persistSettings]);

  const handleChartPreferencesChange = useCallback((next: TradingChartPreferences) => {
    setChartPreferences(next);
    void persistSettings({ chartPreferences: next });
  }, [persistSettings]);

  const displayedError = error ?? marketStreamError ?? userStreamError;

  return (
    <div className="tradeDeskWrap">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {displayedError ? (
        <Notice tone="danger" className="card tradeDeskNotice tradeDeskNoticeError">
          <strong>{t("alerts.error")}:</strong> {displayedError}
          <div style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                if (!selectedAccountId) return;
                reconnectMarketStream();
                reconnectUserStream();
                void loadDeskData(selectedAccountId, selectedSymbol);
              }}
            >
              <AppIcon name="refresh" />
              {t("actions.retry")}
            </button>
          </div>
        </Notice>
      ) : null}

      {actionError ? (
        <Notice tone="danger" className="card tradeDeskNotice tradeDeskNoticeError">
          <strong>{t("alerts.actionFailed")}:</strong> {actionError}
        </Notice>
      ) : null}

      {actionSuccess ? (
        <Notice tone="success" className="card tradeDeskNotice tradeDeskNoticeInfo">
          <strong>{t("alerts.actionSuccess")}:</strong> {actionSuccess}
        </Notice>
      ) : null}

      {softWarning ? (
        <Notice tone="warning" className="card tradeDeskNotice tradeDeskNoticeWarn">
          <strong>{t("alerts.warning")}:</strong> {softWarning}
        </Notice>
      ) : null}

      {activePrefill ? (
        <div className="card tradeDeskNotice tradeDeskNoticeInfo">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>{t("prefill.title")}</strong>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {activePrefill.symbol} · {activePrefill.marketType} · {activePrefill.timeframe} · {fmtConfidence(activePrefill.confidence)} ·{" "}
                {new Date(activePrefill.tsCreated).toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {t("prefill.signal")}: {activePrefill.signal} · {t("prefill.side")}: {activePrefill.side ?? t("prefill.manual")}
                {typeof activePrefill.expectedMovePct === "number"
                  ? ` · ${t("prefill.move")}: ${activePrefill.expectedMovePct.toFixed(2)}%`
                  : ""}
              </div>
              {activePrefill.leverage ? (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {t("prefill.prefillLeverage")}: {activePrefill.leverage}x
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
	                onClick={() => setPrefillContextExpanded((prev) => !prev)}
	              >
	                <AppIcon name="detail" />
	                {prefillContextExpanded ? t("prefill.hideContext") : t("prefill.showContext")}
	              </button>
	              <button className="btn" onClick={clearPrefill} type="button">
	                <AppIcon name="reset" />
	                {t("prefill.clearPrefill")}
	              </button>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            {t("prefill.predictionId")}: {activePrefill.predictionId}
          </div>
          {prefillInfo ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b" }}>{prefillInfo}</div>
          ) : null}
          {prefillContextExpanded ? (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {activePrefill.tags?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {activePrefill.tags.map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
              ) : null}

              {activePrefill.explanation ? (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>{t("prefill.aiExplanation")}</summary>
                  <div style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {activePrefill.explanation}
                  </div>
                </details>
              ) : null}

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>RSI (14)</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.rsi_14, 1)}</div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>MACD hist</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.macd?.hist, 4)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    line {fmtIndicator(activePrefill.indicators?.macd?.line, 4)} / signal {fmtIndicator(activePrefill.indicators?.macd?.signal, 4)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>BB width% / pos</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.bb?.width_pct, 2)} / {fmtIndicator(activePrefill.indicators?.bb?.pos, 3)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>VWAP dist%</div>
                  <div style={{ fontWeight: 700 }}>{fmtIndicator(activePrefill.indicators?.vwap?.dist_pct, 2)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    mode {activePrefill.indicators?.vwap?.mode ?? t("misc.na")}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>ADX / +DI / -DI</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.adx?.adx_14, 1)} / {fmtIndicator(activePrefill.indicators?.adx?.plus_di_14, 1)} / {fmtIndicator(activePrefill.indicators?.adx?.minus_di_14, 1)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>StochRSI %K / %D / value</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.stochrsi?.k, 1)} / {fmtIndicator(activePrefill.indicators?.stochrsi?.d, 1)} / {fmtIndicator(activePrefill.indicators?.stochrsi?.value, 1)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Volume z / rel / trend%</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.volume?.vol_z, 3)} / {fmtIndicator(activePrefill.indicators?.volume?.rel_vol, 3)} / {fmtIndicator(activePrefill.indicators?.volume?.vol_trend, 2)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    EMA {fmtIndicator(activePrefill.indicators?.volume?.vol_ema_fast, 2)} / {fmtIndicator(activePrefill.indicators?.volume?.vol_ema_slow, 2)}
                  </div>
                </div>
                <div className="card" style={{ margin: 0, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>FVG open bull / bear</div>
                  <div style={{ fontWeight: 700 }}>
                    {fmtIndicator(activePrefill.indicators?.fvg?.open_bullish_count, 0)} / {fmtIndicator(activePrefill.indicators?.fvg?.open_bearish_count, 0)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    bull {fmtIndicator(activePrefill.indicators?.fvg?.nearest_bullish_gap?.dist_pct, 2)}% · bear {fmtIndicator(activePrefill.indicators?.fvg?.nearest_bearish_gap?.dist_pct, 2)}%
                  </div>
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: 8 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{t("prefill.keyDrivers")}</div>
                {activePrefill.keyDrivers?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {activePrefill.keyDrivers.slice(0, 5).map((driver) => (
                      <li key={driver.name}>
                        <strong>{driver.name}</strong>: {String(driver.value)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("misc.na")}</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="card tradeDeskSection">{t("loadingDesk")}</div>
      ) : accounts.length === 0 ? (
        <div className="card tradeDeskSection">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("noAccountsTitle")}</div>
          <div style={{ color: "var(--muted)", marginBottom: 12 }}>
            {t("noAccountsHint")}
          </div>
	          <Link href="/settings" className="btn btnPrimary">
	            <AppIcon name="settings" />
	            {t("actions.addExchangeAccount")}
	          </Link>
        </div>
      ) : (
        <>
          <section className="card tradeDeskSection">
            <div className="tradeDeskSectionHeader">
              <div>
                <div className="tradeDeskSectionTitle">{t("sections.tradingContext")}</div>
                <div className="tradeDeskSectionHint">
                  {t("contextHint")}
                </div>
              </div>
            </div>
            <div className="tradeDeskContextGrid">
              <label className="tradeDeskField">
                <div className="tradeDeskFieldLabel">{t("fields.exchangeAccount")}</div>
                <select
                  className="input"
                  value={selectedAccountId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedAccountId(next);
                    void persistSettings({ exchangeAccountId: next });
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.exchange.toUpperCase()} - {account.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="tradeDeskField">
                <div className="tradeDeskFieldLabel">{t("fields.symbol")}</div>
                <SymbolSearchSelect
                  value={selectedSymbol}
                  onChange={selectDeskSymbol}
                  options={symbolOptions}
                  loading={loading}
                  loadingLabel={t("fields.symbolLoading")}
                  emptyLabel={t("fields.symbolSearchEmpty")}
                  searchPlaceholder={t("fields.symbolSearchPlaceholder")}
                  restrictedLabel={t("misc.restricted")}
                  disabled={symbolOptions.length === 0}
                />
              </label>

              <label className="tradeDeskField">
                <div className="tradeDeskFieldLabel">{t("fields.timeframe")}</div>
                <select
                  className="input"
                  value={timeframe}
                  onChange={(event) => {
                    const next = event.target.value;
                    setTimeframe(next);
                    void persistSettings({ timeframe: next });
                  }}
                >
                  {TIMEFRAMES.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <div className="tradeDeskField">
                <div className="tradeDeskFieldLabel">{t("fields.marketType")}</div>
                <div className="tradeOrderModeSwitch">
                  <button
                    className={`tradeOrderModeBtn ${marketType === "perp" ? "tradeOrderModeBtnActive" : ""}`}
                    disabled={!perpModeSupportedForAccount}
                    onClick={() => {
                      setMarketType("perp");
                      void persistSettings({ marketType: "perp" });
                    }}
                    type="button"
                  >
                    {t("fields.perp")}
                  </button>
                  <button
                    className={`tradeOrderModeBtn ${marketType === "spot" ? "tradeOrderModeBtnActive" : ""}`}
                    disabled={!spotModeSupportedForAccount}
                    onClick={() => {
                      setMarketType("spot");
                      void persistSettings({ marketType: "spot" });
                    }}
                    type="button"
                  >
                    {t("fields.spot")}
                  </button>
                </div>
                {!spotModeSupportedForAccount ? (
                  <div className="tradeDeskSectionHint">{t("messages.spotModeNotAvailableForAccount")}</div>
                ) : !perpModeSupportedForAccount ? (
                  <div className="tradeDeskSectionHint">{t("messages.perpModeNotAvailableForAccount")}</div>
                ) : null}
              </div>

              <div className="tradeDeskField">
                <div className="tradeDeskFieldLabel">{t("fields.accountSnapshot")}</div>
                <div className="card tradeDeskSummary">
                  {t("fields.eq")}: {fmt(summary?.equity)} | {t("fields.avail")}: {fmt(summary?.availableMargin)}
                </div>
              </div>
            </div>
          </section>

          <section
            className="tradeDeskGrid"
          >
            <article className="card tradeDeskPane">
              <div className="tradeDeskPaneTitle">
                {selectedSymbol} {selectedSymbolMeta?.status ? `- ${selectedSymbolMeta.status}` : ""}
              </div>
              <div className="tradeDeskPaneHint">{t("sections.liveMarketChart")}</div>
              <TradeChart
                chartEngine={chartEngine}
                exchangeAccountId={selectedAccountId}
                marketDataExchange={selectedAccount?.marketDataExchange ?? selectedAccount?.exchange ?? null}
                symbol={selectedSymbol}
                timeframe={timeframe}
                marketType={marketType}
                prefill={activePrefill}
                chartPreferences={chartPreferences}
                selectedPosition={selectedPosition}
                onChartEngineChange={handleChartEngineChange}
                onChartPreferencesChange={handleChartPreferencesChange}
              />
            </article>

            <article className="card tradeDeskPane">
              <div className="tradeDeskPaneTitle">{t("sections.orderEntry")}</div>
              <div className="tradeDeskPaneHint">{t("orderEntryHint")}</div>

              <div className="tradeOrderPanel">
                {!isSpotMode ? (
                  <>
                    <div className="tradeOrderTopRow">
                      <div className="tradeOrderModeSwitch">
                        <button
                          className={`tradeOrderModeBtn ${marginMode === "isolated" ? "tradeOrderModeBtnActive" : ""}`}
                          onClick={() => {
                            setMarginMode("isolated");
                            void persistSettings({ marginMode: "isolated" });
                          }}
                          type="button"
                        >
                          {t("fields.isolated")}
                        </button>
                        <button
                          className={`tradeOrderModeBtn ${marginMode === "cross" ? "tradeOrderModeBtnActive" : ""}`}
                          onClick={() => {
                            setMarginMode("cross");
                            void persistSettings({ marginMode: "cross" });
                          }}
                          type="button"
                        >
                          {t("fields.cross")}
                        </button>
                      </div>
                      <div className="tradeOrderLeverageControl">
                        <div className="tradeOrderLeverageLabel">{t("fields.leverage")}</div>
                        <div className="tradeOrderLeverageGroup">
                          <input
                            className="tradeOrderLeverageInput"
                            type="number"
                            min={1}
                            max={125}
                            step={1}
                            value={leverage}
                            onChange={(event) => setLeverage(event.target.value)}
                            onBlur={() => {
                              const parsed = Number(leverage);
                              if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 125) {
                                void persistSettings({ leverage: Math.trunc(parsed) });
                              }
                            }}
                          />
                          <button
                            className="tradeOrderApplyBtn"
                            disabled={isApplyingLeverage}
                            onClick={() => void applyLeverage()}
                            type="button"
                          >
                            {isApplyingLeverage ? "..." : t("actions.apply")}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="tradeOrderEntryMode">
                      <button
                        className={`tradeOrderEntryModeBtn ${entryMode === "open" ? "tradeOrderEntryModeBtnActive" : ""}`}
                        onClick={() => setEntryMode("open")}
                        type="button"
                      >
                        {t("actions.open")}
                      </button>
                      <button
                        className={`tradeOrderEntryModeBtn ${entryMode === "close" ? "tradeOrderEntryModeBtnActive" : ""}`}
                        onClick={() => setEntryMode("close")}
                        type="button"
                      >
                        {t("actions.close")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="tradeOrderModeSwitch">
                    <button
                      className={`tradeOrderModeBtn ${spotOrderSide === "buy" ? "tradeOrderModeBtnActive" : ""}`}
                      onClick={() => setSpotOrderSide("buy")}
                      type="button"
                    >
                      {t("actions.buy")}
                    </button>
                    <button
                      className={`tradeOrderModeBtn ${spotOrderSide === "sell" ? "tradeOrderModeBtnActive" : ""}`}
                      onClick={() => setSpotOrderSide("sell")}
                      type="button"
                    >
                      {t("actions.sell")}
                    </button>
                  </div>
                )}

                <div className="tradeOrderTypeTabs">
                  <button
                    className={`tradeOrderTypeTab ${orderType === "limit" ? "tradeOrderTypeTabActive" : ""}`}
                    onClick={() => setOrderType("limit")}
                    type="button"
                  >
                    {t("fields.limit")}
                  </button>
                  <button
                    className={`tradeOrderTypeTab ${orderType === "market" ? "tradeOrderTypeTabActive" : ""}`}
                    onClick={() => setOrderType("market")}
                    type="button"
                  >
                    {t("fields.market")}
                  </button>
                </div>

                <div className="tradeOrderMetaRow">
                  <span>{t("fields.available")}</span>
                  <strong>{fmt(effectiveAvailableAmount, 8)} {availableDisplayUnit}</strong>
                </div>

                {orderType === "limit" ? (
                  <label className="tradeOrderField">
                    <span>{t("fields.price")}</span>
                    <div className="tradeOrderInputRow">
                      <input
                        className="tradeOrderInput"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        placeholder={ticker?.last ? String(ticker.last) : "0.0"}
                      />
                      <button
                        className="tradeOrderMiniBtn"
                        type="button"
                        onClick={() => {
                          const nextPrice = ticker?.last ?? ticker?.mark;
                          if (nextPrice && Number.isFinite(nextPrice)) {
                            setPrice(String(nextPrice));
                          }
                        }}
                      >
                        BBO
                      </button>
                    </div>
                  </label>
                ) : null}

                <label className="tradeOrderField">
                  <span>{t(`qtyMode.${qtyInputModeOption.titleKey}`)}</span>
                  <div className="tradeOrderInputRow">
                    <input
                      className="tradeOrderInput"
                      value={qty}
                      onChange={(event) => setQty(event.target.value)}
                      placeholder={qtyInputMode === "quantity" ? "0.001" : "10"}
                    />
                    <button
                      type="button"
                      className="tradeOrderUnitBadge"
                      onClick={() => {
                        setQtyInputModeDraft(qtyInputMode);
                        setIsQtyModeModalOpen(true);
                      }}
                    >
                      {qtyDisplayUnit}
                    </button>
                  </div>
                </label>

                <input
                  className="tradeOrderSlider"
                  type="range"
                  min={0}
                  max={100}
                  step={25}
                  value={qtyPercent}
                  onChange={(event) => setQtyFromPercent(Number(event.target.value))}
                />

                <div className="tradeOrderDualStats">
                  <div className="tradeOrderDualRow">
                    <span>{t("fields.positionSize")}</span>
                    <strong>
                      <span>{fmt(orderQtyValue, 4)}</span>
                      <span className="tradeOrderValueUnit"> {baseAssetUnit}</span>
                    </strong>
                  </div>
                  <div className="tradeOrderDualRow">
                    <span>{t("fields.cost")}</span>
                    <strong>
                      <span>{fmt(estimatedCost, 4)}</span>
                      <span className="tradeOrderValueUnit"> {quoteAssetUnit}</span>
                    </strong>
                  </div>
                  {!isSpotMode ? (
                    <div className="tradeOrderDualRow">
                      <span>{t("fields.estimatedLiqPrice")}</span>
                      <strong>
                        <span className="tradeOrderValueLong">{fmt(estimatedLiquidation.long, 1)}</span>
                        <span className="tradeOrderValueSlash"> / </span>
                        <span className="tradeOrderValueShort">{fmt(estimatedLiquidation.short, 1)}</span>
                      </strong>
                    </div>
                  ) : null}
                </div>

                {!isSpotMode ? (
                  <>
                    <label className="tradeOrderCheckRow">
                      <input
                        type="checkbox"
                        checked={tpSlEnabled}
                        onChange={(event) => setTpSlEnabled(event.target.checked)}
                      />
                      <span>{t("fields.tpSl")}</span>
                    </label>

                    {tpSlEnabled ? (
                      <div className="tradeOrderTpSlGrid">
                        <label className="tradeOrderField">
                          <span>{t("fields.takeProfit")}</span>
                          <input
                            className="tradeOrderInput"
                            value={takeProfitPrice}
                            onChange={(event) => setTakeProfitPrice(event.target.value)}
                            placeholder="optional"
                          />
                        </label>
                        <label className="tradeOrderField">
                          <span>{t("fields.stopLoss")}</span>
                          <input
                            className="tradeOrderInput"
                            value={stopLossPrice}
                            onChange={(event) => setStopLossPrice(event.target.value)}
                            placeholder="optional"
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div className="tradeOrderMetaRow">
                  <span>{t("fields.timeInForce")}</span>
                  <strong>{orderType === "limit" ? "GTC" : "IOC"}</strong>
                </div>

                {activePrefill ? (
                  <div className="tradeOrderMetaRow">
                    <span>{t("fields.prefilledSide")}</span>
                    <strong>{activePrefill.side ? activePrefill.side.toUpperCase() : t("fields.manualSelectionRequired")}</strong>
                  </div>
                ) : null}

                {!isSpotMode ? (
                  <div className="tradeOrderActionGrid">
                    <button
                      className="btn btnStart"
                      style={activePrefill?.side === "long" ? { boxShadow: "0 0 0 2px rgba(16,185,129,.45) inset" } : undefined}
                      disabled={isSubmitting || tradingDataBlocked}
	                      onClick={() => void submitOrder("long")}
	                      type="button"
	                    >
	                      <AppIcon name="play" />
	                      {isSubmitting
                        ? t("actions.submitting")
                        : entryMode === "open"
                          ? t("actions.openLong")
                          : t("actions.closeShort")}
                      {activePrefill?.side === "long" ? ` (${t("actions.suggested")})` : ""}
                    </button>
                    <button
                      className="btn btnStop"
                      style={activePrefill?.side === "short" ? { boxShadow: "0 0 0 2px rgba(239,68,68,.45) inset" } : undefined}
                      disabled={isSubmitting || tradingDataBlocked}
	                      onClick={() => void submitOrder("short")}
	                      type="button"
	                    >
	                      <AppIcon name="play" />
	                      {isSubmitting
                        ? t("actions.submitting")
                        : entryMode === "open"
                          ? t("actions.openShort")
                          : t("actions.closeLong")}
                      {activePrefill?.side === "short" ? ` (${t("actions.suggested")})` : ""}
                    </button>
                  </div>
                ) : (
                  <div className="tradeOrderActionGrid tradeOrderActionGridSingle">
                    <button
                      className={`btn ${spotOrderSide === "buy" ? "btnStart" : "btnStop"}`}
                      disabled={tradingDataBlocked || isSubmitting || (spotOrderSide === "sell" && (!spotBaseAvailable || spotBaseAvailable <= 0))}
	                      onClick={() => void submitOrder(spotOrderSide)}
	                      type="button"
	                    >
	                      <AppIcon name={spotOrderSide === "buy" ? "deposit" : "withdraw"} />
	                      {isSubmitting
                        ? t("actions.submitting")
                        : spotOrderSide === "buy"
                          ? t("actions.buy")
                          : t("actions.sell")}
                    </button>
                  </div>
                )}
                {actionError ? (
                  <div className="tradeOrderInlineNotice tradeOrderInlineNoticeError">
                    <strong>{t("alerts.actionFailed")}:</strong> {actionError}
                  </div>
                ) : null}
                {actionSuccess ? (
                  <div className="tradeOrderInlineNotice tradeOrderInlineNoticeSuccess">
                    <strong>{t("alerts.actionSuccess")}:</strong> {actionSuccess}
                  </div>
                ) : null}

                <div className="tradeOrderMetaRow">
                  <span>{t("fields.max")}</span>
                  <strong>{estimatedMaxInputByMode ? `${fmt(estimatedMaxInputByMode, 4)} ${qtyDisplayUnit}` : "-"}</strong>
                </div>

                <button
                  className="btn"
                  disabled={tradingDataBlocked || isCancelAllPending}
	                  onClick={() => void cancelAll()}
	                  type="button"
	                >
	                  <AppIcon name="cancel" />
	                  {isCancelAllPending ? t("actions.cancelling") : t("actions.cancelAll")} ({selectedSymbol})
	                </button>

                <div className="tradeOrderDivider" />

                <div className="tradeOrderInfoTitle">{t("fields.account")}</div>
                <div className="tradeOrderInfoGrid">
                  <div className="tradeOrderInfoRow">
                    <span>{isSpotMode ? t("fields.available") : t("fields.margin")}</span>
                    <strong>
                      {isSpotMode
                        ? `${fmt(effectiveAvailableAmount, 8)} ${availableDisplayUnit}`
                        : fmt(summary?.availableMargin, 3)}
                    </strong>
                  </div>
                  <div className="tradeOrderInfoRow"><span>{t("fields.equity")}</span><strong>{fmt(summary?.equity, 3)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>{t("fields.last")}</span><strong>{fmt(ticker?.last, 4)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>{t("fields.mark")}</span><strong>{fmt(ticker?.mark, 4)}</strong></div>
                  <div className="tradeOrderInfoRow"><span>{t("fields.bidAsk")}</span><strong>{fmt(ticker?.bid, 4)} / {fmt(ticker?.ask, 4)}</strong></div>
                  {summary?.hyperliquidReadAddress ? (
                    <div className="tradeOrderInfoRow">
                      <span>{t("fields.hyperliquidReadAddress")}</span>
                      <strong>{shortAddress(summary.hyperliquidReadAddress)}</strong>
                    </div>
                  ) : null}
                  {summary?.hyperliquidSigningAddress ? (
                    <div className="tradeOrderInfoRow">
                      <span>{t("fields.hyperliquidSigningAddress")}</span>
                      <strong>{shortAddress(summary.hyperliquidSigningAddress)}</strong>
                    </div>
                  ) : null}
                </div>

                <div className="tradeOrderSelectedAccount">
                  {selectedAccount ? `${selectedAccount.exchange.toUpperCase()} - ${selectedAccount.label}` : "-"}
                </div>
                {summary?.hyperliquidReadAddress ? (
                  <div className="tradeDeskSectionHint" style={{ marginTop: 8 }}>
                    {summary.hyperliquidReadAddressSource === "account_or_vault"
                      ? t("messages.hyperliquidReadAddressAccountVault", { address: shortAddress(summary.hyperliquidReadAddress) })
                      : t("messages.hyperliquidReadAddressWallet", { address: shortAddress(summary.hyperliquidReadAddress) })}
                  </div>
                ) : null}
              </div>
            </article>
          </section>

          <section className="card tradeDeskSection tradeCopilot" aria-labelledby="position-copilot-title">
            <div className="tradeDeskSectionHeader tradeCopilotHeader">
              <div>
                <div className="tradeDeskSectionTitle" id="position-copilot-title">
                  {t("copilot.title")}
                  <span className="tradeCopilotReadOnly"><AppIcon name="risk" /> {t("copilot.readOnly")}</span>
                </div>
                <div className="tradeDeskSectionHint">{t("copilot.hint")}</div>
              </div>
              <div className="tradeCopilotActions">
                <button
                  className="btn"
                  type="button"
                  disabled={!copilotPosition || copilotLoading}
                  onClick={() => void analyzeWithPositionCopilot("manual")}
                >
                  <AppIcon name="refresh" />
                  {copilotLoading ? t("copilot.analyzing") : t("copilot.refresh")}
                </button>
                <Link
                  className="btn"
                  href={POSITION_COPILOT_MANUAL_REVIEW_HREF}
                  onClick={() => {
                    if (!selectedAccount || !copilotPosition) return;
                    window.sessionStorage.setItem(
                      POSITION_COPILOT_AGENT_CHAT_PREFILL_KEY,
                      JSON.stringify(buildPositionCopilotAgentChatPrefill({
                        exchangeAccountId: selectedAccount.id,
                        symbol: copilotPosition.symbol,
                        marketType: isSpotMode ? "spot" : "perp"
                      }))
                    );
                  }}
                >
                  <AppIcon name="ai" />
                  {t("copilot.deepAnalyze")}
                </Link>
              </div>
            </div>

            <div className="tradeCopilotSettings" aria-label={t("copilot.settingsLabel")}>
              <label>
                <span>{t("copilot.notificationMode")}</span>
                <select
                  className="select"
                  value={copilotSettings?.mode ?? "important_changes"}
                  disabled={!copilotSettings || copilotSettingsSaving}
                  onChange={(event) => void updateCopilotSettings({ mode: event.target.value as PositionCopilotMode })}
                >
                  <option value="critical_only">{t("copilot.modes.criticalOnly")}</option>
                  <option value="important_changes">{t("copilot.modes.importantChanges")}</option>
                  <option value="periodic_summary">{t("copilot.modes.periodicSummary")}</option>
                  <option value="off">{t("copilot.modes.off")}</option>
                </select>
              </label>
              <label className="tradeCopilotToggle">
                <input
                  type="checkbox"
                  checked={copilotSettings?.inAppEnabled ?? true}
                  disabled={!copilotSettings || copilotSettingsSaving}
                  onChange={(event) => void updateCopilotSettings({ inAppEnabled: event.target.checked })}
                />
                {t("copilot.inApp")}
              </label>
              <label className="tradeCopilotToggle">
                <input
                  type="checkbox"
                  checked={copilotSettings?.telegramEnabled ?? false}
                  disabled={!copilotSettings || copilotSettingsSaving}
                  onChange={(event) => void updateCopilotSettings({ telegramEnabled: event.target.checked })}
                />
                {t("copilot.telegram")}
              </label>
            </div>

            {copilotError ? <div className="tradeCopilotError">{t("copilot.error", { error: copilotError })}</div> : null}
            {!copilotPosition ? (
              <div className="tradeCopilotEmpty">{t("copilot.empty")}</div>
            ) : copilotAnalysis ? (
              <div className="tradeCopilotBody">
                <div className="tradeCopilotSummary">
                  <div className="tradeCopilotMeta">
                    <span className={`tradeCopilotRisk tradeCopilotRisk-${copilotAnalysis.riskLevel}`}>
                      {t(`copilot.risk.${copilotAnalysis.riskLevel}`)}
                    </span>
                    <span>{t("copilot.thesis", { status: t(`copilot.thesisStatus.${copilotAnalysis.thesisStatus}`) })}</span>
                    <span className={copilotAnalysis.dataQuality.state === "degraded" ? "tradeCopilotQualityDegraded" : ""}>
                      {t("copilot.dataQuality", { state: t(`copilot.quality.${copilotAnalysis.dataQuality.state}`) })}
                    </span>
                    {copilotAnalysis.openedByPredictionCopier ? <span>{t("copilot.openedByCopier")}</span> : null}
                  </div>
                  <p>{copilotAnalysis.summary}</p>
                </div>
                <div className="tradeCopilotFindings">
                  <div>
                    <strong>{t("copilot.riskFactors")}</strong>
                    {copilotAnalysis.riskFactors.length > 0 ? (
                      <ul>{copilotAnalysis.riskFactors.map((finding) => <li key={`${finding.code}:${finding.message}`}>{finding.message}</li>)}</ul>
                    ) : <p>{t("copilot.noRiskFactors")}</p>}
                  </div>
                  <div>
                    <strong>{t("copilot.events")}</strong>
                    {copilotAnalysis.events.length > 0 ? (
                      <ul>{copilotAnalysis.events.map((event) => <li key={`${event.code}:${event.message}`}>{event.message}</li>)}</ul>
                    ) : <p>{t("copilot.noEvents")}</p>}
                  </div>
                </div>
                <div className="tradeCopilotFootnote">{t("copilot.noExecution")}</div>
              </div>
            ) : (
              <div className="tradeCopilotEmpty">{t("copilot.ready", { symbol: copilotPosition.symbol })}</div>
            )}
          </section>

            <section className="card tradeDeskSection" id="trade-positions">
            <div className="tradeDeskSectionHeader">
              <div>
                <div className="tradeDeskSectionTitle">{t("sections.positions")}</div>
                <div className="tradeDeskSectionHint">{t("positions.hint")}</div>
              </div>
            </div>

            <div className="tradeDesktopOnly">
              <div className="tradeTableWrap">
                <table className="tradeDataTable">
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.symbol")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.side")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.size")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.entry")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.mark")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.leverage")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.notional")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.margin")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.roe")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.pnlPct")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.liquidation")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.liqDistance")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.stopLoss")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.takeProfit")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.pnl")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("positions.columns.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={16} style={{ padding: 10, color: "var(--muted)" }}>{t("positions.empty")}</td>
                      </tr>
                    ) : (
                      positions.map((position, index) => {
                        const rowKey = getPositionRowKey(position, index);
                        return (
                          <tr
                            key={rowKey}
                            style={{
                              borderTop: "1px solid rgba(255,255,255,.06)",
                              background:
                                selectedPositionKey === rowKey
                                  ? "rgba(56,189,248,0.08)"
                                  : "transparent",
                              cursor: "pointer"
                            }}
                            onClick={() => selectPositionForChart(position, rowKey)}
                          >
                            <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{position.symbol}</td>
                            <td style={{ padding: "8px 6px", color: position.side === "long" ? "#34d399" : "#f87171" }}>{position.side.toUpperCase()}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.size, 6)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.entryPrice, 4)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.markPrice, 4)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmtLeverage(position.leverage)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.notionalUsd, 2)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.marginUsd, 2)}</td>
                            <td style={{ padding: "8px 6px", color: (position.roePct ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{fmtPct(position.roePct, 2)}</td>
                            <td style={{ padding: "8px 6px", color: (position.pnlPct ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{fmtPct(position.pnlPct, 2)}</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(position.liquidationPrice, 4)}</td>
                            <td style={{ padding: "8px 6px", color: (position.liquidationDistancePct ?? 0) > 0 ? "inherit" : "#f87171" }}>{fmtPct(position.liquidationDistancePct, 2)}</td>
                            <td style={{ padding: "8px 6px" }}>
                              {isSpotMode ? (
                                "-"
                              ) : positionEditDrafts[rowKey] ? (
                                <input
                                  className="input tradeTableInput"
                                  value={positionEditDrafts[rowKey]?.sl ?? ""}
                                  onChange={(event) =>
                                    setPositionEditDrafts((prev) => ({
                                      ...prev,
                                      [rowKey]: {
                                        ...(prev[rowKey] ?? { tp: "", sl: "" }),
                                        sl: event.target.value
                                      }
                                    }))
                                  }
                                />
                              ) : (
                                fmt(position.stopLossPrice, 4)
                              )}
                            </td>
                            <td style={{ padding: "8px 6px" }}>
                              {isSpotMode ? (
                                "-"
                              ) : positionEditDrafts[rowKey] ? (
                                <input
                                  className="input tradeTableInput"
                                  value={positionEditDrafts[rowKey]?.tp ?? ""}
                                  onChange={(event) =>
                                    setPositionEditDrafts((prev) => ({
                                      ...prev,
                                      [rowKey]: {
                                        ...(prev[rowKey] ?? { tp: "", sl: "" }),
                                        tp: event.target.value
                                      }
                                    }))
                                  }
                                />
                              ) : (
                                fmt(position.takeProfitPrice, 4)
                              )}
                            </td>
                            <td style={{ padding: "8px 6px", color: (position.unrealizedPnl ?? 0) >= 0 ? "#34d399" : "#f87171" }}>
                              {fmt(position.unrealizedPnl, 2)}
                            </td>
                            <td style={{ padding: "8px 6px" }}>
                              {isSpotMode ? (
                                <div className="tradeRowActions">
                                  <button
                                    className="btn"
                                    disabled={tradingDataBlocked || closePendingKey !== null}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void closePosition(position);
                                    }}
                                  >
                                    {closePendingKey ? t("actions.closing") : t("actions.close")}
                                  </button>
                                </div>
                              ) : positionEditDrafts[rowKey] ? (
                                <div className="tradeRowActions">
                                  <button
                                    className="btn"
                                    disabled={positionSavingKey === rowKey}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void savePositionTpSl(position, rowKey);
                                    }}
                                  >
                                    {t("actions.save")}
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPositionEditDrafts((prev) => {
                                        const next = { ...prev };
                                        delete next[rowKey];
                                        return next;
                                      });
                                    }}
                                  >
                                    {t("actions.cancel")}
                                  </button>
                                </div>
                              ) : (
                                <div className="tradeRowActions">
                                  <button
                                    className="btn"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPositionEditDrafts((prev) => ({
                                        ...prev,
                                        [rowKey]: {
                                          tp:
                                            position.takeProfitPrice !== null &&
                                            Number.isFinite(position.takeProfitPrice)
                                              ? String(position.takeProfitPrice)
                                              : "",
                                          sl:
                                            position.stopLossPrice !== null &&
                                            Number.isFinite(position.stopLossPrice)
                                              ? String(position.stopLossPrice)
                                              : ""
                                        }
                                      }));
                                    }}
                                  >
                                    {t("actions.edit")}
                                  </button>
                                  <button
                                    className="btn"
                                    disabled={tradingDataBlocked || closePendingKey !== null}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void closePosition(position);
                                    }}
                                  >
                                    {closePendingKey ? t("actions.closing") : t("actions.close")}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tradeMobileOnly">
              {positions.length === 0 ? (
                <div className="tradeMobileEmpty">{t("positions.empty")}</div>
              ) : (
                <div className="tradeMobileList">
                  {positions.map((position, index) => {
                    const rowKey = getPositionRowKey(position, index);
                    const draft = positionEditDrafts[rowKey];
                    const isSelected = selectedPositionKey === rowKey;
                    const sideToneClass =
                      position.side === "long" ? "tradeMobileCardSideLong" : "tradeMobileCardSideShort";
                    return (
                      <article
                        key={`position_mobile_${rowKey}`}
                        className={`tradeMobileCard ${sideToneClass} ${isSelected ? "tradeMobileCardSelected" : ""}`}
                        onClick={() => selectPositionForChart(position, rowKey)}
                      >
                        <div className="tradeMobileHead">
                          <div className="tradeMobileHeadLeft">
                            <div className="tradeMobileTitle">{position.symbol}</div>
                            <span
                              className={`tradeMobileChip ${position.side === "long" ? "tradeMobileChipLong" : "tradeMobileChipShort"}`}
                            >
                              {position.side.toUpperCase()}
                            </span>
                          </div>
                          <div
                            className="tradeMobilePnl"
                            style={{ color: (position.unrealizedPnl ?? 0) >= 0 ? "#34d399" : "#f87171" }}
                          >
                            {fmt(position.unrealizedPnl, 2)}
                          </div>
                        </div>
                        <div className="tradeMobileRows">
                          <div className="tradeMobileRow"><span>{t("positions.columns.symbol")}</span><strong>{position.symbol}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.size")}</span><strong>{fmt(position.size, 6)}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.entry")}</span><strong>{fmt(position.entryPrice, 4)}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.mark")}</span><strong>{fmt(position.markPrice, 4)}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.leverage")}</span><strong>{fmtLeverage(position.leverage)}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.notional")}</span><strong>{fmt(position.notionalUsd, 2)}</strong></div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.margin")}</span><strong>{fmt(position.marginUsd, 2)}</strong></div>
                          <div className="tradeMobileRow">
                            <span>{t("positions.columns.roe")}</span>
                            <strong style={{ color: (position.roePct ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{fmtPct(position.roePct, 2)}</strong>
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("positions.columns.pnlPct")}</span>
                            <strong style={{ color: (position.pnlPct ?? 0) >= 0 ? "#34d399" : "#f87171" }}>{fmtPct(position.pnlPct, 2)}</strong>
                          </div>
                          <div className="tradeMobileRow"><span>{t("positions.columns.liquidation")}</span><strong>{fmt(position.liquidationPrice, 4)}</strong></div>
                          <div className="tradeMobileRow">
                            <span>{t("positions.columns.liqDistance")}</span>
                            <strong style={{ color: (position.liquidationDistancePct ?? 0) > 0 ? "inherit" : "#f87171" }}>{fmtPct(position.liquidationDistancePct, 2)}</strong>
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("positions.columns.stopLoss")}</span>
                            {draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.sl ?? ""}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) =>
                                  setPositionEditDrafts((prev) => ({
                                    ...prev,
                                    [rowKey]: { ...(prev[rowKey] ?? { tp: "", sl: "" }), sl: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(position.stopLossPrice, 4)}</strong>
                            )}
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("positions.columns.takeProfit")}</span>
                            {draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.tp ?? ""}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) =>
                                  setPositionEditDrafts((prev) => ({
                                    ...prev,
                                    [rowKey]: { ...(prev[rowKey] ?? { tp: "", sl: "" }), tp: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(position.takeProfitPrice, 4)}</strong>
                            )}
                          </div>
                        </div>
                        <div className="tradeMobileActions" onClick={(event) => event.stopPropagation()}>
                          {draft ? (
                            <>
                              {!isSpotMode ? (
                                <>
                                  <button
                                    className="btn"
                                    disabled={positionSavingKey === rowKey}
                                    onClick={() => void savePositionTpSl(position, rowKey)}
                                  >
                                    {t("actions.save")}
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={() =>
                                      setPositionEditDrafts((prev) => {
                                        const next = { ...prev };
                                        delete next[rowKey];
                                        return next;
                                      })
                                    }
                                  >
                                    {t("actions.cancel")}
                                  </button>
                                </>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {!isSpotMode ? (
                                <button
                                  className="btn"
                                  onClick={() =>
                                    setPositionEditDrafts((prev) => ({
                                      ...prev,
                                      [rowKey]: {
                                        tp:
                                          position.takeProfitPrice !== null &&
                                          Number.isFinite(position.takeProfitPrice)
                                            ? String(position.takeProfitPrice)
                                            : "",
                                        sl:
                                          position.stopLossPrice !== null &&
                                          Number.isFinite(position.stopLossPrice)
                                            ? String(position.stopLossPrice)
                                            : ""
                                      }
                                    }))
                                  }
                                >
                                  {t("actions.edit")}
                                </button>
                              ) : null}
                              <button
                                className="btn"
                                disabled={tradingDataBlocked || closePendingKey !== null}
                                onClick={() => void closePosition(position)}
                              >
                                {closePendingKey ? t("actions.closing") : t("actions.close")}
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            </section>

          <section className="card tradeDeskSection">
            <div className="tradeDeskSectionHeader">
              <div>
                <div className="tradeDeskSectionTitle">{t("sections.openOrders")}</div>
                <div className="tradeDeskSectionHint">{t("orders.hint")}</div>
              </div>
              <button
                className="btn"
                disabled={tradingDataBlocked || isCancelAllPending}
                onClick={() => void cancelAll()}
              >
                {isCancelAllPending ? t("actions.cancelling") : t("actions.cancelAll")}
              </button>
            </div>

            <div className="tradeDesktopOnly">
              <div className="tradeTableWrap">
                <table className="tradeDataTable">
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.symbol")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.orderId")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.side")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.type")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.limitPrice")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.stopLoss")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.takeProfit")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.qty")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.status")}</th>
                      <th style={{ padding: "8px 6px" }}>{t("orders.columns.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: 10, color: "var(--muted)" }}>{t("orders.empty")}</td>
                      </tr>
                    ) : (
                      openOrders.map((order) => (
                        <tr key={order.orderId} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                          <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{order.symbol}</td>
                          <td style={{ padding: "8px 6px" }}>{order.orderId.slice(0, 12)}...</td>
                          <td style={{ padding: "8px 6px" }}>{order.side ?? "-"}</td>
                          <td style={{ padding: "8px 6px" }}>{order.type ?? "-"}</td>
                          <td style={{ padding: "8px 6px" }}>
                            {orderEditDrafts[order.orderId] ? (
                              <input
                                className="input tradeTableInput"
                                value={orderEditDrafts[order.orderId]?.price ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: {
                                      ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }),
                                      price: event.target.value
                                    }
                                  }))
                                }
                              />
                            ) : (
                              fmt(order.price, 4)
                            )}
                          </td>
                          <td style={{ padding: "8px 6px" }}>
                            {isSpotMode ? (
                              "-"
                            ) : orderEditDrafts[order.orderId] ? (
                              <input
                                className="input tradeTableInput"
                                value={orderEditDrafts[order.orderId]?.sl ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: {
                                      ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }),
                                      sl: event.target.value
                                    }
                                  }))
                                }
                              />
                            ) : (
                              fmt(order.stopLossPrice, 4)
                            )}
                          </td>
                          <td style={{ padding: "8px 6px" }}>
                            {isSpotMode ? (
                              "-"
                            ) : orderEditDrafts[order.orderId] ? (
                              <input
                                className="input tradeTableInput"
                                value={orderEditDrafts[order.orderId]?.tp ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: {
                                      ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }),
                                      tp: event.target.value
                                    }
                                  }))
                                }
                              />
                            ) : (
                              fmt(order.takeProfitPrice, 4)
                            )}
                          </td>
                          <td style={{ padding: "8px 6px" }}>
                            {orderEditDrafts[order.orderId] ? (
                              <input
                                className="input tradeTableInput"
                                value={orderEditDrafts[order.orderId]?.qty ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: {
                                      ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }),
                                      qty: event.target.value
                                    }
                                  }))
                                }
                              />
                            ) : (
                              fmt(order.qty, 6)
                            )}
                          </td>
                          <td style={{ padding: "8px 6px" }}>{order.status ?? "-"}</td>
                          <td style={{ padding: "8px 6px" }}>
                            {orderEditDrafts[order.orderId] ? (
                              <div className="tradeRowActions">
                                <button
                                  className="btn"
                                  disabled={orderSavingId === order.orderId}
                                  onClick={() => void saveOrderEdit(order)}
                                >
                                  {t("actions.save")}
                                </button>
                                <button
                                  className="btn"
                                  onClick={() =>
                                    setOrderEditDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[order.orderId];
                                      return next;
                                    })
                                  }
                                >
                                  {t("actions.cancel")}
                                </button>
                              </div>
                            ) : (
                              <div className="tradeRowActions">
                                <button
                                  className="btn"
                                  onClick={() =>
                                    setOrderEditDrafts((prev) => ({
                                      ...prev,
                                      [order.orderId]: {
                                        price: order.price !== null && Number.isFinite(order.price) ? String(order.price) : "",
                                        qty: order.qty !== null && Number.isFinite(order.qty) ? String(order.qty) : "",
                                        tp: !isSpotMode &&
                                          order.takeProfitPrice !== null && Number.isFinite(order.takeProfitPrice)
                                            ? String(order.takeProfitPrice)
                                            : "",
                                        sl: !isSpotMode &&
                                          order.stopLossPrice !== null && Number.isFinite(order.stopLossPrice)
                                            ? String(order.stopLossPrice)
                                            : ""
                                      }
                                    }))
                                  }
                                >
                                  {t("actions.edit")}
                                </button>
                                <button
                                  className="btn"
                                  disabled={tradingDataBlocked}
                                  onClick={() => void cancelOrder(order.orderId)}
                                >
                                  {t("actions.cancel")}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tradeMobileOnly">
              {openOrders.length === 0 ? (
                <div className="tradeMobileEmpty">{t("orders.empty")}</div>
              ) : (
                <div className="tradeMobileList">
                  {openOrders.map((order) => {
                    const draft = orderEditDrafts[order.orderId];
                    const sideRaw = String(order.side ?? "").toLowerCase();
                    const statusRaw = String(order.status ?? "").toLowerCase();
                    const sideToneClass = sideRaw.includes("sell") || sideRaw.includes("short")
                      ? "tradeMobileCardSideShort"
                      : sideRaw.includes("buy") || sideRaw.includes("long")
                        ? "tradeMobileCardSideLong"
                        : "tradeMobileCardSideNeutral";
                    const sideChipClass = sideToneClass === "tradeMobileCardSideLong"
                      ? "tradeMobileChipLong"
                      : sideToneClass === "tradeMobileCardSideShort"
                        ? "tradeMobileChipShort"
                        : "tradeMobileChipNeutral";
                    const statusChipClass = statusRaw.includes("open") || statusRaw.includes("new")
                      ? "tradeMobileChipStatusOpen"
                      : statusRaw.includes("fill") || statusRaw.includes("done")
                        ? "tradeMobileChipStatusFilled"
                        : statusRaw.includes("cancel") || statusRaw.includes("reject")
                          ? "tradeMobileChipStatusCancelled"
                          : "tradeMobileChipStatusOther";
                    return (
                      <article key={`order_mobile_${order.orderId}`} className={`tradeMobileCard ${sideToneClass}`}>
                        <div className="tradeMobileHead">
                          <div className="tradeMobileHeadLeft">
                            <div className="tradeMobileTitle">{order.symbol}</div>
                            <span className={`tradeMobileChip ${sideChipClass}`}>{order.side ?? "-"}</span>
                          </div>
                          <div className="tradeMobileHeadRight">
                            <span className={`tradeMobileChip ${statusChipClass}`}>{order.status ?? "-"}</span>
                          </div>
                        </div>
                        <div className="tradeMobileRows">
                          <div className="tradeMobileRow"><span>{t("orders.columns.orderId")}</span><strong>{order.orderId.slice(0, 12)}...</strong></div>
                          <div className="tradeMobileRow"><span>{t("orders.columns.type")}</span><strong>{order.type ?? "-"}</strong></div>
                          <div className="tradeMobileRow">
                            <span>{t("orders.columns.limitPrice")}</span>
                            {draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.price ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: { ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }), price: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(order.price, 4)}</strong>
                            )}
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("orders.columns.stopLoss")}</span>
                            {isSpotMode ? (
                              <strong>-</strong>
                            ) : draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.sl ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: { ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }), sl: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(order.stopLossPrice, 4)}</strong>
                            )}
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("orders.columns.takeProfit")}</span>
                            {isSpotMode ? (
                              <strong>-</strong>
                            ) : draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.tp ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: { ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }), tp: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(order.takeProfitPrice, 4)}</strong>
                            )}
                          </div>
                          <div className="tradeMobileRow">
                            <span>{t("orders.columns.qty")}</span>
                            {draft ? (
                              <input
                                className="input tradeMobileInlineInput"
                                value={draft.qty ?? ""}
                                onChange={(event) =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                    [order.orderId]: { ...(prev[order.orderId] ?? { price: "", qty: "", tp: "", sl: "" }), qty: event.target.value }
                                  }))
                                }
                              />
                            ) : (
                              <strong>{fmt(order.qty, 6)}</strong>
                            )}
                          </div>
                        </div>
                        <div className="tradeMobileActions">
                          {draft ? (
                            <>
                              <button className="btn" disabled={orderSavingId === order.orderId} onClick={() => void saveOrderEdit(order)}>
                                {t("actions.save")}
                              </button>
                              <button
                                className="btn"
                                onClick={() =>
                                  setOrderEditDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[order.orderId];
                                    return next;
                                  })
                                }
                              >
                                {t("actions.cancel")}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn"
                                onClick={() =>
                                  setOrderEditDrafts((prev) => ({
                                    ...prev,
                                [order.orderId]: {
                                  price: order.price !== null && Number.isFinite(order.price) ? String(order.price) : "",
                                  qty: order.qty !== null && Number.isFinite(order.qty) ? String(order.qty) : "",
                                  tp: !isSpotMode &&
                                    order.takeProfitPrice !== null && Number.isFinite(order.takeProfitPrice)
                                      ? String(order.takeProfitPrice)
                                      : "",
                                  sl: !isSpotMode &&
                                    order.stopLossPrice !== null && Number.isFinite(order.stopLossPrice)
                                      ? String(order.stopLossPrice)
                                      : ""
                                }
                              }))
                            }
                              >
                                {t("actions.edit")}
                              </button>
                              <button
                                className="btn"
                                disabled={tradingDataBlocked}
                                onClick={() => void cancelOrder(order.orderId)}
                              >
                                {t("actions.cancel")}
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {isQtyModeModalOpen ? (
        <div className="tradeModalBackdrop" onClick={() => setIsQtyModeModalOpen(false)}>
          <div className="tradeModalCard" onClick={(event) => event.stopPropagation()}>
            <div className="tradeModalHeader">
              <h3>{t("qtyMode.title")}</h3>
              <button
                type="button"
                className="tradeModalCloseBtn"
	                onClick={() => setIsQtyModeModalOpen(false)}
	                aria-label={t("actions.close")}
	              >
	                <AppIcon name="close" />
	              </button>
            </div>

            <div className="tradeModalOptions">
              {QTY_INPUT_MODE_OPTIONS.map((option) => {
                const unit = option.unit === "BASE" ? baseAssetUnit : quoteAssetUnit;
                const isSelected = qtyInputModeDraft === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`tradeModalOption ${isSelected ? "tradeModalOptionActive" : ""}`}
                    onClick={() => setQtyInputModeDraft(option.value)}
                  >
                    <div className="tradeModalOptionTitle">
                      {t(`qtyMode.${option.titleKey}`)}-{unit}
                    </div>
                    <div className="tradeModalOptionDescription">{t(`qtyMode.${option.descriptionKey}`)}</div>
                  </button>
                );
              })}
            </div>

            <div className="tradeModalActions">
              <button
                type="button"
                className="tradeModalSecondaryBtn"
                onClick={() => setIsQtyModeModalOpen(false)}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="tradeModalPrimaryBtn"
                onClick={() => {
                  setQtyInputMode(qtyInputModeDraft);
                  setQtyPercent(0);
                  setQty("");
                  setIsQtyModeModalOpen(false);
                }}
              >
                {t("actions.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TradePage() {
  const t = useTranslations("system.trade");
  return (
    <Suspense fallback={<div>{t("loadingPage")}</div>}>
      <TradePageContent />
    </Suspense>
  );
}
