import type { RunnerSignalSourcePlugin } from "../types.js";

export const SIGNAL_SOURCE_PLUGIN_ID_NONE = "core.signal_source.none";
export const SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE = "core.signal_source.prediction_state";

export const builtinSignalSourcePlugins: RunnerSignalSourcePlugin[] = [
  {
    manifest: {
      id: SIGNAL_SOURCE_PLUGIN_ID_NONE,
      kind: "signal_source",
      version: "1.0.0",
      description: "Built-in neutral signal source",
      minPlan: "free",
      defaultEnabled: true,
      capabilities: ["runner.signal_source"]
    },
    create() {
      return {
        key: "signal_source:none",
        async resolve() {
          return {
            sourceId: "none",
            metadata: {
              source: "none"
            }
          };
        }
      };
    }
  },
  {
    manifest: {
      id: SIGNAL_SOURCE_PLUGIN_ID_PREDICTION_STATE,
      kind: "signal_source",
      version: "1.0.0",
      description: "Built-in prediction state signal source",
      minPlan: "pro",
      defaultEnabled: true,
      capabilities: ["runner.signal_source", "prediction.state"]
    },
    create() {
      return {
        key: "signal_source:prediction_state",
        async resolve(ctx) {
          const params = ctx.bot.paramsJson;
          const row = params && typeof params === "object" && !Array.isArray(params)
            ? params as Record<string, unknown>
            : {};
          const nested = row.predictionCopier;
          const nestedRow = nested && typeof nested === "object" && !Array.isArray(nested)
            ? nested as Record<string, unknown>
            : row;
          const sourceStateId = typeof nestedRow.sourceStateId === "string"
            ? nestedRow.sourceStateId.trim()
            : "";

          return {
            sourceId: sourceStateId || "prediction_state",
            metadata: {
              source: "prediction_state",
              sourceStateId: sourceStateId || null,
              strategyKey: ctx.bot.strategyKey
            }
          };
        }
      };
    }
  }
];
