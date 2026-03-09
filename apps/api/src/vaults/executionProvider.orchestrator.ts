import { logger as defaultLogger } from "../logger.js";
import type {
  BotExecutionState,
  ExecutionProvider,
  ExecutionProviderKey,
  ExecutionProviderLogger,
  ExecutionSafeResult
} from "./executionProvider.types.js";

type PersistErrorContext = {
  action: string;
  reason: string;
  gridInstanceId?: string | null;
  botVaultId?: string | null;
};

type OrchestratorContext = {
  action: string;
  inputMeta?: Record<string, unknown>;
  gridInstanceId?: string | null;
  botVaultId?: string | null;
};

export type CreateExecutionProviderOrchestratorParams = {
  db: any;
  provider: ExecutionProvider;
  logger?: ExecutionProviderLogger;
};

function normalizeReason(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message ? `${error.name}:${message}` : error.name;
  }
  return String(error);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class ExecutionProviderOrchestrator {
  private readonly db: any;
  private readonly provider: ExecutionProvider;
  private readonly logger: ExecutionProviderLogger;

  constructor(params: CreateExecutionProviderOrchestratorParams) {
    this.db = params.db;
    this.provider = params.provider;
    this.logger = params.logger ?? defaultLogger;
  }

  get providerKey(): ExecutionProviderKey {
    return this.provider.key;
  }

  async safeCreateUserVault(input: {
    userId: string;
    masterVaultId: string;
    preferredLabel?: string;
  }): Promise<ExecutionSafeResult<{ providerVaultId?: string | null; vaultAddress?: string | null }>> {
    return this.runSafe(
      {
        action: "createUserVault",
        inputMeta: {
          userId: input.userId,
          masterVaultId: input.masterVaultId
        }
      },
      async () => this.provider.createUserVault(input)
    );
  }

  async safeCreateBotExecutionUnit(input: {
    userId: string;
    botVaultId: string;
    masterVaultId: string;
    templateId: string;
    gridInstanceId: string;
    symbol: string;
    exchange: string;
  }): Promise<ExecutionSafeResult<{ providerUnitId?: string | null; vaultAddress?: string | null }>> {
    return this.runSafe(
      {
        action: "createBotExecutionUnit",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId,
          gridInstanceId: input.gridInstanceId,
          templateId: input.templateId,
          symbol: input.symbol,
          exchange: input.exchange
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.createBotExecutionUnit(input)
    );
  }

  async safeAssignAgent(input: {
    userId: string;
    botVaultId: string;
    agentWalletHint?: string | null;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<{ agentWallet?: string | null }>> {
    return this.runSafe(
      {
        action: "assignAgent",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () =>
        this.provider.assignAgent({
          userId: input.userId,
          botVaultId: input.botVaultId,
          agentWalletHint: input.agentWalletHint
        })
    );
  }

  async safeStart(input: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<{ ok: true }>> {
    return this.runSafe(
      {
        action: "startBotExecution",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.startBotExecution({ userId: input.userId, botVaultId: input.botVaultId })
    );
  }

  async safePause(input: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<{ ok: true }>> {
    return this.runSafe(
      {
        action: "pauseBotExecution",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.pauseBotExecution({ userId: input.userId, botVaultId: input.botVaultId })
    );
  }

  async safeSetCloseOnly(input: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<{ ok: true }>> {
    return this.runSafe(
      {
        action: "setBotCloseOnly",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.setBotCloseOnly({ userId: input.userId, botVaultId: input.botVaultId })
    );
  }

  async safeClose(input: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<{ ok: true }>> {
    return this.runSafe(
      {
        action: "closeBotExecution",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.closeBotExecution({ userId: input.userId, botVaultId: input.botVaultId })
    );
  }

  async safeGetState(input: {
    userId: string;
    botVaultId: string;
    gridInstanceId?: string | null;
  }): Promise<ExecutionSafeResult<BotExecutionState>> {
    return this.runSafe(
      {
        action: "getBotExecutionState",
        inputMeta: {
          userId: input.userId,
          botVaultId: input.botVaultId
        },
        botVaultId: input.botVaultId,
        gridInstanceId: input.gridInstanceId
      },
      async () => this.provider.getBotExecutionState({ userId: input.userId, botVaultId: input.botVaultId })
    );
  }

  private async runSafe<T>(
    context: OrchestratorContext,
    run: () => Promise<T>
  ): Promise<ExecutionSafeResult<T>> {
    try {
      const data = await run();
      return {
        ok: true,
        providerKey: this.provider.key,
        providerContext: this.provider.resolutionContext ?? null,
        data
      };
    } catch (error) {
      const reason = normalizeReason(error);
      this.logger.warn("vault_execution_provider_error", {
        providerKey: this.provider.key,
        action: context.action,
        reason,
        ...(context.inputMeta ?? {})
      });
      await this.persistProviderError({
        action: context.action,
        reason,
        gridInstanceId: context.gridInstanceId,
        botVaultId: context.botVaultId
      });
      return {
        ok: false,
        providerKey: this.provider.key,
        providerContext: this.provider.resolutionContext ?? null,
        reason
      };
    }
  }

  private async persistProviderError(params: PersistErrorContext): Promise<void> {
    try {
      const gridInstanceId = await this.resolveGridInstanceId(params);
      if (!gridInstanceId) return;

      const instance = await this.db.gridBotInstance.findUnique({
        where: { id: gridInstanceId },
        select: {
          id: true,
          stateJson: true
        }
      });
      if (!instance) return;

      const stateJson = toRecord(instance.stateJson);
      const currentExecutionProvider = toRecord(stateJson.executionProvider);
      const nextStateJson = {
        ...stateJson,
        executionProvider: {
          ...currentExecutionProvider,
          providerKey: this.provider.key,
          action: params.action,
          lastError: params.reason,
          lastErrorAt: new Date().toISOString()
        }
      };

      await this.db.gridBotInstance.update({
        where: { id: instance.id },
        data: {
          stateJson: nextStateJson
        }
      });
    } catch (error) {
      this.logger.warn("vault_execution_provider_error_state_persist_failed", {
        providerKey: this.provider.key,
        action: params.action,
        reason: normalizeReason(error),
        botVaultId: params.botVaultId ?? null,
        gridInstanceId: params.gridInstanceId ?? null
      });
    }
  }

  private async resolveGridInstanceId(params: {
    gridInstanceId?: string | null;
    botVaultId?: string | null;
  }): Promise<string | null> {
    if (params.gridInstanceId) return params.gridInstanceId;
    if (!params.botVaultId) return null;
    const botVault = await this.db.botVault.findUnique({
      where: { id: params.botVaultId },
      select: { gridInstanceId: true }
    });
    if (!botVault?.gridInstanceId) return null;
    return String(botVault.gridInstanceId);
  }
}

export function createExecutionProviderOrchestrator(
  params: CreateExecutionProviderOrchestratorParams
): ExecutionProviderOrchestrator {
  return new ExecutionProviderOrchestrator(params);
}
