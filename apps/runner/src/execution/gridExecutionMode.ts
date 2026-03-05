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
  toOrderMarkPrice,
  withDesiredNotionalUsd,
  withTpSlFromPct
} from "./modeUtils.js";
import {
  createSimpleExecutionMode,
  runSimpleExecutionWithCustomIntent
} from "./simpleExecutionMode.js";
import { normalizeExecutionModeState } from "./risk/guardrails.js";

function getGridBucket(state: ReturnType<typeof normalizeExecutionModeState>, symbol: string) {
  return (state.modes.grid ?? {})[symbol] ?? null;
}

function applyGridOrderType(intent: Extract<TradeIntent, { type: "open" }>): Extract<TradeIntent, { type: "open" }> {
  return {
    ...intent,
    order: {
      ...(intent.order ?? {}),
      type: "limit"
    }
  };
}

export function createGridExecutionMode(): ExecutionMode {
  const simple = createSimpleExecutionMode({ key: "simple_delegate_for_grid" });

  return {
    key: "grid",
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
          const latest = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);
          const gridModes = { ...(latest.modes.grid ?? {}) };
          delete gridModes[intent.symbol];
          latest.modes.grid = gridModes;
          latest.updatedAt = ctx.now.toISOString();
          await upsertExecutionModeState(ctx.bot.id, latest);
        }
        return {
          ...delegated,
          metadata: {
            ...delegated.metadata,
            mode: settings.mode,
            modeStage: "grid_close"
          }
        };
      }

      const markPrice = toOrderMarkPrice(intent);
      if (!markPrice) {
        return buildModeNoopResult(signal, "grid_missing_mark_price", {
          mode: settings.mode
        });
      }

      const current = getGridBucket(state, intent.symbol);
      const sideChanged = current && current.side !== intent.side;
      const activeLevels = sideChanged || !current ? 0 : current.filledLevels;

      if (activeLevels >= settings.grid.levelsPerSide) {
        return buildModeNoopResult(signal, "grid_levels_per_side_reached", {
          mode: settings.mode,
          activeLevels,
          levelsPerSide: settings.grid.levelsPerSide
        });
      }

      const activeOrders = sideChanged || !current ? 0 : current.activeOrders;
      if (activeOrders >= settings.grid.maxActiveOrders) {
        return buildModeNoopResult(signal, "grid_max_active_orders_reached", {
          mode: settings.mode,
          activeOrders,
          maxActiveOrders: settings.grid.maxActiveOrders
        });
      }

      if (current && !sideChanged && current.lastEntryPrice && activeLevels > 0) {
        const stepReached = estimateAdverseMoveReached({
          side: intent.side,
          referencePrice: current.lastEntryPrice,
          markPrice,
          stepPct: settings.grid.gridSpacingPct
        });
        if (!stepReached) {
          return buildModeNoopResult(signal, "grid_spacing_not_reached", {
            mode: settings.mode,
            gridSpacingPct: settings.grid.gridSpacingPct,
            lastEntryPrice: current.lastEntryPrice,
            markPrice
          });
        }
      }

      let nextIntent = withDesiredNotionalUsd(intent, settings.grid.baseOrderUsd);
      nextIntent = applyGridOrderType(nextIntent);
      nextIntent = withTpSlFromPct({
        intent: nextIntent,
        markPrice,
        takeProfitPct: settings.grid.tpPctPerLevel,
        stopLossPct: null
      });

      const delegated = await runSimpleExecutionWithCustomIntent({
        mode: simple,
        signal,
        intent: nextIntent,
        ctx
      });

      if (delegated.status === "executed") {
        const latest = normalizeExecutionModeState(await getExecutionModeState(ctx.bot.id), ctx.now);
        const nextGridModes = { ...(latest.modes.grid ?? {}) };
        const previous = nextGridModes[intent.symbol];
        const previousLevelCount = previous && previous.side === intent.side ? previous.filledLevels : 0;

        nextGridModes[intent.symbol] = {
          side: intent.side,
          anchorPrice: previous?.anchorPrice ?? markPrice,
          lastEntryPrice: markPrice,
          filledLevels: previousLevelCount + 1,
          activeOrders: Math.min(settings.grid.maxActiveOrders, (previous?.activeOrders ?? 0) + 1)
        };
        latest.modes.grid = nextGridModes;
        latest.updatedAt = ctx.now.toISOString();
        await upsertExecutionModeState(ctx.bot.id, latest);
      }

      return {
        ...delegated,
        metadata: {
          ...delegated.metadata,
          mode: settings.mode,
          modeStage: "grid_open",
          gridSpacingPct: settings.grid.gridSpacingPct
        }
      };
    }
  };
}
