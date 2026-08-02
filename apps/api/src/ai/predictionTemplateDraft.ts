export const PREDICTION_TEMPLATE_DRAFT_SCHEMA_VERSION = "prediction-template-draft/v1" as const;

export const PREDICTION_BUILDER_ALLOWED_TOOLS = [
  "create_template_draft",
  "update_template_draft",
  "validate_template_draft",
  "explain_template_field",
  "request_preview"
] as const;

export type PredictionBuilderToolName = (typeof PREDICTION_BUILDER_ALLOWED_TOOLS)[number];
export type PredictionDraftTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
export type PredictionDraftHorizonUnit = "minutes" | "hours" | "days";
export type PredictionDraftDirection = "long" | "short" | "either";

export type PredictionTemplateDraft = {
  schemaVersion: typeof PREDICTION_TEMPLATE_DRAFT_SCHEMA_VERSION;
  draftId: string;
  revision: number;
  name: string;
  analysisGoal: string;
  promptMode: "trading_explainer" | "market_analysis";
  timeframes: PredictionDraftTimeframe[];
  runTimeframe: PredictionDraftTimeframe | null;
  horizon: {
    value: number;
    unit: PredictionDraftHorizonUnit;
  };
  indicatorKeys: string[];
  directionRules: {
    preference: PredictionDraftDirection;
    long: string;
    short: string;
    noTrade: string;
  };
  priceLevels: {
    entry: number | null;
    invalidation: number | null;
    targets: number[];
  };
  confidenceTargetPct: number;
  ohlcvBars: number;
  slTpSource: "local" | "ai" | "hybrid";
  newsRiskMode: "off" | "block";
};

export type PredictionTemplateDraftIssue = {
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type PredictionTemplateDraftValidation = {
  valid: boolean;
  issues: PredictionTemplateDraftIssue[];
};

export type PredictionTemplateDraftChange = {
  path: string;
  before: unknown;
  after: unknown;
};

const TIMEFRAMES = new Set<PredictionDraftTimeframe>(["5m", "15m", "1h", "4h", "1d"]);
const HORIZON_UNITS = new Set<PredictionDraftHorizonUnit>(["minutes", "hours", "days"]);

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalPositivePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = finiteNumber(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function uniqueStrings(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const normalized = cleanText(value, 120);
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

export function createPredictionTemplateDraft(raw: unknown): PredictionTemplateDraft {
  const input = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const rawTimeframes = uniqueStrings(input.timeframes, 4)
    .filter((value): value is PredictionDraftTimeframe => TIMEFRAMES.has(value as PredictionDraftTimeframe));
  const runTimeframe = TIMEFRAMES.has(input.runTimeframe)
    ? input.runTimeframe as PredictionDraftTimeframe
    : (rawTimeframes[0] ?? null);
  const direction = input.directionRules && typeof input.directionRules === "object"
    ? input.directionRules as Record<string, unknown>
    : {};
  const priceLevels = input.priceLevels && typeof input.priceLevels === "object"
    ? input.priceLevels as Record<string, unknown>
    : {};
  const horizon = input.horizon && typeof input.horizon === "object"
    ? input.horizon as Record<string, unknown>
    : {};
  const horizonUnit = HORIZON_UNITS.has(horizon.unit as PredictionDraftHorizonUnit)
    ? horizon.unit as PredictionDraftHorizonUnit
    : "hours";
  const preference: PredictionDraftDirection = direction.preference === "long" || direction.preference === "short"
    ? direction.preference
    : "either";

  return {
    schemaVersion: PREDICTION_TEMPLATE_DRAFT_SCHEMA_VERSION,
    draftId: cleanText(input.draftId, 120) || `prediction_draft_${Date.now()}`,
    revision: Math.max(1, Math.trunc(finiteNumber(input.revision, 1))),
    name: cleanText(input.name, 64),
    analysisGoal: cleanText(input.analysisGoal, 8000),
    promptMode: input.promptMode === "market_analysis" ? "market_analysis" : "trading_explainer",
    timeframes: rawTimeframes,
    runTimeframe,
    horizon: {
      value: Math.max(1, Math.trunc(finiteNumber(horizon.value, 4))),
      unit: horizonUnit
    },
    indicatorKeys: uniqueStrings(input.indicatorKeys, 128),
    directionRules: {
      preference,
      long: cleanText(direction.long, 2000),
      short: cleanText(direction.short, 2000),
      noTrade: cleanText(direction.noTrade, 2000)
    },
    priceLevels: {
      entry: optionalPositivePrice(priceLevels.entry),
      invalidation: optionalPositivePrice(priceLevels.invalidation),
      targets: Array.isArray(priceLevels.targets)
        ? priceLevels.targets.map(optionalPositivePrice).filter((value): value is number => value !== null).slice(0, 5)
        : []
    },
    confidenceTargetPct: Math.max(0, Math.min(100, finiteNumber(input.confidenceTargetPct, 60))),
    ohlcvBars: Math.max(20, Math.min(500, Math.trunc(finiteNumber(input.ohlcvBars, 100)))),
    slTpSource: input.slTpSource === "ai" || input.slTpSource === "hybrid" ? input.slTpSource : "local",
    newsRiskMode: input.newsRiskMode === "block" ? "block" : "off"
  };
}

function horizonMinutes(draft: PredictionTemplateDraft): number {
  if (draft.horizon.unit === "days") return draft.horizon.value * 24 * 60;
  if (draft.horizon.unit === "hours") return draft.horizon.value * 60;
  return draft.horizon.value;
}

export function validatePredictionTemplateDraft(
  raw: unknown,
  availableIndicatorKeys: readonly string[]
): PredictionTemplateDraftValidation {
  const draft = createPredictionTemplateDraft(raw);
  const issues: PredictionTemplateDraftIssue[] = [];
  const error = (path: string, code: string, message: string) => issues.push({ path, code, severity: "error", message });
  const warning = (path: string, code: string, message: string) => issues.push({ path, code, severity: "warning", message });

  if (!draft.name) error("name", "name_required", "Template name is required.");
  if (!draft.analysisGoal) error("analysisGoal", "analysis_goal_required", "Analysis goal is required.");
  if (draft.timeframes.length === 0) error("timeframes", "timeframe_required", "Select at least one timeframe.");
  if (!draft.runTimeframe || !draft.timeframes.includes(draft.runTimeframe)) {
    error("runTimeframe", "run_timeframe_invalid", "Run timeframe must be included in timeframes.");
  }
  const minutes = horizonMinutes(draft);
  if (minutes < 5 || minutes > 43_200) {
    error("horizon", "horizon_out_of_range", "Analysis horizon must be between 5 minutes and 30 days.");
  }
  if (draft.indicatorKeys.length === 0) {
    error("indicatorKeys", "indicator_required", "Select at least one available indicator.");
  }
  const allowed = new Set(availableIndicatorKeys);
  const invalidIndicators = draft.indicatorKeys.filter((key) => !allowed.has(key));
  if (invalidIndicators.length > 0) {
    error("indicatorKeys", "indicator_not_available", `Unavailable indicators: ${invalidIndicators.join(", ")}`);
  }
  if (draft.directionRules.preference !== "short" && !draft.directionRules.long) {
    error("directionRules.long", "long_rule_required", "A long rule is required for the selected direction scope.");
  }
  if (draft.directionRules.preference !== "long" && !draft.directionRules.short) {
    error("directionRules.short", "short_rule_required", "A short rule is required for the selected direction scope.");
  }
  if (!draft.directionRules.noTrade) {
    error("directionRules.noTrade", "no_trade_rule_required", "A no-trade rule is required.");
  }
  if (
    draft.directionRules.long
    && draft.directionRules.short
    && draft.directionRules.long.toLowerCase() === draft.directionRules.short.toLowerCase()
  ) {
    error("directionRules", "contradictory_direction_rules", "Long and short rules must not be identical.");
  }

  const { entry, invalidation, targets } = draft.priceLevels;
  if (entry !== null && invalidation !== null) {
    if (draft.directionRules.preference === "long" && invalidation >= entry) {
      error("priceLevels.invalidation", "long_invalidation_conflict", "Long invalidation must be below entry.");
    }
    if (draft.directionRules.preference === "short" && invalidation <= entry) {
      error("priceLevels.invalidation", "short_invalidation_conflict", "Short invalidation must be above entry.");
    }
  }
  if (entry !== null && targets.length > 0) {
    if (draft.directionRules.preference === "long" && targets.some((target) => target <= entry)) {
      error("priceLevels.targets", "long_target_conflict", "Long targets must be above entry.");
    }
    if (draft.directionRules.preference === "short" && targets.some((target) => target >= entry)) {
      error("priceLevels.targets", "short_target_conflict", "Short targets must be below entry.");
    }
    if (draft.directionRules.preference === "either") {
      warning("priceLevels", "directional_levels_ambiguous", "Fixed price levels are ambiguous when both directions are enabled.");
    }
  }

  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}

function normalizeComparable(value: unknown): unknown {
  return Array.isArray(value) ? value.join(", ") : value;
}

export function diffPredictionTemplateDraft(
  beforeRaw: unknown,
  afterRaw: unknown
): PredictionTemplateDraftChange[] {
  const before = createPredictionTemplateDraft(beforeRaw);
  const after = createPredictionTemplateDraft(afterRaw);
  const paths: Array<[string, unknown, unknown]> = [
    ["name", before.name, after.name],
    ["analysisGoal", before.analysisGoal, after.analysisGoal],
    ["promptMode", before.promptMode, after.promptMode],
    ["timeframes", before.timeframes, after.timeframes],
    ["runTimeframe", before.runTimeframe, after.runTimeframe],
    ["horizon", `${before.horizon.value} ${before.horizon.unit}`, `${after.horizon.value} ${after.horizon.unit}`],
    ["indicatorKeys", before.indicatorKeys, after.indicatorKeys],
    ["directionRules.preference", before.directionRules.preference, after.directionRules.preference],
    ["directionRules.long", before.directionRules.long, after.directionRules.long],
    ["directionRules.short", before.directionRules.short, after.directionRules.short],
    ["directionRules.noTrade", before.directionRules.noTrade, after.directionRules.noTrade],
    ["priceLevels.entry", before.priceLevels.entry, after.priceLevels.entry],
    ["priceLevels.invalidation", before.priceLevels.invalidation, after.priceLevels.invalidation],
    ["priceLevels.targets", before.priceLevels.targets, after.priceLevels.targets]
  ];
  return paths
    .filter(([, left, right]) => normalizeComparable(left) !== normalizeComparable(right))
    .map(([path, left, right]) => ({ path, before: left, after: right }));
}

function inferHorizon(text: string): PredictionTemplateDraft["horizon"] | null {
  const match = text.match(/\b(\d{1,3})\s*(min(?:ute)?s?|minuten?|h(?:ours?)?|stunden?|d(?:ays?)?|tage?n?)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  const token = match[2].toLowerCase();
  const unit: PredictionDraftHorizonUnit = token.startsWith("d") || token.startsWith("tag")
    ? "days"
    : token.startsWith("h") || token.startsWith("stund")
      ? "hours"
      : "minutes";
  return { value, unit };
}

function inferPrice(text: string, labels: string[]): number | null {
  const labelPattern = labels.join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*(?:at|bei|=|:)?\\s*\\$?([0-9]+(?:[.,][0-9]+)?)`, "i"));
  return match ? Number(match[1].replace(",", ".")) : null;
}

export function inferPredictionTemplateDraft(
  currentRaw: unknown,
  messages: Array<{ role: "assistant" | "user"; content: string }>,
  availableIndicators: Array<{ key: string; label?: string }>,
  aiPatch?: unknown
): PredictionTemplateDraft {
  const current = createPredictionTemplateDraft(currentRaw);
  const userText = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n").trim();
  const latest = messages.filter((message) => message.role === "user").at(-1)?.content.trim() ?? "";
  const lower = userText.toLowerCase();
  const inferredTimeframes = Array.from(lower.matchAll(/\b(5m|15m|1h|4h|1d)\b/g))
    .map((match) => match[1] as PredictionDraftTimeframe)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
  const inferredIndicators = availableIndicators
    .filter((indicator) => {
      const key = indicator.key.toLowerCase();
      const label = (indicator.label ?? "").toLowerCase();
      return lower.includes(key) || (label.length >= 3 && lower.includes(label));
    })
    .map((indicator) => indicator.key);
  const onlyLong = /\b(?:only\s+long|long\s+only|nur\s+long)\b/i.test(userText);
  const onlyShort = /\b(?:only\s+short|short\s+only|nur\s+short)\b/i.test(userText);
  const horizon = inferHorizon(userText);
  const entry = inferPrice(userText, ["entry", "einstieg"]);
  const invalidation = inferPrice(userText, ["invalidation", "invalidierung", "stop", "sl"]);
  const target = inferPrice(userText, ["target", "ziel", "take profit", "tp"]);

  const fallbackName = latest
    .replace(/[^a-zA-Z0-9ÄÖÜäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
  const hasNoTradeLanguage = /\b(no[- ]?trade|neutral|kein(?:en)?\s+trade|nicht\s+handeln|missing|fehlend|conflict|widerspr)\b/i.test(userText);
  const next: PredictionTemplateDraft = createPredictionTemplateDraft({
    ...current,
    revision: current.revision + 1,
    name: current.name || fallbackName,
    analysisGoal: latest || current.analysisGoal,
    timeframes: inferredTimeframes.length > 0 ? inferredTimeframes : current.timeframes,
    runTimeframe: inferredTimeframes[0] ?? current.runTimeframe,
    horizon: horizon ?? current.horizon,
    indicatorKeys: inferredIndicators.length > 0 ? inferredIndicators : current.indicatorKeys,
    directionRules: {
      ...current.directionRules,
      preference: onlyLong ? "long" : onlyShort ? "short" : current.directionRules.preference,
      long: onlyShort ? "" : (current.directionRules.long || (latest ? `Long only when: ${latest}` : "")),
      short: onlyLong ? "" : (current.directionRules.short || (latest ? `Short only when the inverse setup is confirmed: ${latest}` : "")),
      noTrade: current.directionRules.noTrade || (hasNoTradeLanguage
        ? latest
        : "No trade when required data is missing, indicators conflict, or confidence is below the configured threshold.")
    },
    priceLevels: {
      entry: entry ?? current.priceLevels.entry,
      invalidation: invalidation ?? current.priceLevels.invalidation,
      targets: target !== null ? [target] : current.priceLevels.targets
    }
  });

  const patch = aiPatch && typeof aiPatch === "object" ? aiPatch as Record<string, any> : {};
  return createPredictionTemplateDraft({
    ...next,
    name: cleanText(patch.name, 64) || next.name,
    analysisGoal: cleanText(patch.analysisGoal, 8000) || next.analysisGoal,
    timeframes: Array.isArray(patch.timeframes) ? patch.timeframes : next.timeframes,
    runTimeframe: patch.runTimeframe ?? next.runTimeframe,
    horizon: patch.horizon && typeof patch.horizon === "object" ? patch.horizon : next.horizon,
    indicatorKeys: Array.isArray(patch.indicatorKeys) ? patch.indicatorKeys : next.indicatorKeys,
    directionRules: patch.directionRules && typeof patch.directionRules === "object"
      ? { ...next.directionRules, ...patch.directionRules }
      : next.directionRules,
    priceLevels: patch.priceLevels && typeof patch.priceLevels === "object"
      ? { ...next.priceLevels, ...patch.priceLevels }
      : next.priceLevels
  });
}

export function buildPredictionTemplateStrategyDescription(draftRaw: unknown): string {
  const draft = createPredictionTemplateDraft(draftRaw);
  const levels = [
    draft.priceLevels.entry !== null ? `Entry: ${draft.priceLevels.entry}` : null,
    draft.priceLevels.invalidation !== null ? `Invalidation: ${draft.priceLevels.invalidation}` : null,
    draft.priceLevels.targets.length > 0 ? `Targets: ${draft.priceLevels.targets.join(", ")}` : null
  ].filter(Boolean);
  return [
    draft.analysisGoal,
    "",
    `Analysis horizon: ${draft.horizon.value} ${draft.horizon.unit}`,
    `Direction scope: ${draft.directionRules.preference}`,
    `Long rule: ${draft.directionRules.long || "disabled"}`,
    `Short rule: ${draft.directionRules.short || "disabled"}`,
    `No-trade rule: ${draft.directionRules.noTrade}`,
    levels.length > 0 ? `Price levels: ${levels.join("; ")}` : "Price levels: dynamic / not fixed",
    "This template is analysis-only and cannot place orders or activate a Prediction Copier."
  ].join("\n").slice(0, 8000);
}

export function predictionBuilderSafetyEnvelope() {
  return {
    allowedTools: [...PREDICTION_BUILDER_ALLOWED_TOOLS],
    forbiddenActions: [
      "place_order",
      "modify_position",
      "activate_prediction_copier",
      "update_prediction_copier_rules",
      "start_bot",
      "sign_wallet_transaction",
      "manage_api_keys"
    ],
    sideEffects: {
      predictionCreated: false,
      orderCreated: false,
      positionModified: false,
      copierConfigured: false,
      copierActivated: false
    }
  } as const;
}
