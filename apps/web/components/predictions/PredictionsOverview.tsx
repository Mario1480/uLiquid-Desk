"use client";

import type { ReactNode } from "react";

export type PredictionsView = "overview" | "active" | "history" | "performance";

type PredictionsOverviewProps = {
  active: boolean;
  children: ReactNode;
};

export default function PredictionsOverview({ active, children }: PredictionsOverviewProps) {
  if (!active) return null;
  return <div className="predictionView predictionOverviewView">{children}</div>;
}
