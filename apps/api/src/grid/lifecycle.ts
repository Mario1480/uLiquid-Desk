import { ManualTradingError, normalizeSymbolInput } from "../trading.js";
import { computeGridPreviewAndAllocation } from "./previewComputation.js";
import type { VaultService } from "../vaults/service.js";

function normalizeGridExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeTemplateSymbol(value: string): string {
  return normalizeSymbolInput(value) || String(value ?? "").trim().toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type ResolveVenueContext = (params: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
}) => Promise<{
  markPrice: number;
  marketDataVenue: string;
  venueConstraints: {
    minQty: number | null;
    qtyStep: number | null;
    priceTick: number | null;
    minNotional: number | null;
    feeRate: number | null;
  };
  feeBufferPct: number;
  mmrPct: number;
  liqDistanceMinPct: number;
  warnings: string[];
}>;

type GridLifecycleDeps = {
  db: any;
  vaultService: VaultService;
  resolveVenueContext: ResolveVenueContext;
  allowedGridExchanges: Set<string>;
};

function ensureGridExchangeAllowed(params: {
  exchange: unknown;
  allowedExchanges: Set<string>;
}): { ok: true } | { ok: false; exchange: string; allowedExchanges: string[] } {
  const exchange = normalizeGridExchange(params.exchange);
  if (params.allowedExchanges.has(exchange)) return { ok: true };
  return {
    ok: false,
    exchange,
    allowedExchanges: [...params.allowedExchanges]
  };
}

async function readPaperSymbolState(params: {
  db: any;
  exchangeAccountId: string;
  symbol: string;
}): Promise<{
  positions: Array<Record<string, unknown>>;
  openOrders: Array<Record<string, unknown>>;
}> {
  const key = `paper.state:${params.exchangeAccountId}`;
  const row = await params.db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  const state = asRecord(row?.value);
  const normalizedSymbol = normalizeTemplateSymbol(params.symbol);
  const positions = Array.isArray(state.positions)
    ? state.positions.filter((entry) => normalizeTemplateSymbol(asRecord(entry).symbol as string) === normalizedSymbol).map(asRecord)
    : [];
  const openOrders = Array.isArray(state.orders)
    ? state.orders
        .filter((entry) => {
          const item = asRecord(entry);
          return normalizeTemplateSymbol(item.symbol as string) === normalizedSymbol
            && String(item.status ?? "").trim().toLowerCase() === "open";
        })
        .map(asRecord)
    : [];
  return { positions, openOrders };
}

export function createGridLifecycleService(deps: GridLifecycleDeps) {
  return {
    async startGridInstanceNow(params: {
      row: any;
      userId: string;
    }): Promise<{ id: string; state: "running"; botId: string }> {
      const row = params.row;
      const previousState = String(row.state ?? "").trim().toLowerCase();
      if (previousState === "archived") {
        throw new ManualTradingError("grid instance is archived", 409, "grid_instance_archived_not_restartable");
      }

      const allowed = ensureGridExchangeAllowed({
        exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? "",
        allowedExchanges: deps.allowedGridExchanges
      });
      if (!allowed.ok) {
        throw new ManualTradingError(`exchange ${allowed.exchange} is not allowed for grid`, 400, "grid_exchange_not_allowed");
      }

      const exchangeKey = normalizeGridExchange(row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? "");
      const botSymbol = normalizeTemplateSymbol(row.template.symbol);
      if (exchangeKey === "paper") {
        const paperState = await readPaperSymbolState({
          db: deps.db,
          exchangeAccountId: row.exchangeAccountId,
          symbol: botSymbol
        });
        const previousStateIsFresh = previousState === "created" || !previousState;
        const foreignOpenOrders = paperState.openOrders.filter((entry) => {
          const clientOrderId = String(entry.clientOrderId ?? "").trim();
          return !clientOrderId.startsWith(`grid-${row.id}-`);
        });
        if (previousStateIsFresh && (paperState.positions.length > 0 || paperState.openOrders.length > 0)) {
          throw new ManualTradingError(
            `paper symbol ${botSymbol} is not clean for a fresh grid start`,
            409,
            "grid_paper_symbol_not_clean"
          );
        }
        if (!previousStateIsFresh && foreignOpenOrders.length > 0) {
          throw new ManualTradingError(
            `paper symbol ${botSymbol} has foreign open orders`,
            409,
            "grid_paper_symbol_conflict"
          );
        }
      }

      const computed = await computeGridPreviewAndAllocation({
        userId: params.userId,
        exchangeAccountId: row.exchangeAccountId,
        template: row.template,
        autoReservePolicy: row.autoReservePolicy ?? row.template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: row.autoReserveFixedGridPct ?? row.template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: row.autoReserveTargetLiqDistancePct ?? row.template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: row.autoReserveMaxPreviewIterations ?? row.template.autoReserveMaxPreviewIterations ?? 8,
        activeOrderWindowSize: row.activeOrderWindowSize ?? row.template.activeOrderWindowSize ?? 100,
        recenterDriftLevels: row.recenterDriftLevels ?? row.template.recenterDriftLevels ?? 1,
        investUsd: row.investUsd,
        extraMarginUsd: row.extraMarginUsd,
        autoMarginEnabled: row.marginMode === "AUTO" || Boolean(row.autoMarginEnabled),
        tpPct: row.tpPct,
        slPrice: row.slPrice,
        triggerPrice: row.triggerPrice,
        leverage: row.leverage,
        slippagePct: row.slippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });
      const minInvestmentUSDT = Number(computed.preview.minInvestmentUSDT ?? computed.minInvestmentUSDT ?? 0);
      if (Number.isFinite(minInvestmentUSDT) && minInvestmentUSDT > 0 && row.investUsd + 1e-9 < minInvestmentUSDT) {
        throw new ManualTradingError("grid invest below minimum", 400, "grid_instance_invest_below_minimum");
      }

      const nextStateJson = (() => {
        const base = asRecord(row.stateJson);
        if (previousState === "paused" || previousState === "stopped" || previousState === "error") {
          return { ...base, initialSeedNeedsReseed: true };
        }
        return base;
      })();
      await deps.db.$transaction([
        deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: { state: "running", archivedAt: null, archivedReason: null, stateJson: nextStateJson }
        }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "running", lastError: null } })
      ]);

      await deps.vaultService.activateBotVaultForGridInstance({
        userId: params.userId,
        gridInstanceId: String(row.id)
      });
      return { id: row.id, state: "running", botId: row.botId };
    },

    async archiveGridInstance(params: {
      row: any;
      userId: string;
      reason: string;
      closeSourceType: string;
    }): Promise<{ id: string; state: "archived"; botId: string; alreadyArchived: boolean }> {
      const row = params.row;
      if (String(row.state ?? "").trim().toLowerCase() === "archived") {
        return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: true };
      }
      await deps.db.$transaction([
        deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: {
            state: "archived",
            archivedAt: new Date(),
            archivedReason: params.reason
          }
        }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "stopped" } })
      ]);

      await deps.vaultService.setBotVaultCloseOnlyForGridInstance({
        userId: params.userId,
        gridInstanceId: String(row.id)
      });
      await deps.vaultService.closeBotVaultForGridInstance({
        userId: params.userId,
        gridInstanceId: String(row.id),
        idempotencyKey: `grid_instance:${row.id}:close:v2:${params.reason}`,
        metadata: {
          sourceType: params.closeSourceType
        }
      });
      return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: false };
    }
  };
}
