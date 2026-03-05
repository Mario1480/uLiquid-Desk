import { createDcaExecutionMode } from "../../execution/dcaExecutionMode.js";
import { createDipReversionExecutionMode } from "../../execution/dipReversionExecutionMode.js";
import { createGridExecutionMode } from "../../execution/gridExecutionMode.js";
import { createLegacyFuturesExecutionMode } from "../../execution/legacyFuturesExecutionMode.js";
import { predictionCopierExecutionMode } from "../../execution/predictionCopierExecutionMode.js";
import { createSimpleExecutionMode } from "../../execution/simpleExecutionMode.js";
import type { RunnerExecutionPlugin } from "../types.js";

const simpleExecutionMode = createSimpleExecutionMode();
const dcaExecutionMode = createDcaExecutionMode();
const gridExecutionMode = createGridExecutionMode();
const dipReversionExecutionMode = createDipReversionExecutionMode();
const legacyFuturesExecutionMode = createLegacyFuturesExecutionMode();

export const EXECUTION_PLUGIN_ID_SIMPLE = "core.execution.simple";
export const EXECUTION_PLUGIN_ID_DCA = "core.execution.dca";
export const EXECUTION_PLUGIN_ID_GRID = "core.execution.grid";
export const EXECUTION_PLUGIN_ID_DIP_REVERSION = "core.execution.dip_reversion";
export const EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY = "core.execution.futures_engine_legacy";
export const EXECUTION_PLUGIN_ID_PREDICTION_COPIER = "core.execution.prediction_copier";

export const builtinExecutionPlugins: RunnerExecutionPlugin[] = [
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_SIMPLE,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in simple execution mode",
      minPlan: "free",
      defaultEnabled: true,
      capabilities: ["runner.execution", "execution.simple"]
    },
    create() {
      return simpleExecutionMode;
    }
  },
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_DCA,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in DCA execution mode",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.execution", "execution.dca"]
    },
    create() {
      return dcaExecutionMode;
    }
  },
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_GRID,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in grid execution mode",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.execution", "execution.grid"]
    },
    create() {
      return gridExecutionMode;
    }
  },
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_DIP_REVERSION,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in dip reversion execution mode",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.execution", "execution.dip_reversion"]
    },
    create() {
      return dipReversionExecutionMode;
    }
  },
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_FUTURES_ENGINE_LEGACY,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in legacy futures execution mode alias",
      minPlan: "free",
      defaultEnabled: false,
      capabilities: ["runner.execution", "futures.engine"]
    },
    create() {
      return legacyFuturesExecutionMode;
    }
  },
  {
    manifest: {
      id: EXECUTION_PLUGIN_ID_PREDICTION_COPIER,
      kind: "execution",
      version: "1.0.0",
      description: "Built-in prediction copier execution mode",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.execution", "prediction.copier"]
    },
    create() {
      return predictionCopierExecutionMode;
    }
  }
];
