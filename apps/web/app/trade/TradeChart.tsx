"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdvancedChart } from "./AdvancedChart";
import type { ChartEngine, TradeChartProps } from "./chartTypes";
import { LightweightChart } from "./LightweightChart";

type TradeChartWrapperProps = TradeChartProps & {
  chartEngine: ChartEngine;
  onChartEngineChange?: (next: ChartEngine) => void;
};

export function TradeChart({
  chartEngine,
  onChartEngineChange,
  ...chartProps
}: TradeChartWrapperProps) {
  const t = useTranslations("system.trade.chart");
  const [runtimeFallbackReason, setRuntimeFallbackReason] = useState<string | null>(null);
  const handleRuntimeFallback = useCallback((reason: string) => {
    setRuntimeFallbackReason(reason);
  }, []);

  const effectiveEngine = useMemo<ChartEngine>(() => {
    if (chartEngine === "advanced" && runtimeFallbackReason) return "lightweight";
    return chartEngine;
  }, [chartEngine, runtimeFallbackReason]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("engineSelector.title")}</div>
          <div className="tradeOrderModeSwitch">
            <button
              className={`tradeOrderModeBtn ${chartEngine === "advanced" ? "tradeOrderModeBtnActive" : ""}`}
              type="button"
              onClick={() => {
                setRuntimeFallbackReason(null);
                onChartEngineChange?.("advanced");
              }}
            >
              {t("engineSelector.advanced")}
            </button>
            <button
              className={`tradeOrderModeBtn ${chartEngine === "lightweight" ? "tradeOrderModeBtnActive" : ""}`}
              type="button"
              onClick={() => {
                setRuntimeFallbackReason(null);
                onChartEngineChange?.("lightweight");
              }}
            >
              {t("engineSelector.lightweight")}
            </button>
          </div>
        </div>
        <div style={{ maxWidth: 520, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          {t("advancedNotice")}
        </div>
      </div>

      {runtimeFallbackReason && chartEngine === "advanced" ? (
        <div className="tradeDeskSectionHint" style={{ color: "#f59e0b" }}>
          {t("fallbackNotice", { error: runtimeFallbackReason })}
        </div>
      ) : null}

      {effectiveEngine === "advanced" ? (
        <AdvancedChart
          {...chartProps}
          onRuntimeFallback={handleRuntimeFallback}
        />
      ) : (
        <LightweightChart {...chartProps} />
      )}
    </div>
  );
}
