import type { TradeIntent } from "@mm/futures-core";
import {
  getExecutionModeState,
  upsertExecutionModeState
} from "../db.js";
import type { ExecutionMode } from "./types.js";
import { readExecutionSettings } from "./config.js";
import {
  buildModeNoopResult,
  estimateAdverseMoveReached,
  scaleOpenIntent,
  toOrderMarkPrice,
  withTpSlFromPct
} from "./modeUtils.js";
import {
  createSimpleExecutionMode,
  runSimpleExecutionWithCustomIntent
} from "./simpleExecutionMode.js";
import { normalizeExecutionModeState } from "./risk/guardrails.js";

function applyDcaOrderType(intent: Extract<TradeIntent, { type: "open" }>, orderType: "market" | "limit") {
  return {
    ...intent,
    order: {
      ...(intent.order ?? {}),
      type: orderType
    }
  };
}

function getDcaBucket(state: ReturnType<typeof normalizeExecutionModeState>, symbol: string) {
  const modes = state.modes.dca ?? {};
  return modes[symbol] ?? null;
}

export function createDcaExecutionMode(): ExecutionMode {
  const simple = createSimpleExecutionMode({ key: "simple_delegate_for_dca" });

  return {
    key: "dca",
    async execute(signal, ctx) {
      const settings = readExecutionSettings(ctx.bot);
      const intent = signal.legacyIntent;

      if (ctx.bot.strategyKey === "prediction_copier") {
        return simple.execute(signal, ctx);
      }

      if (intent.type === "none") {
        return simple.execute(signal, ctx);
      }

      const state = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);

      if (intent.type === "close") {
        const delegated = await runSimpleExecutionWithCustomIntent({
          mode: simple,
          signal,
          intent,
          ctx
        });

        if (delegated.status === "executed") {
          const next = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);
          const dcaModes = { ...(next.modes.dca ?? {}) };
          delete dcaModes[intent.symbol];
          next.modes.dca = dcaModes;
          next.updatedAt = ctx.now.toISOString();
          await upsertExecutionModeState(ctx.bot.id, next);
        }

        return {
          ...delegated,
          metadata: {
            ...delegated.metadata,
            mode: settings.mode,
            modeStage: "dca_close"
          }
        };
      }

      const dcaState = getDcaBucket(state, intent.symbol);
      const markPrice = toOrderMarkPrice(intent);
      const entryCount = dcaState && dcaState.side === intent.side
        ? dcaState.entryCount
        : 0;

      if (entryCount >= settings.dca.maxEntries) {
        return buildModeNoopResult(signal, "dca_max_entries_reached", {
          mode: settings.mode,
          maxEntries: settings.dca.maxEntries,
          entryCount
        });
      }

      if (entryCount > 0) {
        if (!markPrice || !dcaState?.lastEntryPrice) {
          return buildModeNoopResult(signal, "dca_waiting_mark_price", {
            mode: settings.mode,
            entryCount
          });
        }

        const adverse = estimateAdverseMoveReached({
          side: intent.side,
          referencePrice: dcaState.lastEntryPrice,
          markPrice,
          stepPct: settings.dca.stepPct
        });

        if (!adverse) {
          return buildModeNoopResult(signal, "dca_step_not_reached", {
            mode: settings.mode,
            entryCount,
            stepPct: settings.dca.stepPct,
            lastEntryPrice: dcaState.lastEntryPrice,
            markPrice
          });
        }
      }

      let nextIntent = scaleOpenIntent(intent, Math.pow(settings.dca.sizeScale, entryCount));
      nextIntent = applyDcaOrderType(nextIntent, settings.dca.entryOrderType);
      nextIntent = withTpSlFromPct({
        intent: nextIntent,
        markPrice,
        takeProfitPct: settings.dca.takeProfitPct,
        stopLossPct: settings.dca.stopLossPct
      });

      const delegated = await runSimpleExecutionWithCustomIntent({
        mode: simple,
        signal,
        intent: nextIntent,
        ctx
      });

      if (delegated.status === "executed") {
        const latest = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);
        const modes = { ...(latest.modes.dca ?? {}) };
        modes[intent.symbol] = {
          side: intent.side,
          entryCount: entryCount + 1,
          lastEntryPrice: markPrice,
          lastEntryAt: ctx.now.toISOString()
        };
        latest.modes.dca = modes;
        latest.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeState(ctx.bot.id, latest);
      }

      return {
        ...delegated,
        metadata: {
          ...delegated.metadata,
          mode: settings.mode,
          modeStage: "dca_open",
          dcaEntryCountBefore: entryCount
        }
      };
    }
  };
}
