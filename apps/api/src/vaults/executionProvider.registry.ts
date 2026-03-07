import { logger as defaultLogger } from "../logger.js";
import { createMockExecutionProvider } from "./executionProvider.mock.js";
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
  if (key === "hyperliquid") return "hyperliquid";
  return null;
}

export function createExecutionProvider(params: CreateExecutionProviderParams): ExecutionProvider {
  const selected = normalizeProviderKey(process.env.VAULT_EXECUTION_PROVIDER) ?? "mock";
  const logger = params.logger ?? defaultLogger;

  if (selected === "mock") {
    return createMockExecutionProvider();
  }

  logger.warn("vault_execution_provider_not_implemented_fallback", {
    selectedProvider: selected,
    fallbackProvider: "mock"
  });
  return createMockExecutionProvider();
}
