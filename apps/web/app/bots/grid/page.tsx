"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { GridInstanceDetailView } from "../../../components/grid/GridInstanceDetailView";
import { MasterVaultOnchainActionsCard } from "../../../components/grid/OnchainVaultActions";
import type { GridFillsResponse, GridInstance, MasterVaultSummary } from "../../../components/grid/types";
import { buildGridCycles, deriveUnrealizedPnlFromSnapshot, errMsg, formatNumber } from "../../../components/grid/utils";

type GridInstanceSummaryStats = {
  gridProfitUsd: number;
  completedRounds: number;
  completedRounds24h: number;
};

export default function GridBotsDashboardPage() {
  const locale = useLocale() as AppLocale;
  const tBots = useTranslations("system.botsList");
  const tGrid = useTranslations("grid.marketplace");
  const tInstance = useTranslations("grid.instance");

  const [instances, setInstances] = useState<GridInstance[]>([]);
  const [masterVault, setMasterVault] = useState<MasterVaultSummary | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [instanceStats, setInstanceStats] = useState<Record<string, GridInstanceSummaryStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyInstanceAction, setBusyInstanceAction] = useState<string | null>(null);

  function formatModeBadge(instance: GridInstance): string {
    const mode = String(instance.template?.mode ?? "").trim();
    const leverage = Number(instance.leverage ?? NaN);
    const modeLabel = mode ? `${mode.charAt(0).toUpperCase()}${mode.slice(1)}` : "Grid";
    return Number.isFinite(leverage) && leverage > 0 ? `${formatNumber(leverage, 0)}x ${modeLabel}` : modeLabel;
  }

  function formatElapsed(value: string | null | undefined): string {
    if (!value) return "n/a";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "n/a";
    const diffMs = Date.now() - parsed.getTime();
    if (diffMs <= 0) return "0m";
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  const sortedInstances = useMemo(() => {
    const rank = (state: GridInstance["state"]) => {
      if (state === "running") return 0;
      if (state === "paused") return 1;
      if (state === "error") return 2;
      if (state === "created") return 3;
      if (state === "stopped") return 4;
      if (state === "archived") return 5;
      return 6;
    };
    return [...instances].sort((left, right) => {
      const stateDiff = rank(left.state) - rank(right.state);
      if (stateDiff !== 0) return stateDiff;
      const leftTs = new Date(left.lastPlanAt ?? left.archivedAt ?? 0).getTime();
      const rightTs = new Date(right.lastPlanAt ?? right.archivedAt ?? 0).getTime();
      return rightTs - leftTs;
    });
  }, [instances]);

  const selectedInstance = useMemo(
    () => sortedInstances.find((row) => row.id === selectedInstanceId) ?? null,
    [selectedInstanceId, sortedInstances]
  );
  const hyperliquidInstances = useMemo(
    () => sortedInstances.filter((row) =>
      row.botVault?.executionProvider === "hyperliquid_demo"
      || row.botVault?.providerMetadataSummary?.marketDataExchange === "hyperliquid"
    ),
    [sortedInstances]
  );
  const hyperliquidRunningCount = useMemo(
    () => hyperliquidInstances.filter((row) => row.state === "running").length,
    [hyperliquidInstances]
  );
  const hyperliquidIssueCount = useMemo(
    () => hyperliquidInstances.filter((row) =>
      Boolean(row.botVault?.executionLastError)
      || Boolean(row.lastPlanError)
      || row.botVault?.executionStatus === "error"
    ).length,
    [hyperliquidInstances]
  );
  const executionMode = masterVault?.executionMode ?? "offchain_shadow";
  const isShadowVaultMode = executionMode === "offchain_shadow";
  const isOnchainVaultMode = !isShadowVaultMode;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [instanceResponse, masterVaultResponse] = await Promise.all([
        apiGet<{ items: GridInstance[] }>(`/grid/instances${showArchived ? "?includeArchived=true" : ""}`),
        apiGet<MasterVaultSummary>("/vaults/master")
      ]);
      const instanceItems = Array.isArray(instanceResponse.items) ? instanceResponse.items : [];
      setInstances(instanceItems);
      setMasterVault(masterVaultResponse ?? null);

      const statEntries = await Promise.all(
        instanceItems.map(async (instance) => {
          try {
            const fillsResponse = await apiGet<GridFillsResponse>(`/grid/instances/${instance.id}/fills`);
            const cycles = buildGridCycles(Array.isArray(fillsResponse.items) ? fillsResponse.items : []);
            const completedCycles = cycles.filter((row) => row.closeFill);
            const threshold = Date.now() - 24 * 60 * 60 * 1000;
            const completedRounds24h = completedCycles.filter((row) => {
              const closeTs = row.closeFill?.fillTs ?? row.openFill.fillTs;
              return new Date(closeTs).getTime() >= threshold;
            }).length;
            const gridProfitUsd = completedCycles.reduce((sum, row) => sum + Number(row.releasedProfitUsd ?? 0), 0);
            return [
              instance.id,
              {
                gridProfitUsd,
                completedRounds: completedCycles.length,
                completedRounds24h
              }
            ] as const;
          } catch {
            return [
              instance.id,
              {
                gridProfitUsd: 0,
                completedRounds: 0,
                completedRounds24h: 0
              }
            ] as const;
          }
        })
      );
      setInstanceStats(Object.fromEntries(statEntries));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  useEffect(() => {
    if (sortedInstances.length === 0) {
      setSelectedInstanceId("");
      return;
    }
    if (selectedInstanceId && sortedInstances.some((row) => row.id === selectedInstanceId)) return;
    const preferred = sortedInstances.find((row) => row.state === "running") ?? sortedInstances[0];
    setSelectedInstanceId(preferred.id);
  }, [selectedInstanceId, sortedInstances]);

  async function runInstanceAction(instance: GridInstance, action: "pause" | "resume" | "stop") {
    const actionKey = `${instance.id}:${action}`;
    if (action === "stop") {
      const confirmed = window.confirm(tInstance("confirmEnd", {
        name: instance.template?.name ?? tGrid("template"),
        symbol: instance.template?.symbol ?? "n/a"
      }));
      if (!confirmed) return;
    }
    setBusyInstanceAction(actionKey);
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/grid/instances/${instance.id}/${action}`, {});
      if (action === "pause") setNotice(tInstance("actionPauseDone"));
      if (action === "resume") setNotice(tInstance("actionResumeDone"));
      if (action === "stop") setNotice(tInstance("actionStopDone"));
      await load();
    } catch (actionError) {
      setError(errMsg(actionError));
    } finally {
      setBusyInstanceAction(null);
    }
  }

  return (
    <div className="botsPage">
      <div className="dashboardHeader">
        <div>
          <h2 style={{ margin: 0 }}>{tGrid("title")}</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{tGrid("dashboardSubtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={withLocalePath("/bots/grid/new", locale)} className="btn btnPrimary">{tGrid("newInstance")}</Link>
        </div>
      </div>

      {error ? <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="card" style={{ padding: 12, borderColor: "#22c55e", marginBottom: 12 }}>{notice}</div> : null}

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>
          {isShadowVaultMode ? tGrid("demoVaultTitle") : tGrid("masterVaultTitle")}
        </h3>
        <div className="settingsMutedText" style={{ marginBottom: 10 }}>
          {isShadowVaultMode ? tGrid("demoVaultOverviewHint") : tGrid("masterVaultBalanceHint")}
        </div>
        {masterVault ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            <div className="card" style={{ padding: 10 }}>
              <strong>{tGrid("masterVaultFree")}</strong>
              <div>{formatNumber(masterVault.freeBalance, 2)} USDT</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{tGrid("masterVaultReserved")}</strong>
              <div>{formatNumber(masterVault.reservedBalance, 2)} USDT</div>
            </div>
          </div>
        ) : (
          <div className="settingsMutedText">{tGrid("masterVaultLoading")}</div>
        )}
      </section>

      {isOnchainVaultMode && !masterVault?.onchainAddress ? (
        <MasterVaultOnchainActionsCard
          masterVault={masterVault}
          onUpdated={load}
        />
      ) : null}

      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>{tGrid("runningTitle")}</h3>
            <div className="settingsMutedText" style={{ marginTop: 4 }}>{tGrid("runningSubtitle")}</div>
          </div>
          <label className="settingsMutedText" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            <span>{tGrid("showArchived")}</span>
          </label>
        </div>

        {hyperliquidInstances.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
            <div className="card" style={{ padding: 10 }}>
              <strong>{tGrid("pilotDemoBotsLabel")}</strong>
              <div>{formatNumber(hyperliquidInstances.length, 0)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{tGrid("pilotDemoRunningLabel")}</strong>
              <div>{formatNumber(hyperliquidRunningCount, 0)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <strong>{tGrid("pilotDemoIssuesLabel")}</strong>
              <div>{formatNumber(hyperliquidIssueCount, 0)}</div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="settingsMutedText">{tGrid("loadingInstances")}</div>
        ) : sortedInstances.length === 0 ? (
          <div className="settingsMutedText">{tGrid("noInstances")}</div>
        ) : (
          <div className="gridRunningSplitLayout">
            <div className="gridRunningSplitList">
              {sortedInstances.map((instance) => {
                const metrics = instance.metricsJson ?? {};
                const stats = instanceStats[instance.id];
                const derivedUnrealized = deriveUnrealizedPnlFromSnapshot(metrics.positionSnapshot);
                const actualInvestment = Number(instance.investUsd ?? 0);
                const hasCompletedGridRounds = Number(stats?.completedRounds ?? 0) > 0;
                const gridProfit = hasCompletedGridRounds
                  ? Number(stats?.gridProfitUsd ?? 0)
                  : Number.isFinite(Number(metrics.gridProfitUsd ?? NaN))
                    ? Number(metrics.gridProfitUsd ?? 0)
                    : Number(stats?.gridProfitUsd ?? 0);
                const trendPnl = Number.isFinite(Number(metrics.unrealizedPnlUsd ?? NaN))
                  ? Number(metrics.unrealizedPnlUsd ?? 0)
                  : Number(derivedUnrealized ?? 0);
                const totalPnl = hasCompletedGridRounds
                  ? gridProfit + trendPnl
                  : Number.isFinite(Number(metrics.totalPnlUsd ?? NaN))
                    ? Number(metrics.totalPnlUsd ?? 0)
                    : gridProfit + trendPnl;
                const roundsTotal = hasCompletedGridRounds
                  ? Number(stats?.completedRounds ?? 0)
                  : Number.isFinite(Number(metrics.rounds ?? NaN))
                    ? Number(metrics.rounds ?? 0)
                    : Number(stats?.completedRounds ?? 0);
                const rounds24h = Number(stats?.completedRounds24h ?? 0);
                const liqEstimate = Number(metrics.liqEstimateLong ?? metrics.liqEstimateShort ?? NaN);
                const markPrice = Number((metrics.positionSnapshot as Record<string, unknown> | undefined)?.markPrice ?? NaN);
                const currentEntry = Number((metrics.positionSnapshot as Record<string, unknown> | undefined)?.entryPrice ?? NaN);
                const gridReturnPct = actualInvestment > 0 ? (gridProfit / actualInvestment) * 100 : null;
                const trendReturnPct = actualInvestment > 0 ? (trendPnl / actualInvestment) * 100 : null;
                const totalReturnPct = actualInvestment > 0 ? (totalPnl / actualInvestment) * 100 : null;
                const selected = instance.id === selectedInstanceId;
                const toggleAction = instance.state === "running" ? "pause" : "resume";
                const toggleLabel = instance.state === "running" ? tInstance("pause") : tInstance("resume");
                const toggleDisabled = busyInstanceAction !== null || !["running", "paused", "stopped", "created", "error"].includes(instance.state);
                const stopDisabled = busyInstanceAction !== null || instance.state === "archived";
                const isHyperliquidDemo =
                  instance.botVault?.executionProvider === "hyperliquid_demo"
                  || instance.botVault?.providerMetadataSummary?.marketDataExchange === "hyperliquid";
                return (
                  <div
                    key={instance.id}
                    className={`gridRunningCard ${selected ? "gridRunningCardActive" : ""} gridRunningCardState-${instance.state}`}
                  >
                    <button
                      type="button"
                      className="gridRunningCardBody"
                      onClick={() => setSelectedInstanceId(instance.id)}
                    >
                      <div className="gridRunningCardTop">
                        <div>
                          <div className="gridRunningCardTitle">{instance.template?.name ?? tGrid("template")}</div>
                          <div className="gridRunningCardMeta">{instance.template?.symbol ?? "n/a"} · {instance.template?.mode ?? "n/a"} · {instance.template?.gridMode ?? "n/a"}</div>
                          <div className="gridRunningCardSubmeta">
                            {tGrid("cardCreatedLine", {
                              lasting: formatElapsed(instance.createdAt ?? null),
                              created: instance.createdAt ? new Date(instance.createdAt).toLocaleDateString(locale) : "n/a"
                            })}
                          </div>
                        </div>
                        <div className="gridRunningCardBadges">
                          <span className="gridRunningModeBadge">{formatModeBadge(instance)}</span>
                          {isHyperliquidDemo ? (
                            <span className="badge badgeWarn">{tGrid("pilotBadge")}</span>
                          ) : null}
                          {instance.botVault?.executionProvider ? (
                            <span className="badge">{instance.botVault.executionProvider}</span>
                          ) : null}
                          {instance.botVault?.executionStatus ? (
                            <span className="badge">{instance.botVault.executionStatus}</span>
                          ) : null}
                          <span className={`badge ${instance.state === "running" ? "badgeOk" : instance.state === "paused" ? "badgeWarn" : "badge"}`}>{instance.state}</span>
                        </div>
                      </div>
                      <div className="gridRunningHero">
                        <div className="gridRunningHeroLeft">
                          <span className="gridRunningHeroLabel">{tGrid("cardInvestLabel")}</span>
                          <strong>{formatNumber(actualInvestment, 2)} USDT</strong>
                        </div>
                        <div className={`gridRunningHeroRight ${totalPnl >= 0 ? "gridRunningHeroPositive" : "gridRunningHeroNegative"}`}>
                          <span className="gridRunningHeroLabel">{tGrid("cardTotalPnlLabel")}</span>
                          <strong>{formatNumber(totalPnl, 2)} USDT</strong>
                          <span className="gridRunningHeroSubvalue">
                            {totalReturnPct == null ? "n/a" : `${totalPnl >= 0 ? "+" : ""}${formatNumber(totalReturnPct, 2)}%`}
                          </span>
                        </div>
                      </div>
                      <div className="gridRunningMetaGrid">
                        <div>
                          <span>{tGrid("cardGridProfitLabel")}</span>
                          <strong className={gridProfit >= 0 ? "gridRunningStatPositive" : "gridRunningStatNegative"}>{formatNumber(gridProfit, 2)} USDT</strong>
                          <span className={gridProfit >= 0 ? "gridRunningStatPositive" : "gridRunningStatNegative"}>
                            {gridReturnPct == null ? "n/a" : `${gridProfit >= 0 ? "+" : ""}${formatNumber(gridReturnPct, 2)}%`}
                          </span>
                        </div>
                        <div>
                          <span>{tGrid("cardTrendPnlLabel")}</span>
                          <strong className={trendPnl >= 0 ? "gridRunningStatPositive" : "gridRunningStatNegative"}>{formatNumber(trendPnl, 2)} USDT</strong>
                          <span className={trendPnl >= 0 ? "gridRunningStatPositive" : "gridRunningStatNegative"}>
                            {trendReturnPct == null ? "n/a" : `${trendPnl >= 0 ? "+" : ""}${formatNumber(trendReturnPct, 2)}%`}
                          </span>
                        </div>
                        <div>
                          <span>{tGrid("cardGridTotalPctLabel")}</span>
                          <strong>{gridReturnPct == null ? "n/a" : `${gridProfit >= 0 ? "+" : ""}${formatNumber(gridReturnPct, 2)}%`}</strong>
                          <span>{totalReturnPct == null ? "n/a" : `${totalPnl >= 0 ? "+" : ""}${formatNumber(totalReturnPct, 2)}%`}</span>
                        </div>
                        <div>
                          <span>{tGrid("cardMarkLabel")}</span>
                          <strong>{formatNumber(markPrice, 2)}</strong>
                        </div>
                        <div>
                          <span>{tGrid("cardRangeLabel")}</span>
                          <strong>{formatNumber(instance.template?.lowerPrice ?? null, 0)} - {formatNumber(instance.template?.upperPrice ?? null, 0)}</strong>
                        </div>
                        <div>
                          <span>{tGrid("cardRounds24hTotalLabel")}</span>
                          <strong>{formatNumber(rounds24h, 0)} / {formatNumber(roundsTotal, 0)}</strong>
                        </div>
                        <div>
                          <span>{tGrid("cardExtraMarginLabel")}</span>
                          <strong>{formatNumber(instance.extraMarginUsd, 2)} USDT</strong>
                        </div>
                        <div>
                          <span>{tGrid("cardLiqLabel")}</span>
                          <strong>{formatNumber(liqEstimate, 2)}</strong>
                        </div>
                        <div>
                          <span>{tGrid("cardStartPriceLabel")}</span>
                          <strong>{formatNumber(currentEntry, 2)}</strong>
                        </div>
                      </div>
                    </button>
                    <div className="gridRunningCardActions">
                      <button
                        type="button"
                        className="btn btnPause"
                        onClick={() => void runInstanceAction(instance, toggleAction)}
                        disabled={toggleDisabled}
                      >
                        {busyInstanceAction === `${instance.id}:${toggleAction}` ? tGrid("loadingInstances") : toggleLabel}
                      </button>
                      <button
                        type="button"
                        className="btn btnStop"
                        onClick={() => void runInstanceAction(instance, "stop")}
                        disabled={stopDisabled}
                      >
                        {busyInstanceAction === `${instance.id}:stop` ? tInstance("end") : tInstance("end")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="gridRunningSplitDetail">
              {selectedInstance ? (
                <GridInstanceDetailView instanceId={selectedInstance.id} embedded />
              ) : (
                <div className="settingsMutedText">{tGrid("selectInstanceHint")}</div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
