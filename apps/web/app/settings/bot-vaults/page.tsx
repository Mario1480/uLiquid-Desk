"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminConfirmDialog from "../../admin/_components/AdminConfirmDialog";
import { AppIcon } from "../../components/AppIcon";
import { Notice, PageHeader } from "../../components/ui";

type BotVaultUsageState = "in_use" | "unused" | "pending" | "error" | "settled";
type BotVaultManualEmptyActionType = "close" | "recover_closed" | null;

type BotVaultOverviewItem = {
  id: string;
  botId: string | null;
  gridInstanceId: string | null;
  vaultModel: string | null;
  contractVersion: string | null;
  onchainVaultAddress: string | null;
  agentWallet: string | null;
  usageState: BotVaultUsageState;
  manualEmptyAction: {
    type: BotVaultManualEmptyActionType;
    enabled: boolean;
    reason: string | null;
  };
  capitalUsd: number;
  residualCapitalUsd: number;
  availableUsd: number;
  allocatedUsd: number;
  principalOutstandingUsd: number;
  withdrawnUsd: number;
  claimableProfitUsd: number;
  profitShareAccruedUsd: number;
  feePaidTotal: number;
  status: string | null;
  executionStatus: string | null;
  executionLastError: string | null;
  statusCategory: string | null;
  statusReason: string | null;
  statusDetail: string | null;
  statusRecoveryHint: string | null;
  fundingDisplayStatus: string | null;
  fundingDisplayReasonCode: string | null;
  fundingDisplayDetail: string | null;
  fundingDisplayNextRecommendedAction: string | null;
  operationState: {
    step?: string | null;
    state?: string | null;
    reasonCode?: string | null;
    nextRecommendedAction?: string | null;
    updatedAt?: string | null;
  } | null;
  lifecycle: {
    state?: string | null;
    mode?: string | null;
    pendingActionType?: string | null;
    pendingActionStatus?: string | null;
    pendingActionUpdatedAt?: string | null;
  } | null;
  ownerSummary: {
    gridInstanceId?: string | null;
    gridState?: string | null;
    botId?: string | null;
    botName?: string | null;
    botStatus?: string | null;
  } | null;
  reusable: boolean;
  reuseBlockedReason: string | null;
  canClose: boolean;
  canRecover: boolean;
  hasOnchainVault: boolean;
  updatedAt: string | null;
};

type BotVaultOverviewResponse = {
  updatedAt: string;
  counts: {
    total: number;
    in_use: number;
    unused: number;
    pending: number;
    error: number;
    settled: number;
    manualEmptyAvailable: number;
  };
  totals: {
    capitalUsd: number;
    residualCapitalUsd: number;
    availableUsd: number;
    claimableProfitUsd: number;
  };
  items: BotVaultOverviewItem[];
};

type PendingManualAction = {
  item: BotVaultOverviewItem;
  type: Exclude<BotVaultManualEmptyActionType, null>;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = error.payload?.reason ? `: ${String(error.payload.reason)}` : "";
    return `${error.message}${reason} (HTTP ${error.status})`;
  }
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function shortValue(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function statusTone(state: BotVaultUsageState): "success" | "info" | "warning" | "danger" {
  if (state === "error") return "danger";
  if (state === "pending") return "warning";
  if (state === "in_use") return "info";
  return "success";
}

export default function SettingsBotVaultsPage() {
  const t = useTranslations("settings.botVaults");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overview, setOverview] = useState<BotVaultOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingManualAction, setPendingManualAction] = useState<PendingManualAction | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<BotVaultOverviewResponse>("/vaults/bot-vaults/overview");
      setOverview(payload);
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const items = overview?.items ?? [];
  const counts = overview?.counts;
  const totals = overview?.totals;
  const sortedItems = useMemo(() => {
    const order: Record<BotVaultUsageState, number> = {
      error: 0,
      pending: 1,
      in_use: 2,
      unused: 3,
      settled: 4
    };
    return [...items].sort((a, b) => {
      const stateDiff = (order[a.usageState] ?? 99) - (order[b.usageState] ?? 99);
      if (stateDiff !== 0) return stateDiff;
      return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    });
  }, [items]);

  function usageLabel(state: BotVaultUsageState): string {
    return t(`usage.${state}`);
  }

  function manualReasonLabel(reason: string | null | undefined): string {
    if (!reason) return "";
    const known = new Set(["vault_in_use", "pending_flow", "vault_not_deployed", "already_empty", "not_available"]);
    return known.has(reason) ? t(`manualReasons.${reason}`) : reason;
  }

  function manualActionLabel(type: BotVaultManualEmptyActionType): string {
    if (type === "close") return t("actions.closeAndEmpty");
    if (type === "recover_closed") return t("actions.recoverClosed");
    return t("actions.empty");
  }

  async function reconcile(item: BotVaultOverviewItem) {
    setBusyId(`reconcile:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiPost(`/vaults/bot-vaults/${encodeURIComponent(item.id)}/reconcile`, {});
      setNotice(t("messages.reconciled", { id: shortValue(item.id) }));
      await loadOverview();
    } catch (reconcileError) {
      setError(errMsg(reconcileError));
    } finally {
      setBusyId(null);
    }
  }

  async function runManualEmptyAction() {
    if (!pendingManualAction) return;
    const { item, type } = pendingManualAction;
    const actionPath = type === "close"
      ? `/vaults/bot-vaults/${encodeURIComponent(item.id)}/controller-close`
      : `/vaults/bot-vaults/${encodeURIComponent(item.id)}/controller-recover-closed`;
    setBusyId(`${type}:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiPost(actionPath, {});
      setPendingManualAction(null);
      setNotice(t("messages.manualEmptyDone", { id: shortValue(item.id) }));
      await loadOverview();
    } catch (manualError) {
      setError(errMsg(manualError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="settingsWrap settingsBotVaultPage">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={(
          <>
            <Link className="btn" href={withLocalePath("/settings", locale)}>
              <AppIcon name="back" />
              {tCommon("backToSettings")}
            </Link>
            <button className="btn" type="button" onClick={() => void loadOverview()} disabled={loading}>
              <AppIcon name="refresh" />
              {loading ? tCommon("loading") : tCommon("reload")}
            </button>
          </>
        )}
      />

      {error ? <Notice tone="danger" className="card settingsAlert settingsAlertError">{error}</Notice> : null}
      {notice ? <Notice tone="success" className="card settingsAlert settingsAlertSuccess">{notice}</Notice> : null}

      <section className="settingsHubSummary settingsBotVaultSummary" aria-label={t("summary.title")}>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-info">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.total")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-info">{t("summary.vaults")}</span>
          </div>
          <strong className="settingsSummaryValue">{loading && !counts ? tCommon("loading") : counts?.total ?? 0}</strong>
        </div>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-info">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.inUse")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-info">{usageLabel("in_use")}</span>
          </div>
          <strong className="settingsSummaryValue">{counts?.in_use ?? 0}</strong>
        </div>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-success">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.unused")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-success">{usageLabel("unused")}</span>
          </div>
          <strong className="settingsSummaryValue">{counts?.unused ?? 0}</strong>
        </div>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-danger">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.errors")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-danger">{usageLabel("error")}</span>
          </div>
          <strong className="settingsSummaryValue">{counts?.error ?? 0}</strong>
        </div>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-warning">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.capital")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-warning">{t("summary.tracked")}</span>
          </div>
          <strong className="settingsSummaryValue">{formatUsd(totals?.capitalUsd)}</strong>
          <small className="settingsSummaryMeta">{t("summary.residual", { amount: formatUsd(totals?.residualCapitalUsd) })}</small>
        </div>
        <div className="uiMetricTile settingsSummaryTile settingsSummaryTile-success">
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.manualEmpty")}</span>
            <span className="settingsSummaryBadge settingsSummaryBadge-success">{t("summary.available")}</span>
          </div>
          <strong className="settingsSummaryValue">{counts?.manualEmptyAvailable ?? 0}</strong>
          <small className="settingsSummaryMeta">{t("summary.claimable", { amount: formatUsd(totals?.claimableProfitUsd) })}</small>
        </div>
      </section>

      <section className="card settingsSection settingsBotVaultList">
        <div className="settingsSectionHeader">
          <div>
            <div className="settingsInlineTitle">{t("list.title")}</div>
            <div className="settingsMutedText">
              {overview ? t("list.updated", { date: formatDateTime(overview.updatedAt) }) : t("list.description")}
            </div>
          </div>
        </div>

        {loading && !overview ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : sortedItems.length === 0 ? (
          <div className="settingsMutedText">{t("list.empty")}</div>
        ) : (
          <div className="settingsBotVaultTable" role="table" aria-label={t("list.title")}>
            <div className="settingsBotVaultRow settingsBotVaultRowHead" role="row">
              <div role="columnheader">{t("columns.vault")}</div>
              <div role="columnheader">{t("columns.status")}</div>
              <div role="columnheader">{t("columns.capital")}</div>
              <div role="columnheader">{t("columns.flow")}</div>
              <div role="columnheader">{t("columns.actions")}</div>
            </div>
            {sortedItems.map((item) => {
              const tone = statusTone(item.usageState);
              const busy = busyId?.endsWith(`:${item.id}`) ?? false;
              const manualType = item.manualEmptyAction?.type ?? null;
              const manualEnabled = Boolean(item.manualEmptyAction?.enabled && manualType);
              const flowReason = item.statusReason
                ?? item.fundingDisplayReasonCode
                ?? item.operationState?.reasonCode
                ?? item.lifecycle?.pendingActionType
                ?? "-";
              return (
                <div className="settingsBotVaultRow" role="row" key={item.id}>
                  <div className="settingsBotVaultIdentity" role="cell">
                    <strong>{item.ownerSummary?.botName ?? shortValue(item.gridInstanceId ?? item.botId ?? item.id)}</strong>
                    <span>{shortValue(item.onchainVaultAddress)}</span>
                    <span>{item.contractVersion ? `BotVault ${String(item.contractVersion).toUpperCase()}` : item.vaultModel ?? "BotVault"}</span>
                  </div>
                  <div className="settingsBotVaultStatusCell" role="cell">
                    <span className={`settingsBotVaultBadge settingsBotVaultBadge-${tone}`}>{usageLabel(item.usageState)}</span>
                    <span className="settingsMutedText">{item.executionStatus ?? item.status ?? "-"}</span>
                  </div>
                  <div className="settingsBotVaultMoneyCell" role="cell">
                    <strong>{formatUsd(item.capitalUsd)}</strong>
                    <span>{t("money.available", { amount: formatUsd(item.availableUsd) })}</span>
                    <span>{t("money.residual", { amount: formatUsd(item.residualCapitalUsd) })}</span>
                  </div>
                  <div className="settingsBotVaultFlowCell" role="cell">
                    <strong>{flowReason}</strong>
                    <span>{item.statusRecoveryHint ?? item.fundingDisplayNextRecommendedAction ?? item.operationState?.nextRecommendedAction ?? "-"}</span>
                    {item.executionLastError ? <span className="settingsBotVaultErrorText">{item.executionLastError}</span> : null}
                  </div>
                  <div className="settingsBotVaultActions" role="cell">
                    <button className="btn" type="button" onClick={() => void reconcile(item)} disabled={busy}>
                      <AppIcon name="refresh" />
                      {t("actions.reconcile")}
                    </button>
                    <button
                      className={`btn ${manualEnabled ? "btnStop" : ""}`}
                      type="button"
                      onClick={() => manualType ? setPendingManualAction({ item, type: manualType }) : undefined}
                      disabled={!manualEnabled || busy}
                      title={manualEnabled ? manualActionLabel(manualType) : manualReasonLabel(item.manualEmptyAction?.reason)}
                    >
                      <AppIcon name={manualType === "recover_closed" ? "restore" : "withdraw"} />
                      {manualActionLabel(manualType)}
                    </button>
                    {!manualEnabled && item.manualEmptyAction?.reason ? (
                      <span className="settingsBotVaultActionHint">{manualReasonLabel(item.manualEmptyAction.reason)}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AdminConfirmDialog
        open={Boolean(pendingManualAction)}
        title={pendingManualAction ? manualActionLabel(pendingManualAction.type) : t("actions.empty")}
        description={pendingManualAction
          ? t("confirm.description", {
              id: shortValue(pendingManualAction.item.id),
              amount: formatUsd(pendingManualAction.item.residualCapitalUsd)
            })
          : ""}
        confirmLabel={pendingManualAction ? manualActionLabel(pendingManualAction.type) : t("actions.empty")}
        cancelLabel={t("actions.cancel")}
        loading={Boolean(pendingManualAction && busyId?.endsWith(`:${pendingManualAction.item.id}`))}
        onCancel={() => setPendingManualAction(null)}
        onConfirm={() => void runManualEmptyAction()}
      />
    </div>
  );
}
