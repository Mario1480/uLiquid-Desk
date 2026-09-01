"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPut } from "../../../lib/api";
import {
  isUliqPresaleScheduleValid,
  presaleScheduleIsoToLocalValue,
  presaleScheduleLocalValueToIso,
  type UliqPresaleScheduleDraft
} from "../../../src/uliq/presaleSchedule";
import { AppIcon } from "../../components/AppIcon";
import ReauthDialog from "../../components/ReauthDialog";
import AdminDetailSection from "../_components/AdminDetailSection";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";
import AdminStatsCard from "../_components/AdminStatsCard";
import AdminStatusBadge from "../_components/AdminStatusBadge";

type PublicPresaleAdminPayload = {
  mode: "CONFIGURATION_PENDING";
  presaleSchedule: {
    version: number;
    status: "NOT_CONFIGURED" | "DRAFT_CONFIGURED" | "INVALID";
    onchainStatus: string;
    updatedAt: string | null;
    rounds: Array<{
      id: "round-1" | "round-2";
      number: number;
      allocationUliq: string;
      priceUsdcPerUliq: string;
      hardCapUsdc: string;
      minPurchaseUsdc: string;
      maxPurchaseUsdc: string;
      initialUnlockBps: number;
      cliffMonths: number;
      vestingMonths: number;
      predecessorRoundId: "round-1" | null;
      saleStart: string | null;
      saleEnd: string | null;
    }>;
  };
  readiness: {
    publicPreviewEnabled: boolean;
    apiReadsEnabled: boolean;
    contractsConfigured: boolean;
    purchasesEnabled: boolean;
    mainnetApproved: boolean;
    legalApproved: boolean;
  };
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function localDateTimeMin(): string {
  const date = new Date(Date.now() + 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function PublicPresaleAdminPreview() {
  const t = useTranslations("uliq.admin");
  const locale = useLocale();
  const [data, setData] = useState<PublicPresaleAdminPayload | null>(null);
  const [drafts, setDrafts] = useState<UliqPresaleScheduleDraft[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const scheduleValid = useMemo(() => isUliqPresaleScheduleValid(drafts), [drafts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<PublicPresaleAdminPayload>("/admin/uliq/public-presale");
      setData(payload);
      setDrafts(payload.presaleSchedule.rounds.map((round) => ({
        id: round.id,
        saleStart: presaleScheduleIsoToLocalValue(round.saleStart),
        saleEnd: presaleScheduleIsoToLocalValue(round.saleEnd)
      })));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveSchedule() {
    if (!scheduleValid) throw new Error(t("presaleScheduleInvalid"));
    const presaleSchedule = await apiPut<PublicPresaleAdminPayload["presaleSchedule"]>("/admin/uliq/presale-rounds/schedule", {
      reason,
      rounds: drafts.map((round) => ({
        id: round.id,
        saleStart: presaleScheduleLocalValueToIso(round.saleStart),
        saleEnd: presaleScheduleLocalValueToIso(round.saleEnd)
      }))
    });
    setData((current) => current ? { ...current, presaleSchedule } : current);
    setReason("");
    setNotice(t("presaleScheduleSaved", { version: presaleSchedule.version }));
  }

  return (
    <div className="adminPageStack uliqPage">
      <AdminPageHeader eyebrow={t("productionEyebrow")} title={t("productionTitle")} description={t("productionSubtitle")} />
      <div className="adminToolbarRow">
        <AdminNotice tone="warning">{t("productionPendingNotice")}</AdminNotice>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <AppIcon name="refresh" /> {t("refresh")}
        </button>
      </div>
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="success" onDismiss={() => setNotice(null)}>{notice}</AdminNotice> : null}

      {data ? (
        <>
          <div className="adminStatsGrid">
            <AdminStatsCard label={t("publicPreviewStatus")} value={data.readiness.publicPreviewEnabled ? t("visible") : t("hidden")} />
            <AdminStatsCard label={t("contractsStatus")} value={data.readiness.contractsConfigured ? t("configured") : t("pendingConfiguration")} />
            <AdminStatsCard label={t("apiReadsStatus")} value={data.readiness.apiReadsEnabled ? t("enabled") : t("disabled")} />
            <AdminStatsCard label={t("purchasesStatus")} value={data.readiness.purchasesEnabled ? t("enabled") : t("disabled")} />
            <AdminStatsCard label={t("mainnetApprovalStatus")} value={data.readiness.mainnetApproved ? t("approved") : t("notApproved")} />
            <AdminStatsCard label={t("legalApprovalStatus")} value={data.readiness.legalApproved ? t("approved") : t("notApproved")} />
          </div>

          <AdminDetailSection title={t("presaleScheduleTitle")} description={t("presaleScheduleDescription")}>
            <div className="adminToolbarRow">
              <AdminStatusBadge value={data.presaleSchedule.status} />
              <AdminStatusBadge value={data.presaleSchedule.onchainStatus} />
              <span className="settingsMutedText">
                {data.presaleSchedule.updatedAt
                  ? t("presaleScheduleUpdated", { date: new Date(data.presaleSchedule.updatedAt).toLocaleString(locale), version: data.presaleSchedule.version })
                  : t("presaleScheduleNotSaved")}
              </span>
            </div>
            <AdminNotice tone="info">{t("presaleScheduleBackendNotice")}</AdminNotice>
            <div className="uliqAdminRoundList">
              {data.presaleSchedule.rounds.map((round) => {
                const draft = drafts.find((item) => item.id === round.id) ?? { id: round.id, saleStart: "", saleEnd: "" };
                return (
                  <div className="uliqAdminRoundRow" key={round.id}>
                    <div className="uliqAdminRoundHeader">
                      <div>
                        <strong>{t("presaleRound", { number: round.number })}</strong>
                        <small>{round.predecessorRoundId ? t("presaleRoundPredecessor") : t("presaleRoundIndependent")}</small>
                      </div>
                      <AdminStatusBadge value={draft.saleStart && draft.saleEnd ? "configured" : "missing"} />
                    </div>
                    <div className="uliqAdminRoundParameters">
                      <div><span>{t("presaleAllocation")}</span><strong>{Number(round.allocationUliq).toLocaleString(locale)} ULIQ</strong></div>
                      <div><span>{t("presalePrice")}</span><strong>{round.priceUsdcPerUliq} USDC</strong></div>
                      <div><span>{t("presaleHardCap")}</span><strong>{Number(round.hardCapUsdc).toLocaleString(locale)} USDC</strong></div>
                      <div><span>{t("presaleBuyerLimits")}</span><strong>{Number(round.minPurchaseUsdc).toLocaleString(locale)}–{Number(round.maxPurchaseUsdc).toLocaleString(locale)} USDC</strong></div>
                      <div><span>{t("presaleUnlock")}</span><strong>{round.initialUnlockBps / 100}%</strong></div>
                      <div><span>{t("presaleVesting")}</span><strong>{round.cliffMonths ? t("presaleVestingWithCliff", { cliff: round.cliffMonths, vesting: round.vestingMonths }) : t("presaleVestingWithoutCliff", { vesting: round.vestingMonths })}</strong></div>
                    </div>
                    <div className="adminFormGridCompact">
                      <label className="adminFormField">
                        <span className="adminFormFieldLabel">{t("presaleStart")}</span>
                        <input
                          className="input"
                          type="datetime-local"
                          min={localDateTimeMin()}
                          value={draft.saleStart}
                          onChange={(event) => setDrafts((current) => current.map((item) => item.id === round.id ? { ...item, saleStart: event.target.value } : item))}
                        />
                      </label>
                      <label className="adminFormField">
                        <span className="adminFormFieldLabel">{t("presaleEnd")}</span>
                        <input
                          className="input"
                          type="datetime-local"
                          min={draft.saleStart || localDateTimeMin()}
                          value={draft.saleEnd}
                          onChange={(event) => setDrafts((current) => current.map((item) => item.id === round.id ? { ...item, saleEnd: event.target.value } : item))}
                        />
                      </label>
                    </div>
                    {draft.saleStart && draft.saleEnd && new Date(draft.saleStart).getTime() >= new Date(draft.saleEnd).getTime()
                      ? <AdminNotice tone="danger">{t("presaleRoundEndAfterStart")}</AdminNotice>
                      : null}
                  </div>
                );
              })}
            </div>
            <label className="adminFormField">
              <span className="adminFormFieldLabel">{t("presaleScheduleReason")}</span>
              <input
                className="input"
                value={reason}
                maxLength={500}
                placeholder={t("presaleScheduleReasonPlaceholder")}
                onChange={(event) => setReason(event.target.value)}
              />
              <span className="adminFormFieldHint">{t("presaleScheduleReasonProgress", { count: reason.trim().length })}</span>
            </label>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => setReauthOpen(true)}
              disabled={!scheduleValid || reason.trim().length < 8}
            >
              <AppIcon name="save" /> {t("presaleScheduleSave")}
            </button>
          </AdminDetailSection>
        </>
      ) : loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      <ReauthDialog open={reauthOpen} onClose={() => setReauthOpen(false)} onVerified={saveSchedule} />
    </div>
  );
}
