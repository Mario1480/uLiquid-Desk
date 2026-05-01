import { ManualTradingError, normalizeSymbolInput } from "../trading.js";
import { logger as defaultLogger } from "../logger.js";
import { computeGridPreviewAndAllocation } from "./previewComputation.js";
import type { GridVenueConstraintSource } from "./venueContext.js";
import type { VaultService } from "../vaults/service.js";
import {
  closeBotVaultOnchain,
  evaluateBotVaultExecutionReadiness,
  reconcileBotVaultById,
  type BotVaultExecutionReadiness,
  type BotVaultReconciliationIssue,
  type BotVaultRuntimeService,
  type BotVaultV3Service
} from "../vaults/botVaultRuntime.service.js";
import {
  deriveBotVaultRuntimeRecoveryHint,
  normalizeBotVaultRuntimeMismatchCategory,
  normalizeBotVaultRuntimeMismatchRecoveryAction,
  normalizeBotVaultRuntimeRecoveryHint,
  type BotVaultRuntimeMismatchCategory,
  type BotVaultRuntimeMismatchRecoveryAction,
  type BotVaultRuntimeRecoveryHint
} from "../vaults/botVaultRuntime.lifecycle.js";

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

function readBotVaultExecutionReadiness(value: unknown): BotVaultExecutionReadiness | null {
  const readiness = asRecord(asRecord(value).executionReadiness);
  if (!Object.keys(readiness).length || typeof readiness.ready !== "boolean") return null;
  return readiness as unknown as BotVaultExecutionReadiness;
}

type ResolveVenueContext = (params: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
}) => Promise<{
  markPrice: number;
  marketDataVenue: string;
  constraintSource: GridVenueConstraintSource;
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
  botVaultRuntimeService?: BotVaultRuntimeService | null;
  /** @deprecated Use botVaultRuntimeService for new call sites. */
  botVaultV3Service?: BotVaultV3Service | null;
  resolveVenueContext: ResolveVenueContext;
  computeGridPreviewAndAllocation?: typeof computeGridPreviewAndAllocation;
  allowedGridExchanges: Set<string>;
};

function resolveBotVaultRuntimeService(deps: GridLifecycleDeps): BotVaultRuntimeService | BotVaultV3Service | null {
  return deps.botVaultRuntimeService ?? deps.botVaultV3Service ?? null;
}

type GridStartBlockerStatus = "vault_reconcile_required" | "vault_not_ready" | "vault_activation_failed";

type GridStartBlocker = {
  status: GridStartBlockerStatus;
  code: string;
  statusCategory: "pending" | "retryable" | "recovery_required" | "user_action_required" | "blocked" | "execution_ready" | "settled";
  reason: string;
  reasonCode: string;
  detail: string | null;
  mismatchCategory: BotVaultRuntimeMismatchCategory | null;
  recoveryAction: BotVaultRuntimeMismatchRecoveryAction | null;
  recoveryHint: BotVaultRuntimeRecoveryHint | null;
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

function readPrimaryBotVaultReconciliationIssue(value: unknown): BotVaultReconciliationIssue | null {
  const reconciliation = asRecord(asRecord(value).reconciliation);
  const issues = Array.isArray(reconciliation.issues) ? reconciliation.issues.map(asRecord) : [];
  const raw = issues.find((issue) => String(issue.severity ?? "").trim().toLowerCase() === "blocking")
    ?? issues[0]
    ?? null;
  if (!raw) return null;
  const code = String(raw.code ?? "").trim();
  if (!code) return null;
  return {
    ...(raw as unknown as BotVaultReconciliationIssue),
    code,
    mismatchCategory: normalizeBotVaultRuntimeMismatchCategory(raw.mismatchCategory),
    recoveryAction: normalizeBotVaultRuntimeMismatchRecoveryAction(raw.recoveryAction),
    recoveryHint: normalizeBotVaultRuntimeRecoveryHint(raw.recoveryHint)
      ?? deriveBotVaultRuntimeRecoveryHint({
        mismatchCategory: raw.mismatchCategory,
        recoveryAction: raw.recoveryAction
      })
  } as BotVaultReconciliationIssue;
}

function buildGridStartBlockerRecoveryHint(params: {
  mismatchCategory?: unknown;
  recoveryAction?: unknown;
  recoveryHint?: unknown;
}): BotVaultRuntimeRecoveryHint | null {
  return normalizeBotVaultRuntimeRecoveryHint(params.recoveryHint)
    ?? deriveBotVaultRuntimeRecoveryHint({
      mismatchCategory: params.mismatchCategory,
      recoveryAction: params.recoveryAction
    });
}

async function persistGridStartBlocker(params: {
  deps: GridLifecycleDeps;
  row: any;
  blocker: GridStartBlocker;
  gridState?: "error";
  botStatus?: "error";
}) {
  const nextStateJson = {
    ...clearGridStartBlockerState(params.row?.stateJson),
    startBlocker: {
      status: params.blocker.status,
      code: params.blocker.code,
      statusCategory: params.blocker.statusCategory,
      reason: params.blocker.reason,
      reasonCode: params.blocker.reasonCode,
      detail: params.blocker.detail,
      mismatchCategory: params.blocker.mismatchCategory,
      recoveryAction: params.blocker.recoveryAction,
      recoveryHint: params.blocker.recoveryHint,
      botVaultId: params.blocker.botVaultId,
      blockedAt: params.blocker.blockedAt
    }
  };
  const operations: Promise<unknown>[] = [];
  try {
    if (params.deps.db?.gridBotInstance?.update) {
      operations.push(params.deps.db.gridBotInstance.update({
        where: { id: params.row.id },
        data: {
          ...(params.gridState ? { state: params.gridState } : {}),
          stateJson: nextStateJson
        }
      }));
    }
    if (params.deps.db?.bot?.update && params.row?.botId) {
      operations.push(params.deps.db.bot.update({
        where: { id: params.row.botId },
        data: {
          ...(params.botStatus ? { status: params.botStatus } : {}),
          lastError: params.blocker.reason
        }
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

function buildGridStartManualError(blocker: GridStartBlocker): ManualTradingError {
  const error = new ManualTradingError(blocker.reason, 409, blocker.code);
  Object.assign(error, {
    reasonCode: blocker.reasonCode,
    statusCategory: blocker.statusCategory,
    recoveryHint: blocker.recoveryHint,
    mismatchCategory: blocker.mismatchCategory,
    recoveryAction: blocker.recoveryAction,
    detail: blocker.detail,
    vaultStatus: blocker.status,
    botVaultId: blocker.botVaultId
  });
  return error;
}

export function createGridLifecycleService(deps: GridLifecycleDeps) {
  const botVaultRuntimeService = resolveBotVaultRuntimeService(deps);

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

      let botVaultIdForStartBlocker: string | null = null;
      if (String(row.botVault?.vaultModel ?? "").trim().toLowerCase() === "bot_vault_v3") {
        // Grid start blockers mirror docs/botvault-v4-status-model.md so
        // API status, logs, retry behavior, and recovery hints stay aligned.
        const botVaultId = String(row.botVault?.id ?? "").trim() || null;
        botVaultIdForStartBlocker = botVaultId;
        let botVaultForStart = row.botVault;

        if (botVaultId && botVaultRuntimeService) {
          try {
            botVaultForStart = await reconcileBotVaultById(botVaultRuntimeService, {
              userId: params.userId,
              botVaultId
            });
          } catch (error) {
            const blocker: GridStartBlocker = {
              status: "vault_reconcile_required",
              code: "grid_instance_vault_reconcile_required",
              statusCategory: "retryable",
              reason: "grid_instance_vault_reconcile_required",
              reasonCode: "grid_instance_vault_reconcile_required",
              detail: normalizeErrorDetail(error),
              mismatchCategory: "observed_state_incomplete",
              recoveryAction: "retry",
              recoveryHint: "retry_reconcile",
              botVaultId,
              blockedAt: new Date().toISOString()
            };
            defaultLogger.warn("grid_start_vault_reconcile_failed", {
              gridInstanceId: String(row.id),
              botId: String(row.botId),
              userId: params.userId,
              botVaultId,
              statusCategory: blocker.statusCategory,
              reasonCode: blocker.reasonCode,
              mismatchCategory: blocker.mismatchCategory,
              recoveryAction: blocker.recoveryAction,
              recoveryHint: blocker.recoveryHint,
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

        const executionReadiness =
          readBotVaultExecutionReadiness(botVaultForStart)
          ?? evaluateBotVaultExecutionReadiness(botVaultForStart);
        if (!executionReadiness.ready) {
          const primaryIssue = readPrimaryBotVaultReconciliationIssue(botVaultForStart);
          const mismatchCategory = executionReadiness.mismatchCategory ?? primaryIssue?.mismatchCategory ?? null;
          const recoveryAction = executionReadiness.recoveryAction ?? primaryIssue?.recoveryAction ?? null;
          const recoveryHint = buildGridStartBlockerRecoveryHint({
            mismatchCategory,
            recoveryAction,
            recoveryHint: executionReadiness.recoveryHint ?? primaryIssue?.recoveryHint ?? null
          });
          const reasonCode = primaryIssue?.code ?? executionReadiness.reason;
          const blocker: GridStartBlocker = {
            status: "vault_not_ready",
            code: "bot_vault_v3_execution_not_ready",
            statusCategory: executionReadiness.statusCategory ?? "blocked",
            reason: reasonCode,
            reasonCode,
            detail: primaryIssue?.detail ?? executionReadiness.detail ?? executionReadiness.reason,
            mismatchCategory,
            recoveryAction,
            recoveryHint,
            botVaultId,
            blockedAt: new Date().toISOString()
          };
          defaultLogger.warn("grid_start_vault_not_ready", {
            gridInstanceId: String(row.id),
            botId: String(row.botId),
            userId: params.userId,
            botVaultId,
            statusCategory: blocker.statusCategory,
            readinessReason: executionReadiness.reason,
            readinessDetail: executionReadiness.detail ?? null,
            reasonCode: blocker.reasonCode,
            mismatchCategory: blocker.mismatchCategory,
            recoveryAction: blocker.recoveryAction,
            recoveryHint: blocker.recoveryHint,
            reconciliationIssueCode: primaryIssue?.code ?? null
          });
          await persistGridStartBlocker({
            deps,
            row,
            blocker
          });
          throw new ManualTradingError(
            blocker.reason,
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

      try {
        await deps.vaultService.activateBotVaultForGridInstance({
          userId: params.userId,
          gridInstanceId: String(row.id)
        });
      } catch (error) {
        const blocker: GridStartBlocker = {
          status: "vault_activation_failed",
          code: "grid_instance_vault_activation_failed",
          statusCategory: "retryable",
          reason: "grid_instance_vault_activation_failed",
          reasonCode: "grid_instance_vault_activation_failed",
          detail: normalizeErrorDetail(error),
          mismatchCategory: "observed_state_incomplete",
          recoveryAction: "retry",
          recoveryHint: "retry_reconcile",
          botVaultId: botVaultIdForStartBlocker,
          blockedAt: new Date().toISOString()
        };
        defaultLogger.warn("grid_start_vault_activation_failed", {
          gridInstanceId: String(row.id),
          botId: String(row.botId),
          userId: params.userId,
          botVaultId: blocker.botVaultId,
          statusCategory: blocker.statusCategory,
          reasonCode: blocker.reasonCode,
          mismatchCategory: blocker.mismatchCategory,
          recoveryAction: blocker.recoveryAction,
          recoveryHint: blocker.recoveryHint,
          detail: blocker.detail
        });
        await persistGridStartBlocker({
          deps,
          row,
          blocker,
          gridState: "error",
          botStatus: "error"
        });
        throw buildGridStartManualError(blocker);
      }

      await deps.db.$transaction([
        deps.db.gridBotInstance.update({
          where: { id: row.id },
          data: { state: "running", archivedAt: null, archivedReason: null, stateJson: nextStateJson }
        }),
        deps.db.bot.update({ where: { id: row.botId }, data: { status: "running", lastError: null } })
      ]);
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
      const botVaultStatus = String(botVault?.status ?? row.botVault?.status ?? "").trim().toUpperCase();
      const isBotVaultRuntimeModel = vaultModel === "bot_vault_v3";
      // The persisted bot_vault_v3 model is served by the current BotVault runtime.
      // Stop the grid first unless the vault is already in close-only settlement,
      // otherwise order placement can race the HyperCore exit and drain.
      const skipStopBeforeClose = isBotVaultRuntimeModel && (botVaultStatus === "CLOSE_ONLY" || botVaultStatus === "CLOSED");

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
        if (isBotVaultRuntimeModel && botVaultRuntimeService && botVaultId) {
          await closeBotVaultOnchain(botVaultRuntimeService, {
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
