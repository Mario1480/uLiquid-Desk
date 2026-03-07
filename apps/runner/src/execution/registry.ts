import type { ActiveFuturesBot } from "../db.js";
import { readExplicitExecutionModeFromBot } from "./config.js";
import { createDcaExecutionMode } from "./dcaExecutionMode.js";
import { createDipReversionExecutionMode } from "./dipReversionExecutionMode.js";
import { createFuturesGridExecutionMode } from "./futuresGridExecutionMode.js";
import { createGridExecutionMode } from "./gridExecutionMode.js";
import { createLegacyFuturesExecutionMode } from "./legacyFuturesExecutionMode.js";
import { predictionCopierExecutionMode } from "./predictionCopierExecutionMode.js";
import { createSimpleExecutionMode } from "./simpleExecutionMode.js";
import type { ExecutionMode } from "./types.js";

export type ExecutionModeKey =
  | "simple"
  | "dca"
  | "grid"
  | "dip_reversion"
  | "futures_engine"
  | "prediction_copier"
  | "futures_grid";

type StrategyExecutionBindings = Record<string, ExecutionModeKey>;

type RegistryOptions = {
  defaultModeKey?: ExecutionModeKey;
  strategyBindings?: StrategyExecutionBindings;
  modes?: Partial<Record<ExecutionModeKey, ExecutionMode>>;
};

const DEFAULT_MODE_KEY: ExecutionModeKey = "simple";

const DEFAULT_BINDINGS: StrategyExecutionBindings = {
  prediction_copier: "prediction_copier",
  futures_grid: "futures_grid"
};

const BUILTIN_MODES: Record<ExecutionModeKey, ExecutionMode> = {
  simple: createSimpleExecutionMode(),
  dca: createDcaExecutionMode(),
  grid: createGridExecutionMode(),
  dip_reversion: createDipReversionExecutionMode(),
  futures_engine: createLegacyFuturesExecutionMode(),
  prediction_copier: predictionCopierExecutionMode,
  futures_grid: createFuturesGridExecutionMode()
};

function normalizeString(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isExecutionModeKey(value: string): value is ExecutionModeKey {
  return (
    value === "simple"
    || value === "dca"
    || value === "grid"
    || value === "dip_reversion"
    || value === "futures_engine"
    || value === "prediction_copier"
    || value === "futures_grid"
  );
}

function readExecutionModeOverrideFromParams(bot: ActiveFuturesBot): ExecutionModeKey | null {
  const explicitMode = readExplicitExecutionModeFromBot(bot);
  if (explicitMode) {
    return explicitMode;
  }

  const params = bot.paramsJson;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const row = params as Record<string, unknown>;
  const directRaw = normalizeString(row.executionMode);
  if (isExecutionModeKey(directRaw)) {
    return directRaw;
  }

  const predictionCopier = row.predictionCopier;
  if (predictionCopier && typeof predictionCopier === "object" && !Array.isArray(predictionCopier)) {
    const nestedRaw = normalizeString((predictionCopier as Record<string, unknown>).executionMode);
    if (isExecutionModeKey(nestedRaw)) {
      return nestedRaw;
    }
  }

  return null;
}

export function resolveExecutionModeKeyForBot(
  bot: ActiveFuturesBot,
  options: RegistryOptions = {}
): ExecutionModeKey {
  const override = readExecutionModeOverrideFromParams(bot);
  if (override) return override;

  const strategyKey = normalizeString(bot.strategyKey);
  const bindings = options.strategyBindings ?? DEFAULT_BINDINGS;
  const fromBinding = bindings[strategyKey];
  if (fromBinding) return fromBinding;

  return options.defaultModeKey ?? DEFAULT_MODE_KEY;
}

export function resolveExecutionModeForBot(
  bot: ActiveFuturesBot,
  options: RegistryOptions = {}
): ExecutionMode {
  const modeKey = resolveExecutionModeKeyForBot(bot, options);
  const modes = {
    ...BUILTIN_MODES,
    ...(options.modes ?? {})
  };
  return modes[modeKey] ?? modes[options.defaultModeKey ?? DEFAULT_MODE_KEY] ?? BUILTIN_MODES.futures_engine;
}
