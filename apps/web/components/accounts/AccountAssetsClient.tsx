"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTable } from "@/components/desk/DeskTable";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";
import { PageHeader, Section } from "../../app/components/ui";

type AccountAsset = {
  asset: string;
  available: number | null;
  locked: number | null;
  total: number | null;
  approxUsd: number | null;
  quoteSymbol: string | null;
};

type AccountMarketStatus = "ok" | "empty" | "unsupported" | "error";

type AccountPerpOverview = {
  status: AccountMarketStatus;
  updatedAt: string | null;
  error: { code: string; message: string } | null;
  marginAsset: "USDT" | "USDC";
  equityUsd: number | null;
  availableMarginUsd: number | null;
  marginMode: string | null;
};

type AccountAssetOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  marketDataExchange: string;
  status: AccountMarketStatus;
  updatedAt: string | null;
  error: { code: string; message: string } | null;
  quoteAsset: "USDT" | "USDC";
  totals: { assets: number; approxUsd: number | null };
  assets: AccountAsset[];
  perp: AccountPerpOverview;
};

type AccountAssetsResponse = {
  accounts: AccountAssetOverview[];
  meta: {
    updatedAt: string;
    partialErrors: number;
  };
};

type VisibleAccount = AccountAssetOverview & {
  visibleAssets: AccountAsset[];
};

function formatNumber(value: number | null | undefined, maxFractionDigits = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits
  }).format(value);
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

function statusClass(status: AccountMarketStatus): string {
  if (status === "ok") return "badge badgeOk";
  if (status === "error") return "badge badgeDanger";
  return "badge badgeWarn";
}

function buildAssetQuery(includeZero: boolean): string {
  return `/exchange-accounts/assets${includeZero ? "?includeZero=true" : ""}`;
}

export default function AccountAssetsClient() {
  const t = useTranslations("accounts");
  const searchParams = useSearchParams();
  const requestedAccountId = searchParams.get("exchangeAccountId") ?? "";
  const [accountFilter, setAccountFilter] = useState(requestedAccountId);
  const [exchangeFilter, setExchangeFilter] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [includeZero, setIncludeZero] = useState(false);

  const query = useQuery({
    queryKey: ["exchange-account-assets", includeZero],
    queryFn: () => apiGet<AccountAssetsResponse>(buildAssetQuery(includeZero))
  });

  const accounts = query.data?.accounts ?? [];
  const normalizedAssetSearch = assetSearch.trim().toUpperCase();

  const accountOptions = useMemo(
    () => accounts.map((account) => ({
      id: account.exchangeAccountId,
      label: `${account.exchange.toUpperCase()} - ${account.label}`
    })),
    [accounts]
  );

  const exchangeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const account of accounts) {
      if (account.exchange) values.add(account.exchange);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  const visibleAccounts = useMemo<VisibleAccount[]>(() => {
    return accounts
      .filter((account) => !accountFilter || account.exchangeAccountId === accountFilter)
      .filter((account) => !exchangeFilter || account.exchange === exchangeFilter)
      .map((account) => {
        const visibleAssets = normalizedAssetSearch
          ? account.assets.filter((asset) => asset.asset.includes(normalizedAssetSearch))
          : account.assets;
        return { ...account, visibleAssets };
      })
      .filter((account) => {
        if (!normalizedAssetSearch) return true;
        return account.visibleAssets.length > 0;
      });
  }, [accountFilter, accounts, exchangeFilter, normalizedAssetSearch]);

  const summary = useMemo(() => {
    let assetCount = 0;
    let perpAccountCount = 0;
    let approxUsd = 0;
    let hasApproxUsd = false;
    let partialErrors = 0;

    for (const account of visibleAccounts) {
      if (account.status === "error" || account.perp.status === "error") partialErrors += 1;
      if (account.perp.status !== "unsupported") perpAccountCount += 1;
      assetCount += account.visibleAssets.length;
      for (const asset of account.visibleAssets) {
        if (asset.approxUsd === null) continue;
        approxUsd += asset.approxUsd;
        hasApproxUsd = true;
      }
      if (account.perp.equityUsd !== null) {
        approxUsd += account.perp.equityUsd;
        hasApproxUsd = true;
      }
    }

    return {
      accounts: visibleAccounts.length,
      assets: assetCount,
      perpAccounts: perpAccountCount,
      approxUsd: hasApproxUsd ? approxUsd : null,
      partialErrors
    };
  }, [visibleAccounts]);

  const isInitialLoading = query.isLoading && !query.data;

  return (
    <div className="uiPage accountsPage">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("subtitle")}
        actions={(
          <DeskButton
            type="button"
            className="btn btnPrimary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <AppIcon name="refresh" />
            {query.isFetching ? t("actions.refreshing") : t("actions.refresh")}
          </DeskButton>
        )}
      />

      {query.isError ? (
        <div className="accountsErrorCard" role="alert">
          <strong>{t("errors.loadTitle")}</strong>
          <span>{errMsg(query.error)}</span>
        </div>
      ) : null}

      <section className="accountsSummaryGrid" aria-label={t("summary.ariaLabel")}>
        <DeskSurface dense><div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.accounts")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.accounts}</div>
          <div className="uiMetricMeta">{t("summary.visible")}</div>
        </div></DeskSurface>
        <DeskSurface dense><div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.assets")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.assets}</div>
          <div className="uiMetricMeta">{t("summary.spotAssets")}</div>
        </div></DeskSurface>
        <DeskSurface dense><div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.perpAccounts")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.perpAccounts}</div>
          <div className="uiMetricMeta">{t("summary.perpEnabled")}</div>
        </div></DeskSurface>
        <DeskSurface dense><div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.approxUsd")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : formatUsd(summary.approxUsd)}</div>
          <div className="uiMetricMeta">{t("summary.spotAndPerp")}</div>
        </div></DeskSurface>
        <DeskSurface dense><div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.partialErrors")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.partialErrors}</div>
          <div className="uiMetricMeta">{formatDateTime(query.data?.meta.updatedAt)}</div>
        </div></DeskSurface>
      </section>

      <Section
        title={t("filters.title")}
        description={t("filters.description")}
        density="compact"
        className="accountsFilterSection"
      >
        <div className="accountsFilters">
          <label className="accountsFilterField">
            <span>{t("filters.account")}</span>
            <DeskSelect
              className="input"
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">{t("filters.allAccounts")}</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </DeskSelect>
          </label>
          <label className="accountsFilterField">
            <span>{t("filters.exchange")}</span>
            <DeskSelect
              className="input"
              value={exchangeFilter}
              onChange={(event) => setExchangeFilter(event.target.value)}
            >
              <option value="">{t("filters.allExchanges")}</option>
              {exchangeOptions.map((exchange) => (
                <option key={exchange} value={exchange}>{exchange.toUpperCase()}</option>
              ))}
            </DeskSelect>
          </label>
          <label className="accountsFilterField">
            <span>{t("filters.asset")}</span>
            <DeskInput
              className="input"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder={t("filters.assetPlaceholder")}
            />
          </label>
          <label className="accountsZeroToggle">
            <DeskInput
              type="checkbox"
              checked={includeZero}
              onChange={(event) => setIncludeZero(event.target.checked)}
            />
            <span>{t("filters.includeZero")}</span>
          </label>
        </div>
      </Section>

      {isInitialLoading ? (
        <div className="accountsStack" aria-hidden="true">
          <div className="card accountsSkeletonCard" />
          <div className="card accountsSkeletonCard" />
        </div>
      ) : visibleAccounts.length === 0 ? (
        <div className="uiEmptyState">
          <div>
            <strong>{t("empty.title")}</strong>
            <div>{t("empty.description")}</div>
          </div>
        </div>
      ) : (
        <div className="accountsStack">
          {visibleAccounts.map((account) => (
            <DeskSurface dense><section key={account.exchangeAccountId} className="card accountsAccountCard">
              <header className="accountsAccountHeader">
                <div>
                  <h2 className="accountsAccountTitle">
                    {account.exchange.toUpperCase()} - {account.label}
                  </h2>
                  <div className="accountsAccountMeta">
                    {t("account.marketData", { exchange: account.marketDataExchange.toUpperCase() })}
                    {" | "}
                    {t("account.updated", { value: formatDateTime(account.updatedAt ?? account.perp.updatedAt) })}
                  </div>
                </div>
                <div className="accountsAccountHeaderRight">
                  <span className={statusClass(account.status)}>
                    {t("account.spotStatus", { status: t(`status.${account.status}`) })}
                  </span>
                  <span className={statusClass(account.perp.status)}>
                    {t("account.perpStatus", { status: t(`status.${account.perp.status}`) })}
                  </span>
                  <span className="badge">{account.quoteAsset}</span>
                </div>
              </header>

              <div className="accountsMarketSection">
                <div className="accountsMarketSectionHeader">
                  <h3>{t("spot.title")}</h3>
                  <span>{formatUsd(account.totals.approxUsd)}</span>
                </div>

                {account.error ? (
                  <div className="accountsInlineError">
                    <strong>{account.error.code}</strong>
                    <span>{account.error.message}</span>
                  </div>
                ) : null}

                {account.status === "unsupported" ? (
                  <div className="accountsMutedState">{t("spot.unsupported")}</div>
                ) : account.status === "empty" ? (
                  <div className="accountsMutedState">{t("spot.empty")}</div>
                ) : account.visibleAssets.length === 0 ? (
                  <div className="accountsMutedState">{t("spot.noFilterMatch")}</div>
                ) : (
                  <>
                    <div className="accountsDesktopTableWrap">
                      <DeskTable className="accountsAssetTable">
                        <thead>
                          <tr>
                            <th>{t("table.asset")}</th>
                            <th>{t("table.available")}</th>
                            <th>{t("table.locked")}</th>
                            <th>{t("table.total")}</th>
                            <th>{t("table.approxUsd")}</th>
                            <th>{t("table.quote")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {account.visibleAssets.map((asset) => (
                            <tr key={`${account.exchangeAccountId}-${asset.asset}`}>
                              <td><strong>{asset.asset}</strong></td>
                              <td>{formatNumber(asset.available)}</td>
                              <td>{formatNumber(asset.locked)}</td>
                              <td>{formatNumber(asset.total)}</td>
                              <td>{formatUsd(asset.approxUsd)}</td>
                              <td>{asset.quoteSymbol ?? "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </DeskTable>
                    </div>

                    <div className="accountsMobileAssetList">
                      {account.visibleAssets.map((asset) => (
                        <article key={`${account.exchangeAccountId}-${asset.asset}-mobile`} className="accountsMobileAssetCard">
                          <div className="accountsMobileAssetTop">
                            <strong>{asset.asset}</strong>
                            <span>{formatUsd(asset.approxUsd)}</span>
                          </div>
                          <div className="accountsMobileAssetGrid">
                            <div><span>{t("table.available")}</span><strong>{formatNumber(asset.available)}</strong></div>
                            <div><span>{t("table.locked")}</span><strong>{formatNumber(asset.locked)}</strong></div>
                            <div><span>{t("table.total")}</span><strong>{formatNumber(asset.total)}</strong></div>
                            <div><span>{t("table.quote")}</span><strong>{asset.quoteSymbol ?? "--"}</strong></div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="accountsMarketSection">
                <div className="accountsMarketSectionHeader">
                  <h3>{t("perp.title")}</h3>
                  <span>{formatUsd(account.perp.equityUsd)}</span>
                </div>

                {account.perp.error ? (
                  <div className="accountsInlineError">
                    <strong>{account.perp.error.code}</strong>
                    <span>{account.perp.error.message}</span>
                  </div>
                ) : null}

                {account.perp.status === "unsupported" ? (
                  <div className="accountsMutedState">{t("perp.unsupported")}</div>
                ) : account.perp.status === "error" ? null : (
                  <div className="accountsPerpGrid">
                    <div className="accountsPerpMetric">
                      <span>{t("perp.equity")}</span>
                      <strong>{formatUsd(account.perp.equityUsd)}</strong>
                    </div>
                    <div className="accountsPerpMetric">
                      <span>{t("perp.availableMargin")}</span>
                      <strong>{formatUsd(account.perp.availableMarginUsd)}</strong>
                    </div>
                    <div className="accountsPerpMetric">
                      <span>{t("perp.marginAsset")}</span>
                      <strong>{account.perp.marginAsset}</strong>
                    </div>
                    <div className="accountsPerpMetric">
                      <span>{t("perp.marginMode")}</span>
                      <strong>{account.perp.marginMode ?? "--"}</strong>
                    </div>
                  </div>
                )}
              </div>
            </section></DeskSurface>
          ))}
        </div>
      )}
    </div>
  );
}
