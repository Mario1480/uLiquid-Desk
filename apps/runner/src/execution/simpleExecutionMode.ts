import {
  FuturesEngine,
  buildSharedExecutionVenue,
  isGlobalTradingEnabled,
  type EngineRiskEvent
} from "@mm/futures-engine";
import type { TradeIntent } from "@mm/futures-core";
import type { FuturesExchange } from "@mm/futures-exchange";
import type { RiskEventType } from "../db.js";
import {
  getExecutionModeState,
  upsertExecutionModeState,
  writeRiskEvent
} from "../db.js";
import type { ActiveFuturesBot } from "../db.js";
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
  normalizeExecutionModeState,
  type ExecutionModeState,
  type ExecutionPendingOrderState
} from "./risk/guardrails.js";
import {
  getOrCreateRunnerFuturesAdapter
} from "./futuresVenueRuntime.js";

type Dependencies = {
  engine?: FuturesEngine;
  adapterFactory?: (bot: ActiveFuturesBot) => FuturesExchange | null;
  getExecutionModeStateFn?: typeof getExecutionModeState;
  upsertExecutionModeStateFn?: typeof upsertExecutionModeState;
  writeRiskEventFn?: typeof writeRiskEvent;
  key?: string;
};

const paperAcknowledgementExchange: FuturesExchange = {
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
    return {
      status: "confirmed" as const,
      submitted: true,
      confirmationSource: "venue_ack" as const,
      receiptStatus: "unknown" as const,
      orderId: "noop"
    };
  },
  async cancelOrder() {
    return {
      status: "confirmed" as const,
      submitted: true,
      confirmationSource: "venue_ack" as const,
      receiptStatus: "unknown" as const,
      orderId: "noop"
    };
  }
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLiveExecutionVenue(bot: ActiveFuturesBot): boolean {
  const exchange = normalizeText(bot.exchange).toLowerCase();
  return exchange.length > 0 && exchange !== "paper";
}

function isUnresolvedPendingOrder(order: ExecutionPendingOrderState): boolean {
  return order.status !== "failed_final";
}

function listUnresolvedPendingOrders(state: ExecutionModeState): ExecutionPendingOrderState[] {
  return Object.values(state.pendingOrders ?? {}).filter(isUnresolvedPendingOrder);
}

function cloneState(state: ExecutionModeState): ExecutionModeState {
  return {
    ...state,
    openPositionSymbols: [...state.openPositionSymbols],
    pendingOrders: { ...(state.pendingOrders ?? {}) },
    modes: {
      dca: { ...(state.modes.dca ?? {}) },
      grid: { ...(state.modes.grid ?? {}) },
      dipReversion: { ...(state.modes.dipReversion ?? {}) }
    }
  };
}

function buildBlockedExecutionResult(params: {
  signal: Parameters<ExecutionMode["execute"]>[0];
  intent: TradeIntent;
  reason: string;
  metadata?: Record<string, unknown>;
}): ExecutionResult {
  return {
    status: "blocked",
    reason: params.reason,
    metadata: {
      preserveReason: true,
      ...(params.metadata ?? {})
    },
    legacy: {
      outcome: "blocked",
      intent: params.intent,
      gate: coerceGateSummary(params.signal.metadata.gate, defaultGateSummary())
    }
  };
}

function buildNoopExecutionResult(params: {
  signal: Parameters<ExecutionMode["execute"]>[0];
  intent: TradeIntent;
  metadata?: Record<string, unknown>;
}): ExecutionResult {
  return {
    status: "noop",
    reason: "noop",
    metadata: {
      engineStatus: "noop",
      ...(params.metadata ?? {})
    },
    legacy: {
      outcome: "ok",
      intent: params.intent,
      gate: coerceGateSummary(params.signal.metadata.gate, defaultGateSummary())
    }
  };
}

function buildLiveAdapter(bot: ActiveFuturesBot): FuturesExchange | null {
  const identity = bot.executionIdentity;
  const exchange = normalizeText(identity?.exchange || bot.exchange).toLowerCase();
  return getOrCreateRunnerFuturesAdapter({
    cacheKey: identity?.cacheScope || `${bot.id}:${bot.exchangeAccountId}`,
    exchange,
    apiKey: identity?.apiKey || bot.credentials.apiKey,
    apiSecret: identity?.apiSecret || bot.credentials.apiSecret,
    passphrase: identity?.passphrase ?? bot.credentials.passphrase ?? undefined,
    botVaultAddress: null
  }) as FuturesExchange | null;
}

function createEngineForBot(params: {
  bot: ActiveFuturesBot;
  adapterFactory?: (bot: ActiveFuturesBot) => FuturesExchange | null;
}): { engine: FuturesEngine | null; adapter: FuturesExchange | null; adapterUnavailableReason: string | null } {
  if (!isLiveExecutionVenue(params.bot)) {
    const engine = new FuturesEngine(paperAcknowledgementExchange, {
      isTradingEnabled: () => isGlobalTradingEnabled()
    });
    return { engine, adapter: paperAcknowledgementExchange, adapterUnavailableReason: null };
  }

  const adapter = params.adapterFactory
    ? params.adapterFactory(params.bot)
    : buildLiveAdapter(params.bot);

  if (!adapter) {
    return {
      engine: null,
      adapter: null,
      adapterUnavailableReason: "execution_adapter_unavailable"
    };
  }

  return {
    engine: new FuturesEngine(adapter, {
      isTradingEnabled: () => isGlobalTradingEnabled()
    }),
    adapter,
    adapterUnavailableReason: null
  };
}

function intentSymbol(intent: TradeIntent, fallback: string): string {
  return "symbol" in intent ? intent.symbol : fallback;
}

function intentSide(intent: TradeIntent): "long" | "short" | null {
  return intent.type === "open" ? intent.side : null;
}

function nextClientOrderId(params: {
  botId: string;
  key: string;
  state: ExecutionModeState;
  intent: TradeIntent;
  fallbackSymbol: string;
}): { clientOrderId: string; nextState: ExecutionModeState; attemptSeq: number } {
  const existing = params.intent.type !== "none" ? normalizeText(params.intent.order?.clientOrderId) : "";
  if (existing) {
    return {
      clientOrderId: existing,
      nextState: params.state,
      attemptSeq: 1
    };
  }

  const seq = Math.max(1, Math.trunc(params.state.normalOrderSeq || 1));
  const symbol = normalizeSymbol(intentSymbol(params.intent, params.fallbackSymbol)) || "SYMBOL";
  const side = intentSide(params.intent) ?? "flat";
  const clientOrderId = `normal-${params.botId}-${params.key}-${symbol}-${params.intent.type}-${side}-${seq}`;
  return {
    clientOrderId,
    nextState: {
      ...params.state,
      normalOrderSeq: seq + 1
    },
    attemptSeq: seq
  };
}

function withClientOrderId(intent: TradeIntent, clientOrderId: string): TradeIntent {
  if (intent.type === "none") return intent;
  return {
    ...intent,
    order: {
      ...(intent.order ?? {}),
      clientOrderId
    }
  };
}

function buildPendingOrder(params: {
  intent: Extract<TradeIntent, { type: "open" | "close" }>;
  clientOrderId: string;
  attemptSeq: number;
  now: Date;
}): ExecutionPendingOrderState {
  const order = params.intent.order ?? {};
  return {
    clientOrderId: params.clientOrderId,
    exchangeOrderId: null,
    status: "submit_pending",
    intentType: params.intent.type,
    symbol: params.intent.symbol,
    side: params.intent.type === "open" ? params.intent.side : null,
    orderType: order.type === "limit" ? "limit" : "market",
    qty: toFiniteNumber(order.qty),
    price: toFiniteNumber(order.price),
    reduceOnly: order.reduceOnly === true || params.intent.type === "close",
    attemptSeq: params.attemptSeq,
    createdAt: params.now.toISOString(),
    updatedAt: params.now.toISOString(),
    lastCheckedAt: null,
    lastReason: null,
    recoveryHint: null
  };
}

function isPendingConfirmationReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("pending")
    || normalized.includes("timeout")
    || normalized.includes("unknown")
    || normalized.includes("confirmation");
}

function findMatchingPosition(params: {
  positions: Awaited<ReturnType<FuturesExchange["getPositions"]>>;
  symbol: string;
  side?: "long" | "short" | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  return params.positions.find((row) => {
    if (normalizeSymbol(row.symbol) !== symbol) return false;
    if (params.side && row.side !== params.side) return false;
    return Number(row.size ?? 0) > 0;
  }) ?? null;
}

async function reconcilePendingOrders(params: {
  adapter: FuturesExchange;
  state: ExecutionModeState;
  now: Date;
  common: ReturnType<typeof readExecutionSettings>["common"];
}): Promise<{ state: ExecutionModeState; resolvedCount: number; unresolved: ExecutionPendingOrderState[] }> {
  const state = cloneState(params.state);
  const positions = await params.adapter.getPositions();
  let resolvedCount = 0;

  for (const pending of listUnresolvedPendingOrders(state)) {
    const matchingSymbolPosition = findMatchingPosition({
      positions,
      symbol: pending.symbol,
      side: pending.intentType === "open" ? pending.side : null
    });
    const anySymbolPosition = findMatchingPosition({
      positions,
      symbol: pending.symbol
    });

    if (
      (pending.intentType === "open" && matchingSymbolPosition)
      || (pending.intentType === "close" && !anySymbolPosition)
    ) {
      const intent: Extract<TradeIntent, { type: "open" | "close" }> = pending.intentType === "open"
        ? {
            type: "open",
            symbol: pending.symbol,
            side: pending.side ?? "long",
            order: {
              type: pending.orderType,
              qty: pending.qty ?? undefined,
              price: pending.price ?? undefined,
              reduceOnly: pending.reduceOnly,
              clientOrderId: pending.clientOrderId
            }
          }
        : {
            type: "close",
            symbol: pending.symbol,
            order: {
              type: pending.orderType,
              qty: pending.qty ?? undefined,
              price: pending.price ?? undefined,
              reduceOnly: true,
              clientOrderId: pending.clientOrderId
            }
          };
      const withoutPending = {
        ...state,
        pendingOrders: {
          ...state.pendingOrders
        }
      };
      delete withoutPending.pendingOrders[pending.clientOrderId];
      const successState = applyExecutionSuccessToState({
        intent,
        common: params.common,
        state: withoutPending,
        now: params.now
      });
      Object.assign(state, successState);
      resolvedCount += 1;
      continue;
    }

    state.pendingOrders[pending.clientOrderId] = {
      ...pending,
      status: "pending_fill_confirmation",
      updatedAt: params.now.toISOString(),
      lastCheckedAt: params.now.toISOString(),
      lastReason: "pending_fill_confirmation",
      recoveryHint: "wait_for_venue_fill_or_manual_reconcile"
    };
  }

  state.lastReconciliationAt = params.now.toISOString();
  state.updatedAt = params.now.toISOString();
  return {
    state,
    resolvedCount,
    unresolved: listUnresolvedPendingOrders(state)
  };
}

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
  const writeRiskEventFn = deps.writeRiskEventFn ?? writeRiskEvent;
  const getExecutionModeStateFn = deps.getExecutionModeStateFn ?? getExecutionModeState;
  const upsertExecutionModeStateFn = deps.upsertExecutionModeStateFn ?? upsertExecutionModeState;
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

      let state = normalizeExecutionModeState(
        await getExecutionModeStateFn(ctx.bot.id),
        ctx.now
      );

      const unresolvedBefore = listUnresolvedPendingOrders(state);
      const engineResolution = deps.engine
        ? { engine: deps.engine, adapter: null as FuturesExchange | null, adapterUnavailableReason: null as string | null }
        : createEngineForBot({
            bot: ctx.bot,
            adapterFactory: deps.adapterFactory
          });

      if (unresolvedBefore.length > 0) {
        if (!engineResolution.adapter) {
          state = {
            ...state,
            lastBlockedReason: "pending_order_reconciliation",
            lastRecoveryHint: engineResolution.adapterUnavailableReason ?? "execution_adapter_unavailable",
            updatedAt: ctx.now.toISOString()
          };
          await upsertExecutionModeStateFn(ctx.bot.id, state);
          return buildBlockedExecutionResult({
            signal,
            intent: intentForEngine,
            reason: "pending_order_reconciliation",
            metadata: {
              mode: settings.mode,
              executionModeKey: key,
              pendingOrderCount: unresolvedBefore.length,
              recoveryHint: state.lastRecoveryHint
            }
          });
        }

        const reconciled = await reconcilePendingOrders({
          adapter: engineResolution.adapter,
          state,
          now: ctx.now,
          common: settings.common
        });
        state = reconciled.state;
        await upsertExecutionModeStateFn(ctx.bot.id, state);
        if (reconciled.unresolved.length > 0) {
          return buildBlockedExecutionResult({
            signal,
            intent: intentForEngine,
            reason: "pending_order_reconciliation",
            metadata: {
              mode: settings.mode,
              executionModeKey: key,
              pendingOrderCount: reconciled.unresolved.length,
              resolvedPendingOrderCount: reconciled.resolvedCount,
              recoveryHint: "wait_for_venue_fill_or_manual_reconcile"
            }
          });
        }
      }

      if (intentForEngine.type === "none") {
        return buildNoopExecutionResult({
          signal,
          intent: intentForEngine,
          metadata: {
            mode: settings.mode,
            executionModeKey: key
          }
        });
      }

      const guard = evaluateExecutionGuardrails({
        intent: intentForEngine,
        common: settings.common,
        state,
        now: ctx.now
      });

      let pendingClientOrderId: string | null = null;
      let pendingOrder: ExecutionPendingOrderState | null = null;
      if (guard.allow) {
        if (!engineResolution.engine) {
          const blockedState = {
            ...guard.state,
            lastBlockedReason: "execution_adapter_unavailable",
            lastRecoveryHint: engineResolution.adapterUnavailableReason ?? "execution_adapter_unavailable",
            updatedAt: ctx.now.toISOString()
          };
          await upsertExecutionModeStateFn(ctx.bot.id, blockedState);
          return buildBlockedExecutionResult({
            signal,
            intent: intentForEngine,
            reason: "execution_adapter_unavailable",
            metadata: {
              mode: settings.mode,
              executionModeKey: key,
              recoveryHint: blockedState.lastRecoveryHint
            }
          });
        }
      }

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
        guard: async (request) => {
          if (guard.allow) {
            const clientOrder = nextClientOrderId({
              botId: ctx.bot.id,
              key,
              state: guard.state,
              intent: intentForEngine,
              fallbackSymbol: ctx.bot.symbol
            });
            pendingClientOrderId = clientOrder.clientOrderId;
            intentForEngine = withClientOrderId(intentForEngine, pendingClientOrderId);
            request.intent = intentForEngine;
            pendingOrder = buildPendingOrder({
              intent: intentForEngine as Extract<TradeIntent, { type: "open" | "close" }>,
              clientOrderId: pendingClientOrderId,
              attemptSeq: clientOrder.attemptSeq,
              now: ctx.now
            });
            const stateWithPending = {
              ...clientOrder.nextState,
              pendingOrders: {
                ...(clientOrder.nextState.pendingOrders ?? {}),
                [pendingClientOrderId]: pendingOrder
              },
              updatedAt: ctx.now.toISOString()
            };
            await upsertExecutionModeStateFn(ctx.bot.id, stateWithPending);

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
        execute: async () => {
          return engineResolution.engine!.execute(intentForEngine, {
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
        },
        onResult: async (response) => {
          if (!pendingClientOrderId || !pendingOrder) return response;

          const latest = normalizeExecutionModeState(
            await getExecutionModeStateFn(ctx.bot.id),
            ctx.now
          );
          const currentPending = latest.pendingOrders[pendingClientOrderId] ?? pendingOrder;

          if (response.status !== "executed") {
            const keepPending = response.status === "failed" && isPendingConfirmationReason(response.reason);
            const nextState = cloneState(latest);
            if (keepPending) {
              nextState.pendingOrders[pendingClientOrderId] = {
                ...currentPending,
                status: "pending_fill_confirmation",
                exchangeOrderId: response.orderIds[0] ?? currentPending.exchangeOrderId ?? null,
                updatedAt: ctx.now.toISOString(),
                lastCheckedAt: ctx.now.toISOString(),
                lastReason: response.reason,
                recoveryHint: "wait_for_venue_confirmation"
              };
            } else {
              delete nextState.pendingOrders[pendingClientOrderId];
              nextState.lastBlockedReason = response.reason;
              nextState.lastRecoveryHint = response.status === "blocked"
                ? "fix_execution_guard_or_order_validation"
                : "retry_after_final_error_review";
            }
            nextState.updatedAt = ctx.now.toISOString();
            await upsertExecutionModeStateFn(ctx.bot.id, nextState);
            return response;
          }

          const submittedState = cloneState(latest);
          submittedState.pendingOrders[pendingClientOrderId] = {
            ...currentPending,
            status: "submitted",
            exchangeOrderId: response.orderIds[0] ?? currentPending.exchangeOrderId ?? null,
            updatedAt: ctx.now.toISOString(),
            lastCheckedAt: ctx.now.toISOString(),
            lastReason: "accepted",
            recoveryHint: "reconcile_fill_or_position"
          };
          await upsertExecutionModeStateFn(ctx.bot.id, submittedState);

          if (!engineResolution.adapter) {
            return response;
          }

          const reconciled = await reconcilePendingOrders({
            adapter: engineResolution.adapter,
            state: submittedState,
            now: ctx.now,
            common: settings.common
          });
          await upsertExecutionModeStateFn(ctx.bot.id, reconciled.state);
          const stillPending = Boolean(reconciled.state.pendingOrders[pendingClientOrderId]);
          if (!stillPending) {
            return {
              ...response,
              metadata: {
                ...response.metadata,
                fillConfirmed: true,
                pendingOrderResolved: true,
                clientOrderId: pendingClientOrderId
              }
            };
          }

          return {
            ...response,
            status: "blocked",
            reason: "pending_fill_confirmation",
            metadata: {
              ...response.metadata,
              preserveReason: true,
              orderAccepted: true,
              pendingOrder: true,
              pendingOrderCount: reconciled.unresolved.length,
              clientOrderId: pendingClientOrderId,
              recoveryHint: "wait_for_venue_fill_or_manual_reconcile"
            }
          };
        }
      });

      if (pendingClientOrderId && pendingOrder && executionResult.status === "error") {
        const latest = normalizeExecutionModeState(
          await getExecutionModeStateFn(ctx.bot.id),
          ctx.now
        );
        const currentPending = latest.pendingOrders[pendingClientOrderId] ?? pendingOrder;
        const nextState = cloneState(latest);
        if (isPendingConfirmationReason(executionResult.reason)) {
          nextState.pendingOrders[pendingClientOrderId] = {
            ...currentPending,
            status: "pending_fill_confirmation",
            updatedAt: ctx.now.toISOString(),
            lastCheckedAt: ctx.now.toISOString(),
            lastReason: executionResult.reason,
            recoveryHint: "wait_for_venue_confirmation"
          };
        } else {
          delete nextState.pendingOrders[pendingClientOrderId];
          nextState.lastBlockedReason = executionResult.reason;
          nextState.lastRecoveryHint = "retry_after_final_error_review";
        }
        nextState.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeStateFn(ctx.bot.id, nextState);
      }

      if (executionResult.status !== "executed" && guard.state.updatedAt !== state.updatedAt && !pendingClientOrderId) {
        await upsertExecutionModeStateFn(ctx.bot.id, guard.state);
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
