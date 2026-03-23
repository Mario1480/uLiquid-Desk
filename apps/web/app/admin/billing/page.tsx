"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../lib/api";

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
  billingWebhookEnabled: boolean;
  aiTokenBillingEnabled: boolean;
  source: "db" | "default";
  updatedAt: string | null;
  defaults: {
    billingEnabled: boolean;
    billingWebhookEnabled: boolean;
    aiTokenBillingEnabled: boolean;
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
  monthlyAiTokens: number;
  aiCredits: number;
  deltaRunningBots: number | "";
  deltaRunningPredictionsAi: number | "";
  deltaRunningPredictionsComposite: number | "";
};

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
    monthlyAiTokens: Number(pkg.monthlyAiTokens ?? "0"),
    aiCredits: Number(pkg.aiCredits ?? "0"),
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
    priceCents: 0,
    billingMonths: 1,
    plan: "pro",
    maxRunningBots: 3,
    maxRunningPredictionsAi: 3,
    maxRunningPredictionsComposite: 2,
    allowedExchanges: "*",
    monthlyAiTokens: 1_000_000,
    aiCredits: 0,
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

function toNonNegativeStringInt(value: number): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(Math.max(0, Math.trunc(parsed)));
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
    monthlyAiTokens: toNonNegativeStringInt(isPlan ? draft.monthlyAiTokens : 0),
    aiCredits: toNonNegativeStringInt(!isPlan && addonType === "ai_credits" ? draft.aiCredits : 0),
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
  const [billingWebhookEnabled, setBillingWebhookEnabled] = useState(true);
  const [aiTokenBillingEnabled, setAiTokenBillingEnabled] = useState(true);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const [payload, flags] = await Promise.all([
        apiGet<BillingPackagesResponse>("/admin/billing/packages"),
        apiGet<BillingFeatureFlagsResponse>("/admin/settings/billing")
      ]);
      setItems(payload.items ?? []);
      setFeatureFlags(flags);
      setBillingEnabled(Boolean(flags.billingEnabled));
      setBillingWebhookEnabled(Boolean(flags.billingWebhookEnabled));
      setAiTokenBillingEnabled(Boolean(flags.aiTokenBillingEnabled));
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
    if (!confirm(t("confirmDelete"))) return;
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
    if (!userLookup) return;
    setSavingId("adjust");
    setMsg(null);
    try {
      await apiPost(`/admin/billing/users/${encodeURIComponent(userLookup)}/tokens/adjust`, {
        deltaTokens: Number(adjustDelta) || 0,
        note: adjustNote.trim() || undefined
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

  async function saveFeatureFlags() {
    setSavingId("flags");
    setMsg(null);
    try {
      const saved = await apiPut<BillingFeatureFlagsResponse>("/admin/settings/billing", {
        billingEnabled,
        billingWebhookEnabled,
        aiTokenBillingEnabled
      });
      setFeatureFlags(saved);
      setBillingEnabled(Boolean(saved.billingEnabled));
      setBillingWebhookEnabled(Boolean(saved.billingWebhookEnabled));
      setAiTokenBillingEnabled(Boolean(saved.aiTokenBillingEnabled));
      setMsg(t("featureFlags.saved"));
    } catch (error) {
      setMsg(errMsg(error));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="settingsWrap">
      <h2 style={{ marginTop: 0 }}>{t("title")}</h2>
      <div className="settingsMutedText" style={{ marginBottom: 12 }}>{t("description")}</div>

      {msg ? <div className="settingsMutedText" style={{ marginBottom: 10 }}>{msg}</div> : null}

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("featureFlags.title")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("featureFlags.description")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8, fontSize: 12 }}>
          {t("featureFlags.source")}: {featureFlags?.source ?? "default"} · {t("featureFlags.updatedAt")}:{" "}
          {featureFlags?.updatedAt ? new Date(featureFlags.updatedAt).toLocaleString() : t("featureFlags.never")}
        </div>
        <div style={{ display: "grid", gap: 8, maxWidth: 620, marginBottom: 10 }}>
          <FormField label={t("featureFlags.billingEnabled.label")} hint={t("featureFlags.billingEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={billingEnabled} onChange={(e) => setBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
          <FormField label={t("featureFlags.billingWebhookEnabled.label")} hint={t("featureFlags.billingWebhookEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={billingWebhookEnabled} onChange={(e) => setBillingWebhookEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
          <FormField label={t("featureFlags.aiTokenBillingEnabled.label")} hint={t("featureFlags.aiTokenBillingEnabled.hint")}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={aiTokenBillingEnabled} onChange={(e) => setAiTokenBillingEnabled(e.target.checked)} />
              {t("featureFlags.enabledValue")}
            </label>
          </FormField>
        </div>
        <button className="btn btnPrimary" onClick={saveFeatureFlags} disabled={savingId === "flags"}>
          {savingId === "flags" ? tCommon("saving") : t("featureFlags.save")}
        </button>
      </section>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("createTitle")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("createHelp")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8, fontSize: 12 }}>
          USD is fixed for all new plans and add-ons.
        </div>
        <PackageForm draft={createDraft} setDraft={setCreateDraft} />
        <button className="btn btnPrimary" onClick={createPackage} disabled={savingId === "new"}>
          {savingId === "new" ? tCommon("saving") : t("create")}
        </button>
      </section>

      <section className="card settingsSection" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("tokenAdjustTitle")}</div>
        <div className="settingsMutedText" style={{ marginBottom: 8 }}>{t("tokenAdjustHelp")}</div>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
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
          <button className="btn btnPrimary" onClick={adjustTokens} disabled={savingId === "adjust"}>
            {savingId === "adjust" ? tCommon("saving") : t("adjust")}
          </button>
        </div>
      </section>

      <section className="card settingsSection">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{t("listTitle")}</div>
          <button className="btn" onClick={load} disabled={loading}>{t("refresh")}</button>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCommon("loading")}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((item) => (
              <div className="settingsPanel" key={item.id} style={{ padding: 12 }}>
                <div style={{ marginBottom: 8, fontWeight: 700 }}>{item.name} ({item.code})</div>
                <PackageForm
                  draft={drafts[item.id]}
                  setDraft={(next) => setDrafts((prev) => ({ ...prev, [item.id]: next }))}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btnPrimary" onClick={() => savePackage(item.id)} disabled={savingId === item.id}>
                    {savingId === item.id ? tCommon("saving") : t("save")}
                  </button>
                  <button className="btn btnStop" onClick={() => deletePackage(item.id)} disabled={savingId === item.id}>
                    {t("delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
      {children}
      {hint ? <div className="settingsMutedText" style={{ fontSize: 12 }}>{hint}</div> : null}
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 8 }}>
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
            <input className="input" type="number" value={draft.monthlyAiTokens} placeholder="1000000" onChange={(e) => setDraft({ ...draft, monthlyAiTokens: Number(e.target.value) })} />
          </FormField>
        </>
      ) : null}

      {!isPlan && draft.addonType === "ai_credits" ? (
        <FormField label={t("fields.aiCredits.label")} hint={t("fields.aiCredits.hint")}>
          <input className="input" type="number" value={draft.aiCredits} placeholder="250000" onChange={(e) => setDraft({ ...draft, aiCredits: Number(e.target.value) })} />
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          {t("fields.isActive.value")}
        </label>
      </FormField>
    </div>
  );
}
