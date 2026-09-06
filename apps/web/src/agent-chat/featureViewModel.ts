import type { AgentFeatureSnapshot } from "./contracts";

export type FeatureMetricRow = { key: string; value: number | null; unit: string; band?: number; format?: "date" };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
// Presentation only: values come from persisted, server-validated evidence.
// Unknown versions are not reinterpreted with current metric semantics.
export function featureMetricRows(feature: AgentFeatureSnapshot): FeatureMetricRow[] {
  if (feature.version !== "1.0.0") return [];
  const value = record(feature.value);
  const row = (key: string, raw: unknown, unit = "", band?: number): FeatureMetricRow => ({ key,
    value: typeof raw === "number" && Number.isFinite(raw) ? raw : null, unit, ...(band === undefined ? {} : { band }) });
  if (feature.id === "derivatives.history-summary") {
    const funding = value.kind === "funding";
    const unit = funding ? "rate" : ["base_asset", "contracts", "provider_native"].includes(String(value.unit)) ? String(value.unit) : "unknown";
    return [row("historySamples", value.sampleCount), row("historyMinimumSamples", value.minimumStatisticsSamples),
      { ...row("historyStart", value.actualStart), format: "date" }, { ...row("historyEnd", value.actualEnd), format: "date" },
      row("historyCoverage", typeof value.coverageRatio === "number" ? value.coverageRatio * 100 : null, "%"),
      row("historyCadence", typeof value.cadenceMs === "number" ? value.cadenceMs / 3_600_000 : null, "h"),
      row("historyLatest", value.latestValue, unit), row("historyMean", value.mean, unit),
      row("historyChange", funding ? value.changeBps : value.change, funding ? "bps" : unit),
      ...(!funding ? [row("historyChangePct", value.changePct, "%"), row("oiNotional", value.latestReportedNotional, "USD")] : []),
      row("historyPercentile", value.percentile, "%"), row("historyZScore", value.zScore), row("historyExcluded", value.excludedRows)];
  }
  if (feature.id === "derivatives.funding-snapshot") return [row("fundingBps", value.rateBps, "bps"),
    row("fundingInterval", value.fundingIntervalHours, "h"),
    row("annualizedEstimate", typeof value.annualizedEstimate === "number" ? value.annualizedEstimate * 100 : null, "%")];
  if (feature.id === "derivatives.open-interest-snapshot") return [
    row("oiReported", value.reportedValue, ["base_asset", "quote_asset", "contracts", "provider_native", "unknown"].includes(String(value.reportedUnit)) ? String(value.reportedUnit) : "unknown"),
    row("oiBase", value.normalizedBaseQuantity, "base_asset"), row("oiNotional", value.notionalUsd, "USD")];
  if (feature.id === "technical.indicator-summary") {
    const values = record(value.values);
    return ["sma20", "ema50", "rsi14", "atr14"].filter(key => Object.hasOwn(values, key)).map(key => row(key, values[key]));
  }
  if (feature.id === "orderbook.snapshot") return [row("midPrice", value.midPrice), row("spread", value.spreadBps, "bps"), row("weightedMid", value.weightedMid),
    ...(Array.isArray(value.bands) ? value.bands.slice(0, 4).flatMap(raw => {
      const band = record(raw);
      if (![10, 25, 50, 100].includes(Number(band.bandBps))) return [];
      return [row("bidDepth", band.bidDepthUsd, "USD", Number(band.bandBps)), row("askDepth", band.askDepthUsd, "USD", Number(band.bandBps)),
        row("depthRatio", band.depthRatio, "", Number(band.bandBps)), row("imbalance", band.imbalance, "", Number(band.bandBps))];
    }) : [])];
  return [];
}

export function featureWarningCodes(feature: AgentFeatureSnapshot): string[] {
  const reasons = record(record(feature.value).quality).reasons;
  return Array.isArray(reasons) ? reasons.filter((v): v is string => typeof v === "string").slice(0, 32) : [];
}
