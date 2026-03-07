import type { TradeIntent } from "@mm/futures-core";
import {
  getExecutionModeState,
  upsertExecutionModeState
} from "../db.js";
import type { SignalDecision } from "../signal/types.js";
import type { ExecutionMode } from "./types.js";
import { readExecutionSettings } from "./config.js";
import {
  buildModeNoopResult,
  toOrderMarkPrice,
  withDesiredNotionalUsd,
  withTpSlFromPct
} from "./modeUtils.js";
import {
  createSimpleExecutionMode,
  runSimpleExecutionWithCustomIntent
} from "./simpleExecutionMode.js";
import { normalizeExecutionModeState } from "./risk/guardrails.js";

function toUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function computeDipTriggerReached(params: {
  side: "long" | "short";
  markPrice: number;
  referenceHigh: number | null;
  referenceLow: number | null;
  dipTriggerPct: number;
}): { reached: boolean; movePct: number } {
  const threshold = Math.max(0.000001, params.dipTriggerPct);
  if (params.side === "long") {
    const reference = params.referenceHigh && params.referenceHigh > 0 ? params.referenceHigh : params.markPrice;
    const movePct = ((reference - params.markPrice) / reference) * 100;
    return { reached: movePct >= threshold, movePct };
  }

  const reference = params.referenceLow && params.referenceLow > 0 ? params.referenceLow : params.markPrice;
  const movePct = ((params.markPrice - reference) / reference) * 100;
  return { reached: movePct >= threshold, movePct };
}

function buildForcedCloseSignal(signal: SignalDecision, symbol: string): SignalDecision {
  return {
    ...signal,
    legacyIntent: {
      type: "close",
      symbol,
      reason: "dip_reversion_max_hold_reached",
      order: {
        reduceOnly: true
      }
    },
    metadata: {
      ...signal.metadata,
      signalIntentType: "close"
    }
  };
}

type Dependencies = {
  simpleMode?: ExecutionMode;
};

export function createDipReversionExecutionMode(deps: Dependencies = {}): ExecutionMode {
  const simple = deps.simpleMode ?? createSimpleExecutionMode({ key: "simple_delegate_for_dip_reversion" });

  return {
    key: "dip_reversion",
    async execute(signal, ctx) {
      const settings = readExecutionSettings(ctx.bot);
      const intent = signal.legacyIntent;

      if (ctx.bot.strategyKey === "prediction_copier") {
        return simple.execute(signal, ctx);
      }

      const state = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);
      const dipModes = { ...(state.modes.dipReversion ?? {}) };
      const symbol = intent.type === "none" ? ctx.bot.symbol : intent.symbol;
      const bucket = dipModes[symbol] ?? {
        referenceHigh: null,
        referenceLow: null,
        entriesTodayDate: toUtcDate(ctx.now),
        entriesTodayCount: 0,
        openSince: null,
        side: null
      };

      const markPrice = intent.type === "open"
        ? toOrderMarkPrice(intent)
        : null;

      if (markPrice && markPrice > 0) {
        bucket.referenceHigh = bucket.referenceHigh === null
          ? markPrice
          : Math.max(bucket.referenceHigh, markPrice);
        bucket.referenceLow = bucket.referenceLow === null
          ? markPrice
          : Math.min(bucket.referenceLow, markPrice);
      }

      const today = toUtcDate(ctx.now);
      if (bucket.entriesTodayDate !== today) {
        bucket.entriesTodayDate = today;
        bucket.entriesTodayCount = 0;
      }

      if (intent.type === "none") {
        if (bucket.openSince && bucket.side) {
          const openedAt = new Date(bucket.openSince).getTime();
          const maxHoldMs = settings.dipReversion.maxHoldMinutes * 60_000;
          if (Number.isFinite(openedAt) && openedAt > 0 && (ctx.now.getTime() - openedAt) >= maxHoldMs) {
            const delegated = await simple.execute(buildForcedCloseSignal(signal, symbol), ctx);
            if (delegated.status === "executed") {
              bucket.openSince = null;
              bucket.side = null;
              dipModes[symbol] = bucket;
              state.modes.dipReversion = dipModes;
              state.updatedAt = ctx.now.toISOString();
              await upsertExecutionModeState(ctx.bot.id, state);
            }
            return {
              ...delegated,
              metadata: {
                ...delegated.metadata,
                mode: settings.mode,
                modeStage: "dip_reversion_forced_close"
              }
            };
          }
        }

        dipModes[symbol] = bucket;
        state.modes.dipReversion = dipModes;
        state.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeState(ctx.bot.id, state);
        return simple.execute(signal, ctx);
      }

      if (intent.type === "close") {
        const delegated = await runSimpleExecutionWithCustomIntent({
          mode: simple,
          signal,
          intent,
          ctx
        });
        if (delegated.status === "executed") {
          bucket.openSince = null;
          bucket.side = null;
          dipModes[symbol] = bucket;
          state.modes.dipReversion = dipModes;
          state.updatedAt = ctx.now.toISOString();
          await upsertExecutionModeState(ctx.bot.id, state);
        }
        return {
          ...delegated,
          metadata: {
            ...delegated.metadata,
            mode: settings.mode,
            modeStage: "dip_reversion_close"
          }
        };
      }

      if (!markPrice) {
        return buildModeNoopResult(signal, "dip_reversion_missing_mark_price", {
          mode: settings.mode
        });
      }

      const trigger = computeDipTriggerReached({
        side: intent.side,
        markPrice,
        referenceHigh: bucket.referenceHigh,
        referenceLow: bucket.referenceLow,
        dipTriggerPct: settings.dipReversion.dipTriggerPct
      });

      if (!trigger.reached) {
        dipModes[symbol] = bucket;
        state.modes.dipReversion = dipModes;
        state.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeState(ctx.bot.id, state);
        return buildModeNoopResult(signal, "dip_reversion_trigger_not_reached", {
          mode: settings.mode,
          movePct: trigger.movePct,
          dipTriggerPct: settings.dipReversion.dipTriggerPct
        });
      }

      if (bucket.entriesTodayCount >= settings.dipReversion.maxReentriesPerDay) {
        return buildModeNoopResult(signal, "dip_reversion_reentry_limit_reached", {
          mode: settings.mode,
          entriesTodayCount: bucket.entriesTodayCount,
          maxReentriesPerDay: settings.dipReversion.maxReentriesPerDay
        });
      }

      let nextIntent = withDesiredNotionalUsd(intent, settings.dipReversion.entryScaleUsd);
      nextIntent = withTpSlFromPct({
        intent: nextIntent,
        markPrice,
        takeProfitPct: settings.dipReversion.recoveryTakeProfitPct,
        stopLossPct: null
      });

      const delegated = await runSimpleExecutionWithCustomIntent({
        mode: simple,
        signal,
        intent: nextIntent,
        ctx
      });

      if (delegated.status === "executed") {
        bucket.entriesTodayDate = today;
        bucket.entriesTodayCount += 1;
        bucket.openSince = ctx.now.toISOString();
        bucket.side = intent.side;
        dipModes[symbol] = bucket;
        state.modes.dipReversion = dipModes;
        state.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeState(ctx.bot.id, state);
      }

      return {
        ...delegated,
        metadata: {
          ...delegated.metadata,
          mode: settings.mode,
          modeStage: "dip_reversion_open",
          dipMovePct: trigger.movePct
        }
      };
    }
  };
}
