import { FuturesEngine, isGlobalTradingEnabled, type EngineRiskEvent } from "@mm/futures-engine";
import type { TradeIntent } from "@mm/futures-core";
import type { RiskEventType } from "../db.js";
import {
  getExecutionModeState,
  upsertExecutionModeState,
  writeRiskEvent
} from "../db.js";
import { applyExchangeExtensionsForIntent } from "../plugins/exchangeExtensions.js";
import {
  coerceGateSummary,
  defaultGateSummary
} from "../runtime/decisionTrace.js";
import { readExecutionSettings } from "./config.js";
import type { ExecutionMode, ExecutionResult } from "./types.js";
import {
  applyLimitOffsetPrice,
  withLegacyIntent
} from "./modeUtils.js";
import {
  applyCommonIntentSafety,
  applyExecutionSuccessToState,
  evaluateExecutionGuardrails,
  normalizeExecutionModeState
} from "./risk/guardrails.js";

type Dependencies = {
  engine?: FuturesEngine;
  writeRiskEventFn?: typeof writeRiskEvent;
  key?: string;
};

const noopExchange = {
  async getAccountState() {
    return { equity: 0 };
  },
  async getPositions() {
    return [];
  },
  async setLeverage() {
    return;
  },
  async placeOrder() {
    return { orderId: "noop" };
  },
  async cancelOrder() {
    return;
  }
};

function mapEngineEventToRiskType(event: EngineRiskEvent): RiskEventType {
  return event.type === "KILL_SWITCH_BLOCK" ? "KILL_SWITCH_BLOCK" : "BOT_ERROR";
}

function toIntentWithSimpleOverrides(intent: TradeIntent, settings: ReturnType<typeof readExecutionSettings>): TradeIntent {
  if (intent.type !== "open") return intent;

  const withOrderType: Extract<TradeIntent, { type: "open" }> = {
    ...intent,
    order: {
      ...(intent.order ?? {}),
      type: settings.simple.orderType
    }
  };

  if (settings.simple.orderType !== "limit") return withOrderType;

  return applyLimitOffsetPrice({
    intent: withOrderType,
    offsetBps: settings.simple.limitOffsetBps
  });
}

function toExecutionResultFromEngine(params: {
  engineResult: Awaited<ReturnType<FuturesEngine["execute"]>>;
  intent: TradeIntent;
  gate: ReturnType<typeof defaultGateSummary>;
  extensionPluginIds: string[];
  metadata?: Record<string, unknown>;
}): ExecutionResult {
  if (params.engineResult.status === "blocked") {
    return {
      status: "blocked",
      reason: params.engineResult.reason,
      metadata: {
        engineStatus: params.engineResult.status,
        engineReason: params.engineResult.reason,
        preserveReason: false,
        exchangeExtensionPluginIds: params.extensionPluginIds,
        ...params.metadata
      },
      legacy: {
        outcome: "blocked",
        intent: params.intent,
        gate: params.gate
      }
    };
  }

  if (params.engineResult.status === "noop") {
    return {
      status: "noop",
      reason: "noop",
      metadata: {
        engineStatus: params.engineResult.status,
        preserveReason: false,
        exchangeExtensionPluginIds: params.extensionPluginIds,
        ...params.metadata
      },
      legacy: {
        outcome: "ok",
        intent: params.intent,
        gate: params.gate
      }
    };
  }

  return {
    status: "executed",
    reason: "accepted",
    orderIds: params.engineResult.orderId ? [params.engineResult.orderId] : undefined,
    metadata: {
      engineStatus: params.engineResult.status,
      preserveReason: false,
      exchangeExtensionPluginIds: params.extensionPluginIds,
      ...params.metadata
    },
    legacy: {
      outcome: "ok",
      intent: params.intent,
      gate: params.gate
    }
  };
}

export function createSimpleExecutionMode(deps: Dependencies = {}): ExecutionMode {
  const engine = deps.engine ?? new FuturesEngine(noopExchange, {
    isTradingEnabled: () => isGlobalTradingEnabled()
  });
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;
  const key = deps.key ?? "simple";

  return {
    key,
    async execute(signal, ctx): Promise<ExecutionResult> {
      const settings = readExecutionSettings(ctx.bot);
      const gate = coerceGateSummary(signal.metadata.gate, defaultGateSummary());

      const extensionResult = await applyExchangeExtensionsForIntent({
        bot: ctx.bot,
        intent: signal.legacyIntent,
        now: ctx.now
      });

      for (const event of extensionResult.diagnostics) {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: event.type,
          message: event.message,
          meta: {
            extension: true,
            ...event.meta
          }
        });
      }

      let intentForEngine = toIntentWithSimpleOverrides(extensionResult.intent, settings);
      intentForEngine = applyCommonIntentSafety(intentForEngine, settings.common);

      const state = normalizeExecutionModeState(
        await getExecutionModeState(ctx.bot.id),
        ctx.now
      );

      const guard = evaluateExecutionGuardrails({
        intent: intentForEngine,
        common: settings.common,
        state,
        now: ctx.now
      });

      if (!guard.allow) {
        await writeRiskEventFn({
          botId: ctx.bot.id,
          type: "EXECUTION_GUARD_BLOCK",
          message: guard.reason,
          meta: {
            mode: settings.mode,
            executionModeKey: key,
            ...guard.meta
          }
        });

        return {
          status: "blocked",
          reason: guard.reason,
          metadata: {
            preserveReason: true,
            mode: settings.mode,
            guard: guard.meta,
            exchangeExtensionPluginIds: extensionResult.appliedPluginIds
          },
          legacy: {
            outcome: "blocked",
            intent: intentForEngine,
            gate
          }
        };
      }

      const engineResult = await engine.execute(intentForEngine, {
        botId: ctx.bot.id,
        emitRiskEvent: async (event) => {
          await writeRiskEventFn({
            botId: ctx.bot.id,
            type: mapEngineEventToRiskType(event),
            message: event.message,
            meta: {
              engineType: event.type,
              ...event.meta,
              timestamp: event.timestamp
            }
          });
        }
      });

      if (engineResult.status === "accepted" && intentForEngine.type !== "none") {
        const nextState = applyExecutionSuccessToState({
          intent: intentForEngine,
          common: settings.common,
          state: guard.state,
          now: ctx.now
        });
        await upsertExecutionModeState(ctx.bot.id, nextState);
      } else if (guard.state.updatedAt !== state.updatedAt) {
        await upsertExecutionModeState(ctx.bot.id, guard.state);
      }

      return toExecutionResultFromEngine({
        engineResult,
        intent: intentForEngine,
        gate,
        extensionPluginIds: extensionResult.appliedPluginIds,
        metadata: {
          mode: settings.mode,
          executionModeKey: key
        }
      });
    }
  };
}

export function runSimpleExecutionWithCustomIntent(params: {
  mode: ExecutionMode;
  signal: Parameters<ExecutionMode["execute"]>[0];
  intent: TradeIntent;
  ctx: Parameters<ExecutionMode["execute"]>[1];
}): Promise<ExecutionResult> {
  return params.mode.execute(withLegacyIntent(params.signal, params.intent), params.ctx);
}
