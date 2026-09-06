"use client";

import { DeskDialog, DeskDialogPanel } from "@/components/desk/DeskDialog";
import { DeskButton } from "@/components/desk/DeskButton";
import type { ReactNode } from "react";
import { AppIcon } from "../../app/components/AppIcon";

type PredictionDetailDrawerProps = {
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

export default function PredictionDetailDrawer({
  title,
  subtitle,
  closeLabel,
  onClose,
  children
}: PredictionDetailDrawerProps) {
  return (
    <DeskDialog onClose={onClose}><div className="predictionDrawerBackdrop" role="presentation" onMouseDown={onClose}>
      <DeskDialogPanel><aside
        className="predictionDrawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prediction-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="predictionDrawerHeader">
          <div>
            <div className="predictionSectionEyebrow">{subtitle}</div>
            <h2 id="prediction-detail-title" className="predictionDrawerTitle">{title}</h2>
          </div>
          <DeskButton className="btn predictionDrawerClose" type="button" onClick={onClose} aria-label={closeLabel}>
            <AppIcon name="close" />
          </DeskButton>
        </header>
        <div className="predictionDrawerBody">{children}</div>
      </aside></DeskDialogPanel>
    </div></DeskDialog>
  );
}
