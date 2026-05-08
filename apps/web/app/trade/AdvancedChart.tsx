"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, getApiBaseUrl } from "../../lib/api";
import {
  rememberAdvancedRealtimeTrade,
  createAdvancedRealtimeBar,
  isSaneAdvancedChartBar,
  normalizeAdvancedChartTimestampMs,
  reconcilePolledBarWithLiveBar,
  toAdvancedChartPrice
} from "../../src/trade/advancedChartBars";
import type {
  Bar,
  IBasicDataFeed,
  ChartingLibraryWidgetOptions,
  DatafeedConfiguration,
  EntityId,
  HistoryCallback,
  IChartingLibraryWidget,
  LibrarySymbolInfo,
  OnReadyCallback,
  PeriodParams,
  ResolutionString,
  SearchSymbolsCallback,
  SearchSymbolResultItem,
  SubscribeBarsCallback
} from "../../public/static/charting_library/charting_library";
import { DEFAULT_INDICATOR_TOGGLES, type IndicatorToggleState, type TradeChartProps } from "./chartTypes";

type CandleApiItem = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type CandlesResponse = {
  exchangeAccountId: string;
  exchange: string;
  symbol: string;
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  granularity: string;
  items: CandleApiItem[];
};

type PredictionListItem = {
  id: string;
  accountId: string | null;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  tsCreated: string;
  signal: "up" | "down" | "neutral";
  confidence: number;
};

type TickerState = {
  symbol: string;
  last: number | null;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  ts: number | null;
};

type WsTrade = {
  symbol: string;
  price: number | null;
  qty: number | null;
  side: string | null;
  ts: number | null;
};

type WsEnvelope = {
  type: string;
  symbol?: string;
  data?: unknown;
  message?: string;
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

type AdvancedChartProps = TradeChartProps & {
  onRuntimeFallback?: (reason: string) => void;
};

type TradingViewGlobal = {
  widget: new (options: ChartingLibraryWidgetOptions) => IChartingLibraryWidget;
};

declare global {
  interface Window {
    TradingView?: TradingViewGlobal;
  }
}

const CHART_CANDLE_FETCH_LIMIT = 1000;
const ADVANCED_CHART_SUBSCRIBE_POLL_MS = 10000;
const ADVANCED_CHART_CANDLES_POLL_MS = 5000;
const ADVANCED_CHART_MARKERS_POLL_MS = 15000;
const MIN_CHART_HEIGHT = 280;
const MAX_CHART_HEIGHT = 900;
const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "240", "1D"] as ResolutionString[];
const DATAFEED_CONFIGURATION: DatafeedConfiguration = {
  supported_resolutions: SUPPORTED_RESOLUTIONS,
  exchanges: [{ value: "", name: "All Exchanges", desc: "" }],
  symbols_types: [{ value: "crypto", name: "Crypto" }],
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true
};

let tradingViewScriptPromise: Promise<TradingViewGlobal> | null = null;

const ADVANCED_SUPPORTED_INDICATOR_KEYS = [
  "ema5",
  "ema13",
  "ema50",
  "ema200",
  "ema800",
  "vwapSession",
  "volumeOverlay"
] as const satisfies ReadonlyArray<keyof IndicatorToggleState>;

type AdvancedSupportedIndicatorKey = (typeof ADVANCED_SUPPORTED_INDICATOR_KEYS)[number];

type AdvancedStudyDefinition = {
  key: AdvancedSupportedIndicatorKey;
  name: string;
  forceOverlay?: boolean;
  inputs?: Record<string, string | number | boolean>;
};

const ADVANCED_STUDY_DEFINITIONS: AdvancedStudyDefinition[] = [
  { key: "ema5", name: "Moving Average Exponential", forceOverlay: true, inputs: { length: 5 } },
  { key: "ema13", name: "Moving Average Exponential", forceOverlay: true, inputs: { length: 13 } },
  { key: "ema50", name: "Moving Average Exponential", forceOverlay: true, inputs: { length: 50 } },
  { key: "ema200", name: "Moving Average Exponential", forceOverlay: true, inputs: { length: 200 } },
  { key: "ema800", name: "Moving Average Exponential", forceOverlay: true, inputs: { length: 800 } },
  { key: "vwapSession", name: "VWAP", forceOverlay: true },
  { key: "volumeOverlay", name: "Volume", forceOverlay: true }
];

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function toWsBase(url: string): string {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}

function normalizeCandles(items: CandleApiItem[]): Array<CandleApiItem & { ts: number }> {
  return items
    .filter((row): row is CandleApiItem & { ts: number } => row.ts !== null && Number.isFinite(row.ts))
    .slice()
    .sort((a, b) => a.ts - b.ts);
}

function deskTimeframeToResolution(timeframe: string): ResolutionString {
  switch (timeframe) {
    case "1m": return "1" as ResolutionString;
    case "5m": return "5" as ResolutionString;
    case "15m": return "15" as ResolutionString;
    case "1h": return "60" as ResolutionString;
    case "4h": return "240" as ResolutionString;
    case "1d": return "1D" as ResolutionString;
    default: return "15" as ResolutionString;
  }
}

function timeframeToBucketMs(timeframe: string): number {
  switch (timeframe) {
    case "1m": return 60_000;
    case "5m": return 5 * 60_000;
    case "15m": return 15 * 60_000;
    case "1h": return 60 * 60_000;
    case "4h": return 4 * 60 * 60_000;
    case "1d": return 24 * 60 * 60_000;
    default: return 15 * 60_000;
  }
}

function resolutionToDeskTimeframe(resolution: string, fallback: string): "1m" | "5m" | "15m" | "1h" | "4h" | "1d" {
  switch (resolution) {
    case "1":
    case "1m":
      return "1m";
    case "5":
    case "5m":
      return "5m";
    case "15":
    case "15m":
      return "15m";
    case "60":
    case "1h":
      return "1h";
    case "240":
    case "4h":
      return "4h";
    case "D":
    case "1D":
    case "1d":
      return "1d";
    default:
      return resolutionToDeskTimeframe(deskTimeframeToResolution(fallback), "15m");
  }
}

function timeframeToSeconds(timeframe: string): number {
  switch (timeframe) {
    case "1m": return 60;
    case "5m": return 300;
    case "15m": return 900;
    case "1h": return 3600;
    case "4h": return 14400;
    case "1d": return 86400;
    default: return 900;
  }
}

function toBar(row: CandleApiItem & { ts: number }): Bar {
  return {
    time: row.ts,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? undefined
  };
}

function computeFetchLimit(periodParams: PeriodParams, timeframe: string): number {
  const exact = Number(periodParams.countBack);
  if (Number.isFinite(exact) && exact > 0) {
    return Math.max(20, Math.min(CHART_CANDLE_FETCH_LIMIT, Math.ceil(exact) + 16));
  }

  const spanSeconds = Math.max(0, Number(periodParams.to) - Number(periodParams.from));
  const tfSeconds = timeframeToSeconds(timeframe);
  const estimated = tfSeconds > 0 ? Math.ceil(spanSeconds / tfSeconds) + 16 : 400;
  return Math.max(20, Math.min(CHART_CANDLE_FETCH_LIMIT, estimated));
}

function scaleForTickSize(value: number | null | undefined): number {
  const tick = Number(value);
  if (!Number.isFinite(tick) || tick <= 0) return 100;
  if (Number.isInteger(tick)) return 1;

  const text = tick.toString().toLowerCase();
  if (text.includes("e-")) {
    const exponent = Number(text.split("e-")[1]);
    if (Number.isFinite(exponent)) return 10 ** exponent;
  }

  const decimals = text.split(".")[1]?.length ?? 0;
  return 10 ** Math.min(8, decimals);
}

async function loadTradingViewScript(): Promise<TradingViewGlobal> {
  if (window.TradingView?.widget) return window.TradingView;
  if (tradingViewScriptPromise) return tradingViewScriptPromise;

  tradingViewScriptPromise = new Promise<TradingViewGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tv-charting-library="true"]');
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.TradingView?.widget) {
          resolve(window.TradingView);
          return;
        }
        reject(new Error("TradingView script loaded without widget constructor"));
      }, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load TradingView script")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "/static/charting_library/charting_library.standalone.js";
    script.async = true;
    script.dataset.tvChartingLibrary = "true";
    script.onload = () => {
      if (window.TradingView?.widget) {
        resolve(window.TradingView);
        return;
      }
      reject(new Error("TradingView script loaded without widget constructor"));
    };
    script.onerror = () => reject(new Error("Failed to load TradingView script"));
    document.head.appendChild(script);
  }).catch((error) => {
    tradingViewScriptPromise = null;
    throw error;
  });

  return tradingViewScriptPromise;
}

function buildAdvancedDatafeed(params: {
  exchangeAccountId: string;
  marketType: "spot" | "perp";
  getSelectedSymbol: () => string;
  getSelectedTimeframe: () => string;
}): IBasicDataFeed {
  const wsBase = toWsBase(getApiBaseUrl());
  const subscribers = new Map<string, {
    timer: ReturnType<typeof setInterval>;
    socket: WebSocket | null;
    lastBarJson: string | null;
    lastBar: Bar | null;
    historyKey: string;
    seenTradeKeys: Map<string, number>;
    tradeWatermarkMs: number | null;
  }>();
  const historySeedBars = new Map<string, Bar>();
  let symbolsPromise: Promise<SymbolItem[]> | null = null;

  const historyKeyFor = (symbolName: string, timeframe: string): string => (
    `${symbolName.trim().toUpperCase()}::${timeframe}`
  );

  const fetchSymbols = async (): Promise<SymbolItem[]> => {
    if (!symbolsPromise) {
      symbolsPromise = apiGet<{
        exchangeAccountId: string;
        items: SymbolItem[];
        defaultSymbol: string | null;
      }>(
        `/api/symbols?exchangeAccountId=${encodeURIComponent(params.exchangeAccountId)}&marketType=${encodeURIComponent(params.marketType)}`
      ).then((payload) => payload.items ?? []);
    }
    return symbolsPromise;
  };

  const resolveSymbolMeta = async (symbolName: string): Promise<SymbolItem | null> => {
    const items = await fetchSymbols();
    const normalized = symbolName.trim().toUpperCase();
    return items.find((item) => item.symbol.trim().toUpperCase() === normalized) ?? null;
  };

  const buildSymbolInfo = (item: SymbolItem | null, symbolName: string): LibrarySymbolInfo => {
    const name = symbolName.trim().toUpperCase();
    const info: LibrarySymbolInfo = {
      ticker: name,
      name,
      description: name,
      type: "crypto",
      session: "24x7",
      timezone: "Etc/UTC",
      exchange: "Crypto",
      listed_exchange: "Crypto",
      minmov: 1,
      pricescale: scaleForTickSize(item?.tickSize),
      format: "price",
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: false,
      intraday_multipliers: ["1", "5", "15", "60", "240"],
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      volume_precision: 8,
      data_status: "streaming",
      visible_plots_set: "ohlcv"
    };
    return info;
  };

  const fetchBars = async (
    symbolName: string,
    timeframe: string,
    limit: number
  ): Promise<Bar[]> => {
    const payload = await apiGet<CandlesResponse>(
      `/api/market/candles?exchangeAccountId=${encodeURIComponent(params.exchangeAccountId)}&symbol=${encodeURIComponent(symbolName)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}&marketType=${encodeURIComponent(params.marketType)}`
    );
    return normalizeCandles(payload.items ?? [])
      .map(toBar)
      .filter((bar): bar is Bar => isSaneAdvancedChartBar(bar));
  };

  const applyRealtimeBarUpdate = (
    listenerGuid: string,
    timeframe: string,
    price: number,
    ts: number,
    qty?: number | null
  ): Bar | null => {
    const normalizedTs = normalizeAdvancedChartTimestampMs(ts);
    const safePrice = toAdvancedChartPrice(price);
    if (safePrice === null || !Number.isFinite(normalizedTs)) return null;
    const subscriber = subscribers.get(listenerGuid);
    if (!subscriber) return null;
    const bucketMs = timeframeToBucketMs(timeframe);
    const bucketStartMs = Math.floor(normalizedTs / bucketMs) * bucketMs;
    const lastBar = subscriber.lastBar;

    if (!lastBar || bucketStartMs > lastBar.time) {
      const nextBar: Bar = createAdvancedRealtimeBar({
        bucketStartMs,
        price: safePrice,
        qty,
        previousBar: lastBar
      });
      subscriber.lastBar = nextBar;
      subscriber.lastBarJson = JSON.stringify(nextBar);
      historySeedBars.set(subscriber.historyKey, nextBar);
      return nextBar;
    }

    if (bucketStartMs < lastBar.time) return null;

    const nextBar: Bar = {
      ...lastBar,
      high: Math.max(lastBar.high, safePrice),
      low: Math.min(lastBar.low, safePrice),
      close: safePrice,
      volume: Math.max(0, Number(lastBar.volume ?? 0)) + Math.max(0, Number(qty ?? 0))
    };
    subscriber.lastBar = nextBar;
    subscriber.lastBarJson = JSON.stringify(nextBar);
    historySeedBars.set(subscriber.historyKey, nextBar);
    return nextBar;
  };

  return {
    onReady(callback: OnReadyCallback): void {
      window.setTimeout(() => callback(DATAFEED_CONFIGURATION), 0);
    },
    searchSymbols(userInput: string, _exchange: string, _symbolType: string, onResult: SearchSymbolsCallback): void {
      if (!userInput.trim()) {
        onResult([]);
        return;
      }
      void fetchSymbols()
        .then((items) => {
          const normalizedQuery = userInput.trim().toUpperCase();
          const filtered = normalizedQuery
            ? items.filter((item) => item.symbol.toUpperCase().includes(normalizedQuery))
            : items;
          const out: SearchSymbolResultItem[] = filtered.slice(0, 50).map((item) => ({
            symbol: item.symbol,
            full_name: item.symbol,
            description:
              item.baseAsset && item.quoteAsset
                ? `${item.baseAsset}/${item.quoteAsset}`
                : item.status || item.symbol,
            exchange: "Crypto",
            ticker: item.symbol,
            type: "crypto"
          }));
          onResult(out);
        })
        .catch(() => onResult([]));
    },
    resolveSymbol(symbolName, onResolve, onError): void {
      const normalizedSymbolName = symbolName.trim().toUpperCase();
      const normalizedSelectedSymbol = params.getSelectedSymbol().trim().toUpperCase();
      if (normalizedSymbolName === normalizedSelectedSymbol) {
        window.setTimeout(() => onResolve(buildSymbolInfo(null, symbolName)), 0);
        return;
      }
      void resolveSymbolMeta(symbolName)
        .then((item) => onResolve(buildSymbolInfo(item, symbolName)))
        .catch((error) => onError(`resolveSymbol failed: ${errMsg(error)}`));
    },
    getBars(symbolInfo, resolution, periodParams, onResult: HistoryCallback, onError): void {
      const timeframe = resolutionToDeskTimeframe(resolution as string, params.getSelectedTimeframe());
      const limit = computeFetchLimit(periodParams, timeframe);
      const symbolName = symbolInfo.ticker ?? symbolInfo.name ?? params.getSelectedSymbol();

      void fetchBars(symbolName, timeframe, limit)
        .then((bars) => {
          const fromMs = Number(periodParams.from) * 1000;
          const toMs = Number(periodParams.to) * 1000;
          const ranged = bars.filter((bar) => bar.time >= fromMs && bar.time < toMs);
          const result = ranged.length > 0
            ? ranged
            : bars.slice(-Math.max(1, periodParams.countBack || 300));
          const latestSeedBar = result[result.length - 1] ?? bars[bars.length - 1] ?? null;
          const historyKey = historyKeyFor(symbolName, timeframe);
          if (latestSeedBar) {
            historySeedBars.set(historyKey, latestSeedBar);
          } else {
            historySeedBars.delete(historyKey);
          }
          onResult(result, { noData: result.length === 0 });
        })
        .catch(() => onResult([], { noData: true }));
    },
    subscribeBars(symbolInfo, resolution, onTick: SubscribeBarsCallback, listenerGuid, onResetCacheNeededCallback): void {
      const timeframe = resolutionToDeskTimeframe(resolution as string, params.getSelectedTimeframe());
      const symbolName = symbolInfo.ticker ?? symbolInfo.name ?? params.getSelectedSymbol();
      const normalizedSymbol = symbolName.trim().toUpperCase();
      const historyKey = historyKeyFor(symbolName, timeframe);
      const pushLatestBar = async () => {
        try {
          const bars = await fetchBars(symbolName, timeframe, 3);
          const latest = bars[bars.length - 1];
          if (!latest) return;
          const subscriber = subscribers.get(listenerGuid);
          if (!subscriber) return;
          const reconciled = reconcilePolledBarWithLiveBar({
            currentBar: subscriber.lastBar,
            fetchedBar: latest
          });
          if (!reconciled) return;
          const nextJson = JSON.stringify(reconciled);
          if (nextJson === subscriber.lastBarJson) return;
          subscriber.lastBar = reconciled;
          subscriber.lastBarJson = nextJson;
          historySeedBars.set(subscriber.historyKey, reconciled);
          onTick(reconciled);
        } catch {
          // Ignore transient polling failures. The chart keeps its last bar.
        }
      };

      const handleRealtimeTrade = (trade: WsTrade) => {
        const price = toAdvancedChartPrice(trade.price);
        const ts = Number(trade.ts);
        if (price === null || !Number.isFinite(ts)) return;
        const subscriber = subscribers.get(listenerGuid);
        if (!subscriber) return;
        if (!rememberAdvancedRealtimeTrade(subscriber.seenTradeKeys, trade)) return;
        const nextBar = applyRealtimeBarUpdate(listenerGuid, timeframe, price, ts, trade.qty);
        if (nextBar) onTick(nextBar);
      };

      const handleRealtimeTrades = (trades: WsTrade[]) => {
        const subscriber = subscribers.get(listenerGuid);
        if (!subscriber || trades.length === 0) return;

        let maxTradeTsMs = subscriber.tradeWatermarkMs;
        const sortedTrades = [...trades]
          .filter((trade) => Number.isFinite(Number(trade?.ts)) && toAdvancedChartPrice(trade?.price) !== null)
          .sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));

        if (subscriber.tradeWatermarkMs === null) {
          for (const trade of sortedTrades) {
            const normalizedTs = normalizeAdvancedChartTimestampMs(Number(trade.ts));
            if (!Number.isFinite(normalizedTs)) continue;
            rememberAdvancedRealtimeTrade(subscriber.seenTradeKeys, trade);
            maxTradeTsMs = Math.max(maxTradeTsMs ?? normalizedTs, normalizedTs);
          }
          subscriber.tradeWatermarkMs = maxTradeTsMs;
          return;
        }

        for (const trade of sortedTrades) {
          const normalizedTs = normalizeAdvancedChartTimestampMs(Number(trade.ts));
          if (!Number.isFinite(normalizedTs)) continue;
          maxTradeTsMs = Math.max(maxTradeTsMs ?? normalizedTs, normalizedTs);
          if (normalizedTs < subscriber.tradeWatermarkMs) continue;
          handleRealtimeTrade(trade);
        }

        subscriber.tradeWatermarkMs = maxTradeTsMs;
      };

      const handleRealtimeTicker = (ticker: TickerState) => {
        const bid = toAdvancedChartPrice(ticker.bid);
        const ask = toAdvancedChartPrice(ticker.ask);
        const midpoint = bid !== null && ask !== null ? (bid + ask) / 2 : null;
        const price = toAdvancedChartPrice(ticker.last) ?? toAdvancedChartPrice(ticker.mark) ?? midpoint;
        const ts = Number(ticker.ts ?? Date.now());
        if (price === null || !Number.isFinite(ts)) return;
        const nextBar = applyRealtimeBarUpdate(listenerGuid, timeframe, price, ts);
        if (nextBar) onTick(nextBar);
      };

      const timer = setInterval(() => {
        void pushLatestBar();
      }, ADVANCED_CHART_SUBSCRIBE_POLL_MS);
      const seededBar = historySeedBars.get(historyKey) ?? null;
      subscribers.set(listenerGuid, {
        timer,
        socket: null,
        lastBarJson: seededBar ? JSON.stringify(seededBar) : null,
        lastBar: seededBar,
        historyKey,
        seenTradeKeys: new Map<string, number>(),
        tradeWatermarkMs: null
      });

      let socket: WebSocket | null = null;
      try {
        socket = new WebSocket(
          `${wsBase}/ws/market?exchangeAccountId=${encodeURIComponent(params.exchangeAccountId)}&symbol=${encodeURIComponent(symbolName)}&marketType=${encodeURIComponent(params.marketType)}`
        );
        socket.onmessage = (event) => {
          let payload: WsEnvelope | null = null;
          try {
            payload = JSON.parse(event.data) as WsEnvelope;
          } catch {
            return;
          }
          if (!payload) return;
          const payloadSymbol = String(payload.symbol ?? "").trim().toUpperCase();
          if (payloadSymbol && payloadSymbol !== normalizedSymbol) return;

          if ((payload.type === "trades" || payload.type === "snapshot:trades") && Array.isArray(payload.data)) {
            handleRealtimeTrades(payload.data as WsTrade[]);
            return;
          }

          if ((payload.type === "ticker" || payload.type === "snapshot:ticker") && payload.data && typeof payload.data === "object") {
            handleRealtimeTicker(payload.data as TickerState);
          }
        };
        const subscriber = subscribers.get(listenerGuid);
        if (subscriber) subscriber.socket = socket;
      } catch {
        socket = null;
      }
      void pushLatestBar();
    },
    unsubscribeBars(listenerGuid): void {
      const subscriber = subscribers.get(listenerGuid);
      if (!subscriber) return;
      clearInterval(subscriber.timer);
      subscriber.socket?.close();
      subscribers.delete(listenerGuid);
    }
  };
}

export function AdvancedChart({
  exchangeAccountId,
  symbol,
  timeframe,
  marketType,
  prefill,
  chartPreferences,
  onChartPreferencesChange,
  selectedPosition,
  onRuntimeFallback
}: AdvancedChartProps) {
  const t = useTranslations("system.trade.chart");
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const widgetReadyRef = useRef(false);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef("");
  const indicatorTogglesRef = useRef<IndicatorToggleState>({
    ...DEFAULT_INDICATOR_TOGGLES,
    ...(chartPreferences?.indicatorToggles ?? {})
  });
  const studiesRef = useRef<Partial<Record<AdvancedSupportedIndicatorKey, EntityId>>>({});
  const managedShapeIdsRef = useRef<EntityId[]>([]);
  const syncStudiesRef = useRef<(() => Promise<void>) | null>(null);
  const syncRequestRef = useRef(0);
  const serializedPrefsRef = useRef("");
  const lastPersistedHeightRef = useRef<number>(chartPreferences?.chartHeight ?? 520);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(t("status.loadingCandles"));
  const normalizedTimeframe = resolutionToDeskTimeframe(deskTimeframeToResolution(timeframe), "15m");
  const loadingCandlesMessage = t("status.loadingCandles");
  const readyAdvancedMessage = t("status.readyAdvanced");
  const [rawCandles, setRawCandles] = useState<CandleApiItem[]>([]);
  const [showUpMarkers, setShowUpMarkers] = useState(Boolean(chartPreferences?.showUpMarkers));
  const [showDownMarkers, setShowDownMarkers] = useState(Boolean(chartPreferences?.showDownMarkers));
  const [predictionMarkers, setPredictionMarkers] = useState<PredictionListItem[]>([]);
  const [indicatorToggles, setIndicatorToggles] = useState<IndicatorToggleState>({
    ...DEFAULT_INDICATOR_TOGGLES,
    ...(chartPreferences?.indicatorToggles ?? {})
  });
  const [chartHeight, setChartHeight] = useState(
    Math.max(MIN_CHART_HEIGHT, Math.min(MAX_CHART_HEIGHT, Math.round(chartPreferences?.chartHeight ?? 520)))
  );

  symbolRef.current = symbol;
  timeframeRef.current = normalizedTimeframe;
  indicatorTogglesRef.current = indicatorToggles;

  useEffect(() => {
    const nextToggles: IndicatorToggleState = {
      ...DEFAULT_INDICATOR_TOGGLES,
      ...(chartPreferences?.indicatorToggles ?? {})
    };
    const nextChartHeight = Math.max(
      MIN_CHART_HEIGHT,
      Math.min(MAX_CHART_HEIGHT, Math.round(chartPreferences?.chartHeight ?? 520))
    );
    setIndicatorToggles(nextToggles);
    setShowUpMarkers(Boolean(chartPreferences?.showUpMarkers));
    setShowDownMarkers(Boolean(chartPreferences?.showDownMarkers));
    lastPersistedHeightRef.current = nextChartHeight;
    setChartHeight(nextChartHeight);
    serializedPrefsRef.current = JSON.stringify({
      indicatorToggles: nextToggles,
      showUpMarkers: Boolean(chartPreferences?.showUpMarkers),
      showDownMarkers: Boolean(chartPreferences?.showDownMarkers),
      chartHeight: nextChartHeight
    });
  }, [chartPreferences]);

  useEffect(() => {
    const serialized = JSON.stringify({
      indicatorToggles,
      showUpMarkers,
      showDownMarkers,
      chartHeight
    });
    if (serialized === serializedPrefsRef.current) return;
    serializedPrefsRef.current = serialized;
    onChartPreferencesChange?.({
      indicatorToggles,
      showUpMarkers,
      showDownMarkers,
      chartHeight
    });
  }, [chartHeight, indicatorToggles, onChartPreferencesChange, showDownMarkers, showUpMarkers]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextHeight = Math.max(
        MIN_CHART_HEIGHT,
        Math.min(MAX_CHART_HEIGHT, Math.round(entry?.contentRect.height ?? container.clientHeight))
      );
      if (Math.abs(nextHeight - lastPersistedHeightRef.current) < 2) return;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        lastPersistedHeightRef.current = nextHeight;
        setChartHeight(nextHeight);
      });
    });

    resizeObserver.observe(container);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let widget: IChartingLibraryWidget | null = null;
    widgetReadyRef.current = false;

    const syncStudies = async () => {
      const currentWidget = widgetRef.current;
      if (!currentWidget || !widgetReadyRef.current || disposed) return;
      const requestId = ++syncRequestRef.current;
      const chart = currentWidget.activeChart();

      for (const key of ADVANCED_SUPPORTED_INDICATOR_KEYS) {
        const existing = studiesRef.current[key];
        if (!existing) continue;
        try {
          chart.removeEntity(existing);
        } catch {
          // Ignore stale study handles.
        }
        delete studiesRef.current[key];
      }

      for (const def of ADVANCED_STUDY_DEFINITIONS) {
        if (!indicatorTogglesRef.current[def.key]) continue;
        try {
          const entityId = await chart.createStudy(def.name, Boolean(def.forceOverlay), false, def.inputs);
          if (disposed || requestId !== syncRequestRef.current) {
            if (entityId) {
              try {
                chart.removeEntity(entityId);
              } catch {
                // Ignore cleanup failures during racing updates.
              }
            }
            return;
          }
          if (entityId) {
            studiesRef.current[def.key] = entityId;
          }
        } catch {
          // Keep the chart usable even if a specific built-in study fails.
        }
      }
    };

    syncStudiesRef.current = syncStudies;

    const init = async () => {
      try {
        const TradingView = await loadTradingViewScript();
        if (disposed || !hostRef.current) return;

        const datafeed = buildAdvancedDatafeed({
          exchangeAccountId,
          marketType,
          getSelectedSymbol: () => symbolRef.current,
          getSelectedTimeframe: () => timeframeRef.current
        });

        const options: ChartingLibraryWidgetOptions & { addVolume?: boolean } = {
          container: hostRef.current,
          library_path: "/static/charting_library/",
          datafeed,
          addVolume: false,
          symbol,
          interval: deskTimeframeToResolution(normalizedTimeframe),
          autosize: true,
          locale: locale === "de" ? "de" : "en",
          timezone: "Etc/UTC",
          theme: "dark",
          fullscreen: false,
          header_widget_buttons_mode: "fullsize",
          disabled_features: [
            "control_bar",
            "display_market_status",
            "create_volume_indicator_by_default",
            "create_volume_indicator_by_default_once"
          ] as ChartingLibraryWidgetOptions["enabled_features"],
          loading_screen: {
            backgroundColor: "#07101f",
            foregroundColor: "#38bdf8"
          },
          overrides: {
            "paneProperties.backgroundType": "solid",
            "paneProperties.background": "#07101f",
            "paneProperties.vertGridProperties.color": "rgba(148,163,184,0.08)",
            "paneProperties.horzGridProperties.color": "rgba(148,163,184,0.08)",
            "scalesProperties.textColor": "#c7d2e2",
            "mainSeriesProperties.candleStyle.upColor": "#22c55e",
            "mainSeriesProperties.candleStyle.downColor": "#ef4444",
            "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
            "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
            "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444"
          } as ChartingLibraryWidgetOptions["overrides"]
        };

        widget = new TradingView.widget(options);
        widgetRef.current = widget;
        setFatalError(null);
        widget.onChartReady(() => {
          if (disposed) return;
          widgetReadyRef.current = true;
          setStatusMessage(readyAdvancedMessage);
          void syncStudies();
        });
      } catch (error) {
        if (disposed) return;
        const message = errMsg(error);
        setFatalError(message);
        setStatusMessage(t("status.chartError", { error: message }));
        onRuntimeFallback?.(message);
      }
    };

    void init();

    return () => {
      disposed = true;
      widgetReadyRef.current = false;
      syncRequestRef.current += 1;
      studiesRef.current = {};
      managedShapeIdsRef.current = [];
      syncStudiesRef.current = null;
      widget?.remove();
      widgetRef.current = null;
    };
  }, [exchangeAccountId, locale, marketType, onRuntimeFallback, readyAdvancedMessage]);

  useEffect(() => {
    void syncStudiesRef.current?.();
  }, [indicatorToggles]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !widgetReadyRef.current) return;

    setStatusMessage(loadingCandlesMessage);
    widget.setSymbol(symbol, deskTimeframeToResolution(normalizedTimeframe), () => {
      setStatusMessage(readyAdvancedMessage);
    });
  }, [loadingCandlesMessage, normalizedTimeframe, readyAdvancedMessage, symbol]);

  useEffect(() => {
    if (!exchangeAccountId || !symbol) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchCandles = async () => {
      try {
        const payload = await apiGet<CandlesResponse>(
          `/api/market/candles?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(normalizedTimeframe)}&limit=${CHART_CANDLE_FETCH_LIMIT}&marketType=${encodeURIComponent(marketType)}`
        );
        if (!active) return;
        setRawCandles(payload.items ?? []);
      } catch {
        if (!active) return;
        setRawCandles([]);
      }
    };

    void fetchCandles();
    timer = setInterval(() => {
      void fetchCandles();
    }, ADVANCED_CHART_CANDLES_POLL_MS);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [exchangeAccountId, marketType, normalizedTimeframe, symbol]);

  useEffect(() => {
    if (!exchangeAccountId || !symbol) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchMarkers = async () => {
      try {
        const payload = await apiGet<{ items: PredictionListItem[] }>("/api/predictions?limit=200&mode=history");
        if (!active) return;
        const filtered = (payload.items ?? []).filter(
          (row) =>
            row.symbol?.toUpperCase() === symbol.toUpperCase() &&
            row.timeframe === normalizedTimeframe &&
            row.signal !== "neutral" &&
            ((row.signal === "up" && showUpMarkers) || (row.signal === "down" && showDownMarkers)) &&
            (!!row.accountId ? row.accountId === exchangeAccountId : true)
        );
        setPredictionMarkers(filtered);
      } catch {
        if (!active) return;
        setPredictionMarkers([]);
      }
    };

    void fetchMarkers();
    timer = setInterval(() => {
      void fetchMarkers();
    }, ADVANCED_CHART_MARKERS_POLL_MS);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      setPredictionMarkers([]);
    };
  }, [exchangeAccountId, normalizedTimeframe, showDownMarkers, showUpMarkers, symbol]);

  useEffect(() => {
    if (!widgetReadyRef.current || !widgetRef.current) return;
    let active = true;

    const buildHorizontalLine = async (
      price: number,
      color: string,
      text: string,
      lineStyle: number,
      lineWidth: number,
      anchorTimeSec: number,
      chart: ReturnType<IChartingLibraryWidget["activeChart"]>,
      output: EntityId[]
    ) => {
      if (!Number.isFinite(price)) return;
      try {
        const entityId = await chart.createShape(
          { time: anchorTimeSec, price },
          {
            shape: "horizontal_line",
            text,
            lock: true,
            disableSave: true,
            disableSelection: true,
            disableUndo: true,
            overrides: {
              "linetoolhorzline.linecolor": color,
              "linetoolhorzline.textcolor": color,
              "linetoolhorzline.linestyle": lineStyle,
              "linetoolhorzline.linewidth": lineWidth,
              "linetoolhorzline.showPrice": true
            }
          }
        );
        if (active) output.push(entityId);
      } catch {
        // Ignore drawing failures for optional overlays.
      }
    };

    const buildTextMarker = async (
      timeSec: number,
      price: number,
      text: string,
      color: string,
      chart: ReturnType<IChartingLibraryWidget["activeChart"]>,
      output: EntityId[]
    ) => {
      if (!Number.isFinite(timeSec) || !Number.isFinite(price) || !text) return;
      try {
        const entityId = await chart.createShape(
          { time: timeSec, price },
          {
            shape: "text",
            text,
            lock: true,
            disableSave: true,
            disableSelection: true,
            disableUndo: true,
            overrides: {
              "linetooltext.color": color,
              "linetooltext.borderColor": color,
              "linetooltext.drawBorder": true,
              "linetooltext.fillBackground": true,
              "linetooltext.backgroundColor": "#07101f",
              "linetooltext.backgroundTransparency": 15,
              "linetooltext.fontsize": 11
            }
          }
        );
        if (active) output.push(entityId);
      } catch {
        // Ignore optional text marker failures.
      }
    };

    const syncShapes = async () => {
      const widget = widgetRef.current;
      if (!widget) return;
      const chart = widget.activeChart();

      for (const entityId of managedShapeIdsRef.current) {
        try {
          chart.removeEntity(entityId);
        } catch {
          // Ignore stale drawing handles.
        }
      }
      managedShapeIdsRef.current = [];

      const normalized = normalizeCandles(rawCandles);
      const latest = normalized[normalized.length - 1] ?? null;
      if (!latest) return;

      const output: EntityId[] = [];
      const anchorTimeSec = Math.floor(latest.ts / 1000);
      const selectedPositionLabel = selectedPosition
        ? `${selectedPosition.symbol} ${selectedPosition.side.toUpperCase()}`
        : "";
      const selectedPositionLineText = (label: string) =>
        selectedPositionLabel ? `${selectedPositionLabel} ${label}` : label;

      await buildHorizontalLine(Number(prefill?.suggestedTakeProfit), "#22c55e", "TP", 2, 1, anchorTimeSec, chart, output);
      await buildHorizontalLine(Number(prefill?.suggestedStopLoss), "#ef4444", "SL", 2, 1, anchorTimeSec, chart, output);
      await buildHorizontalLine(Number(selectedPosition?.entryPrice), "#e2e8f0", selectedPositionLineText(t("position.entry")), 0, 2, anchorTimeSec, chart, output);
      await buildHorizontalLine(Number(selectedPosition?.markPrice), "#f59e0b", selectedPositionLineText(t("position.mark")), 1, 1, anchorTimeSec, chart, output);
      await buildHorizontalLine(Number(selectedPosition?.takeProfitPrice), "#22c55e", selectedPositionLineText(t("position.tp")), 2, 1, anchorTimeSec, chart, output);
      await buildHorizontalLine(Number(selectedPosition?.stopLossPrice), "#ef4444", selectedPositionLineText(t("position.sl")), 2, 1, anchorTimeSec, chart, output);

      const candleByTimeSec = new Map<number, CandleApiItem & { ts: number }>();
      for (const candle of normalized) {
        candleByTimeSec.set(Math.floor(candle.ts / 1000), candle);
      }
      for (const row of predictionMarkers) {
        const ts = Math.floor(new Date(row.tsCreated).getTime() / 1000);
        if (!Number.isFinite(ts)) continue;
        const exact = candleByTimeSec.get(ts) ?? normalized.find((candle) => Math.floor(candle.ts / 1000) >= ts) ?? latest;
        const price = row.signal === "up" ? exact.low * 0.9975 : exact.high * 1.0025;
        const color = row.signal === "up" ? "#22c55e" : "#ef4444";
        const text = `${row.signal === "up" ? "UP" : "DOWN"} ${Number.isFinite(row.confidence) ? `${row.confidence.toFixed(0)}%` : ""}`.trim();
        await buildTextMarker(ts, price, text, color, chart, output);
      }

      if (active) {
        managedShapeIdsRef.current = output;
      } else {
        for (const entityId of output) {
          try {
            chart.removeEntity(entityId);
          } catch {
            // Ignore cleanup failures while unmounting.
          }
        }
      }
    };

    void syncShapes();

    return () => {
      active = false;
    };
  }, [predictionMarkers, prefill, rawCandles, selectedPosition, t]);

  return (
    <div>
      <div
        ref={chartContainerRef}
        style={{
          position: "relative",
          width: "100%",
          height: `${chartHeight}px`,
          minHeight: MIN_CHART_HEIGHT,
          maxHeight: MAX_CHART_HEIGHT,
          resize: "vertical",
          overflow: "hidden"
        }}
      >
        <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      </div>
      <div
        className="tradeChartMeta"
        style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
      >
        <span>{t("engineAdvanced")}</span>
        <span>{fatalError ? t("status.autoFallback") : statusMessage}</span>
      </div>
    </div>
  );
}
