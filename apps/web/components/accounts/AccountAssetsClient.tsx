"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { PageHeader, Section } from "../../app/components/ui";

type AccountAsset = {
  asset: string;
  available: number | null;
  locked: number | null;
  total: number | null;
  approxUsd: number | null;
  quoteSymbol: string | null;
};

type AccountAssetOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  marketDataExchange: string;
  status: "ok" | "empty" | "unsupported" | "error";
  updatedAt: string | null;
  error: { code: string; message: string } | null;
  quoteAsset: "USDT" | "USDC";
  totals: { assets: number; approxUsd: number | null };
  assets: AccountAsset[];
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

function statusClass(status: AccountAssetOverview["status"]): string {
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
    let approxUsd = 0;
    let hasApproxUsd = false;
    let partialErrors = 0;

    for (const account of visibleAccounts) {
      if (account.status === "error") partialErrors += 1;
      assetCount += account.visibleAssets.length;
      for (const asset of account.visibleAssets) {
        if (asset.approxUsd === null) continue;
        approxUsd += asset.approxUsd;
        hasApproxUsd = true;
      }
    }

    return {
      accounts: visibleAccounts.length,
      assets: assetCount,
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
          <button
            type="button"
            className="btn btnPrimary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? t("actions.refreshing") : t("actions.refresh")}
          </button>
        )}
      />

      {query.isError ? (
        <div className="accountsErrorCard" role="alert">
          <strong>{t("errors.loadTitle")}</strong>
          <span>{errMsg(query.error)}</span>
        </div>
      ) : null}

      <section className="accountsSummaryGrid" aria-label={t("summary.ariaLabel")}>
        <div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.accounts")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.accounts}</div>
          <div className="uiMetricMeta">{t("summary.visible")}</div>
        </div>
        <div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.assets")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.assets}</div>
          <div className="uiMetricMeta">{t("summary.spotOnly")}</div>
        </div>
        <div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.approxUsd")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : formatUsd(summary.approxUsd)}</div>
          <div className="uiMetricMeta">{t("summary.bestEffort")}</div>
        </div>
        <div className="uiMetricTile">
          <div className="uiMetricLabel">{t("summary.partialErrors")}</div>
          <div className="uiMetricValue">{isInitialLoading ? "--" : summary.partialErrors}</div>
          <div className="uiMetricMeta">{formatDateTime(query.data?.meta.updatedAt)}</div>
        </div>
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
            <select
              className="input"
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">{t("filters.allAccounts")}</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          </label>
          <label className="accountsFilterField">
            <span>{t("filters.exchange")}</span>
            <select
              className="input"
              value={exchangeFilter}
              onChange={(event) => setExchangeFilter(event.target.value)}
            >
              <option value="">{t("filters.allExchanges")}</option>
              {exchangeOptions.map((exchange) => (
                <option key={exchange} value={exchange}>{exchange.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="accountsFilterField">
            <span>{t("filters.asset")}</span>
            <input
              className="input"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder={t("filters.assetPlaceholder")}
            />
          </label>
          <label className="accountsZeroToggle">
            <input
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
            <section key={account.exchangeAccountId} className="card accountsAccountCard">
              <header className="accountsAccountHeader">
                <div>
                  <h2 className="accountsAccountTitle">
                    {account.exchange.toUpperCase()} - {account.label}
                  </h2>
                  <div className="accountsAccountMeta">
                    {t("account.marketData", { exchange: account.marketDataExchange.toUpperCase() })}
                    {" | "}
                    {t("account.updated", { value: formatDateTime(account.updatedAt) })}
                  </div>
                </div>
                <div className="accountsAccountHeaderRight">
                  <span className={statusClass(account.status)}>{t(`status.${account.status}`)}</span>
                  <span className="badge">{account.quoteAsset}</span>
                </div>
              </header>

              {account.error ? (
                <div className="accountsInlineError">
                  <strong>{account.error.code}</strong>
                  <span>{account.error.message}</span>
                </div>
              ) : null}

              {account.status === "unsupported" ? (
                <div className="accountsMutedState">{t("account.unsupported")}</div>
              ) : account.status === "empty" ? (
                <div className="accountsMutedState">{t("account.empty")}</div>
              ) : account.visibleAssets.length === 0 ? (
                <div className="accountsMutedState">{t("account.noFilterMatch")}</div>
              ) : (
                <>
                  <div className="accountsDesktopTableWrap">
                    <table className="accountsAssetTable">
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
                    </table>
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
