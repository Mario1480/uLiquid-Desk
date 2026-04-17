import type { GridInstancePreviewResponse, GridTemplate } from "../../components/grid/types";

export type NeutralModePreviewHints = {
  show: boolean;
  symmetric: boolean;
  fullBudgetOneWay: boolean;
  seedDirectionDependsOnMark: boolean;
  syntheticMarkPreview: boolean;
  currentSeedSide: "buy" | "sell" | null;
};

type NeutralModePreviewHintsArgs = {
  template: Pick<GridTemplate, "mode" | "initialSeedEnabled"> | null | undefined;
  preview: Pick<GridInstancePreviewResponse, "warnings" | "initialSeed"> | null | undefined;
};

export function deriveNeutralModePreviewHints({
  template,
  preview,
}: NeutralModePreviewHintsArgs): NeutralModePreviewHints {
  const isNeutral = String(template?.mode ?? "").toLowerCase() === "neutral";
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const seedEnabled = Boolean(preview?.initialSeed?.enabled ?? template?.initialSeedEnabled);
  const currentSeedSide = isNeutral ? preview?.initialSeed?.seedSide ?? null : null;

  return {
    show: isNeutral,
    symmetric: isNeutral,
    fullBudgetOneWay: isNeutral,
    seedDirectionDependsOnMark: isNeutral && seedEnabled,
    syntheticMarkPreview: isNeutral && warnings.includes("preview_mark_price_fallback_used"),
    currentSeedSide,
  };
}
