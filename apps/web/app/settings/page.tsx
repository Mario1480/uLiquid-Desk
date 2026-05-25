"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAccount, useChainId } from "wagmi";
import { signMessage } from "wagmi/actions";
import { ApiError, apiGet } from "../../lib/api";
import { buildSiweMessage, fetchSiweNonce, linkSiweWallet, shortenWalletAddress, unlinkSiweWallet } from "../../lib/auth/siwe";
import { wagmiConfig } from "../../lib/web3/config";
import { LOCALE_COOKIE_NAME, withLocalePath, type AppLocale } from "../../i18n/config";
import AdminConfirmDialog from "../admin/_components/AdminConfirmDialog";
import { AppIcon, type AppIconName } from "../components/AppIcon";
import { Notice, PageHeader } from "../components/ui";
import Web3Providers from "../components/Web3Providers";

type MeResponse = {
  user: { id: string; email: string; walletAddress?: string | null };
  walletAddress?: string | null;
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
};

type ExchangeAccountsResponse = {
  items?: Array<{
    id: string;
    exchange: string;
    label: string;
    credentialExpiryState?: "healthy" | "warning" | "expired" | null;
    lastSyncError?: { message?: string | null } | null;
  }>;
};

type SecurityResponse = {
  autoLogoutEnabled?: boolean;
  autoLogoutMinutes?: number;
  reauthOtpEnabled?: boolean;
};

type AlertsResponse = {
  telegramLink?: { status?: string | null };
  dailyEconomicCalendar?: { enabled?: boolean };
};

type SessionsResponse = {
  items?: Array<{
    id: string;
    isCurrent: boolean;
    expiresAt: string | null;
  }>;
};

type LegalAcknowledgementsResponse = {
  currentVersion?: string;
  latest?: {
    version: string;
    acceptedAt: string | null;
  } | null;
};

type FundingVaultOverview = {
  mode?: string;
  ready?: boolean;
  fundingVault?: {
    id: string | null;
    onchainAddress: string | null;
    availableBalance?: number;
    freeBalance?: number;
    reservedBalance?: number;
    status?: string;
    lastSyncedAt?: string | null;
  } | null;
  setup?: {
    canCreate?: boolean;
    needsLinkedWallet?: boolean;
    needsAgentWallet?: boolean;
    needsOnchainAddress?: boolean;
  } | null;
};

type BotVaultSettingsOverview = {
  counts?: {
    total?: number;
    in_use?: number;
    unused?: number;
    error?: number;
    manualEmptyAvailable?: number;
  };
  totals?: {
    capitalUsd?: number;
    residualCapitalUsd?: number;
  };
};

type AffiliateSummaryResponse = {
  profile?: { status?: string | null };
  program?: { enabled?: boolean; platformFeeRatePct?: number; defaultAffiliateFeeRatePct?: number };
  effectiveFeeRatePct?: number;
  stats?: { referredUsers?: number; unpaidAffiliateUsd?: number };
  referredBy?: { email?: string | null } | null;
};

type HubCardProps = {
  icon: AppIconName;
  title: string;
  description: string;
  meta?: string | null;
  badge?: string | null;
  href?: string;
  actionLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
};

type HubGroupProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function normalizeWalletAddress(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function formatMoney(value: number | null | undefined, currency = "USDC"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function HubGroup({ title, description, children }: HubGroupProps) {
  return (
    <section className="settingsHubGroup">
      <div className="settingsHubGroupHeader">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settingsHubGrid">{children}</div>
    </section>
  );
}

function HubCard({
  icon,
  title,
  description,
  meta,
  badge,
  href,
  actionLabel,
  disabled = false,
  children
}: HubCardProps) {
  const content = (
    <>
      <div className="settingsHubCardTop">
        <span className="settingsHubIcon">
          <AppIcon name={icon} />
        </span>
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <div className="settingsHubCardBody">
        <h3>{title}</h3>
        <p>{description}</p>
        {meta ? <div className="settingsMutedText">{meta}</div> : null}
      </div>
      {children ? <div className="settingsHubCardExtra">{children}</div> : null}
      {href && !disabled ? (
        <span className="btn settingsHubCardAction">
          <AppIcon name="open" />
          {actionLabel}
        </span>
      ) : disabled ? (
        <span className="btn settingsHubCardAction" aria-disabled="true">
          <AppIcon name="disable" />
          {actionLabel}
        </span>
      ) : null}
    </>
  );

  if (href && !disabled) {
    return (
      <Link className="card settingsHubCard" href={href}>
        {content}
      </Link>
    );
  }

  return <div className={`card settingsHubCard ${disabled ? "settingsHubCardDisabled" : ""}`}>{content}</div>;
}

function SettingsHubContent() {
  const t = useTranslations("settings.hub");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address: connectedWalletAddress, isConnected: isWalletConnected } = useAccount();
  const connectedWalletChainId = useChainId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [hasAdminBackendAccess, setHasAdminBackendAccess] = useState(false);
  const [accounts, setAccounts] = useState<ExchangeAccountsResponse["items"]>([]);
  const [security, setSecurity] = useState<SecurityResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse["items"]>([]);
  const [legal, setLegal] = useState<LegalAcknowledgementsResponse | null>(null);
  const [fundingVault, setFundingVault] = useState<FundingVaultOverview | null>(null);
  const [botVaultOverview, setBotVaultOverview] = useState<BotVaultSettingsOverview | null>(null);
  const [affiliate, setAffiliate] = useState<AffiliateSummaryResponse | null>(null);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [walletLinkStatus, setWalletLinkStatus] = useState<string | null>(null);
  const [walletLinkError, setWalletLinkError] = useState<string | null>(null);
  const [walletLinking, setWalletLinking] = useState(false);
  const [walletUnlinking, setWalletUnlinking] = useState(false);
  const [confirmWalletUnlink, setConfirmWalletUnlink] = useState(false);

  const linkedWalletAddress = String(me?.walletAddress ?? "").trim();
  const normalizedLinkedWalletAddress = normalizeWalletAddress(linkedWalletAddress);
  const normalizedConnectedWalletAddress = normalizeWalletAddress(connectedWalletAddress);
  const walletLinkMismatch = Boolean(
    normalizedLinkedWalletAddress
    && normalizedConnectedWalletAddress
    && normalizedLinkedWalletAddress !== normalizedConnectedWalletAddress
  );
  const walletActionBusy = walletLinking || walletUnlinking;
  const exchangeHealthIssues = (accounts ?? []).filter((account) => (
    account.lastSyncError?.message || account.credentialExpiryState === "warning" || account.credentialExpiryState === "expired"
  )).length;
  const fundingVaultBalance = numberOrNull(
    fundingVault?.fundingVault?.availableBalance ?? fundingVault?.fundingVault?.freeBalance
  );
  const fundingVaultAddress = fundingVault?.fundingVault?.onchainAddress ?? null;
  const subscriptionStatus = String(
    subscription?.status
    ?? subscription?.license?.status
    ?? subscription?.subscription?.status
    ?? subscription?.plan
    ?? "-"
  );
  const subscriptionPlan = String(
    subscription?.plan
    ?? subscription?.license?.plan
    ?? subscription?.subscription?.plan
    ?? ""
  );
  const affiliateUnpaid = numberOrNull(affiliate?.stats?.unpaidAffiliateUsd);

  const currentSession = useMemo(
    () => (sessions ?? []).find((session) => session.isCurrent) ?? null,
    [sessions]
  );

  async function loadHub() {
    setLoading(true);
    setError(null);
    try {
      const [
        meRes,
        accountRes,
        securityRes,
        alertsRes,
        sessionsRes,
        legalRes,
        fundingRes,
        botVaultRes,
        affiliateRes,
        subscriptionRes
      ] = await Promise.all([
        apiGet<MeResponse>("/auth/me"),
        apiGet<ExchangeAccountsResponse>("/exchange-accounts").catch(() => null),
        apiGet<SecurityResponse>("/settings/security").catch(() => null),
        apiGet<AlertsResponse>("/settings/alerts").catch(() => null),
        apiGet<SessionsResponse>("/settings/sessions").catch(() => null),
        apiGet<LegalAcknowledgementsResponse>("/settings/legal-acknowledgements").catch(() => null),
        apiGet<FundingVaultOverview>("/vaults/funding-vault").catch(() => null),
        apiGet<BotVaultSettingsOverview>("/vaults/bot-vaults/overview").catch(() => null),
        apiGet<AffiliateSummaryResponse>("/settings/affiliate").catch(() => null),
        apiGet<any>("/settings/subscription").catch(() => null)
      ]);

      setMe(meRes.user);
      setIsSuperadmin(Boolean(meRes.isSuperadmin));
      setHasAdminBackendAccess(Boolean(meRes.isSuperadmin || meRes.hasAdminBackendAccess));
      setAccounts(accountRes?.items ?? []);
      setSecurity(securityRes);
      setAlerts(alertsRes);
      setSessions(sessionsRes?.items ?? []);
      setLegal(legalRes);
      setFundingVault(fundingRes);
      setBotVaultOverview(botVaultRes);
      setAffiliate(affiliateRes);
      setSubscription(subscriptionRes);
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHub();
  }, []);

  useEffect(() => {
    const section = String(searchParams.get("section") ?? "").trim().toLowerCase();
    const target =
      section === "exchange" || section === "exchange_settings"
        ? "/settings/exchange-accounts"
        : section === "security"
          ? "/settings/security"
          : section === "notifications"
            ? "/settings/notifications"
            : section === "license" || section === "license_management"
              ? "/settings/subscription"
              : section === "affiliate"
                ? "/settings/affiliate"
                : null;
    if (target) router.replace(withLocalePath(target, locale));
  }, [locale, router, searchParams]);

  function switchLocale(targetLocale: AppLocale) {
    if (targetLocale === locale) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${targetLocale}; path=/; max-age=31536000`;
    window.location.assign(withLocalePath("/settings", targetLocale));
  }

  function resolveSiweUiError(errorToResolve: unknown): string {
    if (errorToResolve instanceof ApiError) {
      const code = String(errorToResolve.payload?.error ?? "").trim();
      if (code === "wallet_already_linked") return t("wallet.errors.walletAlreadyLinked");
      if (code === "siwe_address_mismatch") return t("wallet.errors.siweAddressMismatch");
      if (code === "siwe_nonce_expired") return t("wallet.errors.siweNonceExpired");
    }
    return errMsg(errorToResolve);
  }

  async function linkConnectedWalletAction() {
    setWalletLinking(true);
    setWalletLinkError(null);
    setWalletLinkStatus(t("wallet.statusLinking"));

    if (!isWalletConnected || !connectedWalletAddress) {
      setWalletLinking(false);
      setWalletLinkStatus(null);
      setWalletLinkError(t("wallet.connectFirst"));
      return;
    }
    if (
      normalizedConnectedWalletAddress
      && normalizedLinkedWalletAddress
      && normalizedConnectedWalletAddress === normalizedLinkedWalletAddress
    ) {
      setWalletLinking(false);
      setWalletLinkStatus(t("wallet.alreadyLinked"));
      setWalletLinkError(null);
      return;
    }

    try {
      const noncePayload = await fetchSiweNonce();
      const message = buildSiweMessage({
        domain: window.location.host,
        address: connectedWalletAddress,
        uri: window.location.origin,
        chainId: Number(connectedWalletChainId || 999),
        nonce: noncePayload.nonce,
        statement: t("wallet.statement")
      });
      const signature = await signMessage(wagmiConfig, {
        account: connectedWalletAddress as `0x${string}`,
        message
      });
      const linked = await linkSiweWallet({ message, signature, address: connectedWalletAddress });
      const nextWallet = linked.walletAddress ?? connectedWalletAddress;
      setMe((prev) => prev ? { ...prev, walletAddress: nextWallet } : prev);
      setWalletLinkStatus(t("wallet.statusLinked", { wallet: shortenWalletAddress(nextWallet) }));
      setWalletLinkError(null);
      await loadHub();
    } catch (linkError) {
      setWalletLinkStatus(null);
      setWalletLinkError(resolveSiweUiError(linkError));
    } finally {
      setWalletLinking(false);
    }
  }

  async function unlinkLinkedWalletAction() {
    if (!normalizedLinkedWalletAddress) return;
    setWalletUnlinking(true);
    setWalletLinkError(null);
    setWalletLinkStatus(t("wallet.statusUnlinking"));
    try {
      await unlinkSiweWallet();
      setMe((prev) => prev ? { ...prev, walletAddress: null } : prev);
      setWalletLinkStatus(t("wallet.statusUnlinked"));
      setWalletLinkError(null);
      setConfirmWalletUnlink(false);
      await loadHub();
    } catch (unlinkError) {
      setWalletLinkStatus(null);
      setWalletLinkError(resolveSiweUiError(unlinkError));
    } finally {
      setWalletUnlinking(false);
    }
  }

  const accountTone = isSuperadmin ? "warning" : "info";
  const exchangeTone = exchangeHealthIssues > 0 ? "danger" : "success";
  const walletTone = walletLinkMismatch ? "danger" : linkedWalletAddress ? "success" : "warning";
  const walletStatusText = walletLinkMismatch
    ? t("summary.walletMismatch")
    : fundingVaultAddress
      ? t("summary.fundingVaultReady")
      : t("summary.walletStatus");

  return (
    <div className="settingsWrap settingsHubWrap">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={(
          <>
            {hasAdminBackendAccess ? (
              <Link className="btn" href={withLocalePath("/admin", locale)}>
                <AppIcon name="admin" />
                {t("actions.admin")}
              </Link>
            ) : null}
            <button className="btn" type="button" onClick={() => void loadHub()} disabled={loading}>
              <AppIcon name="refresh" />
              {loading ? tCommon("loading") : tCommon("reload")}
            </button>
          </>
        )}
      />

      {error ? (
        <Notice tone="danger" className="card settingsAlert settingsAlertError" dismissible onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="success" className="card settingsAlert settingsAlertSuccess" onDismiss={() => setNotice(null)}>
          {notice}
        </Notice>
      ) : null}

      <div className="settingsHubSummary">
        <div className={`uiMetricTile settingsSummaryTile settingsSummaryTile-${accountTone}`}>
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.account")}</span>
            <span className={`settingsSummaryBadge settingsSummaryBadge-${accountTone}`}>
              {isSuperadmin ? t("summary.superadmin") : t("summary.user")}
            </span>
          </div>
          <strong className="settingsSummaryValue">{loading ? tCommon("loading") : me?.email ?? "-"}</strong>
        </div>
        <div className={`uiMetricTile settingsSummaryTile settingsSummaryTile-${exchangeTone}`}>
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.exchanges")}</span>
            <span className={`settingsSummaryBadge settingsSummaryBadge-${exchangeTone}`}>
              {exchangeHealthIssues > 0 ? t("badges.actionRequired") : t("badges.ok")}
            </span>
          </div>
          <strong className="settingsSummaryValue">{accounts?.length ?? 0}</strong>
          <small className="settingsSummaryMeta">
            {exchangeHealthIssues > 0 ? t("summary.exchangeIssues", { count: exchangeHealthIssues }) : t("summary.exchangeHealthy")}
          </small>
        </div>
        <div className={`uiMetricTile settingsSummaryTile settingsSummaryTile-${walletTone}`}>
          <div className="settingsSummaryTop">
            <span className="settingsSummaryLabel">{t("summary.wallet")}</span>
            <span className={`settingsSummaryBadge settingsSummaryBadge-${walletTone}`}>
              {linkedWalletAddress ? t("cards.wallet.ready") : t("cards.wallet.setup")}
            </span>
          </div>
          <strong className="settingsSummaryValue">{linkedWalletAddress ? shortenWalletAddress(linkedWalletAddress) : t("summary.notLinked")}</strong>
          <small className="settingsSummaryMeta">{walletStatusText}</small>
        </div>
      </div>

      <div className="settingsHubGroups">
        <HubGroup title={t("groups.account.title")} description={t("groups.account.description")}>
          <HubCard
            icon="shield"
            title={t("cards.security.title")}
            description={t("cards.security.description")}
            meta={security ? t("cards.security.meta", {
              minutes: security.autoLogoutEnabled === false ? t("cards.security.disabled") : String(security.autoLogoutMinutes ?? 60),
              otp: security.reauthOtpEnabled === false ? t("cards.security.otpOff") : t("cards.security.otpOn"),
              sessions: String(sessions?.length ?? 0)
            }) : null}
            badge={currentSession ? t("cards.security.currentSession") : null}
            href={withLocalePath("/settings/security", locale)}
            actionLabel={t("actions.open")}
          />
          <HubCard
            icon="settings"
            title={t("cards.language.title")}
            description={t("cards.language.description")}
            meta={t("cards.language.meta", { locale: locale.toUpperCase() })}
            actionLabel={t("actions.switch")}
          >
            <div className="settingsHubInlineActions">
              <button className={`btn ${locale === "en" ? "btnPrimary" : ""}`} type="button" onClick={() => switchLocale("en")} disabled={locale === "en"}>
                EN
              </button>
              <button className={`btn ${locale === "de" ? "btnPrimary" : ""}`} type="button" onClick={() => switchLocale("de")} disabled={locale === "de"}>
                DE
              </button>
            </div>
          </HubCard>
          <HubCard
            icon="audit"
            title={t("cards.legal.title")}
            description={t("cards.legal.description")}
            meta={legal?.latest ? t("cards.legal.meta", {
              version: legal.latest.version,
              date: formatDate(legal.latest.acceptedAt)
            }) : t("cards.legal.missing")}
            badge={legal?.latest ? t("cards.legal.accepted") : t("cards.legal.needsReview")}
            actionLabel={t("actions.open")}
          >
            <div className="settingsHubInlineActions">
              <Link className="btn" href={withLocalePath("/terms", locale)}>
                <AppIcon name="detail" />
                {t("cards.legal.terms")}
              </Link>
              <Link className="btn" href={withLocalePath("/privacy", locale)}>
                <AppIcon name="shield" />
                {t("cards.legal.privacy")}
              </Link>
              <Link className="btn" href={withLocalePath("/risk-disclosure", locale)}>
                <AppIcon name="risk" />
                {t("cards.legal.risk")}
              </Link>
            </div>
          </HubCard>
        </HubGroup>

        <HubGroup title={t("groups.wallet.title")} description={t("groups.wallet.description")}>
          <HubCard
            icon="wallet"
            title={t("cards.wallet.title")}
            description={t("cards.wallet.description")}
            meta={linkedWalletAddress ? t("cards.wallet.linked", { wallet: shortenWalletAddress(linkedWalletAddress) }) : t("cards.wallet.notLinked")}
            badge={walletLinkMismatch ? t("cards.wallet.mismatch") : linkedWalletAddress ? t("cards.wallet.ready") : t("cards.wallet.setup")}
            actionLabel={t("actions.manage")}
          >
            <div className={`settingsWalletLinkCard ${walletLinkMismatch ? "settingsWalletLinkCardMismatch" : linkedWalletAddress ? "settingsWalletLinkCardReady" : "settingsWalletLinkCardWarn"}`}>
              <div className="settingsWalletLinkGrid">
                <div className="settingsWalletLinkTile">
                  <span className="settingsFieldLabel">{t("wallet.linkedWallet")}</span>
                  <strong>{linkedWalletAddress ? shortenWalletAddress(linkedWalletAddress) : "-"}</strong>
                </div>
                <div className="settingsWalletLinkTile">
                  <span className="settingsFieldLabel">{t("wallet.connectedWallet")}</span>
                  <strong>{connectedWalletAddress ? shortenWalletAddress(connectedWalletAddress) : "-"}</strong>
                </div>
              </div>
              <div className="settingsWalletLinkActions">
                <button className="btn btnPrimary" type="button" onClick={() => void linkConnectedWalletAction()} disabled={walletActionBusy || !isWalletConnected}>
                  <AppIcon name="link" />
                  {walletLinking ? t("wallet.linking") : linkedWalletAddress ? t("wallet.relink") : t("wallet.link")}
                </button>
                {linkedWalletAddress ? (
                  <button className="btn btnStop" type="button" onClick={() => setConfirmWalletUnlink(true)} disabled={walletActionBusy}>
                    <AppIcon name="unlink" />
                    {walletUnlinking ? t("wallet.unlinking") : t("wallet.unlink")}
                  </button>
                ) : null}
              </div>
              {walletLinkStatus ? <div className="settingsMutedText">{walletLinkStatus}</div> : null}
              {walletLinkError ? <div className="settingsWalletLinkError">{walletLinkError}</div> : null}
            </div>
          </HubCard>
          <HubCard
            icon="funding"
            title={t("cards.fundingVault.title")}
            description={t("cards.fundingVault.description")}
            meta={fundingVaultAddress
              ? t("cards.fundingVault.meta", {
                  wallet: shortenWalletAddress(fundingVaultAddress),
                  balance: formatMoney(fundingVaultBalance)
                })
              : t("cards.fundingVault.setup")}
            badge={fundingVault?.ready ? t("cards.fundingVault.ready") : t("cards.fundingVault.needsSetup")}
            href={withLocalePath("/funding", locale)}
            actionLabel={t("actions.open")}
          />
          <HubCard
            icon="vaults"
            title={t("cards.botVaults.title")}
            description={t("cards.botVaults.description")}
            meta={botVaultOverview
              ? t("cards.botVaults.meta", {
                  total: botVaultOverview.counts?.total ?? 0,
                  capital: formatMoney(numberOrNull(botVaultOverview.totals?.capitalUsd), "USDC"),
                  actions: botVaultOverview.counts?.manualEmptyAvailable ?? 0
                })
              : t("cards.botVaults.loading")}
            badge={botVaultOverview?.counts?.error ? t("badges.actionRequired") : t("badges.ok")}
            href={withLocalePath("/settings/bot-vaults", locale)}
            actionLabel={t("actions.manage")}
          />
          <HubCard
            icon="wallet"
            title={t("cards.walletFunding.title")}
            description={t("cards.walletFunding.description")}
            meta={t("cards.walletFunding.meta")}
            href={withLocalePath("/wallet", locale)}
            actionLabel={t("actions.open")}
          />
        </HubGroup>

        <HubGroup title={t("groups.trading.title")} description={t("groups.trading.description")}>
          <HubCard
            icon="exchange"
            title={t("cards.exchanges.title")}
            description={t("cards.exchanges.description")}
            meta={exchangeHealthIssues > 0 ? t("cards.exchanges.issues", { count: exchangeHealthIssues }) : t("cards.exchanges.meta", { count: accounts?.length ?? 0 })}
            badge={exchangeHealthIssues > 0 ? t("badges.actionRequired") : t("badges.ok")}
            href={withLocalePath("/settings/exchange-accounts", locale)}
            actionLabel={t("actions.manage")}
          />
          <HubCard
            icon="risk"
            title={t("cards.risk.title")}
            description={t("cards.risk.description")}
            meta={t("cards.risk.meta")}
            href={withLocalePath("/settings/risk", locale)}
            actionLabel={t("actions.open")}
          />
          <HubCard
            icon="trading"
            title={t("cards.tradingDefaults.title")}
            description={t("cards.tradingDefaults.description")}
            meta={t("cards.tradingDefaults.meta")}
            badge={t("badges.active")}
            href={withLocalePath("/settings/trading-defaults", locale)}
            actionLabel={t("actions.manage")}
          />
        </HubGroup>

        <HubGroup title={t("groups.notifications.title")} description={t("groups.notifications.description")}>
          <HubCard
            icon="telegram"
            title={t("cards.notifications.title")}
            description={t("cards.notifications.description")}
            meta={t("cards.notifications.meta", {
              telegram: alerts?.telegramLink?.status ?? t("cards.notifications.unknown"),
              calendar: alerts?.dailyEconomicCalendar?.enabled ? t("cards.notifications.calendarOn") : t("cards.notifications.calendarOff")
            })}
            href={withLocalePath("/settings/notifications", locale)}
            actionLabel={t("actions.manage")}
          />
        </HubGroup>

        <HubGroup title={t("groups.billing.title")} description={t("groups.billing.description")}>
          <HubCard
            icon="subscription"
            title={t("cards.subscription.title")}
            description={t("cards.subscription.description")}
            meta={t("cards.subscription.meta", { plan: subscriptionPlan || "-", status: subscriptionStatus })}
            href={withLocalePath("/settings/subscription", locale)}
            actionLabel={t("actions.open")}
          />
          <HubCard
            icon="billing"
            title={t("cards.order.title")}
            description={t("cards.order.description")}
            meta={t("cards.order.meta")}
            href={withLocalePath("/settings/subscription/order", locale)}
            actionLabel={t("actions.open")}
          />
        </HubGroup>

        <HubGroup title={t("groups.affiliate.title")} description={t("groups.affiliate.description")}>
          <HubCard
            icon="money"
            title={t("cards.affiliate.title")}
            description={t("cards.affiliate.description")}
            meta={t("cards.affiliate.meta", {
              status: affiliate?.profile?.status ?? "-",
              rate: String(affiliate?.effectiveFeeRatePct ?? affiliate?.program?.defaultAffiliateFeeRatePct ?? "-"),
              unpaid: formatMoney(affiliateUnpaid, "USD")
            })}
            badge={affiliate?.program?.enabled === false ? t("badges.disabled") : t("badges.active")}
            href={withLocalePath("/settings/affiliate", locale)}
            actionLabel={t("actions.manage")}
          />
        </HubGroup>

      </div>

      <AdminConfirmDialog
        open={confirmWalletUnlink}
        title={t("wallet.confirmUnlinkTitle")}
        description={t("wallet.confirmUnlinkDescription")}
        confirmLabel={t("wallet.unlink")}
        loading={walletUnlinking}
        onCancel={() => setConfirmWalletUnlink(false)}
        onConfirm={() => void unlinkLinkedWalletAction()}
      />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Web3Providers>
      <SettingsHubContent />
    </Web3Providers>
  );
}
