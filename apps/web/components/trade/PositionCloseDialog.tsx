"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DeskDialog, DeskDialogPanel } from "../desk/DeskDialog";
import { DeskButton } from "../desk/DeskButton";
import { DeskInput } from "../desk/DeskInput";
import { AppIcon } from "../../app/components/AppIcon";

export function PositionCloseDialog({ position, accountLabel, error, pending, onClose, onConfirm }: {
  position: { symbol: string; side: string; size: number; unrealizedPnl: number | null };
  accountLabel: string; error: string | null;
  pending: boolean; onClose: () => void; onConfirm: (percentage: number) => void;
}) {
  const t = useTranslations("system.trade.positionTools");
  const [value, setValue] = useState("100");
  const percentage = Number(value.replace(",", "."));
  const valid = Number.isFinite(percentage) && percentage > 0 && percentage <= 100;
  return <DeskDialog onClose={() => { if (!pending) onClose(); }}><div className="tradeCloseBackdrop">
    <DeskDialogPanel label={t("closeTitle")}><section className="tradeClosePanel">
      <h3>{t("closeTitle")} · {position.symbol} · {position.side.toUpperCase()}</h3>
      <div>{accountLabel}</div>
      {error && <div role="alert" className="uiNotice uiNotice-error">{error}</div>}
      <label>{t("percentage")}<DeskInput className="input" inputMode="decimal" value={value} disabled={pending} onChange={event => setValue(event.target.value)} /></label>
      <div className="tradeCloseActions">{[25, 50, 75, 100].map(percent => <DeskButton key={percent} type="button" className="btn" aria-pressed={percentage === percent} disabled={pending} onClick={() => setValue(String(percent))}>{percent}%</DeskButton>)}</div>
      <div>{t("quantity")}: {valid ? Number((position.size * percentage / 100).toPrecision(10)) : "—"}</div>
      <div>{t("estimatedPnl")}: {valid && position.unrealizedPnl !== null ? `${(position.unrealizedPnl * percentage / 100).toFixed(2)} USD` : "—"}</div>
      <small>{t("closeEstimate")}</small>
      <div className="tradeCloseActions">
        <DeskButton className="btn btnStop" disabled={pending || !valid} onClick={() => onConfirm(percentage)}><AppIcon name="close" />{pending ? t("closing") : t("confirmClose", { percentage: valid ? percentage : 0 })}</DeskButton>
        <DeskButton className="btn" disabled={pending} onClick={onClose}>{t("cancel")}</DeskButton>
      </div>
    </section></DeskDialogPanel>
  </div></DeskDialog>;
}
