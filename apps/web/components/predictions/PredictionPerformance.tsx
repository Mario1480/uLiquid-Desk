"use client";

import type { ReactNode } from "react";

export default function PredictionPerformance({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div className="predictionView predictionPerformanceView">{children}</div>;
}
