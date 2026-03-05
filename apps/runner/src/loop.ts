import type { TradeIntent } from "@mm/futures-core";
import type { ActiveFuturesBot } from "./db.js";
import {
  markExchangeAccountUsed,
  writeBotTick,
  writeRiskEvent,
  type RiskEventType
} from "./db.js";
import type { ExecutionMode, ExecutionResult } from "./execution/types.js";
import { log } from "./logger.js";
import {
  coerceGateSummary,
  defaultGateSummary,
  type RunnerDecisionTrace
} from "./runtime/decisionTrace.js";
import { runPluginHookWithFallback } from "./plugins/isolation.js";
import { resolveRunnerPluginsForBot } from "./plugins/resolution.js";
import type { SignalSourceResolution } from "./plugins/signalSource.js";
import type { SignalDecision, SignalEngine } from "./signal/types.js";

export type LoopTickResult = {
  outcome: "ok" | "blocked";
  intent: TradeIntent;
  reason: string;
  signalReason: string;
  executionReason: string;
  trace: RunnerDecisionTrace;
  gate: {
    applied: boolean;
    allow: boolean;
    reason: string;
    sizeMultiplier: number;
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  };
};

export type LoopDependencies = {
  resolveSignalEngine?: (bot: ActiveFuturesBot) => SignalEngine;
  resolveExecutionMode?: (bot: ActiveFuturesBot) => ExecutionMode;
  writeBotTickFn?: typeof writeBotTick;
  writeRiskEventFn?: typeof writeRiskEvent;
  markExchangeAccountUsedFn?: typeof markExchangeAccountUsed;
};

function toEngineLikeReason(strategyKey: string, intent: TradeIntent, result: ExecutionResult): string {
  if (result.metadata.preserveReason === true) {
    return result.reason;
  }

  if (result.status === "blocked") {
    return `blocked:${result.reason};strategy:${strategyKey};intent:${intent.type}`;
  }

  const engineStatusRaw = String(result.metadata.engineStatus ?? "").trim();
  const engineStatus = engineStatusRaw || (result.status === "executed" ? "accepted" : "noop");
  return `strategy:${strategyKey};intent:${intent.type};engine:${engineStatus}`;
}

function blockedBySignalDecision(signal: SignalDecision): boolean {
  return signal.metadata.blockedBySignal === true;
}

function getSignalIntentType(signal: SignalDecision): TradeIntent["type"] {
  const raw = String(signal.metadata.signalIntentType ?? "").trim().toLowerCase();
  if (raw === "open" || raw === "close" || raw === "none") {
    return raw;
  }
  return signal.legacyIntent.type;
}

function createSignalBlockedReason(bot: ActiveFuturesBot, signal: SignalDecision): string {
  return `gated:${signal.reason};strategy:${bot.strategyKey};intent:${getSignalIntentType(signal)}`;
}

function withSignalSourceMetadata(signal: SignalDecision, params: {
  signalSourcePluginId: string;
  signalSourceProviderKey: string;
  signalSource: SignalSourceResolution;
}): SignalDecision {
  return {
    ...signal,
    metadata: {
      ...signal.metadata,
      signalSourcePluginId: params.signalSourcePluginId,
      signalSourceProviderKey: params.signalSourceProviderKey,
      signalSource: {
        sourceId: params.signalSource.sourceId,
        metadata: params.signalSource.metadata,
        blocked: params.signalSource.blocked ?? null
      }
    }
  };
}

export function resolveSignalEngineForBot(bot: ActiveFuturesBot): SignalEngine {
  const resolved = resolveRunnerPluginsForBot(bot);
  return resolved.signal.plugin.create();
}

export function resolveExecutionModeForBot(bot: ActiveFuturesBot): ExecutionMode {
  const resolved = resolveRunnerPluginsForBot(bot);
  return resolved.execution.plugin.create();
}

export async function loopOnce(
  bot: ActiveFuturesBot,
  workerId?: string,
  deps: LoopDependencies = {}
): Promise<LoopTickResult> {
  const writeBotTickFn = deps.writeBotTickFn ?? writeBotTick;
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;
  const markExchangeAccountUsedFn = deps.markExchangeAccountUsedFn ?? markExchangeAccountUsed;

  const pluginModeActive = !deps.resolveSignalEngine && !deps.resolveExecutionMode;
  const pluginSelection = pluginModeActive ? resolveRunnerPluginsForBot(bot) : null;

  const signalEngine = deps.resolveSignalEngine
    ? deps.resolveSignalEngine(bot)
    : (pluginSelection?.signal.plugin.create() ?? resolveSignalEngineForBot(bot));

  const signalFallbackEngine = pluginSelection?.signal.fallbackPlugin.create() ?? signalEngine;

  const executionMode = deps.resolveExecutionMode
    ? deps.resolveExecutionMode(bot)
    : (pluginSelection?.execution.plugin.create() ?? resolveExecutionModeForBot(bot));

  const executionFallbackMode = pluginSelection?.execution.fallbackPlugin.create() ?? executionMode;
  const signalSourceProvider = pluginSelection?.signalSource.plugin.create();
  const signalSourceFallbackProvider = pluginSelection?.signalSource.fallbackPlugin.create() ?? signalSourceProvider ?? null;

  const selectedSignalPluginId = pluginSelection?.signal.selectedPluginId ?? "legacy.signal.custom";
  const fallbackSignalPluginId = pluginSelection?.signal.fallbackPluginId ?? selectedSignalPluginId;
  const selectedExecutionPluginId = pluginSelection?.execution.selectedPluginId ?? "legacy.execution.custom";
  const fallbackExecutionPluginId = pluginSelection?.execution.fallbackPluginId ?? selectedExecutionPluginId;
  const selectedSignalSourcePluginId = pluginSelection?.signalSource.selectedPluginId ?? "legacy.signal_source.custom";
  const fallbackSignalSourcePluginId = pluginSelection?.signalSource.fallbackPluginId ?? selectedSignalSourcePluginId;

  const now = new Date();

  const emitRiskEvent = async (params: {
    type: RiskEventType;
    message: string;
    meta: Record<string, unknown>;
  }) => {
    try {
      await writeRiskEventFn({
        botId: bot.id,
        type: params.type,
        message: params.message,
        meta: {
          workerId: workerId ?? null,
          strategyKey: bot.strategyKey,
          ...params.meta
        }
      });
    } catch (error) {
      log.warn(
        {
          botId: bot.id,
          strategyKey: bot.strategyKey,
          eventType: params.type,
          err: String(error)
        },
        "decision risk event write failed"
      );
    }
  };

  if (pluginSelection) {
    for (const diag of pluginSelection.diagnostics) {
      await emitRiskEvent({
        type: diag.type,
        message: diag.message,
        meta: diag.meta
      });
    }
  }

  const signalSourceHook = pluginModeActive && signalSourceProvider && signalSourceFallbackProvider
    ? await runPluginHookWithFallback({
      pluginId: selectedSignalSourcePluginId,
      fallbackPluginId: fallbackSignalSourcePluginId,
      run: () => signalSourceProvider.resolve({ bot, now, workerId }),
      runFallback: () => signalSourceFallbackProvider.resolve({ bot, now, workerId }),
      onRuntimeError: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_RUNTIME_ERROR",
          message: event.error,
          meta: {
            stage: `signal_source_${event.stage}`,
            pluginId: event.pluginId,
            timedOut: event.timedOut,
            health: event.health
          }
        });
      },
      onFallbackUsed: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_FALLBACK_USED",
          message: event.reason,
          meta: {
            pluginId: event.pluginId,
            fallbackPluginId: event.fallbackPluginId,
            component: "signal_source"
          }
        });
      }
    })
    : {
      value: {
        sourceId: "none",
        metadata: {
          source: "none"
        }
      } as SignalSourceResolution,
      pluginIdUsed: selectedSignalSourcePluginId,
      fallbackUsed: false,
      reason: null
    };

  const signalSourceResolution = signalSourceHook.value;
  const signalSourcePluginIdUsed = signalSourceHook.pluginIdUsed;
  const signalSourceProviderKey = signalSourcePluginIdUsed === fallbackSignalSourcePluginId
    ? (signalSourceFallbackProvider?.key ?? "signal_source:none")
    : (signalSourceProvider?.key ?? "signal_source:none");

  if (signalSourceResolution.blocked?.reason) {
    const blockedDecision: SignalDecision = withSignalSourceMetadata({
      side: "flat",
      confidence: null,
      reason: signalSourceResolution.blocked.reason,
      metadata: {
        blockedBySignal: true,
        signalIntentType: "none",
        sourceBlocked: true,
        strategyKey: bot.strategyKey,
        gate: defaultGateSummary()
      },
      legacyIntent: { type: "none" }
    }, {
      signalSourcePluginId: signalSourcePluginIdUsed,
      signalSourceProviderKey,
      signalSource: signalSourceResolution
    });

    const reason = createSignalBlockedReason(bot, blockedDecision);
    const trace: RunnerDecisionTrace = {
      signal: {
        engine: "signal_source:block",
        side: blockedDecision.side,
        confidence: blockedDecision.confidence,
        reason: blockedDecision.reason,
        metadata: blockedDecision.metadata
      },
      execution: {
        mode: executionMode.key,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        metadata: {
          blockedBySignal: true,
          signalSourceBlocked: true
        }
      }
    };

    await emitRiskEvent({
      type: "SIGNAL_DECISION",
      message: blockedDecision.reason,
      meta: {
        signalEngine: "signal_source:block",
        signalPluginId: selectedSignalPluginId,
        signalSourcePluginId: signalSourcePluginIdUsed,
        selectedSignalSourcePluginId,
        fallbackSignalSourcePluginId,
        side: blockedDecision.side,
        confidence: blockedDecision.confidence,
        signalIntentType: getSignalIntentType(blockedDecision),
        blockedBySignal: true,
        signalGate: defaultGateSummary(),
        signalMetadata: blockedDecision.metadata
      }
    });

    await emitRiskEvent({
      type: "EXECUTION_DECISION",
      message: "skipped_due_to_signal_block",
      meta: {
        executionMode: executionMode.key,
        executionPluginId: selectedExecutionPluginId,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        executionMetadata: {
          blockedBySignal: true,
          signalSourceBlocked: true
        }
      }
    });

    await writeBotTickFn({
      botId: bot.id,
      status: "running",
      reason,
      intent: blockedDecision.legacyIntent,
      workerId: workerId ?? null,
      trace
    });
    await markExchangeAccountUsedFn(bot.exchangeAccountId);

    return {
      outcome: "blocked",
      intent: blockedDecision.legacyIntent,
      reason,
      signalReason: blockedDecision.reason,
      executionReason: "skipped_due_to_signal_block",
      trace,
      gate: defaultGateSummary()
    };
  }

  const signalHook = pluginModeActive
    ? await runPluginHookWithFallback({
      pluginId: selectedSignalPluginId,
      fallbackPluginId: fallbackSignalPluginId,
      run: () => signalEngine.decide({ bot, now, workerId }),
      runFallback: () => signalFallbackEngine.decide({ bot, now, workerId }),
      onRuntimeError: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_RUNTIME_ERROR",
          message: event.error,
          meta: {
            stage: event.stage,
            pluginId: event.pluginId,
            timedOut: event.timedOut,
            health: event.health
          }
        });
      },
      onFallbackUsed: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_FALLBACK_USED",
          message: event.reason,
          meta: {
            pluginId: event.pluginId,
            fallbackPluginId: event.fallbackPluginId
          }
        });
      }
    })
    : {
      value: await signalEngine.decide({ bot, now, workerId }),
      pluginIdUsed: selectedSignalPluginId,
      fallbackUsed: false,
      reason: null
    };

  const signalDecision = signalHook.value;
  const signalDecisionWithSource = withSignalSourceMetadata(signalDecision, {
    signalSourcePluginId: signalSourcePluginIdUsed,
    signalSourceProviderKey,
    signalSource: signalSourceResolution
  });

  const signalPluginIdUsed = signalHook.pluginIdUsed;
  const signalEngineUsedKey = signalPluginIdUsed === fallbackSignalPluginId
    ? signalFallbackEngine.key
    : signalEngine.key;

  const signalGate = coerceGateSummary(signalDecisionWithSource.metadata.gate, defaultGateSummary());

  await emitRiskEvent({
    type: "SIGNAL_DECISION",
    message: signalDecisionWithSource.reason,
    meta: {
      signalEngine: signalEngineUsedKey,
      signalPluginId: signalPluginIdUsed,
      signalSourcePluginId: signalSourcePluginIdUsed,
      selectedSignalSourcePluginId,
      fallbackSignalSourcePluginId,
      selectedSignalPluginId,
      fallbackSignalPluginId,
      side: signalDecisionWithSource.side,
      confidence: signalDecisionWithSource.confidence,
      signalIntentType: getSignalIntentType(signalDecisionWithSource),
      blockedBySignal: blockedBySignalDecision(signalDecisionWithSource),
      signalGate,
      signalMetadata: signalDecisionWithSource.metadata
    }
  });

  if (blockedBySignalDecision(signalDecisionWithSource)) {
    const reason = createSignalBlockedReason(bot, signalDecisionWithSource);
    const trace: RunnerDecisionTrace = {
      signal: {
        engine: signalEngineUsedKey,
        side: signalDecisionWithSource.side,
        confidence: signalDecisionWithSource.confidence,
        reason: signalDecisionWithSource.reason,
        metadata: signalDecisionWithSource.metadata
      },
      execution: {
        mode: executionMode.key,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        metadata: {
          blockedBySignal: true,
          selectedExecutionPluginId,
          fallbackExecutionPluginId
        }
      }
    };

    await emitRiskEvent({
      type: "EXECUTION_DECISION",
      message: "skipped_due_to_signal_block",
      meta: {
        executionMode: executionMode.key,
        executionPluginId: selectedExecutionPluginId,
        status: "blocked",
        reason: "skipped_due_to_signal_block",
        executionMetadata: {
          blockedBySignal: true
        }
      }
    });

    await writeBotTickFn({
      botId: bot.id,
      status: "running",
      reason,
      intent: signalDecisionWithSource.legacyIntent,
      workerId: workerId ?? null,
      trace
    });
    await markExchangeAccountUsedFn(bot.exchangeAccountId);

    return {
      outcome: "blocked",
      intent: signalDecisionWithSource.legacyIntent,
      reason,
      signalReason: signalDecisionWithSource.reason,
      executionReason: "skipped_due_to_signal_block",
      trace,
      gate: signalGate
    };
  }

  const executionHook = pluginModeActive
    ? await runPluginHookWithFallback({
      pluginId: selectedExecutionPluginId,
      fallbackPluginId: fallbackExecutionPluginId,
      run: () => executionMode.execute(signalDecisionWithSource, { bot, now, workerId }),
      runFallback: () => executionFallbackMode.execute(signalDecisionWithSource, { bot, now, workerId }),
      onRuntimeError: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_RUNTIME_ERROR",
          message: event.error,
          meta: {
            stage: event.stage,
            pluginId: event.pluginId,
            timedOut: event.timedOut,
            health: event.health
          }
        });
      },
      onFallbackUsed: async (event) => {
        await emitRiskEvent({
          type: "PLUGIN_FALLBACK_USED",
          message: event.reason,
          meta: {
            pluginId: event.pluginId,
            fallbackPluginId: event.fallbackPluginId
          }
        });
      }
    })
    : {
      value: await executionMode.execute(signalDecisionWithSource, { bot, now, workerId }),
      pluginIdUsed: selectedExecutionPluginId,
      fallbackUsed: false,
      reason: null
    };

  const executionResult = executionHook.value;
  const executionPluginIdUsed = executionHook.pluginIdUsed;
  const executionModeUsedKey = executionPluginIdUsed === fallbackExecutionPluginId
    ? executionFallbackMode.key
    : executionMode.key;

  const reason = toEngineLikeReason(bot.strategyKey, executionResult.legacy.intent, executionResult);
  const trace: RunnerDecisionTrace = {
    signal: {
      engine: signalEngineUsedKey,
      side: signalDecisionWithSource.side,
      confidence: signalDecisionWithSource.confidence,
      reason: signalDecisionWithSource.reason,
      metadata: signalDecisionWithSource.metadata
    },
    execution: {
      mode: executionModeUsedKey,
      status: executionResult.status,
      reason: executionResult.reason,
      metadata: {
        ...executionResult.metadata,
        executionPluginId: executionPluginIdUsed,
        selectedExecutionPluginId,
        fallbackExecutionPluginId
      }
    }
  };

  await emitRiskEvent({
    type: "EXECUTION_DECISION",
    message: executionResult.reason,
    meta: {
      executionMode: executionModeUsedKey,
      executionPluginId: executionPluginIdUsed,
      selectedExecutionPluginId,
      fallbackExecutionPluginId,
      status: executionResult.status,
      reason: executionResult.reason,
      executionMetadata: executionResult.metadata
    }
  });

  await writeBotTickFn({
    botId: bot.id,
    status: "running",
    reason,
    intent: executionResult.legacy.intent,
    workerId: workerId ?? null,
    trace
  });

  await markExchangeAccountUsedFn(bot.exchangeAccountId);

  return {
    outcome: executionResult.legacy.outcome,
    intent: executionResult.legacy.intent,
    reason,
    signalReason: signalDecisionWithSource.reason,
    executionReason: executionResult.reason,
    trace,
    gate: executionResult.legacy.gate
  };
}
