"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DeskInput } from "../desk/DeskInput";
import { estimatePnl, priceFromRoe, type PositionEstimate } from "./positionMath";

export function ProtectionPriceInput({ position, value, onChange, label }: {
  position: PositionEstimate; value: string; onChange: (value: string) => void; label: string;
}) {
  const t = useTranslations("system.trade.positionTools");
  const [roeDraft, setRoeDraft] = useState<string | null>(null);
  const pnl = estimatePnl(position, Number(value));
  const roe = pnl !== null && position.marginUsd && position.marginUsd > 0 ? pnl / position.marginUsd * 100 : null;
  return <div className="tradeProtectionInput" onClick={event => event.stopPropagation()}>
    <label>{label}<DeskInput className="input tradeTableInput" inputMode="decimal" value={value} onChange={event => { setRoeDraft(null); onChange(event.target.value); }} /></label>
    <label>{t("roe")}<DeskInput className="input tradeTableInput" inputMode="decimal" value={roeDraft ?? (roe === null ? "" : String(Number(roe.toFixed(2))))}
      onBlur={() => setRoeDraft(null)}
      disabled={!(position.marginUsd && position.marginUsd > 0 && position.entryPrice && position.size > 0)}
      onChange={event => {
        const raw = event.target.value;
        setRoeDraft(raw);
        const price = raw.trim() ? priceFromRoe(position, Number(raw.replace(",", "."))) : null;
        if (price !== null) onChange(String(Number(price.toPrecision(12))));
      }} /></label>
    <small>{t("estimatedPnl")}: {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USD`}</small>
    <small>{t("beforeFees")}</small>
  </div>;
}
