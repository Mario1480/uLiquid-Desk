import crypto from "node:crypto";

export type PositionCopilotMarketType = "spot" | "perp";
export type PositionCopilotRiskLevel = "low" | "medium" | "high" | "critical";
export type PositionCopilotPreferenceMode = "critical_only" | "important_changes" | "periodic_summary" | "off";

export type PositionCopilotSnapshot = {
  exchangeAccountId: string;
  exchange: string;
  marketType: PositionCopilotMarketType;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnlUsd: number | null;
  leverage: number | null;
  marginMode: "isolated" | "cross" | null;
  marginUsd: number | null;
  notionalUsd: number | null;
  liquidationPrice: number | null;
  liquidationDistancePct: number | null;
  roePct: number | null;
  pnlPct: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  dataDegraded: boolean;
  observedAt: string;
  openedByPredictionCopier: boolean;
};

export type PositionCopilotFinding = {
  code: string;
  severity: PositionCopilotRiskLevel;
  message: string;
};

export type PositionCopilotAnalysis = {
  snapshotHash: string;
  riskLevel: PositionCopilotRiskLevel;
  thesisStatus: "intact" | "weakened" | "invalidated" | "unknown";
  summary: string;
  riskFactors: PositionCopilotFinding[];
  events: PositionCopilotFinding[];
  dataQuality: {
    state: "complete" | "degraded";
    missingFields: string[];
    observedAt: string;
  };
  openedByPredictionCopier: boolean;
  readOnly: true;
  generatedAt: string;
};

export type PositionCopilotTriggerState = {
  previousSnapshotHash: string | null;
  previousRiskLevel: PositionCopilotRiskLevel | null;
  lastNotifiedAt: Date | null;
};

const RISK_WEIGHT: Record<PositionCopilotRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 40);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`;
}

export function buildPositionCopilotSnapshot(input: Record<string, unknown>): PositionCopilotSnapshot {
  const marketType: PositionCopilotMarketType = input.marketType === "spot" ? "spot" : "perp";
  const side = input.side === "short" ? "short" : "long";
  return {
    exchangeAccountId: String(input.exchangeAccountId ?? "").trim().slice(0, 100),
    exchange: String(input.exchange ?? "").trim().toLowerCase().slice(0, 40),
    marketType,
    symbol: normalizeSymbol(input.symbol),
    side,
    size: Math.abs(toFiniteNumber(input.size) ?? 0),
    entryPrice: toPositiveNumber(input.entryPrice),
    markPrice: toPositiveNumber(input.markPrice),
    unrealizedPnlUsd: toFiniteNumber(input.unrealizedPnlUsd),
    leverage: marketType === "spot" ? null : toPositiveNumber(input.leverage),
    marginMode: marketType === "spot"
      ? null
      : input.marginMode === "cross"
        ? "cross"
        : input.marginMode === "isolated"
          ? "isolated"
          : null,
    marginUsd: marketType === "spot" ? null : toPositiveNumber(input.marginUsd),
    notionalUsd: toPositiveNumber(input.notionalUsd),
    liquidationPrice: marketType === "spot" ? null : toPositiveNumber(input.liquidationPrice),
    liquidationDistancePct: marketType === "spot" ? null : toFiniteNumber(input.liquidationDistancePct),
    roePct: marketType === "spot" ? null : toFiniteNumber(input.roePct),
    pnlPct: toFiniteNumber(input.pnlPct),
    stopLossPrice: toPositiveNumber(input.stopLossPrice),
    takeProfitPrice: toPositiveNumber(input.takeProfitPrice),
    dataDegraded: input.dataDegraded === true,
    observedAt: typeof input.observedAt === "string" && Number.isFinite(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString()
      : new Date().toISOString(),
    openedByPredictionCopier: input.openedByPredictionCopier === true
  };
}

export function hashPositionCopilotSnapshot(snapshot: PositionCopilotSnapshot): string {
  const stableSnapshot = { ...snapshot, observedAt: null };
  return crypto.createHash("sha256").update(stableStringify(stableSnapshot)).digest("hex");
}

function maxRisk(left: PositionCopilotRiskLevel, right: PositionCopilotRiskLevel): PositionCopilotRiskLevel {
  return RISK_WEIGHT[right] > RISK_WEIGHT[left] ? right : left;
}

export function buildDeterministicPositionAnalysis(
  snapshot: PositionCopilotSnapshot,
  now = new Date(),
  language: "de" | "en" = "en"
): PositionCopilotAnalysis {
  const copy = language === "de" ? {
    liquidationCritical: "Die Liquidationsdistanz ist kritisch eng.",
    liquidationEvent: (distance: number) => `Die Liquidationsdistanz beträgt ${distance.toFixed(2)} %.`,
    liquidationHigh: "Die Liquidationsdistanz ist eng.",
    liquidationWatch: "Die Liquidationsdistanz sollte beobachtet werden.",
    stopLossMissing: "Im Snapshot ist kein Stop-Loss sichtbar.",
    drawdownHigh: "Die Position weist einen wesentlichen Drawdown auf.",
    drawdownEvent: "Die Verlustkennzahlen haben eine hohe Risikoschwelle überschritten.",
    underwater: "Die Position liegt aktuell unter ihrer Einstiegsbasis.",
    degraded: "Einige Risikofelder fehlen oder sind möglicherweise veraltet.",
    summaryDegraded: "Der Snapshot ist unvollständig. Behandle die Risikoeinschätzung als eingeschränkt und prüfe die Live-Position manuell.",
    summaryCritical: "Es wurde ein kritisches Positionsrisiko erkannt. Prüfe die Live-Position und die Exchange-Daten umgehend.",
    summaryHigh: "Es wurde ein erhöhtes Positionsrisiko erkannt. Prüfe Exposure, Schutzmarken und die aktuelle Marktlage.",
    summaryMedium: "Die Position benötigt Aufmerksamkeit, aktuell ist jedoch keine kritische Schwelle sichtbar.",
    summaryLow: "Im aktuellen Snapshot ist keine erhöhte Risikoschwelle sichtbar."
  } : {
    liquidationCritical: "Liquidation distance is critically tight.",
    liquidationEvent: (distance: number) => `Liquidation distance is ${distance.toFixed(2)}%.`,
    liquidationHigh: "Liquidation distance is tight.",
    liquidationWatch: "Liquidation distance should be monitored.",
    stopLossMissing: "No stop-loss is visible in the snapshot.",
    drawdownHigh: "The position is in a material drawdown.",
    drawdownEvent: "Loss metrics crossed a high-risk threshold.",
    underwater: "The position is currently below its entry basis.",
    degraded: "Some risk fields are unavailable or stale.",
    summaryDegraded: "The snapshot is incomplete. Treat the risk assessment as degraded and review the live position manually.",
    summaryCritical: "Critical position risk detected. Review the live position and exchange data immediately.",
    summaryHigh: "Elevated position risk detected. Review exposure, protection levels and current market conditions.",
    summaryMedium: "The position needs attention, but no critical threshold is currently visible.",
    summaryLow: "No elevated risk threshold is visible in the current snapshot."
  };
  const riskFactors: PositionCopilotFinding[] = [];
  const events: PositionCopilotFinding[] = [];
  const missingFields: string[] = [];
  let riskLevel: PositionCopilotRiskLevel = "low";

  if (!snapshot.symbol) missingFields.push("symbol");
  if (snapshot.size <= 0) missingFields.push("size");
  if (snapshot.markPrice === null) missingFields.push("markPrice");
  if (snapshot.entryPrice === null) missingFields.push("entryPrice");
  if (snapshot.marketType === "perp" && snapshot.liquidationDistancePct === null) {
    missingFields.push("liquidationDistancePct");
  }

  const liqDistance = snapshot.liquidationDistancePct;
  if (snapshot.marketType === "perp" && liqDistance !== null) {
    if (liqDistance <= 5) {
      riskLevel = "critical";
      riskFactors.push({ code: "liquidation_distance_critical", severity: "critical", message: copy.liquidationCritical });
      events.push({ code: "liquidation_proximity", severity: "critical", message: copy.liquidationEvent(liqDistance) });
    } else if (liqDistance <= 10) {
      riskLevel = maxRisk(riskLevel, "high");
      riskFactors.push({ code: "liquidation_distance_high", severity: "high", message: copy.liquidationHigh });
    } else if (liqDistance <= 20) {
      riskLevel = maxRisk(riskLevel, "medium");
      riskFactors.push({ code: "liquidation_distance_watch", severity: "medium", message: copy.liquidationWatch });
    }
  }

  if (snapshot.marketType === "perp" && snapshot.stopLossPrice === null) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskFactors.push({ code: "stop_loss_missing", severity: "medium", message: copy.stopLossMissing });
  }
  if ((snapshot.roePct ?? 0) <= -20 || (snapshot.pnlPct ?? 0) <= -10) {
    riskLevel = maxRisk(riskLevel, "high");
    riskFactors.push({ code: "drawdown_high", severity: "high", message: copy.drawdownHigh });
    events.push({ code: "drawdown_change", severity: "high", message: copy.drawdownEvent });
  } else if ((snapshot.pnlPct ?? 0) < 0) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskFactors.push({ code: "position_underwater", severity: "medium", message: copy.underwater });
  }

  const degraded = snapshot.dataDegraded || missingFields.length > 0;
  if (degraded) {
    riskLevel = maxRisk(riskLevel, "medium");
    riskFactors.push({ code: "data_quality_degraded", severity: "medium", message: copy.degraded });
  }

  const thesisStatus = degraded
    ? "unknown"
    : riskLevel === "critical"
      ? "invalidated"
      : riskLevel === "high"
        ? "weakened"
        : "intact";
  const summary = degraded
    ? copy.summaryDegraded
    : riskLevel === "critical"
      ? copy.summaryCritical
      : riskLevel === "high"
        ? copy.summaryHigh
        : riskLevel === "medium"
          ? copy.summaryMedium
          : copy.summaryLow;

  return {
    snapshotHash: hashPositionCopilotSnapshot(snapshot),
    riskLevel,
    thesisStatus,
    summary,
    riskFactors,
    events,
    dataQuality: {
      state: degraded ? "degraded" : "complete",
      missingFields,
      observedAt: snapshot.observedAt
    },
    openedByPredictionCopier: snapshot.openedByPredictionCopier,
    readOnly: true,
    generatedAt: now.toISOString()
  };
}

export function shouldNotifyForPositionCopilot(params: {
  mode: PositionCopilotPreferenceMode;
  analysis: PositionCopilotAnalysis;
  state: PositionCopilotTriggerState;
  now: Date;
  cooldownMs?: number;
  periodicMs?: number;
}): { notify: boolean; reason: string } {
  if (params.mode === "off") return { notify: false, reason: "notifications_off" };
  const cooldownMs = Math.max(60_000, params.cooldownMs ?? 15 * 60_000);
  const elapsedMs = params.state.lastNotifiedAt
    ? params.now.getTime() - params.state.lastNotifiedAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (elapsedMs < cooldownMs) return { notify: false, reason: "cooldown_active" };

  const snapshotChanged = params.state.previousSnapshotHash !== params.analysis.snapshotHash;
  const riskChanged = params.state.previousRiskLevel !== params.analysis.riskLevel;
  if (params.mode === "critical_only") {
    return params.analysis.riskLevel === "critical" && (snapshotChanged || riskChanged)
      ? { notify: true, reason: "critical_risk" }
      : { notify: false, reason: "critical_threshold_not_met" };
  }
  if (params.mode === "important_changes") {
    const important = params.analysis.riskLevel === "high" || params.analysis.riskLevel === "critical";
    return important && (snapshotChanged || riskChanged)
      ? { notify: true, reason: "important_change" }
      : { notify: false, reason: "no_important_change" };
  }
  const periodicMs = Math.max(cooldownMs, params.periodicMs ?? 60 * 60_000);
  return elapsedMs >= periodicMs
    ? { notify: true, reason: "periodic_summary_due" }
    : { notify: false, reason: "periodic_summary_not_due" };
}
