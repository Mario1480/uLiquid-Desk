"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    executionStatus: string | null;
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
    updatedAt: string | null;
    lastReconciledAt: string | null;
    isFlat: boolean | null;
    openPositionCount: number;
    realizedPnlNet: number;
    netWithdrawableProfit: number;
  }>;
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

export default function AdminVaultOperationsPage() {
  const t = useTranslations("admin.vaultOperations");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<VaultOpsStatusResponse | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setError(t("messages.accessRequired"));
        setPayload(null);
        return;
      }
      const next = await apiGet<VaultOpsStatusResponse>("/admin/vault-ops/status");
      setPayload(next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="adminPageIntro">{t("subtitle")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Link className="btn" href={withLocalePath("/admin", locale)}>
          {tCommon("backToAdmin")}
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
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{key}</strong>
                    <span>{value.enabled === false ? t("jobDisabled") : value.running ? t("jobRunning") : t("jobIdle")}</span>
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
                    <th>{t("cols.status")}</th>
                    <th>{t("cols.error")}</th>
                    <th>{t("cols.reconciled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.recentExecutionIssues.length === 0 ? (
                    <tr><td colSpan={6}>{t("noIssues")}</td></tr>
                  ) : payload.recentExecutionIssues.map((row) => (
                    <tr key={row.id}>
                      <td>{row.userEmail ?? row.userId}</td>
                      <td>{short(row.id)}</td>
                      <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
                      <td>{row.executionStatus ?? "n/a"}</td>
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
                    <th>{t("cols.status")}</th>
                    <th>{t("cols.openPositions")}</th>
                    <th>{t("cols.reconciled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.laggingVaults.length === 0 ? (
                    <tr><td colSpan={6}>{t("noLaggingVaults")}</td></tr>
                  ) : payload.laggingVaults.map((row) => (
                    <tr key={row.id}>
                      <td>{row.userEmail ?? row.userId}</td>
                      <td>{short(row.id)}</td>
                      <td>{row.symbol ?? row.templateName ?? "n/a"}</td>
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
