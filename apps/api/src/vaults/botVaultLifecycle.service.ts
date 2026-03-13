import { bookVaultLedgerEntry } from "./ledger.js";
import type { ExecutionProviderOrchestrator } from "./executionProvider.orchestrator.js";
import { createMasterVaultService, type MasterVaultService } from "./masterVault.service.js";
import { createFeeSettlementService, type FeeSettlementService } from "./feeSettlement.service.js";
import { roundUsd } from "./profitShare.js";
import { createExecutionLifecycleService, type ExecutionLifecycleService } from "./executionLifecycle.service.js";
import { createRiskPolicyService, type RiskPolicyService } from "./riskPolicy.service.js";
import { logger as defaultLogger } from "../logger.js";

type CreateBotVaultLifecycleServiceDeps = {
  masterVaultService?: MasterVaultService | null;
  executionOrchestrator?: ExecutionProviderOrchestrator | null;
  feeSettlementService?: FeeSettlementService | null;
  executionLifecycleService?: ExecutionLifecycleService | null;
  riskPolicyService?: RiskPolicyService | null;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

type BotVaultLifecycleStatus = "ACTIVE" | "PAUSED" | "CLOSE_ONLY" | "STOPPED" | "CLOSED" | "ERROR";

type CreateParams = {
  userId: string;
  gridInstanceId: string;
  allocationUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type CreateForBotParams = {
  userId: string;
  botId: string;
  allocationUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type TopUpParams = {
  userId: string;
  botVaultId: string;
  amountUsd: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  tx?: any;
};

type StatusParams = {
  userId: string;
  botVaultId: string;
  reason?: string;
  tx?: any;
};

type CloseParams = {
  userId: string;
  botVaultId: string;
  idempotencyKey: string;
  forceClose?: boolean;
  metadata?: Record<string, unknown>;
  tx?: any;
};

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key) throw new Error("invalid_idempotency_key");
  return key;
}

function toPositiveAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return roundUsd(parsed, 6);
}

function normalizeStatus(value: unknown): BotVaultLifecycleStatus {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "PAUSED") return "PAUSED";
  if (raw === "CLOSE_ONLY") return "CLOSE_ONLY";
  if (raw === "STOPPED") return "STOPPED";
  if (raw === "CLOSED") return "CLOSED";
  if (raw === "ERROR") return "ERROR";
  return "ACTIVE";
}

function isPausedLike(status: BotVaultLifecycleStatus): boolean {
  return status === "PAUSED" || status === "STOPPED";
}

function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as any).code ?? "").trim() || "unknown_error";
  }
  return "unknown_error";
}

async function findBotVaultForUser(tx: any, userId: string, botVaultId: string): Promise<any | null> {
  if (tx?.botVault?.findFirst) {
    return tx.botVault.findFirst({
      where: {
        id: botVaultId,
        userId
      }
    });
  }
  const row = await tx.botVault.findUnique({ where: { id: botVaultId } });
  if (!row) return null;
  if (String(row.userId) !== String(userId)) return null;
  return row;
}

async function findGridRiskContext(tx: any, gridInstanceId: string): Promise<{
  ownerType: "grid";
  id: string;
  botId: string | null;
  templateId: string;
  exchange: string;
  symbol: string;
  leverage: number;
} | null> {
  const row = await tx.gridBotInstance.findUnique({
    where: { id: gridInstanceId },
    select: {
      id: true,
      botId: true,
      templateId: true,
      leverage: true,
      template: {
        select: {
          symbol: true
        }
      },
      exchangeAccount: {
        select: {
          exchange: true
        }
      }
    }
  });
  if (!row) return null;
  return {
    ownerType: "grid",
    id: String(row.id),
    botId: row.botId ? String(row.botId) : null,
    templateId: String(row.templateId ?? "legacy_grid_default"),
    exchange: String(row.exchangeAccount?.exchange ?? ""),
    symbol: String(row.template?.symbol ?? ""),
    leverage: Number(row.leverage ?? 1)
  };
}

async function findBotRiskContext(tx: any, botId: string): Promise<{
  ownerType: "bot";
  id: string;
  botId: string;
  templateId: string;
  exchange: string;
  symbol: string;
  leverage: number;
} | null> {
  const row = await tx.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      userId: true,
      symbol: true,
      exchange: true,
      futuresConfig: {
        select: {
          leverage: true
        }
      }
    }
  });
  if (!row) return null;
  return {
    ownerType: "bot",
    id: String(row.id),
    botId: String(row.id),
    templateId: "legacy_grid_default",
    exchange: String(row.exchange ?? ""),
    symbol: String(row.symbol ?? ""),
    leverage: Number(row.futuresConfig?.leverage ?? 1)
  };
}

async function findBotVaultOwnerRiskContext(tx: any, botVault: any) {
  if (botVault?.botId) {
    return findBotRiskContext(tx, String(botVault.botId));
  }
  if (botVault?.gridInstanceId) {
    return findGridRiskContext(tx, String(botVault.gridInstanceId));
  }
  return null;
}

export function createBotVaultLifecycleService(db: any, deps?: CreateBotVaultLifecycleServiceDeps) {
  const logger = deps?.logger ?? defaultLogger;
  const executionOrchestrator = deps?.executionOrchestrator ?? null;
  const masterVaultService = deps?.masterVaultService ?? createMasterVaultService(db);
  const feeSettlementService = deps?.feeSettlementService
    ?? createFeeSettlementService(db, { masterVaultService });
  const executionLifecycleService = deps?.executionLifecycleService
    ?? createExecutionLifecycleService(db, { executionOrchestrator });
  const riskPolicyService = deps?.riskPolicyService
    ?? createRiskPolicyService(db);

  async function withTx<T>(tx: any | undefined, run: (tx: any) => Promise<T>): Promise<T> {
    if (tx) return run(tx);
    return db.$transaction(async (dbTx: any) => run(dbTx));
  }

  function emitTransition(params: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
    botId?: string | null;
    action: "create" | "topup" | "pause" | "activate" | "set_close_only" | "close";
    fromStatus: string | null;
    toStatus: string | null;
    result: "succeeded" | "noop";
    idempotencyKey?: string;
  }) {
    logger.info("vault_lifecycle_transition", {
      userId: params.userId,
      botVaultId: params.botVaultId,
      gridInstanceId: params.gridInstanceId,
      botId: params.botId ?? null,
      action: params.action,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      result: params.result,
      idempotencyKey: params.idempotencyKey ?? null
    });
  }

  function emitTransitionRejected(params: {
    userId: string;
    botVaultId?: string | null;
    gridInstanceId?: string | null;
    botId?: string | null;
    action: "create" | "topup" | "pause" | "activate" | "set_close_only" | "close";
    fromStatus?: string | null;
    requestedToStatus?: string | null;
    error: unknown;
  }) {
    logger.warn("vault_lifecycle_transition_rejected", {
      userId: params.userId,
      botVaultId: params.botVaultId ?? null,
      gridInstanceId: params.gridInstanceId ?? null,
      botId: params.botId ?? null,
      action: params.action,
      fromStatus: params.fromStatus ?? null,
      requestedToStatus: params.requestedToStatus ?? null,
      errorCode: extractErrorCode(params.error),
      reason: params.error instanceof Error ? params.error.message : String(params.error)
    });
  }

  async function create(params: CreateParams): Promise<any> {
    const allocationUsd = toPositiveAmount(params.allocationUsd);
    if (allocationUsd <= 0) throw new Error("invalid_allocation_usd");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    try {
      return await withTx(params.tx, async (tx) => {
        const existing = await tx.botVault.findUnique({
          where: { gridInstanceId: params.gridInstanceId }
        });
        if (existing) {
          if (String(existing.userId) !== String(params.userId)) throw new Error("grid_instance_user_mismatch");
          emitTransition({
            userId: params.userId,
            botVaultId: String(existing.id),
            gridInstanceId: existing.gridInstanceId ? String(existing.gridInstanceId) : null,
            botId: existing.botId ? String(existing.botId) : null,
            action: "create",
            fromStatus: String(existing.status ?? "ACTIVE"),
            toStatus: String(existing.status ?? "ACTIVE"),
            result: "noop",
            idempotencyKey
          });
          return existing;
        }

        const instance = await tx.gridBotInstance.findUnique({
          where: { id: params.gridInstanceId },
          select: {
            id: true,
            userId: true,
            templateId: true,
            leverage: true,
            template: {
              select: {
                symbol: true
              }
            },
            exchangeAccount: {
              select: {
                exchange: true
              }
            }
          }
        });
        if (!instance) throw new Error("grid_instance_not_found");
        if (String(instance.userId) !== String(params.userId)) throw new Error("grid_instance_user_mismatch");

        const requestedTemplateId = String(instance.templateId ?? "legacy_grid_default");
        const resolvedRiskTemplate = await riskPolicyService.resolveTemplate({
          tx,
          templateId: requestedTemplateId
        });
        if (!resolvedRiskTemplate) {
          throw new Error("risk_template_not_found");
        }

        await riskPolicyService.assertCanCreateBotVault({
          tx,
          templateId: resolvedRiskTemplate.id,
          symbol: String(instance.template?.symbol ?? ""),
          leverage: Number(instance.leverage ?? 1),
          allocationUsd
        });

        const masterVault = await masterVaultService.ensureMasterVault({
          userId: params.userId,
          tx
        });

        let created: any;
        try {
          created = await tx.botVault.create({
            data: {
              userId: params.userId,
              masterVaultId: masterVault.id,
              // bot_vaults.templateId references BotTemplate, not GridBotTemplate.
              templateId: String(resolvedRiskTemplate.id),
              gridInstanceId: params.gridInstanceId,
              status: "ACTIVE",
              principalAllocated: allocationUsd,
              allocatedUsd: allocationUsd,
              availableUsd: allocationUsd,
              matchingStateJson: {
                version: 1,
                longLots: [],
                shortLots: []
              }
            }
          });
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
          const raced = await tx.botVault.findUnique({
            where: { gridInstanceId: params.gridInstanceId }
          });
          if (!raced) throw error;
          emitTransition({
            userId: params.userId,
            botVaultId: String(raced.id),
            gridInstanceId: raced.gridInstanceId ? String(raced.gridInstanceId) : null,
            botId: raced.botId ? String(raced.botId) : null,
            action: "create",
            fromStatus: String(raced.status ?? "ACTIVE"),
            toStatus: String(raced.status ?? "ACTIVE"),
            result: "noop",
            idempotencyKey
          });
          return raced;
        }

        created = await executionLifecycleService.provisionIdentityForBotVault({
          tx,
          userId: params.userId,
          botVaultId: String(created.id),
          sourceKey: `${idempotencyKey}:provision`,
          metadata: {
            sourceType: "bot_vault_create"
          }
        });
        created = await executionLifecycleService.assignAgentWallet({
          tx,
          userId: params.userId,
          botVaultId: String(created.id),
          agentWalletHint: created.agentWallet ?? null,
          sourceKey: `${idempotencyKey}:assign_agent`,
          metadata: {
            sourceType: "bot_vault_create"
          }
        });

        const ledger = await bookVaultLedgerEntry({
          tx,
          userId: params.userId,
          masterVaultId: String(masterVault.id),
          botVaultId: String(created.id),
          gridInstanceId: params.gridInstanceId,
          entryType: "ALLOCATION",
          amountUsd: allocationUsd,
          sourceType: "bot_vault_create_allocation",
          sourceKey: idempotencyKey,
          sourceTs: new Date(),
          metadataJson: params.metadata ?? null
        });

        if (ledger.created) {
          await masterVaultService.reserveForBotVault({
            tx,
            userId: params.userId,
            botVaultId: String(created.id),
            amountUsd: allocationUsd,
            idempotencyKey,
          metadata: {
            gridInstanceId: params.gridInstanceId,
            sourceType: "bot_vault_create_allocation",
              ...(params.metadata ?? {})
            }
          });
        }

        emitTransition({
          userId: params.userId,
          botVaultId: String(created.id),
          gridInstanceId: created.gridInstanceId ? String(created.gridInstanceId) : params.gridInstanceId,
          botId: created.botId ? String(created.botId) : null,
          action: "create",
          fromStatus: null,
          toStatus: "ACTIVE",
          result: "succeeded",
          idempotencyKey
        });

        return created;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        gridInstanceId: params.gridInstanceId,
        action: "create",
        fromStatus: null,
        requestedToStatus: "ACTIVE",
        error
      });
      throw error;
    }
  }

  async function createForBot(params: CreateForBotParams): Promise<any> {
    const allocationUsd = toPositiveAmount(params.allocationUsd);
    if (allocationUsd <= 0) throw new Error("invalid_allocation_usd");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    try {
      return await withTx(params.tx, async (tx) => {
        const existing = await tx.botVault.findUnique({
          where: { botId: params.botId }
        });
        if (existing) {
          if (String(existing.userId) !== String(params.userId)) throw new Error("bot_user_mismatch");
          emitTransition({
            userId: params.userId,
            botVaultId: String(existing.id),
            gridInstanceId: existing.gridInstanceId ? String(existing.gridInstanceId) : null,
            botId: existing.botId ? String(existing.botId) : params.botId,
            action: "create",
            fromStatus: String(existing.status ?? "ACTIVE"),
            toStatus: String(existing.status ?? "ACTIVE"),
            result: "noop",
            idempotencyKey
          });
          return existing;
        }

        const botContext = await findBotRiskContext(tx, params.botId);
        if (!botContext) throw new Error("bot_not_found");
        const botRow = await tx.bot.findUnique({
          where: { id: params.botId },
          select: {
            id: true,
            userId: true,
            exchange: true,
            futuresConfig: {
              select: {
                strategyKey: true
              }
            }
          }
        });
        if (!botRow) throw new Error("bot_not_found");
        if (String(botRow.userId ?? "") !== String(params.userId)) throw new Error("bot_user_mismatch");
        if (String(botRow.exchange ?? "").trim().toLowerCase() !== "hyperliquid") {
          throw new Error("bot_vault_exchange_not_supported");
        }
        const strategyKey = String(botRow.futuresConfig?.strategyKey ?? "").trim().toLowerCase();
        if (strategyKey !== "prediction_copier" && strategyKey !== "dummy") {
          throw new Error("bot_vault_strategy_not_supported");
        }

        const resolvedRiskTemplate = await riskPolicyService.resolveTemplate({
          tx,
          templateId: botContext.templateId
        });
        if (!resolvedRiskTemplate) throw new Error("risk_template_not_found");

        await riskPolicyService.assertCanCreateBotVault({
          tx,
          templateId: resolvedRiskTemplate.id,
          symbol: botContext.symbol,
          leverage: botContext.leverage,
          allocationUsd
        });

        const masterVault = await masterVaultService.ensureMasterVault({
          userId: params.userId,
          tx
        });

        let created: any;
        try {
          created = await tx.botVault.create({
            data: {
              userId: params.userId,
              masterVaultId: masterVault.id,
              templateId: String(resolvedRiskTemplate.id),
              botId: params.botId,
              status: "ACTIVE",
              principalAllocated: allocationUsd,
              allocatedUsd: allocationUsd,
              availableUsd: allocationUsd,
              matchingStateJson: {
                version: 1,
                longLots: [],
                shortLots: []
              }
            }
          });
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
          const raced = await tx.botVault.findUnique({
            where: { botId: params.botId }
          });
          if (!raced) throw error;
          emitTransition({
            userId: params.userId,
            botVaultId: String(raced.id),
            gridInstanceId: raced.gridInstanceId ? String(raced.gridInstanceId) : null,
            botId: raced.botId ? String(raced.botId) : params.botId,
            action: "create",
            fromStatus: String(raced.status ?? "ACTIVE"),
            toStatus: String(raced.status ?? "ACTIVE"),
            result: "noop",
            idempotencyKey
          });
          return raced;
        }

        created = await executionLifecycleService.provisionIdentityForBotVault({
          tx,
          userId: params.userId,
          botVaultId: String(created.id),
          sourceKey: `${idempotencyKey}:provision`,
          metadata: {
            sourceType: "bot_vault_create",
            botId: params.botId
          }
        });
        created = await executionLifecycleService.assignAgentWallet({
          tx,
          userId: params.userId,
          botVaultId: String(created.id),
          agentWalletHint: created.agentWallet ?? null,
          sourceKey: `${idempotencyKey}:assign_agent`,
          metadata: {
            sourceType: "bot_vault_create",
            botId: params.botId
          }
        });

        const ledger = await bookVaultLedgerEntry({
          tx,
          userId: params.userId,
          masterVaultId: String(masterVault.id),
          botVaultId: String(created.id),
          gridInstanceId: null,
          entryType: "ALLOCATION",
          amountUsd: allocationUsd,
          sourceType: "bot_vault_create_allocation",
          sourceKey: idempotencyKey,
          sourceTs: new Date(),
          metadataJson: {
            botId: params.botId,
            ...(params.metadata ?? {})
          }
        });

        if (ledger.created) {
          await masterVaultService.reserveForBotVault({
            tx,
            userId: params.userId,
            botVaultId: String(created.id),
            amountUsd: allocationUsd,
            idempotencyKey,
            metadata: {
              botId: params.botId,
              sourceType: "bot_vault_create_allocation",
              ...(params.metadata ?? {})
            }
          });
        }

        emitTransition({
          userId: params.userId,
          botVaultId: String(created.id),
          gridInstanceId: null,
          botId: created.botId ? String(created.botId) : params.botId,
          action: "create",
          fromStatus: null,
          toStatus: "ACTIVE",
          result: "succeeded",
          idempotencyKey
        });

        return created;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botId: params.botId,
        action: "create",
        fromStatus: null,
        requestedToStatus: "ACTIVE",
        error
      });
      throw error;
    }
  }

  async function topUp(params: TopUpParams): Promise<any> {
    const amountUsd = toPositiveAmount(params.amountUsd);
    if (amountUsd <= 0) throw new Error("invalid_topup_amount");
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");

        const status = normalizeStatus(botVault.status);
        if (status === "CLOSED") throw new Error("bot_vault_already_closed");
        if (!(status === "ACTIVE" || isPausedLike(status))) {
          throw new Error("bot_vault_topup_not_allowed_in_status");
        }

        const ownerRiskContext = await findBotVaultOwnerRiskContext(tx, botVault);
        if (!ownerRiskContext) throw new Error("bot_vault_owner_not_found");

        await riskPolicyService.assertCanTopUpBotVault({
          tx,
          templateId: String(botVault.templateId ?? "legacy_grid_default"),
          symbol: ownerRiskContext.symbol,
          leverage: ownerRiskContext.leverage,
          resultingAllocationUsd: Number(botVault.principalAllocated ?? 0) + amountUsd
        });

        const ledger = await bookVaultLedgerEntry({
          tx,
          userId: params.userId,
          masterVaultId: String(botVault.masterVaultId),
          botVaultId: String(botVault.id),
          gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
          entryType: "ALLOCATION",
          amountUsd,
          sourceType: "bot_vault_topup",
          sourceKey: idempotencyKey,
          sourceTs: new Date(),
          metadataJson: params.metadata ?? null
        });
        if (!ledger.created) {
          const current = await tx.botVault.findUnique({ where: { id: botVault.id } });
          if (current) {
            emitTransition({
              userId: params.userId,
              botVaultId: String(current.id),
              gridInstanceId: current.gridInstanceId ? String(current.gridInstanceId) : null,
              botId: current.botId ? String(current.botId) : null,
              action: "topup",
              fromStatus: String(current.status ?? status),
              toStatus: String(current.status ?? status),
              result: "noop",
              idempotencyKey
            });
          }
          return current;
        }

        await masterVaultService.reserveForBotVault({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          amountUsd,
          idempotencyKey,
          metadata: {
            ...(botVault.gridInstanceId ? { gridInstanceId: String(botVault.gridInstanceId) } : {}),
            ...(botVault.botId ? { botId: String(botVault.botId) } : {}),
            sourceType: "bot_vault_topup",
            ...(params.metadata ?? {})
          }
        });

        const updated = await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            principalAllocated: { increment: amountUsd },
            allocatedUsd: { increment: amountUsd },
            availableUsd: { increment: amountUsd }
          }
        });

        emitTransition({
          userId: params.userId,
          botVaultId: String(updated.id),
          gridInstanceId: updated.gridInstanceId ? String(updated.gridInstanceId) : null,
          botId: updated.botId ? String(updated.botId) : null,
          action: "topup",
          fromStatus: String(botVault.status ?? status),
          toStatus: String(updated.status ?? status),
          result: "succeeded",
          idempotencyKey
        });

        return updated;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botVaultId: params.botVaultId,
        action: "topup",
        requestedToStatus: null,
        error
      });
      throw error;
    }
  }

  async function pause(params: StatusParams): Promise<any> {
    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");

        const status = normalizeStatus(botVault.status);
        if (status === "CLOSED") throw new Error("bot_vault_already_closed");
        if (isPausedLike(status)) {
          emitTransition({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
            botId: botVault.botId ? String(botVault.botId) : null,
            action: "pause",
            fromStatus: String(botVault.status ?? status),
            toStatus: String(botVault.status ?? status),
            result: "noop"
          });
          return botVault;
        }

        riskPolicyService.assertStatusTransition({
          fromStatus: status,
          toStatus: "PAUSED"
        });

        const updated = await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            status: "PAUSED"
          }
        });

        await executionLifecycleService.pauseExecution({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          sourceKey: `bot_vault:${botVault.id}:pause:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          reason: params.reason ?? "bot_vault_pause"
        });

        emitTransition({
          userId: params.userId,
          botVaultId: String(updated.id),
          gridInstanceId: updated.gridInstanceId ? String(updated.gridInstanceId) : null,
          botId: updated.botId ? String(updated.botId) : null,
          action: "pause",
          fromStatus: String(botVault.status ?? status),
          toStatus: String(updated.status ?? "PAUSED"),
          result: "succeeded"
        });

        return updated;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botVaultId: params.botVaultId,
        action: "pause",
        requestedToStatus: "PAUSED",
        error
      });
      throw error;
    }
  }

  async function activate(params: StatusParams): Promise<any> {
    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");

        const status = normalizeStatus(botVault.status);
        if (status === "CLOSED") throw new Error("bot_vault_already_closed");
        if (status === "ACTIVE") {
          emitTransition({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
            botId: botVault.botId ? String(botVault.botId) : null,
            action: "activate",
            fromStatus: String(botVault.status ?? status),
            toStatus: String(botVault.status ?? status),
            result: "noop"
          });
          return botVault;
        }

        riskPolicyService.assertStatusTransition({
          fromStatus: status,
          toStatus: "ACTIVE"
        });

        const ownerRiskContext = await findBotVaultOwnerRiskContext(tx, botVault);
        if (!ownerRiskContext) throw new Error("bot_vault_owner_not_found");
        await riskPolicyService.assertCanStartOrResume({
          tx,
          templateId: String(botVault.templateId ?? "legacy_grid_default"),
          symbol: ownerRiskContext.symbol,
          leverage: ownerRiskContext.leverage
        });

        const updated = await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            status: "ACTIVE"
          }
        });

        await executionLifecycleService.startExecution({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          sourceKey: `bot_vault:${botVault.id}:activate:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          reason: params.reason ?? "bot_vault_activate"
        });

        emitTransition({
          userId: params.userId,
          botVaultId: String(updated.id),
          gridInstanceId: updated.gridInstanceId ? String(updated.gridInstanceId) : null,
          botId: updated.botId ? String(updated.botId) : null,
          action: "activate",
          fromStatus: String(botVault.status ?? status),
          toStatus: String(updated.status ?? "ACTIVE"),
          result: "succeeded"
        });

        return updated;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botVaultId: params.botVaultId,
        action: "activate",
        requestedToStatus: "ACTIVE",
        error
      });
      throw error;
    }
  }

  async function setCloseOnly(params: StatusParams): Promise<any> {
    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");

        const status = normalizeStatus(botVault.status);
        if (status === "CLOSED") throw new Error("bot_vault_already_closed");
        if (status === "CLOSE_ONLY") {
          emitTransition({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
            botId: botVault.botId ? String(botVault.botId) : null,
            action: "set_close_only",
            fromStatus: String(botVault.status ?? status),
            toStatus: String(botVault.status ?? status),
            result: "noop"
          });
          return botVault;
        }

        riskPolicyService.assertStatusTransition({
          fromStatus: status,
          toStatus: "CLOSE_ONLY"
        });

        const updated = await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            status: "CLOSE_ONLY"
          }
        });

        await executionLifecycleService.setCloseOnly({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          sourceKey: `bot_vault:${botVault.id}:close_only:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          reason: params.reason ?? "bot_vault_set_close_only"
        });

        emitTransition({
          userId: params.userId,
          botVaultId: String(updated.id),
          gridInstanceId: updated.gridInstanceId ? String(updated.gridInstanceId) : null,
          botId: updated.botId ? String(updated.botId) : null,
          action: "set_close_only",
          fromStatus: String(botVault.status ?? status),
          toStatus: String(updated.status ?? "CLOSE_ONLY"),
          result: "succeeded"
        });

        return updated;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botVaultId: params.botVaultId,
        action: "set_close_only",
        requestedToStatus: "CLOSE_ONLY",
        error
      });
      throw error;
    }
  }

  async function close(params: CloseParams): Promise<any> {
    const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);
    const forceClose = params.forceClose === true;

    try {
      return await withTx(params.tx, async (tx) => {
        const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
        if (!botVault) throw new Error("bot_vault_not_found");

        const status = normalizeStatus(botVault.status);
        if (status === "CLOSED") {
          emitTransition({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null,
            botId: botVault.botId ? String(botVault.botId) : null,
            action: "close",
            fromStatus: String(botVault.status ?? status),
            toStatus: String(botVault.status ?? status),
            result: "noop",
            idempotencyKey
          });
          return botVault;
        }

        riskPolicyService.assertStatusTransition({
          fromStatus: status,
          toStatus: "CLOSED",
          forceClose
        });

        if (!forceClose) {
          const state = await executionLifecycleService.syncExecutionState({
            tx,
            userId: params.userId,
            botVaultId: String(botVault.id),
            sourceKey: `${idempotencyKey}:sync_before_close`,
            metadata: {
              sourceType: "bot_vault_close_precheck"
            }
          });
          if (!state) {
            throw new Error("execution_state_unavailable_for_close");
          }
          if (String(state.status ?? "").toLowerCase() === "running") {
            throw new Error("execution_still_running");
          }
          const hasOpenPositions = Array.isArray(state.positions)
            ? state.positions.some((position) => Math.abs(Number(position?.qty ?? 0)) > 0.0000001)
            : false;
          if (hasOpenPositions) {
            throw new Error("execution_positions_still_open");
          }
        }

        await executionLifecycleService.closeExecution({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          sourceKey: `${idempotencyKey}:execution_close`,
          reason: params.metadata?.sourceType
            ? `bot_vault_close:${String(params.metadata.sourceType)}`
            : "bot_vault_close"
        });

        await feeSettlementService.settleFinalClose({
          tx,
          userId: params.userId,
          botVaultId: String(botVault.id),
          idempotencyKey,
          metadata: {
            ...(botVault.gridInstanceId ? { gridInstanceId: String(botVault.gridInstanceId) } : {}),
            ...(botVault.botId ? { botId: String(botVault.botId) } : {}),
            sourceType: "bot_vault_close",
            ...(params.metadata ?? {})
          }
        });

        const updated = await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            status: "CLOSED"
          }
        });

        emitTransition({
          userId: params.userId,
          botVaultId: String(updated.id),
          gridInstanceId: updated.gridInstanceId ? String(updated.gridInstanceId) : null,
          botId: updated.botId ? String(updated.botId) : null,
          action: "close",
          fromStatus: String(botVault.status ?? status),
          toStatus: String(updated.status ?? "CLOSED"),
          result: "succeeded",
          idempotencyKey
        });

        return updated;
      });
    } catch (error) {
      emitTransitionRejected({
        userId: params.userId,
        botVaultId: params.botVaultId,
        action: "close",
        requestedToStatus: "CLOSED",
        error
      });
      throw error;
    }
  }

  return {
    create,
    createForBot,
    topUp,
    pause,
    activate,
    setCloseOnly,
    close
  };
}

export type BotVaultLifecycleService = ReturnType<typeof createBotVaultLifecycleService>;
