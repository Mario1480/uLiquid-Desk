"use client";

import type { ReactNode } from "react";

export default function ActivePredictions({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <div className="predictionView predictionActiveView">{children}</div>;
}
