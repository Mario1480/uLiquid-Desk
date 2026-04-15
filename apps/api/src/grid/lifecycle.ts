import { ManualTradingError, normalizeSymbolInput } from "../trading.js";
import { logger as defaultLogger } from "../logger.js";
import { computeGridPreviewAndAllocation } from "./previewComputation.js";
import type { VaultService } from "../vaults/service.js";
import {
  evaluateBotVaultV3ExecutionReadiness,
  type BotVaultV3Service
} from "../vaults/botVaultV3.service.js";

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
  botVaultV3Service?: BotVaultV3Service | null;
  resolveVenueContext: ResolveVenueContext;
  computeGridPreviewAndAllocation?: typeof computeGridPreviewAndAllocation;
  allowedGridExchanges: Set<string>;
};

type GridStartBlockerStatus = "vault_reconcile_required" | "vault_not_ready";

type GridStartBlocker = {
  status: GridStartBlockerStatus;
  code: string;
  reason: string;
  detail: string | null;
  botVaultId: string | null;
  blockedAt: string;
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

function clearGridStartBlockerState(stateJson: unknown): Record<string, unknown> {
  const base = asRecord(stateJson);
  if (!Object.prototype.hasOwnProperty.call(base, "startBlocker")) return base;
  const { startBlocker: _ignored, ...rest } = base;
  return rest;
}

function normalizeErrorDetail(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return String(error ?? "unknown_error");
}

async function persistGridStartBlocker(params: {
  deps: GridLifecycleDeps;
  row: any;
  blocker: GridStartBlocker;
}) {
  const nextStateJson = {
    ...clearGridStartBlockerState(params.row?.stateJson),
    startBlocker: {
      status: params.blocker.status,
      code: params.blocker.code,
      reason: params.blocker.reason,
      detail: params.blocker.detail,
      botVaultId: params.blocker.botVaultId,
      blockedAt: params.blocker.blockedAt
    }
  };
  const operations: Promise<unknown>[] = [];
  try {
    if (params.deps.db?.gridBotInstance?.update) {
      operations.push(params.deps.db.gridBotInstance.update({
        where: { id: params.row.id },
        data: { stateJson: nextStateJson }
      }));
    }
    if (params.deps.db?.bot?.update && params.row?.botId) {
      operations.push(params.deps.db.bot.update({
        where: { id: params.row.botId },
        data: { lastError: params.blocker.reason }
      }));
    }
  } catch (error) {
    defaultLogger.warn("grid_start_blocker_persist_failed", {
      gridInstanceId: String(params.row?.id ?? ""),
      botId: String(params.row?.botId ?? ""),
      blockerStatus: params.blocker.status,
      persistError: normalizeErrorDetail(error)
    });
    return;
  }
  if (!operations.length) return;

  try {
    if (params.deps.db?.$transaction) {
      await params.deps.db.$transaction(operations);
      return;
    }
    await Promise.all(operations);
  } catch (error) {
    defaultLogger.warn("grid_start_blocker_persist_failed", {
      gridInstanceId: String(params.row?.id ?? ""),
      botId: String(params.row?.botId ?? ""),
      blockerStatus: params.blocker.status,
      persistError: normalizeErrorDetail(error)
    });
  }
}

export function createGridLifecycleService(deps: GridLifecycleDeps) {
  async function startGridInstanceNow(params: {
      row: any;
      userId: string;
      allowedExchanges?: Set<string>;
    }): Promise<{ id: string; state: "running"; botId: string }> {
      const row = params.row;
      const previousState = String(row.state ?? "").trim().toLowerCase();
      if (previousState === "archived") {
        throw new ManualTradingError("grid instance is archived", 409, "grid_instance_archived_not_restartable");
      }

      const allowedExchanges = params.allowedExchanges ?? deps.allowedGridExchanges;
      const allowed = ensureGridExchangeAllowed({
        exchange: row.bot?.exchangeAccount?.exchange ?? row.bot?.exchange ?? "",
        allowedExchanges
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

      if (String(row.botVault?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3") {
        const botVaultId = String(row.botVault?.id ?? "").trim() || null;
        let botVaultForStart = row.botVault;

        if (botVaultId && deps.botVaultV3Service?.reconcileBotVaultV3ById) {
          try {
            botVaultForStart = await deps.botVaultV3Service.reconcileBotVaultV3ById({
              userId: params.userId,
              botVaultId
            });
          } catch (error) {
            const blocker: GridStartBlocker = {
              status: "vault_reconcile_required",
              code: "grid_instance_vault_reconcile_required",
              reason: "BotVault v3 reconciliation failed before grid start",
              detail: normalizeErrorDetail(error),
              botVaultId,
              blockedAt: new Date().toISOString()
            };
            defaultLogger.warn("grid_start_vault_reconcile_failed", {
              gridInstanceId: String(row.id),
              botId: String(row.botId),
              userId: params.userId,
              botVaultId,
              detail: blocker.detail
            });
            await persistGridStartBlocker({
              deps,
              row,
              blocker
            });
            throw new ManualTradingError(
              blocker.reason,
              409,
              blocker.code
            );
          }
        }

        const executionReadiness = evaluateBotVaultV3ExecutionReadiness(botVaultForStart);
        if (!executionReadiness.ready) {
          const blocker: GridStartBlocker = {
            status: "vault_not_ready",
            code: "bot_vault_v3_execution_not_ready",
            reason: `BotVault v3 is not ready for execution (${executionReadiness.reason})`,
            detail: executionReadiness.detail ?? executionReadiness.reason,
            botVaultId,
            blockedAt: new Date().toISOString()
          };
          defaultLogger.warn("grid_start_vault_not_ready", {
            gridInstanceId: String(row.id),
            botId: String(row.botId),
            userId: params.userId,
            botVaultId,
            readinessReason: executionReadiness.reason,
            readinessDetail: executionReadiness.detail ?? null
          });
          await persistGridStartBlocker({
            deps,
            row,
            blocker
          });
          throw new ManualTradingError(
            executionReadiness.reason,
            409,
            "bot_vault_v3_execution_not_ready"
          );
        }
      }

      const computed = await (deps.computeGridPreviewAndAllocation ?? computeGridPreviewAndAllocation)({
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
        const base = clearGridStartBlockerState(row.stateJson);
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
    }

  async function stopGridInstance(params: {
      row: any;
      userId: string;
    }): Promise<{ id: string; state: "stopped"; botId: string; alreadyStopped: boolean }> {
      const row = params.row;
      const currentState = String(row.state ?? "").trim().toLowerCase();
      if (currentState === "archived") {
        throw new ManualTradingError("grid instance is archived", 409, "grid_instance_archived_not_restartable");
      }
      if (currentState === "stopped") {
        return { id: row.id, state: "stopped", botId: row.botId, alreadyStopped: true };
      }

      await deps.vaultService.stopBotVaultForGridInstance({
        userId: params.userId,
        gridInstanceId: String(row.id)
      });

      await deps.db.$transaction([
        deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: { state: "stopped" }
        }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "stopped" } })
      ]);
      return { id: row.id, state: "stopped", botId: row.botId, alreadyStopped: false };
    }

  async function endGridInstance(params: {
      row: any;
      userId: string;
      reason: string;
      closeSourceType: string;
    }): Promise<{ id: string; state: "archived"; botId: string; alreadyArchived: boolean }> {
      const row = params.row;
      if (String(row.state ?? "").trim().toLowerCase() === "archived") {
        return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: true };
      }

      let botVault = await deps.vaultService.getBotVaultByGridInstance({
        userId: params.userId,
        gridInstanceId: String(row.id)
      });
      const botVaultId = String(botVault?.id ?? row.botVault?.id ?? "").trim();
      const vaultModel = String(botVault?.vaultModel ?? row.botVault?.vaultModel ?? "").trim().toLowerCase();
      const isBotVaultV3 = vaultModel === "bot_vault_v3";
      // bot_vault_v3 performs its own closeout via controllerCloseBotVault and
      // should not hit the generic execution stop/close guard first.
      const skipStopBeforeClose = isBotVaultV3;

      if (!skipStopBeforeClose) {
        await stopGridInstance({
          row,
          userId: params.userId
        });
        botVault = await deps.vaultService.getBotVaultByGridInstance({
          userId: params.userId,
          gridInstanceId: String(row.id)
        });
      }

      if (String(botVault?.status ?? "").trim().toUpperCase() !== "CLOSED") {
        if (isBotVaultV3 && deps.botVaultV3Service && botVaultId) {
          await deps.botVaultV3Service.controllerCloseBotVault({
            userId: params.userId,
            botVaultId
          });
        } else {
          await deps.vaultService.setBotVaultCloseOnlyForGridInstance({
            userId: params.userId,
            gridInstanceId: String(row.id)
          });
          const pendingOnchainExit = typeof deps.vaultService.prepareOnchainExitForGridInstance === "function"
            ? await deps.vaultService.prepareOnchainExitForGridInstance({
                userId: params.userId,
                gridInstanceId: String(row.id)
              })
            : null;
          if (pendingOnchainExit) {
            throw new ManualTradingError(
              `grid instance end pending onchain signature: ${pendingOnchainExit.actionType}`,
              409,
              "grid_instance_end_pending_onchain_signature"
            );
          }
          await deps.vaultService.closeBotVaultForGridInstance({
            userId: params.userId,
            gridInstanceId: String(row.id),
            idempotencyKey: `grid_instance:${row.id}:close:v2:${params.reason}`,
            metadata: {
              sourceType: params.closeSourceType
            }
          });
        }
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
      return { id: row.id, state: "archived", botId: row.botId, alreadyArchived: false };
    }

  async function archiveGridInstance(params: {
      row: any;
      userId: string;
      reason: string;
      closeSourceType: string;
    }): Promise<{ id: string; state: "archived"; botId: string; alreadyArchived: boolean }> {
    return endGridInstance(params);
  }

  return {
    startGridInstanceNow,
    stopGridInstance,
    endGridInstance,
    archiveGridInstance
  };
}
