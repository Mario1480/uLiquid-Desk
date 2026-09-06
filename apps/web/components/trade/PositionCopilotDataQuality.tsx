"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PositionCopilotMarketQuality } from "../../src/trade/positionCopilot";

export default function PositionCopilotDataQuality({ position, market }: {
  position: "complete" | "degraded";
  market: PositionCopilotMarketQuality;
}) {
  const t = useTranslations("system.trade.copilot");
  return <>
    <span className={position === "degraded" ? "tradeCopilotQualityDegraded" : ""}>
      {t("dataQuality", { state: t(`quality.${position}`) })}
    </span>
    <span className={market !== "fresh" ? "tradeCopilotQualityDegraded" : ""}>
      {t("marketDataQuality", { state: t(`marketQuality.${market}`) })}
    </span>
  </>;
}
