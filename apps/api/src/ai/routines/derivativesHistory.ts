import { z } from "zod";

export const DERIVATIVES_HISTORY_ROUTINE_ID = "derivatives.history-summary.v1";
const finite = z.number().finite();
const time = finite.int().positive().max(8_640_000_000_000_000);
export const historyPointSchema = z.object({
  timestamp: time,
  value: finite,
  reportedNotional: finite.nonnegative().nullable(),
  cadenceMs: finite.positive().nullable()
}).strict();
export const derivativesHistoryInputSchema = z.object({
  kind: z.enum(["funding", "open_interest"]),
  unit: z.enum(["rate", "base_asset", "contracts", "provider_native"]),
  requestedStart: time, requestedEnd: time, evaluatedAt: time,
  points: z.array(historyPointSchema).max(200),
  warningCodes: z.array(z.string().max(100)).max(32),
  excludedRows: z.number().int().nonnegative().max(1000),
  conflictingDuplicates: z.boolean(),
  truncated: z.boolean()
}).strict().refine(v => v.requestedEnd > v.requestedStart && v.requestedEnd <= v.evaluatedAt, "history_window_invalid")
  .refine(v => v.kind === "funding" ? v.unit === "rate" : v.unit !== "rate", "history_unit_invalid");
export const derivativesHistoryOutputSchema = z.object({
  routineId: z.literal(DERIVATIVES_HISTORY_ROUTINE_ID),
  kind: z.enum(["funding", "open_interest"]), unit: z.enum(["rate", "base_asset", "contracts", "provider_native"]),
  requestedStart: time, requestedEnd: time,
  actualStart: time.nullable(), actualEnd: time.nullable(),
  sampleCount: z.number().int().nonnegative().max(200), excludedRows: z.number().int().nonnegative(),
  cadenceMs: finite.positive().nullable(), coverageRatio: finite.min(0).max(1).nullable(),
  latestValue: finite.nullable(), latestReportedNotional: finite.nullable(),
  change: finite.nullable(), changeBps: finite.nullable(), changePct: finite.nullable(),
  mean: finite.nullable(), percentile: finite.min(0).max(100).nullable(), zScore: finite.nullable(),
  minimumStatisticsSamples: z.literal(30),
  quality: z.object({ state: z.enum(["fresh", "stale", "degraded", "unavailable"]), reasons: z.array(z.string().max(100)).max(32) }).strict()
}).strict();
export type DerivativesHistoryInput = z.infer<typeof derivativesHistoryInputSchema>;

// No interpolation, annualization, cross-source joins or position-risk inference.
export function summarizeDerivativesHistory(raw: unknown): z.infer<typeof derivativesHistoryOutputSchema> {
  const input = derivativesHistoryInputSchema.parse(raw);
  const reasons = new Set(input.warningCodes);
  const rows = new Map<number, z.infer<typeof historyPointSchema>>();
  let excluded = input.excludedRows;
  let conflict = input.conflictingDuplicates;
  for (const row of input.points) {
    if (row.timestamp < input.requestedStart || row.timestamp > input.requestedEnd || (input.kind === "open_interest" && row.value < 0)) {
      excluded++; reasons.add("history_out_of_window_or_invalid"); continue;
    }
    const previous = rows.get(row.timestamp);
    if (previous) {
      reasons.add("history_duplicate_timestamp");
      if (JSON.stringify(previous) !== JSON.stringify(row)) conflict = true;
      continue;
    }
    rows.set(row.timestamp, row);
  }
  const points = [...rows.values()].sort((a, b) => a.timestamp - b.timestamp);
  const first = points[0]; const last = points.at(-1);
  const cadences = new Set(points.map(p => p.cadenceMs));
  const cadence = cadences.size === 1 ? first?.cadenceMs ?? null : null;
  if (!cadence) reasons.add("history_cadence_unverified_or_changed");
  const gaps = cadence !== null && points.some((point, i) => i > 0 && Math.abs(point.timestamp - points[i - 1].timestamp - cadence) > 1000);
  if (gaps) reasons.add("history_gaps_or_cadence_change");
  if (conflict) reasons.add("history_conflicting_duplicates");
  if (excluded) reasons.add("history_rows_excluded");
  if (input.truncated) reasons.add("history_page_limit_reached");
  if (points.length < 2) reasons.add("history_insufficient_endpoints");
  if (points.length < 30) reasons.add("history_insufficient_statistics_samples");
  const coverageRatio = cadence ? Math.min(1, points.length / Math.max(1, Math.floor((input.requestedEnd - input.requestedStart) / cadence))) : null;
  if (coverageRatio !== null && coverageRatio < 0.95) reasons.add("history_partial_window");
  const stale = !!last && cadence !== null && input.evaluatedAt - last.timestamp > cadence + 120_000;
  if (stale) reasons.add("history_stale");
  const comparable = !!first && !!last && points.length >= 2 && cadence !== null && !gaps && !conflict && excluded === 0;
  const change = comparable ? last!.value - first!.value : null;
  const statistics = comparable && points.length >= 30;
  const mean = statistics ? first!.value + points.reduce((sum, point) => sum + (point.value - first!.value) / points.length, 0) : null;
  const deviation = mean === null ? null : Math.sqrt(points.reduce((sum, point) => sum + ((point.value - mean) ** 2) / points.length, 0));
  if (deviation === 0) reasons.add("history_zero_dispersion");
  if (comparable && input.kind === "open_interest" && first!.value === 0) reasons.add("history_zero_baseline");
  const safe = (value: number | null) => {
    if (value === null || Number.isFinite(value)) return value;
    reasons.add("history_numeric_overflow"); return null;
  };
  if (deviation !== null && !Number.isFinite(deviation)) reasons.add("history_numeric_overflow");
  const result = {
    routineId: DERIVATIVES_HISTORY_ROUTINE_ID, kind: input.kind, unit: input.unit,
    requestedStart: input.requestedStart, requestedEnd: input.requestedEnd,
    actualStart: first?.timestamp ?? null, actualEnd: last?.timestamp ?? null,
    sampleCount: points.length, excludedRows: excluded, cadenceMs: cadence, coverageRatio,
    latestValue: conflict ? null : last?.value ?? null,
    latestReportedNotional: conflict ? null : last?.reportedNotional ?? null,
    change: input.kind === "open_interest" ? safe(change) : null,
    changeBps: input.kind === "funding" && change !== null ? safe(change * 10_000) : null,
    changePct: input.kind === "open_interest" && change !== null && first!.value > 0 ? safe(change / first!.value * 100) : null,
    mean: safe(mean),
    // Empirical mid-rank of the last observation within this actual sample only.
    percentile: statistics ? points.reduce((sum, p) => sum + (p.value < last!.value ? 1 : p.value === last!.value ? 0.5 : 0), 0) / points.length * 100 : null,
    zScore: mean !== null && deviation !== null && Number.isFinite(deviation) && deviation > 0 ? safe((last!.value - mean) / deviation) : null,
    minimumStatisticsSamples: 30,
    quality: { state: points.length === 0 || conflict ? "unavailable" : stale ? "stale" : reasons.size ? "degraded" : "fresh", reasons: [...reasons].slice(0, 32) }
  };
  return derivativesHistoryOutputSchema.parse(result);
}
