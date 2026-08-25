"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { AppIcon } from "../../components/AppIcon";
import ReauthDialog from "../../components/ReauthDialog";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import AdminStatusBadge from "../_components/AdminStatusBadge";

type GroupedCount = { status: string; _count: { _all: number }; _sum?: Record<string, string | null> };
type AdminUliqPayload = {
  overview: {
    state: string;
    totalSoldUliqRaw: string;
    totalRaisedUsdcRaw: string;
    pendingPurchaseCount: string;
    presaleInventoryUliqRaw: string;
    vestingInventoryUliqRaw: string;
    asOfBlock: string;
    rpcSource: string;
    rpcHealth: {
      primary: string;
      secondary: string;
      finalizedHeadAgreement: boolean;
    };
  };
  treasury: {
    desiredTreasury: string | null;
    desiredUpdatedAt: string | null;
    syncStatus: string;
    integrityStatus: string;
    custodyAddress: string;
    owner: string;
    activeTreasury: string;
    pendingTreasury: string | null;
    escrowBalanceUsdcRaw: string;
    totalCollectedUsdcRaw: string;
    totalRefundedUsdcRaw: string;
    totalReleasedUsdcRaw: string;
    asOfBlock: string;
  };
  indexer: null | {
    lastProcessedBlock: string | null;
    lastProcessedBlockHash: string | null;
    lastFinalizedBlock: string | null;
    failureCount: number;
    nextRetryAt: string | null;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    lastError: string | null;
    updatedAt: string;
  };
  reconciliation: null | {
    status: string;
    mismatchCount: number;
    asOfBlock: string;
    startedAt: string;
    finishedAt: string | null;
  };
  reservations: GroupedCount[];
  price: null | {
    mode: string;
    qualityStatus: string;
    priceUsd: string;
    degradationReason: string | null;
    observedAt: string;
    validUntil: string;
  };
  stats: {
    purchases: GroupedCount[];
    vesting: { _count: { _all: number }; _sum: { allocatedRaw: string | null; releasedRaw: string | null } };
    locks: { _count: { _all: number }; _sum: { amountRaw: string | null } };
  };
  tiers: Array<{
    id: string;
    code: string;
    version: number;
    minUsdValue: string;
    subscriptionDiscountBps: number;
    aiDiscountBps: number;
  }>;
  alerts: Array<{ id: string; severity: string; status: string; message: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actorUserId: string; createdAt: string }>;
};

type SafePreparation = {
  safeTransaction: { chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string };
  preflight: Record<string, unknown>;
};

type ReauthAction = "dex-pending" | "dex" | "treasury-save" | "treasury-propose" | "treasury-accept" | "treasury-cancel";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function formatToken(raw: string | null | undefined, decimals: number, fractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: fractionDigits }).format(Number(formatUnits(BigInt(raw ?? "0"), decimals)));
  } catch {
    return "0";
  }
}

function initialDexTime(): string {
  const date = new Date(Date.now() + 15 * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function UliqAdminPage() {
  const t = useTranslations("uliq.admin");
  const locale = useLocale();
  const [data, setData] = useState<AdminUliqPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dexLaunchTime, setDexLaunchTime] = useState(initialDexTime);
  const [treasuryInput, setTreasuryInput] = useState("");
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthAction, setReauthAction] = useState<ReauthAction>("dex");
  const [preparation, setPreparation] = useState<SafePreparation | null>(null);
  const [preparationLabel, setPreparationLabel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<AdminUliqPayload>("/admin/uliq");
      setData(payload);
      setTreasuryInput(payload.treasury.desiredTreasury ?? payload.treasury.activeTreasury ?? "");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const purchaseCounts = useMemo(() => Object.fromEntries(
    (data?.stats.purchases ?? []).map((row) => [row.status, row._count._all])
  ), [data]);

  async function prepareSafeTransaction() {
    const parsed = new Date(dexLaunchTime);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now()) throw new Error("invalid_dex_launch_timestamp");
    const response = await apiPost<SafePreparation>("/admin/uliq/safe/set-dex-launch/prepare", {
      dexLaunchTimestamp: Math.floor(parsed.getTime() / 1_000).toString()
    });
    setPreparation(response);
    setPreparationLabel("setDexLaunchTimestamp");
    setNotice(t("prepared"));
  }

  async function prepareDexPending() {
    const response = await apiPost<SafePreparation>("/admin/uliq/safe/mark-dex-pending/prepare", {});
    setPreparation(response);
    setPreparationLabel("markDexPending");
    setNotice(t("prepared"));
  }

  async function saveTreasury() {
    const treasury = await apiPut<AdminUliqPayload["treasury"]>("/admin/uliq/treasury", {
      desiredAddress: treasuryInput
    });
    setData((current) => current ? { ...current, treasury } : current);
    setTreasuryInput(treasury.desiredTreasury ?? treasuryInput);
    setNotice(t("treasurySaved"));
  }

  async function prepareTreasuryAction(action: Exclude<ReauthAction, "dex" | "treasury-save">) {
    const route = {
      "treasury-propose": "/admin/uliq/treasury/propose/prepare",
      "treasury-accept": "/admin/uliq/treasury/accept/prepare",
      "treasury-cancel": "/admin/uliq/treasury/cancel/prepare"
    }[action];
    const response = await apiPost<SafePreparation>(route, {});
    setPreparation(response);
    setPreparationLabel({
      "treasury-propose": "proposeTreasury",
      "treasury-accept": "acceptTreasury",
      "treasury-cancel": "cancelTreasuryTransfer"
    }[action]);
    setNotice(t("prepared"));
  }

  function requestReauth(action: ReauthAction) {
    setReauthAction(action);
    setReauthOpen(true);
  }

  async function runReauthenticatedAction() {
    if (reauthAction === "dex-pending") return prepareDexPending();
    if (reauthAction === "dex") return prepareSafeTransaction();
    if (reauthAction === "treasury-save") return saveTreasury();
    return prepareTreasuryAction(reauthAction);
  }

  async function copyPayload() {
    if (!preparation) return;
    await navigator.clipboard.writeText(JSON.stringify(preparation, null, 2));
    setNotice(t("copied"));
  }

  return (
    <div className="adminPageStack uliqPage">
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("subtitle")} />
      <div className="adminToolbarRow">
        <AdminNotice tone="warning">{t("testnetNotice")}</AdminNotice>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <AppIcon name="refresh" /> {t("refresh")}
        </button>
      </div>
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="success" onDismiss={() => setNotice(null)}>{notice}</AdminNotice> : null}

      {data ? (
        <>
          <div className="adminStatsGrid">
            <AdminStatsCard label={t("saleState")} value={data.overview.state} hint={`#${data.overview.asOfBlock}`} />
            <AdminStatsCard label={t("sold")} value={`${formatToken(data.overview.totalSoldUliqRaw, 18, 0)} ULIQ`} />
            <AdminStatsCard label={t("pending")} value={data.overview.pendingPurchaseCount} />
            <AdminStatsCard label={t("withdrawals")} value={purchaseCounts.WITHDRAWN ?? 0} />
            <AdminStatsCard label={t("finalized")} value={purchaseCounts.FINALIZED ?? 0} />
            <AdminStatsCard label={t("activeLocks")} value={data.stats.locks._count._all} />
          </div>

          <div className="adminDetailGrid">
            <AdminDetailSection title={t("inventory")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>Presale</span><strong>{formatToken(data.overview.presaleInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>Vesting</span><strong>{formatToken(data.overview.vestingInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>{t("raised")}</span><strong>{formatToken(data.overview.totalRaisedUsdcRaw, 6)} USDC</strong></div>
                <div className="adminKeyValueRow"><span>RPC read</span><AdminStatusBadge value={data.overview.rpcSource} /></div>
                <div className="adminKeyValueRow"><span>RPC primary</span><AdminStatusBadge value={data.overview.rpcHealth.primary} /></div>
                <div className="adminKeyValueRow"><span>RPC secondary</span><AdminStatusBadge value={data.overview.rpcHealth.secondary} /></div>
                <div className="adminKeyValueRow"><span>Finalized head</span><AdminStatusBadge value={data.overview.rpcHealth.finalizedHeadAgreement ? "matched" : "mismatch"} /></div>
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("indexer")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("processedBlock")}</span><strong>{data.indexer?.lastProcessedBlock ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("finalizedBlock")}</span><strong>{data.indexer?.lastFinalizedBlock ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("failures")}</span><strong>{data.indexer?.failureCount ?? 0}</strong></div>
                <div className="adminKeyValueRow"><span>{t("lease")}</span><AdminStatusBadge value={data.indexer?.leaseOwner ? "active" : "idle"} /></div>
              </div>
              {data.indexer?.lastError ? <AdminNotice tone="warning">{data.indexer.lastError}</AdminNotice> : null}
            </AdminDetailSection>

            <AdminDetailSection title={t("reconciliation")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("status")}</span><AdminStatusBadge value={data.reconciliation?.status} /></div>
                <div className="adminKeyValueRow"><span>{t("mismatches")}</span><strong>{data.reconciliation?.mismatchCount ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("block")}</span><strong>{data.reconciliation?.asOfBlock ?? "—"}</strong></div>
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("price")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("mode")}</span><AdminStatusBadge value={data.price?.mode} /></div>
                <div className="adminKeyValueRow"><span>{t("quality")}</span><AdminStatusBadge value={data.price?.qualityStatus} /></div>
                <div className="adminKeyValueRow"><span>USD</span><strong>{data.price?.priceUsd ?? "—"}</strong></div>
              </div>
              {data.price?.degradationReason ? <AdminNotice tone="warning">{data.price.degradationReason}</AdminNotice> : null}
            </AdminDetailSection>

            <AdminDetailSection title={t("reservations")}>
              <div className="adminKeyValueList">
                {data.reservations.length ? data.reservations.map((row) => <div className="adminKeyValueRow" key={row.status}><AdminStatusBadge value={row.status} /><strong>{row._count._all}</strong></div>) : <span>—</span>}
              </div>
            </AdminDetailSection>

            <AdminDetailSection title={t("vestingStats")}>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("positions")}</span><strong>{data.stats.vesting._count._all}</strong></div>
                <div className="adminKeyValueRow"><span>{t("allocated")}</span><strong>{formatToken(data.stats.vesting._sum.allocatedRaw, 18, 0)} ULIQ</strong></div>
                <div className="adminKeyValueRow"><span>{t("released")}</span><strong>{formatToken(data.stats.vesting._sum.releasedRaw, 18, 0)} ULIQ</strong></div>
              </div>
            </AdminDetailSection>
          </div>

          <AdminDetailSection title={t("tiers")} description={t("tiersDescription")}>
            <div className="adminKeyValueList">
              {data.tiers.map((tier) => <div className="adminKeyValueRow" key={tier.id}><strong>{tier.code} · v{tier.version}</strong><span>${tier.minUsdValue} · Sub {tier.subscriptionDiscountBps / 100}% · AI {tier.aiDiscountBps / 100}%</span></div>)}
            </div>
          </AdminDetailSection>

          <AdminDetailSection title={t("treasuryTitle")} description={t("treasuryDescription")}>
            <AdminNotice tone="warning">{t("treasuryTwoStep")}</AdminNotice>
            <div className="adminDetailGrid">
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("treasurySync")}</span><AdminStatusBadge value={data.treasury.syncStatus} /></div>
                <div className="adminKeyValueRow"><span>{t("treasuryIntegrity")}</span><AdminStatusBadge value={data.treasury.integrityStatus} /></div>
                <div className="adminKeyValueRow"><span>{t("treasuryActive")}</span><strong className="uliqMono">{data.treasury.activeTreasury}</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryPending")}</span><strong className="uliqMono">{data.treasury.pendingTreasury ?? "—"}</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryOwner")}</span><strong className="uliqMono">{data.treasury.owner}</strong></div>
              </div>
              <div className="adminKeyValueList">
                <div className="adminKeyValueRow"><span>{t("escrowBalance")}</span><strong>{formatToken(data.treasury.escrowBalanceUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryCollected")}</span><strong>{formatToken(data.treasury.totalCollectedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryRefunded")}</span><strong>{formatToken(data.treasury.totalRefundedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("treasuryReleased")}</span><strong>{formatToken(data.treasury.totalReleasedUsdcRaw, 6)} tUSDC</strong></div>
                <div className="adminKeyValueRow"><span>{t("block")}</span><strong>#{data.treasury.asOfBlock}</strong></div>
              </div>
            </div>
            <div className="adminFormGridCompact">
              <label className="adminFormField">
                <span className="adminFormFieldLabel">{t("treasuryDesired")}</span>
                <input className="input uliqMono" value={treasuryInput} onChange={(event) => setTreasuryInput(event.target.value.trim())} placeholder="0x…" />
                <span className="adminFormFieldHint">{t("treasuryDesiredHint")}</span>
              </label>
            </div>
            <div className="adminToolbarRow">
              <button type="button" className="btn btnPrimary" onClick={() => requestReauth("treasury-save")} disabled={!treasuryInput}>
                <AppIcon name="save" /> {t("treasurySave")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-propose")} disabled={data.treasury.syncStatus !== "proposal_required"}>
                <AppIcon name="send" /> {t("treasuryPropose")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-accept")} disabled={data.treasury.syncStatus !== "acceptance_required"}>
                <AppIcon name="check" /> {t("treasuryAccept")}
              </button>
              <button type="button" className="btn" onClick={() => requestReauth("treasury-cancel")} disabled={!data.treasury.pendingTreasury}>
                <AppIcon name="cancel" /> {t("treasuryCancel")}
              </button>
            </div>
          </AdminDetailSection>

          <AdminDetailSection title={t("dexPendingTitle")} description={t("dexPendingDescription")}>
            <div className="adminKeyValueList">
              <div className="adminKeyValueRow"><span>{t("saleState")}</span><AdminStatusBadge value={data.overview.state} /></div>
              <div className="adminKeyValueRow"><span>{t("pending")}</span><strong>{data.overview.pendingPurchaseCount}</strong></div>
              <div className="adminKeyValueRow"><span>{t("presaleInventory")}</span><strong>{formatToken(data.overview.presaleInventoryUliqRaw, 18, 0)} ULIQ</strong></div>
            </div>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => requestReauth("dex-pending")}
              disabled={data.overview.state !== "ENDED" || data.overview.pendingPurchaseCount !== "0"}
            >
              <AppIcon name="launch" /> {t("dexPendingPrepare")}
            </button>
          </AdminDetailSection>

          <AdminDetailSection title={t("safeTitle")} description={t("safeDescription")}>
            <div className="adminFormGridCompact">
              <label className="adminFormField">
                <span className="adminFormFieldLabel">{t("timestamp")}</span>
                <input className="input" type="datetime-local" value={dexLaunchTime} onChange={(event) => setDexLaunchTime(event.target.value)} />
                <span className="adminFormFieldHint">{t("fourEyes")}</span>
              </label>
            </div>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => requestReauth("dex")}
              disabled={!dexLaunchTime || data.overview.state !== "DEX_PENDING" || data.overview.pendingPurchaseCount !== "0"}
            >
              <AppIcon name="shield" /> {t("prepare")}
            </button>
          </AdminDetailSection>

          <AdminDetailSection title={t("payload")} description={preparationLabel ?? undefined}>
            {preparation ? (
              <>
                <pre className="card uliqAdminPayload uliqMono">{JSON.stringify(preparation, null, 2)}</pre>
                <button type="button" className="btn" onClick={() => void copyPayload()}><AppIcon name="copy" /> {t("copy")}</button>
              </>
            ) : <div className="settingsMutedText">{t("noPayload")}</div>}
          </AdminDetailSection>

          <div className="adminDetailGrid">
            <AdminDetailSection title={t("alerts")}>
              <div className="adminListStack">{data.alerts.length ? data.alerts.map((alert) => <div className="adminKeyValueRow" key={alert.id}><span>{alert.message}</span><AdminStatusBadge value={alert.status} label={alert.severity} /></div>) : <span>—</span>}</div>
            </AdminDetailSection>
            <AdminDetailSection title={t("audit")}>
              <div className="adminListStack">{data.audit.length ? data.audit.map((event) => <div className="adminKeyValueRow" key={event.id}><span>{event.action}</span><small>{new Date(event.createdAt).toLocaleString(locale)}</small></div>) : <span>—</span>}</div>
            </AdminDetailSection>
          </div>
        </>
      ) : loading ? <div className="settingsMutedText">Loading…</div> : null}

      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onVerified={runReauthenticatedAction}
      />
    </div>
  );
}
