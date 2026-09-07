"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskLink } from "@/components/desk/DeskLink";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ApiError, apiGet, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import SymbolSearchSelect from "../../components/SymbolSearchSelect";
import { AppIcon } from "../components/AppIcon";
import { MetricTile, Notice, PageHeader, StatusBadge } from "../components/ui";
import {
  buildTradeDeskPrefillPayload,
  TRADE_DESK_PREFILL_SESSION_KEY,
  type PredictionPrefillSource
} from "../../src/schemas/tradeDeskPrefill";
import {
  formatRelativeTime,
  isRecentTimestamp,
  parsePredictionChangeReason,
  type PredictionSignalFlip
} from "../../src/predictions/refreshUi";
import {
  strategyBucketFromKind,
  type StrategyLimitBucket
} from "../../src/access/accessSection";
import {
  isProductFeatureAllowed,
  titleForProductFeature,
  type ProductFeatureGateMap
} from "../../src/access/productFeatureGates";
import {
  ActivePredictions,
  PredictionCopierEligibility,
  PredictionCreateWizard,
  PredictionDetailDrawer,
  PredictionHistory,
  PredictionPerformance,
  PredictionsOverview,
  averageConfidence,
  buildPredictionCopierReviewHref,
  type PredictionsView,
  type PredictionWizardStep
} from "../../components/predictions";

type PredictionSignal = "up" | "down" | "neutral";
type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type ResponseLanguage = "de" | "en";
type DirectionPreference = "long" | "short" | "either";
type SortMode = "newest" | "confidence" | "move";
type RunningStatusFilter = "all" | "running" | "paused";
type HistoryResultFilter = "all" | "pending" | "closed" | "tp" | "sl" | "expired";
type HistoryProviderFilter = "all" | StrategyKind;
type SignalSource = "local" | "ai";
type CreateSignalMode = "local_only" | "ai_only" | "both";
type PredictionRefreshStatus = "ok" | "degraded";
type PredictionActionState = "ready" | "disagreement" | "below_target" | "neutral" | "no_account" | "degraded";
type AnalysisKind = "trading_with_intelligence" | "market_intelligence";
type MarketIntelligenceHorizon = "intraday" | "24h" | "7d";

type MarketIntelligencePreview = {
  dataAgeSeconds: number | null;
  degraded: boolean;
  warnings: string[];
  news: Array<{ id: string; title: string; sourceName: string; sourceUrl: string }>;
  events: Array<{ id: string; title: string; scheduledAt: string; sourceName: string }>;
};

type AiPredictionSummary = {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
};

type PublicAiPromptItem = {
  id: string;
  name: string;
  indicatorKeys: string[];
  timeframes?: PredictionTimeframe[];
  runTimeframe?: PredictionTimeframe | null;
  timeframe: PredictionTimeframe | null;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  isPublic?: boolean;
  updatedAt: string | null;
};

type OwnAiPromptsResponse = {
  items: PublicAiPromptItem[];
  strategyFeatureEnabled: boolean;
};

type PublicAiPromptLicensePolicy = {
  mode: "off" | "warn" | "enforce";
  allowedPublicPromptIds: string[];
  enforcementActive: boolean;
};

type PublicCompositeStrategyItem = {
  id: string;
  name: string;
  description: string | null;
  version: string;
};

type PublicLocalStrategyItem = {
  id: string;
  strategyType: string;
  name: string;
  description: string | null;
  version: string;
  updatedAt: string | null;
};

type StrategyKind = "ai" | "local" | "composite";
type StrategyRef = {
  kind: StrategyKind;
  id: string;
  name: string | null;
};

type StrategyEntitlements = {
  plan: "free" | "pro" | "premium" | "enterprise";
  allowedStrategyKinds: StrategyKind[];
  allowedStrategyIds: string[] | null;
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
  aiMonthlyBudgetUsd: number | null;
  source: "db" | "plan_default";
};

type PredictionDefaultsResponse = {
  signalMode: CreateSignalMode;
};

type SubscriptionQuotaResponse = {
  billingEnabled: boolean;
  featureGates?: ProductFeatureGateMap;
  limits: {
    predictions: {
      local: {
        maxRunning: number | null;
      };
      ai: {
        maxRunning: number | null;
      };
      composite: {
        maxRunning: number | null;
      };
    };
  };
  usage: {
    predictions: {
      local: {
        running: number;
      };
      ai: {
        running: number;
      };
      composite: {
        running: number;
      };
    };
  };
};

type PredictionListItem = {
  id: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  tsCreated: string;
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  explanation: string;
  tags: string[];
  autoScheduleEnabled?: boolean;
  confidenceTargetPct?: number;
  outcomeStatus?: string;
  outcomeResult?: string | null;
  outcomePnlPct?: number | null;
  maxFavorablePct?: number | null;
  maxAdversePct?: number | null;
  outcomeEvaluatedAt?: string | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  horizonMs?: number | null;
  realizedReturnPct?: number | null;
  realizedEvaluatedAt?: string | null;
  realizedHit?: boolean | null;
  realizedAbsError?: number | null;
  realizedSqError?: number | null;
  exchange: string;
  accountId: string | null;
  lastUpdatedAt?: string | null;
  lastChangeReason?: string | null;
  signalMode?: CreateSignalMode;
  localPrediction?: AiPredictionSummary | null;
  aiPrediction?: AiPredictionSummary | null;
  aiPromptTemplateId?: string | null;
  aiPromptTemplateName?: string | null;
  localStrategyId?: string | null;
  localStrategyName?: string | null;
  compositeStrategyId?: string | null;
  compositeStrategyName?: string | null;
  strategyRef?: StrategyRef | null;
  refreshStatus?: PredictionRefreshStatus;
  lastRefreshAttemptAt?: string | null;
  lastRefreshErrorAt?: string | null;
  lastRefreshError?: string | null;
  refreshFailureCount?: number;
  modelVersion?: string | null;
};

type PredictionEventItem = {
  id: string;
  stateId: string;
  tsCreated: string | null;
  changeType: string;
  reason: string | null;
  delta: Record<string, unknown> | null;
  prevSnapshot: unknown;
  newSnapshot: unknown;
  modelVersion: string | null;
};

type PredictionDetailResponse = PredictionPrefillSource & {
  id: string;
  expectedMovePct: number;
  featureSnapshot?: Record<string, unknown>;
  indicators?: {
    rsi_14?: number | null;
    macd?: { line?: number | null; signal?: number | null; hist?: number | null } | null;
    bb?: {
      upper?: number | null;
      mid?: number | null;
      lower?: number | null;
      width_pct?: number | null;
      pos?: number | null;
    } | null;
    vwap?: {
      value?: number | null;
      dist_pct?: number | null;
      mode?: "session_utc" | "rolling_20";
      sessionStartUtcMs?: number | null;
    } | null;
    adx?: { adx_14?: number | null; plus_di_14?: number | null; minus_di_14?: number | null } | null;
    stochrsi?: {
      rsi_len?: number | null;
      stoch_len?: number | null;
      smooth_k?: number | null;
      smooth_d?: number | null;
      k?: number | null;
      d?: number | null;
      value?: number | null;
    } | null;
    volume?: {
      lookback?: number | null;
      vol_z?: number | null;
      rel_vol?: number | null;
      vol_ema_fast?: number | null;
      vol_ema_slow?: number | null;
      vol_trend?: number | null;
    } | null;
    fvg?: {
      lookback?: number | null;
      fill_rule?: "overlap" | "mid_touch";
      open_bullish_count?: number | null;
      open_bearish_count?: number | null;
      nearest_bullish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      nearest_bearish_gap?: {
        upper?: number | null;
        lower?: number | null;
        mid?: number | null;
        dist_pct?: number | null;
        age_bars?: number | null;
      } | null;
      last_created?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
      last_filled?: {
        type?: "bullish" | "bearish" | null;
        age_bars?: number | null;
      } | null;
    } | null;
    atr_pct?: number | null;
    dataGap?: boolean;
  } | null;
  riskFlags?: {
    dataGap?: boolean;
  } | null;
  realized?: {
    realizedReturnPct: number | null;
    evaluatedAt: string | null;
    errorMetrics: Record<string, unknown> | null;
  } | null;
  events?: PredictionEventItem[];
};

type ExchangeAccountItem = {
  id: string;
  exchange: string;
  label: string;
  supportsSpotManual?: boolean;
  supportsPerpManual?: boolean;
};

type SymbolItem = {
  symbol: string;
  tradable: boolean;
};

type RunningPredictionItem = {
  id: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string;
  exchange: string;
  label: string;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage: number | null;
  signalMode: CreateSignalMode;
  aiPromptTemplateId?: string | null;
  aiPromptTemplateName?: string | null;
  localStrategyId?: string | null;
  localStrategyName?: string | null;
  compositeStrategyId?: string | null;
  compositeStrategyName?: string | null;
  strategyRef?: StrategyRef | null;
  paused: boolean;
  tsCreated: string;
  nextRunAt: string;
  dueInSec: number;
  refreshStatus?: PredictionRefreshStatus;
  lastRefreshAttemptAt?: string | null;
  lastRefreshErrorAt?: string | null;
  lastRefreshError?: string | null;
  refreshFailureCount?: number;
};

type PredictionQualitySummary = {
  resetAt?: string | null;
  sampleSize: number;
  tp: number;
  sl: number;
  expired: number;
  skipped: number;
  invalid: number;
  winRatePct: number | null;
  avgOutcomePnlPct: number | null;
};

type PredictionMetricsResponse = {
  resetAt?: string | null;
  timeframe: PredictionTimeframe | null;
  symbol: string | null;
  from: string | null;
  to: string | null;
  bins: number;
  evaluatedCount: number;
  hitRate: number | null;
  mae: number | null;
  mse: number | null;
  calibrationBins: Array<{
    binFrom: number;
    binTo: number;
    avgConf: number | null;
    accuracy: number | null;
    n: number;
  }>;
};

const TIMEFRAMES: PredictionTimeframe[] = ["5m", "15m", "1h", "4h", "1d"];

function timeframeMs(value: PredictionTimeframe): number {
  if (value === "5m") return 5 * 60 * 1000;
  if (value === "15m") return 15 * 60 * 1000;
  if (value === "1h") return 60 * 60 * 1000;
  if (value === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function fmtMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function nextAutoRunText(
  row: Pick<PredictionListItem, "autoScheduleEnabled" | "timeframe" | "tsCreated">,
  nowMs: number,
  labels: {
    disabled: string;
    unknown: string;
    dueNow: string;
    inPrefix: string;
  } = {
    disabled: "disabled",
    unknown: "unknown",
    dueNow: "due now",
    inPrefix: "in"
  }
): string {
  if (!row.autoScheduleEnabled) return labels.disabled;
  const ts = new Date(row.tsCreated).getTime();
  if (!Number.isFinite(ts)) return labels.unknown;
  const dueAt = ts + timeframeMs(row.timeframe);
  const diff = dueAt - nowMs;
  if (diff <= 0) return labels.dueNow;
  return `${labels.inPrefix} ${fmtMs(diff)}`;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function quotaErrorMessage(e: unknown, tPred: ReturnType<typeof useTranslations<"predictions">>): string | null {
  if (!(e instanceof ApiError)) return null;
  const code =
    (typeof e.payload?.error === "string" && e.payload.error)
    || (typeof e.payload?.code === "string" && e.payload.code)
    || (typeof e.message === "string" ? e.message : "");
  if (code === "prediction_running_limit_exceeded_ai") {
    return tPred("create.errors.runningAi");
  }
  if (code === "prediction_total_limit_exceeded_ai") {
    return tPred("create.errors.runningAi");
  }
  if (code === "prediction_running_limit_exceeded_composite") {
    return tPred("create.errors.runningComposite");
  }
  if (code === "prediction_total_limit_exceeded_composite") {
    return tPred("create.errors.runningComposite");
  }
  return null;
}

function fmtConfidence(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, normalized));
  return `${clamped.toFixed(1)}%`;
}

function confidenceToPct(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function signalBadgeStyle(signal: PredictionSignal) {
  if (signal === "up") return { borderColor: "#10b981", color: "#10b981" };
  if (signal === "down") return { borderColor: "#ef4444", color: "#ef4444" };
  return { borderColor: "#94a3b8", color: "#94a3b8" };
}

function outcomeLabel(outcomeStatus?: string, outcomeResult?: string | null): string {
  if (outcomeStatus !== "closed") return "pending";
  if (!outcomeResult) return "closed";
  return outcomeResult;
}

function toNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readAiPrediction(value: unknown): AiPredictionSummary | null {
  const raw = asRecord(value);
  const signal =
    raw.signal === "up" || raw.signal === "down" || raw.signal === "neutral"
      ? raw.signal
      : null;
  const expectedMoveRaw = toNum(raw.expectedMovePct);
  const confidenceRaw = toNum(raw.confidence);
  if (!signal || expectedMoveRaw === null || confidenceRaw === null) return null;
  const normalizedConfidence = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    expectedMovePct: Math.max(0, Math.min(25, Math.abs(expectedMoveRaw))),
    confidence: Math.max(0, Math.min(1, normalizedConfidence))
  };
}

function resolveSignal(row: PredictionListItem, source: SignalSource): PredictionSignal {
  if (source === "local" && row.localPrediction) return row.localPrediction.signal;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.signal;
  return row.signal;
}

function resolveConfidence(row: PredictionListItem, source: SignalSource): number {
  if (source === "local" && row.localPrediction) return row.localPrediction.confidence;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.confidence;
  return row.confidence;
}

function resolveExpectedMove(row: PredictionListItem, source: SignalSource): number {
  if (source === "local" && row.localPrediction) return row.localPrediction.expectedMovePct;
  if (source === "ai" && row.aiPrediction) return row.aiPrediction.expectedMovePct;
  return row.expectedMovePct;
}

function signalModeForRow(row: Pick<PredictionListItem, "signalMode">): CreateSignalMode {
  if (row.signalMode === "local_only" || row.signalMode === "ai_only" || row.signalMode === "both") {
    return row.signalMode;
  }
  return "both";
}

function isRowDisagreementRelevant(row: Pick<PredictionListItem, "signalMode">): boolean {
  return signalModeForRow(row) === "both";
}

function getEffectiveRowSource(
  row: Pick<PredictionListItem, "signalMode">,
  selectedSource: SignalSource
): SignalSource {
  const mode = signalModeForRow(row);
  if (mode === "ai_only") return "ai";
  if (mode === "local_only") return "local";
  return selectedSource;
}

function signalModeLabel(
  mode: CreateSignalMode | undefined,
  labels: {
    localOnly: string;
    aiOnly: string;
    both: string;
  } = {
    localOnly: "local only",
    aiOnly: "ai only",
    both: "both"
  }
): string {
  if (mode === "local_only") return labels.localOnly;
  if (mode === "ai_only") return labels.aiOnly;
  return labels.both;
}

function normalizeStrategyRef(value: unknown): StrategyRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind =
    raw.kind === "ai" || raw.kind === "local" || raw.kind === "composite"
      ? raw.kind
      : null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : null;
  if (!kind || !id) return null;
  return { kind, id, name };
}

function isPredictionExecutionAccountEligible(account: ExchangeAccountItem): boolean {
  if (typeof account.supportsSpotManual === "boolean" || typeof account.supportsPerpManual === "boolean") {
    return Boolean(account.supportsSpotManual || account.supportsPerpManual);
  }
  return true;
}

function strategyKindLabel(kind: StrategyKind): string {
  if (kind === "ai") return "AI";
  if (kind === "local") return "Local";
  return "Composite";
}

function strategyRefLabel(
  strategyRef: StrategyRef | null | undefined,
  fallback: {
    aiPromptTemplateName?: string | null;
    localStrategyName?: string | null;
    compositeStrategyName?: string | null;
  } = {}
): string {
  if (!strategyRef) {
    if (fallback.compositeStrategyName) return `Composite · ${fallback.compositeStrategyName}`;
    if (fallback.localStrategyName) return `Local · ${fallback.localStrategyName}`;
    if (fallback.aiPromptTemplateName) return `AI · ${fallback.aiPromptTemplateName}`;
    return "AI · System default prompt";
  }
  const name = strategyRef.name ?? strategyRef.id;
  return `${strategyKindLabel(strategyRef.kind)} · ${name}`;
}

function encodeStrategySelectValue(strategy: StrategyRef | null): string {
  if (!strategy) return "ai:default";
  return `${strategy.kind}:${strategy.id}`;
}

function decodeStrategySelectValue(value: string): StrategyRef | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "ai:default") return null;
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const kind = trimmed.slice(0, idx);
  const id = trimmed.slice(idx + 1).trim();
  if (!id) return null;
  if (kind !== "ai" && kind !== "local" && kind !== "composite") return null;
  return { kind, id, name: null };
}

function strategyKindFromSelectValue(value: string): StrategyKind | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("ai:")) return "ai";
  if (trimmed.startsWith("local:")) return "local";
  if (trimmed.startsWith("composite:")) return "composite";
  return null;
}

function forcedSignalModeForStrategyKind(kind: StrategyKind | null): CreateSignalMode | null {
  if (kind === "local") return "local_only";
  if (kind === "ai") return "ai_only";
  return null;
}

function isStrategyAllowedByEntitlements(
  entitlements: StrategyEntitlements | null,
  kind: StrategyKind,
  id: string | null
): boolean {
  if (!entitlements) return true;
  if (!entitlements.allowedStrategyKinds.includes(kind)) return false;
  const allowlist = entitlements.allowedStrategyIds;
  if (!allowlist) return true;
  if (!id) {
    return allowlist.some((entry) => {
      const normalized = entry.trim().toLowerCase();
      return normalized === "*" || normalized === `${kind}:*` || normalized === `${kind}:default`;
    });
  }
  const normalizedId = id.trim().toLowerCase();
  return allowlist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    return (
      normalized === "*" ||
      normalized === normalizedId ||
      normalized === `${kind}:*` ||
      normalized === `${kind}:${normalizedId}`
    );
  });
}

function canSendToDesk(row: PredictionListItem, source: SignalSource): boolean {
  if (!row.accountId) return false;
  const effectiveSource = getEffectiveRowSource(row, source);
  const signal = resolveSignal(row, effectiveSource);
  if (signal === "neutral") return false;
  const confidencePct = confidenceToPct(resolveConfidence(row, effectiveSource));
  const targetPct =
    typeof row.confidenceTargetPct === "number" && Number.isFinite(row.confidenceTargetPct)
      ? Math.max(0, Math.min(100, row.confidenceTargetPct))
      : 0;
  return confidencePct >= targetPct;
}

function resolvePredictionActionState(
  row: PredictionListItem,
  source: SignalSource,
  labels: {
    noAccount: string;
    noTradeSetup: string;
    belowConfidenceTarget: string;
    localAiDisagreement: string;
    refreshDegraded: string;
    readyToSend: string;
  } = {
    noAccount: "No account",
    noTradeSetup: "No trade setup",
    belowConfidenceTarget: "Below confidence target",
    localAiDisagreement: "Local/AI disagreement",
    refreshDegraded: "Refresh degraded",
    readyToSend: "Ready to send"
  }
): { state: PredictionActionState; label: string; canSend: boolean } {
  const effectiveSource = getEffectiveRowSource(row, source);
  const targetPct =
    typeof row.confidenceTargetPct === "number" && Number.isFinite(row.confidenceTargetPct)
      ? Math.max(0, Math.min(100, row.confidenceTargetPct))
      : 0;
  const signal = resolveSignal(row, effectiveSource);
  const confidencePct = confidenceToPct(resolveConfidence(row, effectiveSource));
  const localSignal = row.localPrediction?.signal ?? row.signal;
  const aiDisagrees =
    isRowDisagreementRelevant(row)
    && Boolean(row.aiPrediction)
    && row.aiPrediction!.signal !== localSignal;
  const canSend = canSendToDesk(row, source);

  if (isPredictionRefreshDegraded(row)) {
    return { state: "degraded", label: labels.refreshDegraded, canSend: false };
  }
  if (!row.accountId) return { state: "no_account", label: labels.noAccount, canSend };
  if (signal === "neutral") return { state: "neutral", label: labels.noTradeSetup, canSend };
  if (confidencePct < targetPct) {
    return {
      state: "below_target",
      label: `${labels.belowConfidenceTarget} (${targetPct.toFixed(0)}%)`,
      canSend
    };
  }
  if (aiDisagrees) return { state: "disagreement", label: labels.localAiDisagreement, canSend };
  return { state: "ready", label: labels.readyToSend, canSend };
}

function rowStateClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionRowStateReady";
  if (state === "disagreement" || state === "below_target" || state === "degraded") return "predictionRowStateWarn";
  return "predictionRowStateBlocked";
}

function mobileCardStateClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionRowCardStateReady";
  if (state === "disagreement" || state === "below_target" || state === "degraded") return "predictionRowCardStateWarn";
  return "predictionRowCardStateBlocked";
}

function actionStateBadgeClass(state: PredictionActionState): string {
  if (state === "ready") return "predictionActionBadgeReady";
  if (state === "disagreement" || state === "below_target" || state === "degraded") return "predictionActionBadgeWarn";
  return "predictionActionBadgeBlocked";
}

function normalizeRefreshStatus(value: unknown): PredictionRefreshStatus {
  return value === "degraded" ? "degraded" : "ok";
}

function normalizeRefreshFailureCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeRefreshHealth<T extends Record<string, unknown>>(row: T): T & {
  refreshStatus: PredictionRefreshStatus;
  refreshFailureCount: number;
} {
  return {
    ...row,
    refreshStatus: normalizeRefreshStatus(row.refreshStatus),
    refreshFailureCount: normalizeRefreshFailureCount(row.refreshFailureCount)
  };
}

function isPredictionRefreshDegraded(row: Pick<PredictionListItem | RunningPredictionItem, "refreshStatus" | "refreshFailureCount">): boolean {
  return row.refreshStatus === "degraded" || normalizeRefreshFailureCount(row.refreshFailureCount) > 0;
}

function refreshHealthTitle(row: Pick<PredictionListItem | RunningPredictionItem, "lastRefreshAttemptAt" | "lastRefreshErrorAt" | "lastRefreshError" | "refreshFailureCount">): string {
  const parts = [];
  if (row.lastRefreshError) parts.push(row.lastRefreshError);
  if (row.lastRefreshErrorAt) parts.push(`error: ${new Date(row.lastRefreshErrorAt).toLocaleString()}`);
  if (row.lastRefreshAttemptAt) parts.push(`last attempt: ${new Date(row.lastRefreshAttemptAt).toLocaleString()}`);
  if (normalizeRefreshFailureCount(row.refreshFailureCount) > 0) parts.push(`failures: ${normalizeRefreshFailureCount(row.refreshFailureCount)}`);
  return parts.join(" · ") || "Refresh degraded";
}

type PredictionAlertTone = "error" | "warning";

function PredictionAlert(props: {
  title: string;
  message: string;
  tone: PredictionAlertTone;
}) {
  const toneClass = props.tone === "error" ? "predictionAlertError" : "predictionAlertWarn";
  const noticeTone = props.tone === "error" ? "danger" : "warning";
  return (
    <Notice
      tone={noticeTone}
      className={`card predictionAlert ${toneClass}`}
      role={props.tone === "error" ? "alert" : "status"}
    >
      <strong>{props.title}:</strong> {props.message}
    </Notice>
  );
}

function PredictionCalibrationPlot({
  bins,
  labels
}: {
  bins: PredictionMetricsResponse["calibrationBins"];
  labels: {
    avgConf: string;
    accuracy: string;
    sample: string;
  };
}) {
  const visibleBins = bins.filter((bin) => bin.n > 0);
  if (visibleBins.length === 0) return null;
  const maxN = Math.max(...visibleBins.map((bin) => bin.n), 1);
  const width = 360;
  const height = 220;
  const padding = { left: 36, right: 18, top: 16, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (value: number) => padding.left + (Math.max(0, Math.min(100, value)) / 100) * plotWidth;
  const yFor = (value: number) => padding.top + plotHeight - (Math.max(0, Math.min(100, value)) / 100) * plotHeight;

  return (
    <div className="predictionCalibrationPlotWrap">
      <svg className="predictionCalibrationPlot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labels.avgConf} / ${labels.accuracy}`}>
        <line x1={padding.left} y1={padding.top + plotHeight} x2={padding.left + plotWidth} y2={padding.top + plotHeight} className="predictionCalibrationAxis" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} className="predictionCalibrationAxis" />
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={xFor(tick)} y1={padding.top} x2={xFor(tick)} y2={padding.top + plotHeight} className="predictionCalibrationGridLine" />
            <line x1={padding.left} y1={yFor(tick)} x2={padding.left + plotWidth} y2={yFor(tick)} className="predictionCalibrationGridLine" />
            <text x={xFor(tick)} y={height - 12} textAnchor="middle" className="predictionCalibrationTick">{tick}</text>
            <text x={padding.left - 8} y={yFor(tick) + 4} textAnchor="end" className="predictionCalibrationTick">{tick}</text>
          </g>
        ))}
        <line x1={xFor(0)} y1={yFor(0)} x2={xFor(100)} y2={yFor(100)} className="predictionCalibrationIdeal" />
        {visibleBins.map((bin) => {
          const xValue = bin.avgConf ?? (bin.binFrom + bin.binTo) / 2;
          const yValue = bin.accuracy ?? 0;
          const radius = 4 + Math.sqrt(bin.n / maxN) * 9;
          return (
            <g key={`${bin.binFrom}-${bin.binTo}`}>
              <line x1={xFor(xValue)} y1={yFor(0)} x2={xFor(xValue)} y2={yFor(yValue)} className="predictionCalibrationStem" />
              <circle cx={xFor(xValue)} cy={yFor(yValue)} r={radius} className="predictionCalibrationDot" />
              <text x={xFor(xValue)} y={yFor(yValue) - radius - 4} textAnchor="middle" className="predictionCalibrationSample">
                {labels.sample}={bin.n}
              </text>
            </g>
          );
        })}
        <text x={padding.left + plotWidth / 2} y={height - 1} textAnchor="middle" className="predictionCalibrationAxisLabel">{labels.avgConf}</text>
        <text x={13} y={padding.top + plotHeight / 2} textAnchor="middle" className="predictionCalibrationAxisLabel" transform={`rotate(-90 13 ${padding.top + plotHeight / 2})`}>{labels.accuracy}</text>
      </svg>
    </div>
  );
}

function fmtNum(value: unknown, decimals = 2): string {
  const parsed = toNum(value);
  if (parsed === null) return "n/a";
  return parsed.toFixed(decimals);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeExactSymbolForPerformance(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9:_-]{3,40}$/.test(normalized)) return null;
  return normalized;
}

function readHitValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "hit") return true;
    if (normalized === "false" || normalized === "0" || normalized === "miss") return false;
  }
  return null;
}

function summarizeEventDelta(delta: Record<string, unknown> | null): string {
  if (!delta || typeof delta !== "object") return "No delta data";
  const parts: string[] = [];

  const signal = typeof delta.signal === "string" ? delta.signal : null;
  if (signal) parts.push(`signal ${signal}`);

  const confidenceDelta = toNum(delta.confidenceDelta);
  if (confidenceDelta !== null) {
    const sign = confidenceDelta >= 0 ? "+" : "";
    parts.push(`confidence ${sign}${confidenceDelta.toFixed(2)}`);
  }

  const tagsAdded = Array.isArray(delta.tagsAdded)
    ? delta.tagsAdded.map((item) => String(item)).filter(Boolean)
    : [];
  if (tagsAdded.length > 0) parts.push(`+${tagsAdded.join(", ")}`);

  const tagsRemoved = Array.isArray(delta.tagsRemoved)
    ? delta.tagsRemoved.map((item) => String(item)).filter(Boolean)
    : [];
  if (tagsRemoved.length > 0) parts.push(`-${tagsRemoved.join(", ")}`);

  if (parts.length === 0) return "No delta data";
  return parts.join(" | ");
}

function formatFlipLabel(flip: PredictionSignalFlip | null): string {
  if (!flip) return "FLIP";
  return `${flip.from.toUpperCase()}->${flip.to.toUpperCase()}`;
}

function describeManualReason(params: {
  parsedReason: ReturnType<typeof parsePredictionChangeReason>;
  autoEnabled: boolean;
}): { label: string; shortReason: string; rawReason: string | null } {
  if (params.parsedReason.kind !== "manual") {
    return {
      label: params.parsedReason.label,
      shortReason: params.parsedReason.shortReason,
      rawReason: params.parsedReason.raw
    };
  }

  if (params.autoEnabled) {
    return {
      label: "Manual",
      shortReason: "manual (waiting for first auto refresh)",
      rawReason: "manual_waiting_first_auto_refresh"
    };
  }

  return {
    label: "Manual",
    shortReason: "manual (one-off)",
    rawReason: "manual_one_off"
  };
}

function responseLanguageFromLocale(locale: AppLocale): ResponseLanguage {
  return locale === "de" ? "de" : "en";
}

export default function PredictionsPage() {
  const tPred = useTranslations("predictions");
  const tCommon = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const searchParams = useSearchParams();

  const modeLabels = useMemo(
    () => ({
      localOnly: tPred("modes.localOnly"),
      aiOnly: tPred("modes.aiOnly"),
      both: tPred("modes.both")
    }),
    [tPred]
  );
  const nextRunLabels = useMemo(
    () => ({
      disabled: tPred("misc.disabled"),
      unknown: tPred("misc.unknown"),
      dueNow: tPred("running.dueNow"),
      inPrefix: tPred("running.inPrefix")
    }),
    [tPred]
  );
  const actionStateLabels = useMemo(
    () => ({
      noAccount: tPred("feed.actionStates.noAccount"),
      noTradeSetup: tPred("feed.actionStates.noTradeSetup"),
      belowConfidenceTarget: tPred("feed.actionStates.belowConfidenceTarget"),
      localAiDisagreement: tPred("feed.actionStates.localAiDisagreement"),
      refreshDegraded: tPred("feed.actionStates.refreshDegraded"),
      readyToSend: tPred("feed.actionStates.readyToSend")
    }),
    [tPred]
  );

  const [rows, setRows] = useState<PredictionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<PredictionQualitySummary | null>(null);
  const [metrics, setMetrics] = useState<PredictionMetricsResponse | null>(null);
  const [performanceResetAt, setPerformanceResetAt] = useState<string | null>(null);
  const [resettingPerformance, setResettingPerformance] = useState(false);
  const [runningRows, setRunningRows] = useState<RunningPredictionItem[]>([]);
  const [runningLoading, setRunningLoading] = useState(true);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [runningStatusFilter, setRunningStatusFilter] = useState<RunningStatusFilter>("all");
  const [activeView, setActiveView] = useState<PredictionsView>("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<PredictionWizardStep>("type");
  const [analysisKind, setAnalysisKind] = useState<AnalysisKind>("trading_with_intelligence");
  const [marketIntelligenceHorizon, setMarketIntelligenceHorizon] = useState<MarketIntelligenceHorizon>("24h");
  const [creatingMarketIntelligence, setCreatingMarketIntelligence] = useState(false);
  const [marketIntelligencePreview, setMarketIntelligencePreview] = useState<MarketIntelligencePreview | null>(null);
  const [marketIntelligencePreviewLoading, setMarketIntelligencePreviewLoading] = useState(false);

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [createAccountId, setCreateAccountId] = useState("");
  const [createSymbols, setCreateSymbols] = useState<SymbolItem[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);

  const [filterSymbol, setFilterSymbol] = useState("");
  const [filterSignal, setFilterSignal] = useState<PredictionSignal | "all">("all");
  const [filterTimeframe, setFilterTimeframe] = useState<PredictionTimeframe | "all">("all");
  const [filterMarket, setFilterMarket] = useState<PredictionMarketType | "all">("all");
  const [filterPrompt, setFilterPrompt] = useState("");
  const [filterProvider, setFilterProvider] = useState<HistoryProviderFilter>("all");
  const [filterResult, setFilterResult] = useState<HistoryResultFilter>("all");
  const [signalSource, setSignalSource] = useState<SignalSource>("local");
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const [newSymbol, setNewSymbol] = useState("BTCUSDT");
  const [newMarketType, setNewMarketType] = useState<PredictionMarketType>("perp");
  const [newTimeframe, setNewTimeframe] = useState<PredictionTimeframe>("15m");
  const [newHorizonMs, setNewHorizonMs] = useState(4 * 60 * 60 * 1000);
  const [publicAiPrompts, setPublicAiPrompts] = useState<PublicAiPromptItem[]>([]);
  const [publicAiPromptsLoading, setPublicAiPromptsLoading] = useState(false);
  const [ownAiPrompts, setOwnAiPrompts] = useState<PublicAiPromptItem[]>([]);
  const [ownAiPromptsLoading, setOwnAiPromptsLoading] = useState(false);
  const [ownStrategyFeatureEnabled, setOwnStrategyFeatureEnabled] = useState(false);
  const [publicAiPromptLicensePolicy, setPublicAiPromptLicensePolicy] = useState<PublicAiPromptLicensePolicy | null>(null);
  const [strategyEntitlements, setStrategyEntitlements] = useState<StrategyEntitlements | null>(null);
  const [localStrategies, setLocalStrategies] = useState<PublicLocalStrategyItem[]>([]);
  const [localStrategiesLoading, setLocalStrategiesLoading] = useState(false);
  const [compositeStrategies, setCompositeStrategies] = useState<PublicCompositeStrategyItem[]>([]);
  const [compositeStrategiesLoading, setCompositeStrategiesLoading] = useState(false);
  const [predictionDefaults, setPredictionDefaults] = useState<PredictionDefaultsResponse | null>(null);
  const [subscriptionQuota, setSubscriptionQuota] = useState<SubscriptionQuotaResponse | null>(null);
  const [newStrategySelectValue, setNewStrategySelectValue] = useState("ai:default");
  const [newResponseLanguage, setNewResponseLanguage] = useState<ResponseLanguage>(() =>
    responseLanguageFromLocale(locale)
  );
  const [newLeverage, setNewLeverage] = useState("10");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, PredictionDetailResponse>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [eventsByStateId, setEventsByStateId] = useState<Record<string, PredictionEventItem[]>>({});
  const [eventsLoadingStateId, setEventsLoadingStateId] = useState<string | null>(null);
  const [eventsErrorByStateId, setEventsErrorByStateId] = useState<Record<string, string | null>>({});
  const [expandedEventsByStateId, setExpandedEventsByStateId] = useState<Record<string, boolean>>({});

  const performanceFilterSymbol = useMemo(() => {
    const normalized = normalizeExactSymbolForPerformance(filterSymbol);
    if (!normalized) return null;
    const knownSymbols = new Set<string>();
    for (const row of rows) knownSymbols.add(row.symbol.toUpperCase());
    for (const row of createSymbols) knownSymbols.add(row.symbol.toUpperCase());
    return knownSymbols.has(normalized) ? normalized : null;
  }, [createSymbols, filterSymbol, rows]);
  const createSymbolOptions = useMemo(() => {
    const normalized = newSymbol.trim().toUpperCase();
    if (!normalized || createSymbols.some((item) => item.symbol === normalized)) return createSymbols;
    return [{ symbol: normalized, meta: symbolsError ? tPred("create.pairsLoadFailed") : null }, ...createSymbols];
  }, [createSymbols, newSymbol, symbolsError, tPred]);

  function buildPerformanceQueryParams(includeBins = false): URLSearchParams {
    const params = new URLSearchParams();
    if (performanceFilterSymbol) params.set("symbol", performanceFilterSymbol);
    if (filterTimeframe !== "all") params.set("timeframe", filterTimeframe);
    params.set("signalSource", signalSource);
    if (includeBins) params.set("bins", "10");
    return params;
  }

  async function loadPredictions(options?: { background?: boolean }) {
    const background = options?.background === true;
    if (!background) setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<{ items: PredictionListItem[] }>("/api/predictions?limit=100");
      setRows(
        Array.isArray(payload.items)
          ? payload.items.map((row) => ({
              ...normalizeRefreshHealth(row as unknown as Record<string, unknown>),
              localPrediction: readAiPrediction((row as Record<string, unknown>).localPrediction),
              aiPrediction: readAiPrediction((row as Record<string, unknown>).aiPrediction),
              strategyRef: normalizeStrategyRef((row as Record<string, unknown>).strategyRef)
            } as PredictionListItem))
          : []
      );
    } catch (e) {
      if (!background) setError(errMsg(e));
    } finally {
      if (!background) setLoading(false);
    }
  }

  async function loadRunningPredictions(options?: { background?: boolean }) {
    const background = options?.background === true;
    if (!background) setRunningLoading(true);
    try {
      const payload = await apiGet<{ items: RunningPredictionItem[] }>("/api/predictions/running");
      setRunningRows(
        Array.isArray(payload.items)
          ? payload.items.map((row) => ({
              ...normalizeRefreshHealth(row as unknown as Record<string, unknown>),
              strategyRef: normalizeStrategyRef((row as Record<string, unknown>).strategyRef)
            } as RunningPredictionItem))
          : []
      );
    } catch (e) {
      if (!background) setActionError(errMsg(e));
    } finally {
      if (!background) setRunningLoading(false);
    }
  }

  function refreshPredictionOverviewInBackground() {
    void Promise.allSettled([
      loadPredictions({ background: true }),
      loadRunningPredictions({ background: true }),
      loadPredictionQuality(),
      loadPredictionMetrics(),
      loadSubscriptionQuota()
    ]);
  }

  async function loadPredictionQuality() {
    try {
      const query = buildPerformanceQueryParams(false).toString();
      const payload = await apiGet<PredictionQualitySummary>(
        `/api/predictions/quality${query ? `?${query}` : ""}`
      );
      setQuality(payload);
      setPerformanceResetAt(payload.resetAt ?? null);
    } catch {
      setQuality(null);
    }
  }

  async function loadPredictionMetrics() {
    try {
      const query = buildPerformanceQueryParams(true).toString();
      const payload = await apiGet<PredictionMetricsResponse>(
        `/api/predictions/metrics${query ? `?${query}` : ""}`
      );
      setMetrics(payload);
      setPerformanceResetAt((prev) => payload.resetAt ?? prev);
    } catch {
      setMetrics(null);
    }
  }

  async function loadAccounts() {
    try {
      const payload = await apiGet<{ items: ExchangeAccountItem[] }>("/exchange-accounts?purpose=execution");
      const list = (Array.isArray(payload.items) ? payload.items : [])
        .filter(isPredictionExecutionAccountEligible);
      setAccounts(list);

      if (list.length === 0) {
        setCreateAccountId("");
        return;
      }

      setCreateAccountId((prev) => {
        if (prev && list.some((row) => row.id === prev)) return prev;
        return list[0].id;
      });
    } catch {
      setAccounts([]);
      setCreateAccountId("");
    }
  }

  async function loadPublicAiPrompts() {
    setPublicAiPromptsLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicAiPromptItem[];
        licensePolicy?: PublicAiPromptLicensePolicy;
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/ai-prompts/public");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setPublicAiPrompts(items);
      setPublicAiPromptLicensePolicy(payload.licensePolicy ?? null);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
    } catch {
      setPublicAiPrompts([]);
      setPublicAiPromptLicensePolicy(null);
    } finally {
      setPublicAiPromptsLoading(false);
    }
  }

  async function loadOwnAiPrompts() {
    setOwnAiPromptsLoading(true);
    try {
      const payload = await apiGet<OwnAiPromptsResponse>("/settings/ai-prompts/own");
      setOwnAiPrompts(Array.isArray(payload.items) ? payload.items : []);
      setOwnStrategyFeatureEnabled(Boolean(payload.strategyFeatureEnabled));
    } catch {
      setOwnAiPrompts([]);
      setOwnStrategyFeatureEnabled(false);
    } finally {
      setOwnAiPromptsLoading(false);
    }
  }

  async function loadPredictionDefaults() {
    try {
      const payload = await apiGet<PredictionDefaultsResponse>("/settings/prediction-defaults");
      setPredictionDefaults(payload);
    } catch {
      setPredictionDefaults(null);
    }
  }

  async function loadSubscriptionQuota() {
    try {
      const payload = await apiGet<SubscriptionQuotaResponse>("/settings/subscription");
      setSubscriptionQuota(payload);
    } catch {
      setSubscriptionQuota(null);
    }
  }

  async function loadStrategyEntitlements() {
    try {
      const payload = await apiGet<{ entitlements: StrategyEntitlements }>("/settings/strategy-entitlements");
      setStrategyEntitlements(payload.entitlements ?? null);
    } catch {
      setStrategyEntitlements(null);
    }
  }

  async function loadLocalStrategies() {
    setLocalStrategiesLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicLocalStrategyItem[];
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/local-strategies");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setLocalStrategies(items);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        if (!selected) return prev;
        if (selected.kind !== "local") return prev;
        return items.some((item) => item.id === selected.id) ? prev : "ai:default";
      });
    } catch {
      setLocalStrategies([]);
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        return selected?.kind === "local" ? "ai:default" : prev;
      });
    } finally {
      setLocalStrategiesLoading(false);
    }
  }

  async function loadCompositeStrategies() {
    setCompositeStrategiesLoading(true);
    try {
      const payload = await apiGet<{
        items: PublicCompositeStrategyItem[];
        strategyEntitlements?: StrategyEntitlements;
      }>("/settings/composite-strategies");
      const items = Array.isArray(payload.items) ? payload.items : [];
      setCompositeStrategies(items);
      if (payload.strategyEntitlements) {
        setStrategyEntitlements(payload.strategyEntitlements);
      }
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        if (!selected) return prev;
        if (selected.kind !== "composite") return prev;
        return items.some((item) => item.id === selected.id) ? prev : "ai:default";
      });
    } catch {
      setCompositeStrategies([]);
      setNewStrategySelectValue((prev) => {
        const selected = decodeStrategySelectValue(prev);
        return selected?.kind === "composite" ? "ai:default" : prev;
      });
    } finally {
      setCompositeStrategiesLoading(false);
    }
  }

  async function loadSymbolsForAccount(exchangeAccountId: string, marketType: PredictionMarketType) {
    setSymbolsLoading(true);
    setSymbolsError(null);
    try {
      const payload = await apiGet<{ items: SymbolItem[] }>(
        `/api/symbols?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}&marketType=${encodeURIComponent(marketType)}`
      );
      const list = Array.isArray(payload.items) ? payload.items : [];
      setCreateSymbols(list);

      if (list.length > 0) {
        const hasCurrent = list.some((row) => row.symbol === newSymbol);
        if (!hasCurrent) {
          const preferred = list.find((row) => row.tradable) ?? list[0];
          if (preferred?.symbol) setNewSymbol(preferred.symbol);
        }
      }
    } catch (e) {
      setCreateSymbols([]);
      setSymbolsError(errMsg(e));
    } finally {
      setSymbolsLoading(false);
    }
  }

  const marketIntelligenceAllowed = isProductFeatureAllowed(
    subscriptionQuota?.featureGates,
    "market_intelligence"
  );

  useEffect(() => {
    void loadPredictions();
    void loadRunningPredictions();
    void loadAccounts();
    void loadPublicAiPrompts();
    void loadOwnAiPrompts();
    void loadStrategyEntitlements();
    void loadLocalStrategies();
    void loadCompositeStrategies();
    void loadPredictionDefaults();
    void loadSubscriptionQuota();
  }, []);

  useEffect(() => {
    if (!subscriptionQuota || searchParams.get("create") !== "market-intelligence") return;
    if (marketIntelligenceAllowed) {
      setAnalysisKind("market_intelligence");
      setWizardStep("scope");
      setWizardOpen(true);
    }
    router.replace(withLocalePath("/predictions", locale), { scroll: false });
  }, [locale, marketIntelligenceAllowed, router, searchParams, subscriptionQuota]);

  useEffect(() => {
    if (
      !wizardOpen
      || wizardStep !== "review"
      || analysisKind !== "trading_with_intelligence"
      || !marketIntelligenceAllowed
    ) {
      setMarketIntelligencePreview(null);
      return;
    }
    let cancelled = false;
    setMarketIntelligencePreviewLoading(true);
    void apiGet<MarketIntelligencePreview>(
      `/market-intelligence/context?symbol=${encodeURIComponent(newSymbol)}&horizon=24h`
    )
      .then((payload) => {
        if (!cancelled) setMarketIntelligencePreview(payload);
      })
      .catch(() => {
        if (!cancelled) setMarketIntelligencePreview(null);
      })
      .finally(() => {
        if (!cancelled) setMarketIntelligencePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisKind, marketIntelligenceAllowed, newSymbol, wizardOpen, wizardStep]);

  useEffect(() => {
    setNewResponseLanguage(responseLanguageFromLocale(locale));
  }, [locale]);

  useEffect(() => {
    if (!createAccountId) {
      setCreateSymbols([]);
      return;
    }
    void loadSymbolsForAccount(createAccountId, newMarketType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAccountId, newMarketType]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPredictionQuality();
      void loadPredictionMetrics();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [performanceFilterSymbol, filterTimeframe, signalSource]);

  const selectedStrategyRef = useMemo(
    () => decodeStrategySelectValue(newStrategySelectValue),
    [newStrategySelectValue]
  );
  const allAiPrompts = useMemo(() => {
    const out: PublicAiPromptItem[] = [];
    const seen = new Set<string>();
    for (const item of [...ownAiPrompts, ...publicAiPrompts]) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }, [ownAiPrompts, publicAiPrompts]);
  const selectedPrompt = useMemo(
    () =>
      selectedStrategyRef?.kind === "ai"
        ? allAiPrompts.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, allAiPrompts]
  );
  const selectedLocalStrategy = useMemo(
    () =>
      selectedStrategyRef?.kind === "local"
        ? localStrategies.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, localStrategies]
  );
  const selectedCompositeStrategy = useMemo(
    () =>
      selectedStrategyRef?.kind === "composite"
        ? compositeStrategies.find((item) => item.id === selectedStrategyRef.id) ?? null
        : null,
    [selectedStrategyRef, compositeStrategies]
  );
  const allowedAiPrompts = useMemo(
    () =>
      (!isProductFeatureAllowed(subscriptionQuota?.featureGates, "ai_predictions")
        ? []
        : publicAiPrompts.filter((item) =>
          isStrategyAllowedByEntitlements(strategyEntitlements, "ai", item.id)
        )),
    [publicAiPrompts, strategyEntitlements, subscriptionQuota]
  );
  const allowedOwnAiPrompts = useMemo(
    () =>
      ownStrategyFeatureEnabled
      && isProductFeatureAllowed(subscriptionQuota?.featureGates, "ai_predictions")
        ? ownAiPrompts
        : [],
    [ownAiPrompts, ownStrategyFeatureEnabled, subscriptionQuota]
  );
  const allowedLocalStrategies = useMemo(
    () =>
      (!isProductFeatureAllowed(subscriptionQuota?.featureGates, "local_strategies")
        ? []
        : localStrategies.filter((item) =>
          isStrategyAllowedByEntitlements(strategyEntitlements, "local", item.id)
        )),
    [localStrategies, strategyEntitlements, subscriptionQuota]
  );
  const allowedCompositeStrategies = useMemo(
    () =>
      (!isProductFeatureAllowed(subscriptionQuota?.featureGates, "composite_strategies")
        ? []
        : compositeStrategies.filter((item) =>
          isStrategyAllowedByEntitlements(strategyEntitlements, "composite", item.id)
        )),
    [compositeStrategies, strategyEntitlements, subscriptionQuota]
  );
  const aiDefaultAllowed = useMemo(
    () =>
      isProductFeatureAllowed(subscriptionQuota?.featureGates, "ai_predictions")
      && isStrategyAllowedByEntitlements(strategyEntitlements, "ai", "default"),
    [strategyEntitlements, subscriptionQuota]
  );
  const aiKindAllowed = useMemo(
    () =>
      isProductFeatureAllowed(subscriptionQuota?.featureGates, "ai_predictions")
      && isStrategyAllowedByEntitlements(strategyEntitlements, "ai", null),
    [strategyEntitlements, subscriptionQuota]
  );
  const localKindAllowed = useMemo(
    () =>
      isProductFeatureAllowed(subscriptionQuota?.featureGates, "local_strategies")
      && isStrategyAllowedByEntitlements(strategyEntitlements, "local", null),
    [strategyEntitlements, subscriptionQuota]
  );
  const compositeKindAllowed = useMemo(
    () =>
      isProductFeatureAllowed(subscriptionQuota?.featureGates, "composite_strategies")
      && isStrategyAllowedByEntitlements(strategyEntitlements, "composite", null),
    [strategyEntitlements, subscriptionQuota]
  );
  const selectedStrategyKind = useMemo(
    () => strategyKindFromSelectValue(newStrategySelectValue),
    [newStrategySelectValue]
  );
  const forcedCreateSignalMode = useMemo(
    () => forcedSignalModeForStrategyKind(selectedStrategyKind),
    [selectedStrategyKind]
  );
  const effectiveCreateSignalMode = forcedCreateSignalMode ?? predictionDefaults?.signalMode ?? "both";
  const createSignalModeLabel =
    effectiveCreateSignalMode === "local_only"
      ? tPred("modes.localOnly")
      : effectiveCreateSignalMode === "ai_only"
        ? tPred("modes.aiOnly")
        : tPred("modes.both");
  const createSignalModeScopeLabel = forcedCreateSignalMode
    ? tPred("create.strategyEnforcedShort")
    : tPred("create.globalDefaultShort");
  const createSignalModeScopeTitle = forcedCreateSignalMode
    ? tPred("create.strategyEnforced")
    : tPred("create.globalDefault");
  const selectedPromptLockedTimeframe =
    selectedPrompt?.runTimeframe
    ?? selectedPrompt?.timeframe
    ?? null;
  const selectedPromptTimeframes = useMemo(() => {
    if (!selectedPrompt) return [] as PredictionTimeframe[];
    const raw = Array.isArray(selectedPrompt.timeframes) ? selectedPrompt.timeframes : [];
    const normalized = raw.filter((value): value is PredictionTimeframe =>
      value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d"
    );
    if (normalized.length > 0) return normalized;
    return selectedPromptLockedTimeframe ? [selectedPromptLockedTimeframe] : [];
  }, [selectedPrompt, selectedPromptLockedTimeframe]);
  const effectiveCreateTimeframe = selectedPromptLockedTimeframe ?? newTimeframe;
  const selectedCreateLimitBucket = useMemo<StrategyLimitBucket>(
    () => strategyBucketFromKind(selectedStrategyKind),
    [selectedStrategyKind]
  );
  const selectedCreateRunningLimit = useMemo<number | null>(() => {
    if (!subscriptionQuota) return null;
    if (selectedCreateLimitBucket === "predictionsAi") {
      return subscriptionQuota.limits.predictions.ai.maxRunning;
    }
    if (selectedCreateLimitBucket === "predictionsComposite") {
      return subscriptionQuota.limits.predictions.composite.maxRunning;
    }
    return null;
  }, [selectedCreateLimitBucket, subscriptionQuota]);
  const selectedCreateRunningUsage = useMemo<number>(() => {
    if (!subscriptionQuota) return 0;
    if (selectedCreateLimitBucket === "predictionsAi") {
      return subscriptionQuota.usage.predictions.ai.running;
    }
    if (selectedCreateLimitBucket === "predictionsComposite") {
      return subscriptionQuota.usage.predictions.composite.running;
    }
    return subscriptionQuota.usage.predictions.local.running;
  }, [selectedCreateLimitBucket, subscriptionQuota]);
  const selectedCreateRunningRemaining = useMemo<number | null>(() => {
    if (selectedCreateRunningLimit === null) return null;
    return Math.max(0, selectedCreateRunningLimit - selectedCreateRunningUsage);
  }, [selectedCreateRunningLimit, selectedCreateRunningUsage]);
  const createBlockedByLimit = Boolean(
    typeof selectedCreateRunningRemaining === "number" && selectedCreateRunningRemaining <= 0
  );
  const selectedCreateFeatureKey =
    selectedStrategyKind === "local"
      ? "local_strategies"
      : selectedStrategyKind === "composite"
        ? "composite_strategies"
        : "ai_predictions";
  const createBlockedByFeature = !isProductFeatureAllowed(
    subscriptionQuota?.featureGates,
    selectedCreateFeatureKey
  );
  const createBlockedFeatureTitle = titleForProductFeature(selectedCreateFeatureKey);
  const wizardSteps = useMemo<Array<{ id: PredictionWizardStep; label: string }>>(
    () => analysisKind === "market_intelligence"
      ? [
          { id: "type", label: tPred("wizard.steps.type") },
          { id: "scope", label: tPred("wizard.steps.scope") },
          { id: "review", label: tPred("wizard.steps.review") },
          { id: "generate", label: tPred("wizard.steps.generate") }
        ]
      : [
          { id: "type", label: tPred("wizard.steps.type") },
          { id: "market", label: tPred("wizard.steps.market") },
          { id: "analysis", label: tPred("wizard.steps.analysis") },
          { id: "advanced", label: tPred("wizard.steps.advanced") },
          { id: "review", label: tPred("wizard.steps.review") },
          { id: "generate", label: tPred("wizard.steps.generate") }
        ],
    [analysisKind, tPred]
  );

  useEffect(() => {
    const selected = decodeStrategySelectValue(newStrategySelectValue);
    const selectedOwnAi = selected?.kind === "ai"
      ? ownAiPrompts.find((item) => item.id === selected.id) ?? null
      : null;
    if (selectedOwnAi && !ownStrategyFeatureEnabled && aiDefaultAllowed) {
      setNewStrategySelectValue("ai:default");
      return;
    }
    const selectedKnownAi = selected?.kind === "ai"
      ? allAiPrompts.some((item) => item.id === selected.id)
      : false;
    const selectedAllowed = selected
      ? (
        selected.kind === "ai" && selectedOwnAi
          ? (ownStrategyFeatureEnabled && aiKindAllowed)
          : (selected.kind === "ai" && !selectedKnownAi)
            ? false
          : isStrategyAllowedByEntitlements(strategyEntitlements, selected.kind, selected.id)
      )
      : aiDefaultAllowed;
    if (selectedAllowed) return;

    if (allowedLocalStrategies.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "local",
          id: allowedLocalStrategies[0].id,
          name: allowedLocalStrategies[0].name
        })
      );
      return;
    }
    if (allowedCompositeStrategies.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "composite",
          id: allowedCompositeStrategies[0].id,
          name: allowedCompositeStrategies[0].name
        })
      );
      return;
    }
    if (allowedOwnAiPrompts.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "ai",
          id: allowedOwnAiPrompts[0].id,
          name: allowedOwnAiPrompts[0].name
        })
      );
      return;
    }
    if (allowedAiPrompts.length > 0) {
      setNewStrategySelectValue(
        encodeStrategySelectValue({
          kind: "ai",
          id: allowedAiPrompts[0].id,
          name: allowedAiPrompts[0].name
        })
      );
      return;
    }
    setNewStrategySelectValue("ai:default");
  }, [
    aiDefaultAllowed,
    allowedAiPrompts,
    allowedCompositeStrategies,
    allowedLocalStrategies,
    allowedOwnAiPrompts,
    aiKindAllowed,
    newStrategySelectValue,
    ownAiPrompts,
    allAiPrompts,
    ownStrategyFeatureEnabled,
    strategyEntitlements
  ]);

  useEffect(() => {
    if (selectedPromptLockedTimeframe && newTimeframe !== selectedPromptLockedTimeframe) {
      setNewTimeframe(selectedPromptLockedTimeframe);
    }
  }, [newTimeframe, selectedPromptLockedTimeframe]);

  const filteredRows = useMemo(() => {
    const symbolSearch = filterSymbol.trim().toUpperCase();

    const next = rows.filter((row) => {
      const effectiveSource = getEffectiveRowSource(row, signalSource);
      if (symbolSearch && !row.symbol.toUpperCase().includes(symbolSearch)) return false;
      if (filterSignal !== "all" && resolveSignal(row, effectiveSource) !== filterSignal) return false;
      if (filterTimeframe !== "all" && row.timeframe !== filterTimeframe) return false;
      if (filterMarket !== "all" && row.marketType !== filterMarket) return false;
      if (filterPrompt.trim()) {
        const promptSearch = filterPrompt.trim().toLowerCase();
        const promptLabel = `${row.aiPromptTemplateName ?? ""} ${row.localStrategyName ?? ""} ${row.compositeStrategyName ?? ""}`.toLowerCase();
        if (!promptLabel.includes(promptSearch)) return false;
      }
      if (filterProvider !== "all" && (row.strategyRef?.kind ?? "ai") !== filterProvider) return false;
      if (filterResult !== "all") {
        if (filterResult === "pending" && row.outcomeStatus === "closed") return false;
        if (filterResult === "closed" && row.outcomeStatus !== "closed") return false;
        if (filterResult !== "pending" && filterResult !== "closed" && row.outcomeResult !== filterResult) return false;
      }
      return true;
    });

    next.sort((a, b) => {
      const sourceA = getEffectiveRowSource(a, signalSource);
      const sourceB = getEffectiveRowSource(b, signalSource);
      if (sortMode === "confidence") {
        const confidenceB = resolveConfidence(b, sourceB);
        const confidenceA = resolveConfidence(a, sourceA);
        return (
          (confidenceB <= 1 ? confidenceB * 100 : confidenceB) -
          (confidenceA <= 1 ? confidenceA * 100 : confidenceA)
        );
      }
      if (sortMode === "move") {
        return Math.abs(resolveExpectedMove(b, sourceB)) - Math.abs(resolveExpectedMove(a, sourceA));
      }
      return new Date(b.tsCreated).getTime() - new Date(a.tsCreated).getTime();
    });

    return next;
  }, [filterMarket, filterPrompt, filterProvider, filterResult, filterSignal, filterSymbol, filterTimeframe, rows, signalSource, sortMode]);

  const filteredRunningRows = useMemo(() => {
    if (runningStatusFilter === "all") return runningRows;
    return runningRows.filter((row) =>
      runningStatusFilter === "paused" ? row.paused : !row.paused
    );
  }, [runningRows, runningStatusFilter]);

  const actionableRowsCount = useMemo(
    () => filteredRows.filter((row) => canSendToDesk(row, signalSource)).length,
    [filteredRows, signalSource]
  );
  const autoEnabledRowsCount = useMemo(
    () => filteredRows.filter((row) => Boolean(row.autoScheduleEnabled)).length,
    [filteredRows]
  );
  const aiDisagreementRowsCount = useMemo(
    () =>
      filteredRows.filter((row) => {
        if (!isRowDisagreementRelevant(row)) return false;
        const localSignal = row.localPrediction?.signal ?? row.signal;
        return Boolean(row.aiPrediction) && row.aiPrediction!.signal !== localSignal;
      }).length,
    [filteredRows]
  );
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterSymbol.trim()) count += 1;
    if (filterSignal !== "all") count += 1;
    if (filterTimeframe !== "all") count += 1;
    if (filterMarket !== "all") count += 1;
    if (filterPrompt.trim()) count += 1;
    if (filterProvider !== "all") count += 1;
    if (filterResult !== "all") count += 1;
    if (signalSource !== "local") count += 1;
    if (sortMode !== "newest") count += 1;
    return count;
  }, [filterMarket, filterPrompt, filterProvider, filterResult, filterSignal, filterSymbol, filterTimeframe, signalSource, sortMode]);

  const todayAnalysesCount = useMemo(() => {
    const today = new Date(nowMs);
    return rows.filter((row) => {
      const created = new Date(row.tsCreated);
      return created.getFullYear() === today.getFullYear()
        && created.getMonth() === today.getMonth()
        && created.getDate() === today.getDate();
    }).length;
  }, [nowMs, rows]);
  const averageConfidencePct = useMemo(
    () => averageConfidence(rows.map((row) => resolveConfidence(row, getEffectiveRowSource(row, signalSource)))),
    [rows, signalSource]
  );
  const degradedSourcesCount = useMemo(
    () => runningRows.filter((row) => isPredictionRefreshDegraded(row)).length,
    [runningRows]
  );
  const recentPredictions = useMemo(
    () => [...rows].sort((a, b) => new Date(b.tsCreated).getTime() - new Date(a.tsCreated).getTime()).slice(0, 5),
    [rows]
  );
  const evaluatedPerformanceRows = useMemo(
    () => filteredRows.filter((row) => row.outcomeStatus === "closed"),
    [filteredRows]
  );
  const averageMfePct = useMemo(() => {
    const values = evaluatedPerformanceRows.map((row) => row.maxFavorablePct).filter((value): value is number => typeof value === "number");
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [evaluatedPerformanceRows]);
  const averageMaePct = useMemo(() => {
    const values = evaluatedPerformanceRows.map((row) => row.maxAdversePct).filter((value): value is number => typeof value === "number");
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [evaluatedPerformanceRows]);

  function openPredictionWizard(row?: PredictionListItem) {
    setAnalysisKind("trading_with_intelligence");
    if (row) {
      setNewSymbol(row.symbol);
      setNewMarketType(row.marketType);
      setNewTimeframe(row.timeframe);
      if (row.accountId) setCreateAccountId(row.accountId);
      if (row.strategyRef) setNewStrategySelectValue(encodeStrategySelectValue(row.strategyRef));
    }
    setWizardStep(row ? "market" : "type");
    setWizardOpen(true);
  }

  function closeAnalysisWizard() {
    setWizardOpen(false);
    setAnalysisKind("trading_with_intelligence");
    setWizardStep("type");
    setActionError(null);
  }

  function nextPredictionWizardStep() {
    setActionError(null);
    if (wizardStep === "type" && analysisKind === "market_intelligence" && !marketIntelligenceAllowed) {
      setActionError(tPred("wizard.marketIntelligenceUnavailable"));
      return;
    }
    if (wizardStep === "market" && (!createAccountId || !newSymbol.trim())) {
      setActionError(
        !createAccountId
          ? tPred("create.validationSelectExchangeAccount")
          : tPred("create.validationSelectPair")
      );
      return;
    }
    if (wizardStep === "advanced" && newMarketType === "perp") {
      const leverage = Number(newLeverage);
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
        setActionError(tPred("create.validationLeverageRange"));
        return;
      }
    }
    const currentIndex = wizardSteps.findIndex((entry) => entry.id === wizardStep);
    setWizardStep(wizardSteps[Math.min(currentIndex + 1, wizardSteps.length - 1)]?.id ?? "type");
  }

  function previousPredictionWizardStep() {
    const currentIndex = wizardSteps.findIndex((entry) => entry.id === wizardStep);
    setWizardStep(wizardSteps[Math.max(0, currentIndex - 1)]?.id ?? "type");
  }

  async function createMarketIntelligenceAnalysis() {
    setActionError(null);
    setCreatingMarketIntelligence(true);
    try {
      const result = await apiPost<{ analysis: { id: string } }>("/market-intelligence/analyses", {
        requestId: crypto.randomUUID(),
        horizon: marketIntelligenceHorizon,
        responseLanguage: newResponseLanguage
      });
      setWizardOpen(false);
      router.push(`${withLocalePath("/market-intelligence", locale)}?analysis=${encodeURIComponent(result.analysis.id)}`);
    } catch (error) {
      setActionError(errMsg(error));
    } finally {
      setCreatingMarketIntelligence(false);
    }
  }

  async function sendToDesk(id: string) {
    setActionError(null);
    setNotice(null);
    setSendingId(id);
    try {
      const detail = await apiGet<PredictionDetailResponse>(`/api/predictions/${id}`);
      const row = rows.find((item) => item.id === id);
      const localPrediction =
        row?.localPrediction ?? readAiPrediction(asRecord(detail.featureSnapshot).localPrediction);
      const aiPrediction =
        row?.aiPrediction ?? readAiPrediction(asRecord(detail.featureSnapshot).aiPrediction);
      const effectiveSource = row ? getEffectiveRowSource(row, signalSource) : signalSource;
      if (!detail.accountId) {
        throw new Error("No exchange account available for this prediction.");
      }
      const detailForPrefill: PredictionDetailResponse =
        effectiveSource === "ai" && aiPrediction
          ? {
              ...detail,
              signal: aiPrediction.signal,
              confidence: aiPrediction.confidence,
              expectedMovePct: aiPrediction.expectedMovePct
            }
          : effectiveSource === "local" && localPrediction
            ? {
                ...detail,
                signal: localPrediction.signal,
                confidence: localPrediction.confidence,
                expectedMovePct: localPrediction.expectedMovePct
              }
          : detail;
      const built = buildTradeDeskPrefillPayload(detailForPrefill);
      sessionStorage.setItem(TRADE_DESK_PREFILL_SESSION_KEY, JSON.stringify(built.payload));
      if (built.info) {
        setNotice(built.info);
      }
      const params = new URLSearchParams({
        prefill: "1",
        exchangeAccountId: built.payload.accountId
      });
      router.push(`${withLocalePath("/trading-desk", locale)}?${params.toString()}`);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSendingId(null);
    }
  }

  async function togglePredictionDetail(id: string) {
    setDetailsError(null);
    if (expandedDetailId === id) {
      setExpandedDetailId(null);
      return;
    }

    setExpandedDetailId(id);
    if (detailsById[id]) return;

    setDetailsLoadingId(id);
    try {
      const detail = await apiGet<PredictionDetailResponse>(`/api/predictions/${id}`);
      setDetailsById((prev) => ({ ...prev, [id]: detail }));
    } catch (e) {
      setDetailsError(errMsg(e));
    } finally {
      setDetailsLoadingId(null);
    }
  }

  async function loadPredictionEvents(stateId: string) {
    if (eventsByStateId[stateId]) return;
    setEventsLoadingStateId(stateId);
    setEventsErrorByStateId((prev) => ({ ...prev, [stateId]: null }));
    try {
      const payload = await apiGet<{ items: PredictionEventItem[] }>(
        `/api/predictions/events?stateId=${encodeURIComponent(stateId)}&limit=10`
      );
      setEventsByStateId((prev) => ({
        ...prev,
        [stateId]: Array.isArray(payload.items) ? payload.items : []
      }));
    } catch {
      setEventsErrorByStateId((prev) => ({
        ...prev,
        [stateId]: tPred("create.eventsLoadFailed")
      }));
    } finally {
      setEventsLoadingStateId(null);
    }
  }

  function toggleEventLog(stateId: string) {
    const nextExpanded = !expandedEventsByStateId[stateId];
    setExpandedEventsByStateId((prev) => ({ ...prev, [stateId]: nextExpanded }));
    if (nextExpanded) {
      void loadPredictionEvents(stateId);
    }
  }

  async function createPrediction() {
    setActionError(null);
    setNotice(null);

    const symbol = newSymbol.trim().toUpperCase();
    const leverage = Number(newLeverage);

    if (!createAccountId) {
      setActionError(tPred("create.validationSelectExchangeAccount"));
      return;
    }
    if (!symbol) {
      setActionError(tPred("create.validationSelectPair"));
      return;
    }
    if (newMarketType === "perp" && (!Number.isFinite(leverage) || leverage < 1 || leverage > 125)) {
      setActionError(tPred("create.validationLeverageRange"));
      return;
    }
    if (createBlockedByLimit) {
      setActionError(
        tPred("create.limitBlockedRunning", {
          usage: selectedCreateRunningUsage,
          limit: selectedCreateRunningLimit ?? 0
        })
      );
      return;
    }
    if (createBlockedByFeature) {
      setActionError(
        tCommon("licenseGate.body", {
          feature: createBlockedFeatureTitle
        })
      );
      return;
    }

    setCreating(true);
    try {
      const response = await apiPost<{
        existing?: boolean;
        existingStateId?: string | null;
        prediction: {
          signal: PredictionSignal;
          confidence: number;
          expectedMovePct: number;
          timeframe: PredictionTimeframe;
        };
        directionPreference: DirectionPreference;
        confidenceTargetPct: number;
        signalSource: SignalSource;
        signalMode: CreateSignalMode;
        aiPromptTemplateId?: string | null;
        aiPromptTemplateName?: string | null;
        localStrategyId?: string | null;
        localStrategyName?: string | null;
        compositeStrategyId?: string | null;
        compositeStrategyName?: string | null;
        strategyRef?: StrategyRef | null;
      }>("/api/predictions/generate-auto", {
        exchangeAccountId: createAccountId,
        symbol,
        marketType: newMarketType,
        timeframe: effectiveCreateTimeframe,
        horizonMs: newHorizonMs,
        strategyRef: selectedStrategyRef ?? undefined,
        aiPromptTemplateId: selectedStrategyRef?.kind === "ai" ? selectedStrategyRef.id : undefined,
        compositeStrategyId: selectedStrategyRef?.kind === "composite" ? selectedStrategyRef.id : undefined,
        responseLanguage: newResponseLanguage,
        includeMarketIntelligence: marketIntelligenceAllowed,
        leverage: newMarketType === "perp" ? Math.trunc(leverage) : undefined
      });
      const modeLabel =
        response.signalMode === "local_only"
          ? tPred("modes.localOnly")
          : response.signalMode === "ai_only"
            ? tPred("modes.aiOnly")
            : tPred("modes.both");

      if (response.existing) {
        setNotice(
          tPred("create.existingNotice", {
            symbol,
            timeframe: response.prediction.timeframe,
            strategy: strategyRefLabel(response.strategyRef, {
              aiPromptTemplateName: response.aiPromptTemplateName,
              localStrategyName: response.localStrategyName,
              compositeStrategyName: response.compositeStrategyName
            })
          })
        );
      } else {
        setNotice(
          tPred("create.createdNotice", {
            symbol,
            timeframe: response.prediction.timeframe,
            signal: response.prediction.signal,
            confidence: fmtConfidence(response.prediction.confidence),
            modeLabel,
            source: response.signalSource.toUpperCase(),
            strategy: strategyRefLabel(response.strategyRef, {
              aiPromptTemplateName: response.aiPromptTemplateName,
              localStrategyName: response.localStrategyName,
              compositeStrategyName: response.compositeStrategyName
            }),
            direction: response.directionPreference,
            target: response.confidenceTargetPct.toFixed(0)
          })
        );
      }
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionMetrics(),
        loadSubscriptionQuota()
      ]);
      setWizardOpen(false);
      setAnalysisKind("trading_with_intelligence");
      setWizardStep("type");
      setActiveView("overview");
    } catch (e) {
      setActionError(quotaErrorMessage(e, tPred) ?? errMsg(e));
    } finally {
      setCreating(false);
    }
  }

  async function togglePausePrediction(row: RunningPredictionItem) {
    setActionError(null);
    setNotice(null);
    setRunningActionId(row.id);
    try {
      const nextPaused = !row.paused;
      const response = await apiPost<{ updatedCount: number; paused: boolean }>(
        `/api/predictions/${row.id}/pause`,
        { paused: nextPaused }
      );
      setNotice(
        response.paused
          ? tPred("running.pausedNotice", { count: response.updatedCount })
          : tPred("running.resumedNotice", { count: response.updatedCount })
      );
      setRunningRows((current) =>
        current.map((item) => item.id === row.id ? { ...item, paused: response.paused } : item)
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, autoScheduleEnabled: !response.paused } : item
        )
      );
      refreshPredictionOverviewInBackground();
    } catch (e) {
      setActionError(quotaErrorMessage(e, tPred) ?? errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  async function deleteRunningPrediction(id: string) {
    const confirmed = window.confirm(
      tPred("running.confirmDelete")
    );
    if (!confirmed) return;

    setActionError(null);
    setNotice(null);
    setRunningActionId(id);
    try {
      const response = await apiPost<{ deletedCount: number }>(`/api/predictions/${id}/delete-schedule`, {});
      setNotice(tPred("running.deletedNotice", { count: response.deletedCount }));
      await Promise.all([
        loadPredictions(),
        loadRunningPredictions(),
        loadPredictionQuality(),
        loadPredictionMetrics(),
        loadSubscriptionQuota()
      ]);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setRunningActionId(null);
    }
  }

  function resetFilters() {
    setFilterSymbol("");
    setFilterSignal("all");
    setFilterTimeframe("all");
    setFilterMarket("all");
    setFilterPrompt("");
    setFilterProvider("all");
    setFilterResult("all");
    setSignalSource("local");
    setSortMode("newest");
  }

  async function resetPerformanceStats() {
    const confirmed = window.confirm(tPred("performance.resetConfirm"));
    if (!confirmed) return;
    setResettingPerformance(true);
    setActionError(null);
    try {
      const payload = await apiPost<{ ok: boolean; resetAt: string }>(
        "/api/predictions/performance/reset",
        {}
      );
      setPerformanceResetAt(payload.resetAt ?? null);
      await Promise.all([loadPredictionQuality(), loadPredictionMetrics()]);
      setNotice(
        tPred("performance.resetSuccess", {
          date: payload.resetAt ? new Date(payload.resetAt).toLocaleString() : "n/a"
        })
      );
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setResettingPerformance(false);
    }
  }

  function renderIndicatorDetail(row: PredictionListItem) {
    const rowId = row.id;
    const detail = detailsById[rowId];
    const indicators = detail?.indicators ?? null;
    const detailSnapshot = asRecord(detail?.featureSnapshot);
    const localPrediction = row.localPrediction ?? readAiPrediction(detailSnapshot.localPrediction);
    const aiPrediction = row.aiPrediction ?? readAiPrediction(detailSnapshot.aiPrediction);
    const strategyRef = row.strategyRef ?? normalizeStrategyRef(detailSnapshot.strategyRef);
    const strategyRunOutput = asRecord(detailSnapshot.strategyRunOutput);
    const strategyRunDebug = asRecord(detailSnapshot.strategyRunDebug);
    const marketIntelligenceSnapshot = asRecord(detailSnapshot.marketIntelligence);
    const marketIntelligenceFacts = Array.isArray(marketIntelligenceSnapshot.facts)
      ? marketIntelligenceSnapshot.facts.map(asRecord)
      : [];
    const marketIntelligenceEvents = Array.isArray(marketIntelligenceSnapshot.upcomingHighImpactEvents)
      ? marketIntelligenceSnapshot.upcomingHighImpactEvents.map(asRecord)
      : [];
    const marketIntelligenceWarnings = Array.isArray(marketIntelligenceSnapshot.warnings)
      ? marketIntelligenceSnapshot.warnings.map((entry) => String(entry))
      : [];
    const effectiveSource = getEffectiveRowSource(row, signalSource);
    const activeSignal = resolveSignal(row, effectiveSource);
    const activeConfidence = resolveConfidence(row, effectiveSource);
    const activeMove = resolveExpectedMove(row, effectiveSource);
    const showLocalAiComparison = isRowDisagreementRelevant(row);
    const loadingDetail = detailsLoadingId === rowId;
    const dataGap = Boolean(indicators?.dataGap || detail?.riskFlags?.dataGap);
    const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
    const parsedReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
    const manualReason = describeManualReason({
      parsedReason,
      autoEnabled: Boolean(row.autoScheduleEnabled)
    });
    const events = eventsByStateId[rowId] ?? detail?.events ?? [];
    const eventsExpanded = Boolean(expandedEventsByStateId[rowId]);
    const eventsLoading = eventsLoadingStateId === rowId;
    const eventsError = eventsErrorByStateId[rowId] ?? null;
    const detailRealized = detail?.realized ?? null;
    const detailErrorMetrics = asRecord(detailRealized?.errorMetrics);
    const realizedReturnPct =
      typeof row.realizedReturnPct === "number"
        ? row.realizedReturnPct
        : toNum(detailRealized?.realizedReturnPct);
    const realizedEvaluatedAt =
      row.realizedEvaluatedAt ??
      (typeof detailRealized?.evaluatedAt === "string" ? detailRealized.evaluatedAt : null);
    const realizedHit =
      typeof row.realizedHit === "boolean"
        ? row.realizedHit
        : readHitValue(detailErrorMetrics.hit);
    const realizedAbsError =
      typeof row.realizedAbsError === "number"
        ? row.realizedAbsError
        : toNum(detailErrorMetrics.absError);
    const realizedSqError =
      typeof row.realizedSqError === "number"
        ? row.realizedSqError
        : toNum(detailErrorMetrics.sqError);

    const reasonBadgeClass =
      parsedReason.kind === "triggered"
        ? "predictionReasonBadgeTrigger"
        : parsedReason.kind === "scheduled"
          ? "predictionReasonBadgeScheduled"
          : parsedReason.kind === "manual"
            ? "predictionReasonBadgeManual"
            : "predictionReasonBadgeUnknown";
    const copierState = runningRows.find((candidate) =>
      candidate.symbol === row.symbol
      && candidate.timeframe === row.timeframe
      && candidate.marketType === row.marketType
      && (!row.accountId || candidate.exchangeAccountId === row.accountId)
    ) ?? null;
    const copierEligible = Boolean(
      copierState
      && !copierState.paused
      && activeSignal !== "neutral"
      && !dataGap
      && !isPredictionRefreshDegraded(row)
    );
    const rewardDistance = row.entryPrice != null && row.takeProfitPrice != null
      ? Math.abs(row.takeProfitPrice - row.entryPrice)
      : null;
    const riskDistance = row.entryPrice != null && row.stopLossPrice != null
      ? Math.abs(row.entryPrice - row.stopLossPrice)
      : null;
    const riskReward = rewardDistance != null && riskDistance != null && riskDistance > 0
      ? rewardDistance / riskDistance
      : null;

    if (loadingDetail && !detail) {
      return (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          {tPred("detail.loadingDetails")}
        </div>
      );
    }

    return (
      <PredictionDetailDrawer
        title={`${row.symbol} · ${row.timeframe}`}
        subtitle={tPred("detail.executiveSummary")}
        closeLabel={tPred("wizard.close")}
        onClose={() => setExpandedDetailId(null)}
      >
      <div className="predictionDetailStack">
        <DeskSurface><div className="card predictionDetailPanel">
          <div className="predictionDetailHeader">
            <div className="predictionDetailHeaderCopy">
              <span className="predictionSectionEyebrow">{tPred("detail.overviewEyebrow")}</span>
              <strong>{tPred("detail.contextTitle")}</strong>
            </div>
          </div>

          <div className="predictionContextSummaryGrid">
            <DeskSurface><div className="card predictionContextSummaryCard">
              <div className="predictionIndicatorTitle">{tPred("detail.selectedSignal")}</div>
              <div className="predictionIndicatorValue">{activeSignal}</div>
              <div className="predictionIndicatorMeta">
                conf {fmtConfidence(activeConfidence)} · move {activeMove.toFixed(2)}%
              </div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionContextSummaryCard">
              <div className="predictionIndicatorTitle">{tPred("detail.signalSource")}</div>
              <div className="predictionIndicatorValue">{effectiveSource === "ai" ? tPred("detail.sourceAi") : tPred("detail.sourceLocal")}</div>
              <div className="predictionIndicatorMeta">
                {tPred("create.signalMode")}: {signalModeLabel(row.signalMode, modeLabels)}
              </div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionContextSummaryCard">
              <div className="predictionIndicatorTitle">{tPred("detail.strategy")}</div>
              <div className="predictionIndicatorValue predictionIndicatorValueWrap">
                {strategyRefLabel(strategyRef, {
                  aiPromptTemplateName: row.aiPromptTemplateName,
                  localStrategyName: row.localStrategyName,
                  compositeStrategyName: row.compositeStrategyName
                })}
              </div>
              <div className="predictionIndicatorMeta">
                {typeof strategyRunOutput.status === "string"
                  ? tPred("detail.runStatus", { status: strategyRunOutput.status })
                  : tPred("detail.runStatusUnknown")}
              </div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionContextSummaryCard">
              <div className="predictionIndicatorTitle">{tPred("detail.lastUpdated")}</div>
              <div className="predictionIndicatorValue">{formatRelativeTime(updatedAtIso, nowMs)}</div>
              <div className="predictionIndicatorMeta">
                {updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}
              </div>
            </div></DeskSurface>
          </div>

          <div className="predictionContextRow">
            <DeskBadge className={`badge ${reasonBadgeClass}`}>{manualReason.label}</DeskBadge>
            {parsedReason.signalFlip ? (
              <DeskBadge className="badge predictionFlipBadge">FLIP {formatFlipLabel(parsedReason.signalFlip)}</DeskBadge>
            ) : null}
            <span
              className={`predictionUpdateMeta ${isRecentTimestamp(updatedAtIso, nowMs, 2 * 60 * 1000) ? "predictionUpdateMetaFresh" : ""}`}
              title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}
            >
              {tPred("detail.lastUpdatedRelative", { value: formatRelativeTime(updatedAtIso, nowMs) })}
            </span>
          </div>
          <div className="predictionContextReason">
            {tPred("detail.reasonLabel")}: {manualReason.shortReason}
          </div>
          {showLocalAiComparison && effectiveSource === "ai" && !aiPrediction ? (
            <div className="predictionContextReason">
              {tPred("detail.signalSourceFallback")}
            </div>
          ) : null}
          {row.explanation ? (
            <div className="predictionContextExplanation">
              <strong>{tPred("detail.aiExplanation")}</strong>
              <div className="predictionContextExplanationText">{row.explanation}</div>
            </div>
          ) : null}

          {dataGap ? (
            <span className="predictionDetailWarning">
              {tPred("detail.dataGapDetected")}
            </span>
          ) : null}

          <div className="predictionIndicatorGrid">
            {showLocalAiComparison ? (
              <DeskSurface><div className="card predictionIndicatorCard">
                <div className="predictionIndicatorTitle">{tPred("detail.localVsAi")}</div>
                <div className="predictionIndicatorValue">
                  {(localPrediction?.signal ?? row.signal)} / {aiPrediction?.signal ?? "n/a"}
                </div>
                <div className="predictionIndicatorMeta">
                  local {fmtConfidence(localPrediction?.confidence ?? row.confidence)} · ai {aiPrediction ? fmtConfidence(aiPrediction.confidence) : "n/a"}
                </div>
              </div></DeskSurface>
            ) : null}
            <DeskSurface><div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">{tPred("detail.evaluated")}</div>
              <div className="predictionIndicatorValue">{realizedEvaluatedAt ? tPred("detail.yes") : tPred("detail.no")}</div>
              <div className="predictionIndicatorMeta">
                {realizedEvaluatedAt
                  ? tPred("detail.evaluatedAt", { value: new Date(realizedEvaluatedAt).toLocaleString() })
                  : tPred("detail.horizonPending")}
              </div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">{tPred("detail.realizedReturnPct")}</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedReturnPct, 4)}</div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">{tPred("detail.directionalHit")}</div>
              <div className="predictionIndicatorValue">
                {realizedHit === null ? "n/a" : realizedHit ? tPred("detail.hit") : tPred("detail.miss")}
              </div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">{tPred("detail.absError")}</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedAbsError, 4)}</div>
            </div></DeskSurface>
            <DeskSurface><div className="card predictionIndicatorCard">
              <div className="predictionIndicatorTitle">{tPred("detail.sqError")}</div>
              <div className="predictionIndicatorValue">{fmtNum(realizedSqError, 4)}</div>
            </div></DeskSurface>
            {indicators ? (
              <>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">RSI (14)</div>
                  <div className="predictionIndicatorValue">{fmtNum(indicators.rsi_14, 2)}</div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">MACD (line / signal / hist)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.macd?.line, 4)} / {fmtNum(indicators.macd?.signal, 4)} / {fmtNum(indicators.macd?.hist, 4)}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">Bollinger (width% / pos)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.bb?.width_pct, 2)} / {fmtNum(indicators.bb?.pos, 3)}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">VWAP (value / dist%)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.vwap?.value, 2)} / {fmtNum(indicators.vwap?.dist_pct, 2)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    mode: {indicators.vwap?.mode ?? "n/a"}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">ADX (ADX / +DI / -DI)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.adx?.adx_14, 2)} / {fmtNum(indicators.adx?.plus_di_14, 2)} / {fmtNum(indicators.adx?.minus_di_14, 2)}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">StochRSI (%K / %D / value)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.stochrsi?.k, 1)} / {fmtNum(indicators.stochrsi?.d, 1)} / {fmtNum(indicators.stochrsi?.value, 1)}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">Volume (z / rel / trend%)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.volume?.vol_z, 3)} / {fmtNum(indicators.volume?.rel_vol, 3)} / {fmtNum(indicators.volume?.vol_trend, 2)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    EMA fast/slow: {fmtNum(indicators.volume?.vol_ema_fast, 2)} / {fmtNum(indicators.volume?.vol_ema_slow, 2)}
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">FVG (open bull / bear)</div>
                  <div className="predictionIndicatorValue">
                    {fmtNum(indicators.fvg?.open_bullish_count, 0)} / {fmtNum(indicators.fvg?.open_bearish_count, 0)}
                  </div>
                  <div className="predictionIndicatorMeta">
                    bull dist: {fmtNum(indicators.fvg?.nearest_bullish_gap?.dist_pct, 2)}% · bear dist: {fmtNum(indicators.fvg?.nearest_bearish_gap?.dist_pct, 2)}%
                  </div>
                </div></DeskSurface>
                <DeskSurface><div className="card predictionIndicatorCard">
                  <div className="predictionIndicatorTitle">ATR %</div>
                  <div className="predictionIndicatorValue">{fmtNum(indicators.atr_pct, 4)}</div>
                </div></DeskSurface>
              </>
            ) : (
              <DeskSurface><div className="card predictionIndicatorCard">
                <div className="predictionIndicatorTitle">{tPred("detail.indicators")}</div>
                <div className="predictionIndicatorValue">n/a</div>
                <div className="predictionIndicatorMeta">{tPred("detail.noIndicators")}</div>
              </div></DeskSurface>
            )}
          </div>
          {Object.keys(strategyRunOutput).length > 0 || Object.keys(strategyRunDebug).length > 0 ? (
            <details className="predictionDebugDetails">
              <summary>{tPred("detail.strategyDebug")}</summary>
              <pre
                className="predictionDebugPre"
                style={{
                  marginTop: 8,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: 12,
                  background: "rgba(0,0,0,0.18)",
                  padding: 10,
                  borderRadius: 8
                }}
              >
                {JSON.stringify(
                  {
                    strategyRunOutput: Object.keys(strategyRunOutput).length > 0 ? strategyRunOutput : null,
                    strategyRunDebug: Object.keys(strategyRunDebug).length > 0 ? strategyRunDebug : null
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          ) : null}
        </div></DeskSurface>

        {marketIntelligenceAllowed && (
          detailSnapshot.marketIntelligencePolicy === "include"
          || marketIntelligenceFacts.length > 0
          || marketIntelligenceEvents.length > 0
        ) ? (
          <DeskSurface><div className="card predictionDetailPanel">
            <div className="predictionDetailHeaderCopy">
              <span className="predictionSectionEyebrow">{tPred("detail.marketIntelligenceEyebrow")}</span>
              <strong>{tPred("detail.marketIntelligenceTitle")}</strong>
            </div>
            {marketIntelligenceSnapshot.degraded === true ? (
              <DeskSurface><div className="uiNotice uiNotice-warning">{tPred("detail.marketIntelligenceDegraded")}</div></DeskSurface>
            ) : null}
            <div className="predictionIntelligenceSnapshotMeta">
              <DeskBadge className="badge">{tPred("detail.factsCount", { count: marketIntelligenceFacts.length })}</DeskBadge>
              <DeskBadge className="badge">{tPred("detail.eventsCount", { count: marketIntelligenceEvents.length })}</DeskBadge>
              <DeskBadge className="badge">
                {typeof marketIntelligenceSnapshot.generatedAt === "string"
                  ? new Date(marketIntelligenceSnapshot.generatedAt).toLocaleString()
                  : tPred("misc.na")}
              </DeskBadge>
            </div>
            <div className="predictionIntelligenceSnapshotList">
              {marketIntelligenceFacts.map((fact, index) => (
                <div key={String(fact.id ?? index)}>
                  <AppIcon name="news" />
                  <div>
                    <strong>{String(fact.title ?? tPred("misc.na"))}</strong>
                    <span>{String(fact.sourceName ?? tPred("misc.na"))}</span>
                  </div>
                </div>
              ))}
              {marketIntelligenceEvents.map((event, index) => (
                <div key={String(event.id ?? index)}>
                  <AppIcon name="calendar" />
                  <div>
                    <strong>{String(event.title ?? tPred("misc.na"))}</strong>
                    <span>{typeof event.scheduledAt === "string" ? new Date(event.scheduledAt).toLocaleString() : tPred("misc.na")}</span>
                  </div>
                </div>
              ))}
            </div>
            {marketIntelligenceWarnings.length > 0 ? (
              <p className="predictionIndicatorMeta">{marketIntelligenceWarnings.join(" · ")}</p>
            ) : null}
          </div></DeskSurface>
        ) : null}

        <DeskSurface><div className="card predictionDetailPanel predictionDecisionPanel">
          <div className="predictionDetailHeaderCopy">
            <span className="predictionSectionEyebrow">{tPred("detail.tradePlanEyebrow")}</span>
            <strong>{tPred("detail.tradePlan")}</strong>
          </div>
          <div className="predictionDecisionGrid">
            <div><span>{tPred("detail.entryZone")}</span><strong>{fmtNum(row.entryPrice, 4)}</strong></div>
            <div><span>{tPred("detail.stopInvalidation")}</span><strong>{fmtNum(row.stopLossPrice, 4)}</strong></div>
            <div><span>{tPred("detail.targets")}</span><strong>{fmtNum(row.takeProfitPrice, 4)}</strong></div>
            <div><span>{tPred("detail.riskReward")}</span><strong>{riskReward == null ? "n/a" : `1 : ${riskReward.toFixed(2)}`}</strong></div>
            <div><span>{tPred("detail.candleTimeframe")}</span><strong>{row.timeframe}</strong></div>
            <div><span>{tPred("detail.analysisHorizon")}</span><strong>{row.horizonMs ? fmtMs(row.horizonMs) : "n/a"}</strong></div>
          </div>
          <div className="predictionDetailNarrativeGrid">
            <div>
              <strong>{tPred("detail.keyDrivers")}</strong>
              <p>{row.tags.length > 0 ? row.tags.join(" · ") : tPred("detail.noKeyDrivers")}</p>
            </div>
            <div>
              <strong>{tPred("detail.invalidations")}</strong>
              <p>{row.stopLossPrice != null ? tPred("detail.invalidationAtStop", { price: fmtNum(row.stopLossPrice, 4) }) : tPred("detail.invalidationUnavailable")}</p>
            </div>
            <div>
              <strong>{tPred("detail.riskUncertainty")}</strong>
              <p>{dataGap ? tPred("detail.dataQualityDegraded") : tPred("detail.uncertaintyNotice")}</p>
            </div>
            <div>
              <strong>{tPred("detail.dataSourcesTime")}</strong>
              <p>{row.exchange.toUpperCase()} · {updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}</p>
            </div>
          </div>
        </div></DeskSurface>

        <PredictionCopierEligibility
          eligible={copierEligible}
          href={buildPredictionCopierReviewHref({
            localePath: withLocalePath("/bots/new", locale),
            stateId: copierState?.id ?? row.id,
            accountId: row.accountId
          })}
          title={tPred("copier.eligibilityTitle")}
          description={tPred("copier.reviewOnlyDescription")}
          eligibleLabel={tPred("copier.eligible")}
          unavailableLabel={tPred("copier.notEligible")}
          actionLabel={tPred("copier.configure")}
        />

        <DeskSurface><div className="card predictionDetailPanel">
          <div className="predictionDetailHeader">
            <div className="predictionDetailHeaderCopy">
              <span className="predictionSectionEyebrow">{tPred("detail.timelineEyebrow")}</span>
              <strong>{tPred("detail.recentChanges")}</strong>
            </div>
            <div className="predictionDetailHeaderActions">
              <span className="predictionIndicatorMeta">{tPred("detail.eventsCount", { count: events.length })}</span>
              <DeskButton
                className="btn predictionMiniBtn"
                type="button"
                onClick={() => toggleEventLog(rowId)}
              >
                <AppIcon name="detail" />
                {eventsExpanded ? tPred("detail.hideLog") : tPred("detail.showLog")}
              </DeskButton>
            </div>
          </div>

          {eventsExpanded ? (
            eventsLoading ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                {tPred("detail.loadingEventLog")}
              </div>
            ) : eventsError ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                {eventsError}
              </div>
            ) : events.length === 0 ? (
              <div style={{ color: "var(--muted)", marginTop: 8 }}>
                {tPred("detail.noRecentChanges")}
              </div>
            ) : (
              <div className="predictionEventList">
                {events.map((event) => (
                  <div key={event.id} className="predictionEventItem">
                    <div className="predictionEventHeader">
                      <DeskBadge className="badge">{event.changeType}</DeskBadge>
                      <span
                        className="predictionEventTimestamp"
                        title={event.tsCreated ? new Date(event.tsCreated).toLocaleString() : "n/a"}
                      >
                        {formatRelativeTime(event.tsCreated, nowMs)}
                      </span>
                    </div>
                    <div className="predictionEventReason">{event.reason ?? "n/a"}</div>
                    <div className="predictionEventDelta">
                      {summarizeEventDelta(event.delta)}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div style={{ color: "var(--muted)", marginTop: 8 }}>
              {tPred("detail.expandForEvents")}
            </div>
          )}
        </div></DeskSurface>
        <div className="predictionDetailActionsBar">
          <DeskButton className="btn btnPrimary" type="button" onClick={() => void sendToDesk(row.id)} disabled={!canSendToDesk(row, signalSource)}>
            <AppIcon name="trading" />
            {tPred("detail.openTradingDesk")}
          </DeskButton>
          <DeskButton className="btn" type="button" onClick={() => { setExpandedDetailId(null); openPredictionWizard(row); }}>
            <AppIcon name="copy" />
            {tPred("detail.createSimilar")}
          </DeskButton>
          <DeskButton className="btn" type="button" onClick={() => { setExpandedDetailId(null); setActiveView("active"); }}>
            <AppIcon name="preview" />
            {tPred("detail.monitorMarket")}
          </DeskButton>
          <DeskLink className="btn" href={withLocalePath("/strategies", locale)}>
            <AppIcon name="template" />
            {tPred("detail.saveTemplate")}
          </DeskLink>
        </div>
      </div>
      </PredictionDetailDrawer>
    );
  }

  return (
    <div className="predictionsWrap">
      <PageHeader
        title={tPred("title")}
        description={tPred("subtitle")}
        actions={(
          <DeskButton className="btn btnPrimary" type="button" onClick={() => openPredictionWizard()}>
            <AppIcon name="create" />
            {tPred("navigation.newAnalysis")}
          </DeskButton>
        )}
      />

      <nav className="predictionTabs" aria-label={tPred("navigation.label")}>
        {(["overview", "active", "history", "performance"] as PredictionsView[]).map((view) => (
          <DeskButton
            key={view}
            className={`predictionTab ${activeView === view ? "predictionTabActive" : ""}`}
            type="button"
            onClick={() => setActiveView(view)}
            aria-current={activeView === view ? "page" : undefined}
          >
            <AppIcon name={view === "performance" ? "performance" : view === "active" ? "play" : view === "history" ? "list" : "dashboard"} />
            {tPred(`navigation.${view}`)}
          </DeskButton>
        ))}
      </nav>

      <PredictionsOverview active={activeView === "overview"}>
      <DeskSurface><section className="card predictionsSection predictionQuickStatsSection">
        <div className="predictionQuickStatsGrid">
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.activePredictions")}
            value={runningRows.filter((row) => !row.paused).length}
            tone={runningRows.some((row) => !row.paused) ? "success" : "neutral"}
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.todayAnalyses")}
            value={todayAnalysesCount}
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.averageConfidence")}
            value={averageConfidencePct === null ? "-" : `${averageConfidencePct.toFixed(1)}%`}
            tone={Number(averageConfidencePct ?? 0) >= 70 ? "success" : "neutral"}
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.directionAccuracy")}
            value={metrics?.hitRate == null ? "-" : `${metrics.hitRate.toFixed(1)}%`}
            meta={tPred("performance.evaluated", { count: metrics?.evaluatedCount ?? 0 })}
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.aiUsage")}
            value={`${subscriptionQuota?.usage.predictions.ai.running ?? 0} / ${subscriptionQuota?.limits.predictions.ai.maxRunning ?? tPred("create.unlimited")}`}
            meta={tPred("overview.runningAllocation")}
            tone="info"
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.dataSources")}
            value={degradedSourcesCount > 0 ? tPred("overview.degraded") : tPred("overview.operational")}
            meta={degradedSourcesCount > 0 ? tPred("overview.degradedCount", { count: degradedSourcesCount }) : tPred("overview.allSourcesHealthy")}
            tone={degradedSourcesCount > 0 ? "warning" : "success"}
          />
          <MetricTile
            className="predictionQuickStat"
            label={tPred("overview.copierStatus")}
            value={tPred("overview.reviewAvailable")}
            meta={tPred("overview.activeRulesUnavailable")}
            tone="accent"
          />
        </div>
      </section></DeskSurface>

      <DeskSurface><section className="card predictionsSection predictionRecentSection">
        <div className="predictionsListHeader">
          <div className="predictionsListTitle">{tPred("overview.recentPredictions")}</div>
          <DeskButton className="btn" type="button" onClick={() => setActiveView("history")}>
            <AppIcon name="list" />
            {tPred("overview.viewHistory")}
          </DeskButton>
        </div>
        {recentPredictions.length === 0 ? (
          <div className="predictionsListState">{tPred("feed.noPredictions")}</div>
        ) : (
          <div className="predictionRecentList">
            {recentPredictions.map((row) => {
              const source = getEffectiveRowSource(row, signalSource);
              const signal = resolveSignal(row, source);
              const isFinal = row.outcomeStatus === "closed" && Boolean(row.outcomeEvaluatedAt ?? row.realizedEvaluatedAt);
              return (
                <DeskButton className="predictionRecentRow" type="button" key={row.id} onClick={() => void togglePredictionDetail(row.id)}>
                  <span className="predictionRecentSymbol">{row.symbol}</span>
                  <span>{row.marketType} · {row.timeframe}</span>
                  <DeskBadge className="badge" style={signalBadgeStyle(signal)}>{signal}</DeskBadge>
                  <span>{fmtConfidence(resolveConfidence(row, source))}</span>
                  <span>{isFinal ? tPred("overview.finalEvaluation") : tPred("overview.currentOutcome")}</span>
                  <AppIcon name="chevronRight" />
                </DeskButton>
              );
            })}
          </div>
        )}
      </section></DeskSurface>
      </PredictionsOverview>

      {(activeView === "active" || wizardOpen) ? (
      <PredictionCreateWizard
        open={wizardOpen}
        step={wizardStep}
        steps={wizardSteps}
        title={analysisKind === "market_intelligence" ? tPred("wizard.marketIntelligenceTitle") : tPred("wizard.title")}
        description={analysisKind === "market_intelligence" ? tPred("wizard.marketIntelligenceDescription") : tPred("wizard.description")}
        backLabel={tPred("wizard.back")}
        nextLabel={tPred("wizard.next")}
        closeLabel={tPred("wizard.close")}
        generateLabel={tPred("wizard.generate")}
        generatingLabel={tPred("create.creating")}
        canGenerate={analysisKind === "market_intelligence"
          ? marketIntelligenceAllowed
          : !createBlockedByLimit && !createBlockedByFeature}
        generating={analysisKind === "market_intelligence" ? creatingMarketIntelligence : creating}
        onBack={previousPredictionWizardStep}
        onNext={nextPredictionWizardStep}
        onClose={closeAnalysisWizard}
        onGenerate={() => analysisKind === "market_intelligence"
          ? void createMarketIntelligenceAnalysis()
          : void createPrediction()}
      >
      <ActivePredictions active>
      <DeskSurface><section className={`card predictionsSection predictionCreateSection ${wizardOpen ? "predictionCreateWizardMode" : "predictionActiveSchedulesMode"}`}>
        <div className="predictionCreateHeader">
          <div>
            <div className="predictionCreateTitle">
              {analysisKind === "market_intelligence" ? tPred("wizard.marketIntelligenceTitle") : tPred("create.title")}
            </div>
            <div className="predictionsSectionHint">
              {analysisKind === "market_intelligence" ? tPred("wizard.marketIntelligenceDescription") : tPred("create.hint")}
            </div>
          </div>
          {analysisKind === "trading_with_intelligence" ? <div className="predictionCreateHeaderActions">
            <DeskLink className="btn btnPrimary predictionManageStrategiesButton" href={withLocalePath("/strategies", locale)}>
              <AppIcon name="strategies" />
              {tPred("create.manageStrategies")}
            </DeskLink>
            <div className="predictionCreateBadges">
              <StatusBadge tone="success" title={tPred("create.autoScheduleAlwaysOn")}>
                {tPred("create.autoScheduleShort")}
              </StatusBadge>
              <StatusBadge
                tone="accent"
                title={`${tPred("create.signalMode")}: ${createSignalModeLabel} (${createSignalModeScopeTitle})`}
              >
                {tPred("create.signalModeShort")}: {createSignalModeLabel} ({createSignalModeScopeLabel})
              </StatusBadge>
            </div>
          </div> : null}
        </div>
        <div className="predictionCreateGrid">
          <div className="predictionAnalysisKindGrid" data-wizard-section="type">
            <DeskButton
              type="button"
              className={`predictionAnalysisKindOption ${analysisKind === "trading_with_intelligence" ? "predictionAnalysisKindOptionActive" : ""}`}
              onClick={() => setAnalysisKind("trading_with_intelligence")}
            >
              <AppIcon name="predictions" />
              <strong>{marketIntelligenceAllowed ? tPred("wizard.types.tradingTitle") : tPred("create.title")}</strong>
              <span>{marketIntelligenceAllowed ? tPred("wizard.types.tradingDescription") : tPred("create.hint")}</span>
            </DeskButton>
            {marketIntelligenceAllowed ? (
              <DeskButton
                type="button"
                className={`predictionAnalysisKindOption ${analysisKind === "market_intelligence" ? "predictionAnalysisKindOptionActive" : ""}`}
                onClick={() => setAnalysisKind("market_intelligence")}
              >
                <AppIcon name="news" />
                <strong>{tPred("wizard.types.marketIntelligenceTitle")}</strong>
                <span>{tPred("wizard.types.marketIntelligenceDescription")}</span>
              </DeskButton>
            ) : null}
          </div>

          <div className="predictionCreateField" data-wizard-section="scope">
            <div className="predictionCreateLabel">{tPred("wizard.intelligenceHorizon")}</div>
            <div className="predictionCreateHint">{tPred("wizard.intelligenceHorizonHint")}</div>
            <div className="predictionIntelligenceHorizon" role="group" aria-label={tPred("wizard.intelligenceHorizon") }>
              {(["intraday", "24h", "7d"] as MarketIntelligenceHorizon[]).map((horizon) => (
                <DeskButton
                  key={horizon}
                  type="button"
                  className={`btn ${marketIntelligenceHorizon === horizon ? "btnPrimary" : ""}`}
                  aria-pressed={marketIntelligenceHorizon === horizon}
                  onClick={() => setMarketIntelligenceHorizon(horizon)}
                >
                  {tPred(`wizard.intelligenceHorizons.${horizon}`)}
                </DeskButton>
              ))}
            </div>
          </div>

          <label className="predictionCreateField predictionCreateFieldPrompt" data-wizard-section="analysis">
            <div className="predictionCreateLabel">{tPred("create.strategy")}</div>
            <div className="predictionCreateHint">
              {tPred("create.strategyHint")}
            </div>
            <DeskSelect
              className="input"
              value={newStrategySelectValue}
              onChange={(e) => setNewStrategySelectValue(e.target.value)}
              disabled={publicAiPromptsLoading || ownAiPromptsLoading || localStrategiesLoading || compositeStrategiesLoading}
            >
              {!aiDefaultAllowed && allowedAiPrompts.length === 0 && allowedOwnAiPrompts.length === 0 && allowedLocalStrategies.length === 0 && allowedCompositeStrategies.length === 0 ? (
                <option value="ai:default">{tPred("create.noLicensedStrategy")}</option>
              ) : null}
              {aiDefaultAllowed ? (
                <option value="ai:default">{tPred("create.aiSystemDefault")}</option>
              ) : null}
              {aiKindAllowed ? (
                <optgroup label={tPred("create.aiPromptStrategies")}>
                  {allowedAiPrompts.map((prompt) => (
                    <option key={prompt.id} value={encodeStrategySelectValue({ kind: "ai", id: prompt.id, name: prompt.name })}>
                      {prompt.name}
                      {prompt.isPublic === false ? ` (${tPred("create.private")})` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {aiKindAllowed && ownStrategyFeatureEnabled ? (
                <optgroup label={tPred("create.ownStrategies")}>
                  {allowedOwnAiPrompts.map((prompt) => (
                    <option key={prompt.id} value={encodeStrategySelectValue({ kind: "ai", id: prompt.id, name: prompt.name })}>
                      {prompt.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {localKindAllowed ? (
                <optgroup label={tPred("create.localStrategies")}>
                  {allowedLocalStrategies.map((strategy) => (
                    <option key={strategy.id} value={encodeStrategySelectValue({ kind: "local", id: strategy.id, name: strategy.name })}>
                      {strategy.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {compositeKindAllowed ? (
                <optgroup label={tPred("create.compositeStrategies")}>
                  {allowedCompositeStrategies.map((strategy) => (
                    <option key={strategy.id} value={encodeStrategySelectValue({ kind: "composite", id: strategy.id, name: strategy.name })}>
                      {strategy.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </DeskSelect>
            <div className="predictionCreateHint">
              {tPred("create.selected")}: {strategyRefLabel(selectedStrategyRef, {
                aiPromptTemplateName: selectedPrompt?.name ?? null,
                localStrategyName: selectedLocalStrategy?.name ?? null,
                compositeStrategyName: selectedCompositeStrategy?.name ?? null
              })}
            </div>
            <div className="predictionCreateHint">
              {tPred("create.aiLicenseMode")}: {publicAiPromptLicensePolicy?.mode ?? "off"}
              {publicAiPromptLicensePolicy?.enforcementActive
                ? ` (${tPred("create.enforced")})`
                : ` (${tPred("create.previewOff")})`}
              .
            </div>
            <div className="predictionCreateHint predictionCreateHintCompact">
              {selectedStrategyRef?.kind === "ai"
                ? (
                  selectedPromptTimeframes.length > 0
                    ? tPred("create.promptTfSetHint", {
                      set: selectedPromptTimeframes.join(", "),
                      run: selectedPromptLockedTimeframe ?? "n/a"
                    })
                    : `${tPred("create.promptLockTimeframe")}: ${selectedPromptLockedTimeframe ?? "none"}`
                )
                : selectedStrategyRef?.kind === "local"
                  ? `${tPred("create.localType")}: ${selectedLocalStrategy?.strategyType ?? tPred("misc.na")}`
                  : selectedStrategyRef?.kind === "composite"
                    ? `${tPred("create.compositeVersion")}: ${selectedCompositeStrategy?.version ?? tPred("misc.na")}`
                    : tPred("create.noExplicitStrategy")}
            </div>
          </label>

          <label className="predictionCreateField" data-wizard-section="market">
            <div className="predictionCreateLabel">{tPred("create.exchangeAccount")}</div>
            <div className="predictionCreateHint">{tPred("create.exchangeAccountHint")}</div>
            <DeskSelect
              className="input"
              value={createAccountId}
              onChange={(e) => setCreateAccountId(e.target.value)}
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 ? (
                <option value="">{tPred("create.noAccountAvailable")}</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.exchange.toUpperCase()} - {account.label}
                  </option>
                ))
              )}
            </DeskSelect>
          </label>

          <label className="predictionCreateField" data-wizard-section="market">
            <div className="predictionCreateLabel">{tPred("create.pair")}</div>
            <div className="predictionCreateHint">{tPred("create.pairHint")}</div>
            <SymbolSearchSelect
              value={newSymbol}
              onChange={setNewSymbol}
              options={createSymbolOptions}
              loading={symbolsLoading}
              loadingLabel={tPred("create.loadingPairs")}
              emptyLabel={tPred("create.noPairAvailable")}
              searchPlaceholder={tPred("create.pairSearchPlaceholder")}
              restrictedLabel={tPred("create.restricted")}
              disabled={symbolsLoading || createSymbolOptions.length === 0}
            />
          </label>

          <label className="predictionCreateField" data-wizard-section="market">
            <div className="predictionCreateLabel">{tPred("create.marketType")}</div>
            <div className="predictionCreateHint">{tPred("create.marketTypeHint")}</div>
            <DeskSelect className="input" value={newMarketType} onChange={(e) => setNewMarketType(e.target.value as PredictionMarketType)}>
              <option value="perp">perp</option>
              <option value="spot">spot</option>
            </DeskSelect>
          </label>

          <label className="predictionCreateField" data-wizard-section="advanced">
            <div className="predictionCreateLabel">{tPred("create.timeframe")}</div>
            <div className="predictionCreateHint">
              {selectedPromptLockedTimeframe
                ? tPred("create.timeframePromptLocked", { timeframe: selectedPromptLockedTimeframe })
                : tPred("create.timeframeHint")}
            </div>
            <DeskSelect
              className="input"
              value={effectiveCreateTimeframe}
              onChange={(e) => setNewTimeframe(e.target.value as PredictionTimeframe)}
              disabled={Boolean(selectedPromptLockedTimeframe)}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </DeskSelect>
          </label>

          <label className="predictionCreateField" data-wizard-section="advanced">
            <div className="predictionCreateLabel">{tPred("wizard.analysisHorizon")}</div>
            <div className="predictionCreateHint">{tPred("wizard.analysisHorizonHint")}</div>
            <DeskSelect className="input" value={newHorizonMs} onChange={(e) => setNewHorizonMs(Number(e.target.value))}>
              <option value={60 * 60 * 1000}>1h</option>
              <option value={4 * 60 * 60 * 1000}>4h</option>
              <option value={12 * 60 * 60 * 1000}>12h</option>
              <option value={24 * 60 * 60 * 1000}>1d</option>
              <option value={3 * 24 * 60 * 60 * 1000}>3d</option>
            </DeskSelect>
          </label>

          <label className="predictionCreateField" data-wizard-section="advanced">
            <div className="predictionCreateLabel">{tPred("create.responseLanguage")}</div>
            <div className="predictionCreateHint">{tPred("create.responseLanguageHint")}</div>
            <DeskSelect
              className="input"
              value={newResponseLanguage}
              onChange={(e) => setNewResponseLanguage(e.target.value as ResponseLanguage)}
            >
              <option value="de">{tPred("create.responseLanguageGerman")}</option>
              <option value="en">{tPred("create.responseLanguageEnglish")}</option>
            </DeskSelect>
          </label>

          <label className="predictionCreateField" data-wizard-section="advanced">
            <div className="predictionCreateLabel">{tPred("create.leverage")}</div>
            <div className="predictionCreateHint">{tPred("create.leverageHint")}</div>
            <DeskInput
              className="input"
              type="number"
              step="1"
              min="1"
              max="125"
              value={newLeverage}
              onChange={(e) => setNewLeverage(e.target.value)}
              placeholder="10"
              disabled={newMarketType !== "perp"}
            />
          </label>

          <div className="predictionWizardReview" data-wizard-section="review">
            {analysisKind === "market_intelligence" ? (
              <>
                <div><span>{tPred("wizard.analysisType")}</span><strong>{tPred("wizard.types.marketIntelligenceTitle")}</strong></div>
                <div><span>{tPred("wizard.intelligenceHorizon")}</span><strong>{tPred(`wizard.intelligenceHorizons.${marketIntelligenceHorizon}`)}</strong></div>
                <div><span>{tPred("wizard.symbol")}</span><strong>{tPred("wizard.notRequired")}</strong></div>
              </>
            ) : (
              <>
                <div><span>{tPred("create.exchangeAccount")}</span><strong>{accounts.find((account) => account.id === createAccountId)?.label ?? tPred("misc.na")}</strong></div>
                <div><span>{tPred("create.pair")}</span><strong>{newSymbol} · {newMarketType}</strong></div>
                <div><span>{tPred("create.timeframe")}</span><strong>{effectiveCreateTimeframe}</strong></div>
                <div><span>{tPred("wizard.analysisHorizon")}</span><strong>{fmtMs(newHorizonMs)}</strong></div>
                <div><span>{tPred("create.strategy")}</span><strong>{strategyRefLabel(selectedStrategyRef, {
                  aiPromptTemplateName: selectedPrompt?.name ?? null,
                  localStrategyName: selectedLocalStrategy?.name ?? null,
                  compositeStrategyName: selectedCompositeStrategy?.name ?? null
                })}</strong></div>
                <div><span>{tPred("create.signalMode")}</span><strong>{createSignalModeLabel}</strong></div>
                <div className="predictionWizardReviewWide">
                  <span>{tPred("wizard.marketIntelligenceContext")}</span>
                  <strong>
                    {marketIntelligencePreviewLoading
                      ? tPred("wizard.contextLoading")
                      : marketIntelligencePreview
                        ? tPred("wizard.contextSummary", {
                            facts: marketIntelligencePreview.news.length,
                            events: marketIntelligencePreview.events.length
                          })
                        : tPred("wizard.contextUnavailable")}
                  </strong>
                  {marketIntelligencePreview?.degraded ? <small>{tPred("wizard.contextDegraded")}</small> : null}
                </div>
              </>
            )}
          </div>

          <div className="predictionWizardGenerate" data-wizard-section="generate">
            <AppIcon name={analysisKind === "market_intelligence" ? "news" : "ai"} />
            <div>
              <strong>{analysisKind === "market_intelligence" ? tPred("wizard.intelligenceReadyTitle") : tPred("wizard.readyTitle")}</strong>
              <p>{analysisKind === "market_intelligence" ? tPred("wizard.intelligenceReadyDescription") : tPred("wizard.readyDescription")}</p>
            </div>
          </div>
        </div>

        <div className="predictionCreateFooter">
          <div className="predictionCreateStatusRow">
            {wizardOpen && actionError ? (
              <div className="predictionCreateAlert predictionCreateAlertWarn">{actionError}</div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && symbolsError ? (
              <div className="predictionCreateAlert predictionCreateAlertWarn">
                {tPred("create.pairsLoadFailed")}: {symbolsError}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && createBlockedByFeature ? (
              <div className="predictionCreateAlert predictionCreateAlertWarn">
                {tCommon("licenseGate.body", { feature: createBlockedFeatureTitle })}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && aiKindAllowed && !publicAiPromptsLoading && allowedAiPrompts.length === 0 ? (
              <div className="predictionCreateAlert predictionCreateAlertInfo">
                {tPred("create.noPublicPrompts")}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && aiKindAllowed && ownStrategyFeatureEnabled && !ownAiPromptsLoading && allowedOwnAiPrompts.length === 0 ? (
              <div className="predictionCreateAlert predictionCreateAlertInfo">
                {tPred("create.noOwnStrategies")}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && localKindAllowed && !localStrategiesLoading && allowedLocalStrategies.length === 0 ? (
              <div className="predictionCreateAlert predictionCreateAlertInfo">
                {tPred("create.noLocalStrategies")}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && compositeKindAllowed && !compositeStrategiesLoading && allowedCompositeStrategies.length === 0 ? (
              <div className="predictionCreateAlert predictionCreateAlertInfo">
                {tPred("create.noCompositeStrategies")}
              </div>
            ) : null}
            {analysisKind === "trading_with_intelligence" && subscriptionQuota ? (
              <div className={createBlockedByLimit ? "predictionCreateAlert predictionCreateAlertWarn" : "predictionCreateAlert predictionCreateAlertInfo"}>
                {tPred("create.limitStatus", {
                  bucket:
                    selectedCreateLimitBucket === "predictionsLocal"
                      ? tPred("create.limitBucketLocal")
                      : selectedCreateLimitBucket === "predictionsComposite"
                        ? tPred("create.limitBucketComposite")
                        : tPred("create.limitBucketAi"),
                  runningUsage: selectedCreateRunningUsage,
                  runningLimit:
                    selectedCreateRunningLimit === null
                      ? tPred("create.unlimited")
                      : String(selectedCreateRunningLimit),
                  runningRemaining:
                    selectedCreateRunningRemaining === null
                      ? tPred("create.unlimited")
                      : String(selectedCreateRunningRemaining)
                })}
              </div>
            ) : null}
            {aiKindAllowed && publicAiPromptLicensePolicy ? (
              <div className="predictionCreateAlert predictionCreateAlertInfo">
                {tPred("create.allowedPromptIds")}:{" "}
                {publicAiPromptLicensePolicy.allowedPublicPromptIds.length > 0
                  ? publicAiPromptLicensePolicy.allowedPublicPromptIds.join(", ")
                  : "*"}
              </div>
            ) : null}
          </div>

          <div className="predictionCreateActions">
            <DeskButton
              className="btn btnPrimary"
              type="button"
              disabled={creating || createBlockedByLimit || createBlockedByFeature}
              onClick={() => void createPrediction()}
            >
              <AppIcon name="create" />
              {creating ? tPred("create.creating") : tPred("create.createPrediction")}
            </DeskButton>
          </div>
        </div>

        <DeskSurface><div className="card predictionSubCard">
          <div className="predictionSubCardHeader">
            <div className="predictionSubCardTitle">{tPred("running.title")}</div>
            <div className="predictionSubCardHint">
              {tPred("running.hint")}
            </div>
          </div>
          <div className="predictionsRunningHeader">
            <div style={{ fontWeight: 700 }}>
              {tPred("running.runningAutoPredictions", {
                filtered: filteredRunningRows.length,
                total: runningRows.length
              })}
            </div>
            <div className="predictionsRunningActions">
              <DeskSelect
                className="input"
                value={runningStatusFilter}
                onChange={(e) => setRunningStatusFilter(e.target.value as RunningStatusFilter)}
                style={{ minWidth: 150 }}
              >
                <option value="all">{tPred("running.statusAll")}</option>
                <option value="running">{tPred("running.statusRunning")}</option>
                <option value="paused">{tPred("running.statusPaused")}</option>
              </DeskSelect>
              <DeskButton
                className="btn"
                type="button"
                onClick={() => {
                  void loadRunningPredictions();
                }}
                disabled={runningLoading}
              >
                <AppIcon name="refresh" />
                {runningLoading ? tPred("running.refreshing") : tPred("running.refresh")}
              </DeskButton>
            </div>
          </div>

          {runningLoading ? (
            <div style={{ color: "var(--muted)" }}>{tPred("running.loading")}</div>
          ) : runningRows.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              {tPred("running.empty")}
            </div>
          ) : filteredRunningRows.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              {tPred("running.emptyFilter")}
            </div>
          ) : (
            <>
            <div className="predictionsRunningDesktopTable" style={{ overflowX: "auto" }}>
              <DeskTable style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.pair")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.tf")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.market")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.account")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.prefs")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.direction")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.confidence")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.entryZone")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.stop")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.targets")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.currentPrice")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.currentOutcome")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("active.finalEvaluation")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.status")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.nextRun")}</th>
                    <th style={{ padding: "8px 6px" }}>{tPred("running.actions")}</th>
                  </tr>
                </thead>
                <tbody>
	                  {filteredRunningRows.map((row) => {
	                    const refreshDegraded = isPredictionRefreshDegraded(row);
	                    const latest = rows.find((candidate) => candidate.symbol === row.symbol && candidate.timeframe === row.timeframe && candidate.marketType === row.marketType) ?? null;
	                    const latestSource = latest ? getEffectiveRowSource(latest, signalSource) : signalSource;
	                    return (
	                    <tr key={row.id} style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                      <td style={{ padding: "8px 6px", fontWeight: 700 }}>{row.symbol}</td>
                      <td style={{ padding: "8px 6px" }}>{row.timeframe}</td>
                      <td style={{ padding: "8px 6px" }}>{row.marketType}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {row.exchange.toUpperCase()} - {row.label}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        Dir: {row.directionPreference}, conf: {row.confidenceTargetPct}%
                        {row.marketType === "perp" && row.leverage ? `, lev: ${row.leverage}x` : ""}
                        {`, ${tPred("feed.mode")}: ${signalModeLabel(row.signalMode, modeLabels)}`}
                        {`, strategy: ${strategyRefLabel(row.strategyRef, {
                          aiPromptTemplateName: row.aiPromptTemplateName,
                          localStrategyName: row.localStrategyName,
                          compositeStrategyName: row.compositeStrategyName
                        })}`}
	                      </td>
	                      <td style={{ padding: "8px 6px" }}>{latest ? resolveSignal(latest, latestSource) : row.directionPreference}</td>
	                      <td style={{ padding: "8px 6px" }}>{latest ? fmtConfidence(resolveConfidence(latest, latestSource)) : `${row.confidenceTargetPct}%`}</td>
	                      <td style={{ padding: "8px 6px" }}>{fmtNum(latest?.entryPrice, 4)}</td>
	                      <td style={{ padding: "8px 6px" }}>{fmtNum(latest?.stopLossPrice, 4)}</td>
	                      <td style={{ padding: "8px 6px" }}>{fmtNum(latest?.takeProfitPrice, 4)}</td>
	                      <td style={{ padding: "8px 6px" }}>n/a</td>
	                      <td style={{ padding: "8px 6px" }}>{latest ? outcomeLabel(latest.outcomeStatus, latest.outcomeResult) : tPred("history.pending")}</td>
	                      <td style={{ padding: "8px 6px" }}>{latest?.outcomeEvaluatedAt ? (latest.outcomeResult ?? tPred("history.final")) : tPred("active.notFinal")}</td>
	                      <td style={{ padding: "8px 6px" }}>
	                        <DeskBadge className={`badge ${refreshDegraded ? "predictionRefreshBadgeDegraded" : row.paused ? "predictionRunningBadgePaused" : "predictionRunningBadgeActive"}`}>
	                          {refreshDegraded ? tPred("running.degraded") : row.paused ? tPred("running.paused") : tPred("running.running")}
	                        </DeskBadge>
	                        {refreshDegraded ? (
	                          <div className="predictionRunningHealthText" title={refreshHealthTitle(row)}>
	                            {row.lastRefreshError ?? tPred("running.refreshFailed")}
	                          </div>
	                        ) : null}
	                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        {row.paused
                          ? tPred("running.paused")
                          : row.dueInSec <= 0
                            ? tPred("running.dueNow")
                            : tPred("running.in", { value: fmtMs(row.dueInSec * 1000) })}
                      </td>
                      <td style={{ padding: "8px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <DeskButton
                          className="btn"
                          type="button"
                          disabled={runningActionId === row.id}
                          onClick={() => void togglePausePrediction(row)}
                        >
                          <AppIcon name={row.paused ? "play" : "pause"} />
                          {row.paused ? tPred("running.resume") : tPred("running.pausePrediction")}
                        </DeskButton>
                        <DeskButton
                          className="btn"
                          type="button"
                          disabled={runningActionId === row.id}
                          onClick={() => void deleteRunningPrediction(row.id)}
                        >
                          <AppIcon name="delete" />
                          {tPred("running.delete")}
                        </DeskButton>
                      </td>
	                    </tr>
	                    );
	                  })}
                </tbody>
              </DeskTable>
            </div>
            <div className="predictionsRunningMobileList">
	              {filteredRunningRows.map((row) => {
	                const refreshDegraded = isPredictionRefreshDegraded(row);
	                const latest = rows.find((candidate) => candidate.symbol === row.symbol && candidate.timeframe === row.timeframe && candidate.marketType === row.marketType) ?? null;
	                const latestSource = latest ? getEffectiveRowSource(latest, signalSource) : signalSource;
	                return (
	                <DeskSurface><div key={`${row.id}_mobile`} className="card predictionRunningCard">
	                  <div className="predictionRunningCardHeader">
	                    <div className="predictionRunningCardSymbol">{row.symbol}</div>
	                    <DeskBadge className={`badge ${refreshDegraded ? "predictionRefreshBadgeDegraded" : row.paused ? "predictionRunningBadgePaused" : "predictionRunningBadgeActive"}`}>
	                      {refreshDegraded ? tPred("running.degraded") : row.paused ? tPred("running.paused") : tPred("running.running")}
	                    </DeskBadge>
	                  </div>
	                  {refreshDegraded ? (
	                    <div className="predictionRunningHealthText" title={refreshHealthTitle(row)}>
	                      {row.lastRefreshError ?? tPred("running.refreshFailed")}
	                    </div>
	                  ) : null}
                  <div className="predictionRunningCardMeta">
                    <span>{row.timeframe}</span>
                    <span>{row.marketType}</span>
                    <span>{row.exchange.toUpperCase()}</span>
                  </div>
                  <div className="predictionActiveMobileGrid">
                    <div><span>{tPred("active.direction")}</span><strong>{latest ? resolveSignal(latest, latestSource) : row.directionPreference}</strong></div>
                    <div><span>{tPred("active.confidence")}</span><strong>{latest ? fmtConfidence(resolveConfidence(latest, latestSource)) : `${row.confidenceTargetPct}%`}</strong></div>
                    <div><span>{tPred("active.entryZone")}</span><strong>{fmtNum(latest?.entryPrice, 4)}</strong></div>
                    <div><span>{tPred("active.stop")}</span><strong>{fmtNum(latest?.stopLossPrice, 4)}</strong></div>
                    <div><span>{tPred("active.targets")}</span><strong>{fmtNum(latest?.takeProfitPrice, 4)}</strong></div>
                    <div><span>{tPred("active.finalEvaluation")}</span><strong>{latest?.outcomeEvaluatedAt ? (latest.outcomeResult ?? tPred("history.final")) : tPred("active.notFinal")}</strong></div>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.account")}</span>
                    <strong>{row.label}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.prefs")}</span>
                    <strong>
                      {row.directionPreference}, {row.confidenceTargetPct}%
                      {row.marketType === "perp" && row.leverage ? `, ${row.leverage}x` : ""}
                    </strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("create.signalMode")}</span>
                    <strong>{signalModeLabel(row.signalMode, modeLabels)}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("create.strategy")}</span>
                    <strong>{strategyRefLabel(row.strategyRef, {
                      aiPromptTemplateName: row.aiPromptTemplateName,
                      localStrategyName: row.localStrategyName,
                      compositeStrategyName: row.compositeStrategyName
                    })}</strong>
                  </div>
                  <div className="predictionRunningCardLine">
                    <span>{tPred("running.nextRun")}</span>
                    <strong>{row.paused
                      ? tPred("running.paused")
                      : row.dueInSec <= 0
                        ? tPred("running.dueNow")
                        : tPred("running.in", { value: fmtMs(row.dueInSec * 1000) })}</strong>
                  </div>
                  <div className="predictionRunningCardActions">
                    <DeskButton
                      className="btn"
                      type="button"
                      disabled={runningActionId === row.id}
                      onClick={() => void togglePausePrediction(row)}
                    >
                      <AppIcon name={row.paused ? "play" : "pause"} />
                      {row.paused ? tPred("running.resume") : tPred("running.pausePrediction")}
                    </DeskButton>
                    <DeskButton
                      className="btn"
                      type="button"
                      disabled={runningActionId === row.id}
                      onClick={() => void deleteRunningPrediction(row.id)}
                    >
                      <AppIcon name="delete" />
                      {tPred("running.delete")}
                    </DeskButton>
                  </div>
	                </div></DeskSurface>
	                );
	              })}
            </div>
            </>
          )}
        </div></DeskSurface>

      </section></DeskSurface>
      </ActivePredictions>
      </PredictionCreateWizard>
      ) : null}

      {error ? <PredictionAlert tone="error" title={tPred("alerts.loadError")} message={error} /> : null}

      {actionError ? <PredictionAlert tone="error" title={tPred("alerts.actionFailed")} message={actionError} /> : null}

      {detailsError ? <PredictionAlert tone="error" title={tPred("alerts.detailLoadFailed")} message={detailsError} /> : null}

      {notice ? <PredictionAlert tone="warning" title={tPred("alerts.notice")} message={notice} /> : null}

      <PredictionHistory active={activeView === "history"}>
      <DeskSurface><section className="card predictionsSection">
        <div className="predictionsListHeader">
          <div className="predictionsListTitle">{tPred("feed.title")}</div>
          <div className="predictionsListHint">
            {tPred("feed.hint")}
          </div>
        </div>
        <div className="predictionsFiltersHeader">
          <div className="predictionFeedSummaryChips">
            <DeskBadge className="predictionFeedChip">
              {tPred("feed.summary", { listed: filteredRows.length, actionable: actionableRowsCount })}
            </DeskBadge>
            <DeskBadge className="predictionFeedChip">
              {signalSource === "ai" ? tPred("feed.signalSourceAiShort") : tPred("feed.signalSourceLocalShort")}
            </DeskBadge>
            {activeFiltersCount > 0 ? (
              <DeskBadge className="predictionFeedChip">
                {tPred("feed.activeFilters", { count: activeFiltersCount })}
              </DeskBadge>
            ) : null}
          </div>
          <div className="predictionsFiltersActions">
            <DeskButton
              className="btn"
              type="button"
              onClick={resetFilters}
              disabled={activeFiltersCount === 0}
            >
              <AppIcon name="reset" />
              {tPred("feed.resetFilters")}
            </DeskButton>
            <DeskButton
              className="btn"
              type="button"
              onClick={() => {
                void Promise.all([
                  loadPredictions(),
                  loadPredictionQuality(),
                  loadPredictionMetrics()
                ]);
              }}
              disabled={loading}
            >
              <AppIcon name="refresh" />
              {loading ? tPred("running.refreshing") : tPred("running.refresh")}
            </DeskButton>
          </div>
        </div>
        <div className="predictionsFiltersGrid">
          <DeskInput
            className="input"
            placeholder={tPred("feed.filterSymbol")}
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
          />
          <DeskSelect className="input" value={filterSignal} onChange={(e) => setFilterSignal(e.target.value as PredictionSignal | "all")}>
            <option value="all">{tPred("feed.allSignals")}</option>
            <option value="up">up</option>
            <option value="down">down</option>
            <option value="neutral">neutral</option>
          </DeskSelect>
          <DeskSelect className="input" value={filterTimeframe} onChange={(e) => setFilterTimeframe(e.target.value as PredictionTimeframe | "all")}>
            <option value="all">{tPred("feed.allTf")}</option>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </DeskSelect>
          <DeskSelect className="input" value={filterMarket} onChange={(e) => setFilterMarket(e.target.value as PredictionMarketType | "all")}>
            <option value="all">{tPred("history.allMarkets")}</option>
            <option value="spot">Spot</option>
            <option value="perp">Perpetual</option>
          </DeskSelect>
          <DeskInput
            className="input"
            placeholder={tPred("history.filterPrompt")}
            value={filterPrompt}
            onChange={(e) => setFilterPrompt(e.target.value)}
          />
          <DeskSelect className="input" value={filterProvider} onChange={(e) => setFilterProvider(e.target.value as HistoryProviderFilter)}>
            <option value="all">{tPred("history.allProviders")}</option>
            <option value="ai">AI</option>
            <option value="local">Rules</option>
            <option value="composite">Rules + AI</option>
          </DeskSelect>
          <DeskSelect className="input" value={filterResult} onChange={(e) => setFilterResult(e.target.value as HistoryResultFilter)}>
            <option value="all">{tPred("history.allResults")}</option>
            <option value="pending">{tPred("history.pending")}</option>
            <option value="closed">{tPred("history.final")}</option>
            <option value="tp">TP</option>
            <option value="sl">SL</option>
            <option value="expired">{tPred("history.expired")}</option>
          </DeskSelect>
          <DeskSelect className="input" value={signalSource} onChange={(e) => setSignalSource(e.target.value as SignalSource)}>
            <option value="local">{tPred("feed.signalSourceLocal")}</option>
            <option value="ai">{tPred("feed.signalSourceAi")}</option>
          </DeskSelect>
          <DeskSelect className="input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="newest">{tPred("feed.sortNewest")}</option>
            <option value="confidence">{tPred("feed.sortConfidence")}</option>
            <option value="move">{tPred("feed.sortMove")}</option>
          </DeskSelect>
        </div>

        <div className="predictionsListContent">
          {loading ? (
            <div className="predictionsListState">{tPred("feed.loading")}</div>
          ) : filteredRows.length === 0 ? (
            <div className="predictionsListState">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{tPred("feed.noPredictions")}</div>
              <div style={{ color: "var(--muted)" }}>
                {tPred("feed.adjustFilters")}
              </div>
            </div>
          ) : (
            <>
          <div className="predictionsDesktopTableWrap">
            <DeskTable className="predictionsTable">
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.symbol")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.market")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.tf")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.signal")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.confidence")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.move")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.auto")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.outcome")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.outcomePnl")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.tagsExplanation")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.lastUpdated")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.change")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.created")}</th>
                  <th style={{ padding: "8px 6px" }}>{tPred("feed.table.action")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const effectiveSource = getEffectiveRowSource(row, signalSource);
                  const activeSignal = resolveSignal(row, effectiveSource);
                  const activeConfidence = resolveConfidence(row, effectiveSource);
                  const activeMove = resolveExpectedMove(row, effectiveSource);
                  const localComparisonSignal = row.localPrediction?.signal ?? row.signal;
                  const aiComparisonAvailable = Boolean(row.aiPrediction);
                  const showLocalAiComparison = isRowDisagreementRelevant(row);
                  const aiDisagrees =
                    showLocalAiComparison
                    && aiComparisonAvailable
                    && row.aiPrediction!.signal !== localComparisonSignal;
                  const actionState = resolvePredictionActionState(row, effectiveSource, actionStateLabels);
                  const expanded = expandedDetailId === row.id;
                  const loadingDetail = detailsLoadingId === row.id;
                  const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
                  const changeReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
                  const manualReason = describeManualReason({
                    parsedReason: changeReason,
                    autoEnabled: Boolean(row.autoScheduleEnabled)
                  });
	                  const flipRecently =
	                    Boolean(changeReason.signalFlip) && isRecentTimestamp(updatedAtIso, nowMs, 15 * 60 * 1000);
	                  const refreshDegraded = isPredictionRefreshDegraded(row);
	                  const reasonBadgeClass =
                    changeReason.kind === "triggered"
                      ? "predictionReasonBadgeTrigger"
                      : changeReason.kind === "scheduled"
                        ? "predictionReasonBadgeScheduled"
                        : changeReason.kind === "manual"
                          ? "predictionReasonBadgeManual"
                          : "predictionReasonBadgeUnknown";
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`${flipRecently ? "predictionRowFlipRecent " : ""}${rowStateClass(actionState.state)}`}
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                      >
                        <td style={{ padding: "8px 6px", fontWeight: 700 }}>{row.symbol}</td>
                        <td style={{ padding: "8px 6px" }}>{row.marketType}</td>
                        <td style={{ padding: "8px 6px" }}>{row.timeframe}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <DeskBadge className="badge" style={signalBadgeStyle(activeSignal)}>{activeSignal}</DeskBadge>
                          {showLocalAiComparison && aiComparisonAvailable ? (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                              local {localComparisonSignal} / ai {row.aiPrediction?.signal}
                            </div>
                          ) : null}
                          {showLocalAiComparison && effectiveSource === "ai" && !aiComparisonAvailable ? (
                            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                              {tPred("feed.aiUnavailableUsingLocal")}
                            </div>
                          ) : null}
                          {aiDisagrees ? (
                            <div style={{ color: "#f59e0b", fontSize: 11, marginTop: 4 }}>
                              {tPred("feed.disagreement")}
                            </div>
                          ) : null}
                          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                            {tPred("feed.mode")} {signalModeLabel(row.signalMode, modeLabels)}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                            {strategyRefLabel(row.strategyRef, {
                              aiPromptTemplateName: row.aiPromptTemplateName,
                              localStrategyName: row.localStrategyName,
                              compositeStrategyName: row.compositeStrategyName
                            })}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{fmtConfidence(activeConfidence)}</td>
                        <td style={{ padding: "8px 6px" }}>{activeMove.toFixed(2)}%</td>
	                        <td style={{ padding: "8px 6px" }}>
	                          <div>{row.autoScheduleEnabled ? "enabled" : "off"}</div>
	                          {refreshDegraded ? (
	                            <div style={{ marginTop: 4 }}>
	                              <DeskBadge className="badge predictionRefreshBadgeDegraded" title={refreshHealthTitle(row)}>
	                                {tPred("feed.refreshDegraded")}
	                              </DeskBadge>
	                            </div>
	                          ) : null}
	                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
	                            {tPred("feed.next")}: {nextAutoRunText(row, nowMs, nextRunLabels)}
	                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {outcomeLabel(row.outcomeStatus, row.outcomeResult)}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {row.outcomePnlPct !== null && row.outcomePnlPct !== undefined
                            ? `${row.outcomePnlPct.toFixed(2)}%`
                            : "-"}
                        </td>
                        <td style={{ padding: "8px 6px", maxWidth: 360 }}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                            {row.tags.slice(0, 4).map((tag) => (
                              <DeskBadge key={`${row.id}_${tag}`} className="badge">{tag}</DeskBadge>
                            ))}
                          </div>
                          <div
                            className="predictionExplanationClamp"
                            title={row.explanation || "-"}
                          >
                            {row.explanation || "-"}
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <div className="predictionUpdateCell">
                            <span
                              className={`predictionUpdateMeta ${isRecentTimestamp(updatedAtIso, nowMs, 2 * 60 * 1000) ? "predictionUpdateMetaFresh" : ""}`}
                              title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}
                            >
	                              {formatRelativeTime(updatedAtIso, nowMs)}
	                            </span>
	                            {refreshDegraded && row.lastRefreshErrorAt ? (
	                              <span className="predictionUpdateMeta predictionRefreshMetaWarn">
	                                {tPred("feed.refreshErrorShort")} {formatRelativeTime(row.lastRefreshErrorAt, nowMs)}
	                              </span>
	                            ) : null}
	                          </div>
	                        </td>
                        <td style={{ padding: "8px 6px", maxWidth: 200 }}>
                          <div className="predictionChangeCell">
                            <div className="predictionChangeBadges">
                              <DeskBadge className={`badge ${reasonBadgeClass}`}>{manualReason.label}</DeskBadge>
                              {changeReason.signalFlip ? (
                                <DeskBadge className="badge predictionFlipBadge">
                                  FLIP {formatFlipLabel(changeReason.signalFlip)}
                                </DeskBadge>
                              ) : null}
                            </div>
                            <div className="predictionChangeText" title={manualReason.rawReason ?? "n/a"}>
                              {manualReason.shortReason}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "8px 6px" }}>{new Date(row.tsCreated).toLocaleString()}</td>
                        <td style={{ padding: "8px 6px" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <DeskBadge className={`badge ${actionStateBadgeClass(actionState.state)}`}>
                              {actionState.label}
                            </DeskBadge>
                            {actionState.state === "ready" ? (
                              <DeskButton
                                className="btn btnPrimary"
                                onClick={() => void sendToDesk(row.id)}
                                disabled={sendingId === row.id || !actionState.canSend}
                                title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                              >
                                <AppIcon name="trading" />
                                {sendingId === row.id ? tPred("feed.sending") : tPred("feed.sendToTradingDesk")}
                              </DeskButton>
                            ) : null}
                            <DeskButton
                              className="btn"
                              type="button"
                              onClick={() => void togglePredictionDetail(row.id)}
                              disabled={loadingDetail && !expanded}
                            >
                              <AppIcon name="detail" />
                              {expanded ? tPred("feed.hideDetails") : tPred("feed.details")}
                            </DeskButton>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="predictionRowDetail">
                          <td colSpan={14}>
                            {renderIndicatorDetail(row)}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </DeskTable>
          </div>

          <div className="predictionsMobileList">
            {filteredRows.map((row) => {
              const effectiveSource = getEffectiveRowSource(row, signalSource);
              const activeSignal = resolveSignal(row, effectiveSource);
              const activeConfidence = resolveConfidence(row, effectiveSource);
              const activeMove = resolveExpectedMove(row, effectiveSource);
              const actionState = resolvePredictionActionState(row, effectiveSource, actionStateLabels);
              const expanded = expandedDetailId === row.id;
              const loadingDetail = detailsLoadingId === row.id;
              const updatedAtIso = row.lastUpdatedAt ?? row.tsCreated;
              const changeReason = parsePredictionChangeReason(row.lastChangeReason ?? null);
	              const manualReason = describeManualReason({
	                parsedReason: changeReason,
	                autoEnabled: Boolean(row.autoScheduleEnabled)
	              });
	              const refreshDegraded = isPredictionRefreshDegraded(row);
	              const reasonBadgeClass =
                changeReason.kind === "triggered"
                  ? "predictionReasonBadgeTrigger"
                  : changeReason.kind === "scheduled"
                    ? "predictionReasonBadgeScheduled"
                    : changeReason.kind === "manual"
                      ? "predictionReasonBadgeManual"
                      : "predictionReasonBadgeUnknown";

              return (
                <DeskSurface><div
                  key={`${row.id}_mobile`}
                  className={`card predictionRowCard ${mobileCardStateClass(actionState.state)}`}
                >
                  <div className="predictionRowCardHeader">
                    <div className="predictionRowCardSymbol">{row.symbol}</div>
                    <DeskBadge className="badge" style={signalBadgeStyle(activeSignal)}>{activeSignal}</DeskBadge>
                  </div>

                  <div className="predictionRowCardMeta">
                    <span>{row.marketType}</span>
                    <span>{row.timeframe}</span>
                    <span>{signalModeLabel(row.signalMode, modeLabels)}</span>
                    <span>{strategyRefLabel(row.strategyRef, {
                      aiPromptTemplateName: row.aiPromptTemplateName,
                      localStrategyName: row.localStrategyName,
                      compositeStrategyName: row.compositeStrategyName
                    })}</span>
                    <span>{new Date(row.tsCreated).toLocaleString()}</span>
                    <span title={updatedAtIso ? new Date(updatedAtIso).toLocaleString() : "n/a"}>
                      {tPred("feed.updated")} {formatRelativeTime(updatedAtIso, nowMs)}
                    </span>
                  </div>

                  <div className="predictionRowCardStats">
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Confidence</div>
                      <div className="predictionRowCardStatValue">{fmtConfidence(activeConfidence)}</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Move</div>
                      <div className="predictionRowCardStatValue">{activeMove.toFixed(2)}%</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Outcome</div>
                      <div className="predictionRowCardStatValue">{outcomeLabel(row.outcomeStatus, row.outcomeResult)}</div>
                    </div>
                    <div className="predictionRowCardStat">
                      <div className="predictionRowCardStatLabel">Outcome PnL</div>
                      <div className="predictionRowCardStatValue">
                        {row.outcomePnlPct !== null && row.outcomePnlPct !== undefined
                          ? `${row.outcomePnlPct.toFixed(2)}%`
                          : "-"}
                      </div>
                    </div>
                  </div>

	                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
	                    {refreshDegraded ? (
	                      <DeskBadge className="badge predictionRefreshBadgeDegraded" title={refreshHealthTitle(row)}>
	                        {tPred("feed.refreshDegraded")}
	                      </DeskBadge>
	                    ) : null}
	                    <DeskBadge className={`badge ${reasonBadgeClass}`}>{manualReason.label}</DeskBadge>
                    {changeReason.signalFlip ? (
                      <DeskBadge className="badge predictionFlipBadge">
                        FLIP {formatFlipLabel(changeReason.signalFlip)}
                      </DeskBadge>
                    ) : null}
                    {row.tags.slice(0, 4).map((tag) => (
                      <DeskBadge key={`${row.id}_m_${tag}`} className="badge">{tag}</DeskBadge>
                    ))}
                  </div>

                  <div className="predictionRowCardText" title={manualReason.rawReason ?? "n/a"}>
                    {manualReason.shortReason}
                  </div>

                  <div
                    className="predictionRowCardText predictionRowCardExplanation"
                    title={row.explanation || "-"}
                  >
                    {row.explanation || "-"}
                  </div>

	                  <div className="predictionRowCardAuto">
	                    <span>{row.autoScheduleEnabled ? `Auto: ${tPred("feed.autoEnabled")}` : `Auto: ${tPred("feed.autoOff")}`}</span>
	                    <span>{tPred("feed.next")}: {nextAutoRunText(row, nowMs, nextRunLabels)}</span>
	                    {refreshDegraded && row.lastRefreshErrorAt ? (
	                      <span>{tPred("feed.refreshErrorShort")} {formatRelativeTime(row.lastRefreshErrorAt, nowMs)}</span>
	                    ) : null}
	                  </div>

                  <div className="predictionRowCardActions">
                    <DeskBadge className={`badge ${actionStateBadgeClass(actionState.state)}`}>
                      {actionState.label}
                    </DeskBadge>
                    {actionState.state === "ready" ? (
                      <DeskButton
                        className="btn btnPrimary"
                        onClick={() => void sendToDesk(row.id)}
                        disabled={sendingId === row.id || !actionState.canSend}
                        title={row.accountId ? "Prefill trade ticket" : "Create an exchange account first"}
                      >
                        <AppIcon name="trading" />
                        {sendingId === row.id ? tPred("feed.sending") : tPred("feed.sendToTradingDesk")}
                      </DeskButton>
                    ) : null}
                    <DeskButton
                      className="btn"
                      type="button"
                      onClick={() => void togglePredictionDetail(row.id)}
                      disabled={loadingDetail && !expanded}
                    >
                      <AppIcon name="detail" />
                      {expanded ? tPred("feed.hideDetails") : tPred("feed.details")}
                    </DeskButton>
                  </div>

                  {expanded ? (
                    <div className="predictionRowCardDetail">
                      {renderIndicatorDetail(row)}
                    </div>
                  ) : null}
                </div></DeskSurface>
              );
            })}
          </div>
            </>
          )}
        </div>
      </section></DeskSurface>
      </PredictionHistory>

      <PredictionPerformance active={activeView === "performance"}>
      <DeskSurface><section className="card predictionsSection">
        <div className="predictionsPerformanceHeader">
          <div>
            <div className="predictionCreateTitle">{tPred("performance.title")}</div>
            <div className="predictionsSectionHint">
              {tPred("performance.hint")}
            </div>
            {performanceResetAt ? (
              <div className="predictionsSectionHint predictionsPerformanceResetMeta">
                {tPred("performance.sinceReset", {
                  date: new Date(performanceResetAt).toLocaleString()
                })}
              </div>
            ) : null}
          </div>
          <div className="predictionsPerformanceActions">
            <DeskButton
              className="btn"
              type="button"
              onClick={() => void resetPerformanceStats()}
              disabled={resettingPerformance}
            >
              <AppIcon name="reset" />
              {resettingPerformance ? tPred("running.refreshing") : tPred("performance.reset")}
            </DeskButton>
          </div>
        </div>
        <div className="predictionsQualityGrid">
          <MetricTile label={tPred("performance.evaluatedSignals")} value={quality?.sampleSize ?? 0} />
          <MetricTile
            label={tPred("performance.tpWinRate")}
            value={quality?.winRatePct !== null && quality?.winRatePct !== undefined ? `${quality.winRatePct.toFixed(2)}%` : "-"}
            tone={Number(quality?.winRatePct ?? 0) >= 50 ? "success" : "neutral"}
          />
          <MetricTile
            label={tPred("performance.avgOutcomePnl")}
            value={quality?.avgOutcomePnlPct !== null && quality?.avgOutcomePnlPct !== undefined ? `${quality.avgOutcomePnlPct.toFixed(2)}%` : "-"}
            tone={Number(quality?.avgOutcomePnlPct ?? 0) > 0 ? "success" : Number(quality?.avgOutcomePnlPct ?? 0) < 0 ? "danger" : "neutral"}
          />
          <MetricTile label={tPred("performance.tpSlExpired")} value={`${quality?.tp ?? 0} / ${quality?.sl ?? 0} / ${quality?.expired ?? 0}`} />
          <MetricTile
            label={tPred("performance.directionalHitRate")}
            value={metrics?.hitRate !== null && metrics?.hitRate !== undefined ? `${metrics.hitRate.toFixed(2)}%` : "-"}
            meta={tPred("performance.evaluated", { count: metrics?.evaluatedCount ?? 0 })}
            tone={Number(metrics?.hitRate ?? 0) >= 50 ? "success" : "neutral"}
          />
          <MetricTile label={tPred("performance.mae")} value={metrics?.mae !== null && metrics?.mae !== undefined ? metrics.mae.toFixed(4) : "-"} />
          <MetricTile label={tPred("performance.mse")} value={metrics?.mse !== null && metrics?.mse !== undefined ? metrics.mse.toFixed(4) : "-"} />
          <MetricTile label={tPred("performance.mfeExcursion")} value={averageMfePct == null ? "-" : `${averageMfePct.toFixed(2)}%`} />
          <MetricTile label={tPred("performance.maeExcursion")} value={averageMaePct == null ? "-" : `${averageMaePct.toFixed(2)}%`} />
          <MetricTile
            label={tPred("performance.stopHitRate")}
            value={quality?.sampleSize ? `${((quality.sl / quality.sampleSize) * 100).toFixed(2)}%` : "-"}
          />
        </div>
        <div className="predictionPerformanceBoundaryNotice">
          <AppIcon name="shield" />
          <div>
            <strong>{tPred("performance.qualityBoundaryTitle")}</strong>
            <span>{tPred("performance.qualityBoundaryDescription")}</span>
          </div>
        </div>
        <div className="predictionCalibrationWrap">
          <div className="predictionCalibrationHeader">
            <strong>{tPred("performance.calibrationTitle")}</strong>
            <span className="predictionCalibrationHint">
              {tPred("performance.calibrationHint")}
            </span>
          </div>
          {!metrics || metrics.calibrationBins.filter((bin) => bin.n > 0).length === 0 ? (
            <div className="predictionCalibrationEmpty">{tPred("performance.noBins")}</div>
          ) : (
            <div className="predictionCalibrationLayout">
              <PredictionCalibrationPlot
                bins={metrics.calibrationBins}
                labels={{
                  avgConf: tPred("performance.avgConf"),
                  accuracy: tPred("performance.accuracy"),
                  sample: tPred("performance.sample")
                }}
              />
              <div className="predictionCalibrationTableWrap">
                <DeskTable className="predictionCalibrationTable">
                  <thead>
                    <tr>
                      <th>{tPred("performance.bin")}</th>
                      <th>{tPred("performance.avgConf")}</th>
                      <th>{tPred("performance.accuracy")}</th>
                      <th>N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.calibrationBins
                      .filter((bin) => bin.n > 0)
                      .map((bin) => (
                        <tr key={`${bin.binFrom}-${bin.binTo}`}>
                          <td>{bin.binFrom.toFixed(0)}-{bin.binTo.toFixed(0)}%</td>
                          <td>{bin.avgConf !== null ? `${bin.avgConf.toFixed(2)}%` : "-"}</td>
                          <td>{bin.accuracy !== null ? `${bin.accuracy.toFixed(2)}%` : "-"}</td>
                          <td>{bin.n}</td>
                        </tr>
                      ))}
                  </tbody>
                </DeskTable>
              </div>
            </div>
          )}
        </div>
      </section></DeskSurface>
      </PredictionPerformance>
    </div>
  );
}
