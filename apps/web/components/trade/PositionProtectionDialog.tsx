"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import { DeskButton } from "../desk/DeskButton";
import { DeskDialog, DeskDialogPanel } from "../desk/DeskDialog";
import { ProtectionPriceInput } from "./ProtectionPriceInput";
import type { PositionEstimate } from "./positionMath";

type ProtectionPosition = PositionEstimate & {
  symbol: string;
  side: string;
};

export function PositionProtectionDialog({
  position,
  accountLabel,
  initialTakeProfit,
  initialStopLoss,
  error,
  pending,
  onClose,
  onConfirm
}: {
  position: ProtectionPosition;
  accountLabel: string;
  initialTakeProfit: string;
  initialStopLoss: string;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (takeProfit: string, stopLoss: string) => void;
}) {
  const t = useTranslations("system.trade.positionTools");
  const [takeProfit, setTakeProfit] = useState(initialTakeProfit);
  const [stopLoss, setStopLoss] = useState(initialStopLoss);

  return (
    <DeskDialog onClose={() => { if (!pending) onClose(); }}>
      <div className="tradeCloseBackdrop">
        <DeskDialogPanel label={t("protectionTitle")}>
          <section className="tradeClosePanel tradeProtectionPanel">
            <div>
              <h3>{t("protectionTitle")} · {position.symbol} · {position.side.toUpperCase()}</h3>
              <div className="tradeProtectionAccount">{accountLabel}</div>
            </div>
            {error ? <div role="alert" className="uiNotice uiNotice-error">{error}</div> : null}
            <div className="tradeProtectionGrid">
              <ProtectionPriceInput
                position={position}
                label={t("stopLoss")}
                value={stopLoss}
                onChange={setStopLoss}
              />
              <ProtectionPriceInput
                position={position}
                label={t("takeProfit")}
                value={takeProfit}
                onChange={setTakeProfit}
              />
            </div>
            <div className="tradeCloseActions">
              <DeskButton className="btn btnPrimary" disabled={pending} onClick={() => onConfirm(takeProfit, stopLoss)}>
                <AppIcon name="save" />
                {pending ? t("saving") : t("save")}
              </DeskButton>
              <DeskButton className="btn" disabled={pending} onClick={onClose}>{t("cancel")}</DeskButton>
            </div>
          </section>
        </DeskDialogPanel>
      </div>
    </DeskDialog>
  );
}
