export type ExecutionProviderKey = "mock" | "hyperliquid_demo" | "hyperliquid";

export type BotExecutionStatus =
  | "created"
  | "running"
  | "paused"
  | "close_only"
  | "closed"
  | "error";

export type BotExecutionPosition = {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnlUsd: number | null;
};

export type BotExecutionState = {
  status: BotExecutionStatus;
  equityUsd: number | null;
  freeUsd: number | null;
  usedMarginUsd: number | null;
  positions: BotExecutionPosition[];
  providerMetadata?: Record<string, unknown>;
  observedAt: string;
};

export interface ExecutionProvider {
  readonly key: ExecutionProviderKey;

  createUserVault(input: {
    userId: string;
    masterVaultId: string;
    preferredLabel?: string;
  }): Promise<{ providerVaultId?: string | null; vaultAddress?: string | null }>;

  createBotExecutionUnit(input: {
    userId: string;
    botVaultId: string;
    masterVaultId: string;
    templateId: string;
    gridInstanceId: string;
    symbol: string;
    exchange: string;
  }): Promise<{ providerUnitId?: string | null; vaultAddress?: string | null }>;

  assignAgent(input: {
    userId: string;
    botVaultId: string;
    agentWalletHint?: string | null;
  }): Promise<{ agentWallet?: string | null }>;

  startBotExecution(input: { userId: string; botVaultId: string }): Promise<{ ok: true }>;
  pauseBotExecution(input: { userId: string; botVaultId: string }): Promise<{ ok: true }>;
  setBotCloseOnly(input: { userId: string; botVaultId: string }): Promise<{ ok: true }>;
  closeBotExecution(input: { userId: string; botVaultId: string }): Promise<{ ok: true }>;

  getBotExecutionState(input: {
    userId: string;
    botVaultId: string;
  }): Promise<BotExecutionState>;
}

export type ExecutionSafeResult<T> =
  | { ok: true; providerKey: ExecutionProviderKey; data: T }
  | { ok: false; providerKey: ExecutionProviderKey; reason: string };

export type ExecutionProviderLogger = {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
};
