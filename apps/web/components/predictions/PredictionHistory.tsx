"use client";

import type { ReactNode } from "react";

export default function PredictionHistory({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div className="predictionView predictionHistoryView">{children}</div>;
}
