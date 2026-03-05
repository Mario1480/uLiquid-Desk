import type { ActiveFuturesBot } from "../db.js";

export type ExecutionModeName = "simple" | "dca" | "grid" | "dip_reversion";

export type ExecutionCommonConfig = {
  maxDailyExecutions: number;
  cooldownSecAfterExecution: number;
  maxNotionalPerSymbolUsd: number | null;
  maxTotalNotionalUsd: number | null;
  maxOpenPositions: number;
  enforceReduceOnlyOnClose: boolean;
};

export type ExecutionSimpleConfig = {
  orderType: "market" | "limit";
  limitOffsetBps: number;
};

export type ExecutionDcaConfig = {
  maxEntries: number;
  stepPct: number;
  sizeScale: number;
  entryOrderType: "market" | "limit";
  takeProfitPct: number | null;
  stopLossPct: number | null;
  cancelPendingOnFlip: boolean;
};

export type ExecutionGridConfig = {
  levelsPerSide: number;
  gridSpacingPct: number;
  baseOrderUsd: number;
  tpPctPerLevel: number;
  maxActiveOrders: number;
  rebalanceThresholdPct: number;
};

export type ExecutionDipReversionConfig = {
  dipTriggerPct: number;
  recoveryTakeProfitPct: number;
  maxHoldMinutes: number;
  maxReentriesPerDay: number;
  entryScaleUsd: number;
};

export type ExecutionSettings = {
  mode: ExecutionModeName;
  common: ExecutionCommonConfig;
  simple: ExecutionSimpleConfig;
  dca: ExecutionDcaConfig;
  grid: ExecutionGridConfig;
  dipReversion: ExecutionDipReversionConfig;
};

const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  mode: "simple",
  common: {
    maxDailyExecutions: 200,
    cooldownSecAfterExecution: 0,
    maxNotionalPerSymbolUsd: null,
    maxTotalNotionalUsd: null,
    maxOpenPositions: 1,
    enforceReduceOnlyOnClose: true
  },
  simple: {
    orderType: "market",
    limitOffsetBps: 2
  },
  dca: {
    maxEntries: 3,
    stepPct: 1.5,
    sizeScale: 1.25,
    entryOrderType: "limit",
    takeProfitPct: 2,
    stopLossPct: null,
    cancelPendingOnFlip: true
  },
  grid: {
    levelsPerSide: 4,
    gridSpacingPct: 0.5,
    baseOrderUsd: 100,
    tpPctPerLevel: 0.4,
    maxActiveOrders: 10,
    rebalanceThresholdPct: 1.5
  },
  dipReversion: {
    dipTriggerPct: 3,
    recoveryTakeProfitPct: 1.5,
    maxHoldMinutes: 720,
    maxReentriesPerDay: 2,
    entryScaleUsd: 100
  }
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNullablePositive(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseMode(value: unknown): ExecutionModeName | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "simple" || normalized === "dca" || normalized === "grid" || normalized === "dip_reversion") {
    return normalized;
  }
  return null;
}

function readExecutionRoot(paramsJson: unknown): AnyRecord {
  const params = asRecord(paramsJson);
  const execution = asRecord(params?.execution);
  return execution ?? {};
}

function readLegacyExecutionMode(paramsJson: unknown): ExecutionModeName | null {
  const params = asRecord(paramsJson);
  const direct = String(params?.executionMode ?? "").trim().toLowerCase();
  if (direct === "futures_engine" || direct === "simple") return "simple";
  if (direct === "dca" || direct === "grid" || direct === "dip_reversion") return direct;
  return null;
}

function parseCommonConfig(root: AnyRecord): ExecutionCommonConfig {
  const raw = asRecord(root.common) ?? {};
  return {
    maxDailyExecutions: Math.max(
      1,
      Math.min(10_000, toInt(raw.maxDailyExecutions) ?? DEFAULT_EXECUTION_SETTINGS.common.maxDailyExecutions)
    ),
    cooldownSecAfterExecution: Math.max(
      0,
      Math.min(86_400, toInt(raw.cooldownSecAfterExecution) ?? DEFAULT_EXECUTION_SETTINGS.common.cooldownSecAfterExecution)
    ),
    maxNotionalPerSymbolUsd: parseNullablePositive(raw.maxNotionalPerSymbolUsd),
    maxTotalNotionalUsd: parseNullablePositive(raw.maxTotalNotionalUsd),
    maxOpenPositions: Math.max(
      1,
      Math.min(100, toInt(raw.maxOpenPositions) ?? DEFAULT_EXECUTION_SETTINGS.common.maxOpenPositions)
    ),
    enforceReduceOnlyOnClose:
      typeof raw.enforceReduceOnlyOnClose === "boolean"
        ? raw.enforceReduceOnlyOnClose
        : DEFAULT_EXECUTION_SETTINGS.common.enforceReduceOnlyOnClose
  };
}

function parseSimpleConfig(root: AnyRecord): ExecutionSimpleConfig {
  const raw = asRecord(root.simple) ?? {};
  const orderTypeRaw = String(raw.orderType ?? DEFAULT_EXECUTION_SETTINGS.simple.orderType).trim().toLowerCase();
  return {
    orderType: orderTypeRaw === "limit" ? "limit" : "market",
    limitOffsetBps: clamp(
      toNumber(raw.limitOffsetBps) ?? DEFAULT_EXECUTION_SETTINGS.simple.limitOffsetBps,
      0,
      500
    )
  };
}

function parseDcaConfig(root: AnyRecord): ExecutionDcaConfig {
  const raw = asRecord(root.dca) ?? {};
  const entryOrderTypeRaw = String(raw.entryOrderType ?? DEFAULT_EXECUTION_SETTINGS.dca.entryOrderType)
    .trim()
    .toLowerCase();

  return {
    maxEntries: Math.max(1, Math.min(20, toInt(raw.maxEntries) ?? DEFAULT_EXECUTION_SETTINGS.dca.maxEntries)),
    stepPct: clamp(toNumber(raw.stepPct) ?? DEFAULT_EXECUTION_SETTINGS.dca.stepPct, 0.01, 50),
    sizeScale: clamp(toNumber(raw.sizeScale) ?? DEFAULT_EXECUTION_SETTINGS.dca.sizeScale, 1, 5),
    entryOrderType: entryOrderTypeRaw === "market" ? "market" : "limit",
    takeProfitPct: parseNullablePositive(raw.takeProfitPct) ?? DEFAULT_EXECUTION_SETTINGS.dca.takeProfitPct,
    stopLossPct: parseNullablePositive(raw.stopLossPct) ?? DEFAULT_EXECUTION_SETTINGS.dca.stopLossPct,
    cancelPendingOnFlip:
      typeof raw.cancelPendingOnFlip === "boolean"
        ? raw.cancelPendingOnFlip
        : DEFAULT_EXECUTION_SETTINGS.dca.cancelPendingOnFlip
  };
}

function parseGridConfig(root: AnyRecord): ExecutionGridConfig {
  const raw = asRecord(root.grid) ?? {};
  return {
    levelsPerSide: Math.max(1, Math.min(40, toInt(raw.levelsPerSide) ?? DEFAULT_EXECUTION_SETTINGS.grid.levelsPerSide)),
    gridSpacingPct: clamp(toNumber(raw.gridSpacingPct) ?? DEFAULT_EXECUTION_SETTINGS.grid.gridSpacingPct, 0.01, 10),
    baseOrderUsd: Math.max(1, toNumber(raw.baseOrderUsd) ?? DEFAULT_EXECUTION_SETTINGS.grid.baseOrderUsd),
    tpPctPerLevel: clamp(toNumber(raw.tpPctPerLevel) ?? DEFAULT_EXECUTION_SETTINGS.grid.tpPctPerLevel, 0.01, 20),
    maxActiveOrders: Math.max(1, Math.min(200, toInt(raw.maxActiveOrders) ?? DEFAULT_EXECUTION_SETTINGS.grid.maxActiveOrders)),
    rebalanceThresholdPct: clamp(
      toNumber(raw.rebalanceThresholdPct) ?? DEFAULT_EXECUTION_SETTINGS.grid.rebalanceThresholdPct,
      0.01,
      25
    )
  };
}

function parseDipReversionConfig(root: AnyRecord): ExecutionDipReversionConfig {
  const raw = asRecord(root.dipReversion) ?? asRecord(root.dip_reversion) ?? {};
  return {
    dipTriggerPct: clamp(toNumber(raw.dipTriggerPct) ?? DEFAULT_EXECUTION_SETTINGS.dipReversion.dipTriggerPct, 0.1, 30),
    recoveryTakeProfitPct: clamp(
      toNumber(raw.recoveryTakeProfitPct) ?? DEFAULT_EXECUTION_SETTINGS.dipReversion.recoveryTakeProfitPct,
      0.1,
      30
    ),
    maxHoldMinutes: Math.max(1, Math.min(20_160, toInt(raw.maxHoldMinutes) ?? DEFAULT_EXECUTION_SETTINGS.dipReversion.maxHoldMinutes)),
    maxReentriesPerDay: Math.max(1, Math.min(100, toInt(raw.maxReentriesPerDay) ?? DEFAULT_EXECUTION_SETTINGS.dipReversion.maxReentriesPerDay)),
    entryScaleUsd: Math.max(1, toNumber(raw.entryScaleUsd) ?? DEFAULT_EXECUTION_SETTINGS.dipReversion.entryScaleUsd)
  };
}

export function readExplicitExecutionModeFromBot(bot: ActiveFuturesBot): ExecutionModeName | null {
  if (bot.strategyKey === "prediction_copier") return null;
  const root = readExecutionRoot(bot.paramsJson);
  const explicit = parseMode(root.mode);
  if (explicit) return explicit;
  return readLegacyExecutionMode(bot.paramsJson);
}

export function readExecutionSettings(bot: ActiveFuturesBot): ExecutionSettings {
  const root = readExecutionRoot(bot.paramsJson);
  const explicitMode = readExplicitExecutionModeFromBot(bot);

  const common = parseCommonConfig(root);
  if (
    common.maxNotionalPerSymbolUsd !== null
    && common.maxTotalNotionalUsd !== null
    && common.maxTotalNotionalUsd < common.maxNotionalPerSymbolUsd
  ) {
    common.maxTotalNotionalUsd = common.maxNotionalPerSymbolUsd;
  }

  return {
    mode: explicitMode ?? DEFAULT_EXECUTION_SETTINGS.mode,
    common,
    simple: parseSimpleConfig(root),
    dca: parseDcaConfig(root),
    grid: parseGridConfig(root),
    dipReversion: parseDipReversionConfig(root)
  };
}

export function defaultExecutionSettings(): ExecutionSettings {
  return {
    mode: DEFAULT_EXECUTION_SETTINGS.mode,
    common: { ...DEFAULT_EXECUTION_SETTINGS.common },
    simple: { ...DEFAULT_EXECUTION_SETTINGS.simple },
    dca: { ...DEFAULT_EXECUTION_SETTINGS.dca },
    grid: { ...DEFAULT_EXECUTION_SETTINGS.grid },
    dipReversion: { ...DEFAULT_EXECUTION_SETTINGS.dipReversion }
  };
}
