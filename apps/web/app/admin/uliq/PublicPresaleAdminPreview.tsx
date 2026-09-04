"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
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
      onchain?: {
        owner: string;
        state: number;
        bindingStatus: string;
        inventorySourceAddress: string;
        inventoryFunded: boolean;
        inventoryUliqRaw: string;
        pendingPurchaseCount: string;
        unsoldReleasedUliqRaw: string;
        unsoldInventoryUliqRaw: string;
      };
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

type SafePreparation = {
  actionId?: string;
  safeTransaction: { chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string | null };
  safeTransactions?: Array<{ chainId: number; to: string; data: string; value: string; operation: number; expectedSender: string | null }>;
  preflight: Record<string, unknown>;
};

type ReauthAction = "schedule-save" | "schedule-prepare" | "ready-prepare" | "inventory-fund" | "inventory-release" | "inventory-record";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

function localDateTimeMin(): string {
  const date = new Date(Date.now() + 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatUliq(raw: string): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(formatUnits(BigInt(raw), 18)));
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
  const [reauthAction, setReauthAction] = useState<ReauthAction>("schedule-save");
  const [selectedRoundId, setSelectedRoundId] = useState<"round-1" | "round-2">("round-1");
  const [preparation, setPreparation] = useState<SafePreparation | null>(null);
  const [preparationLabel, setPreparationLabel] = useState<string | null>(null);
  const [inventoryActionId, setInventoryActionId] = useState<string | null>(null);
  const [inventoryActionRoundId, setInventoryActionRoundId] = useState<"round-1" | "round-2" | null>(null);
  const [inventoryExecutionHash, setInventoryExecutionHash] = useState("");
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

  async function prepareSchedule() {
    if (!data?.presaleSchedule.version) throw new Error(t("presaleScheduleNotSaved"));
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${selectedRoundId}/schedule/prepare`,
      { draftVersion: data.presaleSchedule.version }
    );
    setPreparation(response);
    setPreparationLabel(t("presaleSchedulePreparedLabel", { round: selectedRoundId === "round-1" ? 1 : 2 }));
    setNotice(t("prepared"));
    await load();
  }

  async function prepareReady() {
    if (!data?.presaleSchedule.version) throw new Error(t("presaleScheduleNotSaved"));
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${selectedRoundId}/ready/prepare`,
      { draftVersion: data.presaleSchedule.version }
    );
    setPreparation(response);
    setPreparationLabel(t("presaleReadyPreparedLabel", { round: selectedRoundId === "round-1" ? 1 : 2 }));
    setNotice(t("presaleReadyPrepared"));
  }

  async function prepareInventory(action: "fund" | "release") {
    const response = await apiPost<SafePreparation>(
      `/admin/uliq/presale-rounds/${selectedRoundId}/inventory/${action}/prepare`,
      {}
    );
    setPreparation(response);
    setPreparationLabel(t(action === "fund" ? "presaleInventoryFundingPreparedLabel" : "presaleUnsoldReleasePreparedLabel", {
      round: selectedRoundId === "round-1" ? 1 : 2
    }));
    setInventoryActionId(response.actionId ?? null);
    setInventoryActionRoundId(selectedRoundId);
    setInventoryExecutionHash("");
    setNotice(t(action === "fund" ? "presaleInventoryFundingPrepared" : "presaleUnsoldReleasePrepared"));
    await load();
  }

  async function recordInventoryExecution() {
    if (!inventoryActionId) throw new Error(t("presaleInventoryActionMissing"));
    await apiPost("/admin/uliq/presale-rounds/inventory/record-execution", {
      actionId: inventoryActionId,
      transactionHash: inventoryExecutionHash
    });
    setNotice(t("presaleInventoryExecutionRecorded"));
    await load();
  }

  function requestReauth(action: ReauthAction, roundId?: "round-1" | "round-2") {
    if (roundId) setSelectedRoundId(roundId);
    setReauthAction(action);
    setReauthOpen(true);
  }

  async function runReauthenticatedAction() {
    if (reauthAction === "schedule-save") return saveSchedule();
    if (reauthAction === "schedule-prepare") return prepareSchedule();
    if (reauthAction === "ready-prepare") return prepareReady();
    if (reauthAction === "inventory-fund") return prepareInventory("fund");
    if (reauthAction === "inventory-release") return prepareInventory("release");
    return recordInventoryExecution();
  }

  async function copyPayload() {
    if (!preparation) return;
    await navigator.clipboard.writeText(JSON.stringify(preparation, null, 2));
    setNotice(t("copied"));
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
                    {round.onchain ? (
                      <div className="adminKeyValueList">
                        <div className="adminKeyValueRow"><span>{t("ownerWallet")}</span><strong className="uliqMono">{round.onchain.owner}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventorySource")}</span><strong className="uliqMono">{round.onchain.inventorySourceAddress}</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventoryFundingStatus")}</span><AdminStatusBadge value={round.onchain.inventoryFunded ? "funded" : "not_funded"} /></div>
                        <div className="adminKeyValueRow"><span>{t("presaleInventoryBalance")}</span><strong>{formatUliq(round.onchain.inventoryUliqRaw)} ULIQ</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleUnsoldInventory")}</span><strong>{formatUliq(round.onchain.unsoldInventoryUliqRaw)} ULIQ</strong></div>
                        <div className="adminKeyValueRow"><span>{t("presaleUnsoldReleased")}</span><strong>{formatUliq(round.onchain.unsoldReleasedUliqRaw)} ULIQ</strong></div>
                      </div>
                    ) : null}
                    <div className="adminToolbarRow">
                      {round.onchain?.state === 0 && !round.onchain.inventoryFunded ? (
                        <button type="button" className="btn" onClick={() => requestReauth("inventory-fund", round.id)}>
                          <AppIcon name="funding" /> {t("presaleInventoryFundPrepareSafe")}
                        </button>
                      ) : null}
                      {round.onchain && ["DRAFT_ONLY", "DRIFTED", "PREPARED"].includes(round.onchain.bindingStatus) ? (
                        <button type="button" className="btn" onClick={() => requestReauth("schedule-prepare", round.id)} disabled={!data.presaleSchedule.version}>
                          <AppIcon name="shield" /> {t("presaleSchedulePrepareSafe")}
                        </button>
                      ) : null}
                      {round.onchain?.bindingStatus === "BOUND" && round.onchain.state === 0 ? (
                        <button type="button" className="btn" onClick={() => requestReauth("ready-prepare", round.id)} disabled={!round.onchain.inventoryFunded}>
                          <AppIcon name="shield" /> {t("presaleReadyPrepareSafe")}
                        </button>
                      ) : null}
                      {round.onchain && round.onchain.state >= 4 && round.onchain.pendingPurchaseCount === "0" && round.onchain.unsoldReleasedUliqRaw === "0" && BigInt(round.onchain.unsoldInventoryUliqRaw) > BigInt(0) ? (
                        <button type="button" className="btn" onClick={() => requestReauth("inventory-release", round.id)}>
                          <AppIcon name="wallet" /> {t("presaleUnsoldReleasePrepareSafe")}
                        </button>
                      ) : null}
                    </div>
                    {inventoryActionId && inventoryActionRoundId === round.id ? (
                      <div className="adminFormGridCompact">
                        <label className="adminFormField">
                          <span className="adminFormFieldLabel">{t("presaleInventoryExecutionHash")}</span>
                          <input className="input uliqMono" value={inventoryExecutionHash} placeholder="0x…" onChange={(event) => setInventoryExecutionHash(event.target.value.trim())} />
                        </label>
                        <button type="button" className="btn" onClick={() => requestReauth("inventory-record", round.id)} disabled={!/^0x[0-9a-fA-F]{64}$/.test(inventoryExecutionHash)}>
                          <AppIcon name="audit" /> {t("presaleInventoryRecordExecution")}
                        </button>
                      </div>
                    ) : null}
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
              onClick={() => requestReauth("schedule-save")}
              disabled={!scheduleValid || reason.trim().length < 8}
            >
              <AppIcon name="save" /> {t("presaleScheduleSave")}
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
        </>
      ) : loading ? <div className="settingsMutedText">{t("loading")}</div> : null}

      <ReauthDialog open={reauthOpen} onClose={() => setReauthOpen(false)} onVerified={runReauthenticatedAction} />
    </div>
  );
}
