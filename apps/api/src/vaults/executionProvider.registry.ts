import { logger as defaultLogger } from "../logger.js";
import { createHyperliquidDemoExecutionProvider } from "./executionProvider.hyperliquidDemo.js";
import { createHyperliquidExecutionProvider } from "./executionProvider.hyperliquid.js";
import { createMockExecutionProvider } from "./executionProvider.mock.js";
import { getEffectiveVaultExecutionProvider } from "./executionProvider.settings.js";
import { resolveGridHyperliquidPilotAccess } from "./gridHyperliquidPilot.settings.js";
import type {
  ExecutionProvider,
  ExecutionProviderKey,
  ExecutionProviderLogger,
  ExecutionProviderResolutionContext
} from "./executionProvider.types.js";

export type CreateExecutionProviderParams = {
  db: any;
  logger?: ExecutionProviderLogger;
};

function normalizeProviderKey(value: unknown): ExecutionProviderKey | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "mock") return "mock";
  if (key === "hyperliquid_demo") return "hyperliquid_demo";
  if (key === "hyperliquid") return "hyperliquid";
  return null;
}

export function createExecutionProvider(params: CreateExecutionProviderParams): ExecutionProvider {
  const logger = params.logger ?? defaultLogger;
  const providerFactories = {
    mock: () => createMockExecutionProvider(),
    hyperliquid_demo: () => createHyperliquidDemoExecutionProvider({ db: params.db, logger }),
    hyperliquid: () => createHyperliquidExecutionProvider({ db: params.db })
  } satisfies Record<ExecutionProviderKey, () => ExecutionProvider>;

  let lastResolvedKey: ExecutionProviderKey = normalizeProviderKey(process.env.VAULT_EXECUTION_PROVIDER) ?? "mock";
  let lastResolutionContext: ExecutionProviderResolutionContext | null = {
    selectionReason: "global_default",
    pilotScope: "none",
    pilotAllowed: false
  };
  let cachedProvider: ExecutionProvider | null = null;
  let cachedProviderKey: ExecutionProviderKey | null = null;

  async function resolveProviderKeyForUser(input: {
    userId: string;
    email?: string | null;
    botVaultId?: string | null;
  }): Promise<{ key: ExecutionProviderKey; context: ExecutionProviderResolutionContext }> {
    const persistedRow = input.botVaultId
      ? await params.db?.botVault?.findUnique?.({
          where: { id: input.botVaultId },
          select: { executionProvider: true }
        }).catch(() => null)
      : null;
    const persistedProvider = normalizeProviderKey(persistedRow?.executionProvider);
    if (persistedProvider === "hyperliquid_demo" || persistedProvider === "hyperliquid") {
      return {
        key: persistedProvider,
        context: {
          selectionReason: "sticky_existing_vault",
          pilotScope: "none",
          pilotAllowed: true
        }
      };
    }

    const key = await getEffectiveVaultExecutionProvider(params.db).catch(() => {
      return normalizeProviderKey(process.env.VAULT_EXECUTION_PROVIDER) ?? "mock";
    });
    if (key === "hyperliquid") {
      return {
        key,
        context: {
          selectionReason: "global_default",
          pilotScope: "none",
          pilotAllowed: false
        }
      };
    }

    const pilotAccess = await resolveGridHyperliquidPilotAccess(params.db, {
      userId: input.userId,
      email: input.email ?? null
    }).catch(() => null);
    if (pilotAccess?.allowed) {
      return {
        key: "hyperliquid_demo",
        context: {
          selectionReason: "pilot_override",
          pilotScope: pilotAccess.scope,
          pilotAllowed: true
        }
      };
    }
    return {
      key,
      context: {
        selectionReason: "global_default",
        pilotScope: "none",
        pilotAllowed: false
      }
    };
  }

  async function resolveProvider(input: {
    userId: string;
    email?: string | null;
    botVaultId?: string | null;
  }): Promise<ExecutionProvider> {
    const resolved = await resolveProviderKeyForUser(input);
    lastResolvedKey = resolved.key;
    lastResolutionContext = resolved.context;
    if (!cachedProvider || cachedProviderKey !== resolved.key) {
      cachedProvider = providerFactories[resolved.key]();
      cachedProviderKey = resolved.key;
    }
    return cachedProvider;
  }

  return {
    get key() {
      return lastResolvedKey;
    },
    get resolutionContext() {
      return lastResolutionContext;
    },
    async createUserVault(input) {
      return (await resolveProvider(input)).createUserVault(input);
    },
    async createBotExecutionUnit(input) {
      return (await resolveProvider(input)).createBotExecutionUnit(input);
    },
    async assignAgent(input) {
      return (await resolveProvider(input)).assignAgent(input);
    },
    async startBotExecution(input) {
      return (await resolveProvider(input)).startBotExecution(input);
    },
    async pauseBotExecution(input) {
      return (await resolveProvider(input)).pauseBotExecution(input);
    },
    async setBotCloseOnly(input) {
      return (await resolveProvider(input)).setBotCloseOnly(input);
    },
    async closeBotExecution(input) {
      return (await resolveProvider(input)).closeBotExecution(input);
    },
    async getBotExecutionState(input) {
      return (await resolveProvider(input)).getBotExecutionState(input);
    }
  };
}
