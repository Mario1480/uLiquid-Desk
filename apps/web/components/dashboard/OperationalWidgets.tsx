"use client";

import { DeskSelect } from "@/components/desk/DeskSelect";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import {
  radarState,
  liquidationDistance,
  type RadarBot,
  type LiquidationPosition
} from "../../src/dashboard/workbench";
import { WorkbenchFrame } from "./WorkbenchWidgets";

export function BotRadarWidget({
  bots,
  loading,
  degraded
}: {
  bots: RadarBot[];
  loading: boolean;
  degraded: boolean;
}) {
  const t = useTranslations("dashboard.workbench");
  const locale = useLocale() as AppLocale;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const order = {
    error: 0,
    stale: 1,
    margin: 2,
    waiting: 3,
    running: 4,
    stopped: 5
  };
  const rows = bots
    .map((bot) => ({ ...bot, state: radarState(bot, now) }))
    .sort((a, b) => order[a.state] - order[b.state]);
  return (
    <WorkbenchFrame title={t("botRadar.title")}>
      {degraded ? (
        <div className="dashboardWidgetInlineError">{t("delayed")}</div>
      ) : null}
      {!rows.length ? (
        <div>
          {t(loading ? "loading" : degraded ? "loadError" : "botRadar.empty")}
        </div>
      ) : null}
      {rows.map((bot) => (
        <Link
          key={bot.id}
          className="dashboardWorkbenchRow dashboardWorkbenchLink"
          href={`${withLocalePath("/bots", locale)}/${encodeURIComponent(bot.id)}`}
        >
          <div>
            <strong>{bot.name}</strong>
            <small>{bot.symbol}</small>
          </div>
          <span
            className={`uiStatusBadge uiStatusBadge-${bot.state === "error" ? "danger" : ["stale", "margin"].includes(bot.state) ? "warning" : bot.state === "running" ? "success" : "neutral"}`}
          >
            {t(`botRadar.${bot.state}`)}
          </span>
        </Link>
      ))}
      <small>{t("botRadar.scope")}</small>
    </WorkbenchFrame>
  );
}

export function LiquidationDistanceWidget({
  positions,
  loading,
  degraded
}: {
  positions: LiquidationPosition[];
  loading: boolean;
  degraded: boolean;
}) {
  const t = useTranslations("dashboard.workbench");
  const locale = useLocale();
  const [account, setAccount] = useState("all");
  const accounts = [
    ...new Map(
      positions.map((row) => [row.exchangeAccountId, row.exchangeLabel])
    ).entries()
  ];
  const selected = positions.filter(
    (row) =>
      account === "all" ||
      !accounts.some(([id]) => id === account) ||
      row.exchangeAccountId === account
  );
  const rows = selected
    .map((row) => ({ ...row, distance: liquidationDistance(row) }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const number = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? "—"
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
          value
        );
  return (
    <WorkbenchFrame title={t("liquidationDistance.title")}>
      <DeskSelect
        className="input"
        aria-label={t("account")}
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      >
        <option value="all">{t("all")}</option>
        {accounts.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </DeskSelect>
      {degraded ? (
        <div role="status" className="dashboardWidgetInlineError">
          {t("delayed")}
        </div>
      ) : null}
      {!rows.length ? (
        <div>
          {t(
            loading
              ? "loading"
              : degraded
                ? "loadError"
                : "liquidationDistance.empty"
          )}
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div
          className="dashboardWorkbenchTrade"
          key={`${row.exchangeAccountId}:${row.symbol}:${row.side}:${index}`}
        >
          <div className="dashboardWorkbenchRow">
            <strong>
              {row.symbol} · {row.side}
            </strong>
            <span
              className={`uiStatusBadge uiStatusBadge-${row.distance === null || degraded ? "neutral" : row.distance <= 5 ? "danger" : row.distance <= 10 ? "warning" : "success"}`}
            >
              {row.distance === null
                ? t("unknown")
                : `${row.distance.toFixed(2)}%`}
            </span>
          </div>
          <small>{row.exchangeLabel}</small>
          <div className="dashboardWorkbenchMetrics">
            <span>
              {t("liquidationDistance.mark")}
              <strong>{number(row.markPrice)}</strong>
            </span>
            <span>
              {t("liquidationDistance.price")}
              <strong>{number(row.liquidationPrice)}</strong>
            </span>
            <span>
              {t("liquidationDistance.margin")}
              <strong>{number(row.marginUsd)}</strong>
            </span>
            <span>
              {t("liquidationDistance.leverage")}
              <strong>{number(row.leverage)}</strong>
            </span>
          </div>
        </div>
      ))}
      <small>{t("liquidationDistance.scope")}</small>
    </WorkbenchFrame>
  );
}
