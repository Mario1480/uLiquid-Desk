"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { AppLocale } from "../../i18n/config";

export type DashboardPerformanceRange = "24h" | "7d" | "30d";

export type DashboardPerformanceChartPoint = {
  ts: number;
  totalEquity: number;
};

type Props = {
  data: DashboardPerformanceChartPoint[];
  equityLabel: string;
  locale: AppLocale;
  range: DashboardPerformanceRange;
};

function resolveIntlLocale(locale: AppLocale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

function formatUsdt(value: number | null | undefined, locale: AppLocale, decimals = 2): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${new Intl.NumberFormat(resolveIntlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value))} USDT`;
}

function formatPerformanceAxisTick(ts: number, range: DashboardPerformanceRange, locale: AppLocale): string {
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return "-";
  if (range === "24h") {
    return date.toLocaleTimeString(resolveIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleDateString(resolveIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit"
  });
}

export default function DashboardPerformanceAreaChart({
  data,
  equityLabel,
  locale,
  range
}: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 14, right: 14, left: 6, bottom: 2 }}>
        <defs>
          <linearGradient id="dashboardPerformanceAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgba(16, 185, 199, 0.78)" />
            <stop offset="95%" stopColor="rgba(16, 185, 199, 0.05)" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(value) => formatPerformanceAxisTick(Number(value), range, locale)}
          stroke="rgba(255,255,255,0.48)"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(value) => formatUsdt(Number(value), locale, 0)}
          stroke="rgba(255,255,255,0.48)"
          tickLine={false}
          axisLine={false}
          width={92}
          padding={{ top: 30, bottom: 4 }}
        />
        <Tooltip
          formatter={(value) => [formatUsdt(Number(value), locale), equityLabel]}
          labelFormatter={(value) =>
            new Date(Number(value)).toLocaleString(resolveIntlLocale(locale), {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit"
            })
          }
          contentStyle={{
            border: "1px solid rgba(255,193,7,0.34)",
            background: "rgba(7, 17, 26, 0.95)",
            borderRadius: 10
          }}
          labelStyle={{ color: "var(--muted)" }}
          itemStyle={{ color: "var(--text)" }}
        />
        <Area
          type="monotone"
          dataKey="totalEquity"
          stroke="rgba(16, 185, 199, 0.95)"
          strokeWidth={2}
          fill="url(#dashboardPerformanceAreaFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
