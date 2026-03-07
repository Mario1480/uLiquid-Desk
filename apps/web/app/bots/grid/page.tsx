"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import { GridInstanceDetailView } from "../../../components/grid/GridInstanceDetailView";
import type { GridFillsResponse, GridInstance, MasterVaultSummary } from "../../../components/grid/types";
import { buildGridCycles, createIdempotencyKey, deriveUnrealizedPnlFromSnapshot, errMsg, formatNumber } from "../../../components/grid/utils";

type GridInstanceSummaryStats = {
  gridProfitUsd: number;
  completedRounds: number;
  totalFills: number;
};

export default function GridBotsDashboardPage() {
  const locale = useLocale() as AppLocale;
  const tBots = useTranslations("system.botsList");
  const tGrid = useTranslations("grid.marketplace");

  const [instances, setInstances] = useState<GridInstance[]>([]);
  const [masterVault, setMasterVault] = useState<MasterVaultSummary | null>(null);
  const [masterVaultBusy, setMasterVaultBusy] = useState<"deposit" | "withdraw" | null>(null);
  const [masterDepositAmount, setMasterDepositAmount] = useState<string>("100");
  const [masterWithdrawAmount, setMasterWithdrawAmount] = useState<string>("50");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);
  const [instanceStats, setInstanceStats] = useState<Record<string, GridInstanceSummaryStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function formatModeBadge(instance: GridInstance): string {
    const mode = String(instance.template?.mode ?? "").trim();
    const leverage = Number(instance.leverage ?? NaN);
    const modeLabel = mode ? `${mode.charAt(0).toUpperCase()}${mode.slice(1)}` : "Grid";
    return Number.isFinite(leverage) && leverage > 0 ? `${modeLabel} ${formatNumber(leverage, 0)}x` : modeLabel;
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
            const gridProfitUsd = completedCycles.reduce((sum, row) => sum + Number(row.releasedProfitUsd ?? 0), 0);
            return [
              instance.id,
              {
                gridProfitUsd,
                completedRounds: completedCycles.length,
                totalFills: Array.isArray(fillsResponse.items) ? fillsResponse.items.length : 0
              }
            ] as const;
          } catch {
            return [
              instance.id,
              {
                gridProfitUsd: 0,
                completedRounds: 0,
                totalFills: 0
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

  async function depositToMasterVault() {
    const amountUsd = Number(masterDepositAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError(tGrid("masterVaultInvalidAmount"));
      return;
    }
    setMasterVaultBusy("deposit");
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPost<{ ok: true; vault: MasterVaultSummary }>("/vaults/master/deposit", {
        amountUsd,
        idempotencyKey: createIdempotencyKey("master_deposit"),
        metadata: { sourceType: "web_grid_dashboard" }
      });
      setMasterVault(payload.vault ?? null);
      setNotice(tGrid("masterVaultDepositDone"));
      await load();
    } catch (depositError) {
      setError(errMsg(depositError));
    } finally {
      setMasterVaultBusy(null);
    }
  }

  async function withdrawFromMasterVault() {
    const amountUsd = Number(masterWithdrawAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setError(tGrid("masterVaultInvalidAmount"));
      return;
    }
    if (masterVault && amountUsd > Number(masterVault.withdrawableBalance ?? 0) + 0.0000001) {
      setError(tGrid("masterVaultWithdrawInsufficient"));
      return;
    }
    setMasterVaultBusy("withdraw");
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPost<{ ok: true; vault: MasterVaultSummary }>("/vaults/master/withdraw", {
        amountUsd,
        idempotencyKey: createIdempotencyKey("master_withdraw"),
        metadata: { sourceType: "web_grid_dashboard" }
      });
      setMasterVault(payload.vault ?? null);
      setNotice(tGrid("masterVaultWithdrawDone"));
      await load();
    } catch (withdrawError) {
      setError(errMsg(withdrawError));
    } finally {
      setMasterVaultBusy(null);
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
          <Link href={withLocalePath("/bots", locale)} className="btn">← {tBots("title")}</Link>
          <Link href={withLocalePath("/dashboard", locale)} className="btn">{tGrid("dashboard")}</Link>
          <Link href={withLocalePath("/bots/grid/new", locale)} className="btn btnPrimary">{tGrid("newInstance")}</Link>
        </div>
      </div>

      {error ? <div className="card" style={{ padding: 12, borderColor: "#ef4444", marginBottom: 12 }}>{error}</div> : null}
      {notice ? <div className="card" style={{ padding: 12, borderColor: "#22c55e", marginBottom: 12 }}>{notice}</div> : null}

      <section className="card" style={{ padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>{tGrid("masterVaultTitle")}</h3>
        {masterVault ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginBottom: 10 }}>
              <div className="card" style={{ padding: 10 }}><strong>{tGrid("masterVaultFree")}</strong><div>{formatNumber(masterVault.freeBalance, 2)} USDT</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{tGrid("masterVaultReserved")}</strong><div>{formatNumber(masterVault.reservedBalance, 2)} USDT</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{tGrid("masterVaultWithdrawable")}</strong><div>{formatNumber(masterVault.withdrawableBalance, 2)} USDT</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{tGrid("masterVaultBotCount")}</strong><div>{formatNumber(masterVault.botVaultCount, 0)}</div></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("masterVaultDepositTitle")}</strong>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input className="input" type="number" min="0.01" step="0.01" value={masterDepositAmount} onChange={(event) => setMasterDepositAmount(event.target.value)} />
                  <button className="btn btnPrimary" onClick={() => void depositToMasterVault()} disabled={masterVaultBusy !== null}>
                    {masterVaultBusy === "deposit" ? tGrid("masterVaultDepositing") : tGrid("masterVaultDepositAction")}
                  </button>
                </div>
              </div>
              <div className="card" style={{ padding: 10 }}>
                <strong>{tGrid("masterVaultWithdrawTitle")}</strong>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input className="input" type="number" min="0.01" step="0.01" value={masterWithdrawAmount} onChange={(event) => setMasterWithdrawAmount(event.target.value)} />
                  <button className="btn" onClick={() => void withdrawFromMasterVault()} disabled={masterVaultBusy !== null}>
                    {masterVaultBusy === "withdraw" ? tGrid("masterVaultWithdrawing") : tGrid("masterVaultWithdrawAction")}
                  </button>
                </div>
              </div>
            </div>
            <div className="settingsMutedText" style={{ marginTop: 8 }}>{tGrid("masterVaultHint")}</div>
          </>
        ) : (
          <div className="settingsMutedText">{tGrid("masterVaultLoading")}</div>
        )}
      </section>

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
                const gridProfit = Number.isFinite(Number(metrics.gridProfitUsd ?? NaN))
                  ? Number(metrics.gridProfitUsd ?? 0)
                  : Number(stats?.gridProfitUsd ?? 0);
                const trendPnl = Number.isFinite(Number(metrics.unrealizedPnlUsd ?? NaN))
                  ? Number(metrics.unrealizedPnlUsd ?? 0)
                  : Number(derivedUnrealized ?? 0);
                const totalPnl = Number.isFinite(Number(metrics.totalPnlUsd ?? NaN))
                  ? Number(metrics.totalPnlUsd ?? 0)
                  : gridProfit + trendPnl;
                const rounds = Number.isFinite(Number(metrics.rounds ?? NaN))
                  ? Number(metrics.rounds ?? 0)
                  : Number(stats?.completedRounds ?? 0);
                const liqEstimate = Number(metrics.liqEstimateLong ?? metrics.liqEstimateShort ?? NaN);
                const markPrice = Number((metrics.positionSnapshot as Record<string, unknown> | undefined)?.markPrice ?? NaN);
                const currentEntry = Number((metrics.positionSnapshot as Record<string, unknown> | undefined)?.entryPrice ?? NaN);
                const totalReturnPct = instance.investUsd > 0 ? (totalPnl / instance.investUsd) * 100 : null;
                const selected = instance.id === selectedInstanceId;
                return (
                  <button
                    key={instance.id}
                    type="button"
                    className={`gridRunningCard ${selected ? "gridRunningCardActive" : ""} gridRunningCardState-${instance.state}`}
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
                        <span className={`badge ${instance.state === "running" ? "badgeOk" : instance.state === "paused" ? "badgeWarn" : "badge"}`}>{instance.state}</span>
                      </div>
                    </div>
                    <div className="gridRunningHero">
                      <div className="gridRunningHeroLeft">
                        <span className="gridRunningHeroLabel">{tGrid("cardInvestLabel")}</span>
                        <strong>{formatNumber(instance.investUsd, 2)} USDT</strong>
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
                      </div>
                      <div>
                        <span>{tGrid("cardTrendPnlLabel")}</span>
                        <strong className={trendPnl >= 0 ? "gridRunningStatPositive" : "gridRunningStatNegative"}>{formatNumber(trendPnl, 2)} USDT</strong>
                      </div>
                      <div>
                        <span>{tGrid("cardRoundsLabel")}</span>
                        <strong>{formatNumber(rounds, 0)}</strong>
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
                        <span>{tGrid("cardTradesLabel")}</span>
                        <strong>{formatNumber(Number(stats?.totalFills ?? 0), 0)}</strong>
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
