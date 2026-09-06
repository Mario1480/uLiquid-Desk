"use client";

import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTextarea } from "@/components/desk/DeskTextarea";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import AdminActionButton from "../_components/AdminActionButton";
import AdminNotice from "../_components/AdminNotice";
import AdminPageHeader from "../_components/AdminPageHeader";

type VaultSafetyResponse = {
  haltNewOrders: boolean;
  depositsDisabled: boolean;
  withdrawsDisabled: boolean;
  gridStartsDisabled: boolean;
  profitClaimsDisabled: boolean;
  fundingVaultLaunchesDisabled: boolean;
  fundingVaultWithdrawsDisabled: boolean;
  closeOnlyAllUserIds: string[];
  reason: string | null;
  updatedByUserId: string | null;
  updatedAt: string | null;
  source: "db" | "default";
};

type CloseOnlyAllResponse = {
  ok: true;
  safety: VaultSafetyResponse;
  result: {
    userId: string;
    scanned: number;
    updated: number;
    failed: Array<{ botVaultId: string; reason: string }>;
  };
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

function parseUserIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export default function AdminVaultSafetyPage() {
  const t = useTranslations("admin.vaultSafety");
  const tCommon = useTranslations("admin.common");
  const locale = useLocale() as AppLocale;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<VaultSafetyResponse | null>(null);
  const [haltNewOrders, setHaltNewOrders] = useState(false);
  const [depositsDisabled, setDepositsDisabled] = useState(false);
  const [withdrawsDisabled, setWithdrawsDisabled] = useState(false);
  const [gridStartsDisabled, setGridStartsDisabled] = useState(false);
  const [profitClaimsDisabled, setProfitClaimsDisabled] = useState(false);
  const [fundingVaultLaunchesDisabled, setFundingVaultLaunchesDisabled] = useState(false);
  const [fundingVaultWithdrawsDisabled, setFundingVaultWithdrawsDisabled] = useState(false);
  const [closeOnlyUsersInput, setCloseOnlyUsersInput] = useState("");
  const [reason, setReason] = useState("");
  const [closeOnlyTargetUserId, setCloseOnlyTargetUserId] = useState("");
  const [lastCloseOnlyResult, setLastCloseOnlyResult] = useState<CloseOnlyAllResponse["result"] | null>(null);

  const parsedCloseOnlyUsers = useMemo(() => parseUserIds(closeOnlyUsersInput), [closeOnlyUsersInput]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const me = await apiGet<any>("/auth/me");
      if (!(me?.isSuperadmin || me?.hasAdminBackendAccess)) {
        setIsAdmin(false);
        setError(t("messages.accessRequired"));
        return;
      }
      setIsAdmin(true);
      const payload = await apiGet<VaultSafetyResponse>("/admin/settings/vault-safety");
      setSettings(payload);
      setHaltNewOrders(payload.haltNewOrders);
      setDepositsDisabled(payload.depositsDisabled);
      setWithdrawsDisabled(payload.withdrawsDisabled);
      setGridStartsDisabled(payload.gridStartsDisabled);
      setProfitClaimsDisabled(payload.profitClaimsDisabled);
      setFundingVaultLaunchesDisabled(payload.fundingVaultLaunchesDisabled);
      setFundingVaultWithdrawsDisabled(payload.fundingVaultWithdrawsDisabled);
      setCloseOnlyUsersInput(payload.closeOnlyAllUserIds.join("\n"));
      setReason(payload.reason ?? "");
      setLastCloseOnlyResult(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPut<VaultSafetyResponse>("/admin/settings/vault-safety", {
        haltNewOrders,
        depositsDisabled,
        withdrawsDisabled,
        gridStartsDisabled,
        profitClaimsDisabled,
        fundingVaultLaunchesDisabled,
        fundingVaultWithdrawsDisabled,
        closeOnlyAllUserIds: parsedCloseOnlyUsers,
        reason: reason.trim() || undefined
      });
      setSettings(payload);
      setHaltNewOrders(payload.haltNewOrders);
      setDepositsDisabled(payload.depositsDisabled);
      setWithdrawsDisabled(payload.withdrawsDisabled);
      setGridStartsDisabled(payload.gridStartsDisabled);
      setProfitClaimsDisabled(payload.profitClaimsDisabled);
      setFundingVaultLaunchesDisabled(payload.fundingVaultLaunchesDisabled);
      setFundingVaultWithdrawsDisabled(payload.fundingVaultWithdrawsDisabled);
      setCloseOnlyUsersInput(payload.closeOnlyAllUserIds.join("\n"));
      setReason(payload.reason ?? "");
      setNotice(t("messages.saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function triggerCloseOnlyAll() {
    const userId = closeOnlyTargetUserId.trim();
    if (!userId) {
      setError(t("messages.userIdRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiPost<CloseOnlyAllResponse>(`/admin/users/${encodeURIComponent(userId)}/vaults/close-only-all`, {
        reason: reason.trim() || "admin_close_only_all",
        idempotencyKey: `admin-close-only-all:${userId}:${Date.now()}`
      });
      setSettings(payload.safety);
      setHaltNewOrders(payload.safety.haltNewOrders);
      setDepositsDisabled(payload.safety.depositsDisabled);
      setWithdrawsDisabled(payload.safety.withdrawsDisabled);
      setGridStartsDisabled(payload.safety.gridStartsDisabled);
      setProfitClaimsDisabled(payload.safety.profitClaimsDisabled);
      setFundingVaultLaunchesDisabled(payload.safety.fundingVaultLaunchesDisabled);
      setFundingVaultWithdrawsDisabled(payload.safety.fundingVaultWithdrawsDisabled);
      setCloseOnlyUsersInput(payload.safety.closeOnlyAllUserIds.join("\n"));
      setReason(payload.safety.reason ?? "");
      setLastCloseOnlyResult(payload.result);
      setNotice(t("messages.closeOnlyTriggered"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adminPageStack">
      <AdminPageHeader
        eyebrow="Vault Controls"
        title={t("title")}
        description={t("subtitle")}
        actions={[
          { href: withLocalePath("/admin", locale), label: tCommon("backToAdmin"), icon: "back", variant: "secondary" }
        ]}
      />

      {loading ? <div className="settingsMutedText">{t("loading")}</div> : null}
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="success">{notice}</AdminNotice> : null}

      {isAdmin ? (
        <>
          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("sectionTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {t("sourceLabel")}: {settings?.source ?? "default"} · {t("lastUpdatedLabel")}: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : t("never")}
            </div>

              <label className="adminCheckboxLabel">
                <DeskInput
                  type="checkbox"
                  checked={haltNewOrders}
                  onChange={(event) => setHaltNewOrders(event.target.checked)}
                />
                <span>{t("haltNewOrdersLabel")}</span>
              </label>

              <div className="adminFilterGrid">
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={depositsDisabled}
                    onChange={(event) => setDepositsDisabled(event.target.checked)}
                  />
                  <span>Deposits disabled</span>
                </label>
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={withdrawsDisabled}
                    onChange={(event) => setWithdrawsDisabled(event.target.checked)}
                  />
                  <span>Withdraws disabled</span>
                </label>
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={gridStartsDisabled}
                    onChange={(event) => setGridStartsDisabled(event.target.checked)}
                  />
                  <span>Grid starts disabled</span>
                </label>
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={profitClaimsDisabled}
                    onChange={(event) => setProfitClaimsDisabled(event.target.checked)}
                  />
                  <span>Profit claims disabled</span>
                </label>
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={fundingVaultLaunchesDisabled}
                    onChange={(event) => setFundingVaultLaunchesDisabled(event.target.checked)}
                  />
                  <span>Funding Vault launches disabled</span>
                </label>
                <label className="adminCheckboxLabel">
                  <DeskInput
                    type="checkbox"
                    checked={fundingVaultWithdrawsDisabled}
                    onChange={(event) => setFundingVaultWithdrawsDisabled(event.target.checked)}
                  />
                  <span>Funding Vault withdraws disabled</span>
                </label>
              </div>

            <div className="settingsFormGrid">
              <label>
                {t("closeOnlyUsersLabel")}
                <DeskTextarea
                  className="input"
                  rows={6}
                  value={closeOnlyUsersInput}
                  onChange={(event) => setCloseOnlyUsersInput(event.target.value)}
                  placeholder={t("userListPlaceholder")}
                />
              </label>
              <label>
                {t("reasonLabel")}
                <DeskTextarea
                  className="input"
                  rows={6}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("reasonPlaceholder")}
                />
              </label>
            </div>

            <div className="adminInlineActions">
              <AdminActionButton icon="save" variant="primary" type="button" onClick={() => void save()} loading={saving} loadingLabel={tCommon("saving")}>
                {t("save")}
              </AdminActionButton>
            </div>
          </section></DeskSurface>

          <DeskSurface dense><section className="card settingsSection">
            <div className="settingsSectionHeader">
              <h3 className="adminSubsectionTitle">{t("closeOnlyAllTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {t("closeOnlyAllHint")}
            </div>

            <div className="settingsFormGrid">
              <label>
                {t("targetUserIdLabel")}
                <DeskInput
                  className="input"
                  value={closeOnlyTargetUserId}
                  onChange={(event) => setCloseOnlyTargetUserId(event.target.value)}
                  placeholder={t("targetUserIdPlaceholder")}
                />
              </label>
            </div>

            <div className="adminInlineActions">
              <AdminActionButton icon="stop" type="button" onClick={() => void triggerCloseOnlyAll()} loading={saving} loadingLabel={tCommon("saving")}>
                {t("triggerCloseOnlyAll")}
              </AdminActionButton>
            </div>

            {lastCloseOnlyResult ? (
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <strong>{t("lastResultTitle")}</strong>
                <div>{t("resultScanned", { count: lastCloseOnlyResult.scanned })}</div>
                <div>{t("resultUpdated", { count: lastCloseOnlyResult.updated })}</div>
                <div>{t("resultFailed", { count: lastCloseOnlyResult.failed.length })}</div>
              </div>
            ) : null}
          </section></DeskSurface>
        </>
      ) : null}
    </div>
  );
}
