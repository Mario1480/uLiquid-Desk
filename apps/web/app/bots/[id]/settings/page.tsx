"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";

type StrategyKey = "dummy" | "prediction_copier";
type ExecutionModeValue = "simple" | "dca" | "grid" | "dip_reversion";
type CopierOrderType = "market" | "limit";
type CopierSizingType = "fixed_usd" | "equity_pct" | "risk_pct";
type CopierSignal = "up" | "down" | "neutral";
type BacktestTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

type PredictionSource = {
  stateId: string;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h" | string;
  signalMode: "local_only" | "ai_only" | "both" | string;
  strategyRef: string | null;
  strategyKind: "local" | "ai" | "composite" | null;
  strategyName: string | null;
  lastSignal: "up" | "down" | "neutral" | string;
  confidence: number;
  tsUpdated: string;
  lastChangeReason: string | null;
};

type BotDetail = {
  id: string;
  name: string;
  symbol: string;
  status: string;
  exchangeAccountId: string;
  exchangeAccount?: {
    id: string;
    exchange: string;
    label: string;
  } | null;
  futuresConfig?: {
    strategyKey: string;
    marginMode: "isolated" | "cross";
    leverage: number;
    tickMs: number;
    paramsJson?: Record<string, unknown>;
    execution?: Record<string, unknown> | null;
    predictionCopier?: Record<string, unknown> | null;
  } | null;
  botVault?: {
    id: string;
    botId?: string | null;
    status?: string | null;
    allocatedUsd?: number | null;
    availableUsd?: number | null;
    executionStatus?: string | null;
  } | null;
};

type BacktestRun = {
  runId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  period: {
    from: string;
    to: string;
    timeframe: BacktestTimeframe;
  };
  kpi?: {
    pnlUsd: number;
    maxDrawdownPct: number;
    winratePct: number;
    tradeCount: number;
  } | null;
  error?: string | null;
  requestedAt: string;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function toCsvArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toRootPredictionCopier(settings: BotDetail["futuresConfig"]): Record<string, any> {
  if (!settings) return {};
  const direct = settings.predictionCopier && typeof settings.predictionCopier === "object"
    ? settings.predictionCopier
    : null;
  if (direct) return { ...direct };
  const paramsJson = settings.paramsJson && typeof settings.paramsJson === "object"
    ? settings.paramsJson
    : {};
  const nested = paramsJson.predictionCopier;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...(nested as Record<string, unknown>) };
  return { ...(paramsJson as Record<string, unknown>) };
}

function formatStrategyLabel(value: StrategyKey, t: (key: string) => string): string {
  if (value === "prediction_copier") return t("options.strategyPredictionCopier");
  return t("options.strategySimpleRuntime");
}

function formatExecutionModeLabel(value: ExecutionModeValue, t: (key: string) => string): string {
  if (value === "dca") return t("options.executionDca");
  if (value === "grid") return t("options.executionGrid");
  if (value === "dip_reversion") return t("options.executionDipReversion");
  return t("options.executionSimple");
}

function formatSignalLabel(value: CopierSignal, t: (key: string) => string): string {
  if (value === "down") return t("options.signalDown");
  if (value === "neutral") return t("options.signalNeutral");
  return t("options.signalUp");
}

function normalizeSignal(value: string): CopierSignal {
  if (value === "down" || value === "neutral") return value;
  return "up";
}

export default function BotSettingsPage() {
  const t = useTranslations("system.botsSettings");
  const locale = useLocale() as AppLocale;
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [bot, setBot] = useState<BotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [strategyKey, setStrategyKey] = useState<StrategyKey>("dummy");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [leverage, setLeverage] = useState(1);
  const [tickMs, setTickMs] = useState(1000);
  const [executionMode, setExecutionMode] = useState<ExecutionModeValue>("simple");
  const [vaultEnabled, setVaultEnabled] = useState(false);
  const [vaultAllocationUsd, setVaultAllocationUsd] = useState("100");

  const [commonMaxDailyExecutions, setCommonMaxDailyExecutions] = useState(200);
  const [commonCooldownSecAfterExecution, setCommonCooldownSecAfterExecution] = useState(0);
  const [commonMaxNotionalPerSymbolUsd, setCommonMaxNotionalPerSymbolUsd] = useState("");
  const [commonMaxTotalNotionalUsd, setCommonMaxTotalNotionalUsd] = useState("");
  const [commonMaxOpenPositions, setCommonMaxOpenPositions] = useState(1);
  const [commonEnforceReduceOnlyOnClose, setCommonEnforceReduceOnlyOnClose] = useState(true);

  const [simpleOrderType, setSimpleOrderType] = useState<"market" | "limit">("market");
  const [simpleLimitOffsetBps, setSimpleLimitOffsetBps] = useState(2);

  const [dcaMaxEntries, setDcaMaxEntries] = useState(3);
  const [dcaStepPct, setDcaStepPct] = useState(1.5);
  const [dcaSizeScale, setDcaSizeScale] = useState(1.25);
  const [dcaEntryOrderType, setDcaEntryOrderType] = useState<"market" | "limit">("limit");
  const [dcaTakeProfitPct, setDcaTakeProfitPct] = useState("2");
  const [dcaStopLossPct, setDcaStopLossPct] = useState("");
  const [dcaCancelPendingOnFlip, setDcaCancelPendingOnFlip] = useState(true);

  const [gridLevelsPerSide, setGridLevelsPerSide] = useState(4);
  const [gridSpacingPct, setGridSpacingPct] = useState(0.5);
  const [gridBaseOrderUsd, setGridBaseOrderUsd] = useState(100);
  const [gridTpPctPerLevel, setGridTpPctPerLevel] = useState(0.4);
  const [gridMaxActiveOrders, setGridMaxActiveOrders] = useState(10);
  const [gridRebalanceThresholdPct, setGridRebalanceThresholdPct] = useState(1.5);

  const [dipTriggerPct, setDipTriggerPct] = useState(3);
  const [dipRecoveryTakeProfitPct, setDipRecoveryTakeProfitPct] = useState(1.5);
  const [dipMaxHoldMinutes, setDipMaxHoldMinutes] = useState(720);
  const [dipMaxReentriesPerDay, setDipMaxReentriesPerDay] = useState(2);
  const [dipEntryScaleUsd, setDipEntryScaleUsd] = useState(100);

  const [sources, setSources] = useState<PredictionSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [sourceStateId, setSourceStateId] = useState("");
  const [copierTimeframe, setCopierTimeframe] = useState<"5m" | "15m" | "1h" | "4h">("15m");
  const [copierMinConfidence, setCopierMinConfidence] = useState(70);
  const [copierMaxPredictionAgeSec, setCopierMaxPredictionAgeSec] = useState(600);
  const [copierOrderType, setCopierOrderType] = useState<CopierOrderType>("market");
  const [copierSizingType, setCopierSizingType] = useState<CopierSizingType>("fixed_usd");
  const [copierSizingValue, setCopierSizingValue] = useState(100);

  const [riskMaxOpenPositions, setRiskMaxOpenPositions] = useState(3);
  const [riskMaxDailyTrades, setRiskMaxDailyTrades] = useState(20);
  const [riskCooldownSec, setRiskCooldownSec] = useState(120);
  const [riskMaxNotionalSymbol, setRiskMaxNotionalSymbol] = useState(500);
  const [riskMaxNotionalTotal, setRiskMaxNotionalTotal] = useState(1500);
  const [riskStopLossPct, setRiskStopLossPct] = useState("");
  const [riskTakeProfitPct, setRiskTakeProfitPct] = useState("");
  const [riskTimeStopMin, setRiskTimeStopMin] = useState("");
  const [exitOnSignalFlip, setExitOnSignalFlip] = useState(false);
  const [exitOnConfidenceDrop, setExitOnConfidenceDrop] = useState(false);

  const [filtersBlockTags, setFiltersBlockTags] = useState("data_gap,low_liquidity");
  const [filtersNewsRiskBlockEnabled, setFiltersNewsRiskBlockEnabled] = useState(false);
  const [filtersRequireTags, setFiltersRequireTags] = useState("");
  const [filtersMinExpectedMove, setFiltersMinExpectedMove] = useState("");
  const [allowSignalUp, setAllowSignalUp] = useState(true);
  const [allowSignalDown, setAllowSignalDown] = useState(true);
  const [allowSignalNeutral, setAllowSignalNeutral] = useState(false);

  const [executionLimitOffsetBps, setExecutionLimitOffsetBps] = useState(2);
  const [executionReduceOnlyOnExit, setExecutionReduceOnlyOnExit] = useState(true);

  const [backtestFrom, setBacktestFrom] = useState(() => {
    const now = new Date();
    const from = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    return toLocalDateTimeInputValue(from);
  });
  const [backtestTo, setBacktestTo] = useState(() => toLocalDateTimeInputValue(new Date()));
  const [backtestTimeframe, setBacktestTimeframe] = useState<BacktestTimeframe>("15m");
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestSubmitting, setBacktestSubmitting] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadBot() {
      setLoading(true);
      setError(null);
      try {
        const bot = await apiGet<BotDetail>(`/bots/${id}`);
        if (!mounted) return;
        setBot(bot);

        setName(bot.name ?? "");
        setSymbol(bot.symbol ?? "BTCUSDT");
        setExchangeAccountId(bot.exchangeAccountId ?? bot.exchangeAccount?.id ?? "");

        const strategy = (bot.futuresConfig?.strategyKey ?? "dummy") as StrategyKey;
        setStrategyKey(strategy);
        setMarginMode((bot.futuresConfig?.marginMode ?? "isolated") as "isolated" | "cross");
        setLeverage(Number(bot.futuresConfig?.leverage ?? 1));
        setTickMs(Number(bot.futuresConfig?.tickMs ?? 1000));

        const paramsJson = bot.futuresConfig?.paramsJson && typeof bot.futuresConfig.paramsJson === "object"
          ? bot.futuresConfig.paramsJson
          : {};
        const executionRaw = (
          bot.futuresConfig?.execution
          && typeof bot.futuresConfig.execution === "object"
          && !Array.isArray(bot.futuresConfig.execution)
            ? bot.futuresConfig.execution
            : ((paramsJson as Record<string, unknown>).execution as Record<string, unknown> | undefined)
        ) ?? {};

        const executionCommon = executionRaw.common && typeof executionRaw.common === "object" && !Array.isArray(executionRaw.common)
          ? executionRaw.common as Record<string, unknown>
          : {};
        const executionSimple = executionRaw.simple && typeof executionRaw.simple === "object" && !Array.isArray(executionRaw.simple)
          ? executionRaw.simple as Record<string, unknown>
          : {};
        const executionDca = executionRaw.dca && typeof executionRaw.dca === "object" && !Array.isArray(executionRaw.dca)
          ? executionRaw.dca as Record<string, unknown>
          : {};
        const executionGrid = executionRaw.grid && typeof executionRaw.grid === "object" && !Array.isArray(executionRaw.grid)
          ? executionRaw.grid as Record<string, unknown>
          : {};
        const executionDip = executionRaw.dipReversion && typeof executionRaw.dipReversion === "object" && !Array.isArray(executionRaw.dipReversion)
          ? executionRaw.dipReversion as Record<string, unknown>
          : {};

        const modeRaw = String(executionRaw.mode ?? "").trim();
        setExecutionMode(
          modeRaw === "dca" || modeRaw === "grid" || modeRaw === "dip_reversion"
            ? modeRaw
            : "simple"
        );
        setCommonMaxDailyExecutions(Number(executionCommon.maxDailyExecutions ?? 200));
        setCommonCooldownSecAfterExecution(Number(executionCommon.cooldownSecAfterExecution ?? 0));
        setCommonMaxNotionalPerSymbolUsd(
          executionCommon.maxNotionalPerSymbolUsd == null ? "" : String(executionCommon.maxNotionalPerSymbolUsd)
        );
        setCommonMaxTotalNotionalUsd(
          executionCommon.maxTotalNotionalUsd == null ? "" : String(executionCommon.maxTotalNotionalUsd)
        );
        setCommonMaxOpenPositions(Number(executionCommon.maxOpenPositions ?? 1));
        setCommonEnforceReduceOnlyOnClose(Boolean(executionCommon.enforceReduceOnlyOnClose ?? true));

        setSimpleOrderType(executionSimple.orderType === "limit" ? "limit" : "market");
        setSimpleLimitOffsetBps(Number(executionSimple.limitOffsetBps ?? 2));

        setDcaMaxEntries(Number(executionDca.maxEntries ?? 3));
        setDcaStepPct(Number(executionDca.stepPct ?? 1.5));
        setDcaSizeScale(Number(executionDca.sizeScale ?? 1.25));
        setDcaEntryOrderType(executionDca.entryOrderType === "market" ? "market" : "limit");
        setDcaTakeProfitPct(executionDca.takeProfitPct == null ? "2" : String(executionDca.takeProfitPct));
        setDcaStopLossPct(executionDca.stopLossPct == null ? "" : String(executionDca.stopLossPct));
        setDcaCancelPendingOnFlip(Boolean(executionDca.cancelPendingOnFlip ?? true));

        setGridLevelsPerSide(Number(executionGrid.levelsPerSide ?? 4));
        setGridSpacingPct(Number(executionGrid.gridSpacingPct ?? 0.5));
        setGridBaseOrderUsd(Number(executionGrid.baseOrderUsd ?? 100));
        setGridTpPctPerLevel(Number(executionGrid.tpPctPerLevel ?? 0.4));
        setGridMaxActiveOrders(Number(executionGrid.maxActiveOrders ?? 10));
        setGridRebalanceThresholdPct(Number(executionGrid.rebalanceThresholdPct ?? 1.5));

        setDipTriggerPct(Number(executionDip.dipTriggerPct ?? 3));
        setDipRecoveryTakeProfitPct(Number(executionDip.recoveryTakeProfitPct ?? 1.5));
        setDipMaxHoldMinutes(Number(executionDip.maxHoldMinutes ?? 720));
        setDipMaxReentriesPerDay(Number(executionDip.maxReentriesPerDay ?? 2));
        setDipEntryScaleUsd(Number(executionDip.entryScaleUsd ?? 100));

        const root = toRootPredictionCopier(bot.futuresConfig ?? null);
        const allowSignals = Array.isArray(root.filters?.allowSignals) ? root.filters.allowSignals : ["up", "down"];

        setSourceStateId(typeof root.sourceStateId === "string" ? root.sourceStateId : "");
        if (root.timeframe === "5m" || root.timeframe === "15m" || root.timeframe === "1h" || root.timeframe === "4h") {
          setCopierTimeframe(root.timeframe);
        }
        setCopierMinConfidence(Number(root.minConfidence ?? 70));
        setCopierMaxPredictionAgeSec(Number(root.maxPredictionAgeSec ?? 600));
        setCopierOrderType(root.execution?.orderType === "limit" ? "limit" : "market");
        setCopierSizingType(root.positionSizing?.type === "equity_pct" || root.positionSizing?.type === "risk_pct" ? root.positionSizing.type : "fixed_usd");
        setCopierSizingValue(Number(root.positionSizing?.value ?? 100));

        setRiskMaxOpenPositions(Number(root.risk?.maxOpenPositions ?? 3));
        setRiskMaxDailyTrades(Number(root.risk?.maxDailyTrades ?? 20));
        setRiskCooldownSec(Number(root.risk?.cooldownSecAfterTrade ?? 120));
        setRiskMaxNotionalSymbol(Number(root.risk?.maxNotionalPerSymbolUsd ?? 500));
        setRiskMaxNotionalTotal(Number(root.risk?.maxTotalNotionalUsd ?? 1500));
        setRiskStopLossPct(root.risk?.stopLossPct == null ? "" : String(root.risk.stopLossPct));
        setRiskTakeProfitPct(root.risk?.takeProfitPct == null ? "" : String(root.risk.takeProfitPct));
        setRiskTimeStopMin(root.risk?.timeStopMin == null ? "" : String(root.risk.timeStopMin));
        setExitOnSignalFlip(Boolean(root.exit?.onSignalFlip ?? false));
        setExitOnConfidenceDrop(Boolean(root.exit?.onConfidenceDrop ?? false));

        setFiltersBlockTags(Array.isArray(root.filters?.blockTags) ? root.filters.blockTags.join(",") : "data_gap,low_liquidity");
        setFiltersNewsRiskBlockEnabled(Boolean(root.filters?.newsRiskBlockEnabled ?? false));
        setFiltersRequireTags(Array.isArray(root.filters?.requireTags) ? root.filters.requireTags.join(",") : "");
        setFiltersMinExpectedMove(root.filters?.minExpectedMovePct == null ? "" : String(root.filters.minExpectedMovePct));

        setAllowSignalUp(allowSignals.includes("up"));
        setAllowSignalDown(allowSignals.includes("down"));
        setAllowSignalNeutral(allowSignals.includes("neutral"));

        setExecutionLimitOffsetBps(Number(root.execution?.limitOffsetBps ?? 2));
        setExecutionReduceOnlyOnExit(Boolean(root.execution?.reduceOnlyOnExit ?? true));
        setVaultEnabled(Boolean(bot.botVault?.id));
        setVaultAllocationUsd(
          bot.botVault?.allocatedUsd != null ? String(bot.botVault.allocatedUsd) : "100"
        );
      } catch (e) {
        if (!mounted) return;
        setError(errMsg(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadBot();
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      if (strategyKey !== "prediction_copier" || !exchangeAccountId) {
        setSources([]);
        setSourcesError(null);
        return;
      }
      setLoadingSources(true);
      setSourcesError(null);
      try {
        const response = await apiGet<{ items: PredictionSource[] }>(
          `/bots/prediction-sources?exchangeAccountId=${encodeURIComponent(exchangeAccountId)}`
        );
        if (!mounted) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setSources(items);
        setSourceStateId((prev) => {
          if (prev && items.some((item) => item.stateId === prev)) return prev;
          return items[0]?.stateId ?? "";
        });
      } catch (e) {
        if (!mounted) return;
        setSourcesError(errMsg(e));
        setSources([]);
      } finally {
        if (mounted) setLoadingSources(false);
      }
    }
    void loadSources();
    return () => {
      mounted = false;
    };
  }, [strategyKey, exchangeAccountId]);

  const selectedSource = useMemo(
    () => sources.find((item) => item.stateId === sourceStateId) ?? null,
    [sources, sourceStateId]
  );

  const selectedExchange = useMemo(
    () => String(bot?.exchangeAccount?.exchange ?? "").trim().toLowerCase(),
    [bot]
  );

  const vaultEligible = useMemo(() => {
    if (selectedExchange !== "hyperliquid") return false;
    if (strategyKey === "prediction_copier") return true;
    return executionMode === "dca";
  }, [selectedExchange, strategyKey, executionMode]);

  useEffect(() => {
    if (!selectedSource) return;
    setSymbol(selectedSource.symbol);
    if (
      selectedSource.timeframe === "5m"
      || selectedSource.timeframe === "15m"
      || selectedSource.timeframe === "1h"
      || selectedSource.timeframe === "4h"
    ) {
      setCopierTimeframe(selectedSource.timeframe);
    }
  }, [selectedSource]);

  async function loadBacktestRuns() {
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const response = await apiGet<{ items: BacktestRun[] }>(`/bots/${id}/backtests?limit=20`);
      setBacktestRuns(Array.isArray(response.items) ? response.items : []);
    } catch (e) {
      setBacktestError(errMsg(e));
    } finally {
      setBacktestLoading(false);
    }
  }

  useEffect(() => {
    void loadBacktestRuns();
  }, [id]);

  async function onStartBacktest() {
    setBacktestSubmitting(true);
    setBacktestError(null);
    try {
      const fromIso = new Date(backtestFrom).toISOString();
      const toIso = new Date(backtestTo).toISOString();
      await apiPost(`/bots/${id}/backtests`, {
        from: fromIso,
        to: toIso,
        timeframe: backtestTimeframe
      });
      await loadBacktestRuns();
    } catch (e) {
      setBacktestError(errMsg(e));
    } finally {
      setBacktestSubmitting(false);
    }
  }

  async function onCancelBacktest(runId: string) {
    setBacktestSubmitting(true);
    setBacktestError(null);
    try {
      await apiPost(`/backtests/${encodeURIComponent(runId)}/cancel`, {});
      await loadBacktestRuns();
    } catch (e) {
      setBacktestError(errMsg(e));
    } finally {
      setBacktestSubmitting(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (strategyKey === "prediction_copier" && !sourceStateId) {
      setError(t("sourceRequired"));
      return;
    }
    if (vaultEnabled && (!vaultEligible || !Number.isFinite(Number(vaultAllocationUsd)) || Number(vaultAllocationUsd) <= 0)) {
      setError(t("vault.allocationError"));
      return;
    }

    setSaving(true);
    setError(null);
    setRestartRequired(false);

    try {
      const allowSignals: CopierSignal[] = [];
      if (allowSignalUp) allowSignals.push("up");
      if (allowSignalDown) allowSignals.push("down");
      if (allowSignalNeutral) allowSignals.push("neutral");

      const executionParams = {
        mode: executionMode,
        common: {
          maxDailyExecutions: commonMaxDailyExecutions,
          cooldownSecAfterExecution: commonCooldownSecAfterExecution,
          maxNotionalPerSymbolUsd: commonMaxNotionalPerSymbolUsd.trim() ? Number(commonMaxNotionalPerSymbolUsd) : null,
          maxTotalNotionalUsd: commonMaxTotalNotionalUsd.trim() ? Number(commonMaxTotalNotionalUsd) : null,
          maxOpenPositions: commonMaxOpenPositions,
          enforceReduceOnlyOnClose: commonEnforceReduceOnlyOnClose
        },
        simple: {
          orderType: simpleOrderType,
          limitOffsetBps: simpleLimitOffsetBps
        },
        dca: {
          maxEntries: dcaMaxEntries,
          stepPct: dcaStepPct,
          sizeScale: dcaSizeScale,
          entryOrderType: dcaEntryOrderType,
          takeProfitPct: dcaTakeProfitPct.trim() ? Number(dcaTakeProfitPct) : null,
          stopLossPct: dcaStopLossPct.trim() ? Number(dcaStopLossPct) : null,
          cancelPendingOnFlip: dcaCancelPendingOnFlip
        },
        grid: {
          levelsPerSide: gridLevelsPerSide,
          gridSpacingPct: gridSpacingPct,
          baseOrderUsd: gridBaseOrderUsd,
          tpPctPerLevel: gridTpPctPerLevel,
          maxActiveOrders: gridMaxActiveOrders,
          rebalanceThresholdPct: gridRebalanceThresholdPct
        },
        dipReversion: {
          dipTriggerPct: dipTriggerPct,
          recoveryTakeProfitPct: dipRecoveryTakeProfitPct,
          maxHoldMinutes: dipMaxHoldMinutes,
          maxReentriesPerDay: dipMaxReentriesPerDay,
          entryScaleUsd: dipEntryScaleUsd
        }
      };

      const payload = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        strategyKey,
        marginMode,
        leverage,
        tickMs,
        vaultEnabled: vaultEnabled && vaultEligible,
        vaultAllocationUsd: vaultEnabled && vaultEligible ? Number(vaultAllocationUsd) : null,
        paramsJson: strategyKey === "prediction_copier"
          ? {
              predictionCopier: {
                sourceStateId,
                sourceSnapshot: selectedSource
                  ? {
                      stateId: selectedSource.stateId,
                      symbol: selectedSource.symbol,
                      timeframe: selectedSource.timeframe,
                      signalMode: selectedSource.signalMode,
                      strategyRef: selectedSource.strategyRef,
                      strategyKind: selectedSource.strategyKind,
                      strategyName: selectedSource.strategyName
                    }
                  : undefined,
                timeframe: copierTimeframe,
                minConfidence: copierMinConfidence,
                maxPredictionAgeSec: copierMaxPredictionAgeSec,
                symbols: [symbol.trim().toUpperCase()],
                positionSizing: {
                  type: copierSizingType,
                  value: copierSizingValue
                },
                risk: {
                  maxOpenPositions: riskMaxOpenPositions,
                  maxDailyTrades: riskMaxDailyTrades,
                  cooldownSecAfterTrade: riskCooldownSec,
                  maxNotionalPerSymbolUsd: riskMaxNotionalSymbol,
                  maxTotalNotionalUsd: riskMaxNotionalTotal,
                  stopLossPct: riskStopLossPct.trim() ? Number(riskStopLossPct) : null,
                  takeProfitPct: riskTakeProfitPct.trim() ? Number(riskTakeProfitPct) : null,
                  timeStopMin: riskTimeStopMin.trim() ? Number(riskTimeStopMin) : null
                },
                filters: {
                  blockTags: toCsvArray(filtersBlockTags),
                  newsRiskBlockEnabled: filtersNewsRiskBlockEnabled,
                  requireTags: toCsvArray(filtersRequireTags).length > 0 ? toCsvArray(filtersRequireTags) : null,
                  allowSignals,
                  minExpectedMovePct: filtersMinExpectedMove.trim() ? Number(filtersMinExpectedMove) : null
                },
                execution: {
                  orderType: copierOrderType,
                  limitOffsetBps: executionLimitOffsetBps,
                  reduceOnlyOnExit: executionReduceOnlyOnExit
                },
                exit: {
                  onSignalFlip: exitOnSignalFlip,
                  onConfidenceDrop: exitOnConfidenceDrop
                }
              }
            }
          : {
              execution: executionParams
            }
      };

      const updated = await apiPut<{ restartRequired?: boolean }>(`/bots/${id}`, payload);
      setRestartRequired(Boolean(updated.restartRequired));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container botsSettingsPage" style={{ maxWidth: 980 }}>
        <div className="card botsSetupShell">
          <div>{t("loading")}</div>
        </div>
      </div>
    );
  }

  const executionAccountLabel = bot?.exchangeAccount?.label ?? exchangeAccountId ?? "-";
  const strategyLabel = formatStrategyLabel(strategyKey, t);
  const runtimeLabel = bot?.status ?? "-";
  const vaultSummary = bot?.botVault ? t("summary.attached") : t("summary.notAttached");

  return (
    <div className="container botsSettingsPage" style={{ maxWidth: 980 }}>
      <form onSubmit={onSave} className="card botsSetupShell botsSetupForm">
        <div className="botsSetupHeader">
          <div className="botsSetupHeaderCopy">
            <h2 style={{ margin: 0 }}>{t("title")}</h2>
            <div className="botsSetupSubtitle">{t("description")}</div>
          </div>
          <Link className="btn" href={withLocalePath(`/bots/${id}`, locale)}>
            {t("actions.back")}
          </Link>
        </div>

        <div className="card botsSetupSection">
          <div className="botsSetupSectionHeader">
            <div className="botsSetupSectionTitle">{t("summary.title")}</div>
            <div className="botsSetupSectionHint">{t("summary.hint")}</div>
          </div>
          <div className="botsSetupSummaryGrid">
            <div className="botsSetupMetricCard">
              <div className="botsSetupMetricLabel">{t("summary.executionAccount")}</div>
              <div className="botsSetupMetricValue botsSetupMetricValueCompact">{executionAccountLabel}</div>
            </div>
            <div className="botsSetupMetricCard">
              <div className="botsSetupMetricLabel">{t("summary.strategy")}</div>
              <div className="botsSetupMetricValue botsSetupMetricValueCompact">
                {strategyKey === "prediction_copier"
                  ? strategyLabel
                  : `${strategyLabel} · ${formatExecutionModeLabel(executionMode, t)}`}
              </div>
            </div>
            <div className="botsSetupMetricCard">
              <div className="botsSetupMetricLabel">{t("summary.runtime")}</div>
              <div className="botsSetupMetricValue botsSetupMetricValueCompact">{runtimeLabel}</div>
            </div>
            <div className="botsSetupMetricCard">
              <div className="botsSetupMetricLabel">{t("summary.vault")}</div>
              <div className="botsSetupMetricValue botsSetupMetricValueCompact">{vaultSummary}</div>
            </div>
          </div>
        </div>

        {restartRequired ? (
          <div className="botsSetupError" style={{ borderColor: "rgba(245, 158, 11, 0.52)", background: "linear-gradient(180deg, rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.04))", color: "#fde68a" }}>
            {t("restartRequired")}
          </div>
        ) : null}

        {error ? (
          <div className="botsSetupError">{error}</div>
        ) : null}

        <div className="card botsSetupSection">
          <div className="botsSetupSectionHeader">
            <div className="botsSetupSectionTitle">{t("sections.base")}</div>
            <div className="botsSetupSectionHint">{t("sections.baseHint")}</div>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.name")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.strategy")}</span>
              <select className="input" value={strategyKey} onChange={(e) => setStrategyKey(e.target.value as StrategyKey)}>
                <option value="dummy">{t("options.strategySimpleRuntime")}</option>
                <option value="prediction_copier">{t("options.strategyPredictionCopier")}</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.exchangeAccount")}</span>
              <input className="input" value={exchangeAccountId} disabled />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.symbol")}</span>
              <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={strategyKey === "prediction_copier"} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.marginMode")}</span>
              <select className="input" value={marginMode} onChange={(e) => setMarginMode(e.target.value as "isolated" | "cross")}>
                <option value="isolated">{t("options.marginIsolated")}</option>
                <option value="cross">{t("options.marginCross")}</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.leverage")}</span>
              <input className="input" type="number" min={1} max={125} value={leverage} onChange={(e) => setLeverage(Number(e.target.value || 1))} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.tickMs")}</span>
              <input className="input" type="number" min={100} max={60_000} value={tickMs} onChange={(e) => setTickMs(Number(e.target.value || 1000))} />
            </label>
          </div>
        </div>

        <div className="card botsSetupSection">
          <div className="botsSetupSectionHeader">
            <div className="botsSetupSectionTitle">{t("sections.vault")}</div>
            <div className="botsSetupSectionHint">{t("sections.vaultHint")}</div>
          </div>
          <label className="botsNewCheckField">
            <span className="botsNewCheckFieldLabel">{t("vault.useVault")}</span>
            <input
              className="botsNewCheckInput"
              type="checkbox"
              checked={vaultEnabled}
              disabled={!vaultEligible || !bot?.botVault}
              onChange={(e) => setVaultEnabled(e.target.checked)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("vault.allocation")}</span>
            <input
              className="input"
              type="number"
              min={0.01}
              step="0.01"
              value={vaultAllocationUsd}
              disabled={!vaultEnabled}
              onChange={(e) => setVaultAllocationUsd(e.target.value)}
            />
          </label>
          {!bot?.botVault ? (
            <div className="botsSetupInlineHint">{t("vault.existingOnly")}</div>
          ) : null}
        </div>

        {strategyKey !== "prediction_copier" ? (
          <div className="card botsSetupSection">
            <div className="botsSetupSectionHeader">
              <div className="botsSetupSectionTitle">{t("sections.execution")}</div>
              <div className="botsSetupSectionHint">{t("sections.executionHint")}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.executionMode")}</span>
                <select className="input" value={executionMode} onChange={(e) => setExecutionMode(e.target.value as ExecutionModeValue)}>
                  <option value="simple">{t("options.executionSimple")}</option>
                  <option value="dca">{t("options.executionDca")}</option>
                  <option value="grid">{t("options.executionGrid")}</option>
                  <option value="dip_reversion">{t("options.executionDipReversion")}</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxDailyExecutions")}</span>
                <input className="input" type="number" min={1} max={10000} value={commonMaxDailyExecutions} onChange={(e) => setCommonMaxDailyExecutions(Number(e.target.value || 200))} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.cooldownSecAfterExecution")}</span>
                <input className="input" type="number" min={0} max={86400} value={commonCooldownSecAfterExecution} onChange={(e) => setCommonCooldownSecAfterExecution(Number(e.target.value || 0))} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxOpenPositions")}</span>
                <input className="input" type="number" min={1} max={100} value={commonMaxOpenPositions} onChange={(e) => setCommonMaxOpenPositions(Number(e.target.value || 1))} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalPerSymbol")}</span>
                <input className="input" type="number" min={0} step="0.01" value={commonMaxNotionalPerSymbolUsd} onChange={(e) => setCommonMaxNotionalPerSymbolUsd(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalTotal")}</span>
                <input className="input" type="number" min={0} step="0.01" value={commonMaxTotalNotionalUsd} onChange={(e) => setCommonMaxTotalNotionalUsd(e.target.value)} />
              </label>
              <label className="botsNewCheckField">
                <span className="botsNewCheckFieldLabel">{t("fields.enforceReduceOnlyOnClose")}</span>
                <input className="botsNewCheckInput" type="checkbox" checked={commonEnforceReduceOnlyOnClose} onChange={(e) => setCommonEnforceReduceOnlyOnClose(e.target.checked)} />
              </label>
            </div>

            {executionMode === "simple" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.orderType")}</span>
                  <select className="input" value={simpleOrderType} onChange={(e) => setSimpleOrderType(e.target.value as "market" | "limit")}>
                    <option value="market">{t("options.orderMarket")}</option>
                    <option value="limit">{t("options.orderLimit")}</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.limitOffsetBps")}</span>
                  <input className="input" type="number" min={0} max={500} value={simpleLimitOffsetBps} onChange={(e) => setSimpleLimitOffsetBps(Number(e.target.value || 0))} />
                </label>
              </div>
            ) : null}

            {executionMode === "dca" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxEntries")}</span><input className="input" type="number" min={1} max={20} value={dcaMaxEntries} onChange={(e) => setDcaMaxEntries(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.stepPct")}</span><input className="input" type="number" min={0.01} step="0.01" value={dcaStepPct} onChange={(e) => setDcaStepPct(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.sizeScale")}</span><input className="input" type="number" min={1} step="0.01" value={dcaSizeScale} onChange={(e) => setDcaSizeScale(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.entryOrderType")}</span>
                  <select className="input" value={dcaEntryOrderType} onChange={(e) => setDcaEntryOrderType(e.target.value as "market" | "limit")}>
                    <option value="market">{t("options.orderMarket")}</option>
                    <option value="limit">{t("options.orderLimit")}</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.takeProfitPct")}</span><input className="input" type="number" min={0} step="0.1" value={dcaTakeProfitPct} onChange={(e) => setDcaTakeProfitPct(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.stopLossPct")}</span><input className="input" type="number" min={0} step="0.1" value={dcaStopLossPct} onChange={(e) => setDcaStopLossPct(e.target.value)} /></label>
                <label className="botsNewCheckField">
                  <span className="botsNewCheckFieldLabel">{t("fields.cancelPendingOnFlip")}</span>
                  <input className="botsNewCheckInput" type="checkbox" checked={dcaCancelPendingOnFlip} onChange={(e) => setDcaCancelPendingOnFlip(e.target.checked)} />
                </label>
              </div>
            ) : null}

            {executionMode === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.levelsPerSide")}</span><input className="input" type="number" min={1} max={40} value={gridLevelsPerSide} onChange={(e) => setGridLevelsPerSide(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.gridSpacingPct")}</span><input className="input" type="number" min={0.01} step="0.01" value={gridSpacingPct} onChange={(e) => setGridSpacingPct(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.baseOrderUsd")}</span><input className="input" type="number" min={1} step="1" value={gridBaseOrderUsd} onChange={(e) => setGridBaseOrderUsd(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.tpPctPerLevel")}</span><input className="input" type="number" min={0.01} step="0.01" value={gridTpPctPerLevel} onChange={(e) => setGridTpPctPerLevel(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxActiveOrders")}</span><input className="input" type="number" min={1} max={200} value={gridMaxActiveOrders} onChange={(e) => setGridMaxActiveOrders(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.rebalanceThresholdPct")}</span><input className="input" type="number" min={0.01} step="0.01" value={gridRebalanceThresholdPct} onChange={(e) => setGridRebalanceThresholdPct(Number(e.target.value || 0))} /></label>
              </div>
            ) : null}

            {executionMode === "dip_reversion" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.dipTriggerPct")}</span><input className="input" type="number" min={0.1} step="0.1" value={dipTriggerPct} onChange={(e) => setDipTriggerPct(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.recoveryTakeProfitPct")}</span><input className="input" type="number" min={0.1} step="0.1" value={dipRecoveryTakeProfitPct} onChange={(e) => setDipRecoveryTakeProfitPct(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxHoldMinutes")}</span><input className="input" type="number" min={1} step="1" value={dipMaxHoldMinutes} onChange={(e) => setDipMaxHoldMinutes(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxReentriesPerDay")}</span><input className="input" type="number" min={1} step="1" value={dipMaxReentriesPerDay} onChange={(e) => setDipMaxReentriesPerDay(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.entryScaleUsd")}</span><input className="input" type="number" min={1} step="1" value={dipEntryScaleUsd} onChange={(e) => setDipEntryScaleUsd(Number(e.target.value || 1))} /></label>
              </div>
            ) : null}
          </div>
        ) : null}

        {strategyKey === "prediction_copier" ? (
          <>
            <div className="card botsSetupSection">
              <div className="botsSetupSectionHeader">
                <div className="botsSetupSectionTitle">{t("sections.source")}</div>
                <div className="botsSetupSectionHint">{t("sections.sourceHint")}</div>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.source")}</span>
                <select className="input" value={sourceStateId} onChange={(e) => setSourceStateId(e.target.value)} disabled={loadingSources || sources.length === 0}>
                  {sources.length === 0 ? (
                    <option value="">{loadingSources ? t("loadingSources") : t("noSources")}</option>
                  ) : null}
                  {sources.map((source) => (
                    <option key={source.stateId} value={source.stateId}>
                      {source.symbol} · {source.timeframe} · {source.strategyKind ?? "legacy"} · {formatSignalLabel(normalizeSignal(source.lastSignal), t)}
                    </option>
                  ))}
                </select>
              </label>

              {sourcesError ? <div style={{ color: "#ef4444", fontSize: 12 }}>{sourcesError}</div> : null}
            </div>

            <div className="card botsSetupSection">
              <div className="botsSetupSectionHeader">
                <div className="botsSetupSectionTitle">{t("sections.risk")}</div>
                <div className="botsSetupSectionHint">{t("sections.riskHint")}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxOpenPositions")}</span><input className="input" type="number" min={1} value={riskMaxOpenPositions} onChange={(e) => setRiskMaxOpenPositions(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxDailyTrades")}</span><input className="input" type="number" min={1} value={riskMaxDailyTrades} onChange={(e) => setRiskMaxDailyTrades(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.cooldownSec")}</span><input className="input" type="number" min={0} value={riskCooldownSec} onChange={(e) => setRiskCooldownSec(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalPerSymbol")}</span><input className="input" type="number" min={1} value={riskMaxNotionalSymbol} onChange={(e) => setRiskMaxNotionalSymbol(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxNotionalTotal")}</span><input className="input" type="number" min={1} value={riskMaxNotionalTotal} onChange={(e) => setRiskMaxNotionalTotal(Number(e.target.value || 1))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.stopLossPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskStopLossPct} onChange={(e) => setRiskStopLossPct(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.takeProfitPct")}</span><input className="input" type="number" min={0} step="0.1" value={riskTakeProfitPct} onChange={(e) => setRiskTakeProfitPct(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.timeStopMin")}</span><input className="input" type="number" min={0} step="1" value={riskTimeStopMin} onChange={(e) => setRiskTimeStopMin(e.target.value)} /></label>
                <label className="botsNewCheckField">
                  <span className="botsNewCheckFieldLabel">{t("fields.exitOnSignalFlip")}</span>
                  <input className="botsNewCheckInput" type="checkbox" checked={exitOnSignalFlip} onChange={(e) => setExitOnSignalFlip(e.target.checked)} />
                </label>
                <label className="botsNewCheckField">
                  <span className="botsNewCheckFieldLabel">{t("fields.exitOnConfidenceDrop")}</span>
                  <input className="botsNewCheckInput" type="checkbox" checked={exitOnConfidenceDrop} onChange={(e) => setExitOnConfidenceDrop(e.target.checked)} />
                </label>
              </div>
            </div>

            <div className="card botsSetupSection">
              <div className="botsSetupSectionHeader">
                <div className="botsSetupSectionTitle">{t("sections.filters")}</div>
                <div className="botsSetupSectionHint">{t("sections.filtersHint")}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.blockTags")}</span><input className="input" value={filtersBlockTags} onChange={(e) => setFiltersBlockTags(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.requireTags")}</span><input className="input" value={filtersRequireTags} onChange={(e) => setFiltersRequireTags(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.minExpectedMove")}</span><input className="input" type="number" min={0} step="0.01" value={filtersMinExpectedMove} onChange={(e) => setFiltersMinExpectedMove(e.target.value)} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.orderType")}</span><select className="input" value={copierOrderType} onChange={(e) => setCopierOrderType(e.target.value as CopierOrderType)}><option value="market">{t("options.orderMarket")}</option><option value="limit">{t("options.orderLimit")}</option></select></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.sizingType")}</span><select className="input" value={copierSizingType} onChange={(e) => setCopierSizingType(e.target.value as CopierSizingType)}><option value="fixed_usd">{t("options.sizingFixedUsd")}</option><option value="equity_pct">{t("options.sizingEquityPct")}</option><option value="risk_pct">{t("options.sizingRiskPct")}</option></select></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.sizingValue")}</span><input className="input" type="number" min={0.01} step="0.01" value={copierSizingValue} onChange={(e) => setCopierSizingValue(Number(e.target.value || 100))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.minConfidence")}</span><input className="input" type="number" min={0} max={100} value={copierMinConfidence} onChange={(e) => setCopierMinConfidence(Number(e.target.value || 0))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.maxPredictionAge")}</span><input className="input" type="number" min={30} max={86400} value={copierMaxPredictionAgeSec} onChange={(e) => setCopierMaxPredictionAgeSec(Number(e.target.value || 600))} /></label>
                <label style={{ display: "grid", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.limitOffsetBps")}</span><input className="input" type="number" min={0} max={500} value={executionLimitOffsetBps} onChange={(e) => setExecutionLimitOffsetBps(Number(e.target.value || 0))} /></label>
                <label className="botsNewCheckField"><span className="botsNewCheckFieldLabel">{t("fields.newsRiskBlockEnabled")}</span><input className="botsNewCheckInput" type="checkbox" checked={filtersNewsRiskBlockEnabled} onChange={(e) => setFiltersNewsRiskBlockEnabled(e.target.checked)} /></label>
                <label className="botsNewCheckField"><span className="botsNewCheckFieldLabel">{t("fields.reduceOnlyOnExit")}</span><input className="botsNewCheckInput" type="checkbox" checked={executionReduceOnlyOnExit} onChange={(e) => setExecutionReduceOnlyOnExit(e.target.checked)} /></label>
              </div>

              <div className="botsNewSignalRow">
                <span className="botsNewSignalLabel">{t("fields.allowSignals")}</span>
                <div className="botsNewSignalOptions">
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalUp} onChange={(e) => setAllowSignalUp(e.target.checked)} />
                    <span>{t("options.signalUp")}</span>
                  </label>
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalDown} onChange={(e) => setAllowSignalDown(e.target.checked)} />
                    <span>{t("options.signalDown")}</span>
                  </label>
                  <label className="botsNewSignalOption">
                    <input className="botsNewCheckInput" type="checkbox" checked={allowSignalNeutral} onChange={(e) => setAllowSignalNeutral(e.target.checked)} />
                    <span>{t("options.signalNeutral")}</span>
                  </label>
                </div>
              </div>
            </div>
          </>
        ) : null}

        <div className="card botsSetupSection">
          <div className="botsSetupSectionHeader">
            <div className="botsSetupSectionTitle">{t("sections.backtest")}</div>
            <div className="botsSetupSectionHint">{t("sections.backtestHint")}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.backtestFrom")}</span>
              <input className="input" type="datetime-local" value={backtestFrom} onChange={(e) => setBacktestFrom(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.backtestTo")}</span>
              <input className="input" type="datetime-local" value={backtestTo} onChange={(e) => setBacktestTo(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("fields.backtestTimeframe")}</span>
                  <select className="input" value={backtestTimeframe} onChange={(e) => setBacktestTimeframe(e.target.value as BacktestTimeframe)}>
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
                <option value="1d">1d</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => void onStartBacktest()} disabled={backtestSubmitting}>
              {backtestSubmitting ? t("backtestStarting") : t("startBacktest")}
            </button>
            <button className="btn" type="button" onClick={() => void loadBacktestRuns()} disabled={backtestLoading || backtestSubmitting}>
              {backtestLoading ? t("backtestLoading") : t("refreshBacktests")}
            </button>
          </div>

          {backtestError ? (
            <div style={{ color: "#ef4444", fontSize: 12 }}>{backtestError}</div>
          ) : null}

          <div style={{ display: "grid", gap: 8 }}>
            {(backtestRuns ?? []).length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("noBacktests")}</div>
            ) : (
              backtestRuns.map((row) => {
                const canCancel = row.status === "queued" || row.status === "running";
                return (
                  <div key={row.runId} className="card" style={{ padding: 10, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{row.status}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(row.requestedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {row.period.from} → {row.period.to} · {row.period.timeframe}
                    </div>
                    {row.kpi ? (
                      <div style={{ fontSize: 12 }}>
                        PnL: {row.kpi.pnlUsd?.toFixed?.(2) ?? row.kpi.pnlUsd} · DD: {row.kpi.maxDrawdownPct?.toFixed?.(2) ?? row.kpi.maxDrawdownPct}% · Winrate: {row.kpi.winratePct?.toFixed?.(2) ?? row.kpi.winratePct}% · Trades: {row.kpi.tradeCount}
                      </div>
                    ) : null}
                    {row.error ? <div style={{ color: "#ef4444", fontSize: 12 }}>{row.error}</div> : null}
                    {canCancel ? (
                      <div>
                        <button className="btn" type="button" onClick={() => void onCancelBacktest(row.runId)} disabled={backtestSubmitting}>
                          {t("cancelBacktest")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="botsSetupActionRow">
          <Link className="btn" href={withLocalePath(`/bots/${id}`, locale)}>
            {t("actions.back")}
          </Link>
          <button className="btn btnPrimary" type="submit" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
