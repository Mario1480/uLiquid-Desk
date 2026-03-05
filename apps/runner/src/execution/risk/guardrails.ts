import type { TradeIntent } from "@mm/futures-core";
import type { ExecutionCommonConfig } from "../config.js";

export type ExecutionModeState = {
  version: 1;
  dailyExecutionDate: string;
  dailyExecutionCount: number;
  cooldownUntil: string | null;
  openPositionSymbols: string[];
  modes: {
    dca?: Record<string, {
      side: "long" | "short";
      entryCount: number;
      lastEntryPrice: number | null;
      lastEntryAt: string | null;
    }>;
    grid?: Record<string, {
      side: "long" | "short";
      anchorPrice: number | null;
      lastEntryPrice: number | null;
      filledLevels: number;
      activeOrders: number;
    }>;
    dipReversion?: Record<string, {
      referenceHigh: number | null;
      referenceLow: number | null;
      entriesTodayDate: string;
      entriesTodayCount: number;
      openSince: string | null;
      side: "long" | "short" | null;
    }>;
  };
  updatedAt: string;
};

export type ExecutionGuardrailsResult =
  | {
    allow: true;
    reason: null;
    state: ExecutionModeState;
    meta: Record<string, unknown>;
  }
  | {
    allow: false;
    reason: string;
    state: ExecutionModeState;
    meta: Record<string, unknown>;
  };

type ExecutionSuccessStateParams = {
  intent: Extract<TradeIntent, { type: "open" | "close" }>;
  common: ExecutionCommonConfig;
  state: ExecutionModeState;
  now: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStringArray(value: unknown, limit = 128): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeDcaModes(value: unknown): ExecutionModeState["modes"]["dca"] {
  const row = asRecord(value);
  if (!row) return {};

  const out: NonNullable<ExecutionModeState["modes"]["dca"]> = {};
  for (const [symbol, raw] of Object.entries(row)) {
    const item = asRecord(raw);
    if (!item) continue;
    const sideRaw = String(item.side ?? "").trim().toLowerCase();
    const side = sideRaw === "short" ? "short" : sideRaw === "long" ? "long" : null;
    if (!side) continue;

    out[symbol] = {
      side,
      entryCount: Math.max(0, Math.min(1000, Math.trunc(toNumber(item.entryCount) ?? 0))),
      lastEntryPrice: toNumber(item.lastEntryPrice),
      lastEntryAt: typeof item.lastEntryAt === "string" && item.lastEntryAt.trim() ? item.lastEntryAt.trim() : null
    };
  }

  return out;
}

function normalizeGridModes(value: unknown): ExecutionModeState["modes"]["grid"] {
  const row = asRecord(value);
  if (!row) return {};

  const out: NonNullable<ExecutionModeState["modes"]["grid"]> = {};
  for (const [symbol, raw] of Object.entries(row)) {
    const item = asRecord(raw);
    if (!item) continue;
    const sideRaw = String(item.side ?? "").trim().toLowerCase();
    const side = sideRaw === "short" ? "short" : sideRaw === "long" ? "long" : null;
    if (!side) continue;

    out[symbol] = {
      side,
      anchorPrice: toNumber(item.anchorPrice),
      lastEntryPrice: toNumber(item.lastEntryPrice),
      filledLevels: Math.max(0, Math.min(1000, Math.trunc(toNumber(item.filledLevels) ?? 0))),
      activeOrders: Math.max(0, Math.min(5000, Math.trunc(toNumber(item.activeOrders) ?? 0)))
    };
  }

  return out;
}

function normalizeDipModes(value: unknown, now: Date): ExecutionModeState["modes"]["dipReversion"] {
  const row = asRecord(value);
  if (!row) return {};

  const out: NonNullable<ExecutionModeState["modes"]["dipReversion"]> = {};
  for (const [symbol, raw] of Object.entries(row)) {
    const item = asRecord(raw);
    if (!item) continue;

    const sideRaw = String(item.side ?? "").trim().toLowerCase();
    const side: "long" | "short" | null =
      sideRaw === "long" ? "long" : sideRaw === "short" ? "short" : null;

    out[symbol] = {
      referenceHigh: toNumber(item.referenceHigh),
      referenceLow: toNumber(item.referenceLow),
      entriesTodayDate:
        typeof item.entriesTodayDate === "string" && item.entriesTodayDate.trim()
          ? item.entriesTodayDate.trim()
          : toUtcDate(now),
      entriesTodayCount: Math.max(0, Math.min(1000, Math.trunc(toNumber(item.entriesTodayCount) ?? 0))),
      openSince: typeof item.openSince === "string" && item.openSince.trim() ? item.openSince.trim() : null,
      side
    };
  }

  return out;
}

export function normalizeExecutionModeState(value: unknown, now: Date = new Date()): ExecutionModeState {
  const row = asRecord(value);
  const dailyExecutionDateRaw = typeof row?.dailyExecutionDate === "string"
    ? row.dailyExecutionDate.trim()
    : "";

  const today = toUtcDate(now);
  const dailyExecutionDate = dailyExecutionDateRaw || today;
  const baseCount = Math.max(0, Math.min(100000, Math.trunc(toNumber(row?.dailyExecutionCount) ?? 0)));
  const dailyExecutionCount = dailyExecutionDate === today ? baseCount : 0;

  const modes = asRecord(row?.modes) ?? {};

  return {
    version: 1,
    dailyExecutionDate,
    dailyExecutionCount,
    cooldownUntil: typeof row?.cooldownUntil === "string" && row.cooldownUntil.trim()
      ? row.cooldownUntil.trim()
      : null,
    openPositionSymbols: normalizeStringArray(row?.openPositionSymbols, 256),
    modes: {
      dca: normalizeDcaModes(modes.dca),
      grid: normalizeGridModes(modes.grid),
      dipReversion: normalizeDipModes(modes.dipReversion, now)
    },
    updatedAt: typeof row?.updatedAt === "string" && row.updatedAt.trim()
      ? row.updatedAt.trim()
      : now.toISOString()
  };
}

function ensureDailyState(state: ExecutionModeState, now: Date): ExecutionModeState {
  const today = toUtcDate(now);
  if (state.dailyExecutionDate === today) return state;
  return {
    ...state,
    dailyExecutionDate: today,
    dailyExecutionCount: 0,
    updatedAt: now.toISOString()
  };
}

function estimateIntentNotionalUsd(intent: TradeIntent): number | null {
  if (intent.type !== "open") return null;
  const order = intent.order ?? {};

  const desired = toNumber(order.desiredNotionalUsd);
  if (desired !== null && desired > 0) return desired;

  const qty = toNumber(order.qty);
  const markPrice = toNumber(order.markPrice ?? order.price);
  if (qty !== null && qty > 0 && markPrice !== null && markPrice > 0) {
    return Math.abs(qty) * markPrice;
  }

  return null;
}

function enforceCloseReduceOnly(intent: TradeIntent): TradeIntent {
  if (intent.type !== "close") return intent;
  const order = intent.order ?? {};
  if (order.reduceOnly === true) return intent;
  return {
    ...intent,
    order: {
      ...order,
      reduceOnly: true
    }
  };
}

export function applyCommonIntentSafety(
  intent: TradeIntent,
  common: ExecutionCommonConfig
): TradeIntent {
  if (!common.enforceReduceOnlyOnClose) return intent;
  return enforceCloseReduceOnly(intent);
}

export function evaluateExecutionGuardrails(params: {
  intent: TradeIntent;
  common: ExecutionCommonConfig;
  state: ExecutionModeState;
  now: Date;
}): ExecutionGuardrailsResult {
  const state = ensureDailyState(params.state, params.now);
  const nowMs = params.now.getTime();

  if (state.cooldownUntil) {
    const cooldownUntilMs = new Date(state.cooldownUntil).getTime();
    if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
      return {
        allow: false,
        reason: "execution_guard_cooldown_active",
        state,
        meta: {
          cooldownUntil: state.cooldownUntil,
          remainingMs: cooldownUntilMs - nowMs
        }
      };
    }
  }

  if (params.intent.type === "open") {
    const projectedOpenPositions = state.openPositionSymbols.includes(params.intent.symbol)
      ? state.openPositionSymbols.length
      : state.openPositionSymbols.length + 1;

    if (projectedOpenPositions > params.common.maxOpenPositions) {
      return {
        allow: false,
        reason: "execution_guard_max_open_positions_reached",
        state,
        meta: {
          currentOpenPositions: state.openPositionSymbols.length,
          projectedOpenPositions,
          maxOpenPositions: params.common.maxOpenPositions,
          symbol: params.intent.symbol
        }
      };
    }

    const estimatedNotional = estimateIntentNotionalUsd(params.intent);
    if (estimatedNotional !== null && params.common.maxNotionalPerSymbolUsd !== null) {
      if (estimatedNotional > params.common.maxNotionalPerSymbolUsd) {
        return {
          allow: false,
          reason: "execution_guard_symbol_notional_limit",
          state,
          meta: {
            estimatedNotional,
            maxNotionalPerSymbolUsd: params.common.maxNotionalPerSymbolUsd,
            symbol: params.intent.symbol
          }
        };
      }
    }

    if (estimatedNotional !== null && params.common.maxTotalNotionalUsd !== null) {
      if (estimatedNotional > params.common.maxTotalNotionalUsd) {
        return {
          allow: false,
          reason: "execution_guard_total_notional_limit",
          state,
          meta: {
            estimatedNotional,
            maxTotalNotionalUsd: params.common.maxTotalNotionalUsd,
            symbol: params.intent.symbol
          }
        };
      }
    }
  }

  if (state.dailyExecutionCount >= params.common.maxDailyExecutions) {
    return {
      allow: false,
      reason: "execution_guard_max_daily_executions_reached",
      state,
      meta: {
        dailyExecutionCount: state.dailyExecutionCount,
        maxDailyExecutions: params.common.maxDailyExecutions
      }
    };
  }

  return {
    allow: true,
    reason: null,
    state,
    meta: {}
  };
}

export function applyExecutionSuccessToState(params: ExecutionSuccessStateParams): ExecutionModeState {
  const state = ensureDailyState(params.state, params.now);
  const nextSymbols = [...state.openPositionSymbols];

  if (params.intent.type === "open") {
    if (!nextSymbols.includes(params.intent.symbol)) {
      nextSymbols.push(params.intent.symbol);
    }
  }

  if (params.intent.type === "close") {
    const idx = nextSymbols.indexOf(params.intent.symbol);
    if (idx >= 0) nextSymbols.splice(idx, 1);
  }

  const cooldownSec = Math.max(0, params.common.cooldownSecAfterExecution);
  const cooldownUntil = cooldownSec > 0
    ? new Date(params.now.getTime() + cooldownSec * 1000).toISOString()
    : null;

  return {
    ...state,
    dailyExecutionDate: toUtcDate(params.now),
    dailyExecutionCount: state.dailyExecutionCount + 1,
    cooldownUntil,
    openPositionSymbols: nextSymbols,
    updatedAt: params.now.toISOString()
  };
}
