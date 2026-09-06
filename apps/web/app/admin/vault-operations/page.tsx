"use client";

import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminActionButton from "../_components/AdminActionButton";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import AdminStatusBadge from "../_components/AdminStatusBadge";

type VaultOpsStatusResponse = {
  updatedAt: string;
  mode: string;
  modeSource: string;
  provider: string;
  providerSource: string;
  thresholds: {
    reconciliationLagAlertSeconds: number;
  };
	  safety: {
	    haltNewOrders: boolean;
	    depositsDisabled?: boolean;
	    withdrawsDisabled?: boolean;
	    gridStartsDisabled?: boolean;
	    profitClaimsDisabled?: boolean;
	    closeOnlyAllUserIds: string[];
	    reason: string | null;
	    updatedAt: string | null;
  };
  counts: {
    totalBotVaults: number;
    openBotVaults: number;
    runningExecutions: number;
    executionErrorCount: number;
    pendingOnchainActions: number;
    failedOnchainActions: number;
    laggingReconciliationCount: number;
  };
  lifecycleCounts: Record<string, number>;
  health: Record<string, {
    enabled?: boolean;
    running?: boolean;
    lastError?: string | null;
    lastErrorAt?: string | null;
    consecutiveFailedCycles?: number;
    totalFailedCycles?: number;
    totalLagAlerts?: number;
  }>;
  recentExecutionIssues: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    gridInstanceId: string | null;
    templateName: string | null;
    symbol: string | null;
    executionProvider: string | null;
    status: string;
    executionStatus: string | null;
    lifecycleState: string;
    lifecycleMode: string;
    executionLastError: string | null;
    executionLastErrorAt: string | null;
    agentWalletVersion: number;
    agentSecretRef: string | null;
    gridState: string | null;
    lastReconciledAt: string | null;
    isFlat: boolean | null;
    openPositionCount: number;
  }>;
  recentOnchainActions: Array<{
    id: string;
    actionType: string;
    status: string;
    txHash: string | null;
    userId: string | null;
    userEmail: string | null;
    botVaultId: string | null;
    masterVaultId: string | null;
    updatedAt: string | null;
    createdAt: string | null;
  }>;
  laggingVaults: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    gridInstanceId: string | null;
    templateName: string | null;
    symbol: string | null;
    status: string;
    executionStatus: string | null;
    lifecycleState: string;
    lifecycleMode: string;
    updatedAt: string | null;
    lastReconciledAt: string | null;
    isFlat: boolean | null;
    openPositionCount: number;
    realizedPnlNet: number;
    netWithdrawableProfit: number;
  }>;
};

type ReconciliationSummaryResponse = {
  updatedAt: string;
  jobs: Record<string, {
    enabled?: boolean;
    running?: boolean;
    lastError?: string | null;
    lastErrorAt?: string | null;
    consecutiveFailedCycles?: number;
    totalFailedCycles?: number;
    totalLagAlerts?: number;
  }>;
  counts: {
    clean: number;
    warning: number;
    drift_detected: number;
    blocked: number;
    unknown: number;
  };
  items: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    gridInstanceId: string | null;
    templateName: string | null;
    symbol: string | null;
    status: string;
    executionStatus: string | null;
    lifecycleState: string;
    lifecycleMode: string;
    reconciliationStatus: "clean" | "warning" | "drift_detected" | "blocked" | "unknown";
    reconciliationObservedAt: string | null;
    driftCount: number;
	    warningCount: number;
	    blockedReasons: string[];
	    moneyFlow?: {
	      status: string | null;
	      pendingKind: string | null;
	      pendingSince: string | null;
	      pendingAgeSeconds: number | null;
	      reasonCode: string | null;
	      recoveryHint: string | null;
	      txHash: string | null;
	      idempotencyKey: string | null;
	      expectedBalanceUsd: number | null;
	      actualBalanceUsd: number | null;
	    } | null;
	    openAlertIds?: string[];
	    openAlerts?: Array<{
	      id: string;
	      type: string;
	      severity: string;
	      status: string;
	      title: string | null;
	      message: string;
	      createdAt: string | null;
	      updatedAt: string | null;
	    }>;
	    updatedAt: string | null;
	  }>;
	};

type QueueMetricsResponse = {
  mode: string;
  queueEnabled: boolean;
  botQueue?: Record<string, number>;
  backtestQueue?: Record<string, number>;
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toLocaleString();
}

function short(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "n/a";
  if (raw.length <= 14) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return <AdminStatusBadge value={value} label={label} />;
}

export default function AdminVaultOperationsPage() {
  const t = useTranslations("admin.vaultOperations");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<VaultOpsStatusResponse | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationSummaryResponse | null>(null);
  const [queueMetrics, setQueueMetrics] = useState<QueueMetricsResponse | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setError(t("messages.accessRequired"));
        setPayload(null);
        setReconciliation(null);
        setQueueMetrics(null);
        return;
      }

      const [statusRes, reconciliationRes, queueRes] = await Promise.allSettled([
        apiGet<VaultOpsStatusResponse>("/admin/vault-ops/status"),
        apiGet<ReconciliationSummaryResponse>("/admin/vault-ops/reconciliation-summary"),
        apiGet<QueueMetricsResponse>("/admin/queue/metrics")
      ]);

      if (statusRes.status !== "fulfilled") {
        throw statusRes.reason;
      }

      setPayload(statusRes.value);
      setReconciliation(reconciliationRes.status === "fulfilled" ? reconciliationRes.value : null);
      setQueueMetrics(queueRes.status === "fulfilled" ? queueRes.value : null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const lifecycleEntries = payload
    ? Object.entries(payload.lifecycleCounts).filter(([, count]) => Number(count) > 0)
    : [];

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Vault Operations"
        title={t("title")}
        description={t("subtitle")}
        actions={[
          { href: withLocalePath("/admin", locale), label: tCommon("backToAdmin"), icon: "back", variant: "secondary" },
          { href: withLocalePath("/admin/system/integrations/exchanges", locale), label: t("openVenueHealth"), icon: "exchange", variant: "primary" }
        ]}
      />
      <div className="adminToolbarRow">
        <div className="settingsMutedText">
          {payload ? t("summaryMeta", {
            updatedAt: fmtDate(payload.updatedAt),
            mode: payload.mode,
            provider: payload.provider
          }) : t("loading")}
        </div>
        <AdminActionButton icon="refresh" type="button" onClick={() => void load()} loading={loading}>
          {t("refresh")}
        </AdminActionButton>
      </div>

      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      {payload ? (
        <>
          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("summaryTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {t("summaryMeta", {
                updatedAt: fmtDate(payload.updatedAt),
                mode: payload.mode,
                provider: payload.provider
              })}
            </div>
            <div className="adminStatsGrid">
              <AdminStatsCard label={t("cards.totalVaults")} value={payload.counts.totalBotVaults} />
              <AdminStatsCard label={t("cards.openVaults")} value={payload.counts.openBotVaults} />
              <AdminStatsCard label={t("cards.runningExecutions")} value={payload.counts.runningExecutions} />
              <AdminStatsCard label={t("cards.executionErrors")} value={payload.counts.executionErrorCount} />
              <AdminStatsCard label={t("cards.pendingOnchainActions")} value={payload.counts.pendingOnchainActions} />
              <AdminStatsCard label={t("cards.laggingVaults")} value={payload.counts.laggingReconciliationCount} />
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("lifecycleTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("lifecycleHint")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {lifecycleEntries.length === 0 ? (
                <div className="settingsMutedText">{t("noLifecycleData")}</div>
              ) : lifecycleEntries.map(([state, count]) => (
                <DeskSurface dense><div key={state} className="card" style={{ padding: 10 }}>
                  <div style={{ marginBottom: 8 }}>
                    <StatusPill label={t(`lifecycle.${state}`)} value={state} />
                  </div>
                  <strong>{count}</strong>
                </div></DeskSurface>
              ))}
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("queueTitle")}</h3>
            </div>
            {queueMetrics ? (
              <>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  {t("queueMeta", {
                    mode: queueMetrics.mode,
                    enabled: queueMetrics.queueEnabled ? t("yes") : t("no")
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}>
                    <strong>{t("queueBotTitle")}</strong>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("queueCounts", {
                        active: String(queueMetrics.botQueue?.active ?? 0),
                        waiting: String(queueMetrics.botQueue?.waiting ?? 0),
                        delayed: String(queueMetrics.botQueue?.delayed ?? 0),
                        failed: String(queueMetrics.botQueue?.failed ?? 0)
                      })}
                    </div>
                  </div></DeskSurface>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}>
                    <strong>{t("queueBacktestTitle")}</strong>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("queueCounts", {
                        active: String(queueMetrics.backtestQueue?.active ?? 0),
                        waiting: String(queueMetrics.backtestQueue?.waiting ?? 0),
                        delayed: String(queueMetrics.backtestQueue?.delayed ?? 0),
                        failed: String(queueMetrics.backtestQueue?.failed ?? 0)
                      })}
                    </div>
                  </div></DeskSurface>
                </div>
              </>
            ) : (
              <div className="settingsMutedText">{t("queueUnavailable")}</div>
            )}
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("reconciliationTitle")}</h3>
            </div>
            {reconciliation ? (
              <>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  {t("reconciliationMeta", { updatedAt: fmtDate(reconciliation.updatedAt) })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 10 }}>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.clean")}</strong><div>{reconciliation.counts.clean}</div></div></DeskSurface>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.warning")}</strong><div>{reconciliation.counts.warning}</div></div></DeskSurface>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.drift")}</strong><div>{reconciliation.counts.drift_detected}</div></div></DeskSurface>
                  <DeskSurface dense><div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.blocked")}</strong><div>{reconciliation.counts.blocked}</div></div></DeskSurface>
                </div>
                <div className="tableWrap">
                  <DeskTable className="tableCompact">
                    <thead>
                      <tr>
                        <th>{t("cols.user")}</th>
                        <th>{t("cols.botVault")}</th>
                        <th>{t("cols.symbol")}</th>
                        <th>{t("cols.lifecycle")}</th>
	                        <th>{t("cols.reconciliation")}</th>
	                        <th>Money flow</th>
	                        <th>Alerts</th>
	                        <th>{t("cols.drift")}</th>
	                        <th>{t("cols.updated")}</th>
	                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.items.length === 0 ? (
	                        <tr><td colSpan={9}>{t("noReconciliationDrift")}</td></tr>
	                      ) : reconciliation.items.map((row) => (
	                        <tr key={row.id}>
                          <td>{row.userEmail ?? row.userId}</td>
                          <td>{short(row.id)}</td>
                          <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
	                          <td><StatusPill label={t(`lifecycle.${row.lifecycleState}`)} value={row.lifecycleState} /></td>
	                          <td><StatusPill label={t(`reconciliationStatus.${row.reconciliationStatus}`)} value={row.reconciliationStatus} /></td>
	                          <td>
	                            {row.moneyFlow ? (
	                              <div>
	                                <StatusPill label={String(row.moneyFlow.status ?? row.moneyFlow.pendingKind ?? "pending")} value={String(row.moneyFlow.status ?? "warning")} />
	                                <div className="settingsMutedText" style={{ marginTop: 4 }}>
	                                  {String(row.moneyFlow.reasonCode ?? "n/a")}
	                                </div>
	                                <div className="settingsMutedText" style={{ marginTop: 4 }}>
	                                  {row.moneyFlow.pendingAgeSeconds == null ? "n/a" : `${Math.floor(row.moneyFlow.pendingAgeSeconds / 60)}m`} · {short(row.moneyFlow.txHash)}
	                                </div>
	                              </div>
	                            ) : "n/a"}
	                          </td>
	                          <td>{row.openAlertIds?.length ? row.openAlertIds.map((id) => short(id)).join(", ") : "n/a"}</td>
	                          <td>{row.driftCount}</td>
	                          <td>{fmtDate(row.reconciliationObservedAt ?? row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DeskTable>
                </div>
              </>
            ) : (
              <div className="settingsMutedText">{t("reconciliationUnavailable")}</div>
            )}
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("safetyTitle")}</h3>
            </div>
            <div className="settingsMutedText">
	              {t("safetyMeta", {
	                halt: payload.safety.haltNewOrders ? t("yes") : t("no"),
	                users: String(payload.safety.closeOnlyAllUserIds.length),
	                updatedAt: fmtDate(payload.safety.updatedAt)
	              })}
	            </div>
	            <div className="settingsMutedText" style={{ marginTop: 6 }}>
	              deposits={payload.safety.depositsDisabled ? t("yes") : t("no")} · withdraws={payload.safety.withdrawsDisabled ? t("yes") : t("no")} · gridStarts={payload.safety.gridStartsDisabled ? t("yes") : t("no")} · profitClaims={payload.safety.profitClaimsDisabled ? t("yes") : t("no")}
	            </div>
            <div className="settingsMutedText" style={{ marginTop: 6 }}>
              {t("safetyReason", { reason: payload.safety.reason ?? t("none") })}
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("jobsTitle")}</h3>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(payload.health).map(([key, value]) => (
                <DeskSurface dense><div key={key} className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <strong>{key}</strong>
                    <StatusPill
                      label={value.enabled === false ? t("jobDisabled") : value.running ? t("jobRunning") : t("jobIdle")}
                      value={value.enabled === false ? "warning" : value.running ? "clean" : "unknown"}
                    />
                  </div>
                  <div className="settingsMutedText" style={{ marginTop: 4 }}>
                    {t("jobMeta", {
                      failed: String(value.totalFailedCycles ?? 0),
                      lagAlerts: String(value.totalLagAlerts ?? 0),
                      consecutive: String(value.consecutiveFailedCycles ?? 0)
                    })}
                  </div>
                  {value.lastError ? (
                    <div className="settingsMutedText" style={{ marginTop: 4 }}>
                      {t("jobError", { error: value.lastError, at: fmtDate(value.lastErrorAt) })}
                    </div>
                  ) : null}
                </div></DeskSurface>
              ))}
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("issuesTitle")}</h3>
            </div>
            <div className="tableWrap">
              <DeskTable className="tableCompact">
                <thead>
                  <tr>
                    <th>{t("cols.user")}</th>
                    <th>{t("cols.botVault")}</th>
                    <th>{t("cols.symbol")}</th>
                    <th>{t("cols.lifecycle")}</th>
                    <th>{t("cols.status")}</th>
                    <th>{t("cols.error")}</th>
                    <th>{t("cols.reconciled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.recentExecutionIssues.length === 0 ? (
                    <tr><td colSpan={7}>{t("noIssues")}</td></tr>
                  ) : payload.recentExecutionIssues.map((row) => (
                    <tr key={row.id}>
                      <td>{row.userEmail ?? row.userId}</td>
                      <td>{short(row.id)}</td>
                      <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
                      <td><StatusPill label={t(`lifecycle.${row.lifecycleState}`)} value={row.lifecycleState} /></td>
                      <td>{row.executionStatus ?? row.status}</td>
                      <td style={{ maxWidth: 280, whiteSpace: "normal", wordBreak: "break-word" }}>{row.executionLastError ?? "n/a"}</td>
                      <td>{fmtDate(row.lastReconciledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("laggingTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 8 }}>
              {t("laggingHint", { seconds: String(payload.thresholds.reconciliationLagAlertSeconds) })}
            </div>
            <div className="tableWrap">
              <DeskTable className="tableCompact">
                <thead>
                  <tr>
                    <th>{t("cols.user")}</th>
                    <th>{t("cols.botVault")}</th>
                    <th>{t("cols.symbol")}</th>
                    <th>{t("cols.lifecycle")}</th>
                    <th>{t("cols.status")}</th>
                    <th>{t("cols.openPositions")}</th>
                    <th>{t("cols.reconciled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.laggingVaults.length === 0 ? (
                    <tr><td colSpan={7}>{t("noLaggingVaults")}</td></tr>
                  ) : payload.laggingVaults.map((row) => (
                    <tr key={row.id}>
                      <td>{row.userEmail ?? row.userId}</td>
                      <td>{short(row.id)}</td>
                      <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
                      <td><StatusPill label={t(`lifecycle.${row.lifecycleState}`)} value={row.lifecycleState} /></td>
                      <td>{row.executionStatus ?? row.status}</td>
                      <td>{row.openPositionCount}</td>
                      <td>{fmtDate(row.lastReconciledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("actionsTitle")}</h3>
            </div>
            <div className="tableWrap">
              <DeskTable className="tableCompact">
                <thead>
                  <tr>
                    <th>{t("cols.action")}</th>
                    <th>{t("cols.user")}</th>
                    <th>{t("cols.status")}</th>
                    <th>{t("cols.txHash")}</th>
                    <th>{t("cols.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.recentOnchainActions.length === 0 ? (
                    <tr><td colSpan={5}>{t("noActions")}</td></tr>
                  ) : payload.recentOnchainActions.map((row) => (
                    <tr key={row.id}>
                      <td>{row.actionType}</td>
                      <td>{row.userEmail ?? row.userId ?? "n/a"}</td>
                      <td>{row.status}</td>
                      <td>{short(row.txHash)}</td>
                      <td>{fmtDate(row.updatedAt ?? row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DeskTable>
            </div>
          </section></DeskSurface>
        </>
      ) : null}
    </div>
  );
}
