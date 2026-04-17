export type GridSnapshotMode = "long" | "short" | "neutral" | "cross";
export type GridSnapshotPriceMode = "arithmetic" | "geometric";

export type GridSnapshotSideConfig = {
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
};

export type GridSnapshotCrossSideConfig = {
  long: GridSnapshotSideConfig;
  short: GridSnapshotSideConfig;
};

type GridSnapshotTemplateFallback = {
  mode?: unknown;
  gridMode?: unknown;
  lowerPrice?: unknown;
  upperPrice?: unknown;
  gridCount?: unknown;
  crossSideConfig?: unknown;
  crossLongLowerPrice?: unknown;
  crossLongUpperPrice?: unknown;
  crossLongGridCount?: unknown;
  crossShortLowerPrice?: unknown;
  crossShortUpperPrice?: unknown;
  crossShortGridCount?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toGridMode(value: unknown): GridSnapshotMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "short" || normalized === "neutral" || normalized === "cross") return normalized;
  return "long";
}

function toGridPriceMode(value: unknown): GridSnapshotPriceMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "geometric" ? "geometric" : "arithmetic";
}

function normalizeCrossSideCandidate(
  side: unknown,
  fallback: GridSnapshotSideConfig
): GridSnapshotSideConfig {
  const record = asRecord(side) ?? {};
  const lowerPrice = Number(record.lowerPrice);
  const upperPrice = Number(record.upperPrice);
  const gridCount = Math.trunc(Number(record.gridCount));
  const candidate = {
    lowerPrice: Number.isFinite(lowerPrice) && lowerPrice > 0 ? lowerPrice : fallback.lowerPrice,
    upperPrice: Number.isFinite(upperPrice) && upperPrice > 0 ? upperPrice : fallback.upperPrice,
    gridCount: Number.isFinite(gridCount) && gridCount >= 2 && gridCount <= 500 ? gridCount : fallback.gridCount
  };
  if (candidate.upperPrice <= candidate.lowerPrice) return fallback;
  return candidate;
}

function normalizeCrossSideConfig(
  source: GridSnapshotTemplateFallback
): GridSnapshotCrossSideConfig | null {
  if (toGridMode(source.mode) !== "cross") return null;
  const fallback = {
    lowerPrice: Number(source.lowerPrice),
    upperPrice: Number(source.upperPrice),
    gridCount: Math.trunc(Number(source.gridCount))
  };
  if (
    !Number.isFinite(fallback.lowerPrice) || fallback.lowerPrice <= 0
    || !Number.isFinite(fallback.upperPrice) || fallback.upperPrice <= fallback.lowerPrice
    || !Number.isFinite(fallback.gridCount) || fallback.gridCount < 2 || fallback.gridCount > 500
  ) {
    return null;
  }
  const rawConfig = asRecord(source.crossSideConfig) ?? {};
  return {
    long: normalizeCrossSideCandidate(rawConfig.long ?? {
      lowerPrice: source.crossLongLowerPrice,
      upperPrice: source.crossLongUpperPrice,
      gridCount: source.crossLongGridCount
    }, fallback),
    short: normalizeCrossSideCandidate(rawConfig.short ?? {
      lowerPrice: source.crossShortLowerPrice,
      upperPrice: source.crossShortUpperPrice,
      gridCount: source.crossShortGridCount
    }, fallback)
  };
}

export function resolveGridCoreSnapshot(params: {
  botParamsJson: unknown;
  template: GridSnapshotTemplateFallback | null | undefined;
}): {
  mode: GridSnapshotMode;
  gridMode: GridSnapshotPriceMode;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  crossSideConfig: GridSnapshotCrossSideConfig | null;
} {
  const template = params.template ?? {};
  const paramsRecord = asRecord(params.botParamsJson) ?? {};
  const grid = asRecord(paramsRecord.grid) ?? {};

  const mode = toGridMode(grid.mode ?? template.mode);
  const gridMode = toGridPriceMode(grid.gridMode ?? template.gridMode);
  const rawLowerPrice = Number(grid.lowerPrice ?? template.lowerPrice ?? 0);
  const rawUpperPrice = Number(grid.upperPrice ?? template.upperPrice ?? 0);
  const rawGridCount = Math.max(2, Math.trunc(Number(grid.gridCount ?? template.gridCount ?? 2)));
  const crossSideConfig = normalizeCrossSideConfig({
    mode,
    lowerPrice: rawLowerPrice,
    upperPrice: rawUpperPrice,
    gridCount: rawGridCount,
    crossSideConfig: grid.crossSideConfig ?? template.crossSideConfig,
    crossLongLowerPrice: template.crossLongLowerPrice,
    crossLongUpperPrice: template.crossLongUpperPrice,
    crossLongGridCount: template.crossLongGridCount,
    crossShortLowerPrice: template.crossShortLowerPrice,
    crossShortUpperPrice: template.crossShortUpperPrice,
    crossShortGridCount: template.crossShortGridCount
  });

  return {
    mode,
    gridMode,
    lowerPrice: crossSideConfig
      ? Math.min(crossSideConfig.long.lowerPrice, crossSideConfig.short.lowerPrice)
      : rawLowerPrice,
    upperPrice: crossSideConfig
      ? Math.max(crossSideConfig.long.upperPrice, crossSideConfig.short.upperPrice)
      : rawUpperPrice,
    gridCount: crossSideConfig
      ? Math.max(crossSideConfig.long.gridCount, crossSideConfig.short.gridCount)
      : rawGridCount,
    crossSideConfig
  };
}
