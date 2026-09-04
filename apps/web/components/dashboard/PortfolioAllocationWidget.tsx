"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ExchangeAccountOverview } from "../../app/components/ExchangeAccountOverviewCard";

type Position = {
  exchangeAccountId: string;
  size: number;
  entryPrice: number | null;
};

type AllocationItem = {
  id: "spot" | "available" | "used";
  value: number;
};

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

export default function PortfolioAllocationWidget({
  accounts,
  positions,
  loading
}: {
  accounts: ExchangeAccountOverview[];
  positions: Position[];
  loading: boolean;
}) {
  const t = useTranslations("dashboard.portfolioAllocation");
  const locale = useLocale();
  const [accountFilter, setAccountFilter] = useState("all");

  const filteredAccounts = useMemo(
    () => accountFilter === "all"
      ? accounts
      : accounts.filter((account) => account.exchangeAccountId === accountFilter),
    [accountFilter, accounts]
  );
  const allocation = useMemo(() => {
    const values = filteredAccounts.reduce(
      (result, account) => {
        const spot = finiteOrNull(account.spotBudget?.total) ?? finite(account.spotBudget?.available);
        const equity = finiteOrNull(account.futuresBudget?.equity) ?? finite(account.futuresBudget?.availableMargin);
        const available = Math.min(equity, finite(account.futuresBudget?.availableMargin));
        result.spot += spot;
        result.available += available;
        result.used += Math.max(0, equity - available);
        return result;
      },
      { spot: 0, available: 0, used: 0 }
    );
    const items: AllocationItem[] = [
      { id: "spot", value: values.spot },
      { id: "available", value: values.available },
      { id: "used", value: values.used }
    ];
    const total = items.reduce((sum, item) => sum + item.value, 0);
    return { items, total };
  }, [filteredAccounts]);

  const filteredPositions = positions.filter(
    (position) => accountFilter === "all" || position.exchangeAccountId === accountFilter
  );
  const exposure = filteredPositions.reduce(
    (sum, position) => sum + finite(position.size) * finite(position.entryPrice),
    0
  );
  const money = (value: number) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);

  return (
    <div className="card dashboardInsightCard dashboardPortfolioAllocationCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div>
          <div className="dashboardCompactWidgetTitle">{t("title")}</div>
          <div className="dashboardCompactWidgetSubtitle">{t("subtitle")}</div>
        </div>
        <select
          className="select dashboardPortfolioFilter"
          value={accountFilter}
          onChange={(event) => setAccountFilter(event.target.value)}
          aria-label={t("filterLabel")}
        >
          <option value="all">{t("allAccounts")}</option>
          {accounts.map((account) => (
            <option key={account.exchangeAccountId} value={account.exchangeAccountId}>
              {account.exchange.toUpperCase()} · {account.label}
            </option>
          ))}
        </select>
      </div>

      {loading && accounts.length === 0 ? (
        <div className="dashboardCompactWidgetState">{t("loading")}</div>
      ) : allocation.total <= 0 ? (
        <div className="dashboardCompactWidgetState">{t("empty")}</div>
      ) : (
        <div className="dashboardPortfolioBody dashboardWidgetScrollArea">
          <div className="dashboardPortfolioTotal">
            <span>{t("total")}</span>
            <strong>{money(allocation.total)}</strong>
          </div>
          <div className="dashboardPortfolioBar" aria-label={t("allocationLabel")}>
            {allocation.items.map((item) => (
              <span
                key={item.id}
                className={`dashboardPortfolioBarSegment dashboardPortfolioBarSegment-${item.id}`}
                style={{ width: `${(item.value / allocation.total) * 100}%` }}
              />
            ))}
          </div>
          <div className="dashboardPortfolioLegend">
            {allocation.items.map((item) => (
              <div key={item.id} className="dashboardPortfolioLegendRow">
                <span className={`dashboardPortfolioDot dashboardPortfolioDot-${item.id}`} />
                <span>{t(`segments.${item.id}`)}</span>
                <strong>{money(item.value)}</strong>
                <small>{((item.value / allocation.total) * 100).toFixed(1)}%</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboardPortfolioExposure">
        <span>{t("openExposure", { count: filteredPositions.length })}</span>
        <strong>{money(exposure)}</strong>
      </div>
    </div>
  );
}
