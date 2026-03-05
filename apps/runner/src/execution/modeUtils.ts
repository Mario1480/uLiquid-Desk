import type { TradeIntent } from "@mm/futures-core";
import {
  coerceGateSummary,
  defaultGateSummary
} from "../runtime/decisionTrace.js";
import type { SignalDecision } from "../signal/types.js";
import type { ExecutionResult } from "./types.js";

export function withLegacyIntent(signal: SignalDecision, intent: TradeIntent): SignalDecision {
  return {
    ...signal,
    legacyIntent: intent,
    metadata: {
      ...signal.metadata,
      signalIntentType: intent.type
    }
  };
}

export function buildModeNoopResult(signal: SignalDecision, reason: string, metadata: Record<string, unknown> = {}): ExecutionResult {
  return {
    status: "noop",
    reason,
    metadata: {
      preserveReason: true,
      ...metadata
    },
    legacy: {
      outcome: "ok",
      intent: { type: "none" },
      gate: coerceGateSummary(signal.metadata.gate, defaultGateSummary())
    }
  };
}

export function buildModeBlockedResult(signal: SignalDecision, reason: string, metadata: Record<string, unknown> = {}): ExecutionResult {
  return {
    status: "blocked",
    reason,
    metadata: {
      preserveReason: true,
      ...metadata
    },
    legacy: {
      outcome: "blocked",
      intent: signal.legacyIntent,
      gate: coerceGateSummary(signal.metadata.gate, defaultGateSummary())
    }
  };
}

export function toOrderMarkPrice(intent: TradeIntent): number | null {
  if (intent.type !== "open") return null;
  const order = intent.order ?? {};
  const raw = order.markPrice ?? order.price;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return null;
}

export function estimateAdverseMoveReached(params: {
  side: "long" | "short";
  referencePrice: number;
  markPrice: number;
  stepPct: number;
}): boolean {
  if (!Number.isFinite(params.referencePrice) || params.referencePrice <= 0) return false;
  if (!Number.isFinite(params.markPrice) || params.markPrice <= 0) return false;
  if (!Number.isFinite(params.stepPct) || params.stepPct <= 0) return false;

  const factor = params.stepPct / 100;
  if (params.side === "long") {
    return params.markPrice <= params.referencePrice * (1 - factor);
  }
  return params.markPrice >= params.referencePrice * (1 + factor);
}

export function applyLimitOffsetPrice(params: {
  intent: Extract<TradeIntent, { type: "open" }>;
  offsetBps: number;
}): Extract<TradeIntent, { type: "open" }> {
  const order = params.intent.order ?? {};
  if ((order.type ?? "market") !== "limit") return params.intent;
  if (order.price !== undefined) return params.intent;

  const markPrice = toOrderMarkPrice(params.intent);
  if (!markPrice) return params.intent;

  const offset = Math.max(0, params.offsetBps) / 10_000;
  const price = params.intent.side === "long"
    ? markPrice * (1 - offset)
    : markPrice * (1 + offset);

  return {
    ...params.intent,
    order: {
      ...order,
      price
    }
  };
}

export function withDesiredNotionalUsd(
  intent: Extract<TradeIntent, { type: "open" }>,
  desiredNotionalUsd: number
): Extract<TradeIntent, { type: "open" }> {
  const order = intent.order ?? {};
  const cleanedDesired = Math.max(0.000001, desiredNotionalUsd);

  return {
    ...intent,
    order: {
      ...order,
      desiredNotionalUsd: cleanedDesired,
      qty: undefined,
      riskUsd: undefined,
      stopDistancePct: undefined
    }
  };
}

export function withTpSlFromPct(params: {
  intent: Extract<TradeIntent, { type: "open" }>;
  markPrice: number | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}): Extract<TradeIntent, { type: "open" }> {
  if (!params.markPrice || params.markPrice <= 0) return params.intent;

  const order = params.intent.order ?? {};
  let takeProfitPrice = order.takeProfitPrice;
  let stopLossPrice = order.stopLossPrice;

  if (params.takeProfitPct && params.takeProfitPct > 0) {
    const factor = params.takeProfitPct / 100;
    takeProfitPrice = params.intent.side === "long"
      ? params.markPrice * (1 + factor)
      : params.markPrice * (1 - factor);
  }

  if (params.stopLossPct && params.stopLossPct > 0) {
    const factor = params.stopLossPct / 100;
    stopLossPrice = params.intent.side === "long"
      ? params.markPrice * (1 - factor)
      : params.markPrice * (1 + factor);
  }

  return {
    ...params.intent,
    order: {
      ...order,
      takeProfitPrice,
      stopLossPrice
    }
  };
}

export function scaleOpenIntent(
  intent: Extract<TradeIntent, { type: "open" }>,
  multiplier: number
): Extract<TradeIntent, { type: "open" }> {
  const scale = Number.isFinite(multiplier) ? Math.max(0.000001, multiplier) : 1;
  const order = intent.order ?? {};

  return {
    ...intent,
    order: {
      ...order,
      qty: typeof order.qty === "number" ? order.qty * scale : order.qty,
      desiredNotionalUsd:
        typeof order.desiredNotionalUsd === "number"
          ? order.desiredNotionalUsd * scale
          : order.desiredNotionalUsd,
      riskUsd: typeof order.riskUsd === "number" ? order.riskUsd * scale : order.riskUsd
    }
  };
}
