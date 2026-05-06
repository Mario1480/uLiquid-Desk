"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { BotVaultOnchainActionsCard } from "./OnchainVaultActions";
import type {
  BotVaultPnlReport,
  GridEventsResponse,
  GridFillsResponse,
  GridInstanceDetail,
  GridInstanceMarginMode,
  GridMetricsResponse,
  GridOrdersResponse,
  MeResponse
} from "./types";
import {
  asRecord,
  buildGridCycles,
  buildSparklinePoints,
  formatAdaptiveNumber,
  computeGridRuntimeMarkPrice,
  deriveUnrealizedPnlFromSnapshot,
  distancePctFromMark,
  errMsg,
  formatDateTime,
  formatNumber,
  formatVaultExecutionProviderLabel,
  readGridPositionValue
} from "./utils";

type Props = {
  instanceId: string;
  embedded?: boolean;
  onUpdated?: () => Promise<void> | void;
};

type LadderOrderRow = GridOrdersResponse["items"][number];
type GridEventListRow = GridEventsResponse["items"][number] & {
  groupedCount?: number;
};

const GRID_EVENT_NOISE_SIGNATURES = new Set([
  "EXECUTION_DECISION:grid_plan_executed",
  "EXECUTION_DECISION:grid_no_order_changes",
  "SIGNAL_DECISION:signal_ready",
  "GRID_PLAN_APPLIED:grid_window_no_change",
  "GRID_PLAN_BLOCKED:grid_reconciliation_local_open_missing_live"
]);

function shortenAddress(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "n/a";
  if (raw.length <= 14) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function firstExecutionPositionForSymbol(
  executionState: Record<string, unknown> | null | undefined,
  symbol: string | null | undefined
): Record<string, unknown> | null {
  const positions = Array.isArray(executionState?.positions) ? executionState.positions : [];
  const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
  const records = positions
    .map((row) => asRecord(row))
    .filter((row) => Object.keys(row).length > 0);
  if (!normalizedSymbol) return records[0] ?? null;
  return records.find((row) => String(row.symbol ?? "").trim().toUpperCase() === normalizedSymbol) ?? records[0] ?? null;
}

function readNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getStablecoinLabel(input: {
  executionProvider?: string | null;
}): string {
  const provider = String(input.executionProvider ?? "").trim().toLowerCase();
  if (provider === "hyperliquid" || provider === "hyperliquid_demo") return "USDC";
  return "USDT";
}

function replaceStablecoinUnit(label: string, stablecoinLabel: string): string {
  return label.replaceAll("USDT", stablecoinLabel);
}

function deriveGridEventSeverity(event: GridEventsResponse["items"][number]): string {
  const raw = String((event as { severity?: string | null }).severity ?? "").trim().toLowerCase();
  if (raw) return raw;
  const type = String(event.type ?? "").trim().toUpperCase();
  const message = String(event.message ?? "").trim().toLowerCase();
  if (type.includes("ERROR") || message.includes("error") || message.includes("failed")) return "error";
  if (type.includes("BLOCKED") || type.includes("UNAVAILABLE") || message.includes("blocked")) return "warn";
  return "info";
}

function isNoisyGridEvent(event: GridEventsResponse["items"][number]): boolean {
  const signature = `${String(event.type ?? "").trim().toUpperCase()}:${String(event.message ?? "").trim()}`;
  return GRID_EVENT_NOISE_SIGNATURES.has(signature);
}

function normalizeSettlementStageLabel(stage: string | null, tGrid: ReturnType<typeof useTranslations<"grid.instance">>): string {
  const normalized = String(stage ?? "").trim().toLowerCase();
  if (!normalized) return tGrid("none");
  switch (normalized) {
    case "perp_to_spot_pending":
      return tGrid("settlementStagePerpToSpotPending");
    case "spot_to_evm_pending":
      return tGrid("settlementStageSpotToEvmPending");
    case "evm_ready":
      return tGrid("settlementStageEvmReady");
    case "perp_to_spot_failed":
      return tGrid("settlementStagePerpToSpotFailed");
    case "spot_to_evm_failed":
      return tGrid("settlementStageSpotToEvmFailed");
    case "perp_to_spot_unsupported":
      return tGrid("settlementStagePerpToSpotUnsupported");
    case "spot_to_evm_unsupported":
      return tGrid("settlementStageSpotToEvmUnsupported");
    default:
      return normalized.replace(/_/g, " ");
  }
}

function normalizeFundingDisplayStatusLabel(status: string | null | undefined, tGrid: ReturnType<typeof useTranslations<"grid.instance">>): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return tGrid("none");
  switch (normalized) {
    case "deposit_pending_reconciliation":
      return tGrid("fundingStatusDepositPending");
    case "withdraw_pending_reconciliation":
      return tGrid("fundingStatusWithdrawPending");
    case "funding_confirmed":
      return tGrid("fundingStatusConfirmed");
    case "funding_failed_retryable":
      return tGrid("fundingStatusFailedRetryable");
    case "funding_failed_final":
      return tGrid("fundingStatusFailedFinal");
    case "funding_pending":
      return tGrid("fundingStatusPending");
    default:
      return normalized.replace(/_/g, " ");
  }
}

function normalizeFundingNextStepLabel(
  status: string | null | undefined,
  recoveryHint: string | null | undefined,
  tGrid: ReturnType<typeof useTranslations<"grid.instance">>
): string {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedHint = String(recoveryHint ?? "").trim().toLowerCase();
  if (normalizedStatus === "deposit_pending_reconciliation") return tGrid("fundingNextDepositPending");
  if (normalizedStatus === "withdraw_pending_reconciliation") return tGrid("fundingNextWithdrawPending");
  if (normalizedStatus === "funding_confirmed") return tGrid("fundingNextConfirmed");
  if (normalizedStatus === "funding_failed_retryable") return tGrid("fundingNextRetryable");
  if (normalizedHint === "request_user_action") return tGrid("fundingNextManualCheck");
  if (normalizedHint === "run_recovery") return tGrid("fundingNextRunRecovery");
  if (normalizedHint === "retry_reconcile") return tGrid("fundingNextRetryable");
  return tGrid("fundingNextPending");
}

export function GridInstanceDetailView({ instanceId, embedded = false, onUpdated }: Props) {
  const locale = useLocale() as AppLocale;
  const tGrid = useTranslations("grid.instance");

  const [detail, setDetail] = useState<GridInstanceDetail | null>(null);
  const [metrics, setMetrics] = useState<GridMetricsResponse | null>(null);
  const [orders, setOrders] = useState<GridOrdersResponse["items"]>([]);
  const [fills, setFills] = useState<GridFillsResponse["items"]>([]);
  const [events, setEvents] = useState<GridEventsResponse["items"]>([]);
  const [pnlReport, setPnlReport] = useState<BotVaultPnlReport | null>(null);
  const [isAdminViewer, setIsAdminViewer] = useState(false);

  const [tpPct, setTpPct] = useState<string>("");
  const [slPrice, setSlPct] = useState<string>("");
  const [marginMode, setMarginMode] = useState<GridInstanceMarginMode>("MANUAL");
  const [activeTab, setActiveTab] = useState<"overview" | "placed" | "fills" | "events" | "params">("overview");

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [compactLadder, setCompactLadder] = useState(false);
  const corePollInFlightRef = useRef(false);
  const heavyPollInFlightRef = useRef(false);
  const latestCoreLoadIdRef = useRef(0);
  const metricsPollInFlightRef = useRef(false);
  const latestMetricsLoadIdRef = useRef(0);

  const fallbackTotalPnl = useMemo(() => {
    const fromMetrics = Number(metrics?.metrics?.totalPnlUsd ?? NaN);
    if (Number.isFinite(fromMetrics)) return fromMetrics;
    const fromDetail = Number(detail?.metricsJson?.totalPnlUsd ?? NaN);
    if (Number.isFinite(fromDetail)) return fromDetail;
    const derivedUnrealized = deriveUnrealizedPnlFromSnapshot(metrics?.metrics?.positionSnapshot ?? detail?.metricsJson?.positionSnapshot);
    const realized = Number.isFinite(Number(detail?.botVault?.realizedNetUsd ?? NaN))
      ? Number(detail?.botVault?.realizedNetUsd ?? 0)
      : 0;
    return realized + (derivedUnrealized ?? 0);
  }, [detail, metrics]);

  const vaultRealizedNet = useMemo(() => Number(detail?.botVault?.realizedNetUsd ?? 0), [detail]);
  const vaultWithdrawable = useMemo(() => Number(detail?.botVault?.withdrawableUsd ?? 0), [detail]);
  const providerSummary = useMemo(() => detail?.botVault?.providerMetadataSummary ?? null, [detail]);
  const providerRaw = useMemo(() => detail?.botVault?.providerMetadataRaw ?? null, [detail]);
  const stablecoinLabel = useMemo(
    () => getStablecoinLabel({ executionProvider: detail?.botVault?.executionProvider }),
    [detail?.botVault?.executionProvider]
  );
  const provisioningStatus = useMemo(() => detail?.provisioningStatus ?? null, [detail]);
  const settlementMeta = useMemo(() => {
    const lifecycleOverrideState = readNullableString(providerRaw?.lifecycleOverrideState);
    const settlementStage = readNullableString(providerRaw?.settlementStage);
    const settlementLastUpdatedAt = readNullableString(providerRaw?.settlementLastUpdatedAt);
    const settlementReadyAt = readNullableString(providerRaw?.settlementReadyAt);
    const settlementPerpToSpotAmountUsd = readFiniteNumber(providerRaw?.settlementPerpToSpotAmountUsd);
    const settlementPerpToSpotTxHash = readNullableString(providerRaw?.settlementPerpToSpotTxHash);
    const settlementSpotToEvmAmountUsd = readFiniteNumber(providerRaw?.settlementSpotToEvmAmountUsd);
    const settlementLastError = readNullableString(providerRaw?.settlementLastError);
    const hasSettlementSignal = Boolean(
      lifecycleOverrideState
      || settlementStage
      || settlementLastUpdatedAt
      || settlementReadyAt
      || settlementPerpToSpotTxHash
      || settlementLastError
      || settlementPerpToSpotAmountUsd !== null
      || settlementSpotToEvmAmountUsd !== null
    );
    if (!hasSettlementSignal) return null;
    return {
      lifecycleOverrideState,
      settlementStage,
      settlementLastUpdatedAt,
      settlementReadyAt,
      settlementPerpToSpotAmountUsd,
      settlementPerpToSpotTxHash,
      settlementSpotToEvmAmountUsd,
      settlementLastError
    };
  }, [providerRaw]);
  const fundingDisplayMeta = useMemo(() => {
    const status = readNullableString(detail?.botVault?.fundingDisplayStatus);
    if (!status) return null;
    const recoveryHint = readNullableString(detail?.botVault?.fundingDisplayRecoveryHint);
    return {
      status,
      label: normalizeFundingDisplayStatusLabel(status, tGrid),
      nextStep: normalizeFundingNextStepLabel(status, recoveryHint, tGrid),
      reasonCode: readNullableString(detail?.botVault?.fundingDisplayReasonCode),
      recoveryHint,
      detail: readNullableString(detail?.botVault?.fundingDisplayDetail)
    };
  }, [detail?.botVault, tGrid]);
  const feeConfigSummary = useMemo(() => detail?.botVault?.feeConfigSummary ?? null, [detail]);

  const worstCaseLiqDistancePct = useMemo(() => {
    const fromMetrics = Number(metrics?.metrics?.worstCaseLiqDistancePct ?? NaN);
    if (Number.isFinite(fromMetrics)) return fromMetrics;
    const fromDetail = Number(detail?.metricsJson?.worstCaseLiqDistancePct ?? NaN);
    if (Number.isFinite(fromDetail)) return fromDetail;
    return null;
  }, [detail, metrics]);

  const liqDistanceMinPct = useMemo(() => {
    const fromMetrics = Number(metrics?.metrics?.liqDistanceMinPct ?? NaN);
    if (Number.isFinite(fromMetrics)) return fromMetrics;
    return 8;
  }, [metrics]);

  async function loadCore(options?: { background?: boolean }) {
    if (!instanceId) return;
    const isBackground = options?.background === true;
    const loadId = ++latestCoreLoadIdRef.current;
    const metricsLoadId = ++latestMetricsLoadIdRef.current;
    if (isBackground) {
      if (typeof document !== "undefined" && document.hidden) return;
      if (corePollInFlightRef.current) return;
      corePollInFlightRef.current = true;
    }
    if (!isBackground) {
      setLoading(true);
    }
    if (!isBackground) {
      setError(null);
    }
    try {
      const [detailResponse, metricsResponse] = await Promise.all([
        apiGet<GridInstanceDetail>(`/grid/instances/${instanceId}`),
        apiGet<GridMetricsResponse>(`/grid/instances/${instanceId}/metrics`)
      ]);
      if (loadId !== latestCoreLoadIdRef.current) return;

      setDetail(detailResponse);
      if (metricsLoadId === latestMetricsLoadIdRef.current) {
        setMetrics(metricsResponse);
      }
      setTpPct(detailResponse.tpPct == null ? "" : String(detailResponse.tpPct));
      setSlPct(detailResponse.slPrice == null ? "" : String(detailResponse.slPrice));
      setMarginMode(detailResponse.marginMode === "AUTO" ? "AUTO" : "MANUAL");
    } catch (loadError) {
      if (loadId !== latestCoreLoadIdRef.current) return;
      if (!isBackground) {
        setError(errMsg(loadError));
      } else {
        console.warn("grid instance core background refresh failed", loadError);
      }
    } finally {
      if (isBackground) {
        corePollInFlightRef.current = false;
      }
      if (!isBackground && loadId === latestCoreLoadIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadMetrics(options?: { background?: boolean }) {
    if (!instanceId) return;
    const isBackground = options?.background === true;
    const loadId = ++latestMetricsLoadIdRef.current;
    if (isBackground) {
      if (typeof document !== "undefined" && document.hidden) return;
      if (metricsPollInFlightRef.current) return;
      metricsPollInFlightRef.current = true;
    }
    try {
      const metricsResponse = await apiGet<GridMetricsResponse>(`/grid/instances/${instanceId}/metrics`);
      if (loadId !== latestMetricsLoadIdRef.current) return;
      setMetrics(metricsResponse);
    } catch (loadError) {
      if (loadId !== latestMetricsLoadIdRef.current) return;
      if (!isBackground) {
        setError(errMsg(loadError));
      } else {
        console.warn("grid instance metrics background refresh failed", loadError);
      }
    } finally {
      if (isBackground) {
        metricsPollInFlightRef.current = false;
      }
    }
  }

  async function loadHeavy(options?: { background?: boolean }) {
    if (!instanceId) return;
    const isBackground = options?.background === true;
    if (isBackground) {
      if (typeof document !== "undefined" && document.hidden) return;
      if (heavyPollInFlightRef.current) return;
      heavyPollInFlightRef.current = true;
    }
    try {
      const [ordersResult, fillsResult, eventsResult, pnlResult] = await Promise.allSettled([
        apiGet<GridOrdersResponse>(`/grid/instances/${instanceId}/orders`),
        apiGet<GridFillsResponse>(`/grid/instances/${instanceId}/fills`),
        apiGet<GridEventsResponse>(`/grid/instances/${instanceId}/events`),
        detail?.botVault?.id
          ? apiGet<BotVaultPnlReport>(`/vaults/bot-vaults/${detail.botVault.id}/pnl-report?fillsLimit=10`)
          : Promise.resolve(null)
      ]);

      setOrders(
        ordersResult.status === "fulfilled" && Array.isArray(ordersResult.value.items)
          ? ordersResult.value.items
          : []
      );
      setFills(
        fillsResult.status === "fulfilled" && Array.isArray(fillsResult.value.items)
          ? fillsResult.value.items
          : []
      );
      setEvents(
        eventsResult.status === "fulfilled" && Array.isArray(eventsResult.value.items)
          ? eventsResult.value.items
          : []
      );
      setPnlReport(pnlResult.status === "fulfilled" ? pnlResult.value : null);
    } finally {
      if (isBackground) {
        heavyPollInFlightRef.current = false;
      }
    }
  }

  useEffect(() => {
    void loadCore();
    void loadHeavy();
    const metricsTimer = setInterval(() => {
      void loadMetrics({ background: true });
    }, 2_000);
    const coreTimer = setInterval(() => {
      void loadCore({ background: true });
    }, 5_000);
    const heavyTimer = setInterval(() => {
      void loadHeavy({ background: true });
    }, 15_000);
    return () => {
      corePollInFlightRef.current = false;
      metricsPollInFlightRef.current = false;
      heavyPollInFlightRef.current = false;
      clearInterval(metricsTimer);
      clearInterval(coreTimer);
      clearInterval(heavyTimer);
    };
  }, [detail?.botVault?.id, instanceId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await apiGet<MeResponse>("/auth/me");
        if (!active) return;
        setIsAdminViewer(Boolean(me?.isSuperadmin || me?.hasAdminBackendAccess));
      } catch {
        if (!active) return;
        setIsAdminViewer(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setCompactLadder(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  const autoMarginCapRemaining = useMemo(() => {
    if (!detail) return null;
    if (detail.autoMarginMaxUSDT == null) return null;
    return Math.max(0, Number(detail.autoMarginMaxUSDT) - Number(detail.autoMarginUsedUSDT ?? 0));
  }, [detail]);

  const metricsRecord = useMemo(() => asRecord(metrics?.metrics ?? detail?.metricsJson ?? {}), [detail, metrics]);
  const executionStateRecord = useMemo(() => asRecord(detail?.executionState ?? null), [detail]);
  const stateRecord = useMemo(() => asRecord(metrics?.stateJson ?? detail?.stateJson ?? null), [detail, metrics]);
  const executionPosition = useMemo(
    () => firstExecutionPositionForSymbol(executionStateRecord, detail?.template?.symbol ?? null),
    [detail?.template?.symbol, executionStateRecord]
  );
  const runtimeMarkPrice = useMemo(
    () => computeGridRuntimeMarkPrice(detail?.bot?.runtime ?? null),
    [detail?.bot?.runtime]
  );
  const windowMeta = useMemo(() => asRecord(metricsRecord.windowMeta), [metricsRecord]);
  const initialSeed = useMemo(() => asRecord(metricsRecord.initialSeed), [metricsRecord]);
  const positionSnapshot = useMemo(() => asRecord(metricsRecord.positionSnapshot), [metricsRecord]);
  const openOrdersCount = orders.length;
  const activeBuys = Number(windowMeta.activeBuys ?? NaN);
  const activeSells = Number(windowMeta.activeSells ?? NaN);
  const activeOrdersTotal = Number(windowMeta.activeOrdersTotal ?? NaN);
  const recenterReason = String(windowMeta.recenterReason ?? "n/a");
  const windowLowPrice = Number(windowMeta.activeRangeLowPrice ?? NaN);
  const windowHighPrice = Number(windowMeta.activeRangeHighPrice ?? NaN);
  const buyRangeLowPrice = Number(windowMeta.activeBuyLowerPrice ?? NaN);
  const buyRangeHighPrice = Number(windowMeta.activeBuyUpperPrice ?? NaN);
  const sellRangeLowPrice = Number(windowMeta.activeSellLowerPrice ?? NaN);
  const sellRangeHighPrice = Number(windowMeta.activeSellUpperPrice ?? NaN);
  const initialSeedSide = String(initialSeed.seedSide ?? "n/a");
  const initialSeedQty = Number(initialSeed.seedQty ?? NaN);
  const initialSeedNotionalUsd = Number(initialSeed.seedNotionalUsd ?? NaN);
  const initialSeedMarginUsd = Number(initialSeed.seedMarginUsd ?? NaN);
  const currentPositionSide = String(
    readGridPositionValue(positionSnapshot, ["side", "direction"])
      ?? readGridPositionValue(executionPosition, ["side", "direction"])
      ?? "flat"
  );
  const currentPositionQty = Number(
    readGridPositionValue(positionSnapshot, ["qty", "size", "szi"])
      ?? readGridPositionValue(executionPosition, ["qty", "size", "szi"])
      ?? NaN
  );
  const currentPositionQtyAbs = Number.isFinite(currentPositionQty) ? Math.abs(currentPositionQty) : currentPositionQty;
  const currentPositionEntry = Number(
    readGridPositionValue(positionSnapshot, ["entryPrice", "entryPx", "avgEntryPrice"])
      ?? readGridPositionValue(executionPosition, ["entryPrice", "entryPx", "avgEntryPrice"])
      ?? NaN
  );
  const currentPositionMark = Number(
    readGridPositionValue(stateRecord, ["lastMarkPrice", "markPrice", "markPx", "midPx"])
      ?? readGridPositionValue(positionSnapshot, ["markPrice", "markPx", "mark", "midPx", "indexPrice", "oraclePx", "price"])
      ?? readGridPositionValue(executionPosition, ["markPrice", "markPx", "mark", "midPx", "indexPrice", "oraclePx", "price"])
      ?? runtimeMarkPrice
      ?? NaN
  );
  const buyOrders = useMemo(
    () => [...orders].filter((row) => row.side === "buy").sort((left, right) => Number(right.price ?? 0) - Number(left.price ?? 0)),
    [orders]
  );
  const sellOrders = useMemo(
    () => [...orders].filter((row) => row.side === "sell").sort((left, right) => Number(left.price ?? 0) - Number(right.price ?? 0)),
    [orders]
  );
  const placedBuyOrders = buyOrders;
  const placedSellOrders = sellOrders;
  const ladderDepth = embedded || compactLadder ? 16 : 26;
  const visibleBuyOrders = placedBuyOrders.slice(0, ladderDepth);
  const visibleSellOrders = placedSellOrders.slice(0, ladderDepth);
  const visibleBuyTopPrice = Number(visibleBuyOrders[0]?.price ?? NaN);
  const visibleBuyBottomPrice = Number(visibleBuyOrders[visibleBuyOrders.length - 1]?.price ?? NaN);
  const visibleSellTopPrice = Number(visibleSellOrders[0]?.price ?? NaN);
  const visibleSellBottomPrice = Number(visibleSellOrders[visibleSellOrders.length - 1]?.price ?? NaN);
  const nearestBuyPrice = Number.isFinite(visibleBuyTopPrice) && visibleBuyTopPrice > 0 ? visibleBuyTopPrice : NaN;
  const nearestSellPrice = Number.isFinite(visibleSellTopPrice) && visibleSellTopPrice > 0 ? visibleSellTopPrice : NaN;
  const visibleLadderMinPrice = useMemo(() => {
    const candidates = [
      visibleBuyTopPrice,
      visibleBuyBottomPrice,
      visibleSellTopPrice,
      visibleSellBottomPrice,
      windowLowPrice,
    ].filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length > 0 ? Math.min(...candidates) : NaN;
  }, [visibleBuyBottomPrice, visibleBuyTopPrice, visibleSellBottomPrice, visibleSellTopPrice, windowLowPrice]);
  const visibleLadderMaxPrice = useMemo(() => {
    const candidates = [
      visibleBuyTopPrice,
      visibleBuyBottomPrice,
      visibleSellTopPrice,
      visibleSellBottomPrice,
      windowHighPrice,
    ].filter((value) => Number.isFinite(value) && value > 0);
    return candidates.length > 0 ? Math.max(...candidates) : NaN;
  }, [visibleBuyBottomPrice, visibleBuyTopPrice, visibleSellBottomPrice, visibleSellTopPrice, windowHighPrice]);
  const marketWindowPositionPct = useMemo(() => {
    if (
      Number.isFinite(currentPositionMark)
      && Number.isFinite(nearestBuyPrice)
      && Number.isFinite(nearestSellPrice)
      && nearestSellPrice > nearestBuyPrice
    ) {
      const raw = ((currentPositionMark - nearestBuyPrice) / (nearestSellPrice - nearestBuyPrice)) * 100;
      return Math.min(100, Math.max(0, raw));
    }
    if (
      Number.isFinite(currentPositionMark)
      && Number.isFinite(visibleLadderMinPrice)
      && Number.isFinite(visibleLadderMaxPrice)
      && visibleLadderMaxPrice > visibleLadderMinPrice
    ) {
      const raw = ((currentPositionMark - visibleLadderMinPrice) / (visibleLadderMaxPrice - visibleLadderMinPrice)) * 100;
      return Math.min(100, Math.max(0, raw));
    }
    return 50;
  }, [currentPositionMark, nearestBuyPrice, nearestSellPrice, visibleLadderMaxPrice, visibleLadderMinPrice]);
  const gridCycles = useMemo(() => buildGridCycles(fills), [fills]);
  const groupedNoiseEventCount = useMemo(() => {
    const signatures = new Map<string, number>();
    for (const event of events) {
      if (!isNoisyGridEvent(event)) continue;
      const signature = `${event.type}:${event.message}`;
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }
    return Array.from(signatures.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  }, [events]);
  const visibleEvents = useMemo<GridEventListRow[]>(() => {
    const grouped = new Map<string, GridEventListRow>();
    const visible: GridEventListRow[] = [];
    for (const event of events) {
      if (!isNoisyGridEvent(event)) {
        visible.push(event);
        continue;
      }
      const signature = `${event.type}:${event.message}`;
      const current = grouped.get(signature);
      if (current) {
        current.groupedCount = (current.groupedCount ?? 1) + 1;
      } else {
        grouped.set(signature, { ...event, groupedCount: 1 });
      }
    }
    return [...visible, ...grouped.values()]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 40);
  }, [events]);
  const completedCycles = useMemo(() => gridCycles.filter((row) => row.closeFill), [gridCycles]);
  const cycle24hCount = useMemo(() => {
    const threshold = Date.now() - 24 * 60 * 60 * 1000;
    return completedCycles.filter((row) => new Date(row.closeFill?.fillTs ?? row.openFill.fillTs).getTime() >= threshold).length;
  }, [completedCycles]);
  const avgCyclesPerDay = useMemo(() => {
    if (completedCycles.length === 0) return 0;
    const firstTs = new Date(completedCycles[completedCycles.length - 1].closeFill?.fillTs ?? completedCycles[completedCycles.length - 1].openFill.fillTs).getTime();
    const lastTs = new Date(completedCycles[0].closeFill?.fillTs ?? completedCycles[0].openFill.fillTs).getTime();
    const days = Math.max((lastTs - firstTs) / (24 * 60 * 60 * 1000), 1);
    return completedCycles.length / days;
  }, [completedCycles]);
  const cycleRealizedProfit = useMemo(
    () => completedCycles.reduce((sum, row) => sum + Number(row.releasedProfitUsd ?? 0), 0),
    [completedCycles]
  );
  const pnlReportRealizedNet = useMemo(() => Number(pnlReport?.realizedPnlNet ?? NaN), [pnlReport]);
  const pnlReportWithdrawable = useMemo(() => Number(pnlReport?.netWithdrawableProfit ?? NaN), [pnlReport]);
  const releasedProfit = useMemo(() => {
    if (completedCycles.length > 0) return Math.max(cycleRealizedProfit, 0);
    if (Number.isFinite(pnlReportWithdrawable)) return Math.max(pnlReportWithdrawable, 0);
    if (Number.isFinite(vaultWithdrawable)) return Math.max(vaultWithdrawable, 0);
    if (Number.isFinite(pnlReportRealizedNet)) return Math.max(pnlReportRealizedNet, 0);
    if (Number.isFinite(vaultRealizedNet)) return Math.max(vaultRealizedNet, 0);
    return 0;
  }, [completedCycles.length, cycleRealizedProfit, pnlReportRealizedNet, pnlReportWithdrawable, vaultRealizedNet, vaultWithdrawable]);
  const displayedVaultWithdrawable = useMemo(() => {
    if (completedCycles.length > 0) return Math.max(vaultWithdrawable, releasedProfit);
    if (Number.isFinite(pnlReportWithdrawable)) return Math.max(vaultWithdrawable, pnlReportWithdrawable);
    return vaultWithdrawable;
  }, [completedCycles.length, pnlReportWithdrawable, releasedProfit, vaultWithdrawable]);
  const totalPnl = useMemo(() => fallbackTotalPnl, [fallbackTotalPnl]);
  const breakEvenPrice = useMemo(() => {
    if (Number.isFinite(currentPositionEntry) && currentPositionEntry > 0) return currentPositionEntry;
    return Number(initialSeed.seedPrice ?? NaN);
  }, [currentPositionEntry, initialSeed]);
  const performanceSeries = useMemo(() => {
    if (completedCycles.length === 0) return [0, totalPnl];
    const ordered = [...completedCycles].sort((a, b) => new Date(a.closeFill?.fillTs ?? a.openFill.fillTs).getTime() - new Date(b.closeFill?.fillTs ?? b.openFill.fillTs).getTime());
    let running = 0;
    const points: number[] = [];
    for (const row of ordered) {
      running += Number(row.realizedPnlUsd ?? 0);
      points.push(running);
    }
    if (Number.isFinite(totalPnl) && Math.abs((points[points.length - 1] ?? 0) - totalPnl) > 1e-9) {
      points.push(totalPnl);
    }
    return points;
  }, [completedCycles, totalPnl]);
  const performancePolyline = useMemo(() => buildSparklinePoints(performanceSeries), [performanceSeries]);
  const performanceStart = performanceSeries[0] ?? 0;
  const performanceEnd = performanceSeries[performanceSeries.length - 1] ?? 0;
  const performancePositive = performanceEnd >= performanceStart;
  const liqEstimateValue = useMemo(
    () => Number(metricsRecord.liqEstimateLong ?? metricsRecord.liqEstimateShort ?? NaN),
    [metricsRecord]
  );
  const describeOpenCycle = (cycle: typeof gridCycles[number]) =>
    cycle.openFill.side === "buy" ? tGrid("fillsWaiting") : tGrid("fillsWaitingBuyback");

  async function saveRisk(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("risk");
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/grid/instances/${detail.id}/risk`, {
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: marginMode === "AUTO"
      });
      setNotice(tGrid("riskUpdated"));
      await Promise.all([loadCore(), loadHeavy()]);
    } catch (riskError) {
      setError(errMsg(riskError));
    } finally {
      setBusyAction(null);
    }
  }

  async function endBot() {
    if (!detail) return;
    const confirmed = window.confirm(tGrid("confirmEnd", {
      name: detail.template?.name ?? tGrid("templateFallback"),
      symbol: detail.template?.symbol ?? "n/a"
    }));
    if (!confirmed) return;

    setBusyAction("end");
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/grid/instances/${detail.id}/end`, {});
      setNotice(tGrid("actionEndDone"));
      await Promise.all([
        loadCore(),
        loadHeavy(),
        Promise.resolve(onUpdated?.()).catch(() => undefined)
      ]);
    } catch (actionError) {
      setError(errMsg(actionError));
    } finally {
      setBusyAction(null);
    }
  }

  if (!instanceId) return null;

  return (
    <div className={embedded ? "gridEmbeddedDetail" : "botsPage"}>
      {!embedded ? (
        <div className="dashboardHeader">
          <div>
            <h2 style={{ margin: 0 }}>{tGrid("title")}</h2>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {tGrid("instanceId", { id: detail?.id ?? instanceId })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {detail && detail.state !== "archived" ? (
              <button
                type="button"
                className="btn btnStop"
                onClick={() => void endBot()}
                disabled={busyAction !== null}
              >
                {busyAction === "end" ? tGrid("loading") : tGrid("end")}
              </button>
            ) : null}
            <Link href={withLocalePath("/bots/catalog", locale)} className="btn">{tGrid("backMarketplace")}</Link>
            <Link href={withLocalePath("/bots", locale)} className="btn">{tGrid("backBots")}</Link>
          </div>
        </div>
      ) : null}

      {error ? <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="card" style={{ padding: 12, borderColor: "#22c55e", marginBottom: 12 }}>{notice}</div> : null}

      {!loading && detail ? (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="gridDetailShellHead gridDetailShellHeadInlineTabs">
            <div>
              <div style={{ fontWeight: 700, fontSize: embedded ? 20 : 24, lineHeight: 1.1 }}>
                {(detail.template?.name ?? tGrid("templateFallback"))} · {(detail.template?.symbol ?? "n/a")}
              </div>
            </div>
            <div className="gridRunningCardBadges">
              <span className="gridRunningModeBadge">
                {detail.template?.mode ?? "grid"} {Number.isFinite(Number(detail.leverage ?? NaN)) ? `${formatNumber(detail.leverage, 0)}x` : ""}
              </span>
              <span className={`badge ${detail.state === "running" ? "badgeOk" : detail.state === "paused" || detail.state === "funding_pending" ? "badgeWarn" : "badge"}`}>{detail.state}</span>
            </div>
          </div>
          {detail.state === "archived" ? (
            <div className="settingsMutedText" style={{ marginTop: 10, marginBottom: 10, color: "var(--warning)" }}>
              {tGrid("archivedBanner", {
                reason: detail.archivedReason ?? tGrid("none"),
                at: formatDateTime(detail.archivedAt ?? null)
              })}
            </div>
          ) : null}
          <div className="gridDetailTabs">
            {(["overview", "placed", "fills", "events", "params"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`gridDetailTab ${activeTab === tab ? "gridDetailTabActive" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tGrid(`tabs.${tab}`)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && detail && activeTab === "overview" ? (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="gridOverviewPanel">
            <section className="gridOverviewAllocCard">
              <div className="gridOverviewSectionTitle">{tGrid("overviewAllocTitle")}</div>
              <div className="gridOverviewAllocGrid">
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewCurrentPosition")}</div>
                  <div className="gridOverviewAllocValue">
                    {formatNumber(currentPositionQtyAbs, 6)} {currentPositionSide !== "flat" ? `(${currentPositionSide})` : ""}
                  </div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewAvgHoldPrice")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(currentPositionEntry, 2)}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewEstLiqPrice")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(Number(metricsRecord.liqEstimateLong ?? metricsRecord.liqEstimateShort ?? NaN), 2)}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewBreakEvenPrice")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(breakEvenPrice, 2)}</div>
                </div>
              </div>
            </section>

            <section className="gridOverviewChartCard">
              <div className="gridOverviewSectionTitle">{replaceStablecoinUnit(tGrid("overviewProfitTitle"), stablecoinLabel)}</div>
              <div className="gridOverviewChartMeta">
                {tGrid("overviewProfitMeta", {
                  tx24h: String(cycle24hCount),
                  totalTx: String(completedCycles.length)
                })}
              </div>
              <div className="gridOverviewChartWrap">
                <svg viewBox="0 0 880 220" className="gridOverviewChartSvg" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id={`gridOverviewProfitStroke-${instanceId}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      {performancePositive ? (
                        <>
                          <stop offset="0%" stopColor="#22c55e" />
                          <stop offset="100%" stopColor="#34d399" />
                        </>
                      ) : (
                        <>
                          <stop offset="0%" stopColor="#fb7185" />
                          <stop offset="100%" stopColor="#ef4444" />
                        </>
                      )}
                    </linearGradient>
                    <linearGradient id={`gridOverviewProfitFill-${instanceId}`} x1="0%" y1="0%" x2="0%" y2="100%">
                      {performancePositive ? (
                        <>
                          <stop offset="0%" stopColor="rgba(52,211,153,0.24)" />
                          <stop offset="100%" stopColor="rgba(52,211,153,0.02)" />
                        </>
                      ) : (
                        <>
                          <stop offset="0%" stopColor="rgba(251,113,133,0.24)" />
                          <stop offset="100%" stopColor="rgba(251,113,133,0.02)" />
                        </>
                      )}
                    </linearGradient>
                  </defs>
                  <line x1="0" y1="110" x2="880" y2="110" className="gridOverviewChartZero" />
                  <polygon points={`0,220 ${performancePolyline} 880,220`} fill={`url(#gridOverviewProfitFill-${instanceId})`} />
                  <polyline points={performancePolyline} fill="none" stroke={`url(#gridOverviewProfitStroke-${instanceId})`} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                <div className="gridOverviewChartFooter">
                  <span>{tGrid("overviewRangeLine", { low: formatNumber(windowLowPrice, 2), high: formatNumber(windowHighPrice, 2) })}</span>
                  <span>{tGrid("overviewActiveWindowLine", { buys: formatNumber(activeBuys, 0), sells: formatNumber(activeSells, 0) })}</span>
                </div>
              </div>
            </section>

            <section className="gridOverviewAllocCard">
              <div className="gridOverviewSectionTitle">{tGrid("overviewVaultTitle")}</div>
              <div className="gridOverviewAllocGrid">
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultRealized")}</div>
                  <div className="gridOverviewAllocValue">{formatAdaptiveNumber(releasedProfit)} {stablecoinLabel}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultWithdrawable")}</div>
                  <div className="gridOverviewAllocValue">{formatAdaptiveNumber(displayedVaultWithdrawable)} {stablecoinLabel}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultProvider")}</div>
                  <div className="gridOverviewAllocValue">{formatVaultExecutionProviderLabel(detail.botVault?.executionProvider)}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultExecutionStatus")}</div>
                  <div className="gridOverviewAllocValue">{detail.botVault?.executionStatus ?? tGrid("none")}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultFundingStatus")}</div>
                  <div className="gridOverviewAllocValue">{fundingDisplayMeta?.label ?? tGrid("none")}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultFundingNext")}</div>
                  <div className="gridOverviewAllocValue">{fundingDisplayMeta?.nextStep ?? tGrid("none")}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultFundingReason")}</div>
                  <div className="gridOverviewAllocValue">{fundingDisplayMeta?.reasonCode ?? tGrid("none")}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewVaultFundingRecovery")}</div>
                  <div className="gridOverviewAllocValue">{fundingDisplayMeta?.recoveryHint ?? tGrid("none")}</div>
                </div>
              </div>
              {fundingDisplayMeta?.detail ? (
                <div className="settingsMutedText" style={{ marginTop: 10 }}>
                  {fundingDisplayMeta.detail}
                </div>
              ) : null}
            </section>

            <section className="gridOverviewAllocCard">
              <div className="gridOverviewSectionTitle">Profit Share</div>
              <div className="gridOverviewAllocGrid">
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Contract version</div>
                  <div className="gridOverviewAllocValue">{detail.botVault?.contractVersion ?? "n/a"}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Accrued</div>
                  <div className="gridOverviewAllocValue">{formatAdaptiveNumber(detail.botVault?.profitShareAccruedUsd ?? 0)} {stablecoinLabel}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Fee paid total</div>
                  <div className="gridOverviewAllocValue">{formatAdaptiveNumber(detail.botVault?.feePaidTotal ?? 0)} {stablecoinLabel}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Locked total fee</div>
                  <div className="gridOverviewAllocValue">
                    {feeConfigSummary ? `${formatAdaptiveNumber(feeConfigSummary.totalFeeRatePct)}%` : "n/a"}
                  </div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Platform fee</div>
                  <div className="gridOverviewAllocValue">
                    {feeConfigSummary ? `${formatAdaptiveNumber(feeConfigSummary.platformFeeRatePct)}%` : "n/a"}
                  </div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">Affiliate fee</div>
                  <div className="gridOverviewAllocValue">
                    {feeConfigSummary ? `${formatAdaptiveNumber(feeConfigSummary.affiliateFeeRatePct)}%` : "n/a"}
                  </div>
                </div>
              </div>
              <div className="settingsMutedText" style={{ marginTop: 10 }}>
                Affiliate linked: {feeConfigSummary?.affiliateUserId ? "yes" : "no"}.
                {" "}
                Recipient: {feeConfigSummary?.affiliateRecipientAddress ?? "n/a"}.
                {" "}
                Locked at: {formatDateTime(feeConfigSummary?.feeConfigLockedAt ?? null)}.
              </div>
              <div className="botsDetailToolbar" style={{ marginTop: 10 }}>
                <Link className="btn" href={withLocalePath("/settings/affiliate", locale)}>
                  Open Affiliate Dashboard
                </Link>
                {isAdminViewer ? (
                  <Link className="btn" href={withLocalePath("/admin/vault-execution", locale)}>
                    Open Admin Vault Execution
                  </Link>
                ) : null}
              </div>
            </section>

            {settlementMeta ? (
              <section className="gridOverviewAllocCard">
                <div className="gridOverviewSectionTitle">{tGrid("settlementTitle")}</div>
                <div className="gridOverviewAllocGrid">
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementLifecycle")}</div>
                    <div className="gridOverviewAllocValue">{settlementMeta.lifecycleOverrideState ?? tGrid("none")}</div>
                  </div>
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementStage")}</div>
                    <div className="gridOverviewAllocValue">{normalizeSettlementStageLabel(settlementMeta.settlementStage, tGrid)}</div>
                  </div>
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementUpdatedAt")}</div>
                    <div className="gridOverviewAllocValue">{formatDateTime(settlementMeta.settlementLastUpdatedAt)}</div>
                  </div>
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementReadyAt")}</div>
                    <div className="gridOverviewAllocValue">{formatDateTime(settlementMeta.settlementReadyAt)}</div>
                  </div>
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementPerpToSpotAmount")}</div>
                    <div className="gridOverviewAllocValue">{formatAdaptiveNumber(settlementMeta.settlementPerpToSpotAmountUsd)} USDC</div>
                  </div>
                  <div className="gridOverviewAllocItem">
                    <div className="gridOverviewAllocLabel">{tGrid("settlementSpotToEvmAmount")}</div>
                    <div className="gridOverviewAllocValue">{formatAdaptiveNumber(settlementMeta.settlementSpotToEvmAmountUsd)} USDC</div>
                  </div>
                </div>
                {settlementMeta.settlementPerpToSpotTxHash ? (
                  <div className="settingsMutedText" style={{ marginTop: 10 }}>
                    {tGrid("settlementPerpToSpotTx", { txHash: settlementMeta.settlementPerpToSpotTxHash })}
                  </div>
                ) : null}
                {settlementMeta.settlementStage === "evm_ready" ? (
                  <div className="settingsMutedText" style={{ marginTop: 10, color: "#22c55e" }}>
                    {tGrid("settlementReadyHint")}
                  </div>
                ) : null}
                {settlementMeta.settlementLastError ? (
                  <div className="settingsMutedText" style={{ marginTop: 10, color: "#ef4444" }}>
                    {tGrid("settlementError", { error: settlementMeta.settlementLastError })}
                  </div>
                ) : null}
              </section>
            ) : null}

            <BotVaultOnchainActionsCard
              botVault={detail.botVault}
              hasOnchainBotVault={detail.hasOnchainBotVault}
              defaultAllocationUsd={Number(detail.investUsd ?? 0) + Number(detail.extraMarginUsd ?? 0)}
              gridInvestUsd={Number(detail.investUsd ?? 0)}
              extraMarginUsd={Number(detail.extraMarginUsd ?? 0)}
              provisioningStatus={provisioningStatus}
              onUpdated={async () => {
                await Promise.all([loadCore({ background: true }), loadHeavy({ background: true })]);
                await Promise.resolve(onUpdated?.()).catch(() => undefined);
              }}
            />

            <section className="gridOverviewAllocCard">
              <div className="gridOverviewSectionTitle">{tGrid("windowTitle")}</div>
              <div className="gridOverviewAllocGrid">
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("overviewWindowOrders")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(openOrdersCount, 0)} / {formatNumber(activeOrdersTotal, 0)}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("kpiActiveBuysSells")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(activeBuys, 0)} / {formatNumber(activeSells, 0)}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("kpiWorstLiqDistance")}</div>
                  <div className="gridOverviewAllocValue">{worstCaseLiqDistancePct == null ? "n/a" : `${formatNumber(worstCaseLiqDistancePct, 2)}%`}</div>
                </div>
                <div className="gridOverviewAllocItem">
                  <div className="gridOverviewAllocLabel">{tGrid("kpiLiqEstimate")}</div>
                  <div className="gridOverviewAllocValue">{formatNumber(liqEstimateValue, 2)}</div>
                </div>
              </div>
              <div className="gridOverviewChartFooter">
                <span>{tGrid("windowSummaryLine", {
                  target: formatNumber(activeOrdersTotal, 0),
                  buys: formatNumber(activeBuys, 0),
                  sells: formatNumber(activeSells, 0),
                  reason: recenterReason
                })}</span>
                <span>{tGrid("windowPriceLine", { low: formatNumber(windowLowPrice, 2), high: formatNumber(windowHighPrice, 2) })}</span>
              </div>
              {worstCaseLiqDistancePct !== null && worstCaseLiqDistancePct < liqDistanceMinPct ? (
                <div className="settingsMutedText" style={{ marginTop: 10, color: "#f59e0b" }}>
                  {tGrid("riskWarning", {
                    actual: formatNumber(worstCaseLiqDistancePct, 2),
                    min: formatNumber(liqDistanceMinPct, 2)
                  })}
                </div>
              ) : null}
            </section>

            <section className="gridOverviewIdCard">
              <div className="gridOverviewAllocLabel">{tGrid("overviewBotId")}</div>
              <div className="gridOverviewIdValue">{detail.id}</div>
            </section>

            {isAdminViewer ? (
              <section className="gridOverviewAllocCard">
                <div className="gridOverviewSectionTitle">{tGrid("overviewDiagnosticsTitle")}</div>
                <div className="settingsMutedText">{tGrid("allocationLine", {
                  allocationMode: detail.allocationMode,
                  budgetSplitPolicy: detail.budgetSplitPolicy,
                  longPct: formatNumber(detail.longBudgetPct, 2),
                  shortPct: formatNumber(detail.shortBudgetPct, 2),
                  marginPolicy: detail.marginPolicy
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("investLine", {
                  invest: formatNumber(detail.investUsd, 2),
                  leverage: String(detail.leverage),
                  extraMargin: formatNumber(detail.extraMarginUsd, 2)
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("vaultStatusLine", {
                  vaultStatus: String(detail.botVault?.status ?? "n/a"),
                  executionStatus: String(detail.botVault?.executionStatus ?? "n/a")
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("providerLine", {
                  provider: formatVaultExecutionProviderLabel(detail.botVault?.executionProvider),
                  mode: providerSummary?.providerMode ?? tGrid("none"),
                  venue: providerSummary?.marketDataExchange ?? tGrid("none"),
                  chain: providerSummary?.chain ?? tGrid("none")
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("providerSelectionLine", {
                  selectionReason: detail.pilotStatus?.providerSelectionReason ?? tGrid("none"),
                  pilotScope: detail.pilotStatus?.scope ?? tGrid("none"),
                  pilotReason: detail.pilotStatus?.reason ?? tGrid("none")
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("providerAddressesLine", {
                  vaultAddress: shortenAddress(providerSummary?.vaultAddress),
                  agentWallet: shortenAddress(providerSummary?.agentWallet),
                  subaccountAddress: shortenAddress(providerSummary?.subaccountAddress)
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("providerSyncLine", {
                  executionUnitId: detail.botVault?.executionUnitId ?? tGrid("none"),
                  lastAction: providerSummary?.lastAction ?? tGrid("none"),
                  lastSynced: formatDateTime(detail.botVault?.executionLastSyncedAt ?? null)
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("providerErrorLine", {
                  error: detail.botVault?.executionLastError ?? tGrid("none"),
                  lastErrorAt: formatDateTime(detail.botVault?.executionLastErrorAt ?? null)
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("lastPlanLine", {
                  lastPlan: formatDateTime(detail.lastPlanAt),
                  error: detail.lastPlanError || tGrid("none")
                })}</div>
                <div className="settingsMutedText" style={{ marginTop: 10 }}>{tGrid("seedLine", {
                  side: initialSeedSide,
                  qty: formatNumber(initialSeedQty, 6),
                  notional: formatNumber(initialSeedNotionalUsd, 2),
                  margin: formatNumber(initialSeedMarginUsd, 2)
                }).replaceAll("USDT", stablecoinLabel)}</div>
                <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("activeRangeLine", {
                  low: formatNumber(windowLowPrice, 2),
                  high: formatNumber(windowHighPrice, 2),
                  buyLow: formatNumber(buyRangeLowPrice, 2),
                  buyHigh: formatNumber(buyRangeHighPrice, 2),
                  sellLow: formatNumber(sellRangeLowPrice, 2),
                  sellHigh: formatNumber(sellRangeHighPrice, 2)
                })}</div>
                {detail.marginPolicy === "AUTO_ALLOWED" ? (
                  <div className="settingsMutedText" style={{ marginTop: 6 }}>{tGrid("autoPolicyLine", {
                    trigger: detail.autoMarginTriggerType ?? "n/a",
                    triggerValue: formatNumber(detail.autoMarginTriggerValue, 2),
                    step: formatNumber(detail.autoMarginStepUSDT, 2),
                    cooldown: formatNumber(detail.autoMarginCooldownSec, 0),
                    cap: formatNumber(detail.autoMarginMaxUSDT, 2)
                  }).replaceAll("USDT", stablecoinLabel)}</div>
                ) : null}
                {providerRaw ? (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700, userSelect: "none" }}>
                      {tGrid("providerMetadataDebugTitle")}
                    </summary>
                    <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.45 }}>
                      {JSON.stringify(providerRaw, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </section>
            ) : null}
          </div>
        </section>
      ) : null}

      {!loading && detail && activeTab === "params" ? (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>{tGrid("riskControlsTitle")}</h3>
          <form className="settingsFormGrid" onSubmit={saveRisk}>
            <label>
              {tGrid("tpPct")}
              <input className="input" type="number" min="0" step="0.01" value={tpPct} onChange={(event) => setTpPct(event.target.value)} />
            </label>
            <label>
              {tGrid("slPrice")}
              <input className="input" type="number" min="0" step="0.01" value={slPrice} onChange={(event) => setSlPct(event.target.value)} />
            </label>
            <label>
              {tGrid("marginMode")}
              <select
                className="input"
                value={marginMode}
                disabled={detail?.marginPolicy !== "AUTO_ALLOWED" || detail?.state === "archived"}
                onChange={(event) => setMarginMode(event.target.value === "AUTO" ? "AUTO" : "MANUAL")}
              >
                <option value="MANUAL">{tGrid("marginModeManual")}</option>
                <option value="AUTO">{tGrid("marginModeAuto")}</option>
              </select>
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btnPrimary" type="submit" disabled={busyAction !== null || detail?.state === "archived"}>{busyAction === "risk" ? tGrid("saving") : tGrid("saveRisk")}</button>
            </div>
          </form>
        </section>
      ) : null}

      {!loading && detail && activeTab === "placed" ? (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>{tGrid("ladderTitle")}</h3>
          <div className="gridPlacedPanel">
            <div className="gridPlacedHero">
              <div className="gridPlacedHeroBubbleWrap">
                <div className="gridPlacedHeroPositionMarker" style={{ left: `${marketWindowPositionPct}%` }} />
                <div className="gridPlacedHeroBubble">
                  {tGrid("placedHeroLine", {
                    qty: formatNumber(Number(visibleBuyOrders[0]?.qty ?? visibleSellOrders[0]?.qty ?? currentPositionQtyAbs ?? NaN), 6),
                    price: formatNumber(currentPositionMark, 2)
                  })}
                </div>
              </div>
              <div className="gridPlacedSplitBar">
                <div className="gridPlacedSplitBuy" style={{ width: `${marketWindowPositionPct}%` }} />
                <div className="gridPlacedSplitSell" style={{ width: `${100 - marketWindowPositionPct}%` }} />
              </div>
              <div className="gridPlacedLegend">
                <span>{tGrid("placedBuyPrice")}</span>
                <span>{tGrid("placedHowFarToFill")}</span>
                <span>{tGrid("placedSellPrice")}</span>
              </div>
            </div>

            <div className="gridPlacedLadder">
              <div className="gridPlacedCol">
                {visibleBuyOrders.length === 0 ? (
                  <div className="gridPlacedEmpty">{tGrid("noOrders")}</div>
                ) : visibleBuyOrders.map((row, index) => {
                  const distancePct = distancePctFromMark(row.price, currentPositionMark);
                  return (
                    <div key={row.id} className="gridPlacedRow gridPlacedRowBuy">
                      <span className="gridPlacedBadge gridPlacedBadgeBuy">{index + 1}</span>
                      <div className="gridPlacedPriceBlock">
                        <div className="gridPlacedPrice">{formatNumber(row.price, 2)}</div>
                        <div className="gridPlacedQty">{formatNumber(row.qty, 6)}</div>
                      </div>
                      <div className="gridPlacedDistance gridPlacedDistanceBuy">{distancePct === null ? "n/a" : `${formatNumber(distancePct, 2)}%`}</div>
                    </div>
                  );
                })}
              </div>

              <div className="gridPlacedMidCol">
                <div className="gridPlacedMidLine" />
              </div>

              <div className="gridPlacedCol">
                {visibleSellOrders.length === 0 ? (
                  <div className="gridPlacedEmpty">{tGrid("noOrders")}</div>
                ) : visibleSellOrders.map((row, index) => {
                  const distancePct = distancePctFromMark(row.price, currentPositionMark);
                  return (
                    <div key={row.id} className="gridPlacedRow gridPlacedRowSell">
                      <div className="gridPlacedDistance gridPlacedDistanceSell">{distancePct === null ? "n/a" : `${formatNumber(distancePct, 2)}%`}</div>
                      <div className="gridPlacedPriceBlock gridPlacedPriceBlockSell">
                        <div className="gridPlacedPrice">{formatNumber(row.price, 2)}</div>
                        <div className="gridPlacedQty">{formatNumber(row.qty, 6)}</div>
                      </div>
                      <span className="gridPlacedBadge gridPlacedBadgeSell">{index + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="gridPlacedSummary">
              {tGrid("placedWindowSummary", {
                buys: formatNumber(activeBuys, 0),
                sells: formatNumber(activeSells, 0),
                low: formatNumber(visibleLadderMinPrice, 2),
                high: formatNumber(visibleLadderMaxPrice, 2)
              })}
            </div>
          </div>

          {isAdminViewer ? (
            <section className="card" style={{ padding: 12, marginBottom: 12 }}>
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 700, userSelect: "none" }}>{tGrid("openOrdersTitle")}</summary>
                <div className="settingsMutedText" style={{ marginTop: 8, marginBottom: 8 }}>{tGrid("openOrdersAdminHint")}</div>
                <div className="tableWrap">
                  <table className="tableCompact">
                    <thead>
                      <tr>
                        <th>{tGrid("tableUpdated")}</th>
                        <th>{tGrid("tableStatus")}</th>
                        <th>{tGrid("tableLegIdx")}</th>
                        <th>{tGrid("tableIntent")}</th>
                        <th>{tGrid("tableSide")}</th>
                        <th>{tGrid("tablePrice")}</th>
                        <th>{tGrid("tableQty")}</th>
                        <th>{tGrid("tableClientOrder")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr><td colSpan={8}>{tGrid("noOrders")}</td></tr>
                      ) : orders.map((row) => (
                        <tr key={row.id}>
                          <td>{formatDateTime(row.updatedAt)}</td>
                          <td>{row.status}</td>
                          <td>{row.gridLeg}/{row.gridIndex}</td>
                          <td>{row.intentType}</td>
                          <td>{row.side}</td>
                          <td>{formatNumber(row.price, 4)}</td>
                          <td>{formatNumber(row.qty, 6)}</td>
                          <td>{row.clientOrderId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          ) : null}
        </section>
      ) : null}

      {!loading && detail && activeTab === "fills" ? (
        <section className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="gridTransactionsStats">
            <div className="gridTransactionsStatCard">
              <div className="gridTransactionsStatLabel">{tGrid("fills24hTxs")}</div>
              <div className="gridTransactionsStatValue">{cycle24hCount}</div>
            </div>
            <div className="gridTransactionsStatCard">
              <div className="gridTransactionsStatLabel">{tGrid("fillsHistoryTxs")}</div>
              <div className="gridTransactionsStatValue">{completedCycles.length}</div>
            </div>
            <div className="gridTransactionsStatCard">
              <div className="gridTransactionsStatLabel">{tGrid("fillsAvgTxPerDay")}</div>
              <div className="gridTransactionsStatValue">{formatNumber(avgCyclesPerDay, 2)}</div>
            </div>
          </div>

          <div className="gridTransactionsReleased">
            <span>{tGrid("fillsReleasedProfit")}</span>
            <strong className={releasedProfit >= 0 ? "gridTransactionsProfitPositive" : "gridTransactionsProfitNegative"}>
              {formatNumber(releasedProfit, 2)} {stablecoinLabel}
            </strong>
          </div>

          <div className="gridTransactionsTable">
            <div className="gridTransactionsHead">
              <span>{replaceStablecoinUnit(tGrid("fillsProfitCol"), stablecoinLabel)}</span>
              <span>{tGrid("tableTime")}</span>
              <span>{tGrid("tablePrice")}</span>
              <span>{tGrid("tableNotional")}</span>
              <span>{tGrid("tableFee")}</span>
            </div>
            {gridCycles.length === 0 ? (
              <div className="gridTransactionsEmpty">{tGrid("noFills")}</div>
            ) : gridCycles.map((row, index) => {
              const pnl = row.realizedPnlUsd;
              const pnlClass = pnl == null ? "gridTransactionsProfitWaiting" : pnl >= 0 ? "gridTransactionsProfitPositive" : "gridTransactionsProfitNegative";
              return (
                <div key={row.id} className="gridTransactionsRow">
                  <div className="gridTransactionsProfitCell">
                    <div className={`gridTransactionsProfitBadge ${pnlClass}`}>
                      {pnl == null ? tGrid("fillsWaiting") : `${formatNumber(pnl, 6)} ${stablecoinLabel}`}
                    </div>
                    <div className="gridTransactionsCycleId">#{Math.max(gridCycles.length - index, 1)}</div>
                  </div>
                  <div className="gridTransactionsStackCell">
                    {row.closeFill ? (
                      <>
                        <div className="gridTransactionsPrimary">{formatDateTime(row.closeFill.fillTs)}</div>
                        <div className={`gridTransactionsTradeTag ${row.closeFill.side === "sell" ? "gridTransactionsTradeTagSell" : "gridTransactionsTradeTagBuy"}`}>{row.closeFill.side}</div>
                        <div className="gridTransactionsSecondary">{formatDateTime(row.openFill.fillTs)}</div>
                        <div className={`gridTransactionsTradeTag ${row.openFill.side === "buy" ? "gridTransactionsTradeTagBuy" : "gridTransactionsTradeTagSell"}`}>{row.openFill.side}</div>
                      </>
                    ) : (
                      <>
                        <div className="gridTransactionsPrimary">{describeOpenCycle(row)}</div>
                        <div className="gridTransactionsSecondary">{formatDateTime(row.openFill.fillTs)}</div>
                        <div className={`gridTransactionsTradeTag ${row.openFill.side === "buy" ? "gridTransactionsTradeTagBuy" : "gridTransactionsTradeTagSell"}`}>{row.openFill.side}</div>
                      </>
                    )}
                  </div>
                  <div className="gridTransactionsStackCell">
                    {row.closeFill ? (
                      <>
                        <div className="gridTransactionsPrimary">{formatNumber(row.closeFill.fillPrice, 2)}</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.fillPrice, 2)}</div>
                      </>
                    ) : (
                      <>
                        <div className="gridTransactionsPrimary">--</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.fillPrice, 2)}</div>
                      </>
                    )}
                  </div>
                  <div className="gridTransactionsStackCell">
                    {row.closeFill ? (
                      <>
                        <div className="gridTransactionsPrimary">{formatNumber(row.closeFill.fillNotionalUsd, 5)}</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.fillNotionalUsd, 5)}</div>
                      </>
                    ) : (
                      <>
                        <div className="gridTransactionsPrimary">--</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.fillNotionalUsd, 5)}</div>
                      </>
                    )}
                  </div>
                  <div className="gridTransactionsStackCell">
                    {row.closeFill ? (
                      <>
                        <div className="gridTransactionsPrimary">{formatNumber(row.closeFill.feeUsd, 6)} {stablecoinLabel}</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.feeUsd, 6)} {stablecoinLabel}</div>
                      </>
                    ) : (
                      <>
                        <div className="gridTransactionsPrimary">--</div>
                        <div className="gridTransactionsSecondary">{formatNumber(row.openFill.feeUsd, 6)} {stablecoinLabel}</div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {!loading && detail && activeTab === "events" ? (
        <section className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>{tGrid("recentEventsTitle")}</h3>
          {groupedNoiseEventCount > 0 ? (
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {tGrid("recentEventsGroupedHint", { count: String(groupedNoiseEventCount) })}
            </div>
          ) : null}
          <div className="tableWrap">
            <table className="tableCompact">
              <thead>
                <tr>
                  <th>{tGrid("tableTime")}</th>
                  <th>{tGrid("tableType")}</th>
                  <th>{tGrid("tableSeverity")}</th>
                  <th>{tGrid("tableMessage")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.length === 0 ? (
                  <tr><td colSpan={4}>{tGrid("noEvents")}</td></tr>
                ) : visibleEvents.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.type}</td>
                    <td>{deriveGridEventSeverity(row)}</td>
                    <td style={{ maxWidth: 460, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {row.message}
                      {(row.groupedCount ?? 1) > 1 ? ` (${tGrid("recentEventsGroupedSuffix", { count: String(row.groupedCount) })})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
