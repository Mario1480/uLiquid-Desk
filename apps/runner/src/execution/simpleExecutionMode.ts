import {
  FuturesEngine,
  buildSharedExecutionVenue,
  isGlobalTradingEnabled,
  type EngineRiskEvent
} from "@mm/futures-engine";
import type { TradeIntent } from "@mm/futures-core";
import type { RiskEventType } from "../db.js";
import {
  getExecutionModeState,
  upsertExecutionModeState,
  writeRiskEvent
} from "../db.js";
import { applyExchangeExtensionsForIntent } from "../plugins/exchangeExtensions.js";
import {
  buildRunnerPaperExecutionContext,
} from "../runtime/paperExecution.js";
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
import { executeRunnerSharedExecutionPipeline } from "./sharedExecution.js";
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

      const venue = buildSharedExecutionVenue({
        executionVenue: ctx.bot.exchange,
        marketDataVenue: ctx.bot.marketData.exchange,
        paperContext: ctx.bot.exchange === "paper"
          ? buildRunnerPaperExecutionContext({
              marketType: "perp",
              marketDataExchange: ctx.bot.marketData.exchange,
              marketDataExchangeAccountId: ctx.bot.marketData.exchangeAccountId
            })
          : null
      });

      const executionResult = await executeRunnerSharedExecutionPipeline({
        request: {
          domain: key,
          action: intentForEngine.type === "close" ? "close_position" : "place_order",
          symbol: "symbol" in intentForEngine ? intentForEngine.symbol : ctx.bot.symbol,
          intent: intentForEngine,
          venue,
          metadata: {
            mode: settings.mode,
            executionModeKey: key,
            exchangeExtensionPluginIds: extensionResult.appliedPluginIds,
            preserveReason: false
          }
        },
        intent: intentForEngine,
        gate,
        guard: async () => {
          if (guard.allow) {
            return {
              allow: true,
              metadata: {
                guard: guard.meta
              }
            };
          }

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
            allow: false,
            reason: guard.reason,
            status: "blocked",
            metadata: {
              guard: guard.meta,
              preserveReason: true
            }
          };
        },
        execute: async () => engine.execute(intentForEngine, {
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
        })
      });

      if (executionResult.status === "executed" && intentForEngine.type !== "none") {
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

      return executionResult;
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
