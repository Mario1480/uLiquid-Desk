"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";

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

function toneForStatus(value: string): CSSProperties {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "clean" || normalized === "execution_active" || normalized === "running") {
    return { color: "#166534", background: "rgba(34, 197, 94, 0.14)", borderColor: "rgba(34, 197, 94, 0.28)" };
  }
  if (normalized === "warning" || normalized === "paused" || normalized === "settling" || normalized === "withdraw_pending") {
    return { color: "#92400e", background: "rgba(245, 158, 11, 0.14)", borderColor: "rgba(245, 158, 11, 0.28)" };
  }
  if (normalized === "blocked" || normalized === "drift_detected" || normalized === "error") {
    return { color: "#991b1b", background: "rgba(239, 68, 68, 0.14)", borderColor: "rgba(239, 68, 68, 0.28)" };
  }
  return { color: "var(--muted)", background: "rgba(148, 163, 184, 0.12)", borderColor: "rgba(148, 163, 184, 0.22)" };
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      title={label}
      style={{
        ...toneForStatus(value),
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 999,
        padding: "4px 8px",
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}
    >
      {label}
    </span>
  );
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
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn" href={withLocalePath("/admin", locale)}>
          {tCommon("backToAdmin")}
        </Link>
        <Link className="btn" href={withLocalePath("/admin/exchanges", locale)}>
          {t("openVenueHealth")}
        </Link>
        <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? t("loading") : t("refresh")}
        </button>
      </div>

      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      {payload ? (
        <>
          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("summaryTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("summaryMeta", {
                updatedAt: fmtDate(payload.updatedAt),
                mode: payload.mode,
                provider: payload.provider
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.totalVaults")}</strong><div>{payload.counts.totalBotVaults}</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.openVaults")}</strong><div>{payload.counts.openBotVaults}</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.runningExecutions")}</strong><div>{payload.counts.runningExecutions}</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.executionErrors")}</strong><div>{payload.counts.executionErrorCount}</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.pendingOnchainActions")}</strong><div>{payload.counts.pendingOnchainActions}</div></div>
              <div className="card" style={{ padding: 10 }}><strong>{t("cards.laggingVaults")}</strong><div>{payload.counts.laggingReconciliationCount}</div></div>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("lifecycleTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 10 }}>
              {t("lifecycleHint")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {lifecycleEntries.length === 0 ? (
                <div className="settingsMutedText">{t("noLifecycleData")}</div>
              ) : lifecycleEntries.map(([state, count]) => (
                <div key={state} className="card" style={{ padding: 10 }}>
                  <div style={{ marginBottom: 8 }}>
                    <StatusPill label={t(`lifecycle.${state}`)} value={state} />
                  </div>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("queueTitle")}</h3>
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
                  <div className="card" style={{ padding: 10 }}>
                    <strong>{t("queueBotTitle")}</strong>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("queueCounts", {
                        active: String(queueMetrics.botQueue?.active ?? 0),
                        waiting: String(queueMetrics.botQueue?.waiting ?? 0),
                        delayed: String(queueMetrics.botQueue?.delayed ?? 0),
                        failed: String(queueMetrics.botQueue?.failed ?? 0)
                      })}
                    </div>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <strong>{t("queueBacktestTitle")}</strong>
                    <div className="settingsMutedText" style={{ marginTop: 6 }}>
                      {t("queueCounts", {
                        active: String(queueMetrics.backtestQueue?.active ?? 0),
                        waiting: String(queueMetrics.backtestQueue?.waiting ?? 0),
                        delayed: String(queueMetrics.backtestQueue?.delayed ?? 0),
                        failed: String(queueMetrics.backtestQueue?.failed ?? 0)
                      })}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="settingsMutedText">{t("queueUnavailable")}</div>
            )}
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("reconciliationTitle")}</h3>
            </div>
            {reconciliation ? (
              <>
                <div className="settingsMutedText" style={{ marginBottom: 10 }}>
                  {t("reconciliationMeta", { updatedAt: fmtDate(reconciliation.updatedAt) })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 10 }}>
                  <div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.clean")}</strong><div>{reconciliation.counts.clean}</div></div>
                  <div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.warning")}</strong><div>{reconciliation.counts.warning}</div></div>
                  <div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.drift")}</strong><div>{reconciliation.counts.drift_detected}</div></div>
                  <div className="card" style={{ padding: 10 }}><strong>{t("reconciliationCards.blocked")}</strong><div>{reconciliation.counts.blocked}</div></div>
                </div>
                <div className="tableWrap">
                  <table className="tableCompact">
                    <thead>
                      <tr>
                        <th>{t("cols.user")}</th>
                        <th>{t("cols.botVault")}</th>
                        <th>{t("cols.symbol")}</th>
                        <th>{t("cols.lifecycle")}</th>
                        <th>{t("cols.reconciliation")}</th>
                        <th>{t("cols.drift")}</th>
                        <th>{t("cols.updated")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.items.length === 0 ? (
                        <tr><td colSpan={7}>{t("noReconciliationDrift")}</td></tr>
                      ) : reconciliation.items.map((row) => (
                        <tr key={row.id}>
                          <td>{row.userEmail ?? row.userId}</td>
                          <td>{short(row.id)}</td>
                          <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
                          <td><StatusPill label={t(`lifecycle.${row.lifecycleState}`)} value={row.lifecycleState} /></td>
                          <td><StatusPill label={t(`reconciliationStatus.${row.reconciliationStatus}`)} value={row.reconciliationStatus} /></td>
                          <td>{row.driftCount}</td>
                          <td>{fmtDate(row.reconciliationObservedAt ?? row.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="settingsMutedText">{t("reconciliationUnavailable")}</div>
            )}
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("safetyTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {t("safetyMeta", {
                halt: payload.safety.haltNewOrders ? t("yes") : t("no"),
                users: String(payload.safety.closeOnlyAllUserIds.length),
                updatedAt: fmtDate(payload.safety.updatedAt)
              })}
            </div>
            <div className="settingsMutedText" style={{ marginTop: 6 }}>
              {t("safetyReason", { reason: payload.safety.reason ?? t("none") })}
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("jobsTitle")}</h3>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(payload.health).map(([key, value]) => (
                <div key={key} className="card" style={{ padding: 10 }}>
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
                </div>
              ))}
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("issuesTitle")}</h3>
            </div>
            <div className="tableWrap">
              <table className="tableCompact">
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
              </table>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("laggingTitle")}</h3>
            </div>
            <div className="settingsMutedText" style={{ marginBottom: 8 }}>
              {t("laggingHint", { seconds: String(payload.thresholds.reconciliationLagAlertSeconds) })}
            </div>
            <div className="tableWrap">
              <table className="tableCompact">
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
              </table>
            </div>
          </section>

          <section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{t("actionsTitle")}</h3>
            </div>
            <div className="tableWrap">
              <table className="tableCompact">
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
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
