"use client";

import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isAddress } from "viem";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";
import { normalizeNonNegativeBillingInteger } from "../../../src/billing/adminPackageValues";
import ReauthDialog from "../../components/ReauthDialog";
import AdminActionButton from "../_components/AdminActionButton";
import AdminConfirmDialog from "../_components/AdminConfirmDialog";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";

type BillingAddonType =
  | "running_bots"
  | "running_predictions_ai"
  | "running_predictions_composite"
  | "ai_credits";

type BillingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "plan" | "addon";
  addonType: BillingAddonType | null;
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  billingMonths: number;
  plan: "free" | "pro" | "premium" | null;
  maxExchangeAccounts: number | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiCredits: string;
  aiCredits: string;
  deltaRunningBots: number | null;
  deltaRunningPredictionsAi: number | null;
  deltaRunningPredictionsComposite: number | null;
};

type BillingPackagesResponse = {
  items: BillingPackage[];
};

type BillingFeatureFlagsResponse = {
  billingEnabled: boolean;
  aiCreditBillingEnabled: boolean;
  source: "db" | "default";
  updatedAt: string | null;
  defaults: {
    billingEnabled: boolean;
    aiCreditBillingEnabled: boolean;
  };
};

type BillingPaymentConfigResponse = {
  configured: boolean;
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number;
  treasuryAddress: string | null;
  revision: number | null;
  confirmationsRequired: number;
  rpc: {
    ready: boolean;
    lastBlockNumber: string | number | null;
    lastCheckedAt: string | null;
    error: string | null;
  };
};

type PackageDraft = {
  code: string;
  name: string;
  description: string;
  kind: "plan" | "addon";
  addonType: BillingAddonType | "";
  isActive: boolean;
  sortOrder: number;
  priceCents: number;
  billingMonths: number;
  plan: "free" | "pro" | "premium" | "";
  maxExchangeAccounts: number | "";
  maxRunningBots: number | "";
  maxRunningPredictionsAi: number | "";
  maxRunningPredictionsComposite: number | "";
  allowedExchanges: string;
  monthlyAiCredits: string;
  aiCredits: string;
  deltaRunningBots: number | "";
  deltaRunningPredictionsAi: number | "";
  deltaRunningPredictionsComposite: number | "";
};

const INTEGER_DELTA_PATTERN = /^-?\d+$/;

function formatBillingCredits(value: string, locale: string): string {
  try {
    return BigInt(value || "0").toLocaleString(locale);
  } catch {
    return value || "0";
  }
}

function formatBillingPrice(priceCents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD"
  }).format(priceCents / 100);
}

function toDraft(pkg: BillingPackage): PackageDraft {
  return {
    code: pkg.code,
    name: pkg.name,
    description: pkg.description ?? "",
    kind: pkg.kind,
    addonType: pkg.addonType ?? "",
    isActive: pkg.isActive,
    sortOrder: pkg.sortOrder,
    priceCents: pkg.priceCents,
    billingMonths: pkg.billingMonths,
    plan: pkg.plan ?? "",
    maxExchangeAccounts: pkg.maxExchangeAccounts ?? "",
    maxRunningBots: pkg.maxRunningBots ?? "",
    maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? "",
    maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? "",
    allowedExchanges: (pkg.allowedExchanges ?? ["*"]).join(","),
    monthlyAiCredits: pkg.monthlyAiCredits ?? "0",
    aiCredits: pkg.aiCredits ?? "0",
    deltaRunningBots: pkg.deltaRunningBots ?? "",
    deltaRunningPredictionsAi: pkg.deltaRunningPredictionsAi ?? "",
    deltaRunningPredictionsComposite: pkg.deltaRunningPredictionsComposite ?? ""
  };
}

function emptyDraft(): PackageDraft {
  return {
    code: "",
    name: "",
    description: "",
    kind: "plan",
    addonType: "",
    isActive: true,
    sortOrder: 0,
    priceCents: 2900,
    billingMonths: 1,
    plan: "pro",
    maxExchangeAccounts: "",
    maxRunningBots: 5,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2,
    allowedExchanges: "*",
    monthlyAiCredits: "10000",
    aiCredits: "0",
    deltaRunningBots: "",
    deltaRunningPredictionsAi: "",
    deltaRunningPredictionsComposite: ""
  };
}

function toNonNegativeInt(value: number | "" | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

function buildPayload(draft: PackageDraft) {
  const isPlan = draft.kind === "plan";
  const addonType = isPlan ? null : (draft.addonType || null);
  const allowedExchanges = draft.allowedExchanges
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    kind: draft.kind,
    addonType,
    isActive: draft.isActive,
    sortOrder: Number(draft.sortOrder) || 0,
    priceCents: Number(draft.priceCents) || 0,
    billingMonths: Number(draft.billingMonths) || 1,
    plan: isPlan ? (draft.plan || null) : null,
    maxExchangeAccounts: isPlan ? toNonNegativeInt(draft.maxExchangeAccounts) : null,
    maxRunningBots: isPlan ? toNonNegativeInt(draft.maxRunningBots) : null,
    maxRunningPredictionsAi: isPlan ? toNonNegativeInt(draft.maxRunningPredictionsAi) : null,
    maxRunningPredictionsComposite: isPlan
      ? toNonNegativeInt(draft.maxRunningPredictionsComposite)
      : null,
    allowedExchanges: isPlan ? (allowedExchanges.length > 0 ? allowedExchanges : ["*"]) : ["*"],
    monthlyAiCredits: normalizeNonNegativeBillingInteger(isPlan ? draft.monthlyAiCredits : "0"),
    aiCredits: normalizeNonNegativeBillingInteger(
      !isPlan && addonType === "ai_credits" ? draft.aiCredits : "0"
    ),
    deltaRunningBots:
      !isPlan && addonType === "running_bots"
        ? toNonNegativeInt(draft.deltaRunningBots)
        : null,
    deltaRunningPredictionsAi:
      !isPlan && addonType === "running_predictions_ai"
        ? toNonNegativeInt(draft.deltaRunningPredictionsAi)
        : null,
    deltaRunningPredictionsComposite:
      !isPlan && addonType === "running_predictions_composite"
        ? toNonNegativeInt(draft.deltaRunningPredictionsComposite)
        : null,
    meta: null
  };
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

function isReauthRequired(error: unknown): boolean {
  return error instanceof ApiError
    && error.status === 401
    && error.payload?.error === "REAUTH_REQUIRED";
}

export default function AdminBillingPage() {
  const t = useTranslations("admin.billing");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [items, setItems] = useState<BillingPackage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PackageDraft>>({});
  const [createDraft, setCreateDraft] = useState<PackageDraft>(emptyDraft());
  const [adjustUserLookup, setAdjustUserLookup] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("0");
  const [adjustNote, setAdjustNote] = useState("");
  const [featureFlags, setFeatureFlags] = useState<BillingFeatureFlagsResponse | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [aiCreditBillingEnabled, setAiCreditBillingEnabled] = useState(true);
  const [paymentConfig, setPaymentConfig] = useState<BillingPaymentConfigResponse | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [treasuryAddressConfirmation, setTreasuryAddressConfirmation] = useState("");
  const [reauthAction, setReauthAction] = useState<"payment-config" | "feature-flags" | null>(null);
  const [featureFlagsConfirmOpen, setFeatureFlagsConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [openTool, setOpenTool] = useState<"create" | "credits" | null>(null);
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);
  const canAdjustCredits = Boolean(
    adjustUserLookup.trim()
      && INTEGER_DELTA_PATTERN.test(adjustDelta.trim())
      && adjustNote.trim()
  );

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const [payload, flags, config] = await Promise.all([
        apiGet<BillingPackagesResponse>("/admin/billing/packages"),
        apiGet<BillingFeatureFlagsResponse>("/admin/settings/billing"),
        apiGet<BillingPaymentConfigResponse>("/admin/billing/payment-config").catch(() => null)
      ]);
      setItems(payload.items ?? []);
      setFeatureFlags(flags);
      setBillingEnabled(Boolean(flags.billingEnabled));
      setAiCreditBillingEnabled(Boolean(flags.aiCreditBillingEnabled));
      setPaymentConfig(config);
      setTreasuryAddress(config?.treasuryAddress ?? "");
      setTreasuryAddressConfirmation("");
      const nextDrafts: Record<string, PackageDraft> = {};
      for (const item of payload.items ?? []) {
        nextDrafts[item.id] = toDraft(item);
      }
      setDrafts(nextDrafts);
      setExpandedPackageId((current) => current && (payload.items ?? []).some((item) => item.id === current) ? current : null);
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createPackage() {
    setSavingId("new");
    setMsg(null);
    try {
      await apiPost("/admin/billing/packages", buildPayload(createDraft));
      setCreateDraft(emptyDraft());
      setOpenTool(null);
      await load();
      setMsg(t("saved"));
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  async function savePackage(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setMsg(null);
    try {
      await apiPut(`/admin/billing/packages/${id}`, buildPayload(draft));
      await load();
      setMsg(t("saved"));
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  async function deletePackage(id: string) {
    setPendingDeleteId(null);
    setSavingId(id);
    setMsg(null);
    try {
      await apiDelete(`/admin/billing/packages/${id}`);
      setExpandedPackageId((current) => current === id ? null : current);
      await load();
      setMsg(t("deleted"));
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  async function adjustCredits() {
    const userLookup = adjustUserLookup.trim();
    const deltaCredits = adjustDelta.trim();
    const note = adjustNote.trim();
    if (!userLookup || !INTEGER_DELTA_PATTERN.test(deltaCredits) || !note) {
      setMsg(t("adjustInvalid"));
      return;
    }
    setSavingId("adjust");
    setMsg(null);
    try {
      await apiPost(`/admin/billing/users/${encodeURIComponent(userLookup)}/credits/adjust`, {
        deltaCredits,
        note
      });
      setMsg(t("adjusted"));
      setAdjustDelta("0");
      setAdjustNote("");
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  async function persistFeatureFlags() {
    const saved = await apiPut<BillingFeatureFlagsResponse>("/admin/settings/billing", {
      billingEnabled,
      aiCreditBillingEnabled
    });
    setFeatureFlags(saved);
    setBillingEnabled(Boolean(saved.billingEnabled));
    setAiCreditBillingEnabled(Boolean(saved.aiCreditBillingEnabled));
    setMsg(t("featureFlags.saved"));
  }

  async function saveFeatureFlags() {
    setFeatureFlagsConfirmOpen(false);
    setSavingId("flags");
    setMsg(null);
    try {
      await persistFeatureFlags();
    } catch (error) {
      if (isReauthRequired(error)) setReauthAction("feature-flags");
      else setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  function requestSaveFeatureFlags() {
    if (billingEnabled && featureFlags?.billingEnabled !== true) {
      setFeatureFlagsConfirmOpen(true);
      return;
    }
    void saveFeatureFlags();
  }

  function validateTreasuryInputs(): boolean {
    const address = treasuryAddress.trim();
    const confirmation = treasuryAddressConfirmation.trim();
    if (!isAddress(address)) {
      setMsg(t("paymentConfig.errors.invalidAddress"));
      return false;
    }
    if (address !== confirmation) {
      setMsg(t("paymentConfig.errors.confirmationMismatch"));
      return false;
    }
    return true;
  }

  async function persistPaymentConfig() {
    const saved = await apiPut<BillingPaymentConfigResponse>("/admin/billing/payment-config", {
      treasuryAddress: treasuryAddress.trim(),
      confirmTreasuryAddress: treasuryAddressConfirmation.trim()
    });
    setPaymentConfig(saved);
    setTreasuryAddress(saved.treasuryAddress ?? treasuryAddress.trim());
    setTreasuryAddressConfirmation("");
    setMsg(t("paymentConfig.saved"));
  }

  async function savePaymentConfig() {
    if (!validateTreasuryInputs()) return;
    setSavingId("payment-config");
    setMsg(null);
    try {
      await persistPaymentConfig();
    } catch (error) {
      if (isReauthRequired(error)) {
        setReauthAction("payment-config");
      } else {
        setMsg(errMsg(error));
      }
    } finally {
      setSavingId(null);
    }
  }

  const planItems = items.filter((item) => item.kind === "plan");
  const addonItems = items.filter((item) => item.kind === "addon");
  const activePackageCount = items.filter((item) => item.isActive).length;

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Billing"
        title={t("title")}
        description={t("description")}
      />

      {msg ? <AdminNotice tone="info">{msg}</AdminNotice> : null}

      <div className="billingAdminConfigGrid">
        <DeskSurface dense><section className="card settingsSection adminInlineForm billingAdminPaymentPanel">
          <div className="settingsSectionHeader">
            <div>
              <h3 className="adminSubsectionTitle">{t("paymentConfig.title")}</h3>
              <div className="adminSectionDescription">{t("paymentConfig.description")}</div>
            </div>
            <span className={`uiStatusBadge ${paymentConfig?.configured && paymentConfig.rpc?.ready ? "uiStatusBadge-success" : "uiStatusBadge-warning"}`}>
              {paymentConfig?.configured && paymentConfig.rpc?.ready ? t("paymentConfig.ready") : t("paymentConfig.notReady")}
            </span>
          </div>
          <div className="adminChoiceGrid">
            <FormField label={t("paymentConfig.treasuryAddress")} hint={t("paymentConfig.treasuryHint")}>
              <DeskInput className="input subscriptionMono" value={treasuryAddress} onChange={(event) => setTreasuryAddress(event.target.value)} placeholder="0x..." autoComplete="off" spellCheck={false} />
            </FormField>
            <FormField label={t("paymentConfig.confirmTreasuryAddress")} hint={t("paymentConfig.confirmTreasuryHint")}>
              <DeskInput className="input subscriptionMono" value={treasuryAddressConfirmation} onChange={(event) => setTreasuryAddressConfirmation(event.target.value)} placeholder="0x..." autoComplete="off" spellCheck={false} />
            </FormField>
          </div>
          <div className="billingPaymentMetrics">
            <div className="miniMetric"><span>{t("paymentConfig.chain")}</span><b>{paymentConfig?.chainId ?? 42161}</b></div>
            <div className="miniMetric"><span>{t("paymentConfig.token")}</span><b className="subscriptionMono">{paymentConfig?.tokenAddress ?? "-"}</b></div>
            <div className="miniMetric"><span>{t("paymentConfig.confirmations")}</span><b>{paymentConfig?.confirmationsRequired ?? 12}</b></div>
            <div className="miniMetric"><span>{t("paymentConfig.revision")}</span><b>{paymentConfig?.revision ?? "-"}</b></div>
            <div className="miniMetric"><span>{t("paymentConfig.lastBlock")}</span><b>{paymentConfig?.rpc?.lastBlockNumber ?? "-"}</b></div>
            <div className="miniMetric"><span>{t("paymentConfig.lastChecked")}</span><b>{paymentConfig?.rpc?.lastCheckedAt ? new Date(paymentConfig.rpc.lastCheckedAt).toLocaleString(locale) : "-"}</b></div>
          </div>
          {paymentConfig?.rpc?.error ? <AdminNotice tone="warning">{paymentConfig.rpc.error}</AdminNotice> : null}
          <AdminActionButton className="billingSectionAction" icon="save" variant="primary" onClick={() => void savePaymentConfig()} loading={savingId === "payment-config"} loadingLabel={tCommon("saving")}>
            {t("paymentConfig.save")}
          </AdminActionButton>
        </section></DeskSurface>

        <DeskSurface dense><section className="card settingsSection adminInlineForm billingAdminFlagsPanel">
          <div className="settingsSectionHeader">
            <div>
              <h3 className="adminSubsectionTitle">{t("featureFlags.title")}</h3>
              <div className="adminSectionDescription">{t("featureFlags.description")}</div>
            </div>
          </div>
          <div className="settingsMutedText">
            {t("featureFlags.source")}: {featureFlags?.source ?? "default"} · {t("featureFlags.updatedAt")}: {featureFlags?.updatedAt ? new Date(featureFlags.updatedAt).toLocaleString(locale) : t("featureFlags.never")}
          </div>
          <div className="billingFeatureToggleList">
            <label className="billingFeatureToggle">
              <span><strong>{t("featureFlags.billingEnabled.label")}</strong><small>{t("featureFlags.billingEnabled.hint")}</small></span>
              <DeskInput type="checkbox" checked={billingEnabled} onChange={(event) => setBillingEnabled(event.target.checked)} aria-label={t("featureFlags.billingEnabled.label")} />
            </label>
            <label className="billingFeatureToggle">
              <span><strong>{t("featureFlags.aiCreditBillingEnabled.label")}</strong><small>{t("featureFlags.aiCreditBillingEnabled.hint")}</small></span>
              <DeskInput type="checkbox" checked={aiCreditBillingEnabled} onChange={(event) => setAiCreditBillingEnabled(event.target.checked)} aria-label={t("featureFlags.aiCreditBillingEnabled.label")} />
            </label>
          </div>
          <AdminActionButton className="billingSectionAction" icon="save" variant="primary" onClick={requestSaveFeatureFlags} loading={savingId === "flags"} loadingLabel={tCommon("saving")}>
            {t("featureFlags.save")}
          </AdminActionButton>
        </section></DeskSurface>
      </div>

      <DeskSurface dense><section className="card settingsSection billingPackagesSection">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("listTitle")}</h3>
            <div className="adminSectionDescription">{t("packageSummary.description")}</div>
          </div>
          <AdminActionButton icon="refresh" onClick={load} loading={loading}>{t("refresh")}</AdminActionButton>
        </div>
        <div className="billingPackageStats">
          <div className="miniMetric"><span>{t("packageSummary.total")}</span><b>{items.length}</b></div>
          <div className="miniMetric"><span>{t("packageSummary.active")}</span><b>{activePackageCount}</b></div>
          <div className="miniMetric"><span>{t("packageSummary.plans")}</span><b>{planItems.length}</b></div>
          <div className="miniMetric"><span>{t("packageSummary.addons")}</span><b>{addonItems.length}</b></div>
        </div>
        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : items.length === 0 ? (
          <div className="uiEmptyState">{t("packageSummary.empty")}</div>
        ) : (
          <div className="billingPackageGroups">
            <PackageGroup title={t("packageSummary.planGroup")} items={planItems} drafts={drafts} expandedPackageId={expandedPackageId} savingId={savingId} locale={locale} onToggle={setExpandedPackageId} onDraftChange={(id, next) => setDrafts((current) => ({ ...current, [id]: next }))} onSave={savePackage} onDelete={setPendingDeleteId} />
            <PackageGroup title={t("packageSummary.addonGroup")} items={addonItems} drafts={drafts} expandedPackageId={expandedPackageId} savingId={savingId} locale={locale} onToggle={setExpandedPackageId} onDraftChange={(id, next) => setDrafts((current) => ({ ...current, [id]: next }))} onSave={savePackage} onDelete={setPendingDeleteId} />
          </div>
        )}
      </section></DeskSurface>

      <section className="billingPackageTools">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("packageTools.title")}</h3>
            <div className="adminSectionDescription">{t("packageTools.description")}</div>
          </div>
        </div>
        <div className="billingPackageToolGrid">
          <DeskSurface dense><article className={`card settingsSection billingPackageToolCard ${openTool === "create" ? "billingPackageToolCardOpen" : ""}`}>
            <div className="settingsSectionHeader">
              <div><h4 className="adminSubsectionTitle">{t("createTitle")}</h4><div className="adminSectionDescription">{t("createHelp")}</div></div>
              <AdminActionButton icon={openTool === "create" ? "close" : "create"} variant={openTool === "create" ? "secondary" : "primary"} aria-expanded={openTool === "create"} onClick={() => setOpenTool((current) => current === "create" ? null : "create")}>
                {openTool === "create" ? t("packageTools.close") : t("packageTools.openCreate")}
              </AdminActionButton>
            </div>
            {openTool === "create" ? (
              <div className="billingPackageToolBody">
                <div className="settingsMutedText">{t("packageTools.usdFixed")}</div>
                <PackageForm draft={createDraft} setDraft={setCreateDraft} />
                <AdminActionButton className="billingSectionAction" icon="create" variant="primary" onClick={createPackage} loading={savingId === "new"} loadingLabel={tCommon("saving")}>{t("create")}</AdminActionButton>
              </div>
            ) : null}
          </article></DeskSurface>

          <DeskSurface dense><article className={`card settingsSection billingPackageToolCard ${openTool === "credits" ? "billingPackageToolCardOpen" : ""}`}>
            <div className="settingsSectionHeader">
              <div><h4 className="adminSubsectionTitle">{t("creditAdjustTitle")}</h4><div className="adminSectionDescription">{t("creditAdjustHelp")}</div></div>
              <AdminActionButton icon={openTool === "credits" ? "close" : "balance"} aria-expanded={openTool === "credits"} onClick={() => setOpenTool((current) => current === "credits" ? null : "credits")}>
                {openTool === "credits" ? t("packageTools.close") : t("packageTools.openCredits")}
              </AdminActionButton>
            </div>
            {openTool === "credits" ? (
              <div className="billingPackageToolBody billingCreditAdjustmentForm">
                <FormField label={t("userId")} hint={t("userIdHint")}><DeskInput className="input" placeholder={t("userIdPlaceholder")} value={adjustUserLookup} onChange={(event) => setAdjustUserLookup(event.target.value)} /></FormField>
                <FormField label={t("deltaCredits")} hint={t("deltaCreditsHint")}><DeskInput className="input" inputMode="numeric" placeholder="0" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} /></FormField>
                <FormField label={t("note")} hint={t("noteHint")}><DeskInput className="input" placeholder={t("notePlaceholder")} value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} /></FormField>
                <AdminActionButton className="billingSectionAction" icon="balance" variant="primary" onClick={adjustCredits} disabled={!canAdjustCredits} loading={savingId === "adjust"} loadingLabel={tCommon("saving")}>{t("adjust")}</AdminActionButton>
              </div>
            ) : null}
          </article></DeskSurface>
        </div>
      </section>
      <AdminConfirmDialog
        open={featureFlagsConfirmOpen}
        title={t("featureFlags.enableConfirmTitle")}
        description={t("featureFlags.enableConfirmDescription")}
        confirmLabel={t("featureFlags.enableConfirmAction")}
        loading={savingId === "flags"}
        onCancel={() => setFeatureFlagsConfirmOpen(false)}
        onConfirm={() => void saveFeatureFlags()}
      />
      <AdminConfirmDialog
        open={Boolean(pendingDeleteId)}
        title={t("delete")}
        description={t("confirmDelete")}
        confirmLabel={t("delete")}
        loading={Boolean(pendingDeleteId && savingId === pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) void deletePackage(pendingDeleteId);
        }}
      />
      <ReauthDialog
        open={reauthAction !== null}
        onClose={() => setReauthAction(null)}
        onVerified={async () => {
          const action = reauthAction;
          if (!action) return;
          setSavingId(action === "feature-flags" ? "flags" : "payment-config");
          try {
            if (action === "feature-flags") await persistFeatureFlags();
            else await persistPaymentConfig();
          } finally {
            setSavingId(null);
          }
        }}
      />
    </div>
  );
}

function FormField({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="adminFormField">
      <div className="adminFormFieldLabel">{label}</div>
      {children}
      {hint ? <div className="adminFormFieldHint">{hint}</div> : null}
    </div>
  );
}

function PackageGroup({
  title,
  items,
  drafts,
  expandedPackageId,
  savingId,
  locale,
  onToggle,
  onDraftChange,
  onSave,
  onDelete
}: {
  title: string;
  items: BillingPackage[];
  drafts: Record<string, PackageDraft>;
  expandedPackageId: string | null;
  savingId: string | null;
  locale: string;
  onToggle: (id: string | null) => void;
  onDraftChange: (id: string, next: PackageDraft) => void;
  onSave: (id: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("admin.billing");

  function packageType(item: BillingPackage): string {
    if (item.kind === "plan") {
      const plan = item.plan ? t(`fields.plan.${item.plan}`) : t("fields.plan.none");
      return `${t("fields.kind.plan")} · ${plan}`;
    }
    const addonKey = item.addonType === "running_bots"
      ? "runningBots"
      : item.addonType === "running_predictions_ai"
        ? "runningPredictionsAi"
        : item.addonType === "running_predictions_composite"
          ? "runningPredictionsComposite"
          : "aiCredits";
    return `${t("fields.kind.addon")} · ${t(`fields.addonType.${addonKey}`)}`;
  }

  function packageGrant(item: BillingPackage): string {
    if (item.kind === "plan") {
      return t("packageSummary.monthlyCredits", { value: formatBillingCredits(item.monthlyAiCredits, locale) });
    }
    if (item.addonType === "ai_credits") {
      return t("packageSummary.oneTimeCredits", { value: formatBillingCredits(item.aiCredits, locale) });
    }
    if (item.addonType === "running_bots") return t("packageSummary.botSlots", { value: item.deltaRunningBots ?? 0 });
    if (item.addonType === "running_predictions_ai") return t("packageSummary.aiPredictionSlots", { value: item.deltaRunningPredictionsAi ?? 0 });
    return t("packageSummary.compositePredictionSlots", { value: item.deltaRunningPredictionsComposite ?? 0 });
  }

  return (
    <section className="billingPackageGroup" aria-label={title}>
      <div className="billingPackageGroupHeader"><h4>{title}</h4><span className="badge">{items.length}</span></div>
      {items.length === 0 ? <div className="settingsMutedText">{t("packageSummary.groupEmpty")}</div> : (
        <div className="billingPackageList">
          {items.map((item) => {
            const expanded = expandedPackageId === item.id;
            const draft = drafts[item.id] ?? toDraft(item);
            return (
              <article className={`billingPackageCard ${expanded ? "billingPackageCardOpen" : ""}`} key={item.id}>
                <div className="billingPackageSummaryRow">
                  <div className="billingPackageIdentity">
                    <div className="billingPackageBadges">
                      <span className={`uiStatusBadge ${item.isActive ? "uiStatusBadge-success" : "uiStatusBadge-warning"}`}>{item.isActive ? t("packageSummary.enabled") : t("packageSummary.disabled")}</span>
                      <span className="badge">{packageType(item)}</span>
                    </div>
                    <h5>{item.name}</h5>
                    <code>{item.code}</code>
                  </div>
                  <dl className="billingPackageFacts">
                    <div><dt>{t("packageSummary.price")}</dt><dd>{formatBillingPrice(item.priceCents, locale)}</dd></div>
                    <div><dt>{t("packageSummary.period")}</dt><dd>{t("packageSummary.months", { count: item.billingMonths })}</dd></div>
                    <div><dt>{t("packageSummary.grant")}</dt><dd>{packageGrant(item)}</dd></div>
                  </dl>
                  <AdminActionButton icon={expanded ? "close" : "edit"} aria-expanded={expanded} onClick={() => onToggle(expanded ? null : item.id)}>
                    {expanded ? t("packageSummary.closeEditor") : t("packageSummary.edit")}
                  </AdminActionButton>
                </div>
                {expanded ? (
                  <div className="billingPackageEditor">
                    <PackageForm draft={draft} setDraft={(next) => onDraftChange(item.id, next)} />
                    <div className="adminInlineActions">
                      <AdminActionButton icon="save" variant="primary" onClick={() => void onSave(item.id)} loading={savingId === item.id}>{t("save")}</AdminActionButton>
                      <AdminActionButton icon="delete" variant="danger" onClick={() => onDelete(item.id)} disabled={savingId === item.id}>{t("delete")}</AdminActionButton>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PackageForm({
  draft,
  setDraft
}: {
  draft: PackageDraft;
  setDraft: (next: PackageDraft) => void;
}) {
  const t = useTranslations("admin.billing");
  const isPlan = draft.kind === "plan";

  function updateKind(nextKind: "plan" | "addon") {
    if (nextKind === "plan") {
      setDraft({
        ...draft,
        kind: "plan",
        addonType: "",
        plan: draft.plan || "pro"
      });
      return;
    }
    setDraft({
      ...draft,
      kind: "addon",
      addonType: draft.addonType || "running_bots",
      plan: ""
    });
  }

  return (
    <div className="billingPackageForm">
      <fieldset className="billingPackageFormGroup">
        <legend>{t("formGroups.identity")}</legend>
        <div className="adminFormGridCompact">
          <FormField label={t("fields.code.label")} hint={t("fields.code.hint")}><DeskInput className="input" value={draft.code} placeholder="pro_monthly" onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></FormField>
          <FormField label={t("fields.name.label")} hint={t("fields.name.hint")}><DeskInput className="input" value={draft.name} placeholder={t("fields.name.placeholder")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></FormField>
          <FormField label={t("fields.description.label")} hint={t("fields.description.hint")}><DeskInput className="input" value={draft.description} placeholder={t("fields.description.placeholder")} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></FormField>
          <FormField label={t("fields.kind.label")} hint={t("fields.kind.hint")}>
            <DeskSelect className="input" value={draft.kind} onChange={(event) => updateKind(event.target.value as "plan" | "addon")}><option value="plan">{t("fields.kind.plan")}</option><option value="addon">{t("fields.kind.addon")}</option></DeskSelect>
          </FormField>
          {isPlan ? (
            <FormField label={t("fields.plan.label")} hint={t("fields.plan.hint")}><DeskSelect className="input" value={draft.plan} onChange={(event) => setDraft({ ...draft, plan: event.target.value as "free" | "pro" | "premium" | "" })}><option value="">{t("fields.plan.none")}</option><option value="free">{t("fields.plan.free")}</option><option value="pro">{t("fields.plan.pro")}</option><option value="premium">{t("fields.plan.premium")}</option></DeskSelect></FormField>
          ) : (
            <FormField label={t("fields.addonType.label")} hint={t("fields.addonType.hint")}><DeskSelect className="input" value={draft.addonType} onChange={(event) => setDraft({ ...draft, addonType: event.target.value as BillingAddonType })}><option value="running_bots">{t("fields.addonType.runningBots")}</option><option value="running_predictions_ai">{t("fields.addonType.runningPredictionsAi")}</option><option value="running_predictions_composite">{t("fields.addonType.runningPredictionsComposite")}</option><option value="ai_credits">{t("fields.addonType.aiCredits")}</option></DeskSelect></FormField>
          )}
          <FormField label={t("fields.sortOrder.label")} hint={t("fields.sortOrder.hint")}><DeskInput className="input" type="number" value={draft.sortOrder} placeholder="0" onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></FormField>
        </div>
      </fieldset>

      <fieldset className="billingPackageFormGroup">
        <legend>{t("formGroups.commerce")}</legend>
        <div className="adminFormGridCompact">
          <FormField label={t("fields.priceCents.label")} hint={t("fields.priceCents.hint")}><DeskInput className="input" type="number" value={draft.priceCents} placeholder="2900" onChange={(event) => setDraft({ ...draft, priceCents: Number(event.target.value) })} /></FormField>
          <FormField label={t("fields.billingMonths.label")} hint={t("fields.billingMonths.hint")}><DeskInput className="input" type="number" value={draft.billingMonths} placeholder="1" onChange={(event) => setDraft({ ...draft, billingMonths: Number(event.target.value) })} /></FormField>
          <FormField label={t("fields.isActive.label")} hint={t("fields.isActive.hint")}><label className="adminCheckboxLabel billingPackageAvailability"><DeskInput type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />{t("fields.isActive.value")}</label></FormField>
        </div>
      </fieldset>

      <fieldset className="billingPackageFormGroup">
        <legend>{t("formGroups.entitlements")}</legend>
        <div className="adminFormGridCompact">
          {isPlan ? (
            <>
              <FormField label={t("fields.maxExchangeAccounts.label")} hint={t("fields.maxExchangeAccounts.hint")}><DeskInput className="input" value={draft.maxExchangeAccounts} placeholder={t("fields.maxExchangeAccounts.placeholder")} onChange={(event) => setDraft({ ...draft, maxExchangeAccounts: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField>
              <FormField label={t("fields.maxRunningBots.label")} hint={t("fields.maxRunningBots.hint")}><DeskInput className="input" value={draft.maxRunningBots} placeholder="5" onChange={(event) => setDraft({ ...draft, maxRunningBots: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField>
              <FormField label={t("fields.maxRunningPredictionsAi.label")} hint={t("fields.maxRunningPredictionsAi.hint")}><DeskInput className="input" value={draft.maxRunningPredictionsAi} placeholder="3" onChange={(event) => setDraft({ ...draft, maxRunningPredictionsAi: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField>
              <FormField label={t("fields.maxRunningPredictionsComposite.label")} hint={t("fields.maxRunningPredictionsComposite.hint")}><DeskInput className="input" value={draft.maxRunningPredictionsComposite} placeholder="2" onChange={(event) => setDraft({ ...draft, maxRunningPredictionsComposite: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField>
              <FormField label={t("fields.allowedExchanges.label")} hint={t("fields.allowedExchanges.hint")}><DeskInput className="input" value={draft.allowedExchanges} placeholder="*" onChange={(event) => setDraft({ ...draft, allowedExchanges: event.target.value })} /></FormField>
              <FormField label={t("fields.monthlyAiCredits.label")} hint={t("fields.monthlyAiCredits.hint")}><DeskInput className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.monthlyAiCredits} placeholder="10000" onChange={(event) => setDraft({ ...draft, monthlyAiCredits: event.target.value })} /></FormField>
            </>
          ) : null}
          {!isPlan && draft.addonType === "ai_credits" ? <FormField label={t("fields.aiCredits.label")} hint={t("fields.aiCredits.hint")}><DeskInput className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.aiCredits} placeholder="250000" onChange={(event) => setDraft({ ...draft, aiCredits: event.target.value })} /></FormField> : null}
          {!isPlan && draft.addonType === "running_bots" ? <FormField label={t("fields.deltaRunningBots.label")} hint={t("fields.deltaRunningBots.hint")}><DeskInput className="input" value={draft.deltaRunningBots} placeholder="1" onChange={(event) => setDraft({ ...draft, deltaRunningBots: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField> : null}
          {!isPlan && draft.addonType === "running_predictions_ai" ? <FormField label={t("fields.deltaRunningPredictionsAi.label")} hint={t("fields.deltaRunningPredictionsAi.hint")}><DeskInput className="input" value={draft.deltaRunningPredictionsAi} placeholder="1" onChange={(event) => setDraft({ ...draft, deltaRunningPredictionsAi: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField> : null}
          {!isPlan && draft.addonType === "running_predictions_composite" ? <FormField label={t("fields.deltaRunningPredictionsComposite.label")} hint={t("fields.deltaRunningPredictionsComposite.hint")}><DeskInput className="input" value={draft.deltaRunningPredictionsComposite} placeholder="1" onChange={(event) => setDraft({ ...draft, deltaRunningPredictionsComposite: event.target.value === "" ? "" : Number(event.target.value) })} /></FormField> : null}
        </div>
      </fieldset>
    </div>
  );
}
