import { logger as defaultLogger } from "../logger.js";
import { createHyperliquidDemoExecutionProvider } from "./executionProvider.hyperliquidDemo.js";
import { createMockExecutionProvider } from "./executionProvider.mock.js";
import { getEffectiveVaultExecutionProvider } from "./executionProvider.settings.js";
import type {
  ExecutionProvider,
  ExecutionProviderKey,
  ExecutionProviderLogger
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
    hyperliquid: () => {
      logger.warn("vault_execution_provider_not_implemented_fallback", {
        selectedProvider: "hyperliquid",
        fallbackProvider: "hyperliquid_demo"
      });
      return createHyperliquidDemoExecutionProvider({ db: params.db, logger });
    }
  } satisfies Record<ExecutionProviderKey, () => ExecutionProvider>;

  let lastResolvedKey: ExecutionProviderKey = normalizeProviderKey(process.env.VAULT_EXECUTION_PROVIDER) ?? "mock";
  let cachedProvider: ExecutionProvider | null = null;
  let cachedProviderKey: ExecutionProviderKey | null = null;

  async function resolveProvider(): Promise<ExecutionProvider> {
    const selected = await getEffectiveVaultExecutionProvider(params.db).catch(() => {
      return normalizeProviderKey(process.env.VAULT_EXECUTION_PROVIDER) ?? "mock";
    });
    lastResolvedKey = selected;
    if (!cachedProvider || cachedProviderKey !== selected) {
      cachedProvider = providerFactories[selected]();
      cachedProviderKey = selected;
    }
    return cachedProvider;
  }

  return {
    get key() {
      return lastResolvedKey;
    },
    async createUserVault(input) {
      return (await resolveProvider()).createUserVault(input);
    },
    async createBotExecutionUnit(input) {
      return (await resolveProvider()).createBotExecutionUnit(input);
    },
    async assignAgent(input) {
      return (await resolveProvider()).assignAgent(input);
    },
    async startBotExecution(input) {
      return (await resolveProvider()).startBotExecution(input);
    },
    async pauseBotExecution(input) {
      return (await resolveProvider()).pauseBotExecution(input);
    },
    async setBotCloseOnly(input) {
      return (await resolveProvider()).setBotCloseOnly(input);
    },
    async closeBotExecution(input) {
      return (await resolveProvider()).closeBotExecution(input);
    },
    async getBotExecutionState(input) {
      return (await resolveProvider()).getBotExecutionState(input);
    }
  };
}
