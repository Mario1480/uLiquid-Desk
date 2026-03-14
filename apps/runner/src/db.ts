import { prisma } from "@mm/db";
import type { TradeIntent } from "@mm/futures-core";
import type { RunnerDecisionTrace } from "./runtime/decisionTrace.js";
import { getRunnerDefaultPaperBalanceUsd } from "./runtime/paperExecution.js";
import { decryptSecret } from "./secret-crypto.js";

const db = prisma as any;
const PAPER_EXCHANGE = "paper";
const PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX = "paper.marketDataAccount:";
const PAPER_STATE_KEY_PREFIX = "paper.state:";
const EXECUTION_MODE_STATE_KEY_PREFIX = "runner.execution.modeState.v1:";
const GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY = "admin.vaultExecutionMode.v1";
const GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY = "admin.vaultSafetyControls.v1";
const DEFAULT_PAPER_BALANCE_USD = getRunnerDefaultPaperBalanceUsd();
const RUNNER_SAFETY_CACHE_MS = Math.max(250, Number(process.env.RUNNER_VAULT_SAFETY_CACHE_MS ?? "2000"));

export type BotStatusValue = "running" | "stopped" | "error";

export type ActiveFuturesBot = {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  exchange: string;
  exchangeAccountId: string;
  strategyKey: string;
  marginMode: "isolated" | "cross";
  leverage: number;
  paramsJson: Record<string, unknown>;
  tickMs: number;
  credentials: {
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
  };
  marketData: {
    exchange: string;
    exchangeAccountId: string;
    credentials: {
      apiKey: string;
      apiSecret: string;
      passphrase: string | null;
    };
  };
  executionIdentity?: {
    exchange: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
    cacheScope: string;
    agentWallet: string;
    providerKey: string | null;
  } | null;
  botVaultExecution?: BotVaultExecutionContext | null;
};

export type VaultExecutionMode = "offchain_shadow" | "onchain_simulated" | "onchain_live";

export type BotVaultExecutionContext = {
  botVaultId: string;
  masterVaultId: string;
  gridInstanceId: string | null;
  botId: string | null;
  templateId: string;
  status: "ACTIVE" | "PAUSED" | "CLOSE_ONLY" | "CLOSED" | "ERROR" | "STOPPED";
  vaultAddress: string | null;
  agentWallet: string | null;
  agentWalletVersion: number;
  executionProvider: string | null;
  executionUnitId: string | null;
  executionStatus: string | null;
  executionLastSyncedAt: Date | null;
  executionLastError: string | null;
  executionLastErrorAt: Date | null;
  executionMetadata: Record<string, unknown> | null;
  agentSecretRef: string | null;
};

export type VaultSafetyControls = {
  haltNewOrders: boolean;
  closeOnlyAllUserIds: string[];
  updatedByUserId: string | null;
  updatedAt: string | null;
  reason: string | null;
};

export type BotRuntimeCircuitBreakerState = {
  consecutiveErrors: number;
  errorWindowStartAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

export type PredictionGateState = {
  id: string;
  exchange: string;
  accountId: string;
  userId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  signal: "up" | "down" | "neutral";
  expectedMovePct?: number | null;
  confidence: number;
  tags: string[];
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitPrice?: number | null;
  tsUpdated: Date;
};

export type BotTradeState = {
  botId: string;
  symbol: string;
  lastPredictionHash: string | null;
  lastSignal: "up" | "down" | "neutral" | null;
  lastSignalTs: Date | null;
  lastTradeTs: Date | null;
  dailyTradeCount: number;
  dailyResetUtc: Date;
  openSide: "long" | "short" | null;
  openQty: number | null;
  openEntryPrice: number | null;
  openTs: Date | null;
};

export type BotTradeHistoryCloseOutcome =
  | "tp_hit"
  | "sl_hit"
  | "signal_exit"
  | "manual_exit"
  | "time_stop"
  | "unknown";

export type GridBotInstanceStateValue = "created" | "running" | "paused" | "stopped" | "archived" | "error";

export type GridBotInstanceRuntime = {
  id: string;
  botId: string;
  templateId: string;
  state: GridBotInstanceStateValue;
  archivedAt: Date | null;
  archivedReason: string | null;
  mode: "long" | "short" | "neutral" | "cross";
  gridMode: "arithmetic" | "geometric";
  allocationMode: "EQUAL_NOTIONAL_PER_GRID" | "EQUAL_BASE_QTY_PER_GRID" | "WEIGHTED_NEAR_PRICE";
  budgetSplitPolicy: "FIXED_50_50" | "FIXED_CUSTOM" | "DYNAMIC_BY_PRICE_POSITION";
  longBudgetPct: number;
  shortBudgetPct: number;
  marginPolicy: "MANUAL_ONLY" | "AUTO_ALLOWED";
  marginMode: "MANUAL" | "AUTO";
  autoMarginMaxUSDT: number | null;
  autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW" | "MARGIN_RATIO_ABOVE" | null;
  autoMarginTriggerValue: number | null;
  autoMarginStepUSDT: number | null;
  autoMarginCooldownSec: number | null;
  initialSeedEnabled: boolean;
  initialSeedPct: number;
  activeOrderWindowSize: number;
  recenterDriftLevels: number;
  autoMarginUsedUSDT: number;
  lastAutoMarginAt: Date | null;
  symbol: string;
  marketType: string;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  investUsd: number;
  leverage: number;
  extraMarginUsd: number;
  triggerPrice: number | null;
  slippagePct: number;
  tpPct: number | null;
  slPrice: number | null;
  autoMarginEnabled: boolean;
  stateJson: Record<string, unknown>;
  metricsJson: Record<string, unknown>;
};

export type GridBotOpenOrder = {
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  gridLeg?: "long" | "short" | null;
  gridIndex?: number | null;
  intentType?: "entry" | "tp" | "sl" | "rebalance" | null;
  side?: "buy" | "sell" | null;
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean | null;
  status?: string | null;
};

export type GridBotOrderMapRef = {
  gridLeg: "long" | "short";
  gridIndex: number;
  intentType: "entry" | "tp" | "sl" | "rebalance";
  reduceOnly: boolean;
};

export type BotExecutionEventWrite = {
  userId: string;
  botVaultId: string;
  gridInstanceId?: string | null;
  botId?: string | null;
  providerKey?: string | null;
  executionUnitId?: string | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  result: "succeeded" | "failed";
  reason?: string | null;
  sourceKey: string;
  metadata?: Record<string, unknown> | null;
};

export type OpenBotTradeHistoryEntry = {
  id: string;
  side: "long" | "short";
  tpPrice: number | null;
  slPrice: number | null;
};

export type RiskEventType =
  | "SIGNAL_DECISION"
  | "EXECUTION_DECISION"
  | "EXECUTION_GUARD_BLOCK"
  | "EXECUTION_MODE_STATE_UPDATED"
  | "PLUGIN_LOAD_ERROR"
  | "PLUGIN_RUNTIME_ERROR"
  | "PLUGIN_DISABLED_BY_POLICY"
  | "PLUGIN_FALLBACK_USED"
  | "KILL_SWITCH_BLOCK"
  | "CIRCUIT_BREAKER_TRIPPED"
  | "BOT_ERROR"
  | "PREDICTION_GATE_BLOCK"
  | "PREDICTION_GATE_ALLOW"
  | "PREDICTION_GATE_FAIL_OPEN"
  | "PREDICTION_COPIER_DECISION"
  | "PREDICTION_COPIER_TRADE"
  | "GRID_PLANNER_UNAVAILABLE"
  | "GRID_AUTO_MARGIN_ADDED"
  | "GRID_AUTO_MARGIN_BLOCKED"
  | "GRID_PLAN_BLOCKED"
  | "GRID_PLAN_APPLIED"
  | "GRID_TERMINATED"
  | "prediction_source_resolved"
  | "prediction_source_missing"
  | "legacy_source_fallback";

type RunnerPaperPosition = {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  openedAt: string;
  updatedAt: string;
};

type RunnerPaperOrder = {
  orderId: string;
  clientOrderId?: string | null;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price: number;
  reduceOnly: boolean;
  triggerPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type RunnerPaperState = {
  balanceUsd: number;
  realizedPnlUsd: number;
  nextOrderSeq: number;
  positions: RunnerPaperPosition[];
  orders: RunnerPaperOrder[];
  updatedAt: string;
};

function normalizeSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as any).code ?? "") : "";
  const message = "message" in error ? String((error as any).message ?? "") : String(error);
  if (code === "P2021") return true;
  return /table .* does not exist/i.test(message) || /relation .* does not exist/i.test(message);
}

async function ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

function normalizeStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (direct) return direct;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function toPaperStateRecord(value: unknown): Record<string, unknown> {
  const direct = parseRecord(value);
  if (!direct) return {};
  const nested =
    parseRecord(direct.paperState) ??
    parseRecord(direct.state) ??
    parseRecord(direct.payload) ??
    null;
  const directLooksLikePaperState =
    "balanceUsd" in direct ||
    "realizedPnlUsd" in direct ||
    "nextOrderSeq" in direct ||
    Array.isArray(direct.positions) ||
    Array.isArray(direct.orders);
  if (directLooksLikePaperState || !nested) return direct;
  return nested;
}

function pickNumber(snapshot: Record<string, unknown> | null, keys: string[]): number | null {
  if (!snapshot) return null;
  const readPathValue = (obj: Record<string, unknown>, key: string): unknown => {
    if (!key.includes(".")) return obj[key];
    let cursor: unknown = obj;
    for (const part of key.split(".")) {
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
  };

  for (const key of keys) {
    const parsed = Number(readPathValue(snapshot, key));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeUtcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function normalizeExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeVaultExecutionMode(value: unknown): VaultExecutionMode | null {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "offchain_shadow") return "offchain_shadow";
  if (mode === "onchain_simulated") return "onchain_simulated";
  if (mode === "onchain_live") return "onchain_live";
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function parseVaultSafetyControls(value: unknown): VaultSafetyControls {
  const record = asRecord(value);
  return {
    haltNewOrders: record?.haltNewOrders === true,
    closeOnlyAllUserIds: toStringArray(record?.closeOnlyAllUserIds),
    updatedByUserId: typeof record?.updatedByUserId === "string" && record.updatedByUserId.trim()
      ? record.updatedByUserId.trim()
      : null,
    updatedAt: typeof record?.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : null,
    reason: typeof record?.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : null
  };
}

let vaultSafetyControlsCache: { expiresAt: number; value: VaultSafetyControls } | null = null;

function resolveDefaultVaultExecutionMode(envValue: unknown = process.env.VAULT_EXECUTION_MODE): VaultExecutionMode {
  return normalizeVaultExecutionMode(envValue) ?? "offchain_shadow";
}

function normalizeBotVaultStatus(value: unknown): BotVaultExecutionContext["status"] {
  const status = String(value ?? "").trim().toUpperCase();
  if (status === "PAUSED") return "PAUSED";
  if (status === "CLOSE_ONLY") return "CLOSE_ONLY";
  if (status === "CLOSED") return "CLOSED";
  if (status === "ERROR") return "ERROR";
  if (status === "STOPPED") return "STOPPED";
  return "ACTIVE";
}

function getPaperMarketDataSettingKey(exchangeAccountId: string): string {
  return `${PAPER_MARKET_DATA_ACCOUNT_KEY_PREFIX}${exchangeAccountId}`;
}

function getPaperStateKey(exchangeAccountId: string): string {
  return `${PAPER_STATE_KEY_PREFIX}${exchangeAccountId}`;
}

function getExecutionModeStateKey(botId: string): string {
  return `${EXECUTION_MODE_STATE_KEY_PREFIX}${botId}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function decodeCredentials(row: {
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
}) {
  return {
    apiKey: decryptSecret(row.apiKeyEnc),
    apiSecret: decryptSecret(row.apiSecretEnc),
    passphrase: row.passphraseEnc ? decryptSecret(row.passphraseEnc) : null
  };
}

async function resolvePaperMarketDataAccountId(exchangeAccountId: string): Promise<string | null> {
  const row = await db.globalSetting.findUnique({
    where: {
      key: getPaperMarketDataSettingKey(exchangeAccountId)
    },
    select: {
      value: true
    }
  });

  if (typeof row?.value === "string" && row.value.trim()) {
    return row.value.trim();
  }

  if (row?.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    const record = row.value as Record<string, unknown>;
    const candidate = record.exchangeAccountId ?? record.accountId ?? record.id;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function mapBotVaultExecutionRow(row: any): BotVaultExecutionContext | null {
  if (!row?.id || !row?.masterVaultId || !row?.templateId) return null;
  if (!row?.gridInstanceId && !row?.botId) return null;
  const metadata = asRecord(row.executionMetadata);
  const secretRefRaw = metadata && typeof metadata.agentSecretRef === "string"
    ? metadata.agentSecretRef.trim()
    : "";
  return {
    botVaultId: String(row.id),
    masterVaultId: String(row.masterVaultId),
    gridInstanceId: row.gridInstanceId ? String(row.gridInstanceId) : null,
    botId: row.botId ? String(row.botId) : null,
    templateId: String(row.templateId),
    status: normalizeBotVaultStatus(row.status),
    vaultAddress: typeof row.vaultAddress === "string" && row.vaultAddress.trim()
      ? row.vaultAddress.trim()
      : null,
    agentWallet: typeof row.agentWallet === "string" && row.agentWallet.trim()
      ? row.agentWallet.trim()
      : null,
    agentWalletVersion: Number.isFinite(Number(row.agentWalletVersion))
      ? Math.max(1, Math.trunc(Number(row.agentWalletVersion)))
      : 1,
    executionProvider: typeof row.executionProvider === "string" && row.executionProvider.trim()
      ? row.executionProvider.trim()
      : null,
    executionUnitId: typeof row.executionUnitId === "string" && row.executionUnitId.trim()
      ? row.executionUnitId.trim()
      : null,
    executionStatus: typeof row.executionStatus === "string" && row.executionStatus.trim()
      ? row.executionStatus.trim()
      : null,
    executionLastSyncedAt: row.executionLastSyncedAt instanceof Date
      ? row.executionLastSyncedAt
      : row.executionLastSyncedAt ? new Date(row.executionLastSyncedAt) : null,
    executionLastError: typeof row.executionLastError === "string" && row.executionLastError.trim()
      ? row.executionLastError.trim()
      : null,
    executionLastErrorAt: row.executionLastErrorAt instanceof Date
      ? row.executionLastErrorAt
      : row.executionLastErrorAt ? new Date(row.executionLastErrorAt) : null,
    executionMetadata: metadata,
    agentSecretRef: (typeof row.agentSecretRef === "string" && row.agentSecretRef.trim()
      ? row.agentSecretRef.trim()
      : secretRefRaw) || null
  };
}

function coercePaperState(value: unknown): RunnerPaperState {
  const record = toPaperStateRecord(value);
  const positionsRaw = Array.isArray(record.positions)
    ? record.positions
    : Array.isArray(record.openPositions)
      ? record.openPositions
      : [];
  const ordersRaw = Array.isArray(record.orders)
    ? record.orders
    : Array.isArray(record.openOrders)
      ? record.openOrders
      : [];

  const positions: RunnerPaperPosition[] = [];
  for (const row of positionsRaw) {
    const item = asRecord(row);
    const symbol = normalizeSymbol(String(item?.symbol ?? ""));
    const sideRaw = String(item?.side ?? "").trim().toLowerCase();
    const side: "long" | "short" | null = sideRaw === "long" || sideRaw === "short" ? sideRaw : null;
    const qty = Math.abs(toNumber(item?.qty) ?? 0);
    const entryPrice = toNumber(item?.entryPrice) ?? 0;
    if (!symbol || !side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      continue;
    }
    positions.push({
      symbol,
      side,
      qty,
      entryPrice,
      takeProfitPrice: toPositiveNumber(item?.takeProfitPrice),
      stopLossPrice: toPositiveNumber(item?.stopLossPrice),
      openedAt: typeof item?.openedAt === "string" ? item.openedAt : new Date().toISOString(),
      updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : new Date().toISOString()
    });
  }

  const orders: RunnerPaperOrder[] = [];
  for (const row of ordersRaw) {
    const item = asRecord(row);
    const orderId = String(item?.orderId ?? "").trim();
    const symbol = normalizeSymbol(String(item?.symbol ?? ""));
    const sideRaw = String(item?.side ?? "").trim().toLowerCase();
    const side: "buy" | "sell" | null = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : null;
    const typeRaw = String(item?.type ?? "").trim().toLowerCase();
    const type: "market" | "limit" = typeRaw === "limit" ? "limit" : "market";
    const qty = Math.abs(toNumber(item?.qty) ?? 0);
    const price = toNumber(item?.price) ?? 0;
    const statusRaw = String(item?.status ?? "").trim().toLowerCase();
    const status: "open" | "filled" | "cancelled" =
      statusRaw === "open" || statusRaw === "cancelled" ? statusRaw : "filled";
    if (!orderId || !symbol || !side || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    orders.push({
      orderId,
      clientOrderId: typeof item?.clientOrderId === "string" ? item.clientOrderId : null,
      symbol,
      side,
      type,
      qty,
      price,
      reduceOnly: Boolean(item?.reduceOnly),
      triggerPrice: toPositiveNumber(item?.triggerPrice),
      takeProfitPrice: toPositiveNumber(item?.takeProfitPrice),
      stopLossPrice: toPositiveNumber(item?.stopLossPrice),
      status,
      createdAt: typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item?.updatedAt === "string" ? item.updatedAt : new Date().toISOString()
    });
  }

  return {
    balanceUsd: Math.max(
      0,
      toNumber(record.balanceUsd ?? record.balance ?? record.walletBalanceUsd ?? record.walletBalance) ??
        DEFAULT_PAPER_BALANCE_USD
    ),
    realizedPnlUsd: toNumber(record.realizedPnlUsd ?? record.realizedPnl) ?? 0,
    nextOrderSeq: Math.max(1, Math.trunc(toNumber(record.nextOrderSeq ?? record.orderSeq ?? record.sequence) ?? 1)),
    positions,
    orders: orders.slice(0, 200),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

async function getPaperState(exchangeAccountId: string): Promise<RunnerPaperState> {
  const row = await db.globalSetting.findUnique({
    where: {
      key: getPaperStateKey(exchangeAccountId)
    },
    select: {
      value: true
    }
  });
  return coercePaperState(row?.value);
}

async function savePaperState(exchangeAccountId: string, state: RunnerPaperState): Promise<RunnerPaperState> {
  const payload: RunnerPaperState = {
    ...state,
    orders: state.orders.slice(0, 200),
    updatedAt: new Date().toISOString()
  };
  await db.globalSetting.upsert({
    where: {
      key: getPaperStateKey(exchangeAccountId)
    },
    update: {
      value: payload
    },
    create: {
      key: getPaperStateKey(exchangeAccountId),
      value: payload
    }
  });
  return payload;
}

export async function getExecutionModeState(botId: string): Promise<unknown | null> {
  const row = await db.globalSetting.findUnique({
    where: {
      key: getExecutionModeStateKey(botId)
    },
    select: {
      value: true
    }
  });
  return row?.value ?? null;
}

export async function upsertExecutionModeState(
  botId: string,
  state: Record<string, unknown>
): Promise<void> {
  await db.globalSetting.upsert({
    where: {
      key: getExecutionModeStateKey(botId)
    },
    update: {
      value: state
    },
    create: {
      key: getExecutionModeStateKey(botId),
      value: state
    }
  });
}

function toPaperOrderId(exchangeAccountId: string, seq: number): string {
  return `paper_${exchangeAccountId}_${String(seq).padStart(8, "0")}`;
}

function replacePaperPosition(
  state: RunnerPaperState,
  symbol: string,
  nextPosition: RunnerPaperPosition | null
) {
  state.positions = state.positions.filter((row) => row.symbol !== symbol);
  if (nextPosition) state.positions.push(nextPosition);
}

function signedPaperPositionQty(position: RunnerPaperPosition): number {
  return position.side === "long" ? position.qty : -position.qty;
}

function applyRunnerPaperFill(params: {
  state: RunnerPaperState;
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  reduceOnly: boolean;
  fillPrice: number;
}): { filledQty: number; realizedPnlUsd: number; nextPosition: RunnerPaperPosition | null } {
  const current = params.state.positions.find((row) => row.symbol === params.symbol) ?? null;
  const currentSignedQty = current ? signedPaperPositionQty(current) : 0;
  let deltaSignedQty = params.side === "buy" ? Math.abs(params.qty) : -Math.abs(params.qty);

  if (params.reduceOnly) {
    if (currentSignedQty === 0 || Math.sign(currentSignedQty) === Math.sign(deltaSignedQty)) {
      return {
        filledQty: 0,
        realizedPnlUsd: 0,
        nextPosition: current
      };
    }
    const maxReduceQty = Math.abs(currentSignedQty);
    deltaSignedQty = Math.sign(deltaSignedQty) * Math.min(Math.abs(deltaSignedQty), maxReduceQty);
  }

  const nextSignedQty = currentSignedQty + deltaSignedQty;
  let realizedPnlUsd = 0;

  if (current && currentSignedQty !== 0 && Math.sign(currentSignedQty) !== Math.sign(deltaSignedQty)) {
    const closedQty = Math.min(Math.abs(currentSignedQty), Math.abs(deltaSignedQty));
    const pnlPerUnit =
      current.side === "long"
        ? params.fillPrice - current.entryPrice
        : current.entryPrice - params.fillPrice;
    realizedPnlUsd = Number((closedQty * pnlPerUnit).toFixed(8));
  }

  if (nextSignedQty === 0) {
    return {
      filledQty: Number(Math.abs(deltaSignedQty).toFixed(8)),
      realizedPnlUsd,
      nextPosition: null
    };
  }

  const nextSide: "long" | "short" = nextSignedQty > 0 ? "long" : "short";
  const nextQty = Math.abs(nextSignedQty);
  const nowIso = new Date().toISOString();
  let nextEntryPrice = params.fillPrice;

  if (current && Math.sign(currentSignedQty) === Math.sign(nextSignedQty)) {
    if (Math.abs(deltaSignedQty) > 0 && Math.sign(currentSignedQty) === Math.sign(deltaSignedQty)) {
      const weightedNotional =
        current.entryPrice * Math.abs(currentSignedQty) + params.fillPrice * Math.abs(deltaSignedQty);
      nextEntryPrice = weightedNotional / (Math.abs(currentSignedQty) + Math.abs(deltaSignedQty));
    } else {
      nextEntryPrice = current.entryPrice;
    }
  }

  return {
    filledQty: Number(Math.abs(deltaSignedQty).toFixed(8)),
    realizedPnlUsd,
    nextPosition: {
      symbol: params.symbol,
      side: nextSide,
      qty: Number(nextQty.toFixed(8)),
      entryPrice: Number(nextEntryPrice.toFixed(8)),
      takeProfitPrice: current?.takeProfitPrice ?? null,
      stopLossPrice: current?.stopLossPrice ?? null,
      openedAt: current?.openedAt ?? nowIso,
      updatedAt: nowIso
    }
  };
}

export async function listPaperPositionsForRunner(params: {
  exchangeAccountId: string;
  symbol?: string;
}): Promise<Array<{
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
}>> {
  const state = await getPaperState(params.exchangeAccountId);
  const normalizedSymbol = params.symbol ? normalizeSymbol(params.symbol) : null;
  return state.positions
    .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true))
    .map((row) => ({
      symbol: row.symbol,
      side: row.side,
      size: row.qty,
      entryPrice: row.entryPrice,
      markPrice: null
    }));
}

export async function placePaperPositionForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  fillPrice: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<{ orderId: string }> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) throw new Error("paper_symbol_required");
  const qty = Math.abs(Number(params.qty));
  const fillPrice = Number(params.fillPrice);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("paper_qty_invalid");
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) throw new Error("paper_fill_price_invalid");

  const state = await getPaperState(params.exchangeAccountId);
  const existing = state.positions.find((row) => row.symbol === symbol) ?? null;
  const fill = applyRunnerPaperFill({
    state,
    symbol,
    qty,
    side: params.side === "long" ? "buy" : "sell",
    reduceOnly: false,
    fillPrice
  });
  if (fill.filledQty <= 0) {
    throw new Error("paper_fill_rejected");
  }
  state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
  state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
  if (fill.nextPosition) {
    if (params.takeProfitPrice !== undefined) {
      fill.nextPosition.takeProfitPrice = toPositiveNumber(params.takeProfitPrice);
    }
    if (params.stopLossPrice !== undefined) {
      fill.nextPosition.stopLossPrice = toPositiveNumber(params.stopLossPrice);
    }
  }
  replacePaperPosition(state, symbol, fill.nextPosition);

  const orderId = toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
  state.nextOrderSeq += 1;
  const nowIso = new Date().toISOString();
  const filledOrder: RunnerPaperOrder = {
    orderId,
    symbol,
    side: params.side === "long" ? "buy" : "sell",
    type: "market",
    qty: fill.filledQty,
    price: Number(fillPrice.toFixed(8)),
    reduceOnly: Boolean(existing && existing.side !== params.side),
    triggerPrice: null,
    takeProfitPrice: toPositiveNumber(params.takeProfitPrice),
    stopLossPrice: toPositiveNumber(params.stopLossPrice),
    status: "filled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.orders = [filledOrder, ...state.orders].slice(0, 200);
  await savePaperState(params.exchangeAccountId, state);
  return { orderId };
}

export async function closePaperPositionForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  side?: "long" | "short";
  fillPrice?: number | null;
}): Promise<{ orderId: string | null; closedQty: number }> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) throw new Error("paper_symbol_required");
  const fillPrice = Number(params.fillPrice);
  const state = await getPaperState(params.exchangeAccountId);
  const position = state.positions.find(
    (row) => row.symbol === symbol && (!params.side || row.side === params.side)
  );
  if (!position) return { orderId: null, closedQty: 0 };

  const safePrice = Number.isFinite(fillPrice) && fillPrice > 0
    ? fillPrice
    : position.entryPrice;
  const fill = applyRunnerPaperFill({
    state,
    symbol,
    qty: position.qty,
    side: position.side === "long" ? "sell" : "buy",
    reduceOnly: true,
    fillPrice: safePrice
  });
  if (fill.filledQty <= 0) return { orderId: null, closedQty: 0 };
  state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
  state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
  replacePaperPosition(state, symbol, fill.nextPosition);

  const orderId = toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
  state.nextOrderSeq += 1;
  const nowIso = new Date().toISOString();
  const filledOrder: RunnerPaperOrder = {
    orderId,
    symbol,
    side: position.side === "long" ? "sell" : "buy",
    type: "market",
    qty: fill.filledQty,
    price: Number(safePrice.toFixed(8)),
    reduceOnly: true,
    triggerPrice: null,
    takeProfitPrice: position.takeProfitPrice,
    stopLossPrice: position.stopLossPrice,
    status: "filled",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.orders = [filledOrder, ...state.orders].slice(0, 200);
  await savePaperState(params.exchangeAccountId, state);
  return { orderId, closedQty: fill.filledQty };
}

export async function placePaperLimitOrderForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  reduceOnly?: boolean;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
}): Promise<{ orderId: string }> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) throw new Error("paper_symbol_required");
  const qty = Math.abs(Number(params.qty));
  const price = Number(params.price);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("paper_qty_invalid");
  if (!Number.isFinite(price) || price <= 0) throw new Error("paper_price_invalid");

  const state = await getPaperState(params.exchangeAccountId);
  let orderId = String(params.exchangeOrderId ?? "").trim();
  if (!orderId) {
    orderId = toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
    state.nextOrderSeq += 1;
  }
  const nowIso = new Date().toISOString();
  const clientOrderId = String(params.clientOrderId ?? "").trim() || null;
  const openOrder: RunnerPaperOrder = {
    orderId,
    clientOrderId,
    symbol,
    side: params.side,
    type: "limit",
    qty: Number(qty.toFixed(8)),
    price: Number(price.toFixed(8)),
    reduceOnly: params.reduceOnly === true,
    triggerPrice: null,
    takeProfitPrice: toPositiveNumber(params.takeProfitPrice),
    stopLossPrice: toPositiveNumber(params.stopLossPrice),
    status: "open",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.orders = [openOrder, ...state.orders.filter((row) => row.orderId !== orderId)].slice(0, 200);
  await savePaperState(params.exchangeAccountId, state);
  return { orderId };
}

export async function cancelPaperOrderForRunner(params: {
  exchangeAccountId: string;
  orderId?: string | null;
  clientOrderId?: string | null;
}): Promise<{ canceled: boolean; orderId: string | null }> {
  const state = await getPaperState(params.exchangeAccountId);
  const orderId = String(params.orderId ?? "").trim();
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  const target = state.orders.find((row) => {
    if (orderId && row.orderId === orderId) return true;
    if (clientOrderId && String(row.clientOrderId ?? "") === clientOrderId) return true;
    return false;
  });
  if (!target || target.status !== "open") {
    return { canceled: false, orderId: target?.orderId ?? null };
  }
  target.status = "cancelled";
  target.updatedAt = new Date().toISOString();
  await savePaperState(params.exchangeAccountId, state);
  return { canceled: true, orderId: target.orderId };
}

export async function simulatePaperGridLimitFillsForRunner(params: {
  exchangeAccountId: string;
  symbol: string;
  markPrice: number;
  previousMarkPrice?: number | null;
  maxFillsPerTick?: number | null;
  openOrders: GridBotOpenOrder[];
}): Promise<Array<{
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  side: "buy" | "sell";
  fillPrice: number;
  fillQty: number;
  fillTs: Date;
  gridLeg: "long" | "short";
  gridIndex: number;
  intentType: "entry" | "tp" | "sl" | "rebalance";
}>> {
  const symbol = normalizeSymbol(params.symbol);
  const markPrice = Number(params.markPrice);
  const previousMarkPrice = Number(params.previousMarkPrice ?? NaN);
  const maxFillsPerTick = Number.isFinite(Number(params.maxFillsPerTick))
    ? Math.max(1, Math.min(100, Math.trunc(Number(params.maxFillsPerTick))))
    : 12;
  if (!symbol) return [];
  if (!Number.isFinite(markPrice) || markPrice <= 0) return [];

  const state = await getPaperState(params.exchangeAccountId);
  const nowIso = new Date().toISOString();
  const fills: Array<{
    exchangeOrderId: string | null;
    clientOrderId: string | null;
    side: "buy" | "sell";
    fillPrice: number;
    fillQty: number;
    fillTs: Date;
    gridLeg: "long" | "short";
    gridIndex: number;
    intentType: "entry" | "tp" | "sl" | "rebalance";
  }> = [];

  const hasPreviousMark = Number.isFinite(previousMarkPrice) && previousMarkPrice > 0;
  const moveDirection = hasPreviousMark
    ? markPrice > previousMarkPrice
      ? "up"
      : markPrice < previousMarkPrice
        ? "down"
        : "flat"
    : "unknown";

  const candidateOrders = params.openOrders
    .map((openOrder) => {
      const side: RunnerPaperOrder["side"] = openOrder.side === "sell" ? "sell" : "buy";
      const limitPrice = Number(openOrder.price ?? NaN);
      const qty = Number(openOrder.qty ?? NaN);
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) return null;
      if (!Number.isFinite(qty) || qty <= 0) return null;

      let touched = false;
      if (!hasPreviousMark || moveDirection === "flat") {
        touched = side === "buy" ? markPrice <= limitPrice : markPrice >= limitPrice;
      } else if (moveDirection === "down") {
        touched = side === "buy"
          ? limitPrice >= markPrice && limitPrice <= previousMarkPrice
          : false;
      } else if (moveDirection === "up") {
        touched = side === "sell"
          ? limitPrice <= markPrice && limitPrice >= previousMarkPrice
          : false;
      }
      if (!touched) return null;

      const traversalDistance = hasPreviousMark
        ? Math.abs(limitPrice - previousMarkPrice)
        : Math.abs(limitPrice - markPrice);
      return {
        openOrder,
        side,
        limitPrice,
        qty,
        traversalDistance
      };
    })
    .filter((entry): entry is {
      openOrder: GridBotOpenOrder;
      side: RunnerPaperOrder["side"];
      limitPrice: number;
      qty: number;
      traversalDistance: number;
    } => Boolean(entry))
    .sort((left, right) => {
      if (moveDirection === "down") {
        return right.limitPrice - left.limitPrice;
      }
      if (moveDirection === "up") {
        return left.limitPrice - right.limitPrice;
      }
      return left.traversalDistance - right.traversalDistance;
    })
    .slice(0, maxFillsPerTick);

  for (const candidate of candidateOrders) {
    const { openOrder, side, limitPrice, qty } = candidate;
    const reduceOnly = openOrder.reduceOnly === true;

    const fill = applyRunnerPaperFill({
      state,
      symbol,
      qty,
      side,
      reduceOnly,
      fillPrice: limitPrice
    });
    if (fill.filledQty <= 0) continue;

    state.realizedPnlUsd = Number((state.realizedPnlUsd + fill.realizedPnlUsd).toFixed(8));
    state.balanceUsd = Number((state.balanceUsd + fill.realizedPnlUsd).toFixed(8));
    replacePaperPosition(state, symbol, fill.nextPosition);

    const exchangeOrderId = String(openOrder.exchangeOrderId ?? "").trim() || null;
    const clientOrderId = String(openOrder.clientOrderId ?? "").trim() || null;
    const paperOrder = state.orders.find((row) => {
      if (exchangeOrderId && row.orderId === exchangeOrderId) return true;
      if (clientOrderId && String(row.clientOrderId ?? "") === clientOrderId) return true;
      return false;
    });
    const orderId = exchangeOrderId ?? paperOrder?.orderId ?? toPaperOrderId(params.exchangeAccountId, state.nextOrderSeq);
    if (!exchangeOrderId && !paperOrder) {
      state.nextOrderSeq += 1;
    }
    if (paperOrder) {
      paperOrder.status = "filled";
      paperOrder.updatedAt = nowIso;
    } else {
      const filledOrder: RunnerPaperOrder = {
        orderId,
        clientOrderId,
        symbol,
        side,
        type: "limit",
        qty: Number(fill.filledQty.toFixed(8)),
        price: Number(limitPrice.toFixed(8)),
        reduceOnly,
        triggerPrice: null,
        takeProfitPrice: null,
        stopLossPrice: null,
        status: "filled",
        createdAt: nowIso,
        updatedAt: nowIso
      };
      state.orders = [filledOrder, ...state.orders].slice(0, 200);
    }

    fills.push({
      exchangeOrderId: orderId,
      clientOrderId,
      side,
      fillPrice: Number(limitPrice.toFixed(8)),
      fillQty: Number(fill.filledQty.toFixed(8)),
      fillTs: new Date(),
      gridLeg: openOrder.gridLeg === "short" ? "short" : "long",
      gridIndex: Number.isFinite(Number(openOrder.gridIndex)) ? Math.max(0, Math.trunc(Number(openOrder.gridIndex))) : 0,
      intentType: (() => {
        const normalized = String(openOrder.intentType ?? "").trim().toLowerCase();
        if (normalized === "tp" || normalized === "sl" || normalized === "rebalance") return normalized as "tp" | "sl" | "rebalance";
        return "entry";
      })()
    });
  }

  if (fills.length > 0) {
    await savePaperState(params.exchangeAccountId, state);
  }
  return fills;
}

async function resolveMarketDataForBot(bot: any): Promise<{
  exchange: string;
  exchangeAccountId: string;
  credentials: {
    apiKey: string;
    apiSecret: string;
    passphrase: string | null;
  };
}> {
  const exchange = normalizeExchange(bot.exchange);
  if (exchange !== PAPER_EXCHANGE) {
    return {
      exchange,
      exchangeAccountId: String(bot.exchangeAccount?.id ?? bot.exchangeAccountId ?? ""),
      credentials: decodeCredentials(bot.exchangeAccount)
    };
  }

  const paperAccountId = String(bot.exchangeAccount?.id ?? bot.exchangeAccountId ?? "");
  const linkedId = await resolvePaperMarketDataAccountId(paperAccountId);
  if (!linkedId) {
    throw new Error("paper_market_data_account_missing");
  }

  const linked = await db.exchangeAccount.findFirst({
    where: {
      id: linkedId,
      userId: bot.userId
    },
    select: {
      id: true,
      exchange: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true
    }
  });
  if (!linked) {
    throw new Error("paper_market_data_account_not_found");
  }
  const linkedExchange = normalizeExchange(linked.exchange);
  if (linkedExchange === PAPER_EXCHANGE) {
    throw new Error("paper_market_data_account_invalid");
  }

  return {
    exchange: linkedExchange,
    exchangeAccountId: linked.id,
    credentials: decodeCredentials(linked)
  };
}

async function mapRowToActiveBot(bot: any): Promise<ActiveFuturesBot> {
  const executionCredentials = decodeCredentials(bot.exchangeAccount);
  const marketData = await resolveMarketDataForBot(bot);
  const botVaultExecution = mapBotVaultExecutionRow(bot?.botVault ?? bot?.gridInstance?.botVault);
  return {
    id: bot.id,
    userId: bot.userId,
    name: bot.name,
    symbol: bot.symbol,
    exchange: bot.exchange,
    exchangeAccountId: bot.exchangeAccountId,
    strategyKey: bot.futuresConfig.strategyKey,
    marginMode: bot.futuresConfig.marginMode,
    leverage: bot.futuresConfig.leverage,
    paramsJson: (bot.futuresConfig.paramsJson ?? {}) as Record<string, unknown>,
    tickMs: bot.futuresConfig?.tickMs ?? 1000,
    credentials: executionCredentials,
    marketData,
    executionIdentity: null,
    botVaultExecution
  };
}

function canExecuteRow(bot: any): boolean {
  return Boolean(
    bot
    && bot.userId
    && bot.exchangeAccountId
    && bot.futuresConfig
    && bot.exchangeAccount
  );
}

export async function getBotStatus(botId: string): Promise<BotStatusValue | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    select: { status: true }
  });
  if (!bot) return null;
  return bot.status as BotStatusValue;
}

export async function getBotRuntimeCircuitBreakerState(
  botId: string
): Promise<BotRuntimeCircuitBreakerState> {
  const runtime = await db.botRuntime.findUnique({
    where: { botId },
    select: {
      consecutiveErrors: true,
      errorWindowStartAt: true,
      lastErrorAt: true,
      lastErrorMessage: true
    }
  });

  return {
    consecutiveErrors: Number(runtime?.consecutiveErrors ?? 0),
    errorWindowStartAt: runtime?.errorWindowStartAt ?? null,
    lastErrorAt: runtime?.lastErrorAt ?? null,
    lastErrorMessage: runtime?.lastErrorMessage ?? null
  };
}

export async function loadBotForExecution(botId: string): Promise<ActiveFuturesBot | null> {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      },
      botVault: {
        select: {
          id: true,
          masterVaultId: true,
          templateId: true,
          gridInstanceId: true,
          botId: true,
          status: true,
          vaultAddress: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          executionProvider: true,
          executionUnitId: true,
          executionStatus: true,
          executionLastSyncedAt: true,
          executionLastError: true,
          executionLastErrorAt: true,
          executionMetadata: true
        }
      },
      gridInstance: {
        select: {
          id: true,
          botVault: {
            select: {
              id: true,
              masterVaultId: true,
              templateId: true,
              gridInstanceId: true,
              botId: true,
              status: true,
              vaultAddress: true,
              agentWallet: true,
              agentWalletVersion: true,
              agentSecretRef: true,
              executionProvider: true,
              executionUnitId: true,
              executionStatus: true,
              executionLastSyncedAt: true,
              executionLastError: true,
              executionLastErrorAt: true,
              executionMetadata: true
            }
          }
        }
      }
    }
  });

  if (!bot || !canExecuteRow(bot)) return null;
  try {
    return await mapRowToActiveBot(bot);
  } catch {
    return null;
  }
}

export async function loadActiveFuturesBots(): Promise<ActiveFuturesBot[]> {
  const bots = await db.bot.findMany({
    where: {
      status: "running",
      userId: { not: null },
      exchangeAccountId: { not: null },
      futuresConfig: { isNot: null }
    },
    include: {
      futuresConfig: {
        select: {
          strategyKey: true,
          marginMode: true,
          leverage: true,
          tickMs: true,
          paramsJson: true
        }
      },
      exchangeAccount: {
        select: {
          id: true,
          apiKeyEnc: true,
          apiSecretEnc: true,
          passphraseEnc: true
        }
      },
      botVault: {
        select: {
          id: true,
          masterVaultId: true,
          templateId: true,
          gridInstanceId: true,
          botId: true,
          status: true,
          vaultAddress: true,
          agentWallet: true,
          agentWalletVersion: true,
          agentSecretRef: true,
          executionProvider: true,
          executionUnitId: true,
          executionStatus: true,
          executionLastSyncedAt: true,
          executionLastError: true,
          executionLastErrorAt: true,
          executionMetadata: true
        }
      },
      gridInstance: {
        select: {
          id: true,
          botVault: {
            select: {
              id: true,
              masterVaultId: true,
              templateId: true,
              gridInstanceId: true,
              botId: true,
              status: true,
              vaultAddress: true,
              agentWallet: true,
              agentWalletVersion: true,
              agentSecretRef: true,
              executionProvider: true,
              executionUnitId: true,
              executionStatus: true,
              executionLastSyncedAt: true,
              executionLastError: true,
              executionLastErrorAt: true,
              executionMetadata: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const out: ActiveFuturesBot[] = [];
  for (const bot of (bots as any[]).filter(canExecuteRow)) {
    try {
      out.push(await mapRowToActiveBot(bot));
    } catch {
      // Skip bots with incomplete or invalid market-data mapping.
    }
  }
  return out;
}

export async function getEffectiveVaultExecutionMode(): Promise<VaultExecutionMode> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY },
    select: { value: true }
  });
  const storedMode =
    row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? normalizeVaultExecutionMode((row.value as Record<string, unknown>).mode)
      : null;
  return storedMode ?? resolveDefaultVaultExecutionMode();
}

export async function getVaultSafetyControls(forceRefresh = false): Promise<VaultSafetyControls> {
  const now = Date.now();
  if (!forceRefresh && vaultSafetyControlsCache && vaultSafetyControlsCache.expiresAt > now) {
    return vaultSafetyControlsCache.value;
  }
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY },
    select: { value: true }
  });
  const parsed = parseVaultSafetyControls(row?.value);
  vaultSafetyControlsCache = {
    expiresAt: now + RUNNER_SAFETY_CACHE_MS,
    value: parsed
  };
  return parsed;
}

export function isOnchainVaultExecutionMode(mode: VaultExecutionMode): boolean {
  return mode === "onchain_simulated" || mode === "onchain_live";
}

function readRequestedExecutionMode(paramsJson: unknown): string {
  const root = paramsJson && typeof paramsJson === "object" && !Array.isArray(paramsJson)
    ? paramsJson as Record<string, unknown>
    : {};
  const execution = root.execution && typeof root.execution === "object" && !Array.isArray(root.execution)
    ? root.execution as Record<string, unknown>
    : {};
  return String(execution.mode ?? "").trim().toLowerCase() || "simple";
}

export function isBotVaultRunnerManaged(bot: ActiveFuturesBot, mode: VaultExecutionMode): boolean {
  if (!isOnchainVaultExecutionMode(mode)) return false;
  if (normalizeExchange(bot.exchange) !== "hyperliquid") return false;
  const vault = bot.botVaultExecution;
  if (!vault?.botVaultId || (!vault.gridInstanceId && !vault.botId)) return false;
  const executionMode = readRequestedExecutionMode(bot.paramsJson);
  const supportedStrategy = bot.strategyKey === "futures_grid"
    || bot.strategyKey === "prediction_copier"
    || executionMode === "dca";
  if (!supportedStrategy) return false;
  if (vault.status === "CLOSED") return false;
  const executionStatus = String(vault.executionStatus ?? "").trim().toLowerCase();
  if (executionStatus === "closed") return false;
  return true;
}

export async function loadActiveBotVaultExecutions(): Promise<ActiveFuturesBot[]> {
  const bots = await loadActiveFuturesBots();
  const mode = await getEffectiveVaultExecutionMode();
  return bots.filter((bot) => isBotVaultRunnerManaged(bot, mode));
}

export async function loadLatestPredictionStateForGate(params: {
  userId: string;
  exchange: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: "spot" | "perp";
  timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
}): Promise<PredictionGateState | null> {
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) return null;

  const exchangeVariants = Array.from(
    new Set([
      params.exchange,
      params.exchange.toLowerCase(),
      params.exchange.toUpperCase()
    ].map((entry) => entry.trim()).filter(Boolean))
  );

  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      accountId: params.exchangeAccountId,
      symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      ...(exchangeVariants.length > 0 ? { exchange: { in: exchangeVariants } } : {})
    },
    orderBy: [{ tsUpdated: "desc" }],
    select: {
      id: true,
      exchange: true,
      accountId: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      tags: true,
      featuresSnapshot: true,
      tsUpdated: true
    }
  });

  return mapPredictionStateRowToGateState(row);
}

function mapPredictionStateRowToGateState(row: any): PredictionGateState | null {
  if (!row) return null;
  const signalRaw = String(row.signal ?? "").trim().toLowerCase();
  const signal: PredictionGateState["signal"] =
    signalRaw === "up" || signalRaw === "down" ? signalRaw : "neutral";
  const marketTypeRaw = String(row.marketType ?? "").trim().toLowerCase();
  const marketType: PredictionGateState["marketType"] =
    marketTypeRaw === "spot" ? "spot" : "perp";
  const timeframeRaw = String(row.timeframe ?? "").trim();
  if (
    timeframeRaw !== "5m" &&
    timeframeRaw !== "15m" &&
    timeframeRaw !== "1h" &&
    timeframeRaw !== "4h" &&
    timeframeRaw !== "1d"
  ) {
    return null;
  }

  const snapshot = asRecord(row.featuresSnapshot);
  const entryPriceRaw = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "entry",
    "tracking.entryPrice",
    "levels.entryPrice"
  ]);
  const stopLossPriceRaw = pickNumber(snapshot, [
    "suggestedStopLoss",
    "stopLoss",
    "stopLossPrice",
    "slPrice",
    "sl",
    "tracking.stopLossPrice",
    "tracking.stopLoss",
    "levels.stopLossPrice",
    "levels.stopLoss"
  ]);
  const takeProfitPriceRaw = pickNumber(snapshot, [
    "suggestedTakeProfit",
    "takeProfit",
    "takeProfitPrice",
    "tpPrice",
    "tp",
    "tracking.takeProfitPrice",
    "tracking.takeProfit",
    "levels.takeProfitPrice",
    "levels.takeProfit"
  ]);
  const entryPrice = entryPriceRaw !== null && entryPriceRaw > 0 ? entryPriceRaw : null;
  const stopLossPrice = stopLossPriceRaw !== null && stopLossPriceRaw > 0 ? stopLossPriceRaw : null;
  const takeProfitPrice = takeProfitPriceRaw !== null && takeProfitPriceRaw > 0 ? takeProfitPriceRaw : null;

  return {
    id: row.id,
    exchange: String(row.exchange ?? ""),
    accountId: String(row.accountId ?? ""),
    userId: String(row.userId ?? ""),
    symbol: normalizeSymbol(String(row.symbol ?? "")),
    marketType,
    timeframe: timeframeRaw,
    signal,
    expectedMovePct: Number.isFinite(Number(row.expectedMovePct)) ? Number(row.expectedMovePct) : null,
    confidence: Number(row.confidence ?? 0),
    tags: normalizeStringArray(row.tags, 10),
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    tsUpdated: row.tsUpdated
  };
}

export async function loadPredictionStateByIdForGate(params: {
  userId: string;
  exchangeAccountId: string;
  stateId: string;
}): Promise<PredictionGateState | null> {
  const stateId = String(params.stateId ?? "").trim();
  if (!stateId) return null;
  const row = await db.predictionState.findFirst({
    where: {
      id: stateId,
      userId: params.userId,
      accountId: params.exchangeAccountId
    },
    select: {
      id: true,
      exchange: true,
      accountId: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      tags: true,
      featuresSnapshot: true,
      tsUpdated: true
    }
  });
  return mapPredictionStateRowToGateState(row);
}

function toGridMode(value: unknown): GridBotInstanceRuntime["mode"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "short" || normalized === "neutral" || normalized === "cross") return normalized;
  return "long";
}

function toGridPriceMode(value: unknown): GridBotInstanceRuntime["gridMode"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "geometric" ? "geometric" : "arithmetic";
}

function toGridAllocationMode(value: unknown): GridBotInstanceRuntime["allocationMode"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "EQUAL_BASE_QTY_PER_GRID") return "EQUAL_BASE_QTY_PER_GRID";
  if (normalized === "WEIGHTED_NEAR_PRICE") return "WEIGHTED_NEAR_PRICE";
  return "EQUAL_NOTIONAL_PER_GRID";
}

function toGridBudgetSplitPolicy(value: unknown): GridBotInstanceRuntime["budgetSplitPolicy"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "FIXED_CUSTOM") return "FIXED_CUSTOM";
  if (normalized === "DYNAMIC_BY_PRICE_POSITION") return "DYNAMIC_BY_PRICE_POSITION";
  return "FIXED_50_50";
}

function toGridMarginPolicy(value: unknown): GridBotInstanceRuntime["marginPolicy"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "AUTO_ALLOWED" ? "AUTO_ALLOWED" : "MANUAL_ONLY";
}

function toGridInstanceMarginMode(value: unknown): GridBotInstanceRuntime["marginMode"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "AUTO" ? "AUTO" : "MANUAL";
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export async function loadGridBotInstanceByBotId(botId: string): Promise<GridBotInstanceRuntime | null> {
  const dbAny = db as any;
  const row: any = await ignoreMissingTable(() => dbAny.gridBotInstance.findFirst({
    where: { botId },
    select: {
      id: true,
      botId: true,
      templateId: true,
      state: true,
      archivedAt: true,
      archivedReason: true,
      allocationMode: true,
      budgetSplitPolicy: true,
      longBudgetPct: true,
      shortBudgetPct: true,
      marginPolicy: true,
      marginMode: true,
      autoMarginMaxUSDT: true,
      autoMarginTriggerType: true,
      autoMarginTriggerValue: true,
      autoMarginStepUSDT: true,
      autoMarginCooldownSec: true,
      initialSeedEnabled: true,
      initialSeedPct: true,
      activeOrderWindowSize: true,
      recenterDriftLevels: true,
      autoMarginUsedUSDT: true,
      lastAutoMarginAt: true,
      investUsd: true,
      leverage: true,
      extraMarginUsd: true,
      triggerPrice: true,
      slippagePct: true,
      tpPct: true,
      slPrice: true,
      autoMarginEnabled: true,
      stateJson: true,
      metricsJson: true,
      template: {
        select: {
          symbol: true,
          marketType: true,
          mode: true,
          gridMode: true,
          allocationMode: true,
          budgetSplitPolicy: true,
          longBudgetPct: true,
          shortBudgetPct: true,
          marginPolicy: true,
          autoMarginMaxUSDT: true,
          autoMarginTriggerType: true,
          autoMarginTriggerValue: true,
          autoMarginStepUSDT: true,
          autoMarginCooldownSec: true,
          initialSeedEnabled: true,
          initialSeedPct: true,
          activeOrderWindowSize: true,
          recenterDriftLevels: true,
          lowerPrice: true,
          upperPrice: true,
          gridCount: true
        }
      }
    }
  }));
  if (!row || !row.template) return null;
  return {
    id: String(row.id),
    botId: String(row.botId),
    templateId: String(row.templateId),
    state: String(row.state ?? "created").toLowerCase() as GridBotInstanceStateValue,
    archivedAt: row.archivedAt instanceof Date ? row.archivedAt : row.archivedAt ? new Date(row.archivedAt) : null,
    archivedReason: typeof row.archivedReason === "string" && row.archivedReason.trim().length > 0 ? row.archivedReason.trim() : null,
    mode: toGridMode(row.template.mode),
    gridMode: toGridPriceMode(row.template.gridMode),
    allocationMode: toGridAllocationMode(row.allocationMode ?? row.template.allocationMode),
    budgetSplitPolicy: toGridBudgetSplitPolicy(row.budgetSplitPolicy ?? row.template.budgetSplitPolicy),
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : Number(row.template.longBudgetPct ?? 50),
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : Number(row.template.shortBudgetPct ?? 50),
    marginPolicy: toGridMarginPolicy(row.marginPolicy ?? row.template.marginPolicy),
    marginMode: toGridInstanceMarginMode(row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL")),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : Number.isFinite(Number(row.template.autoMarginMaxUSDT)) ? Number(row.template.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: (() => {
      const raw = String(row.autoMarginTriggerType ?? row.template.autoMarginTriggerType ?? "").trim().toUpperCase();
      if (raw === "MARGIN_RATIO_ABOVE") return "MARGIN_RATIO_ABOVE";
      if (raw === "LIQ_DISTANCE_PCT_BELOW") return "LIQ_DISTANCE_PCT_BELOW";
      return null;
    })(),
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : Number.isFinite(Number(row.template.autoMarginTriggerValue)) ? Number(row.template.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : Number.isFinite(Number(row.template.autoMarginStepUSDT)) ? Number(row.template.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : Number.isFinite(Number(row.template.autoMarginCooldownSec)) ? Number(row.template.autoMarginCooldownSec) : null,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean"
      ? row.initialSeedEnabled
      : typeof row.template.initialSeedEnabled === "boolean"
        ? row.template.initialSeedEnabled
        : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct))
      ? Math.max(0, Math.min(60, Number(row.initialSeedPct)))
      : Number.isFinite(Number(row.template.initialSeedPct))
        ? Math.max(0, Math.min(60, Number(row.template.initialSeedPct)))
        : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize))
      ? Math.max(40, Math.min(120, Math.trunc(Number(row.activeOrderWindowSize))))
      : Number.isFinite(Number(row.template.activeOrderWindowSize))
        ? Math.max(40, Math.min(120, Math.trunc(Number(row.template.activeOrderWindowSize))))
        : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels))
      ? Math.max(1, Math.min(10, Math.trunc(Number(row.recenterDriftLevels))))
      : Number.isFinite(Number(row.template.recenterDriftLevels))
        ? Math.max(1, Math.min(10, Math.trunc(Number(row.template.recenterDriftLevels))))
        : 1,
    autoMarginUsedUSDT: Number.isFinite(Number(row.autoMarginUsedUSDT)) ? Number(row.autoMarginUsedUSDT) : 0,
    lastAutoMarginAt: row.lastAutoMarginAt instanceof Date ? row.lastAutoMarginAt : row.lastAutoMarginAt ? new Date(row.lastAutoMarginAt) : null,
    symbol: normalizeSymbol(String(row.template.symbol ?? "")),
    marketType: String(row.template.marketType ?? "perp").trim().toLowerCase() || "perp",
    lowerPrice: Number(row.template.lowerPrice ?? 0),
    upperPrice: Number(row.template.upperPrice ?? 0),
    gridCount: Math.max(2, Math.trunc(Number(row.template.gridCount ?? 2))),
    investUsd: Math.max(1, Number(row.investUsd ?? 100)),
    leverage: Math.max(1, Math.trunc(Number(row.leverage ?? 1))),
    extraMarginUsd: Math.max(0, Number(row.extraMarginUsd ?? 0)),
    triggerPrice: toNullableFiniteNumber(row.triggerPrice),
    slippagePct: Math.min(5, Math.max(0.0001, Number(row.slippagePct ?? 0.1))),
    tpPct: toNullableFiniteNumber(row.tpPct),
    slPrice: toNullableFiniteNumber(row.slPrice),
    autoMarginEnabled: Boolean(row.autoMarginEnabled),
    stateJson: asRecord(row.stateJson) ?? {},
    metricsJson: asRecord(row.metricsJson) ?? {}
  };
}

export async function updateGridBotInstancePlannerState(params: {
  instanceId: string;
  state?: GridBotInstanceStateValue;
  stateJson?: Record<string, unknown> | null;
  metricsJson?: Record<string, unknown> | null;
  lastPlanError?: string | null;
  lastPlanVersion?: string | null;
  extraMarginUsd?: number;
  autoMarginUsedUSDT?: number;
  lastAutoMarginAt?: Date | null;
}): Promise<void> {
  const dbAny = db as any;
  await ignoreMissingTable(() => dbAny.gridBotInstance.update({
    where: { id: params.instanceId },
    data: {
      ...(params.state ? { state: params.state } : {}),
      ...(params.stateJson !== undefined ? { stateJson: params.stateJson ?? null } : {}),
      ...(params.metricsJson !== undefined ? { metricsJson: params.metricsJson ?? null } : {}),
      ...(params.lastPlanError !== undefined ? { lastPlanError: params.lastPlanError ?? null } : {}),
      ...(params.lastPlanVersion !== undefined ? { lastPlanVersion: params.lastPlanVersion ?? null } : {}),
      ...(params.extraMarginUsd !== undefined ? { extraMarginUsd: params.extraMarginUsd } : {}),
      ...(params.autoMarginUsedUSDT !== undefined ? { autoMarginUsedUSDT: params.autoMarginUsedUSDT } : {}),
      ...(params.lastAutoMarginAt !== undefined ? { lastAutoMarginAt: params.lastAutoMarginAt } : {}),
      lastPlanAt: new Date()
    }
  }));
}

type BotVaultMatchingLot = {
  qty: number;
  price: number;
  feePerUnit: number;
};

type BotVaultMatchingState = {
  version: 1;
  longLots: BotVaultMatchingLot[];
  shortLots: BotVaultMatchingLot[];
};

function parseBotVaultMatchingStateForRunner(raw: unknown): BotVaultMatchingState {
  const sanitizeLots = (value: unknown): BotVaultMatchingLot[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const row = entry as Record<string, unknown>;
        const qty = Number(row.qty ?? NaN);
        const price = Number(row.price ?? NaN);
        const feePerUnit = Number(row.feePerUnit ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) return null;
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
          qty: Number(qty.toFixed(12)),
          price: Number(price.toFixed(12)),
          feePerUnit: Number((Number.isFinite(feePerUnit) && feePerUnit > 0 ? feePerUnit : 0).toFixed(12)),
        };
      })
      .filter((entry): entry is BotVaultMatchingLot => Boolean(entry));
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      version: 1,
      longLots: [],
      shortLots: [],
    };
  }
  const record = raw as Record<string, unknown>;
  return {
    version: 1,
    longLots: sanitizeLots(record.longLots),
    shortLots: sanitizeLots(record.shortLots),
  };
}

export async function seedGridBotVaultMatchingStateForGridInstance(params: {
  instanceId: string;
  side: "long" | "short";
  qty: number;
  price: number;
  feeUsd?: number | null;
}): Promise<"seeded" | "existing" | "missing"> {
  const dbAny = db as any;
  const qty = Number(params.qty ?? NaN);
  const price = Number(params.price ?? NaN);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
    return "missing";
  }

  const botVault: any | null = await ignoreMissingTable(() =>
    dbAny.botVault.findFirst({
      where: { gridInstanceId: params.instanceId },
      select: {
        id: true,
        matchingStateJson: true,
      },
    })
  );
  if (!botVault?.id) return "missing";

  const currentState = parseBotVaultMatchingStateForRunner(botVault.matchingStateJson);
  if (currentState.longLots.length > 0 || currentState.shortLots.length > 0) {
    return "existing";
  }

  const feeUsd = Number(params.feeUsd ?? 0);
  const feePerUnit = Number.isFinite(feeUsd) && feeUsd > 0 ? feeUsd / qty : 0;
  const seededLot: BotVaultMatchingLot = {
    qty: Number(qty.toFixed(12)),
    price: Number(price.toFixed(12)),
    feePerUnit: Number(feePerUnit.toFixed(12)),
  };

  const nextState: BotVaultMatchingState =
    params.side === "short"
      ? { version: 1, longLots: [], shortLots: [seededLot] }
      : { version: 1, longLots: [seededLot], shortLots: [] };

  await ignoreMissingTable(() =>
    dbAny.botVault.update({
      where: { id: botVault.id },
      data: {
        matchingStateJson: nextState,
      },
    })
  );

  return "seeded";
}

export async function archiveGridBotInstanceTerminal(params: {
  instanceId: string;
  botId: string;
  archivedReason: string;
  runtimeReason: string;
  lastPlanError?: string | null;
  stateJson?: Record<string, unknown> | null;
  metricsJson?: Record<string, unknown> | null;
}): Promise<void> {
  const dbAny = db as any;
  await dbAny.$transaction(async (tx: any) => {
    await ignoreMissingTable(() => tx.gridBotInstance.update({
      where: { id: params.instanceId },
      data: {
        state: "archived",
        archivedAt: new Date(),
        archivedReason: params.archivedReason,
        ...(params.stateJson !== undefined ? { stateJson: params.stateJson ?? null } : {}),
        ...(params.metricsJson !== undefined ? { metricsJson: params.metricsJson ?? null } : {}),
        ...(params.lastPlanError !== undefined ? { lastPlanError: params.lastPlanError ?? null } : {}),
        lastPlanAt: new Date()
      }
    }));
    await tx.bot.update({
      where: { id: params.botId },
      data: {
        status: "stopped",
        lastError: null
      }
    });
    await tx.botRuntime.upsert({
      where: { botId: params.botId },
      update: {
        status: "stopped",
        reason: params.runtimeReason,
        lastHeartbeatAt: new Date()
      },
      create: {
        botId: params.botId,
        status: "stopped",
        reason: params.runtimeReason,
        lastHeartbeatAt: new Date()
      }
    });
  });
}

export async function createGridBotOrderMapEntry(params: {
  instanceId: string;
  botId: string;
  clientOrderId: string;
  exchangeOrderId?: string | null;
  gridLeg: "long" | "short";
  gridIndex: number;
  intentType: "entry" | "tp" | "sl" | "rebalance";
  side: "buy" | "sell";
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean;
  status?: "open" | "filled" | "canceled" | "rejected";
}): Promise<void> {
  const dbAny = db as any;
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  if (!clientOrderId) return;
  await ignoreMissingTable(() => dbAny.gridBotOrderMap.upsert({
    where: {
      instanceId_clientOrderId: {
        instanceId: params.instanceId,
        clientOrderId
      }
    },
    update: {
      exchangeOrderId: params.exchangeOrderId ?? null,
      gridLeg: params.gridLeg,
      gridIndex: Math.max(0, Math.trunc(Number(params.gridIndex ?? 0))),
      intentType: params.intentType,
      side: params.side,
      price: Number.isFinite(Number(params.price)) ? Number(params.price) : null,
      qty: Number.isFinite(Number(params.qty)) ? Number(params.qty) : null,
      reduceOnly: params.reduceOnly === true,
      status: params.status ?? "open"
    },
    create: {
      instanceId: params.instanceId,
      botId: params.botId,
      exchangeOrderId: params.exchangeOrderId ?? null,
      clientOrderId,
      gridLeg: params.gridLeg,
      gridIndex: Math.max(0, Math.trunc(Number(params.gridIndex ?? 0))),
      intentType: params.intentType,
      side: params.side,
      price: Number.isFinite(Number(params.price)) ? Number(params.price) : null,
      qty: Number.isFinite(Number(params.qty)) ? Number(params.qty) : null,
      reduceOnly: params.reduceOnly === true,
      status: params.status ?? "open"
    }
  }));
}

export async function updateGridBotOrderMapStatus(params: {
  instanceId: string;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  status: "open" | "filled" | "canceled" | "rejected";
}): Promise<void> {
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  const exchangeOrderId = String(params.exchangeOrderId ?? "").trim();
  if (!clientOrderId && !exchangeOrderId) return;
  const dbAny = db as any;
  await ignoreMissingTable(() => dbAny.gridBotOrderMap.updateMany({
    where: {
      instanceId: params.instanceId,
      OR: [
        ...(clientOrderId ? [{ clientOrderId }] : []),
        ...(exchangeOrderId ? [{ exchangeOrderId }] : [])
      ]
    },
    data: {
      status: params.status,
      ...(exchangeOrderId ? { exchangeOrderId } : {})
    }
  }));
}

export async function findGridBotOrderMapByOrderRef(params: {
  instanceId: string;
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
}): Promise<GridBotOrderMapRef | null> {
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  const exchangeOrderId = String(params.exchangeOrderId ?? "").trim();
  if (!clientOrderId && !exchangeOrderId) return null;
  const dbAny = db as any;
  const row: any | null = await ignoreMissingTable(() => dbAny.gridBotOrderMap.findFirst({
    where: {
      instanceId: params.instanceId,
      OR: [
        ...(clientOrderId ? [{ clientOrderId }] : []),
        ...(exchangeOrderId ? [{ exchangeOrderId }] : [])
      ]
    },
    select: {
      gridLeg: true,
      gridIndex: true,
      intentType: true,
      reduceOnly: true
    },
    orderBy: [{ updatedAt: "desc" }]
  }));
  if (!row) return null;
  return {
    gridLeg: String(row.gridLeg ?? "").trim().toLowerCase() === "short" ? "short" : "long",
    gridIndex: Math.max(0, Math.trunc(Number(row.gridIndex ?? 0))),
    intentType: (() => {
      const normalized = String(row.intentType ?? "").trim().toLowerCase();
      if (normalized === "tp" || normalized === "sl" || normalized === "rebalance") return normalized;
      return "entry";
    })(),
    reduceOnly: row.reduceOnly === true
  };
}

export async function createGridBotFillEventEntry(params: {
  instanceId: string;
  botId: string;
  exchangeOrderId?: string | null;
  exchangeFillId?: string | null;
  clientOrderId?: string | null;
  fillPrice: number;
  fillQty: number;
  fillNotionalUsd?: number | null;
  feeUsd?: number | null;
  side: "buy" | "sell";
  gridLeg: "long" | "short";
  gridIndex: number;
  fillTs: Date;
  dedupeKey: string;
  rawJson?: Record<string, unknown> | null;
}): Promise<boolean> {
  const dbAny = db as any;
  try {
    const created = await ignoreMissingTable(() => dbAny.gridBotFillEvent.create({
      data: {
        instanceId: params.instanceId,
        botId: params.botId,
        exchangeOrderId: params.exchangeOrderId ?? null,
        exchangeFillId: params.exchangeFillId ?? null,
        clientOrderId: params.clientOrderId ?? null,
        fillPrice: params.fillPrice,
        fillQty: params.fillQty,
        fillNotionalUsd: params.fillNotionalUsd ?? null,
        feeUsd: params.feeUsd ?? null,
        side: params.side,
        gridLeg: params.gridLeg,
        gridIndex: Math.max(0, Math.trunc(Number(params.gridIndex ?? 0))),
        fillTs: params.fillTs,
        dedupeKey: params.dedupeKey,
        isAccounted: false,
        rawJson: params.rawJson ?? null
      }
    }));
    if (!created) return false;
    return true;
  } catch (error) {
    if ((error as any)?.code === "P2002") return false;
    throw error;
  }
}

export async function listGridBotOpenOrders(instanceId: string): Promise<GridBotOpenOrder[]> {
  const dbAny = db as any;
  const rows: any[] | null = await ignoreMissingTable(() => dbAny.gridBotOrderMap.findMany({
    where: {
      instanceId,
      status: "open"
    },
    select: {
      exchangeOrderId: true,
      clientOrderId: true,
      gridLeg: true,
      gridIndex: true,
      intentType: true,
      side: true,
      price: true,
      qty: true,
      reduceOnly: true,
      status: true
    },
    orderBy: [{ createdAt: "desc" }]
  }));
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    exchangeOrderId: typeof row.exchangeOrderId === "string" ? row.exchangeOrderId : null,
    clientOrderId: typeof row.clientOrderId === "string" ? row.clientOrderId : null,
    gridLeg: String(row.gridLeg ?? "").trim().toLowerCase() === "short" ? "short" : "long",
    gridIndex: Number.isFinite(Number(row.gridIndex)) ? Math.max(0, Math.trunc(Number(row.gridIndex))) : null,
    intentType: (() => {
      const normalized = String(row.intentType ?? "").trim().toLowerCase();
      if (normalized === "tp" || normalized === "sl" || normalized === "rebalance") return normalized as "tp" | "sl" | "rebalance";
      return "entry";
    })(),
    side: String(row.side ?? "").trim().toLowerCase() === "sell" ? "sell" : "buy",
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : null,
    qty: Number.isFinite(Number(row.qty)) ? Number(row.qty) : null,
    reduceOnly: row.reduceOnly === true,
    status: typeof row.status === "string" ? row.status : "open"
  }));
}

export async function updateBotVaultExecutionRuntime(params: {
  botVaultId: string;
  executionStatus?: string | null;
  executionLastSyncedAt?: Date | null;
  executionLastError?: string | null;
  executionLastErrorAt?: Date | null;
  executionMetadataPatch?: Record<string, unknown> | null;
}): Promise<void> {
  const dbAny = db as any;
  const current: any | null = await ignoreMissingTable(() => dbAny.botVault.findUnique({
    where: { id: params.botVaultId },
    select: { executionMetadata: true }
  }));
  const currentMetadata = asRecord(current?.executionMetadata) ?? {};
  const mergedMetadata = params.executionMetadataPatch
    ? { ...currentMetadata, ...params.executionMetadataPatch }
    : current?.executionMetadata;
  await ignoreMissingTable(() => dbAny.botVault.update({
    where: { id: params.botVaultId },
    data: {
      ...(params.executionStatus !== undefined ? { executionStatus: params.executionStatus ?? null } : {}),
      ...(params.executionLastSyncedAt !== undefined ? { executionLastSyncedAt: params.executionLastSyncedAt } : {}),
      ...(params.executionLastError !== undefined ? { executionLastError: params.executionLastError ?? null } : {}),
      ...(params.executionLastErrorAt !== undefined ? { executionLastErrorAt: params.executionLastErrorAt } : {}),
      ...(params.executionMetadataPatch !== undefined ? { executionMetadata: mergedMetadata } : {})
    }
  }));
}

export async function appendBotVaultExecutionEvent(params: BotExecutionEventWrite): Promise<boolean> {
  const dbAny = db as any;
  try {
    const created = await ignoreMissingTable(() => dbAny.botExecutionEvent.create({
      data: {
        userId: params.userId,
        botVaultId: params.botVaultId,
        gridInstanceId: params.gridInstanceId ?? null,
        botId: params.botId ?? null,
        providerKey: params.providerKey ?? null,
        executionUnitId: params.executionUnitId ?? null,
        action: params.action,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        result: params.result,
        reason: params.reason ?? null,
        sourceKey: params.sourceKey,
        metadata: params.metadata ?? null
      }
    }));
    return Boolean(created);
  } catch (error) {
    if ((error as any)?.code === "P2002") return false;
    throw error;
  }
}

function toBotOrderStatus(value: unknown): "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "PARTIALLY_FILLED") return "PARTIALLY_FILLED";
  if (normalized === "FILLED") return "FILLED";
  if (normalized === "CANCELED") return "CANCELED";
  if (normalized === "REJECTED") return "REJECTED";
  if (normalized === "EXPIRED") return "EXPIRED";
  return "OPEN";
}

function toBotOrderType(value: unknown): "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "STOP") return "STOP";
  if (normalized === "STOP_LIMIT") return "STOP_LIMIT";
  if (normalized === "MARKET") return "MARKET";
  return "LIMIT";
}

function toBotOrderSide(value: unknown): "BUY" | "SELL" {
  return String(value ?? "").trim().toUpperCase() === "SELL" ? "SELL" : "BUY";
}

export async function upsertBotOrderEntry(params: {
  botVaultId: string;
  exchange: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  status?: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  price?: number | null;
  qty: number;
  reduceOnly?: boolean;
  metadata?: Record<string, unknown> | null;
}): Promise<string | null> {
  const dbAny = db as any;
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  const exchangeOrderId = String(params.exchangeOrderId ?? "").trim();
  const existing: any | null = await ignoreMissingTable(() => dbAny.botOrder.findFirst({
    where: {
      botVaultId: params.botVaultId,
      OR: [
        ...(clientOrderId ? [{ clientOrderId }] : []),
        ...(exchangeOrderId ? [{ exchangeOrderId }] : [])
      ]
    },
    select: { id: true, metadata: true }
  }));
  const mergedMetadata = {
    ...(asRecord(existing?.metadata) ?? {}),
    ...(params.metadata ?? {})
  };
  if (existing?.id) {
    await ignoreMissingTable(() => dbAny.botOrder.update({
      where: { id: existing.id },
      data: {
        exchange: params.exchange,
        symbol: params.symbol,
        side: toBotOrderSide(params.side),
        orderType: toBotOrderType(params.orderType),
        status: toBotOrderStatus(params.status ?? "OPEN"),
        clientOrderId: clientOrderId || null,
        exchangeOrderId: exchangeOrderId || null,
        price: Number.isFinite(Number(params.price)) ? Number(params.price) : null,
        qty: Number(params.qty),
        reduceOnly: params.reduceOnly === true,
        metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : null
      }
    }));
    return String(existing.id);
  }
  const created: any | null = await ignoreMissingTable(() => dbAny.botOrder.create({
    data: {
      botVaultId: params.botVaultId,
      exchange: params.exchange,
      symbol: params.symbol,
      side: toBotOrderSide(params.side),
      orderType: toBotOrderType(params.orderType),
      status: toBotOrderStatus(params.status ?? "OPEN"),
      clientOrderId: clientOrderId || null,
      exchangeOrderId: exchangeOrderId || null,
      price: Number.isFinite(Number(params.price)) ? Number(params.price) : null,
      qty: Number(params.qty),
      reduceOnly: params.reduceOnly === true,
      metadata: params.metadata ?? null
    },
    select: { id: true }
  }));
  return created?.id ? String(created.id) : null;
}

export async function createBotFillEntry(params: {
  botVaultId: string;
  botOrderId?: string | null;
  exchangeFillId?: string | null;
  exchangeOrderId?: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  price: number;
  qty: number;
  notional: number;
  feeAmount?: number | null;
  realizedPnl?: number | null;
  fillTs: Date;
  metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  const dbAny = db as any;
  const exchangeFillId = String(params.exchangeFillId ?? "").trim();
  const exchangeOrderId = String(params.exchangeOrderId ?? "").trim();
  const existing: any | null = await ignoreMissingTable(() => dbAny.botFill.findFirst({
    where: {
      botVaultId: params.botVaultId,
      OR: [
        ...(exchangeFillId ? [{ exchangeFillId }] : []),
        [{
          exchangeOrderId: exchangeOrderId || null,
          price: Number(params.price),
          qty: Number(params.qty),
          fillTs: params.fillTs
        }]
      ]
    },
    select: { id: true }
  }));
  if (existing?.id) return false;
  const created = await ignoreMissingTable(() => dbAny.botFill.create({
    data: {
      botVaultId: params.botVaultId,
      botOrderId: params.botOrderId ?? null,
      exchangeFillId: exchangeFillId || null,
      exchangeOrderId: exchangeOrderId || null,
      side: toBotOrderSide(params.side),
      symbol: params.symbol,
      price: Number(params.price),
      qty: Number(params.qty),
      notional: Number(params.notional),
      feeAmount: Number(params.feeAmount ?? 0),
      realizedPnl: Number.isFinite(Number(params.realizedPnl)) ? Number(params.realizedPnl) : null,
      fillTs: params.fillTs,
      metadata: params.metadata ?? null
    }
  }));
  return Boolean(created);
}

function mapBotTradeStateRow(row: any): BotTradeState {
  const signalRaw = String(row?.lastSignal ?? "").trim().toLowerCase();
  const openSideRaw = String(row?.openSide ?? "").trim().toLowerCase();
  return {
    botId: String(row?.botId ?? ""),
    symbol: normalizeSymbol(String(row?.symbol ?? "")),
    lastPredictionHash:
      typeof row?.lastPredictionHash === "string" && row.lastPredictionHash.trim().length > 0
        ? row.lastPredictionHash.trim()
        : null,
    lastSignal: signalRaw === "up" || signalRaw === "down" || signalRaw === "neutral" ? signalRaw : null,
    lastSignalTs: row?.lastSignalTs instanceof Date ? row.lastSignalTs : null,
    lastTradeTs: row?.lastTradeTs instanceof Date ? row.lastTradeTs : null,
    dailyTradeCount: Number(row?.dailyTradeCount ?? 0) || 0,
    dailyResetUtc: row?.dailyResetUtc instanceof Date ? row.dailyResetUtc : normalizeUtcDayStart(new Date()),
    openSide: openSideRaw === "long" || openSideRaw === "short" ? openSideRaw : null,
    openQty: Number.isFinite(Number(row?.openQty)) ? Number(row.openQty) : null,
    openEntryPrice: Number.isFinite(Number(row?.openEntryPrice)) ? Number(row.openEntryPrice) : null,
    openTs: row?.openTs instanceof Date ? row.openTs : null
  };
}

export async function loadBotTradeState(params: {
  botId: string;
  symbol: string;
  now?: Date;
}): Promise<BotTradeState> {
  const symbol = normalizeSymbol(params.symbol);
  const now = params.now ?? new Date();
  const dayStart = normalizeUtcDayStart(now);

  let row = await db.botTradeState.findUnique({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    }
  });

  if (!row) {
    row = await db.botTradeState.create({
      data: {
        botId: params.botId,
        symbol,
        dailyResetUtc: dayStart
      }
    });
    return mapBotTradeStateRow(row);
  }

  const currentDayStart = normalizeUtcDayStart(row.dailyResetUtc instanceof Date ? row.dailyResetUtc : dayStart);
  if (currentDayStart.getTime() === dayStart.getTime()) {
    return mapBotTradeStateRow(row);
  }

  row = await db.botTradeState.update({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    },
    data: {
      dailyTradeCount: 0,
      dailyResetUtc: dayStart
    }
  });

  return mapBotTradeStateRow(row);
}

export async function upsertBotTradeState(params: {
  botId: string;
  symbol: string;
  lastPredictionHash?: string | null;
  lastSignal?: "up" | "down" | "neutral" | null;
  lastSignalTs?: Date | null;
  lastTradeTs?: Date | null;
  dailyTradeCount?: number;
  dailyResetUtc?: Date;
  openSide?: "long" | "short" | null;
  openQty?: number | null;
  openEntryPrice?: number | null;
  openTs?: Date | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  const dayStart = normalizeUtcDayStart(params.dailyResetUtc ?? new Date());

  const updateData: any = {};
  const createData: any = {
    botId: params.botId,
    symbol,
    dailyResetUtc: dayStart
  };

  if ("lastPredictionHash" in params) {
    updateData.lastPredictionHash = params.lastPredictionHash ?? null;
    createData.lastPredictionHash = params.lastPredictionHash ?? null;
  }
  if ("lastSignal" in params) {
    updateData.lastSignal = params.lastSignal ?? null;
    createData.lastSignal = params.lastSignal ?? null;
  }
  if ("lastSignalTs" in params) {
    updateData.lastSignalTs = params.lastSignalTs ?? null;
    createData.lastSignalTs = params.lastSignalTs ?? null;
  }
  if ("lastTradeTs" in params) {
    updateData.lastTradeTs = params.lastTradeTs ?? null;
    createData.lastTradeTs = params.lastTradeTs ?? null;
  }
  if ("dailyTradeCount" in params) {
    updateData.dailyTradeCount = Math.max(0, Math.trunc(Number(params.dailyTradeCount ?? 0)));
    createData.dailyTradeCount = Math.max(0, Math.trunc(Number(params.dailyTradeCount ?? 0)));
  }
  if ("dailyResetUtc" in params) {
    updateData.dailyResetUtc = dayStart;
    createData.dailyResetUtc = dayStart;
  }
  if ("openSide" in params) {
    updateData.openSide = params.openSide ?? null;
    createData.openSide = params.openSide ?? null;
  }
  if ("openQty" in params) {
    updateData.openQty = params.openQty ?? null;
    createData.openQty = params.openQty ?? null;
  }
  if ("openEntryPrice" in params) {
    updateData.openEntryPrice = params.openEntryPrice ?? null;
    createData.openEntryPrice = params.openEntryPrice ?? null;
  }
  if ("openTs" in params) {
    updateData.openTs = params.openTs ?? null;
    createData.openTs = params.openTs ?? null;
  }

  await db.botTradeState.upsert({
    where: {
      botId_symbol: {
        botId: params.botId,
        symbol
      }
    },
    update: updateData,
    create: createData
  });
}

export async function createBotTradeHistoryEntry(params: {
  botId: string;
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType?: string;
  side: "long" | "short";
  entryTs: Date;
  entryPrice: number;
  entryQty: number;
  entryNotionalUsd: number;
  tpPrice?: number | null;
  slPrice?: number | null;
  entryOrderId?: string | null;
  predictionStateId?: string | null;
  predictionHash?: string | null;
  predictionSignal?: "up" | "down" | "neutral" | null;
  predictionConfidence?: number | null;
  predictionTags?: string[] | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  return db.botTradeHistory.create({
    data: {
      botId: params.botId,
      userId: params.userId,
      exchangeAccountId: params.exchangeAccountId,
      symbol,
      marketType: params.marketType ?? "perp",
      side: params.side,
      status: "open",
      entryTs: params.entryTs,
      entryPrice: params.entryPrice,
      entryQty: params.entryQty,
      entryNotionalUsd: params.entryNotionalUsd,
      tpPrice: params.tpPrice ?? null,
      slPrice: params.slPrice ?? null,
      entryOrderId: params.entryOrderId ?? null,
      predictionStateId: params.predictionStateId ?? null,
      predictionHash: params.predictionHash ?? null,
      predictionSignal: params.predictionSignal ?? null,
      predictionConfidence: params.predictionConfidence ?? null,
      predictionTagsJson: Array.isArray(params.predictionTags) ? params.predictionTags.slice(0, 20) : null
    }
  });
}

export async function countOpenBotTradeHistoryEntries(params: {
  botId: string;
  symbol?: string;
}): Promise<number> {
  const where: any = {
    botId: params.botId,
    status: "open"
  };
  if (params.symbol) {
    where.symbol = normalizeSymbol(params.symbol);
  }
  const count = await db.botTradeHistory.count({ where });
  return Number(count ?? 0) || 0;
}

export async function loadLatestOpenBotTradeHistoryEntry(params: {
  botId: string;
  symbol: string;
}): Promise<OpenBotTradeHistoryEntry | null> {
  const symbol = normalizeSymbol(params.symbol);
  const row = await db.botTradeHistory.findFirst({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      side: true,
      tpPrice: true,
      slPrice: true
    }
  });
  if (!row) return null;

  const sideRaw = String(row.side ?? "").trim().toLowerCase();
  const side: "long" | "short" = sideRaw === "short" ? "short" : "long";
  const tpPrice = Number.isFinite(Number(row.tpPrice)) ? Number(row.tpPrice) : null;
  const slPrice = Number.isFinite(Number(row.slPrice)) ? Number(row.slPrice) : null;

  return {
    id: String(row.id),
    side,
    tpPrice,
    slPrice
  };
}

export async function closeOpenBotTradeHistoryEntries(params: {
  botId: string;
  symbol: string;
  exitTs: Date;
  exitPrice?: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  exitReason?: string | null;
  exitOrderId?: string | null;
}): Promise<{ closedCount: number; realizedPnlUsd: number | null }> {
  const symbol = normalizeSymbol(params.symbol);
  const openTrades = await db.botTradeHistory.findMany({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "asc" }, { createdAt: "asc" }]
  });

  if (!Array.isArray(openTrades) || openTrades.length === 0) {
    return {
      closedCount: 0,
      realizedPnlUsd: null
    };
  }

  const exitPrice = Number.isFinite(Number(params.exitPrice)) ? Number(params.exitPrice) : null;
  let realizedPnlUsdTotal = 0;
  let hasRealized = false;

  await db.$transaction(
    openTrades.map((openTrade: any) => {
      const qty = Math.abs(Number(openTrade.entryQty ?? 0));
      const entryPrice = Number(openTrade.entryPrice ?? 0);
      const entryNotionalUsd = Number(openTrade.entryNotionalUsd ?? 0);
      const side = String(openTrade.side ?? "").trim().toLowerCase();

      const exitNotionalUsd =
        exitPrice !== null && Number.isFinite(qty) && qty > 0
          ? Number((exitPrice * qty).toFixed(8))
          : null;

      const realizedPnlUsd =
        exitPrice !== null &&
        Number.isFinite(entryPrice) &&
        entryPrice > 0 &&
        Number.isFinite(qty) &&
        qty > 0
          ? Number((
              side === "long"
                ? (exitPrice - entryPrice) * qty
                : (entryPrice - exitPrice) * qty
            ).toFixed(4))
          : null;

      if (realizedPnlUsd !== null) {
        realizedPnlUsdTotal += realizedPnlUsd;
        hasRealized = true;
      }

      const realizedPnlPct =
        realizedPnlUsd !== null && Number.isFinite(entryNotionalUsd) && entryNotionalUsd > 0
          ? Number(((realizedPnlUsd / entryNotionalUsd) * 100).toFixed(6))
          : null;

      return db.botTradeHistory.update({
        where: { id: openTrade.id },
        data: {
          status: "closed",
          exitTs: params.exitTs,
          exitPrice,
          exitNotionalUsd,
          realizedPnlUsd,
          realizedPnlPct,
          outcome: params.outcome,
          exitReason: params.exitReason ?? null,
          exitOrderId: params.exitOrderId ?? null
        }
      });
    })
  );

  return {
    closedCount: openTrades.length,
    realizedPnlUsd: hasRealized ? Number(realizedPnlUsdTotal.toFixed(4)) : null
  };
}

export async function closeLatestOpenBotTradeHistory(params: {
  botId: string;
  symbol: string;
  exitTs: Date;
  exitPrice?: number | null;
  exitNotionalUsd?: number | null;
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
  outcome: BotTradeHistoryCloseOutcome;
  exitReason?: string | null;
  exitOrderId?: string | null;
}) {
  const symbol = normalizeSymbol(params.symbol);
  const openTrade = await db.botTradeHistory.findFirst({
    where: {
      botId: params.botId,
      symbol,
      status: "open"
    },
    orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }]
  });

  if (!openTrade) return null;

  const exitPrice = Number.isFinite(Number(params.exitPrice)) ? Number(params.exitPrice) : null;
  const exitNotionalUsd =
    Number.isFinite(Number(params.exitNotionalUsd))
      ? Number(params.exitNotionalUsd)
      : exitPrice !== null && Number.isFinite(Number(openTrade.entryQty))
        ? Number((exitPrice * Number(openTrade.entryQty)).toFixed(8))
        : null;
  const realizedPnlUsd =
    Number.isFinite(Number(params.realizedPnlUsd))
      ? Number(params.realizedPnlUsd)
      : null;
  const realizedPnlPct =
    Number.isFinite(Number(params.realizedPnlPct))
      ? Number(params.realizedPnlPct)
      : (() => {
          if (realizedPnlUsd === null) return null;
          const base = Number(openTrade.entryNotionalUsd);
          if (!Number.isFinite(base) || base <= 0) return null;
          return Number(((realizedPnlUsd / base) * 100).toFixed(6));
        })();

  return db.botTradeHistory.update({
    where: { id: openTrade.id },
    data: {
      status: "closed",
      exitTs: params.exitTs,
      exitPrice,
      exitNotionalUsd,
      realizedPnlUsd,
      realizedPnlPct,
      outcome: params.outcome,
      exitReason: params.exitReason ?? null,
      exitOrderId: params.exitOrderId ?? null
    }
  });
}

export async function getBotDailyTradeCount(params: {
  botId: string;
  now?: Date;
}): Promise<number> {
  const dayStart = normalizeUtcDayStart(params.now ?? new Date());
  const result = await db.botTradeState.aggregate({
    where: {
      botId: params.botId,
      dailyResetUtc: dayStart
    },
    _sum: {
      dailyTradeCount: true
    }
  });
  return Number(result?._sum?.dailyTradeCount ?? 0) || 0;
}

export async function upsertBotRuntime(params: {
  botId: string;
  status: BotStatusValue;
  reason?: string | null;
  workerId?: string | null;
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  stateJson?: Record<string, unknown> | null;
  lastError?: string | null;
  consecutiveErrors?: number;
  errorWindowStartAt?: Date | null;
  lastErrorAt?: Date | null;
  lastErrorMessage?: string | null;
}) {
  const updateData: any = {
    status: params.status,
    updatedAt: new Date()
  };

  const createData: any = {
    botId: params.botId,
    status: params.status
  };

  if ("reason" in params) {
    updateData.reason = params.reason ?? null;
    createData.reason = params.reason ?? null;
  }
  if ("workerId" in params) {
    updateData.workerId = params.workerId ?? null;
    createData.workerId = params.workerId ?? null;
  }
  if ("lastHeartbeatAt" in params) {
    updateData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
    createData.lastHeartbeatAt = params.lastHeartbeatAt ?? null;
  }
  if ("lastTickAt" in params) {
    updateData.lastTickAt = params.lastTickAt ?? null;
    createData.lastTickAt = params.lastTickAt ?? null;
  }
  if ("stateJson" in params) {
    updateData.stateJson = params.stateJson ?? null;
    createData.stateJson = params.stateJson ?? null;
  }
  if ("lastError" in params) {
    updateData.lastError = params.lastError ?? null;
    createData.lastError = params.lastError ?? null;
  }
  if ("consecutiveErrors" in params) {
    updateData.consecutiveErrors = params.consecutiveErrors ?? 0;
    createData.consecutiveErrors = params.consecutiveErrors ?? 0;
  }
  if ("errorWindowStartAt" in params) {
    updateData.errorWindowStartAt = params.errorWindowStartAt ?? null;
    createData.errorWindowStartAt = params.errorWindowStartAt ?? null;
  }
  if ("lastErrorAt" in params) {
    updateData.lastErrorAt = params.lastErrorAt ?? null;
    createData.lastErrorAt = params.lastErrorAt ?? null;
  }
  if ("lastErrorMessage" in params) {
    updateData.lastErrorMessage = params.lastErrorMessage ?? null;
    createData.lastErrorMessage = params.lastErrorMessage ?? null;
  }

  try {
    await db.botRuntime.upsert({
      where: { botId: params.botId },
      update: updateData,
      create: createData
    });
  } catch (error) {
    const code = (error as any)?.code;
    const constraint = String((error as any)?.meta?.constraint ?? "");
    if (code === "P2003" && constraint === "BotRuntime_botId_fkey") {
      // Ignore stale queue events for bots that were deleted meanwhile.
      return;
    }
    throw error;
  }
}

export async function writeBotTick(params: {
  botId: string;
  status: "running" | "error";
  reason: string | null;
  intent: TradeIntent;
  workerId?: string | null;
  trace?: RunnerDecisionTrace | null;
}) {
  const now = new Date();
  const stateJson: Record<string, unknown> = {
    intentType: params.intent.type
  };
  if (params.trace) {
    stateJson.signalDecision = params.trace.signal;
    stateJson.executionDecision = params.trace.execution;
  }
  await upsertBotRuntime({
    botId: params.botId,
    status: params.status,
    reason: params.reason,
    workerId: params.workerId ?? null,
    lastHeartbeatAt: now,
    lastTickAt: now,
    stateJson,
    ...(params.status === "error" ? { lastError: params.reason } : {})
  });
}

export async function writeRiskEvent(params: {
  botId: string;
  type: RiskEventType;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  const resolveDbRiskNoiseThrottleMs = (): number => {
    const parsed = Number(process.env.GRID_NOISE_EVENT_DB_THROTTLE_SEC ?? 120);
    if (!Number.isFinite(parsed)) return 120_000;
    return Math.max(0, Math.min(3_600_000, Math.trunc(parsed * 1000)));
  };

  const shouldDbThrottleRiskEvent = (): boolean => {
    const message = String(params.message ?? "").trim();
    if (!message) return false;
    if (params.type === "GRID_PLANNER_UNAVAILABLE") return true;
    if (params.type === "GRID_PLAN_APPLIED" && message === "grid_window_no_change") return true;
    if (params.type === "SIGNAL_DECISION" && message === "signal_ready" && params.meta?.blockedBySignal !== true) return true;
    if (params.type === "EXECUTION_DECISION") {
      return message === "grid_no_order_changes"
        || message === "grid_entry_blocked_by_risk"
        || message.startsWith("grid_planner_unavailable:");
    }
    return false;
  };

  try {
    const throttleMs = resolveDbRiskNoiseThrottleMs();
    if (throttleMs > 0 && shouldDbThrottleRiskEvent()) {
      const existing = await db.riskEvent.findFirst({
        where: {
          botId: params.botId,
          type: params.type,
          message: params.message ?? null,
          createdAt: {
            gte: new Date(Date.now() - throttleMs)
          }
        },
        select: { id: true },
        orderBy: { createdAt: "desc" }
      });
      if (existing) return;
    }

    await db.riskEvent.create({
      data: {
        botId: params.botId,
        type: params.type,
        message: params.message ?? null,
        meta: params.meta ?? null
      }
    });
  } catch (error) {
    const code = (error as any)?.code;
    const constraint = String((error as any)?.meta?.constraint ?? "");
    if (code === "P2003" && constraint === "RiskEvent_botId_fkey") {
      // Ignore stale queue events for bots that were deleted meanwhile.
      return;
    }
    throw error;
  }
}

export async function markExchangeAccountUsed(exchangeAccountId: string) {
  await db.exchangeAccount.update({
    where: { id: exchangeAccountId },
    data: { lastUsedAt: new Date() }
  });
}

export async function markBotAsError(botId: string, reason: string) {
  try {
    await db.bot.update({
      where: { id: botId },
      data: {
        status: "error",
        lastError: reason
      }
    });
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "P2025") {
      // Bot was deleted after job dispatch.
      return;
    }
    throw error;
  }
}

export async function markRunnerHeartbeat(params: {
  botsRunning: number;
  botsErrored: number;
}) {
  await db.runnerStatus.upsert({
    where: { id: "main" },
    update: {
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    },
    create: {
      id: "main",
      lastTickAt: new Date(),
      botsRunning: params.botsRunning,
      botsErrored: params.botsErrored,
      version: process.env.VERSION ?? null
    }
  });
}

export async function getRunnerBotCounters(): Promise<{ botsRunning: number; botsErrored: number }> {
  const [botsRunning, botsErrored] = await Promise.all([
    db.bot.count({ where: { status: "running" } }),
    db.bot.count({ where: { status: "error" } })
  ]);

  return { botsRunning, botsErrored };
}
