import { logger as defaultLogger } from "../logger.js";
import type {
  BotExecutionState,
  ExecutionProviderResolutionContext,
  ExecutionSafeResult
} from "./executionProvider.types.js";
import type { ExecutionProviderOrchestrator } from "./executionProvider.orchestrator.js";
import { createRiskPolicyService, type RiskPolicyService } from "./riskPolicy.service.js";

type ExecutionLifecycleLogger = {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
};

type ExecutionAction =
  | "provision_identity"
  | "assign_agent"
  | "start"
  | "pause"
  | "set_close_only"
  | "close"
  | "sync_state";

type ExecutionEventResult = "succeeded" | "failed";

type BotProcessControl = {
  enqueueBotRun?: ((botId: string) => Promise<unknown>) | null;
  cancelBotRun?: ((botId: string) => Promise<unknown>) | null;
};

type CreateExecutionLifecycleServiceDeps = {
  executionOrchestrator?: ExecutionProviderOrchestrator | null;
  processControl?: BotProcessControl | null;
  logger?: ExecutionLifecycleLogger;
  riskPolicyService?: RiskPolicyService | null;
};

type BaseExecutionParams = {
  userId: string;
  botVaultId: string;
  sourceKey: string;
  tx?: any;
  metadata?: Record<string, unknown>;
};

type ProvisionParams = BaseExecutionParams;

type AssignAgentParams = BaseExecutionParams & {
  agentWalletHint?: string | null;
};

type StartParams = BaseExecutionParams & {
  reason?: string;
};

type PauseParams = BaseExecutionParams & {
  reason?: string;
};

type SetCloseOnlyParams = BaseExecutionParams & {
  reason?: string;
};

type CloseParams = BaseExecutionParams & {
  reason?: string;
};

type SyncStateParams = BaseExecutionParams;

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function normalizeSourceKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key) throw new Error("invalid_source_key");
  return key;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapProviderStatusToExecutionStatus(status: unknown): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "running") return "running";
  if (normalized === "paused") return "paused";
  if (normalized === "close_only") return "close_only";
  if (normalized === "closed") return "closed";
  if (normalized === "error") return "error";
  return "created";
}

function buildProviderNotConfiguredResult<T>(): ExecutionSafeResult<T> {
  return {
    ok: false,
    providerKey: "mock",
    reason: "execution_orchestrator_not_configured"
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function providerContextToMetadata(context: ExecutionProviderResolutionContext | null | undefined): Record<string, unknown> {
  if (!context) return {};
  return {
    providerSelectionReason: context.selectionReason,
    pilotScope: context.pilotScope,
    pilotAllowed: context.pilotAllowed
  };
}

function appendProviderContextMetadata<T>(
  result: ExecutionSafeResult<T> | { providerContext?: ExecutionProviderResolutionContext | null },
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...providerContextToMetadata(result.providerContext ?? null),
    ...(extra ?? {})
  };
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

type BotVaultOwnerContext = {
  ownerType: "grid" | "bot";
  gridInstanceId: string | null;
  botId: string | null;
  templateId: string;
  symbol: string;
  exchange: string;
  leverage: number;
};

async function findGridContext(tx: any, gridInstanceId: string): Promise<BotVaultOwnerContext | null> {
  const row = await tx.gridBotInstance.findUnique({
    where: { id: gridInstanceId },
    select: {
      id: true,
      templateId: true,
      botId: true,
      template: {
        select: {
          symbol: true
        }
      },
      exchangeAccount: {
        select: {
          exchange: true
        }
      },
      leverage: true
    }
  });
  if (!row) return null;
  return {
    ownerType: "grid",
    gridInstanceId: String(row.id),
    botId: row.botId ? String(row.botId) : null,
    templateId: String(row.templateId ?? "legacy_grid_default"),
    symbol: String(row.template?.symbol ?? ""),
    exchange: String(row.exchangeAccount?.exchange ?? ""),
    leverage: Number(row.leverage ?? 1)
  };
}

async function findBotContext(tx: any, botId: string): Promise<BotVaultOwnerContext | null> {
  const row = await tx.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
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
    gridInstanceId: null,
    botId: String(row.id),
    templateId: "legacy_grid_default",
    symbol: String(row.symbol ?? ""),
    exchange: String(row.exchange ?? ""),
    leverage: Number(row.futuresConfig?.leverage ?? 1)
  };
}

async function findBotVaultOwnerContext(tx: any, botVault: any): Promise<BotVaultOwnerContext | null> {
  if (botVault?.botId) {
    return findBotContext(tx, String(botVault.botId));
  }
  if (botVault?.gridInstanceId) {
    return findGridContext(tx, String(botVault.gridInstanceId));
  }
  return null;
}

export function createExecutionLifecycleService(db: any, deps?: CreateExecutionLifecycleServiceDeps) {
  const executionOrchestrator = deps?.executionOrchestrator ?? null;
  const processControl = deps?.processControl ?? {};
  const logger = deps?.logger ?? defaultLogger;
  const riskPolicyService = deps?.riskPolicyService ?? createRiskPolicyService(db);

  async function withTx<T>(tx: any | undefined, run: (tx: any) => Promise<T>): Promise<T> {
    if (tx) return run(tx);
    return db.$transaction(async (dbTx: any) => run(dbTx));
  }

  async function findExecutionEventBySourceKey(tx: any, sourceKey: string): Promise<any | null> {
    if (!tx?.botExecutionEvent?.findUnique) return null;
    return tx.botExecutionEvent.findUnique({ where: { sourceKey } });
  }

  async function createExecutionEventIfNew(params: {
    tx: any;
    userId: string;
    botVault: any;
    gridContext: BotVaultOwnerContext | null;
    sourceKey: string;
    action: ExecutionAction;
    result: ExecutionEventResult;
    fromStatus: string | null;
    toStatus: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    providerKey?: string | null;
    executionUnitId?: string | null;
  }): Promise<boolean> {
    if (!params.tx?.botExecutionEvent?.create) return false;
    try {
      await params.tx.botExecutionEvent.create({
        data: {
          userId: String(params.userId),
          botVaultId: String(params.botVault.id),
          gridInstanceId: params.gridContext?.gridInstanceId
            ?? (params.botVault.gridInstanceId ? String(params.botVault.gridInstanceId) : null),
          botId: params.gridContext?.botId ?? null,
          providerKey: params.providerKey ?? null,
          executionUnitId: params.executionUnitId ?? null,
          action: params.action,
          fromStatus: params.fromStatus,
          toStatus: params.toStatus,
          result: params.result,
          reason: params.reason ?? null,
          sourceKey: params.sourceKey,
          metadata: params.metadata ?? null
        }
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return false;
    }
  }

  async function createPilotRiskEvent(params: {
    tx: any;
    botId: string | null;
    type: string;
    message: string | null;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    if (!params.botId) return;
    if (!params.tx?.riskEvent?.create) return;
    await params.tx.riskEvent.create({
      data: {
        botId: params.botId,
        type: params.type,
        message: params.message ?? null,
        meta: params.meta ?? null
      }
    });
  }

  async function updateBotVaultExecutionState(params: {
    tx: any;
    botVaultId: string;
    providerKey?: string | null;
    executionUnitId?: string | null;
    executionStatus?: string | null;
    vaultAddress?: string | null;
    agentWallet?: string | null;
    errorReason?: string | null;
    metadataPatch?: Record<string, unknown>;
  }) {
    const patch: Record<string, unknown> = {
      executionLastSyncedAt: new Date()
    };
    if (params.providerKey !== undefined) patch.executionProvider = params.providerKey;
    if (params.executionUnitId !== undefined) patch.executionUnitId = params.executionUnitId;
    if (params.executionStatus !== undefined) patch.executionStatus = params.executionStatus;
    if (params.vaultAddress !== undefined) patch.vaultAddress = params.vaultAddress;
    if (params.agentWallet !== undefined) patch.agentWallet = params.agentWallet;

    if (params.errorReason) {
      patch.executionLastError = params.errorReason;
      patch.executionLastErrorAt = new Date();
    } else if (params.errorReason === null) {
      patch.executionLastError = null;
      patch.executionLastErrorAt = null;
    }

    if (params.metadataPatch) {
      const existing = await params.tx.botVault.findUnique({
        where: { id: params.botVaultId },
        select: { executionMetadata: true }
      });
      patch.executionMetadata = {
        ...toRecord(existing?.executionMetadata),
        ...params.metadataPatch,
        updatedAt: nowIso()
      };
    }

    return params.tx.botVault.update({
      where: { id: params.botVaultId },
      data: patch
    });
  }

  async function ensureBotRuntimeStatus(params: {
    tx: any;
    botId: string | null;
    status: "running" | "stopped";
    reason: string;
  }) {
    if (!params.botId) return;
    if (!params.tx?.botRuntime?.upsert) return;
    await params.tx.botRuntime.upsert({
      where: { botId: params.botId },
      update: {
        status: params.status,
        reason: params.reason,
        lastHeartbeatAt: new Date()
      },
      create: {
        botId: params.botId,
        status: params.status,
        reason: params.reason,
        lastHeartbeatAt: new Date()
      }
    });
  }

  async function provisionIdentityForBotVault(params: ProvisionParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      if (!gridContext) throw new Error("bot_vault_owner_not_found");

      const result = executionOrchestrator
        ? await executionOrchestrator.safeCreateBotExecutionUnit({
            userId: params.userId,
            botVaultId: String(botVault.id),
            masterVaultId: String(botVault.masterVaultId),
            templateId: String(botVault.templateId ?? gridContext.templateId),
            gridInstanceId: gridContext.gridInstanceId,
            botId: gridContext.botId,
            symbol: gridContext.symbol,
            exchange: gridContext.exchange
          })
        : buildProviderNotConfiguredResult<{ providerUnitId?: string | null; vaultAddress?: string | null }>();

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = result.ok ? "created" : fromStatus;

      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: result.providerKey,
        executionUnitId: result.ok ? (result.data.providerUnitId ?? null) : undefined,
        executionStatus: toStatus,
        vaultAddress: result.ok && result.data.vaultAddress ? String(result.data.vaultAddress) : undefined,
        errorReason: result.ok ? null : result.reason,
        metadataPatch: appendProviderContextMetadata(result, {
          lastProvisionedAt: nowIso(),
          sourceType: "execution_lifecycle_provision"
        })
      });

      const createdEvent = await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "provision_identity",
        result: result.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: result.ok ? null : result.reason,
        metadata: {
          providerUnitId: result.ok ? (result.data.providerUnitId ?? null) : null,
          ...appendProviderContextMetadata(result),
          ...toRecord(params.metadata)
        },
        providerKey: result.providerKey,
        executionUnitId: result.ok ? (result.data.providerUnitId ?? null) : null
      });
      if (createdEvent && result.ok && result.providerKey === "hyperliquid_demo") {
        await createPilotRiskEvent({
          tx,
          botId: gridContext?.botId ?? null,
          type: "GRID_HYPERLIQUID_PROVIDER_SELECTED",
          message: result.providerContext?.selectionReason ?? "hyperliquid_demo_selected",
          meta: appendProviderContextMetadata(result, {
            action: "provision_identity",
            botVaultId: String(botVault.id),
            ...(gridContext.gridInstanceId ? { gridInstanceId: gridContext.gridInstanceId } : {}),
            ...(gridContext.botId ? { botId: gridContext.botId } : {})
          })
        });
      }

      return updated;
    });
  }

  async function assignAgentWallet(params: AssignAgentParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      const result = executionOrchestrator
        ? await executionOrchestrator.safeAssignAgent({
            userId: params.userId,
            botVaultId: String(botVault.id),
            agentWalletHint: params.agentWalletHint ?? botVault.agentWallet ?? null,
            gridInstanceId: gridContext?.gridInstanceId ?? null
          })
        : buildProviderNotConfiguredResult<{ agentWallet?: string | null }>();

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = fromStatus;

      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: result.providerKey,
        agentWallet: result.ok && result.data.agentWallet ? String(result.data.agentWallet) : undefined,
        errorReason: result.ok ? null : result.reason,
        metadataPatch: appendProviderContextMetadata(result, {
          lastAgentAssignedAt: nowIso(),
          sourceType: "execution_lifecycle_assign_agent"
        })
      });

      await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "assign_agent",
        result: result.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: result.ok ? null : result.reason,
        metadata: {
          agentWallet: result.ok ? (result.data.agentWallet ?? null) : null,
          ...appendProviderContextMetadata(result),
          ...toRecord(params.metadata)
        },
        providerKey: result.providerKey,
        executionUnitId: String(updated.executionUnitId ?? "") || null
      });

      return updated;
    });
  }

  async function startExecution(params: StartParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      if (!gridContext) throw new Error("bot_vault_owner_not_found");

      await riskPolicyService.assertCanStartOrResume({
          tx,
          templateId: String(botVault.templateId ?? gridContext.templateId),
          symbol: gridContext.symbol,
        leverage: gridContext.leverage
      });

      const providerResult = executionOrchestrator
        ? await executionOrchestrator.safeStart({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: gridContext.gridInstanceId
          })
        : buildProviderNotConfiguredResult<{ ok: true }>();

      try {
        if (gridContext?.botId && processControl.enqueueBotRun) {
          await processControl.enqueueBotRun(gridContext.botId);
        }
      } catch (error) {
        const reason = `bot_process_start_failed:${String(error)}`;
        await updateBotVaultExecutionState({
          tx,
          botVaultId: String(botVault.id),
          providerKey: providerResult.providerKey,
          errorReason: reason
        });
        await createExecutionEventIfNew({
          tx,
          userId: params.userId,
          botVault,
          gridContext,
          sourceKey,
          action: "start",
          result: "failed",
          fromStatus: String(botVault.executionStatus ?? "created"),
          toStatus: String(botVault.executionStatus ?? "created"),
          reason,
          metadata: {
            ...appendProviderContextMetadata(providerResult),
            ...toRecord(params.metadata)
          },
          providerKey: providerResult.providerKey,
          executionUnitId: String(botVault.executionUnitId ?? "") || null
        });
        throw error;
      }

      await ensureBotRuntimeStatus({
        tx,
        botId: gridContext?.botId ?? null,
        status: "running",
        reason: params.reason ?? "bot_execution_start"
      });

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = "running";
      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: providerResult.providerKey,
        executionStatus: toStatus,
        errorReason: providerResult.ok ? null : providerResult.reason,
        metadataPatch: appendProviderContextMetadata(providerResult, {
          lastStartedAt: nowIso(),
          sourceType: "execution_lifecycle_start"
        })
      });

      await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "start",
        result: providerResult.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: providerResult.ok ? null : providerResult.reason,
        metadata: {
          providerOk: providerResult.ok,
          ...appendProviderContextMetadata(providerResult),
          processStarted: true,
          ...toRecord(params.metadata)
        },
        providerKey: providerResult.providerKey,
        executionUnitId: String(updated.executionUnitId ?? "") || null
      });

      return updated;
    });
  }

  async function pauseExecution(params: PauseParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      const providerResult = executionOrchestrator
        ? await executionOrchestrator.safePause({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: gridContext?.gridInstanceId ?? null
          })
        : buildProviderNotConfiguredResult<{ ok: true }>();

      if (gridContext?.botId && processControl.cancelBotRun) {
        try {
          await processControl.cancelBotRun(gridContext.botId);
        } catch (error) {
          logger.warn("bot_process_pause_cancel_failed", {
            botVaultId: botVault.id,
            botId: gridContext.botId,
            reason: String(error)
          });
        }
      }

      await ensureBotRuntimeStatus({
        tx,
        botId: gridContext?.botId ?? null,
        status: "stopped",
        reason: params.reason ?? "bot_execution_pause"
      });

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = "paused";

      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: providerResult.providerKey,
        executionStatus: toStatus,
        errorReason: providerResult.ok ? null : providerResult.reason,
        metadataPatch: appendProviderContextMetadata(providerResult, {
          lastPausedAt: nowIso(),
          sourceType: "execution_lifecycle_pause"
        })
      });

      await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "pause",
        result: providerResult.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: providerResult.ok ? null : providerResult.reason,
        metadata: {
          providerOk: providerResult.ok,
          ...appendProviderContextMetadata(providerResult),
          ...toRecord(params.metadata)
        },
        providerKey: providerResult.providerKey,
        executionUnitId: String(updated.executionUnitId ?? "") || null
      });

      return updated;
    });
  }

  async function setCloseOnly(params: SetCloseOnlyParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      const providerResult = executionOrchestrator
        ? await executionOrchestrator.safeSetCloseOnly({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: gridContext?.gridInstanceId ?? null
          })
        : buildProviderNotConfiguredResult<{ ok: true }>();

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = "close_only";

      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: providerResult.providerKey,
        executionStatus: toStatus,
        errorReason: providerResult.ok ? null : providerResult.reason,
        metadataPatch: appendProviderContextMetadata(providerResult, {
          lastCloseOnlyAt: nowIso(),
          sourceType: "execution_lifecycle_set_close_only"
        })
      });

      await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "set_close_only",
        result: providerResult.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: providerResult.ok ? null : providerResult.reason,
        metadata: {
          providerOk: providerResult.ok,
          ...appendProviderContextMetadata(providerResult),
          ...toRecord(params.metadata)
        },
        providerKey: providerResult.providerKey,
        executionUnitId: String(updated.executionUnitId ?? "") || null
      });

      return updated;
    });
  }

  async function closeExecution(params: CloseParams): Promise<any> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        return tx.botVault.findUnique({ where: { id: botVault.id } });
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      const providerResult = executionOrchestrator
        ? await executionOrchestrator.safeClose({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: gridContext?.gridInstanceId ?? null
          })
        : buildProviderNotConfiguredResult<{ ok: true }>();

      if (gridContext?.botId && processControl.cancelBotRun) {
        try {
          await processControl.cancelBotRun(gridContext.botId);
        } catch (error) {
          logger.warn("bot_process_close_cancel_failed", {
            botVaultId: botVault.id,
            botId: gridContext.botId,
            reason: String(error)
          });
        }
      }

      await ensureBotRuntimeStatus({
        tx,
        botId: gridContext?.botId ?? null,
        status: "stopped",
        reason: params.reason ?? "bot_execution_close"
      });

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = "closed";

      const updated = await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: providerResult.providerKey,
        executionStatus: toStatus,
        errorReason: providerResult.ok ? null : providerResult.reason,
        metadataPatch: appendProviderContextMetadata(providerResult, {
          lastClosedAt: nowIso(),
          sourceType: "execution_lifecycle_close"
        })
      });

      await createExecutionEventIfNew({
        tx,
        userId: params.userId,
        botVault,
        gridContext,
        sourceKey,
        action: "close",
        result: providerResult.ok ? "succeeded" : "failed",
        fromStatus,
        toStatus,
        reason: providerResult.ok ? null : providerResult.reason,
        metadata: {
          providerOk: providerResult.ok,
          ...appendProviderContextMetadata(providerResult),
          ...toRecord(params.metadata)
        },
        providerKey: providerResult.providerKey,
        executionUnitId: String(updated.executionUnitId ?? "") || null
      });

      return updated;
    });
  }

  async function syncExecutionState(params: SyncStateParams): Promise<BotExecutionState | null> {
    const sourceKey = normalizeSourceKey(params.sourceKey);
    return withTx(params.tx, async (tx) => {
      const botVault = await findBotVaultForUser(tx, params.userId, params.botVaultId);
      if (!botVault) throw new Error("bot_vault_not_found");

      const existingEvent = await findExecutionEventBySourceKey(tx, sourceKey);
      if (existingEvent) {
        if (!executionOrchestrator) return null;
        const state = await executionOrchestrator.safeGetState({
          userId: params.userId,
          botVaultId: String(botVault.id),
          gridInstanceId: botVault.gridInstanceId ? String(botVault.gridInstanceId) : null
        });
        return state.ok ? state.data : null;
      }

      const gridContext = await findBotVaultOwnerContext(tx, botVault);
      const result = executionOrchestrator
        ? await executionOrchestrator.safeGetState({
            userId: params.userId,
            botVaultId: String(botVault.id),
            gridInstanceId: gridContext?.gridInstanceId ?? null
          })
        : buildProviderNotConfiguredResult<BotExecutionState>();
      const previousSyncError = String(botVault.executionLastError ?? "").trim();

      if (!result.ok) {
        await updateBotVaultExecutionState({
          tx,
          botVaultId: String(botVault.id),
          providerKey: result.providerKey,
          errorReason: result.reason,
          metadataPatch: appendProviderContextMetadata(result, {
            lastStateSyncAt: nowIso(),
            sourceType: "execution_lifecycle_sync_state"
          })
        });

        const createdEvent = await createExecutionEventIfNew({
          tx,
          userId: params.userId,
          botVault,
          gridContext,
          sourceKey,
          action: "sync_state",
          result: "failed",
          fromStatus: String(botVault.executionStatus ?? "created"),
          toStatus: String(botVault.executionStatus ?? "created"),
          reason: result.reason,
          metadata: {
            ...appendProviderContextMetadata(result),
            ...toRecord(params.metadata)
          },
          providerKey: result.providerKey,
          executionUnitId: String(botVault.executionUnitId ?? "") || null
        });
        if (
          createdEvent
          && result.providerKey === "hyperliquid_demo"
          && previousSyncError !== String(result.reason ?? "").trim()
        ) {
          await createPilotRiskEvent({
            tx,
            botId: gridContext?.botId ?? null,
            type: "GRID_HYPERLIQUID_EXECUTION_SYNC_ERROR",
            message: result.reason,
            meta: appendProviderContextMetadata(result, {
              action: "sync_state",
              botVaultId: String(botVault.id),
              ...(gridContext?.gridInstanceId ? { gridInstanceId: gridContext.gridInstanceId } : {}),
              ...(gridContext?.botId ? { botId: gridContext.botId } : {})
            })
          });
        }

        return null;
      }

      const fromStatus = String(botVault.executionStatus ?? "created");
      const toStatus = mapProviderStatusToExecutionStatus(result.data.status);
      await updateBotVaultExecutionState({
        tx,
        botVaultId: String(botVault.id),
        providerKey: result.providerKey,
        executionStatus: toStatus,
        errorReason: null,
        metadataPatch: appendProviderContextMetadata(result, {
          lastStateSyncAt: nowIso(),
          providerState: toRecord(result.data.providerMetadata),
          sourceType: "execution_lifecycle_sync_state"
        })
      });

      if (fromStatus !== toStatus) {
        await createExecutionEventIfNew({
          tx,
          userId: params.userId,
          botVault,
          gridContext,
          sourceKey,
          action: "sync_state",
          result: "succeeded",
          fromStatus,
          toStatus,
          metadata: {
            observedAt: result.data.observedAt,
            ...appendProviderContextMetadata(result),
            ...toRecord(params.metadata)
          },
          providerKey: result.providerKey,
          executionUnitId: String(botVault.executionUnitId ?? "") || null
        });
      }

      return result.data;
    });
  }

  async function listExecutionEvents(params: { userId: string; botVaultId: string; limit?: number }) {
    if (!db?.botExecutionEvent?.findMany) return [];
    const botVault = await db.botVault.findFirst({
      where: {
        id: params.botVaultId,
        userId: params.userId
      },
      select: { id: true }
    });
    if (!botVault) return [];
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit ?? 200))));
    return db.botExecutionEvent.findMany({
      where: { botVaultId: botVault.id },
      orderBy: [{ createdAt: "desc" }],
      take: limit
    });
  }

  return {
    provisionIdentityForBotVault,
    assignAgentWallet,
    startExecution,
    pauseExecution,
    setCloseOnly,
    closeExecution,
    syncExecutionState,
    listExecutionEvents
  };
}

export type ExecutionLifecycleService = ReturnType<typeof createExecutionLifecycleService>;
