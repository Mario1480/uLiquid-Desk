import { createLegacyDummySignalEngine } from "../../signal/legacyDummySignalEngine.js";
import { predictionCopierSignalEngine } from "../../signal/predictionCopierSignalEngine.js";
import type { RunnerSignalPlugin } from "../types.js";

const legacyDummyEngine = createLegacyDummySignalEngine();

export const SIGNAL_PLUGIN_ID_LEGACY_DUMMY = "core.signal.legacy_dummy";
export const SIGNAL_PLUGIN_ID_PREDICTION_COPIER = "core.signal.prediction_copier";

export const builtinSignalPlugins: RunnerSignalPlugin[] = [
  {
    manifest: {
      id: SIGNAL_PLUGIN_ID_LEGACY_DUMMY,
      kind: "signal",
      version: "1.0.0",
      description: "Built-in legacy dummy signal engine",
      minPlan: "free",
      defaultEnabled: true,
      capabilities: ["runner.signal"]
    },
    create() {
      return legacyDummyEngine;
    }
  },
  {
    manifest: {
      id: SIGNAL_PLUGIN_ID_PREDICTION_COPIER,
      kind: "signal",
      version: "1.0.0",
      description: "Built-in prediction copier signal engine",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.signal", "prediction.copier"]
    },
    create() {
      return predictionCopierSignalEngine;
    }
  }
];
