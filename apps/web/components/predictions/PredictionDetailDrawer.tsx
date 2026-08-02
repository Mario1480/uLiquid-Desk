"use client";

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
    <div className="predictionDrawerBackdrop" role="presentation" onMouseDown={onClose}>
      <aside
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
          <button className="btn predictionDrawerClose" type="button" onClick={onClose} aria-label={closeLabel}>
            <AppIcon name="close" />
          </button>
        </header>
        <div className="predictionDrawerBody">{children}</div>
      </aside>
    </div>
  );
}
