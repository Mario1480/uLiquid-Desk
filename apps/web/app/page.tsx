"use client";

import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAccount } from "wagmi";
import ExchangeAccountOverviewCard, {
type ExchangeAccountOverview
} from "./components/ExchangeAccountOverviewCard";
import AlertsFeed, { type DashboardAlert } from "../components/dashboard/AlertsFeed";
import DashboardWalletCard from "../components/dashboard/DashboardWalletCard";
import DashboardWidgetFrame from "../components/dashboard/DashboardWidgetFrame";
import type { GridInstance } from "../components/grid/types";
import {
  computeGridRuntimeMarkPrice,
  computeGridUnrealizedPnl,
  deriveUnrealizedPnlFromSnapshot,
  readGridPositionValue
} from "../components/grid/utils";
import type { DashboardTotals } from "../components/dashboard/TotalsBar";
import { ApiError, apiGet, apiPut } from "../lib/api";
import { withLocalePath, type AppLocale } from "../i18n/config";
import {
  DASHBOARD_LAYOUT_COLUMNS,
  DASHBOARD_LAYOUT_GAP,
  DASHBOARD_WIDGET_REGISTRY,
  DASHBOARD_LAYOUT_ROW_HEIGHT,
  getDefaultDashboardLayout,
  normalizeDashboardLayout,
  repackDashboardLayoutItems,
  type DashboardLayoutItem,
  type DashboardLayoutResponse,
  type DashboardWidgetId
} from "../src/dashboard/layout";
import {
  DEFAULT_ACCESS_SECTION_VISIBILITY,
  type AccessSectionVisibility
} from "../src/access/accessSection";

type EconomicCalendarSummary = {
  id: string;
  sourceId: string;
  ts: string;
  country: string;
  currency: string;
  title: string;
  impact: "low" | "medium" | "high";
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  source: string;
};

type DashboardNewsItem = {
  id: string;
  feed: "crypto" | "general";
  title: string;
  url: string;
  publishedAt: string;
  symbol?: string | null;
};

type DashboardNewsResponse = {
  items: DashboardNewsItem[];
};

type DashboardOverviewResponse = {
  accounts: ExchangeAccountOverview[];
  totals: DashboardTotals;
};

type DashboardAlertsResponse = {
  items: DashboardAlert[];
};

type DashboardBotOverviewItem = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  status: "running" | "stopped" | "error" | string;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  runtime?: {
    updatedAt?: string | null;
    reason?: string | null;
    lastError?: string | null;
    mid?: number | null;
    bid?: number | null;
    ask?: number | null;
  } | null;
  botVault?: {
    allocatedUsd?: number | null;
    availableUsd?: number | null;
    status?: string | null;
  } | null;
  trade?: {
    openSide?: string | null;
    openQty?: number | null;
    openEntryPrice?: number | null;
    openPnlUsd?: number | null;
    realizedPnlTotalUsd?: number | null;
    lastTradeTs?: string | null;
  } | null;
  stoppedWhy?: string | null;
};

type PerformanceRange = "24h" | "7d" | "30d";

type DashboardPerformancePoint = {
  ts: string;
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  includedAccounts: number;
};

type DashboardPerformanceResponse = {
  range: PerformanceRange;
  exchangeAccountId: string | null;
  bucketSeconds: number;
  points: DashboardPerformancePoint[];
};

type DashboardPerformanceChartPoint = {
  ts: number;
  totalEquity: number;
};

type DashboardRiskAnalysisTrigger = "dailyLoss" | "margin" | "insufficientData";
type DashboardRiskAnalysisSeverity = "critical" | "warning" | "ok";

type DashboardRiskAnalysisItem = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  severity: DashboardRiskAnalysisSeverity;
  triggers: DashboardRiskAnalysisTrigger[];
  riskScore: number;
  insufficientData: boolean;
  lossUsd: number;
  lossPct: number | null;
  marginPct: number | null;
  availableMarginUsd: number | null;
  pnlTodayUsd: number | null;
  lastSyncAt: string | null;
  runtimeUpdatedAt: string | null;
};

type DashboardRiskAnalysisResponse = {
  items: DashboardRiskAnalysisItem[];
  summary: {
    critical: number;
    warning: number;
    ok: number;
  };
  evaluatedAt: string;
};

type DashboardOpenPositionItem = {
  exchangeAccountId: string;
  exchange: string;
  exchangeLabel: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  unrealizedPnl: number | null;
};

type DashboardOpenPositionsExchange = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
};

type DashboardOpenPositionsMeta = {
  fetchedAt: string;
  partialErrors: number;
  failedExchangeAccountIds: string[];
};

type DashboardOpenPositionsResponse = {
  items: DashboardOpenPositionItem[];
  exchanges: DashboardOpenPositionsExchange[];
  meta: DashboardOpenPositionsMeta;
};

const PERFORMANCE_RANGES: PerformanceRange[] = ["24h", "7d", "30d"];
const DASHBOARD_EDIT_BREAKPOINT_PX = 960;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function resolveIntlLocale(locale: AppLocale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

function formatUsdt(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value))} USDT`;
}

function formatAmount(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value));
}

function formatSignedUsdt(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numeric)} USDT`;
}

function formatPct(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value))}%`;
}

function formatPerformanceAxisTick(ts: number, range: PerformanceRange, locale: AppLocale): string {
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return "—";
  if (range === "24h") {
    return date.toLocaleTimeString(resolveIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString(resolveIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit"
  });
}

function formatRelativeTimestamp(
  iso: string | null | undefined,
  locale: AppLocale,
  t: ReturnType<typeof useTranslations>
): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diffMs = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return t("widgetMeta.agoSeconds", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("widgetMeta.agoMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("widgetMeta.agoHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("widgetMeta.agoDays", { count: days });
  return new Date(ts).toLocaleString(resolveIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatCompactStatus(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "—";
  if (normalized === "running") return "Running";
  if (normalized === "stopped") return "Stopped";
  if (normalized === "paused") return "Paused";
  if (normalized === "created") return "Created";
  if (normalized === "archived") return "Archived";
  if (normalized === "error") return "Error";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function botStatusBadgeClass(status: string | null | undefined): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "running") return "badge badgeOk";
  if (normalized === "error") return "badge badgeDanger";
  return "badge badgeWarn";
}

function resolveBotWidgetInvestUsd(item: DashboardBotOverviewItem): number | null {
  const fromVault = Number(item.botVault?.allocatedUsd ?? NaN);
  if (Number.isFinite(fromVault) && fromVault > 0) return fromVault;
  return null;
}

function resolveBotWidgetPnlUsd(item: DashboardBotOverviewItem): number | null {
  const realized = Number(item.trade?.realizedPnlTotalUsd ?? NaN);
  const open = Number(item.trade?.openPnlUsd ?? NaN);
  const total = (Number.isFinite(realized) ? realized : 0) + (Number.isFinite(open) ? open : 0);
  if (!Number.isFinite(total)) return null;
  return Number(total.toFixed(4));
}

function resolveGridWidgetPnlUsd(instance: GridInstance): number | null {
  const metrics = (instance.metricsJson && typeof instance.metricsJson === "object" && !Array.isArray(instance.metricsJson))
    ? instance.metricsJson as Record<string, unknown>
    : {};
  const explicit = Number(metrics.totalPnlUsd ?? NaN);
  if (Number.isFinite(explicit)) return explicit;

  const snapshot = metrics.positionSnapshot;
  const derivedUnrealized = deriveUnrealizedPnlFromSnapshot(snapshot);
  const runtimeMark = computeGridRuntimeMarkPrice(instance.bot?.runtime ?? null);
  const fallbackUnrealized = derivedUnrealized
    ?? computeGridUnrealizedPnl({
      qty: Number(readGridPositionValue(snapshot as Record<string, unknown> | null, ["qty", "size", "szi"]) ?? NaN),
      entryPrice: Number(readGridPositionValue(snapshot as Record<string, unknown> | null, ["entryPrice", "entryPx", "avgEntryPrice"]) ?? NaN),
      markPrice: runtimeMark,
      side: String(readGridPositionValue(snapshot as Record<string, unknown> | null, ["side", "direction"]) ?? "").trim().toLowerCase()
    });
  const gridProfit = Number(metrics.gridProfitUsd ?? NaN);
  const total = (Number.isFinite(gridProfit) ? gridProfit : 0) + (Number.isFinite(fallbackUnrealized) ? fallbackUnrealized : 0);
  if (!Number.isFinite(total)) return null;
  return Number(total.toFixed(4));
}

function aggregateOverviewTotals(rows: ExchangeAccountOverview[]): DashboardTotals | null {
  if (!rows.length) return null;
  const reduced = rows.reduce<DashboardTotals>(
    (acc, row) => {
      const spotTotal = Number(row.spotBudget?.total ?? NaN);
      const futuresEquity = Number(row.futuresBudget?.equity ?? NaN);
      const availableMargin = Number(row.futuresBudget?.availableMargin ?? NaN);
      const pnlToday = Number(row.pnlTodayUsd ?? NaN);

      let contributes = false;

      if (Number.isFinite(spotTotal)) {
        acc.totalEquity += spotTotal;
        contributes = true;
      }
      if (Number.isFinite(futuresEquity)) {
        acc.totalEquity += futuresEquity;
        contributes = true;
      }
      if (Number.isFinite(availableMargin)) {
        acc.totalAvailableMargin += availableMargin;
        contributes = true;
      }
      if (Number.isFinite(pnlToday)) {
        acc.totalTodayPnl += pnlToday;
        contributes = true;
      }
      if (contributes) acc.includedAccounts += 1;
      return acc;
    },
    {
      totalEquity: 0,
      totalAvailableMargin: 0,
      totalTodayPnl: 0,
      currency: "USDT",
      includedAccounts: 0
    }
  );

  return {
    ...reduced,
    totalEquity: Number(reduced.totalEquity.toFixed(6)),
    totalAvailableMargin: Number(reduced.totalAvailableMargin.toFixed(6)),
    totalTodayPnl: Number(reduced.totalTodayPnl.toFixed(6))
  };
}

function DashboardSkeletonCard() {
  return (
    <article className="card exchangeOverviewCard exchangeOverviewSkeleton" aria-hidden>
      <div className="skeletonLine skeletonLineLg" />
      <div className="skeletonLine skeletonLineMd" />
      <div className="exchangeOverviewStats" style={{ marginTop: 10 }}>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
        <div className="exchangeOverviewStatBlock"><div className="skeletonLine skeletonLineSm" /><div className="skeletonLine skeletonLineMd" /></div>
      </div>
      <div className="exchangeOverviewActions" style={{ marginTop: 10 }}>
        <div className="skeletonButton" />
        <div className="skeletonButton" />
      </div>
    </article>
  );
}

export default function Page() {
  const t = useTranslations("dashboard");
  const locale = useLocale() as AppLocale;
  const { isConnected } = useAccount();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const overviewPollInFlightRef = useRef(false);
  const [overview, setOverview] = useState<ExchangeAccountOverview[]>([]);
  const [overviewTotals, setOverviewTotals] = useState<DashboardTotals | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [botsOverview, setBotsOverview] = useState<DashboardBotOverviewItem[]>([]);
  const [botsOverviewLoadError, setBotsOverviewLoadError] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<EconomicCalendarSummary[]>([]);
  const [calendarLoadError, setCalendarLoadError] = useState(false);
  const [gridBotsOverview, setGridBotsOverview] = useState<GridInstance[]>([]);
  const [gridBotsOverviewLoadError, setGridBotsOverviewLoadError] = useState(false);
  const [newsItems, setNewsItems] = useState<DashboardNewsItem[]>([]);
  const [newsLoadError, setNewsLoadError] = useState(false);
  const [performanceRange, setPerformanceRange] = useState<PerformanceRange>("24h");
  const [performanceExchangeFilter, setPerformanceExchangeFilter] = useState<string>("all");
  const [performancePoints, setPerformancePoints] = useState<DashboardPerformancePoint[]>([]);
  const [performanceLoadError, setPerformanceLoadError] = useState(false);
  const [riskItems, setRiskItems] = useState<DashboardRiskAnalysisItem[]>([]);
  const [riskSummary, setRiskSummary] = useState<DashboardRiskAnalysisResponse["summary"]>({
    critical: 0,
    warning: 0,
    ok: 0
  });
  const [riskLoadError, setRiskLoadError] = useState(false);
  const [openPositions, setOpenPositions] = useState<DashboardOpenPositionItem[]>([]);
  const [openPositionsExchanges, setOpenPositionsExchanges] = useState<DashboardOpenPositionsExchange[]>([]);
  const [openPositionsMeta, setOpenPositionsMeta] = useState<DashboardOpenPositionsMeta | null>(null);
  const [openPositionsLoadError, setOpenPositionsLoadError] = useState(false);
  const [openPositionsExchangeFilter, setOpenPositionsExchangeFilter] = useState<string>("all");
  const [accessVisibility, setAccessVisibility] = useState<AccessSectionVisibility>(
    DEFAULT_ACCESS_SECTION_VISIBILITY
  );
  const [savedLayout, setSavedLayout] = useState<DashboardLayoutResponse | null>(null);
  const [draftLayout, setDraftLayout] = useState<DashboardLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [canEditLayout, setCanEditLayout] = useState(false);
  const [addWidgetMenuOpen, setAddWidgetMenuOpen] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [resizeState, setResizeState] = useState<{
    id: DashboardWidgetId;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    containerWidth: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load(options?: { background?: boolean }) {
      const isBackground = options?.background === true;
      const today = new Date().toISOString().slice(0, 10);
      if (isBackground) {
        if (typeof document !== "undefined" && document.hidden) return;
        if (overviewPollInFlightRef.current) return;
        overviewPollInFlightRef.current = true;
      }
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }
      try {
        const [
          overviewResult,
          alertsResult,
          botsOverviewResult,
          calendarResult,
          gridBotsOverviewResult,
          newsResult,
          performanceResult,
          riskResult,
          openPositionsResult,
          accessResult
        ] = await Promise.allSettled([
          apiGet<DashboardOverviewResponse | ExchangeAccountOverview[]>("/dashboard/overview"),
          apiGet<DashboardAlertsResponse>("/dashboard/alerts?limit=10"),
          apiGet<DashboardBotOverviewItem[]>("/bots/overview"),
          apiGet<{ events: EconomicCalendarSummary[] }>(
            `/economic-calendar?from=${today}&to=${today}&currency=USD&impacts=high,medium`
          ),
          apiGet<{ items: GridInstance[] }>("/grid/instances"),
          apiGet<DashboardNewsResponse>("/news?mode=all&limit=3&page=1"),
          apiGet<DashboardPerformanceResponse>(
            `/dashboard/performance?range=${performanceRange}${
              performanceExchangeFilter !== "all"
                ? `&exchangeAccountId=${encodeURIComponent(performanceExchangeFilter)}`
                : ""
            }`
          ),
          apiGet<DashboardRiskAnalysisResponse>("/dashboard/risk-analysis?limit=3"),
          apiGet<DashboardOpenPositionsResponse>("/dashboard/open-positions"),
          apiGet<{ visibility?: AccessSectionVisibility }>("/settings/access-section")
        ]);
        if (!mounted) return;
        if (overviewResult.status === "fulfilled") {
          const payload = overviewResult.value as DashboardOverviewResponse | ExchangeAccountOverview[];
          if (Array.isArray(payload)) {
            setOverview(payload);
            setOverviewTotals(null);
          } else {
            setOverview(Array.isArray(payload.accounts) ? payload.accounts : []);
            setOverviewTotals(payload.totals ?? null);
          }
        } else {
          throw overviewResult.reason;
        }
        if (alertsResult.status === "fulfilled") {
          setAlerts(Array.isArray(alertsResult.value?.items) ? alertsResult.value.items : []);
        } else {
          setAlerts([]);
        }
        if (botsOverviewResult.status === "fulfilled") {
          setBotsOverview(Array.isArray(botsOverviewResult.value) ? botsOverviewResult.value : []);
          setBotsOverviewLoadError(false);
        } else {
          setBotsOverview([]);
          setBotsOverviewLoadError(true);
        }
        if (calendarResult.status === "fulfilled") {
          const events = Array.isArray(calendarResult.value?.events) ? calendarResult.value.events : [];
          setCalendarEvents(events);
          setCalendarLoadError(false);
        } else {
          setCalendarEvents([]);
          setCalendarLoadError(true);
        }
        if (gridBotsOverviewResult.status === "fulfilled") {
          const items = Array.isArray(gridBotsOverviewResult.value?.items) ? gridBotsOverviewResult.value.items : [];
          setGridBotsOverview(items);
          setGridBotsOverviewLoadError(false);
        } else {
          setGridBotsOverview([]);
          setGridBotsOverviewLoadError(true);
        }
        if (newsResult.status === "fulfilled") {
          const items = Array.isArray(newsResult.value?.items) ? newsResult.value.items : [];
          setNewsItems(items);
          setNewsLoadError(false);
        } else {
          setNewsItems([]);
          setNewsLoadError(true);
        }
        if (performanceResult.status === "fulfilled") {
          const points = Array.isArray(performanceResult.value?.points) ? performanceResult.value.points : [];
          setPerformancePoints(points);
          setPerformanceLoadError(false);
        } else {
          setPerformancePoints([]);
          setPerformanceLoadError(true);
        }
        if (riskResult.status === "fulfilled") {
          const items = Array.isArray(riskResult.value?.items) ? riskResult.value.items : [];
          setRiskItems(items);
          setRiskSummary(
            riskResult.value?.summary && typeof riskResult.value.summary === "object"
              ? {
                  critical: Number(riskResult.value.summary.critical ?? 0) || 0,
                  warning: Number(riskResult.value.summary.warning ?? 0) || 0,
                  ok: Number(riskResult.value.summary.ok ?? 0) || 0
                }
              : { critical: 0, warning: 0, ok: 0 }
          );
          setRiskLoadError(false);
        } else {
          setRiskItems([]);
          setRiskSummary({ critical: 0, warning: 0, ok: 0 });
          setRiskLoadError(true);
        }
        if (openPositionsResult.status === "fulfilled") {
          const items = Array.isArray(openPositionsResult.value?.items)
            ? openPositionsResult.value.items
            : [];
          const exchanges = Array.isArray(openPositionsResult.value?.exchanges)
            ? openPositionsResult.value.exchanges
            : [];
          setOpenPositions(items);
          setOpenPositionsExchanges(exchanges);
          setOpenPositionsMeta(
            openPositionsResult.value?.meta && typeof openPositionsResult.value.meta === "object"
              ? {
                  fetchedAt: String(openPositionsResult.value.meta.fetchedAt ?? ""),
                  partialErrors: Math.max(0, Number(openPositionsResult.value.meta.partialErrors ?? 0) || 0),
                  failedExchangeAccountIds: Array.isArray(openPositionsResult.value.meta.failedExchangeAccountIds)
                    ? openPositionsResult.value.meta.failedExchangeAccountIds
                        .map((value) => String(value))
                        .filter((value) => value.length > 0)
                    : []
                }
              : null
          );
          setOpenPositionsLoadError(false);
        } else {
          setOpenPositions([]);
          setOpenPositionsExchanges([]);
          setOpenPositionsMeta(null);
          setOpenPositionsLoadError(true);
        }
        if (accessResult.status === "fulfilled" && accessResult.value?.visibility) {
          setAccessVisibility({
            tradingDesk: accessResult.value.visibility.tradingDesk !== false,
            bots: accessResult.value.visibility.bots !== false,
            gridBots: accessResult.value.visibility.gridBots !== false,
            predictionsDashboard: accessResult.value.visibility.predictionsDashboard !== false,
            economicCalendar: accessResult.value.visibility.economicCalendar !== false,
            news: accessResult.value.visibility.news !== false,
            strategy: accessResult.value.visibility.strategy !== false
          });
        } else {
          setAccessVisibility(DEFAULT_ACCESS_SECTION_VISIBILITY);
        }
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
        setBotsOverview([]);
        setBotsOverviewLoadError(true);
        setPerformancePoints([]);
        setPerformanceLoadError(true);
        setGridBotsOverview([]);
        setGridBotsOverviewLoadError(true);
        setRiskItems([]);
        setRiskSummary({ critical: 0, warning: 0, ok: 0 });
        setRiskLoadError(true);
        setOpenPositions([]);
        setOpenPositionsExchanges([]);
        setOpenPositionsMeta(null);
        setOpenPositionsLoadError(true);
      } finally {
        if (isBackground) {
          overviewPollInFlightRef.current = false;
        }
        if (!mounted) return;
        if (!isBackground) {
          setLoading(false);
        }
      }
    }

    void load();
    const timer = setInterval(() => {
      void load({ background: true });
    }, 60_000);

    return () => {
      mounted = false;
      overviewPollInFlightRef.current = false;
      clearInterval(timer);
    };
  }, [performanceExchangeFilter, performanceRange]);

  useEffect(() => {
    if (performanceExchangeFilter === "all") return;
    const exists = overview.some((item) => item.exchangeAccountId === performanceExchangeFilter);
    if (!exists) {
      setPerformanceExchangeFilter("all");
    }
  }, [overview, performanceExchangeFilter]);

  useEffect(() => {
    if (openPositionsExchangeFilter === "all") return;
    const exists = openPositionsExchanges.some(
      (item) => item.exchangeAccountId === openPositionsExchangeFilter
    );
    if (!exists) {
      setOpenPositionsExchangeFilter("all");
    }
  }, [openPositionsExchangeFilter, openPositionsExchanges]);

  useEffect(() => {
    let mounted = true;

    async function loadLayout() {
      setLayoutLoading(true);
      setLayoutError(null);
      try {
        const response = await apiGet<DashboardLayoutResponse>("/dashboard/layout");
        if (!mounted) return;
        const normalized = normalizeDashboardLayout(response);
        setSavedLayout(normalized);
        if (!isEditMode) {
          setDraftLayout(normalized);
        }
      } catch (e) {
        if (!mounted) return;
        const fallback = getDefaultDashboardLayout();
        setSavedLayout(fallback);
        if (!isEditMode) {
          setDraftLayout(fallback);
        }
        setLayoutError(errMsg(e));
      } finally {
        if (!mounted) return;
        setLayoutLoading(false);
      }
    }

    void loadLayout();
    return () => {
      mounted = false;
    };
  }, [isEditMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(`(min-width: ${DASHBOARD_EDIT_BREAKPOINT_PX}px)`);
    const sync = () => setCanEditLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!resizeState) return;

    function handlePointerMove(event: PointerEvent) {
      if (!gridRef.current) return;
      const totalGapWidth = DASHBOARD_LAYOUT_GAP * (DASHBOARD_LAYOUT_COLUMNS - 1);
      const columnWidth = Math.max(
        1,
        (resizeState.containerWidth - totalGapWidth) / DASHBOARD_LAYOUT_COLUMNS
      );
      const columnStep = columnWidth + DASHBOARD_LAYOUT_GAP;
      const deltaColumns = Math.round((event.clientX - resizeState.startX) / columnStep);
      const deltaRows = Math.round((event.clientY - resizeState.startY) / DASHBOARD_LAYOUT_ROW_HEIGHT);

      setDraftLayout((current) => {
        const base = normalizeDashboardLayout(current ?? savedLayout ?? getDefaultDashboardLayout());
        const updatedItems = repackDashboardLayoutItems(
          base.items.map((item) => (
            item.id === resizeState.id
              ? {
                  ...item,
                  w: Math.min(DASHBOARD_LAYOUT_COLUMNS, Math.max(1, resizeState.startW + deltaColumns)),
                  h: Math.min(12, Math.max(1, resizeState.startH + deltaRows))
                }
              : item
          ))
        );
        return {
          ...base,
          items: updatedItems
        };
      });
    }

    function handlePointerUp() {
      setResizeState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizeState, savedLayout]);

  const headlineStats = useMemo(() => {
    return overview.reduce(
      (acc, row) => {
        acc.accounts += 1;
        acc.running += row.bots.running;
        acc.errors += row.bots.error;
        return acc;
      },
      { accounts: 0, running: 0, errors: 0 }
    );
  }, [overview]);

  const resolvedTotals = useMemo<DashboardTotals | null>(() => {
    if (overviewTotals) return overviewTotals;
    return aggregateOverviewTotals(overview);
  }, [overview, overviewTotals]);

  const performanceChartData = useMemo<DashboardPerformanceChartPoint[]>(() => {
    return performancePoints
      .map((point) => {
        const ts = new Date(point.ts).getTime();
        if (!Number.isFinite(ts)) return null;
        const totalEquity = Number(point.totalEquity);
        if (!Number.isFinite(totalEquity)) return null;
        return { ts, totalEquity };
      })
      .filter((point): point is DashboardPerformanceChartPoint => Boolean(point));
  }, [performancePoints]);

  const latestPerformancePoint = useMemo(() => {
    return performancePoints.length > 0 ? performancePoints[performancePoints.length - 1] : null;
  }, [performancePoints]);

  const visibleAlerts = useMemo(() => {
    return alerts.filter((item) => item.severity === "critical" || item.severity === "warning");
  }, [alerts]);

  const filteredPerformanceAccounts = useMemo(() => {
    if (performanceExchangeFilter === "all") return overview;
    return overview.filter((item) => item.exchangeAccountId === performanceExchangeFilter);
  }, [overview, performanceExchangeFilter]);

  const filteredPerformanceTotals = useMemo<DashboardTotals | null>(() => {
    if (performanceExchangeFilter === "all") return resolvedTotals;
    return aggregateOverviewTotals(filteredPerformanceAccounts);
  }, [filteredPerformanceAccounts, performanceExchangeFilter, resolvedTotals]);

  const filteredHeadlineStats = useMemo(() => {
    return filteredPerformanceAccounts.reduce(
      (acc, row) => {
        acc.running += row.bots.running;
        acc.errors += row.bots.error;
        return acc;
      },
      { running: 0, errors: 0 }
    );
  }, [filteredPerformanceAccounts]);

  const filteredRiskItems = useMemo(() => {
    if (performanceExchangeFilter === "all") return riskItems;
    return riskItems.filter((item) => item.exchangeAccountId === performanceExchangeFilter);
  }, [performanceExchangeFilter, riskItems]);

  const filteredRiskSummary = useMemo(() => {
    if (performanceExchangeFilter === "all") return riskSummary;
    return filteredRiskItems.reduce(
      (acc, item) => {
        if (item.severity === "critical") acc.critical += 1;
        else if (item.severity === "warning") acc.warning += 1;
        else acc.ok += 1;
        return acc;
      },
      { critical: 0, warning: 0, ok: 0 }
    );
  }, [filteredRiskItems, performanceExchangeFilter, riskSummary]);

  const fallbackPerformanceTotals = useMemo(() => {
    if (performanceExchangeFilter !== "all") {
      return {
        totalEquity: filteredPerformanceTotals?.totalEquity ?? null,
        totalAvailableMargin: filteredPerformanceTotals?.totalAvailableMargin ?? null,
        totalTodayPnl: filteredPerformanceTotals?.totalTodayPnl ?? null
      };
    }
    return {
      totalEquity: latestPerformancePoint?.totalEquity ?? resolvedTotals?.totalEquity ?? null,
      totalAvailableMargin:
        latestPerformancePoint?.totalAvailableMargin ?? resolvedTotals?.totalAvailableMargin ?? null,
      totalTodayPnl: resolvedTotals?.totalTodayPnl ?? latestPerformancePoint?.totalTodayPnl ?? null
    };
  }, [filteredPerformanceTotals, latestPerformancePoint, performanceExchangeFilter, resolvedTotals]);

  const filteredOpenPositions = useMemo(() => {
    if (openPositionsExchangeFilter === "all") return openPositions;
    return openPositions.filter((item) => item.exchangeAccountId === openPositionsExchangeFilter);
  }, [openPositions, openPositionsExchangeFilter]);

  const selectedPerformanceLabel = useMemo(() => {
    if (performanceExchangeFilter === "all") return t("performance.filterAll");
    const match = overview.find((item) => item.exchangeAccountId === performanceExchangeFilter);
    return match ? `${match.exchange.toUpperCase()} · ${match.label}` : t("performance.filterAll");
  }, [overview, performanceExchangeFilter, t]);

  const spotlightBots = useMemo(() => {
    const rank = (status: string | null | undefined) => {
      const normalized = String(status ?? "").trim().toLowerCase();
      if (normalized === "running") return 0;
      if (normalized === "error") return 1;
      if (normalized === "stopped") return 2;
      return 3;
    };
    return [...botsOverview]
      .sort((left, right) => {
        const statusDiff = rank(left.status) - rank(right.status);
        if (statusDiff !== 0) return statusDiff;
        const leftPnl = Number(resolveBotWidgetPnlUsd(left) ?? 0);
        const rightPnl = Number(resolveBotWidgetPnlUsd(right) ?? 0);
        if (Math.abs(rightPnl) !== Math.abs(leftPnl)) return Math.abs(rightPnl) - Math.abs(leftPnl);
        const leftTs = new Date(left.trade?.lastTradeTs ?? left.runtime?.updatedAt ?? 0).getTime();
        const rightTs = new Date(right.trade?.lastTradeTs ?? right.runtime?.updatedAt ?? 0).getTime();
        return rightTs - leftTs;
      })
      .slice(0, 4);
  }, [botsOverview]);

  const spotlightGridBots = useMemo(() => {
    const rank = (state: GridInstance["state"]) => {
      if (state === "running") return 0;
      if (state === "error") return 1;
      if (state === "paused") return 2;
      if (state === "stopped") return 3;
      if (state === "created") return 4;
      if (state === "archived") return 5;
      return 6;
    };
    return [...gridBotsOverview]
      .sort((left, right) => {
        const stateDiff = rank(left.state) - rank(right.state);
        if (stateDiff !== 0) return stateDiff;
        const leftPnl = Number(resolveGridWidgetPnlUsd(left) ?? 0);
        const rightPnl = Number(resolveGridWidgetPnlUsd(right) ?? 0);
        if (Math.abs(rightPnl) !== Math.abs(leftPnl)) return Math.abs(rightPnl) - Math.abs(leftPnl);
        const leftTs = new Date(left.lastPlanAt ?? left.updatedAt ?? 0).getTime();
        const rightTs = new Date(right.lastPlanAt ?? right.updatedAt ?? 0).getTime();
        return rightTs - leftTs;
      })
      .slice(0, 4);
  }, [gridBotsOverview]);

  const builderT = useTranslations("dashboard.builder");
  const activeLayout = useMemo(
    () => normalizeDashboardLayout((isEditMode ? draftLayout : savedLayout) ?? getDefaultDashboardLayout()),
    [draftLayout, isEditMode, savedLayout]
  );

  const widgetMetaById = useMemo(
    () => new Map(DASHBOARD_WIDGET_REGISTRY.map((entry) => [entry.id, entry] as const)),
    []
  );

  const widgetContent = useMemo(() => ({
    alerts: {
      available: true,
      title: t("alerts.title"),
      render: () => <AlertsFeed alerts={visibleAlerts} />
    },
    performance: {
      available: true,
      title: t("performance.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardPerformanceProCard dashboardWidgetCardFill">
          <div className="dashboardPerformanceHead">
            <div>
              <div className="dashboardPerformanceTitle">{t("performance.title")}</div>
              <div className="dashboardPerformanceSubtitle">{t("performance.subtitle")}</div>
              <div className="dashboardPerformanceSummaryChips">
                <span className="dashboardPerformanceSummaryChip">
                  {t("performance.filterLabel")}: {selectedPerformanceLabel}
                </span>
                <span className="dashboardPerformanceSummaryChip">
                  {t("totals.includedAccounts", {
                    count:
                      performanceExchangeFilter === "all"
                        ? overview.length
                        : filteredPerformanceAccounts.length
                  })}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label style={{ display: "grid", gap: 4, minWidth: 220 }}>
                <span className="dashboardPerformanceSubtitle">{t("performance.filterLabel")}</span>
                <select
                  className="select"
                  value={performanceExchangeFilter}
                  onChange={(event) => setPerformanceExchangeFilter(event.target.value)}
                >
                  <option value="all">{t("performance.filterAll")}</option>
                  {overview.map((item) => (
                    <option key={item.exchangeAccountId} value={item.exchangeAccountId}>
                      {item.exchange.toUpperCase()} · {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dashboardPerformanceTabs" role="tablist" aria-label={t("performance.title")}>
                {PERFORMANCE_RANGES.map((range) => (
                  <button
                    key={range}
                    type="button"
                    role="tab"
                    aria-selected={performanceRange === range}
                    className={`dashboardPerformanceTab ${
                      performanceRange === range ? "dashboardPerformanceTabActive" : ""
                    }`}
                    onClick={() => setPerformanceRange(range)}
                  >
                    {range === "24h"
                      ? t("performance.range24h")
                      : range === "7d"
                        ? t("performance.range7d")
                        : t("performance.range30d")}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="dashboardPerformanceBody dashboardWidgetScrollArea">
            <div className="dashboardPerformanceMain">
              {performanceLoadError ? (
                <div className="dashboardPerformanceState">{t("performance.unavailable")}</div>
              ) : loading && performanceChartData.length === 0 ? (
                <div className="dashboardPerformanceState">{t("performance.loading")}</div>
              ) : performanceChartData.length === 0 ? (
                <div className="dashboardPerformanceState">{t("performance.none")}</div>
              ) : (
                <div className="dashboardPerformanceChartWrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={performanceChartData} margin={{ top: 14, right: 14, left: 6, bottom: 2 }}>
                      <defs>
                        <linearGradient id="dashboardPerformanceAreaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="rgba(16, 185, 199, 0.78)" />
                          <stop offset="95%" stopColor="rgba(16, 185, 199, 0.05)" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value) =>
                          formatPerformanceAxisTick(Number(value), performanceRange, locale)
                        }
                        stroke="rgba(255,255,255,0.48)"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tickFormatter={(value) => formatUsdt(Number(value), locale, 0)}
                        stroke="rgba(255,255,255,0.48)"
                        tickLine={false}
                        axisLine={false}
                        width={92}
                        padding={{ top: 30, bottom: 4 }}
                      />
                      <Tooltip
                        formatter={(value: number) => [formatUsdt(value, locale), t("performance.metrics.equity")]}
                        labelFormatter={(value) =>
                          new Date(Number(value)).toLocaleString(resolveIntlLocale(locale), {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                          })
                        }
                        contentStyle={{
                          border: "1px solid rgba(255,193,7,0.34)",
                          background: "rgba(7, 17, 26, 0.95)",
                          borderRadius: 10
                        }}
                        labelStyle={{ color: "var(--muted)" }}
                        itemStyle={{ color: "var(--text)" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalEquity"
                        stroke="rgba(16, 185, 199, 0.95)"
                        strokeWidth={2}
                        fill="url(#dashboardPerformanceAreaFill)"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="dashboardPerformanceMetrics">
                <div className="dashboardPerformanceMetricCard">
                  <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.equity")}</div>
                  <div className="dashboardPerformanceMetricValue">
                    <span className="dashboardPerformanceMetricValueNumber">
                      {formatAmount(fallbackPerformanceTotals.totalEquity, locale)}
                    </span>
                    <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                  </div>
                </div>
                <div className="dashboardPerformanceMetricCard">
                  <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.margin")}</div>
                  <div className="dashboardPerformanceMetricValue">
                    <span className="dashboardPerformanceMetricValueNumber">
                      {formatAmount(fallbackPerformanceTotals.totalAvailableMargin, locale)}
                    </span>
                    <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                  </div>
                </div>
                <div className="dashboardPerformanceMetricCard">
                  <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.pnl")}</div>
                  <div
                    className={`dashboardPerformanceMetricValue ${
                      Number(fallbackPerformanceTotals.totalTodayPnl ?? 0) < 0
                        ? "dashboardPerformanceMetricValueNegative"
                        : "dashboardPerformanceMetricValuePositive"
                    }`}
                  >
                    <span className="dashboardPerformanceMetricValueNumber">
                      {formatAmount(fallbackPerformanceTotals.totalTodayPnl, locale)}
                    </span>
                    <span className="dashboardPerformanceMetricValueUnit">USDT</span>
                  </div>
                </div>
                <div className="dashboardPerformanceMetricCard">
                  <div className="dashboardPerformanceMetricLabel">{t("performance.metrics.bots")}</div>
                  <div className="dashboardPerformanceMetricValue">
                    {filteredHeadlineStats.running} / {filteredHeadlineStats.errors}
                  </div>
                </div>
              </div>
            </div>

            <aside className="dashboardLossAnalysisCard">
              <div className="dashboardLossAnalysisHead">
                <div className="dashboardLossAnalysisTitle">{t("lossAnalysis.title")}</div>
                <div className="dashboardLossAnalysisSubtitle">{t("lossAnalysis.subtitle")}</div>
                <div className="dashboardLossScope">
                  <span className="dashboardLossScopeChip">
                    {t("performance.filterLabel")}: {selectedPerformanceLabel}
                  </span>
                </div>
                <div className="dashboardLossSummary">
                  <span className="dashboardLossSeverity dashboardLossSeverityCritical">
                    {t("lossAnalysis.severity.critical")}: {filteredRiskSummary.critical}
                  </span>
                  <span className="dashboardLossSeverity dashboardLossSeverityWarning">
                    {t("lossAnalysis.severity.warning")}: {filteredRiskSummary.warning}
                  </span>
                  <span className="dashboardLossSeverity dashboardLossSeverityOk">
                    {t("lossAnalysis.severity.ok")}: {filteredRiskSummary.ok}
                  </span>
                </div>
              </div>

              {riskLoadError ? (
                <div className="dashboardPerformanceState">{t("lossAnalysis.unavailable")}</div>
              ) : loading && filteredRiskItems.length === 0 ? (
                <div className="dashboardPerformanceState">{t("lossAnalysis.loading")}</div>
              ) : filteredRiskItems.length === 0 ? (
                <div className="dashboardPerformanceState">{t("lossAnalysis.none")}</div>
              ) : (
                <div className="dashboardLossAnalysisList">
                  {filteredRiskItems.map((item) => (
                    <div key={item.exchangeAccountId} className="dashboardLossRow">
                      <div className="dashboardLossRowTop">
                        <div className="dashboardLossRowAccount">
                          {item.label} · {item.exchange.toUpperCase()}
                        </div>
                        <span
                          className={`dashboardLossSeverity ${
                            item.severity === "critical"
                              ? "dashboardLossSeverityCritical"
                              : item.severity === "warning"
                                ? "dashboardLossSeverityWarning"
                                : "dashboardLossSeverityOk"
                          }`}
                        >
                          {item.severity === "critical"
                            ? t("lossAnalysis.severity.critical")
                            : item.severity === "warning"
                              ? t("lossAnalysis.severity.warning")
                              : t("lossAnalysis.severity.ok")}
                        </span>
                      </div>
                      <div className="dashboardLossTriggerRow">
                        {item.triggers.map((trigger) => (
                          <span key={`${item.exchangeAccountId}-${trigger}`} className="dashboardLossTriggerChip">
                            {trigger === "dailyLoss"
                              ? t("lossAnalysis.triggers.dailyLoss")
                              : trigger === "margin"
                                ? t("lossAnalysis.triggers.margin")
                                : t("lossAnalysis.triggers.insufficientData")}
                          </span>
                        ))}
                      </div>
                      <div className="dashboardLossMeta">
                        <span>
                          {t("performance.metrics.pnl")}: {formatSignedUsdt(item.pnlTodayUsd, locale)}
                        </span>
                        <span>
                          {t("lossAnalysis.triggers.dailyLoss")}: {formatUsdt(item.lossUsd, locale)} ({formatPct(item.lossPct, locale)})
                        </span>
                        <span>
                          {t("lossAnalysis.triggers.margin")}: {formatPct(item.marginPct, locale)}
                        </span>
                        <span>
                          Sync: {item.lastSyncAt ? formatPerformanceAxisTick(new Date(item.lastSyncAt).getTime(), "24h", locale) : "—"}
                        </span>
                      </div>
                      <Link
                        href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}`}
                        className="dashboardLossRowAction"
                      >
                        {t("actions.manualTrading")}
                      </Link>
                    </div>
                  ))}
                </div>
              )}

              <div className="dashboardLossAnalysisFooter">
                <Link href={withLocalePath("/settings/risk", locale)} className="btn">
                  {t("lossAnalysis.openRiskSettings")}
                </Link>
              </div>
            </aside>
          </div>
        </div>
      )
    },
    calendar: {
      available: accessVisibility.economicCalendar,
      title: t("calendar.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardCalendarProCard dashboardWidgetCardFill">
          <div className="dashboardCalendarProHead">
            <div className="dashboardCalendarProTitle">{t("calendar.title")}</div>
            <Link href={withLocalePath("/calendar", locale)} className="btn">{t("calendar.open")}</Link>
          </div>
          <div className="dashboardWidgetScrollArea">
            {calendarLoadError ? (
              <div className="dashboardCalendarProMeta">{t("calendar.unavailable")}</div>
            ) : loading && calendarEvents.length === 0 ? (
              <div className="dashboardCalendarProMeta">{t("calendar.loading")}</div>
            ) : calendarEvents.length === 0 ? (
              <div className="dashboardCalendarProMeta">{t("calendar.none")}</div>
            ) : (
              <div className="dashboardCalendarProList">
                <div className="dashboardCalendarProCount">
                  {t("calendar.todayCount", { count: calendarEvents.length })}
                </div>
                {calendarEvents.slice(0, 5).map((event) => (
                  <div key={event.id} className="dashboardCalendarProRow">
                    <span className={`badge ${
                      event.impact === "high"
                        ? "calendarImpactBadgeHigh"
                        : event.impact === "medium"
                          ? "calendarImpactBadgeMedium"
                          : "calendarImpactBadgeLow"
                    }`}>
                      {event.impact.toUpperCase()}
                    </span>
                    <span className="dashboardCalendarProMeta">
                      {new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {event.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    },
    news: {
      available: accessVisibility.news,
      title: t("news.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardNewsProCard dashboardWidgetCardFill">
          <div className="dashboardNewsProHead">
            <div className="dashboardNewsProTitle">{t("news.title")}</div>
            <Link href={withLocalePath("/news", locale)} className="btn">{t("news.open")}</Link>
          </div>
          <div className="dashboardWidgetScrollArea">
            {newsLoadError ? (
              <div className="dashboardNewsProMeta">{t("news.unavailable")}</div>
            ) : loading && newsItems.length === 0 ? (
              <div className="dashboardNewsProMeta">{t("news.loading")}</div>
            ) : newsItems.length === 0 ? (
              <div className="dashboardNewsProMeta">{t("news.none")}</div>
            ) : (
              <div className="dashboardNewsProList">
                {newsItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="dashboardNewsProRow"
                  >
                    <div className="dashboardNewsProBadges">
                      <span className={`badge ${item.feed === "crypto" ? "newsBadgeCrypto" : "newsBadgeGeneral"}`}>
                        {item.feed.toUpperCase()}
                      </span>
                      {item.symbol ? <span className="badge">{item.symbol}</span> : null}
                    </div>
                    <div className="dashboardNewsProContent">
                      <span className="dashboardNewsProTime">
                        {new Date(item.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="dashboardNewsProTitleText">{item.title}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    },
    fearGreed: {
      available: true,
      title: t("fearGreed.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardFearGreedCard dashboardWidgetCardFill">
          <img
            src="https://alternative.me/crypto/fear-and-greed-index.png"
            alt={t("fearGreed.alt")}
            className="dashboardFearGreedImage"
            loading="lazy"
          />
        </div>
      )
    },
    accounts: {
      available: true,
      title: t("stats.exchangeAccounts"),
      render: () => (
        <div className="dashboardAccountsWidget dashboardWidgetScrollArea">
          {error ? (
            <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>
              <strong>{t("errors.load")}</strong> {error}
            </div>
          ) : null}

          {loading ? (
            <div className="exchangeOverviewGrid">
              <DashboardSkeletonCard />
              <DashboardSkeletonCard />
              <DashboardSkeletonCard />
            </div>
          ) : overview.length === 0 ? (
            <div className="card exchangeOverviewEmpty">
              <h3 style={{ marginTop: 0 }}>{t("empty.title")}</h3>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                {t("empty.description")}
              </p>
              <Link href={withLocalePath("/settings", locale)} className="btn btnPrimary">{t("empty.cta")}</Link>
            </div>
          ) : (
            <div className="exchangeOverviewGrid">
              {overview.map((item) => (
                <ExchangeAccountOverviewCard
                  key={item.exchangeAccountId}
                  overview={item}
                  visibility={accessVisibility}
                />
              ))}
            </div>
          )}
        </div>
      )
    },
    botsOverview: {
      available: accessVisibility.bots,
      title: t("botsOverview.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardBotOverviewCard dashboardWidgetCardFill">
          <div className="dashboardBotOverviewHead">
            <div>
              <div className="dashboardBotOverviewTitle">{t("botsOverview.title")}</div>
              <div className="dashboardBotOverviewSubtitle">{t("botsOverview.subtitle")}</div>
            </div>
            <Link href={withLocalePath("/bots", locale)} className="btn">
              {t("botsOverview.open")}
            </Link>
          </div>

          <div className="dashboardWidgetScrollArea">
            {botsOverviewLoadError ? (
              <div className="dashboardBotOverviewState">{t("botsOverview.unavailable")}</div>
            ) : loading && spotlightBots.length === 0 ? (
              <div className="dashboardBotOverviewState">{t("botsOverview.loading")}</div>
            ) : spotlightBots.length === 0 ? (
              <div className="dashboardBotOverviewState">{t("botsOverview.empty")}</div>
            ) : (
              <div className="dashboardBotOverviewList">
                {spotlightBots.map((item) => {
                  const pnlUsd = resolveBotWidgetPnlUsd(item);
                  const investUsd = resolveBotWidgetInvestUsd(item);
                  const returnPct = investUsd && investUsd > 0 && Number.isFinite(Number(pnlUsd))
                    ? (Number(pnlUsd) / investUsd) * 100
                    : null;
                  const updatedAt = item.runtime?.updatedAt ?? item.trade?.lastTradeTs ?? null;
                  const reason = item.status === "error"
                    ? item.runtime?.lastError ?? item.stoppedWhy ?? null
                    : item.status === "stopped"
                      ? item.stoppedWhy ?? item.runtime?.reason ?? null
                      : null;
                  return (
                    <article
                      key={item.id}
                      className={`dashboardBotOverviewItem${
                        String(item.status ?? "").trim().toLowerCase() === "error"
                          ? " dashboardBotOverviewItemCritical"
                          : ""
                      }`}
                    >
                      <div className="dashboardBotOverviewRowTop">
                        <div className="dashboardBotOverviewMeta">
                          <strong className="dashboardBotOverviewName">{item.name}</strong>
                          <span className="dashboardBotOverviewContext">
                            {item.symbol} · {item.exchangeAccount?.label ?? item.exchange.toUpperCase()}
                          </span>
                        </div>
                        <span className={botStatusBadgeClass(item.status)}>
                          {formatCompactStatus(item.status)}
                        </span>
                      </div>
                      <div className="dashboardBotOverviewMetrics">
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("botsOverview.metrics.pnl")}</span>
                          <strong
                            className={`dashboardBotOverviewMetricValue ${
                              Number(pnlUsd ?? 0) > 0
                                ? "dashboardBotOverviewMetricPositive"
                                : Number(pnlUsd ?? 0) < 0
                                  ? "dashboardBotOverviewMetricNegative"
                                  : ""
                            }`}
                          >
                            {formatSignedUsdt(pnlUsd, locale)}
                          </strong>
                        </div>
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("botsOverview.metrics.invest")}</span>
                          <strong className="dashboardBotOverviewMetricValue">{formatUsdt(investUsd, locale)}</strong>
                        </div>
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("botsOverview.metrics.return")}</span>
                          <strong
                            className={`dashboardBotOverviewMetricValue ${
                              Number(returnPct ?? 0) > 0
                                ? "dashboardBotOverviewMetricPositive"
                                : Number(returnPct ?? 0) < 0
                                  ? "dashboardBotOverviewMetricNegative"
                                  : ""
                            }`}
                          >
                            {formatPct(returnPct, locale)}
                          </strong>
                        </div>
                      </div>
                      <div className="dashboardBotOverviewMetaLine">
                        <span>{t("botsOverview.updated", { value: formatRelativeTimestamp(updatedAt, locale, t) })}</span>
                        {reason ? (
                          <span
                            className={`dashboardBotOverviewReason${
                              String(item.status ?? "").trim().toLowerCase() === "error"
                                ? " dashboardBotOverviewReasonCritical"
                                : ""
                            }`}
                            title={reason}
                          >
                            {t("botsOverview.reason", { value: reason })}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )
    },
    gridBotsOverview: {
      available: accessVisibility.gridBots,
      title: t("gridBotsOverview.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardBotOverviewCard dashboardWidgetCardFill">
          <div className="dashboardBotOverviewHead">
            <div>
              <div className="dashboardBotOverviewTitle">{t("gridBotsOverview.title")}</div>
              <div className="dashboardBotOverviewSubtitle">{t("gridBotsOverview.subtitle")}</div>
            </div>
            <Link href={withLocalePath("/bots/grid", locale)} className="btn">
              {t("gridBotsOverview.open")}
            </Link>
          </div>

          <div className="dashboardWidgetScrollArea">
            {gridBotsOverviewLoadError ? (
              <div className="dashboardBotOverviewState">{t("gridBotsOverview.unavailable")}</div>
            ) : loading && spotlightGridBots.length === 0 ? (
              <div className="dashboardBotOverviewState">{t("gridBotsOverview.loading")}</div>
            ) : spotlightGridBots.length === 0 ? (
              <div className="dashboardBotOverviewState">{t("gridBotsOverview.empty")}</div>
            ) : (
              <div className="dashboardBotOverviewList">
                {spotlightGridBots.map((item) => {
                  const pnlUsd = resolveGridWidgetPnlUsd(item);
                  const investUsd = Number(item.investUsd ?? 0) + Number(item.extraMarginUsd ?? 0);
                  const returnPct = investUsd > 0 && Number.isFinite(Number(pnlUsd))
                    ? (Number(pnlUsd) / investUsd) * 100
                    : null;
                  const updatedAt = item.lastPlanAt ?? item.bot?.runtime?.updatedAt ?? item.updatedAt ?? null;
                  const issue = item.state === "error"
                    ? item.lastPlanError ?? item.botVault?.executionLastError ?? item.bot?.runtime?.lastError ?? null
                    : item.state === "stopped" || item.state === "paused"
                      ? item.lastPlanError ?? item.bot?.runtime?.reason ?? null
                      : null;
                  return (
                    <article
                      key={item.id}
                      className={`dashboardBotOverviewItem${
                        String(item.state ?? "").trim().toLowerCase() === "error"
                          ? " dashboardBotOverviewItemCritical"
                          : ""
                      }`}
                    >
                      <div className="dashboardBotOverviewRowTop">
                        <div className="dashboardBotOverviewMeta">
                          <strong className="dashboardBotOverviewName">{item.template?.name ?? t("gridBotsOverview.unnamed")}</strong>
                          <span className="dashboardBotOverviewContext">
                            {item.template?.symbol ?? "—"} · {item.bot?.exchangeAccount?.label ?? item.bot?.exchange ?? "Grid"}
                          </span>
                        </div>
                        <span className={botStatusBadgeClass(item.state)}>
                          {formatCompactStatus(item.state)}
                        </span>
                      </div>
                      <div className="dashboardBotOverviewMetrics">
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("gridBotsOverview.metrics.pnl")}</span>
                          <strong
                            className={`dashboardBotOverviewMetricValue ${
                              Number(pnlUsd ?? 0) > 0
                                ? "dashboardBotOverviewMetricPositive"
                                : Number(pnlUsd ?? 0) < 0
                                  ? "dashboardBotOverviewMetricNegative"
                                  : ""
                            }`}
                          >
                            {formatSignedUsdt(pnlUsd, locale)}
                          </strong>
                        </div>
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("gridBotsOverview.metrics.invest")}</span>
                          <strong className="dashboardBotOverviewMetricValue">{formatUsdt(investUsd, locale)}</strong>
                        </div>
                        <div className="dashboardBotOverviewMetric">
                          <span className="dashboardBotOverviewMetricLabel">{t("gridBotsOverview.metrics.return")}</span>
                          <strong
                            className={`dashboardBotOverviewMetricValue ${
                              Number(returnPct ?? 0) > 0
                                ? "dashboardBotOverviewMetricPositive"
                                : Number(returnPct ?? 0) < 0
                                  ? "dashboardBotOverviewMetricNegative"
                                  : ""
                            }`}
                          >
                            {formatPct(returnPct, locale)}
                          </strong>
                        </div>
                      </div>
                      <div className="dashboardBotOverviewMetaLine">
                        <span>{t("gridBotsOverview.updated", { value: formatRelativeTimestamp(updatedAt, locale, t) })}</span>
                        {issue ? (
                          <span
                            className={`dashboardBotOverviewReason${
                              String(item.state ?? "").trim().toLowerCase() === "error"
                                ? " dashboardBotOverviewReasonCritical"
                                : ""
                            }`}
                            title={issue}
                          >
                            {t("gridBotsOverview.reason", { value: issue })}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )
    },
    wallet: {
      available: isConnected,
      title: t("walletCard.title"),
      render: () => <DashboardWalletCard />
    },
    openPositions: {
      available: accessVisibility.tradingDesk,
      title: t("openPositions.title"),
      render: () => (
        <div className="card dashboardInsightCard dashboardOpenPositionsCard dashboardWidgetCardFill">
          <div className="dashboardOpenPositionsHead">
            <div>
              <div className="dashboardOpenPositionsTitle">{t("openPositions.title")}</div>
              <div className="dashboardOpenPositionsSubtitle">{t("openPositions.subtitle")}</div>
            </div>
            <label className="dashboardOpenPositionsFilter">
              <span>{t("openPositions.filterLabel")}</span>
              <select
                className="select"
                value={openPositionsExchangeFilter}
                onChange={(event) => setOpenPositionsExchangeFilter(event.target.value)}
              >
                <option value="all">{t("openPositions.filterAll")}</option>
                {openPositionsExchanges.map((item) => (
                  <option key={item.exchangeAccountId} value={item.exchangeAccountId}>
                    {item.exchange.toUpperCase()} · {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="dashboardWidgetScrollArea">
            {!openPositionsLoadError && (openPositionsMeta?.partialErrors ?? 0) > 0 ? (
              <div className="dashboardOpenPositionsMeta">
                {t("openPositions.partial", { count: openPositionsMeta?.partialErrors ?? 0 })}
              </div>
            ) : null}

            {openPositionsLoadError ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.unavailable")}</div>
            ) : loading && openPositions.length === 0 ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.loading")}</div>
            ) : filteredOpenPositions.length === 0 ? (
              <div className="dashboardOpenPositionsState">{t("openPositions.none")}</div>
            ) : (
              <>
                <div className="dashboardOpenPositionsTableWrap">
                  <table className="dashboardOpenPositionsTable">
                    <thead>
                      <tr>
                        <th>{t("openPositions.columns.exchange")}</th>
                        <th>{t("openPositions.columns.side")}</th>
                        <th>{t("openPositions.columns.size")}</th>
                        <th>{t("openPositions.columns.entry")}</th>
                        <th>{t("openPositions.columns.stopLoss")}</th>
                        <th>{t("openPositions.columns.takeProfit")}</th>
                        <th>{t("openPositions.columns.pnl")}</th>
                        <th>{t("openPositions.columns.action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOpenPositions.map((item) => {
                        const pnl = Number(item.unrealizedPnl ?? 0);
                        const pnlClass =
                          pnl > 0
                            ? "dashboardOpenPositionsPnlPositive"
                            : pnl < 0
                              ? "dashboardOpenPositionsPnlNegative"
                              : "";
                        return (
                          <tr key={`${item.exchangeAccountId}-${item.symbol}-${item.side}`} className="dashboardOpenPositionsRow">
                            <td>
                              <span className="dashboardOpenPositionsExchange">
                                {item.exchange.toUpperCase()} · {item.exchangeLabel}
                              </span>
                              <span className="dashboardOpenPositionsSymbol">{item.symbol}</span>
                            </td>
                            <td>
                              <span
                                className={`dashboardOpenPositionsSide ${
                                  item.side === "long"
                                    ? "dashboardOpenPositionsSideLong"
                                    : "dashboardOpenPositionsSideShort"
                                }`}
                              >
                                {item.side === "long" ? t("openPositions.side.long") : t("openPositions.side.short")}
                              </span>
                            </td>
                            <td>{formatAmount(item.size, locale, 6)}</td>
                            <td>{formatAmount(item.entryPrice, locale, 4)}</td>
                            <td>{formatAmount(item.stopLossPrice, locale, 4)}</td>
                            <td>{formatAmount(item.takeProfitPrice, locale, 4)}</td>
                            <td className={pnlClass}>{formatSignedUsdt(item.unrealizedPnl, locale)}</td>
                            <td>
                              <Link
                                href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}&symbol=${encodeURIComponent(item.symbol)}`}
                                className="dashboardOpenPositionsAction"
                              >
                                {t("openPositions.actionOpenDesk")}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="dashboardOpenPositionsMobileList">
                  {filteredOpenPositions.map((item) => {
                    const pnl = Number(item.unrealizedPnl ?? 0);
                    const pnlClass =
                      pnl > 0
                        ? "dashboardOpenPositionsPnlPositive"
                        : pnl < 0
                          ? "dashboardOpenPositionsPnlNegative"
                          : "";
                    return (
                      <article
                        key={`${item.exchangeAccountId}-${item.symbol}-${item.side}-mobile`}
                        className="dashboardOpenPositionsMobileCard"
                      >
                        <div className="dashboardOpenPositionsMobileHead">
                          <strong>{item.symbol}</strong>
                          <span
                            className={`dashboardOpenPositionsSide ${
                              item.side === "long"
                                ? "dashboardOpenPositionsSideLong"
                                : "dashboardOpenPositionsSideShort"
                            }`}
                          >
                            {item.side === "long" ? t("openPositions.side.long") : t("openPositions.side.short")}
                          </span>
                        </div>
                        <div className="dashboardOpenPositionsMobileMeta">
                          {item.exchange.toUpperCase()} · {item.exchangeLabel}
                        </div>
                        <div className="dashboardOpenPositionsMobileGrid">
                          <span>{t("openPositions.columns.size")}: {formatAmount(item.size, locale, 6)}</span>
                          <span>{t("openPositions.columns.entry")}: {formatAmount(item.entryPrice, locale, 4)}</span>
                          <span>{t("openPositions.columns.stopLoss")}: {formatAmount(item.stopLossPrice, locale, 4)}</span>
                          <span>{t("openPositions.columns.takeProfit")}: {formatAmount(item.takeProfitPrice, locale, 4)}</span>
                          <span className={pnlClass}>{t("openPositions.columns.pnl")}: {formatSignedUsdt(item.unrealizedPnl, locale)}</span>
                        </div>
                        <Link
                          href={`${withLocalePath("/trade", locale)}?exchangeAccountId=${encodeURIComponent(item.exchangeAccountId)}&symbol=${encodeURIComponent(item.symbol)}`}
                          className="dashboardOpenPositionsAction"
                        >
                          {t("openPositions.actionOpenDesk")}
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )
    }
  }), [
    accessVisibility.bots,
    accessVisibility.economicCalendar,
    accessVisibility.gridBots,
    accessVisibility.news,
    accessVisibility.tradingDesk,
    botsOverviewLoadError,
    calendarEvents,
    calendarLoadError,
    error,
    fallbackPerformanceTotals.totalAvailableMargin,
    fallbackPerformanceTotals.totalEquity,
    fallbackPerformanceTotals.totalTodayPnl,
    filteredHeadlineStats.errors,
    filteredHeadlineStats.running,
    filteredOpenPositions,
    filteredPerformanceAccounts.length,
    filteredRiskItems,
    filteredRiskSummary,
    gridBotsOverviewLoadError,
    isConnected,
    loading,
    locale,
    newsItems,
    newsLoadError,
    openPositions,
    openPositionsExchangeFilter,
    openPositionsExchanges,
    openPositionsLoadError,
    openPositionsMeta,
    overview,
    performanceChartData,
    performanceExchangeFilter,
    performanceRange,
    performanceLoadError,
    selectedPerformanceLabel,
    spotlightBots,
    spotlightGridBots,
    t
  ]);

  const availableWidgetIds = useMemo(
    () => DASHBOARD_WIDGET_REGISTRY
      .map((entry) => entry.id)
      .filter((id) => widgetContent[id].available),
    [widgetContent]
  );
  const availableWidgetIdSet = useMemo(() => new Set(availableWidgetIds), [availableWidgetIds]);
  const desktopItems = useMemo(
    () => activeLayout.items.filter((item) => item.visible && availableWidgetIdSet.has(item.id)),
    [activeLayout.items, availableWidgetIdSet]
  );
  const hiddenAvailableItems = useMemo(
    () => activeLayout.items.filter((item) => !item.visible && availableWidgetIdSet.has(item.id)),
    [activeLayout.items, availableWidgetIdSet]
  );

  function updateDraftItems(updater: (items: DashboardLayoutItem[]) => DashboardLayoutItem[]) {
    setDraftLayout((current) => {
      const base = normalizeDashboardLayout(current ?? savedLayout ?? getDefaultDashboardLayout());
      return {
        ...base,
        items: updater(base.items.map((item) => ({ ...item })))
      };
    });
  }

  function buildLayoutWithVisibleOrder(visibleIds: DashboardWidgetId[], sourceItems: DashboardLayoutItem[]) {
    const itemMap = new Map(sourceItems.map((item) => [item.id, { ...item }] as const));
    const visible = visibleIds
      .map((id) => itemMap.get(id))
      .filter((item): item is DashboardLayoutItem => Boolean(item))
      .map((item) => ({ ...item, visible: true }));
    const remaining = sourceItems
      .filter((item) => !visibleIds.includes(item.id))
      .map((item) => ({ ...item }));
    return repackDashboardLayoutItems([...visible, ...remaining]);
  }

  function handleStartEdit() {
    if (!canEditLayout) return;
    const next = normalizeDashboardLayout(savedLayout ?? getDefaultDashboardLayout());
    setDraftLayout(next);
    setLayoutError(null);
    setAddWidgetMenuOpen(false);
    setIsEditMode(true);
  }

  function handleDiscardLayout() {
    const reset = normalizeDashboardLayout(savedLayout ?? getDefaultDashboardLayout());
    setDraftLayout(reset);
    setIsEditMode(false);
    setAddWidgetMenuOpen(false);
    setResizeState(null);
  }

  function handleRestoreDefaultLayout() {
    setDraftLayout(getDefaultDashboardLayout());
    setAddWidgetMenuOpen(false);
  }

  async function handleSaveLayout() {
    const payload = normalizeDashboardLayout(draftLayout ?? savedLayout ?? getDefaultDashboardLayout());
    setLayoutSaving(true);
    setLayoutError(null);
    try {
      const response = await apiPut<DashboardLayoutResponse>("/dashboard/layout", {
        version: payload.version,
        desktop: payload.desktop,
        items: payload.items
      });
      const normalized = normalizeDashboardLayout(response);
      setSavedLayout(normalized);
      setDraftLayout(normalized);
      setIsEditMode(false);
      setAddWidgetMenuOpen(false);
    } catch (e) {
      setLayoutError(errMsg(e));
    } finally {
      setLayoutSaving(false);
    }
  }

  function handleWidgetDragStart(id: DashboardWidgetId, event: ReactDragEvent<HTMLElement>) {
    if (!isEditMode) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggedWidgetId(id);
  }

  function handleWidgetDrop(overId: DashboardWidgetId) {
    if (!isEditMode || !draggedWidgetId || draggedWidgetId === overId) {
      setDraggedWidgetId(null);
      return;
    }

    updateDraftItems((items) => {
      const visibleIds = items.filter((item) => item.visible && availableWidgetIdSet.has(item.id)).map((item) => item.id);
      const fromIndex = visibleIds.indexOf(draggedWidgetId);
      const toIndex = visibleIds.indexOf(overId);
      if (fromIndex < 0 || toIndex < 0) return items;
      const nextVisibleIds = [...visibleIds];
      const [movedId] = nextVisibleIds.splice(fromIndex, 1);
      if (!movedId) return items;
      nextVisibleIds.splice(toIndex, 0, movedId);
      return buildLayoutWithVisibleOrder(nextVisibleIds, items);
    });

    setDraggedWidgetId(null);
  }

  function handleWidgetDragEnd() {
    setDraggedWidgetId(null);
  }

  function handleHideWidget(id: DashboardWidgetId) {
    updateDraftItems((items) => {
      const visible = items
        .filter((item) => item.visible && item.id !== id)
        .map((item) => ({ ...item, visible: true }));
      const hidden = items
        .filter((item) => !item.visible || item.id === id)
        .map((item) => ({
          ...item,
          visible: item.id === id ? false : item.visible
        }));
      return repackDashboardLayoutItems([...visible, ...hidden]);
    });
  }

  function handleShowWidget(id: DashboardWidgetId) {
    updateDraftItems((items) => {
      const visible = items
        .filter((item) => item.visible)
        .map((item) => ({ ...item, visible: true }));
      const target = items.find((item) => item.id === id);
      const hidden = items
        .filter((item) => !item.visible && item.id !== id)
        .map((item) => ({ ...item, visible: false }));

      if (!target) return items;

      return repackDashboardLayoutItems([
        ...visible,
        { ...target, visible: true },
        ...hidden
      ]);
    });
    setAddWidgetMenuOpen(false);
  }

  function handleResizeStart(id: DashboardWidgetId, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!gridRef.current) return;
    event.preventDefault();
    const rect = gridRef.current.getBoundingClientRect();
    const currentItem = activeLayout.items.find((item) => item.id === id);
    if (!currentItem) return;
    setResizeState({
      id,
      startX: event.clientX,
      startY: event.clientY,
      startW: currentItem.w,
      startH: currentItem.h,
      containerWidth: rect.width
    });
  }

  return (
    <div>
      <section id="overview" className="dashboardSectionAnchor">
        <div className="dashboardHeader dashboardBuilderHeader">
          <div>
            <h2 style={{ margin: 0 }}>{t("title")}</h2>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("subtitle")}
            </div>
          </div>

          <div className="dashboardBuilderActions">
            {isEditMode ? (
              <>
                <button type="button" className="btn btnPrimary" onClick={() => void handleSaveLayout()} disabled={layoutSaving}>
                  {layoutSaving ? builderT("saving") : builderT("save")}
                </button>
                <button type="button" className="btn" onClick={handleDiscardLayout} disabled={layoutSaving}>
                  {builderT("discard")}
                </button>
                <button type="button" className="btn" onClick={handleRestoreDefaultLayout} disabled={layoutSaving}>
                  {builderT("restoreDefault")}
                </button>
                <div className="dashboardBuilderAddWidgetWrap">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setAddWidgetMenuOpen((current) => !current)}
                    disabled={layoutSaving}
                  >
                    {builderT("addWidget")}
                  </button>
                  {addWidgetMenuOpen ? (
                    <div className="dashboardBuilderAddWidgetMenu">
                      {hiddenAvailableItems.length === 0 ? (
                        <div className="dashboardBuilderAddWidgetEmpty">{builderT("addWidgetEmpty")}</div>
                      ) : (
                        hiddenAvailableItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="dashboardBuilderAddWidgetItem"
                            onClick={() => handleShowWidget(item.id)}
                          >
                            {widgetContent[item.id].title}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <button type="button" className="btn" onClick={handleStartEdit} disabled={!canEditLayout || layoutLoading}>
                {canEditLayout ? builderT("edit") : builderT("editDisabledMobile")}
              </button>
            )}
          </div>
        </div>

        {layoutLoading ? (
          <div className="dashboardBuilderMeta">{builderT("loading")}</div>
        ) : null}
        {layoutError ? (
          <div className="dashboardBuilderNotice">
            <strong>{builderT("errorTitle")}</strong> {layoutError}
          </div>
        ) : null}
        {isEditMode ? (
          <div className="dashboardBuilderMeta">{builderT("editingHint")}</div>
        ) : null}
      </section>

      {canEditLayout ? (
        <section className="dashboardSectionAnchor">
          <div ref={gridRef} className="dashboardWidgetDesktopGrid">
            {desktopItems.map((item) => {
              const meta = widgetMetaById.get(item.id);
              if (!meta) return null;
              return (
                <DashboardWidgetFrame
                  key={item.id}
                  item={item}
                  anchorId={meta.anchorId}
                  title={widgetContent[item.id].title}
                  editable={isEditMode}
                  isDragging={draggedWidgetId === item.id}
                  onDragStart={(event) => handleWidgetDragStart(item.id, event)}
                  onDragOver={(event) => {
                    if (!isEditMode || !draggedWidgetId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleWidgetDrop(item.id);
                  }}
                  onDragEnd={handleWidgetDragEnd}
                  onHide={() => handleHideWidget(item.id)}
                  onResizeStart={(event) => handleResizeStart(item.id, event)}
                >
                  {widgetContent[item.id].render()}
                </DashboardWidgetFrame>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="dashboardSectionAnchor">
          <div className="dashboardWidgetMobileStack">
            {desktopItems.map((item) => {
              const meta = widgetMetaById.get(item.id);
              if (!meta) return null;
              return (
                <div key={item.id} id={meta.anchorId} className="dashboardWidgetMobileItem">
                  {widgetContent[item.id].render()}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
