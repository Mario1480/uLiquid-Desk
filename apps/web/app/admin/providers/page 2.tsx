"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { AppIcon } from "../../components/AppIcon";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";

type ProviderState = {
  providerId: string;
  providerType: string;
  state: "healthy" | "degraded" | "unavailable" | "disabled";
  enabled: boolean;
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
  message?: string;
  itemCount?: number;
  licenseStatus?: "pending_review" | "approved" | "blocked";
  termsReviewedAt?: string;
  circuitState?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

export default function AdminProvidersPage() {
  const t = useTranslations("admin.marketProviders");
  const [items, setItems] = useState<ProviderState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ items?: ProviderState[] }>("/admin/market-intelligence/providers");
      setItems(Array.isArray(response.items) ? response.items : []);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function update(provider: ProviderState, patch: Record<string, unknown>) {
    setBusy(provider.providerId);
    setError(null);
    try {
      await apiPut(`/admin/market-intelligence/providers/${encodeURIComponent(provider.providerId)}`, patch);
      setNotice(t("saved"));
      await load();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      await apiPost("/admin/market-intelligence/refresh", { scope: "all" });
      setNotice(t("refreshStarted"));
      await load();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="success">{notice}</AdminNotice> : null}

      <DeskSurface dense><section className="settingsSection">
        <div className="adminProviderToolbar">
          <div>
            <h2>{t("overview")}</h2>
            <p>{t("overviewDescription")}</p>
          </div>
          <DeskButton className="btn btnPrimary" type="button" onClick={() => void refresh()} disabled={busy !== null}>
            <AppIcon name="refresh" />
            {t("resync")}
          </DeskButton>
        </div>

        {loading ? <div className="uiEmptyState">{t("loading")}</div> : null}
        {!loading && items.length === 0 ? <div className="uiEmptyState">{t("empty")}</div> : null}
        <div className="adminProviderTableWrap">
          <DeskTable className="adminTable">
            <thead>
              <tr>
                <th>{t("columns.provider")}</th>
                <th>{t("columns.state")}</th>
                <th>{t("columns.lastSuccess")}</th>
                <th>{t("columns.items")}</th>
                <th>{t("columns.license")}</th>
                <th>{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((provider) => (
                <tr key={`${provider.providerType}-${provider.providerId}`}>
                  <td>
                    <strong>{provider.providerId}</strong>
                    <span className="adminProviderSubline">{provider.providerType} · {provider.message ?? "–"}</span>
                  </td>
                  <td><DeskBadge className="badge">{provider.state}</DeskBadge></td>
                  <td>{provider.lastSuccessAt ? new Date(provider.lastSuccessAt).toLocaleString() : "–"}</td>
                  <td>{provider.itemCount ?? "–"}</td>
                  <td>
                    <DeskSelect
                      className="input"
                      value={provider.licenseStatus ?? "pending_review"}
                      onChange={(event) => void update(provider, {
                        usageStatus: event.target.value,
                        ...(event.target.value === "approved" ? { termsReviewedAt: new Date().toISOString().slice(0, 10) } : {})
                      })}
                      disabled={busy !== null}
                    >
                      <option value="pending_review">pending_review</option>
                      <option value="approved">approved</option>
                      <option value="blocked">blocked</option>
                    </DeskSelect>
                  </td>
                  <td>
                    <DeskButton
                      type="button"
                      className="btn"
                      onClick={() => void update(provider, { enabled: !provider.enabled })}
                      disabled={busy !== null}
                    >
                      <AppIcon name={provider.enabled ? "pause" : "start"} />
                      {provider.enabled ? t("disable") : t("enable")}
                    </DeskButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </DeskTable>
        </div>
      </section></DeskSurface>
    </div>
  );
}
