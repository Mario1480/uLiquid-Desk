"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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
  plan: "free" | "pro" | null;
  maxRunningBots: number | null;
  maxRunningPredictionsAi: number | null;
  maxRunningPredictionsComposite: number | null;
  allowedExchanges: string[];
  monthlyAiTokens: string;
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
  aiTokenBillingEnabled: boolean;
  source: "db" | "default";
  updatedAt: string | null;
  defaults: {
    billingEnabled: boolean;
    aiTokenBillingEnabled: boolean;
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
  plan: "free" | "pro" | "";
  maxRunningBots: number | "";
  maxRunningPredictionsAi: number | "";
  maxRunningPredictionsComposite: number | "";
  allowedExchanges: string;
  monthlyAiTokens: string;
  aiCredits: string;
  deltaRunningBots: number | "";
  deltaRunningPredictionsAi: number | "";
  deltaRunningPredictionsComposite: number | "";
};

const INTEGER_DELTA_PATTERN = /^-?\d+$/;

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
    maxRunningBots: pkg.maxRunningBots ?? "",
    maxRunningPredictionsAi: pkg.maxRunningPredictionsAi ?? "",
    maxRunningPredictionsComposite: pkg.maxRunningPredictionsComposite ?? "",
    allowedExchanges: (pkg.allowedExchanges ?? ["*"]).join(","),
    monthlyAiTokens: pkg.monthlyAiTokens ?? "0",
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
    maxRunningBots: 3,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2,
    allowedExchanges: "*",
    monthlyAiTokens: "1000000",
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
    maxRunningBots: isPlan ? toNonNegativeInt(draft.maxRunningBots) : null,
    maxRunningPredictionsAi: isPlan ? toNonNegativeInt(draft.maxRunningPredictionsAi) : null,
    maxRunningPredictionsComposite: isPlan
      ? toNonNegativeInt(draft.maxRunningPredictionsComposite)
      : null,
    allowedExchanges: isPlan ? (allowedExchanges.length > 0 ? allowedExchanges : ["*"]) : ["*"],
    monthlyAiTokens: normalizeNonNegativeBillingInteger(isPlan ? draft.monthlyAiTokens : "0"),
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
  const [aiTokenBillingEnabled, setAiTokenBillingEnabled] = useState(true);
  const [paymentConfig, setPaymentConfig] = useState<BillingPaymentConfigResponse | null>(null);
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [treasuryAddressConfirmation, setTreasuryAddressConfirmation] = useState("");
  const [reauthAction, setReauthAction] = useState<"payment-config" | "feature-flags" | null>(null);
  const [featureFlagsConfirmOpen, setFeatureFlagsConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const canAdjustTokens = Boolean(
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
      setAiTokenBillingEnabled(Boolean(flags.aiTokenBillingEnabled));
      setPaymentConfig(config);
      setTreasuryAddress(config?.treasuryAddress ?? "");
      setTreasuryAddressConfirmation("");
      const nextDrafts: Record<string, PackageDraft> = {};
      for (const item of payload.items ?? []) {
        nextDrafts[item.id] = toDraft(item);
      }
      setDrafts(nextDrafts);
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
      await load();
      setMsg(t("deleted"));
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  async function adjustTokens() {
    const userLookup = adjustUserLookup.trim();
    const deltaTokens = adjustDelta.trim();
    const note = adjustNote.trim();
    if (!userLookup || !INTEGER_DELTA_PATTERN.test(deltaTokens) || !note) {
      setMsg(t("adjustInvalid"));
      return;
    }
    setSavingId("adjust");
    setMsg(null);
    try {
      await apiPost(`/admin/billing/users/${encodeURIComponent(userLookup)}/tokens/adjust`, {
        deltaTokens,
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
      aiTokenBillingEnabled
    });
    setFeatureFlags(saved);
    setBillingEnabled(Boolean(saved.billingEnabled));
    setAiTokenBillingEnabled(Boolean(saved.aiTokenBillingEnabled));
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

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Billing"
        title={t("title")}
        description={t("description")}
      />

      {msg ? <AdminNotice tone="info">{msg}</AdminNotice> : null}

      <section className="card settingsSection adminInlineForm">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("paymentConfig.title")}</h3>
            <div className="adminSectionDescription">{t("paymentConfig.description")}</div>
          </div>
          <span className={`uiStatusBadge ${paymentConfig?.configured && paymentConfig.rpc?.ready ? "uiStatusBadge-success" : "uiStatusBadge-warning"}`}>
            {paymentConfig?.configured && paymentConfig.rpc?.ready
              ? t("paymentConfig.ready")
              : t("paymentConfig.notReady")}
          </span>
        </div>
        <div className="adminChoiceGrid">
          <FormField label={t("paymentConfig.treasuryAddress")} hint={t("paymentConfig.treasuryHint")}>
            <input
              className="input subscriptionMono"
              value={treasuryAddress}
              onChange={(event) => setTreasuryAddress(event.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <FormField label={t("paymentConfig.confirmTreasuryAddress")} hint={t("paymentConfig.confirmTreasuryHint")}>
            <input
              className="input subscriptionMono"
              value={treasuryAddressConfirmation}
              onChange={(event) => setTreasuryAddressConfirmation(event.target.value)}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
        </div>
        <div className="settingsHubSummary settingsTradingDefaultsSummary">
          <div className="miniMetric"><span>{t("paymentConfig.chain")}</span><b>{paymentConfig?.chainId ?? 42161}</b></div>
          <div className="miniMetric"><span>{t("paymentConfig.token")}</span><b className="subscriptionMono">{paymentConfig?.tokenAddress ?? "-"}</b></div>
          <div className="miniMetric"><span>{t("paymentConfig.confirmations")}</span><b>{paymentConfig?.confirmationsRequired ?? 12}</b></div>
          <div className="miniMetric"><span>{t("paymentConfig.revision")}</span><b>{paymentConfig?.revision ?? "-"}</b></div>
          <div className="miniMetric"><span>{t("paymentConfig.lastBlock")}</span><b>{paymentConfig?.rpc?.lastBlockNumber ?? "-"}</b></div>
          <div className="miniMetric"><span>{t("paymentConfig.lastChecked")}</span><b>{paymentConfig?.rpc?.lastCheckedAt ? new Date(paymentConfig.rpc.lastCheckedAt).toLocaleString() : "-"}</b></div>
        </div>
        {paymentConfig?.rpc?.error ? <AdminNotice tone="warning">{paymentConfig.rpc.error}</AdminNotice> : null}
        <AdminActionButton
          icon="save"
          variant="primary"
          onClick={() => void savePaymentConfig()}
          loading={savingId === "payment-config"}
          loadingLabel={tCommon("saving")}
        >
          {t("paymentConfig.save")}
        </AdminActionButton>
      </section>

      <section className="card settingsSection adminInlineForm">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("featureFlags.title")}</h3>
            <div className="adminSectionDescription">{t("featureFlags.description")}</div>
          </div>
        </div>
        <div className="settingsMutedText">
          {t("featureFlags.source")}: {featureFlags?.source ?? "default"} · {t("featureFlags.updatedAt")}:{" "}
          {featureFlags?.updatedAt ? new Date(featureFlags.updatedAt).toLocaleString() : t("featureFlags.never")}
        </div>
        <div className="adminChoiceGrid">
          <FormField label={t("featureFlags.billingEnabled.label")} hint={t("featureFlags.billingEnabled.hint")}>
            <label className="adminCheckboxLabel">
              <input type="checkbox" checked={billingEnabled} onChange={(e) => setBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
          <FormField label={t("featureFlags.aiTokenBillingEnabled.label")} hint={t("featureFlags.aiTokenBillingEnabled.hint")}>
            <label className="adminCheckboxLabel">
              <input type="checkbox" checked={aiTokenBillingEnabled} onChange={(e) => setAiTokenBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
        </div>
        <AdminActionButton icon="save" variant="primary" onClick={requestSaveFeatureFlags} loading={savingId === "flags"} loadingLabel={tCommon("saving")}>
          {t("featureFlags.save")}
        </AdminActionButton>
      </section>

      <section className="card settingsSection adminInlineForm">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("createTitle")}</h3>
            <div className="adminSectionDescription">{t("createHelp")}</div>
          </div>
        </div>
        <div className="settingsMutedText">
          USD is fixed for all new plans and add-ons.
        </div>
        <PackageForm draft={createDraft} setDraft={setCreateDraft} />
        <AdminActionButton icon="create" variant="primary" onClick={createPackage} loading={savingId === "new"} loadingLabel={tCommon("saving")}>
          {t("create")}
        </AdminActionButton>
      </section>

      <section className="card settingsSection adminInlineForm">
        <div className="settingsSectionHeader">
          <div>
            <h3 className="adminSubsectionTitle">{t("tokenAdjustTitle")}</h3>
            <div className="adminSectionDescription">{t("tokenAdjustHelp")}</div>
          </div>
        </div>
        <div className="adminChoiceGrid">
          <FormField label={t("userId")} hint={t("userIdHint")}>
            <input
              className="input"
              placeholder={t("userIdPlaceholder")}
              value={adjustUserLookup}
              onChange={(e) => setAdjustUserLookup(e.target.value)}
            />
          </FormField>
          <FormField label={t("deltaTokens")} hint={t("deltaTokensHint")}>
            <input
              className="input"
              placeholder="0"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
            />
          </FormField>
          <FormField label={t("note")} hint={t("noteHint")}>
            <input
              className="input"
              placeholder={t("notePlaceholder")}
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
            />
          </FormField>
          <AdminActionButton icon="balance" variant="primary" onClick={adjustTokens} disabled={!canAdjustTokens} loading={savingId === "adjust"} loadingLabel={tCommon("saving")}>
            {t("adjust")}
          </AdminActionButton>
        </div>
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <h3 className="adminSubsectionTitle">{t("listTitle")}</h3>
          <AdminActionButton icon="refresh" onClick={load} loading={loading}>
            {t("refresh")}
          </AdminActionButton>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : (
          <div className="adminListStack">
            {items.map((item) => (
              <div className="settingsPanel adminInlineForm" key={item.id}>
                <div className="adminSubsectionTitle">{item.name} ({item.code})</div>
                <PackageForm
                  draft={drafts[item.id]}
                  setDraft={(next) => setDrafts((prev) => ({ ...prev, [item.id]: next }))}
                />
                <div className="adminInlineActions">
                  <AdminActionButton icon="save" variant="primary" onClick={() => savePackage(item.id)} loading={savingId === item.id} loadingLabel={tCommon("saving")}>
                    {t("save")}
                  </AdminActionButton>
                  <AdminActionButton icon="delete" variant="danger" onClick={() => setPendingDeleteId(item.id)} disabled={savingId === item.id}>
                    {t("delete")}
                  </AdminActionButton>
                </div>
              </div>
            ))}
          </div>
        )}
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
    <div className="adminFormGridCompact">
      <FormField label={t("fields.code.label")} hint={t("fields.code.hint")}>
        <input className="input" value={draft.code} placeholder="pro_monthly" onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
      </FormField>
      <FormField label={t("fields.name.label")} hint={t("fields.name.hint")}>
        <input className="input" value={draft.name} placeholder={t("fields.name.placeholder")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </FormField>
      <FormField label={t("fields.description.label")} hint={t("fields.description.hint")}>
        <input className="input" value={draft.description} placeholder={t("fields.description.placeholder")} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </FormField>
      <FormField label={t("fields.kind.label")} hint={t("fields.kind.hint")}>
        <select className="input" value={draft.kind} onChange={(e) => updateKind(e.target.value as "plan" | "addon")}>
          <option value="plan">{t("fields.kind.plan")}</option>
          <option value="addon">{t("fields.kind.addon")}</option>
        </select>
      </FormField>
      {isPlan ? (
        <FormField label={t("fields.plan.label")} hint={t("fields.plan.hint")}>
          <select className="input" value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value as "free" | "pro" | "" })}>
            <option value="">{t("fields.plan.none")}</option>
            <option value="free">{t("fields.plan.free")}</option>
            <option value="pro">{t("fields.plan.pro")}</option>
          </select>
        </FormField>
      ) : (
        <FormField label={t("fields.addonType.label")} hint={t("fields.addonType.hint")}>
          <select
            className="input"
            value={draft.addonType}
            onChange={(e) => setDraft({ ...draft, addonType: e.target.value as BillingAddonType })}
          >
            <option value="running_bots">{t("fields.addonType.runningBots")}</option>
            <option value="running_predictions_ai">{t("fields.addonType.runningPredictionsAi")}</option>
            <option value="running_predictions_composite">{t("fields.addonType.runningPredictionsComposite")}</option>
            <option value="ai_credits">{t("fields.addonType.aiCredits")}</option>
          </select>
        </FormField>
      )}
      <FormField label={t("fields.sortOrder.label")} hint={t("fields.sortOrder.hint")}>
        <input className="input" type="number" value={draft.sortOrder} placeholder="0" onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.priceCents.label")} hint={t("fields.priceCents.hint")}>
        <input className="input" type="number" value={draft.priceCents} placeholder="2900" onChange={(e) => setDraft({ ...draft, priceCents: Number(e.target.value) })} />
      </FormField>
      <FormField label={t("fields.billingMonths.label")} hint={t("fields.billingMonths.hint")}>
        <input className="input" type="number" value={draft.billingMonths} placeholder="1" onChange={(e) => setDraft({ ...draft, billingMonths: Number(e.target.value) })} />
      </FormField>

      {isPlan ? (
        <>
          <FormField label={t("fields.maxRunningBots.label")} hint={t("fields.maxRunningBots.hint")}>
            <input className="input" value={draft.maxRunningBots} placeholder="3" onChange={(e) => setDraft({ ...draft, maxRunningBots: e.target.value === "" ? "" : Number(e.target.value) })} />
          </FormField>
          <FormField label={t("fields.maxRunningPredictionsAi.label")} hint={t("fields.maxRunningPredictionsAi.hint")}>
            <input className="input" value={draft.maxRunningPredictionsAi} placeholder="3" onChange={(e) => setDraft({ ...draft, maxRunningPredictionsAi: e.target.value === "" ? "" : Number(e.target.value) })} />
          </FormField>
          <FormField label={t("fields.maxRunningPredictionsComposite.label")} hint={t("fields.maxRunningPredictionsComposite.hint")}>
            <input className="input" value={draft.maxRunningPredictionsComposite} placeholder="2" onChange={(e) => setDraft({ ...draft, maxRunningPredictionsComposite: e.target.value === "" ? "" : Number(e.target.value) })} />
          </FormField>
          <FormField label={t("fields.allowedExchanges.label")} hint={t("fields.allowedExchanges.hint")}>
            <input className="input" value={draft.allowedExchanges} placeholder="*" onChange={(e) => setDraft({ ...draft, allowedExchanges: e.target.value })} />
          </FormField>
          <FormField label={t("fields.monthlyAiTokens.label")} hint={t("fields.monthlyAiTokens.hint")}>
            <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.monthlyAiTokens} placeholder="1000000" onChange={(e) => setDraft({ ...draft, monthlyAiTokens: e.target.value })} />
          </FormField>
        </>
      ) : null}

      {!isPlan && draft.addonType === "ai_credits" ? (
        <FormField label={t("fields.aiCredits.label")} hint={t("fields.aiCredits.hint")}>
          <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={draft.aiCredits} placeholder="250000" onChange={(e) => setDraft({ ...draft, aiCredits: e.target.value })} />
        </FormField>
      ) : null}

      {!isPlan && draft.addonType === "running_bots" ? (
        <FormField label={t("fields.deltaRunningBots.label")} hint={t("fields.deltaRunningBots.hint")}>
          <input className="input" value={draft.deltaRunningBots} placeholder="1" onChange={(e) => setDraft({ ...draft, deltaRunningBots: e.target.value === "" ? "" : Number(e.target.value) })} />
        </FormField>
      ) : null}

      {!isPlan && draft.addonType === "running_predictions_ai" ? (
        <FormField label={t("fields.deltaRunningPredictionsAi.label")} hint={t("fields.deltaRunningPredictionsAi.hint")}>
          <input className="input" value={draft.deltaRunningPredictionsAi} placeholder="1" onChange={(e) => setDraft({ ...draft, deltaRunningPredictionsAi: e.target.value === "" ? "" : Number(e.target.value) })} />
        </FormField>
      ) : null}

      {!isPlan && draft.addonType === "running_predictions_composite" ? (
        <FormField label={t("fields.deltaRunningPredictionsComposite.label")} hint={t("fields.deltaRunningPredictionsComposite.hint")}>
          <input className="input" value={draft.deltaRunningPredictionsComposite} placeholder="1" onChange={(e) => setDraft({ ...draft, deltaRunningPredictionsComposite: e.target.value === "" ? "" : Number(e.target.value) })} />
        </FormField>
      ) : null}

      <FormField label={t("fields.isActive.label")} hint={t("fields.isActive.hint")}>
        <label className="adminCheckboxLabel">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          {t("fields.isActive.value")}
        </label>
      </FormField>
    </div>
  );
}
