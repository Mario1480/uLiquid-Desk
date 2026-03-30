import {
  HyperliquidFuturesAdapter,
  buildHyperliquidReadKey,
  classifyHyperliquidReadError,
  executeHyperliquidRead
} from "@mm/futures-exchange";
import { logger as defaultLogger } from "../logger.js";
import { getEffectiveVaultExecutionMode, isOnchainMode } from "./executionMode.js";
import { roundUsd } from "./profitShare.js";
import {
  buildVaultReconciliationResult,
  type VaultReconciliationItem,
  type VaultReconciliationResult,
  type VaultReconciliationStatus
} from "./reconciliation.js";

type LoggerLike = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
};

type TradingReconciliationAdapter = {
  getOpenOrders: () => Promise<unknown[]>;
  getOrderHistory: (params: { startTime: number; endTime: number }) => Promise<unknown[]>;
  getFills: (params: { startTime: number; endTime: number }) => Promise<unknown[]>;
  getFunding: (params: { startTime: number; endTime: number }) => Promise<unknown[]>;
  getPositions: () => Promise<Array<Record<string, unknown>>>;
  getAccountState: () => Promise<Record<string, unknown>>;
  toCanonicalSymbol?: (value: string) => string | null;
  close: () => Promise<void>;
};

type CreateTradingReconciliationServiceDeps = {
  logger?: LoggerLike;
  createReadAdapter?: (params: {
    botVaultId: string;
    agentWallet: string;
    vaultAddress: string | null;
    createdAt: Date;
  }) => Promise<TradingReconciliationAdapter>;
};

type BotVaultAggregateSnapshot = {
  botVaultId: string;
  grossRealizedPnl: number;
  tradingFeesTotal: number;
  fundingTotal: number;
  realizedPnlNet: number;
  netWithdrawableProfit: number;
  isFlat: boolean;
  openPositionCount: number;
  lastFillTs: string | null;
  lastFundingTs: string | null;
  lastReconciledAt: string | null;
  sourceVersion: number;
  metadata: Record<string, unknown> | null;
};

type ReconcileVaultResult = {
  botVaultId: string;
  newOrders: number;
  newFills: number;
  newFundingEvents: number;
  aggregate: BotVaultAggregateSnapshot;
  reconciliation: VaultReconciliationResult;
};

type ReconcileSummary = {
  scanned: number;
  processed: number;
  failed: number;
  newOrders: number;
  newFills: number;
  newFundingEvents: number;
  statusCounts: Record<VaultReconciliationStatus, number>;
};

type AuditItem = {
  kind: "order" | "fill" | "funding" | "fee_event";
  ts: string;
  id: string;
  payload: Record<string, unknown>;
};

type BotVaultAuditResult = {
  botVaultId: string;
  items: AuditItem[];
  nextCursor: string | null;
};

type BotVaultPnlReport = {
  botVaultId: string;
  isFlat: boolean;
  grossRealizedPnl: number;
  tradingFeesTotal: number;
  fundingTotal: number;
  realizedPnlNet: number;
  netWithdrawableProfit: number;
  openPositionCount: number;
  lastReconciledAt: string | null;
  latestPositionSnapshot: unknown;
  fillsPreview: Array<Record<string, unknown>>;
};

type FeeBasisResult = {
  source: "legacy" | "reconciliation";
  realizedPnlNetUsd: number;
  isFlat: boolean;
  netWithdrawableProfitUsd: number | null;
  aggregate: any | null;
};

type HyperliquidTradingInfoRequest =
  | { type: "frontendOpenOrders"; user: string }
  | { type: "historicalOrders"; user: string }
  | { type: "userFillsByTime"; user: string; startTime: number; endTime: number }
  | { type: "userFunding"; user: string; startTime: number; endTime: number };

type EligibleBotVaultRow = {
  id: string;
  userId: string;
  gridInstanceId: string;
  agentWallet: string | null;
  vaultAddress: string | null;
  masterVaultAddress: string | null;
  executionProvider: string | null;
  executionStatus: string | null;
  executionMetadata: Record<string, unknown> | null;
  principalAllocated: number;
  principalReturned: number;
  availableUsd: number;
  realizedPnlNet: number;
  feePaidTotal: number;
  profitShareAccruedUsd: number;
  lastAccountingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  gridInstance: {
    id: string;
    template: { symbol: string | null } | null;
    exchangeAccount: { exchange: string | null } | null;
  } | null;
};

const INITIAL_LOOKBACK_DAYS = Math.max(
  1,
  Math.trunc(Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_INITIAL_LOOKBACK_DAYS ?? "30"))
);
const CURSOR_BACKTRACK_MS = Math.max(
  0,
  Math.trunc(Number(process.env.BOT_VAULT_TRADING_RECONCILIATION_CURSOR_BACKTRACK_SECONDS ?? "300")) * 1000
);
const SOURCE_VERSION = 1;
const EPSILON = 0.000001;
const REALIZED_PNL_DRIFT_THRESHOLD_USD = Math.max(
  0.0001,
  Number(process.env.BOT_VAULT_REALIZED_PNL_DRIFT_THRESHOLD_USD ?? "0.01")
);
const BALANCE_DRIFT_THRESHOLD_USD = Math.max(
  0.0001,
  Number(process.env.BOT_VAULT_BALANCE_DRIFT_THRESHOLD_USD ?? "1")
);
const FEE_DRIFT_THRESHOLD_USD = Math.max(
  0.0001,
  Number(process.env.BOT_VAULT_FEE_DRIFT_THRESHOLD_USD ?? "0.01")
);

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toRecord(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveHyperliquidExecutionVaultAddress(params: {
  executionMetadata: Record<string, unknown> | null;
  vaultAddress: string | null;
  masterVaultAddress?: string | null;
}): string | null {
  const metadata = toRecord(params.executionMetadata);
  const providerState = toRecord(metadata.providerState);
  const providerVaultAddress = toStringValue(providerState.vaultAddress);
  const masterVaultAddress = toStringValue(params.masterVaultAddress);
  const metadataVaultAddress = toStringValue(metadata.vaultAddress);
  const rootBotVaultAddress = toStringValue(params.vaultAddress);
  if (rootBotVaultAddress) return rootBotVaultAddress;
  if (masterVaultAddress && (!rootBotVaultAddress || masterVaultAddress.toLowerCase() !== rootBotVaultAddress.toLowerCase())) {
    return masterVaultAddress;
  }
  if (providerVaultAddress && (!rootBotVaultAddress || providerVaultAddress.toLowerCase() !== rootBotVaultAddress.toLowerCase())) {
    return providerVaultAddress;
  }
  return (
    (metadataVaultAddress && (!rootBotVaultAddress || metadataVaultAddress.toLowerCase() !== rootBotVaultAddress.toLowerCase())
      ? metadataVaultAddress
      : null)
    ?? null
  );
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 9999999999 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toTimestamp(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toIso(value: unknown): string | null {
  const parsed = toTimestamp(value);
  return parsed ? parsed.toISOString() : null;
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeSide(value: unknown): "BUY" | "SELL" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "a" || raw === "ask" || raw.includes("sell") || raw.includes("short")) return "SELL";
  return "BUY";
}

function normalizeOrderType(row: Record<string, unknown>): "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" {
  const isTrigger = Boolean(row.isTrigger);
  const raw = String(row.orderType ?? row.type ?? "").trim().toLowerCase();
  if (isTrigger && raw.includes("limit")) return "STOP_LIMIT";
  if (isTrigger) return "STOP";
  if (raw.includes("market") || raw === "ioc") return "MARKET";
  return "LIMIT";
}

function normalizeOrderStatus(value: unknown): "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("partial")) return "PARTIALLY_FILLED";
  if (raw.includes("filled") || raw === "fill") return "FILLED";
  if (raw.includes("cancel")) return "CANCELED";
  if (raw.includes("reject")) return "REJECTED";
  if (raw.includes("expire")) return "EXPIRED";
  return "OPEN";
}

function positionSideFromSize(value: unknown): string | null {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || Math.abs(size) <= EPSILON) return null;
  return size > 0 ? "long" : "short";
}

function canonicalSymbol(adapter: TradingReconciliationAdapter, value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "UNKNOWN";
  if (typeof adapter.toCanonicalSymbol === "function") {
    const converted = adapter.toCanonicalSymbol(raw);
    if (converted) return normalizeSymbol(converted);
  }
  return normalizeSymbol(raw);
}

function subtractMs(base: Date, amountMs: number): Date {
  return new Date(base.getTime() - Math.max(0, amountMs));
}

function cursorId(botVaultId: string, streamType: string): string {
  return `${botVaultId}:${streamType}`;
}

function startCursorFromRow(row: { cursorTs?: Date | null } | null | undefined, fallback: Date): Date {
  const ts = row?.cursorTs instanceof Date ? row.cursorTs : fallback;
  return subtractMs(ts, CURSOR_BACKTRACK_MS);
}

function roundMoney(value: unknown, precision = 6): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return roundUsd(parsed, precision);
}

function filterHyperliquidOrdersByTimeWindow<T>(rows: T[], params: { startTime: number; endTime: number }): T[] {
  return rows.filter((row) => {
    const record = asRecord(row);
    if (!record) return false;
    const order = asRecord(record.order) ?? record;
    const createdAt = toTimestamp(order.timestamp ?? record.statusTimestamp ?? record.timestamp ?? record.time);
    if (!createdAt) return true;
    const ts = createdAt.getTime();
    return ts >= params.startTime && ts <= params.endTime;
  });
}

function filterCurrentHyperliquidOpenOrders<T>(rows: T[], params: { startTime: number; endTime: number }): T[] {
  return filterHyperliquidOrdersByTimeWindow(rows, params).filter((row) => {
    const record = asRecord(row);
    if (!record) return false;
    const order = asRecord(record.order) ?? record;
    const status = normalizeOrderStatus(record.status ?? order.status ?? "open");
    return status === "OPEN" || status === "PARTIALLY_FILLED";
  });
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record && Object.keys(record).length > 0 ? record : null;
}

function resolveHyperliquidInfoBaseUrl(): string {
  const raw = String(process.env.HYPERLIQUID_REST_BASE_URL ?? "https://api.hyperliquid.xyz").trim();
  return raw.replace(/\/+$/, "") || "https://api.hyperliquid.xyz";
}

function resolveHyperliquidReadTimeoutMs(): number {
  const raw = Number(process.env.HYPERLIQUID_INFO_TIMEOUT_MS ?? "8000");
  if (!Number.isFinite(raw) || raw <= 0) return 8000;
  return Math.max(500, Math.trunc(raw));
}

async function postHyperliquidInfo<T>(baseUrl: string, payload: HyperliquidTradingInfoRequest): Promise<T> {
  const timeoutMs = resolveHyperliquidReadTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/info`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`hyperliquid_info_failed:${response.status}:${message || "null"}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      return [] as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`hyperliquid_info_invalid_json:${payload.type}:${message}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`hyperliquid ${payload.type} timed out after ${timeoutMs}ms`);
      (timeoutError as Error & { code?: string }).code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readHyperliquidArray<T>(params: {
  userAddress: string;
  endpoint: HyperliquidTradingInfoRequest["type"];
  payload: HyperliquidTradingInfoRequest;
  ttlMs: number;
  staleMs: number;
  timeframe?: string | null;
  allowEmptyOnFailure?: boolean;
  botVaultId: string;
}): Promise<T[]> {
  const key = buildHyperliquidReadKey({
    scope: "hyperliquid_trading_reconciliation",
    identity: params.userAddress,
    endpoint: params.endpoint,
    timeframe: params.timeframe ?? null
  });
  try {
    const result = await executeHyperliquidRead<T[]>({
      key,
      ttlMs: params.ttlMs,
      staleMs: params.staleMs,
      read: async () => {
        const rows = await postHyperliquidInfo<unknown>(resolveHyperliquidInfoBaseUrl(), params.payload);
        return Array.isArray(rows) ? (rows as T[]) : [];
      }
    });
    return Array.isArray(result.value) ? result.value : [];
  } catch (error) {
    if (!params.allowEmptyOnFailure) throw error;
    const classified = classifyHyperliquidReadError(error);
    defaultLogger.warn("hyperliquid_trading_reconciliation_read_degraded", {
      botVaultId: params.botVaultId,
      endpoint: params.endpoint,
      category: classified.category,
      reason: classified.message
    });
    return [];
  }
}

function readAvailableBalanceUsd(accountState: Record<string, unknown>): number | null {
  const candidates = [
    accountState.availableBalance,
    accountState.availableMargin,
    accountState.withdrawable,
    accountState.withdrawableUsd,
    accountState.availableToWithdraw,
    accountState.equity
  ];
  for (const candidate of candidates) {
    const parsed = toNumber(candidate);
    if (parsed !== null) return roundMoney(parsed, 6);
  }
  return null;
}

function buildNumericDriftItem(params: {
  kind: VaultReconciliationItem["kind"];
  label: string;
  expected: number | null;
  actual: number | null;
  threshold: number;
  allowWarningWhenUnavailable?: boolean;
  metadata?: Record<string, unknown>;
}): VaultReconciliationItem {
  if (params.expected === null || params.actual === null) {
    return {
      kind: params.kind,
      status: params.allowWarningWhenUnavailable === false ? "clean" : "warning",
      message: `${params.label}_unavailable`,
      expected: params.expected,
      actual: params.actual,
      delta: null,
      threshold: params.threshold,
      metadata: params.metadata ?? null
    };
  }
  const delta = roundMoney(params.actual - params.expected, 6);
  return {
    kind: params.kind,
    status: Math.abs(delta) > params.threshold + EPSILON ? "drift_detected" : "clean",
    message: Math.abs(delta) > params.threshold + EPSILON ? `${params.label}_drift_detected` : `${params.label}_aligned`,
    expected: params.expected,
    actual: params.actual,
    delta,
    threshold: params.threshold,
    metadata: params.metadata ?? null
  };
}

async function createDefaultReadAdapter(params: {
  botVaultId: string;
  agentWallet: string;
  vaultAddress: string | null;
  createdAt: Date;
}): Promise<TradingReconciliationAdapter> {
  const adapter = new HyperliquidFuturesAdapter({
    apiKey: params.agentWallet,
    apiSecret: "",
    apiPassphrase: params.vaultAddress ?? undefined,
    restBaseUrl: process.env.HYPERLIQUID_REST_BASE_URL
  });
  const userAddress = String(params.vaultAddress ?? params.agentWallet ?? "").trim();

  return {
    async getOpenOrders() {
      const frontendRows = await readHyperliquidArray({
        botVaultId: params.botVaultId,
        userAddress,
        endpoint: "frontendOpenOrders",
        payload: {
          type: "frontendOpenOrders",
          user: userAddress
        },
        ttlMs: 5_000,
        staleMs: 60_000,
        allowEmptyOnFailure: true
      });
      const currentWindow = {
        startTime: params.createdAt.getTime(),
        endTime: Date.now()
      };
      const currentOpenRows = filterCurrentHyperliquidOpenOrders(frontendRows, currentWindow);
      if (currentOpenRows.length > 0) {
        return currentOpenRows;
      }

      const historicalRows = await readHyperliquidArray({
        botVaultId: params.botVaultId,
        userAddress,
        endpoint: "historicalOrders",
        payload: {
          type: "historicalOrders",
          user: userAddress
        },
        ttlMs: 5_000,
        staleMs: 60_000,
        timeframe: "open-order-fallback",
        allowEmptyOnFailure: true
      });
      return filterCurrentHyperliquidOpenOrders(historicalRows, currentWindow);
    },
    async getOrderHistory(args) {
      const rows = await readHyperliquidArray({
        botVaultId: params.botVaultId,
        userAddress,
        endpoint: "historicalOrders",
        payload: {
          type: "historicalOrders",
          user: userAddress
        },
        ttlMs: 15_000,
        staleMs: 60_000,
        timeframe: `${args.startTime}:${args.endTime}`,
        allowEmptyOnFailure: true
      });
      return filterHyperliquidOrdersByTimeWindow(rows, args);
    },
    async getFills(args) {
      return readHyperliquidArray({
        botVaultId: params.botVaultId,
        userAddress,
        endpoint: "userFillsByTime",
        payload: {
          type: "userFillsByTime",
          user: userAddress,
          startTime: args.startTime,
          endTime: args.endTime
        },
        ttlMs: 15_000,
        staleMs: 60_000,
        timeframe: `${args.startTime}:${args.endTime}`,
        allowEmptyOnFailure: true
      });
    },
    async getFunding(args) {
      return readHyperliquidArray({
        botVaultId: params.botVaultId,
        userAddress,
        endpoint: "userFunding",
        payload: {
          type: "userFunding",
          user: userAddress,
          startTime: args.startTime,
          endTime: args.endTime
        },
        ttlMs: 15_000,
        staleMs: 60_000,
        timeframe: `${args.startTime}:${args.endTime}`,
        allowEmptyOnFailure: true
      });
    },
    async getPositions() {
      const rows = await adapter.getPositions();
      return Array.isArray(rows) ? rows.map((item) => toRecord(item)) : [];
    },
    async getAccountState() {
      return toRecord(await adapter.getAccountState());
    },
    toCanonicalSymbol(value: string) {
      return adapter.toCanonicalSymbol(value);
    },
    async close() {
      await adapter.close();
    }
  };
}

function normalizeOrderRow(adapter: TradingReconciliationAdapter, raw: unknown): {
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  price: number | null;
  qty: number;
  reduceOnly: boolean;
  createdAt: Date;
  metadata: Record<string, unknown>;
} | null {
  const root = asRecord(raw);
  if (!root) return null;
  const order = asRecord(root.order) ?? root;

  const exchangeOrderId = toStringValue(order.oid) ?? toStringValue(order.orderId) ?? toStringValue(root.oid) ?? toStringValue(root.orderId);
  const clientOrderId = toStringValue(order.cloid) ?? toStringValue(order.clientOid) ?? toStringValue(root.cloid) ?? toStringValue(root.clientOid);
  if (!exchangeOrderId && !clientOrderId) return null;

  const qty = toNumber(order.sz) ?? toNumber(order.origSz) ?? toNumber(order.size) ?? 0;
  if (!Number.isFinite(qty) || qty <= 0) return null;

  return {
    exchangeOrderId,
    clientOrderId,
    symbol: canonicalSymbol(adapter, order.coin ?? root.coin),
    side: normalizeSide(order.side ?? root.side),
    orderType: normalizeOrderType({ ...root, ...order }),
    status: normalizeOrderStatus(root.status ?? order.status ?? "open"),
    price: toNumber(order.limitPx) ?? toNumber(order.price),
    qty,
    reduceOnly: Boolean(order.reduceOnly ?? root.reduceOnly),
    createdAt: toTimestamp(order.timestamp ?? root.statusTimestamp ?? root.timestamp ?? root.time) ?? new Date(),
    metadata: {
      raw: raw as Record<string, unknown>
    }
  };
}

function normalizeFillRow(adapter: TradingReconciliationAdapter, raw: unknown): {
  exchangeFillId: string | null;
  exchangeOrderId: string | null;
  side: "BUY" | "SELL";
  symbol: string;
  price: number;
  qty: number;
  notional: number;
  feeAmount: number;
  realizedPnl: number | null;
  fillTs: Date;
  metadata: Record<string, unknown>;
} | null {
  const row = asRecord(raw);
  if (!row) return null;
  const price = toNumber(row.px) ?? toNumber(row.price);
  const qty = toNumber(row.sz) ?? toNumber(row.qty) ?? toNumber(row.size);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || Number(price) <= 0 || Number(qty) <= 0) return null;

  const fallbackFillId = [toStringValue(row.hash), toIso(row.time), toStringValue(row.oid)].filter(Boolean).join(":");
  const exchangeFillId = toStringValue(row.tid)
    ?? toStringValue(row.tradeId)
    ?? toStringValue(row.fillId)
    ?? (fallbackFillId || null);
  const exchangeOrderId = toStringValue(row.oid) ?? toStringValue(row.orderId);
  const realizedPnl = toNumber(row.closedPnl) ?? toNumber(row.realizedPnl) ?? toNumber(row.pnl);

  return {
    exchangeFillId,
    exchangeOrderId,
    side: normalizeSide(row.side ?? row.dir),
    symbol: canonicalSymbol(adapter, row.coin ?? row.symbol),
    price: Number(price),
    qty: Number(qty),
    notional: roundMoney((toNumber(row.notional) ?? (Number(price) * Number(qty))), 8),
    feeAmount: roundMoney(toNumber(row.fee) ?? toNumber(row.feeUsd) ?? 0, 8),
    realizedPnl: realizedPnl === null ? null : roundMoney(realizedPnl, 8),
    fillTs: toTimestamp(row.time ?? row.timestamp) ?? new Date(),
    metadata: {
      raw: raw as Record<string, unknown>
    }
  };
}

function normalizeFundingRow(adapter: TradingReconciliationAdapter, raw: unknown): {
  symbol: string;
  amount: number;
  positionSide: string | null;
  sourceKey: string;
  fundingTs: Date;
  metadata: Record<string, unknown>;
} | null {
  const row = asRecord(raw);
  if (!row) return null;
  const delta = asRecord(row.delta);
  if (!delta) return null;
  const amount = toNumber(delta.usdc);
  if (!Number.isFinite(amount)) return null;
  const fundingTs = toTimestamp(row.time);
  if (!fundingTs) return null;
  const hash = toStringValue(row.hash);
  const symbol = canonicalSymbol(adapter, delta.coin);
  const sourceKey = hash ?? [symbol, String(amount), fundingTs.toISOString()].join(":");
  return {
    symbol,
    amount: roundMoney(amount, 8),
    positionSide: positionSideFromSize(delta.szi),
    sourceKey,
    fundingTs,
    metadata: {
      fundingRate: toNumber(delta.fundingRate),
      szi: toNumber(delta.szi),
      raw: raw as Record<string, unknown>
    }
  };
}

async function upsertReconciliationCursor(tx: any, params: {
  botVaultId: string;
  streamType: string;
  cursorTs?: Date | null;
  cursorValue?: string | null;
}) {
  if (!tx?.botVaultReconciliationCursor?.upsert) return;
  await tx.botVaultReconciliationCursor.upsert({
    where: { id: cursorId(params.botVaultId, params.streamType) },
    create: {
      id: cursorId(params.botVaultId, params.streamType),
      botVaultId: params.botVaultId,
      streamType: params.streamType,
      cursorTs: params.cursorTs ?? null,
      cursorValue: params.cursorValue ?? null
    },
    update: {
      cursorTs: params.cursorTs ?? null,
      cursorValue: params.cursorValue ?? null
    }
  });
}

async function findOrderForUpsert(tx: any, params: {
  botVaultId: string;
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
}) {
  const exchangeOrderId = String(params.exchangeOrderId ?? "").trim();
  const clientOrderId = String(params.clientOrderId ?? "").trim();
  if (!exchangeOrderId && !clientOrderId) return null;
  return tx.botOrder.findFirst({
    where: {
      botVaultId: params.botVaultId,
      OR: [
        ...(exchangeOrderId ? [{ exchangeOrderId }] : []),
        ...(clientOrderId ? [{ clientOrderId }] : [])
      ]
    }
  });
}

async function upsertOrder(tx: any, params: {
  botVaultId: string;
  row: ReturnType<typeof normalizeOrderRow> extends infer T ? Exclude<T, null> : never;
}) {
  const existing = await findOrderForUpsert(tx, {
    botVaultId: params.botVaultId,
    exchangeOrderId: params.row.exchangeOrderId,
    clientOrderId: params.row.clientOrderId
  });
  if (existing) {
    await tx.botOrder.update({
      where: { id: existing.id },
      data: {
        exchange: "hyperliquid",
        symbol: params.row.symbol,
        side: params.row.side,
        orderType: params.row.orderType,
        status: params.row.status,
        clientOrderId: params.row.clientOrderId,
        exchangeOrderId: params.row.exchangeOrderId,
        price: params.row.price,
        qty: params.row.qty,
        reduceOnly: params.row.reduceOnly,
        metadata: params.row.metadata
      }
    });
    return { id: String(existing.id), created: false };
  }

  const created = await tx.botOrder.create({
    data: {
      botVaultId: params.botVaultId,
      exchange: "hyperliquid",
      symbol: params.row.symbol,
      side: params.row.side,
      orderType: params.row.orderType,
      status: params.row.status,
      clientOrderId: params.row.clientOrderId,
      exchangeOrderId: params.row.exchangeOrderId,
      price: params.row.price,
      qty: params.row.qty,
      reduceOnly: params.row.reduceOnly,
      metadata: params.row.metadata,
      createdAt: params.row.createdAt,
      updatedAt: params.row.createdAt
    }
  });
  return { id: String(created.id), created: true };
}

async function findFillForUpsert(tx: any, params: {
  botVaultId: string;
  exchangeFillId?: string | null;
  exchangeOrderId?: string | null;
  price: number;
  qty: number;
  fillTs: Date;
}) {
  const exchangeFillId = String(params.exchangeFillId ?? "").trim();
  if (exchangeFillId) {
    const byId = await tx.botFill.findFirst({
      where: {
        botVaultId: params.botVaultId,
        exchangeFillId
      }
    });
    if (byId) return byId;
  }
  return tx.botFill.findFirst({
    where: {
      botVaultId: params.botVaultId,
      exchangeOrderId: params.exchangeOrderId ?? null,
      price: params.price,
      qty: params.qty,
      fillTs: params.fillTs
    }
  });
}

async function upsertFill(tx: any, params: {
  botVaultId: string;
  botOrderId?: string | null;
  row: ReturnType<typeof normalizeFillRow> extends infer T ? Exclude<T, null> : never;
}) {
  const existing = await findFillForUpsert(tx, {
    botVaultId: params.botVaultId,
    exchangeFillId: params.row.exchangeFillId,
    exchangeOrderId: params.row.exchangeOrderId,
    price: params.row.price,
    qty: params.row.qty,
    fillTs: params.row.fillTs
  });
  if (existing) return { id: String(existing.id), created: false };

  const created = await tx.botFill.create({
    data: {
      botVaultId: params.botVaultId,
      botOrderId: params.botOrderId ?? null,
      exchangeFillId: params.row.exchangeFillId,
      exchangeOrderId: params.row.exchangeOrderId,
      side: params.row.side,
      symbol: params.row.symbol,
      price: params.row.price,
      qty: params.row.qty,
      notional: params.row.notional,
      feeAmount: params.row.feeAmount,
      realizedPnl: params.row.realizedPnl,
      fillTs: params.row.fillTs,
      metadata: params.row.metadata,
      createdAt: params.row.fillTs
    }
  });
  return { id: String(created.id), created: true };
}

async function createFundingIfNew(tx: any, params: {
  botVaultId: string;
  row: ReturnType<typeof normalizeFundingRow> extends infer T ? Exclude<T, null> : never;
}) {
  try {
    const created = await tx.botFundingEvent.create({
      data: {
        botVaultId: params.botVaultId,
        exchange: "hyperliquid",
        symbol: params.row.symbol,
        amount: params.row.amount,
        positionSide: params.row.positionSide,
        sourceKey: params.row.sourceKey,
        fundingTs: params.row.fundingTs,
        metadata: params.row.metadata,
        createdAt: params.row.fundingTs
      }
    });
    return { id: String(created.id), created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return { id: null, created: false };
  }
}

function mapAggregate(row: any): BotVaultAggregateSnapshot {
  return {
    botVaultId: String(row.botVaultId),
    grossRealizedPnl: roundMoney(row.grossRealizedPnl ?? 0),
    tradingFeesTotal: roundMoney(row.tradingFeesTotal ?? 0),
    fundingTotal: roundMoney(row.fundingTotal ?? 0),
    realizedPnlNet: roundMoney(row.realizedPnlNet ?? 0),
    netWithdrawableProfit: roundMoney(row.netWithdrawableProfit ?? 0),
    isFlat: Boolean(row.isFlat),
    openPositionCount: Math.max(0, Math.trunc(Number(row.openPositionCount ?? 0))),
    lastFillTs: toIso(row.lastFillTs),
    lastFundingTs: toIso(row.lastFundingTs),
    lastReconciledAt: toIso(row.lastReconciledAt),
    sourceVersion: Math.max(1, Math.trunc(Number(row.sourceVersion ?? SOURCE_VERSION))),
    metadata: toMetadata(row.metadata)
  };
}

async function computeAggregate(tx: any, botVault: EligibleBotVaultRow, snapshot: {
  positions: Array<Record<string, unknown>>;
  accountState: Record<string, unknown>;
  reconciledAt: Date;
}) {
  const fills = await tx.botFill.findMany({
    where: { botVaultId: botVault.id },
    orderBy: [{ fillTs: "desc" }]
  });
  const fundingEvents = await tx.botFundingEvent.findMany({
    where: { botVaultId: botVault.id },
    orderBy: [{ fundingTs: "desc" }]
  });

  const grossRealizedPnl = roundMoney(
    fills.reduce((sum: number, row: any) => sum + Number(row.realizedPnl ?? 0), 0)
  );
  const tradingFeesTotal = roundMoney(
    fills.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.feeAmount ?? 0)), 0)
  );
  const fundingTotal = roundMoney(
    fundingEvents.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
  );
  const realizedPnlNet = roundMoney(grossRealizedPnl - tradingFeesTotal + fundingTotal);
  const openPositionCount = snapshot.positions.filter((row) => Math.abs(Number(row.size ?? row.szi ?? 0)) > EPSILON).length;
  const isFlat = openPositionCount === 0;
  const principalOutstandingUsd = Math.max(0, Number(botVault.principalAllocated ?? 0) - Number(botVault.principalReturned ?? 0));
  const availableProfitCapacity = Math.max(0, Number(botVault.availableUsd ?? 0) - principalOutstandingUsd);
  const netWithdrawableProfit = isFlat
    ? roundMoney(Math.min(availableProfitCapacity, Math.max(0, realizedPnlNet)))
    : 0;
  const lastFillTs = fills[0]?.fillTs instanceof Date ? fills[0].fillTs : null;
  const lastFundingTs = fundingEvents[0]?.fundingTs instanceof Date ? fundingEvents[0].fundingTs : null;

  const metadata = {
    latestPositionSnapshot: snapshot.positions,
    latestAccountState: snapshot.accountState,
    principalOutstandingUsd: roundMoney(principalOutstandingUsd),
    availableUsd: roundMoney(botVault.availableUsd),
    gridSymbol: botVault.gridInstance?.template?.symbol ? String(botVault.gridInstance.template.symbol) : null
  };

  const aggregate = await tx.botVaultPnlAggregate.upsert({
    where: { botVaultId: botVault.id },
    create: {
      botVaultId: botVault.id,
      grossRealizedPnl,
      tradingFeesTotal,
      fundingTotal,
      realizedPnlNet,
      netWithdrawableProfit,
      isFlat,
      openPositionCount,
      lastFillTs,
      lastFundingTs,
      lastReconciledAt: snapshot.reconciledAt,
      sourceVersion: SOURCE_VERSION,
      metadata
    },
    update: {
      grossRealizedPnl,
      tradingFeesTotal,
      fundingTotal,
      realizedPnlNet,
      netWithdrawableProfit,
      isFlat,
      openPositionCount,
      lastFillTs,
      lastFundingTs,
      lastReconciledAt: snapshot.reconciledAt,
      sourceVersion: SOURCE_VERSION,
      metadata
    }
  });

  await tx.botVault.update({
    where: { id: botVault.id },
    data: {
      realizedPnlNet,
      realizedGrossUsd: grossRealizedPnl,
      realizedFeesUsd: tradingFeesTotal,
      realizedNetUsd: realizedPnlNet,
      lastAccountingAt: snapshot.reconciledAt,
      executionMetadata: {
        ...toRecord(botVault.executionMetadata),
        tradingReconciliation: {
          lastReconciledAt: snapshot.reconciledAt.toISOString(),
          sourceVersion: SOURCE_VERSION,
          isFlat,
          openPositionCount,
          latestPositionSnapshot: snapshot.positions,
          latestAccountState: snapshot.accountState
        }
      }
    }
  });

  return mapAggregate(aggregate);
}

async function sumFeeAccrual(tx: any, botVaultId: string): Promise<number> {
  const rows = await tx.feeEvent.findMany({
    where: { botVaultId },
    select: { feeAmount: true }
  }).catch(() => []);
  return roundMoney(
    rows.reduce((sum: number, row: any) => sum + Number(row?.feeAmount ?? 0), 0),
    6
  );
}

function buildTradingReconciliationResult(params: {
  botVault: EligibleBotVaultRow;
  previousAggregate: any | null;
  aggregate: BotVaultAggregateSnapshot;
  positions: Array<Record<string, unknown>>;
  accountState: Record<string, unknown>;
  feeAccruedTotal: number;
  observedAt: Date;
}): VaultReconciliationResult {
  const items: VaultReconciliationItem[] = [];
  const storedAvailableUsd = roundMoney(params.botVault.availableUsd ?? 0, 6);
  const availableBalanceUsd = readAvailableBalanceUsd(params.accountState);
  items.push(buildNumericDriftItem({
    kind: "balances",
    label: "balance",
    expected: storedAvailableUsd,
    actual: availableBalanceUsd,
    threshold: BALANCE_DRIFT_THRESHOLD_USD,
    metadata: {
      accountStateBalanceField: availableBalanceUsd === null ? null : "derived_available_balance"
    }
  }));

  const hasPriorAccounting = params.previousAggregate || params.botVault.lastAccountingAt;
  const realizedExpected = hasPriorAccounting ? roundMoney(params.botVault.realizedPnlNet ?? 0, 6) : roundMoney(params.aggregate.realizedPnlNet, 6);
  items.push(buildNumericDriftItem({
    kind: "realized_pnl",
    label: "realized_pnl",
    expected: realizedExpected,
    actual: roundMoney(params.aggregate.realizedPnlNet, 6),
    threshold: REALIZED_PNL_DRIFT_THRESHOLD_USD,
    allowWarningWhenUnavailable: false
  }));

  const previousExposureCount = params.previousAggregate
    ? Math.max(0, Math.trunc(Number(params.previousAggregate.openPositionCount ?? 0)))
    : Math.max(0, Math.trunc(Number(params.positions.filter((row) => Math.abs(Number(row.size ?? row.szi ?? 0)) > EPSILON).length)));
  const currentExposureCount = Math.max(0, Math.trunc(Number(params.aggregate.openPositionCount ?? 0)));
  const exposureChanged = previousExposureCount !== currentExposureCount
    || (params.previousAggregate ? Boolean(params.previousAggregate.isFlat) !== Boolean(params.aggregate.isFlat) : false);
  items.push({
    kind: "open_position_exposure",
    status: exposureChanged ? "drift_detected" : "clean",
    message: exposureChanged ? "open_position_exposure_drift_detected" : "open_position_exposure_aligned",
    expected: previousExposureCount,
    actual: currentExposureCount,
    delta: currentExposureCount - previousExposureCount,
    threshold: 0,
    metadata: {
      previousIsFlat: params.previousAggregate ? Boolean(params.previousAggregate.isFlat) : null,
      currentIsFlat: Boolean(params.aggregate.isFlat)
    }
  });

  const expectedFeeAccrual = hasPriorAccounting
    ? roundMoney(params.botVault.feePaidTotal ?? params.botVault.profitShareAccruedUsd ?? 0, 6)
    : roundMoney(params.feeAccruedTotal, 6);
  items.push(buildNumericDriftItem({
    kind: "fee_accrual",
    label: "fee_accrual",
    expected: expectedFeeAccrual,
    actual: roundMoney(params.feeAccruedTotal, 6),
    threshold: FEE_DRIFT_THRESHOLD_USD,
    allowWarningWhenUnavailable: false
  }));

  return buildVaultReconciliationResult({
    scope: "trading",
    entityType: "bot_vault",
    entityId: params.botVault.id,
    observedAt: params.observedAt,
    items,
    metadata: {
      availableUsd: storedAvailableUsd,
      aggregateRealizedPnlNet: params.aggregate.realizedPnlNet,
      openPositionCount: params.aggregate.openPositionCount,
      feeAccruedTotal: params.feeAccruedTotal
    }
  });
}

export function createBotVaultTradingReconciliationService(db: any, deps?: CreateTradingReconciliationServiceDeps) {
  const logger = deps?.logger ?? defaultLogger;
  const createReadAdapter = deps?.createReadAdapter ?? createDefaultReadAdapter;

  async function shouldUseReconciliationForBotVault(botVault: any): Promise<boolean> {
    const provider = String(botVault?.executionProvider ?? "").trim().toLowerCase();
    if (provider !== "hyperliquid") return false;
    const mode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
    return isOnchainMode(mode as any);
  }

  async function getEligibleBotVaults(limit: number): Promise<EligibleBotVaultRow[]> {
    const rows = await db.botVault.findMany({
      where: {
        status: {
          not: "CLOSED"
        },
        executionProvider: {
          equals: "hyperliquid",
          mode: "insensitive"
        }
      },
      select: {
        id: true,
        userId: true,
        gridInstanceId: true,
        agentWallet: true,
        vaultAddress: true,
        masterVault: {
          select: {
            onchainAddress: true,
            agentWallet: true
          }
        },
        executionProvider: true,
        executionStatus: true,
        executionMetadata: true,
        principalAllocated: true,
        principalReturned: true,
        availableUsd: true,
        realizedPnlNet: true,
        feePaidTotal: true,
        profitShareAccruedUsd: true,
        lastAccountingAt: true,
        createdAt: true,
        updatedAt: true,
        gridInstance: {
          select: {
            id: true,
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
        }
      },
      orderBy: [{ updatedAt: "asc" }],
      take: limit
    });

    return rows
      .map((row: any) => ({
        id: String(row.id),
        userId: String(row.userId),
        gridInstanceId: String(row.gridInstanceId),
        agentWallet: row.masterVault?.agentWallet ? String(row.masterVault.agentWallet) : row.agentWallet ? String(row.agentWallet) : null,
        vaultAddress: row.vaultAddress ? String(row.vaultAddress) : null,
        masterVaultAddress: row.masterVault?.onchainAddress ? String(row.masterVault.onchainAddress) : null,
        executionProvider: row.executionProvider ? String(row.executionProvider) : null,
        executionStatus: row.executionStatus ? String(row.executionStatus) : null,
        executionMetadata: toMetadata(row.executionMetadata),
        principalAllocated: Number(row.principalAllocated ?? 0),
        principalReturned: Number(row.principalReturned ?? 0),
        availableUsd: Number(row.availableUsd ?? 0),
        realizedPnlNet: Number(row.realizedPnlNet ?? 0),
        feePaidTotal: Number(row.feePaidTotal ?? 0),
        profitShareAccruedUsd: Number(row.profitShareAccruedUsd ?? 0),
        lastAccountingAt: row.lastAccountingAt instanceof Date ? row.lastAccountingAt : row.lastAccountingAt ? new Date(row.lastAccountingAt) : null,
        createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
        gridInstance: row.gridInstance
          ? {
              id: String(row.gridInstance.id),
              template: row.gridInstance.template
                ? { symbol: row.gridInstance.template.symbol ? String(row.gridInstance.template.symbol) : null }
                : null,
              exchangeAccount: row.gridInstance.exchangeAccount
                ? { exchange: row.gridInstance.exchangeAccount.exchange ? String(row.gridInstance.exchangeAccount.exchange) : null }
                : null
            }
          : null
      }))
      .filter((row) =>
        String(row.gridInstance?.exchangeAccount?.exchange ?? "").trim().toLowerCase() === "hyperliquid"
        && typeof row.agentWallet === "string"
        && row.agentWallet.trim().length > 0
      );
  }

  async function getBotVaultById(params: { userId?: string; botVaultId: string; tx?: any }) {
    const client = params.tx ?? db;
    const row = await client.botVault.findFirst({
      where: {
        id: params.botVaultId,
        ...(params.userId ? { userId: params.userId } : {})
      },
      select: {
        id: true,
        userId: true,
        gridInstanceId: true,
        agentWallet: true,
        vaultAddress: true,
        masterVault: {
          select: {
            onchainAddress: true,
            agentWallet: true
          }
        },
        executionProvider: true,
        executionStatus: true,
        executionMetadata: true,
        principalAllocated: true,
        principalReturned: true,
        availableUsd: true,
        realizedPnlNet: true,
        feePaidTotal: true,
        profitShareAccruedUsd: true,
        lastAccountingAt: true,
        createdAt: true,
        updatedAt: true,
        gridInstance: {
          select: {
            id: true,
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
        }
      }
    });
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      gridInstanceId: String(row.gridInstanceId),
      agentWallet: row.masterVault?.agentWallet ? String(row.masterVault.agentWallet) : row.agentWallet ? String(row.agentWallet) : null,
      vaultAddress: row.vaultAddress ? String(row.vaultAddress) : null,
      masterVaultAddress: row.masterVault?.onchainAddress ? String(row.masterVault.onchainAddress) : null,
      executionProvider: row.executionProvider ? String(row.executionProvider) : null,
      executionStatus: row.executionStatus ? String(row.executionStatus) : null,
      executionMetadata: toMetadata(row.executionMetadata),
      principalAllocated: Number(row.principalAllocated ?? 0),
      principalReturned: Number(row.principalReturned ?? 0),
      availableUsd: Number(row.availableUsd ?? 0),
      realizedPnlNet: Number(row.realizedPnlNet ?? 0),
      feePaidTotal: Number(row.feePaidTotal ?? 0),
      profitShareAccruedUsd: Number(row.profitShareAccruedUsd ?? 0),
      lastAccountingAt: row.lastAccountingAt instanceof Date ? row.lastAccountingAt : row.lastAccountingAt ? new Date(row.lastAccountingAt) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
      gridInstance: row.gridInstance
        ? {
            id: String(row.gridInstance.id),
            template: row.gridInstance.template
              ? { symbol: row.gridInstance.template.symbol ? String(row.gridInstance.template.symbol) : null }
              : null,
            exchangeAccount: row.gridInstance.exchangeAccount
              ? { exchange: row.gridInstance.exchangeAccount.exchange ? String(row.gridInstance.exchangeAccount.exchange) : null }
              : null
          }
        : null
    } satisfies EligibleBotVaultRow;
  }

  async function readAggregate(params: { userId?: string; botVaultId: string; tx?: any }) {
    const client = params.tx ?? db;
    const botVault = await getBotVaultById({ userId: params.userId, botVaultId: params.botVaultId, tx: client });
    if (!botVault) return null;
    const aggregate = await client.botVaultPnlAggregate.findUnique({
      where: { botVaultId: botVault.id }
    });
    if (!aggregate) return null;
    return mapAggregate(aggregate);
  }

  async function getFeeBasisForBotVault(params: { userId: string; botVaultId: string; tx?: any }): Promise<FeeBasisResult> {
    const client = params.tx ?? db;
    const botVault = await getBotVaultById({ userId: params.userId, botVaultId: params.botVaultId, tx: client });
    if (!botVault) throw new Error("bot_vault_not_found");
    if (!(await shouldUseReconciliationForBotVault(botVault))) {
      return {
        source: "legacy",
        realizedPnlNetUsd: Number(botVault.realizedPnlNet ?? 0),
        isFlat: true,
        netWithdrawableProfitUsd: null,
        aggregate: null
      };
    }
    const aggregate = await client.botVaultPnlAggregate.findUnique({
      where: { botVaultId: botVault.id }
    });
    if (!aggregate) {
      throw new Error("bot_vault_reconciliation_unavailable");
    }
    if (!(aggregate.lastReconciledAt instanceof Date)) {
      throw new Error("bot_vault_report_not_ready");
    }
    return {
      source: "reconciliation",
      realizedPnlNetUsd: Number(aggregate.realizedPnlNet ?? 0),
      isFlat: Boolean(aggregate.isFlat),
      netWithdrawableProfitUsd: Number(aggregate.netWithdrawableProfit ?? 0),
      aggregate
    };
  }

  async function reconcileBotVault(params: { botVaultId: string }): Promise<ReconcileVaultResult> {
    const mode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
    if (!isOnchainMode(mode as any)) {
      throw new Error("vault_execution_mode_offchain_shadow");
    }

    const botVault = await getBotVaultById({ botVaultId: params.botVaultId });
    if (!botVault) throw new Error("bot_vault_not_found");
    if (!(await shouldUseReconciliationForBotVault(botVault))) {
      throw new Error("bot_vault_reconciliation_unavailable");
    }
    if (!botVault.agentWallet) {
      throw new Error("bot_vault_agent_wallet_missing");
    }

    const fillsCursor = await db.botVaultReconciliationCursor.findUnique({
      where: { id: cursorId(botVault.id, "fills") }
    }).catch(() => null);
    const fundingCursor = await db.botVaultReconciliationCursor.findUnique({
      where: { id: cursorId(botVault.id, "funding") }
    }).catch(() => null);
    const now = new Date();
    const defaultStart = subtractMs(botVault.createdAt, INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fillsStart = startCursorFromRow(fillsCursor, defaultStart);
    const fundingStart = startCursorFromRow(fundingCursor, defaultStart);

    const adapter = await createReadAdapter({
      botVaultId: botVault.id,
      agentWallet: botVault.agentWallet,
      createdAt: botVault.createdAt,
      vaultAddress: resolveHyperliquidExecutionVaultAddress({
        executionMetadata: botVault.executionMetadata,
        vaultAddress: botVault.vaultAddress,
        masterVaultAddress: botVault.masterVaultAddress
      })
    });

    try {
      const [fillsResult, openOrdersResult, orderHistoryResult, fundingResult, positions, accountState] = await Promise.all([
        adapter.getFills({ startTime: fillsStart.getTime(), endTime: now.getTime() }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ),
        adapter.getOpenOrders().then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ),
        adapter.getOrderHistory({ startTime: fillsStart.getTime(), endTime: now.getTime() }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ),
        adapter.getFunding({ startTime: fundingStart.getTime(), endTime: now.getTime() }).then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ),
        adapter.getPositions(),
        adapter.getAccountState()
      ]);

      const readErrors: Array<{ endpoint: string; reason: string }> = [];
      const rawFills = fillsResult.ok ? fillsResult.value : [];
      const rawOpenOrders = openOrdersResult.ok ? openOrdersResult.value : [];
      const rawOrderHistory = orderHistoryResult.ok ? orderHistoryResult.value : [];
      const rawFunding = fundingResult.ok ? fundingResult.value : [];
      if (!fillsResult.ok) readErrors.push({ endpoint: "userFillsByTime", reason: String(fillsResult.error) });
      if (!openOrdersResult.ok) readErrors.push({ endpoint: "frontendOpenOrders", reason: String(openOrdersResult.error) });
      if (!orderHistoryResult.ok) readErrors.push({ endpoint: "userOrderHistory", reason: String(orderHistoryResult.error) });
      if (!fundingResult.ok) readErrors.push({ endpoint: "userFunding", reason: String(fundingResult.error) });
      if (readErrors.length > 0) {
        logger.warn("bot_vault_trading_reconciliation_read_degraded", {
          botVaultId: botVault.id,
          userId: botVault.userId,
          readErrors
        });
      }

      const normalizedOrders = [...rawOpenOrders, ...rawOrderHistory]
        .map((row) => normalizeOrderRow(adapter, row))
        .filter((row): row is Exclude<ReturnType<typeof normalizeOrderRow>, null> => Boolean(row));
      const normalizedFills = rawFills
        .map((row) => normalizeFillRow(adapter, row))
        .filter((row): row is Exclude<ReturnType<typeof normalizeFillRow>, null> => Boolean(row))
        .sort((a, b) => a.fillTs.getTime() - b.fillTs.getTime());
      const normalizedFunding = rawFunding
        .map((row) => normalizeFundingRow(adapter, row))
        .filter((row): row is Exclude<ReturnType<typeof normalizeFundingRow>, null> => Boolean(row))
        .sort((a, b) => a.fundingTs.getTime() - b.fundingTs.getTime());

      return db.$transaction(async (tx: any) => {
        const previousAggregate = await tx.botVaultPnlAggregate.findUnique({
          where: { botVaultId: botVault.id }
        }).catch(() => null);
        let newOrders = 0;
        let newFills = 0;
        let newFundingEvents = 0;
        const orderIdByExchangeKey = new Map<string, string>();

        for (const order of normalizedOrders) {
          const stored = await upsertOrder(tx, {
            botVaultId: botVault.id,
            row: order
          });
          if (stored.created) newOrders += 1;
          if (order.exchangeOrderId) orderIdByExchangeKey.set(order.exchangeOrderId, stored.id);
          if (order.clientOrderId) orderIdByExchangeKey.set(order.clientOrderId, stored.id);
        }

        for (const fill of normalizedFills) {
          const orderRefKey = fill.exchangeOrderId ? String(fill.exchangeOrderId) : "";
          const botOrderId = orderRefKey ? orderIdByExchangeKey.get(orderRefKey) ?? null : null;
          const stored = await upsertFill(tx, {
            botVaultId: botVault.id,
            botOrderId,
            row: fill
          });
          if (stored.created) newFills += 1;
        }

        for (const funding of normalizedFunding) {
          const stored = await createFundingIfNew(tx, {
            botVaultId: botVault.id,
            row: funding
          });
          if (stored.created) newFundingEvents += 1;
        }

        const aggregate = await computeAggregate(tx, botVault, {
          positions,
          accountState,
          reconciledAt: now
        });
        const feeAccruedTotal = await sumFeeAccrual(tx, botVault.id);
        const reconciliation = buildTradingReconciliationResult({
          botVault,
          previousAggregate,
          aggregate,
          positions,
          accountState,
          feeAccruedTotal,
          observedAt: now
        });
        await tx.botVault.update({
          where: { id: botVault.id },
          data: {
            executionMetadata: {
              ...toRecord(botVault.executionMetadata),
              tradingReconciliation: {
                ...toRecord(toRecord(botVault.executionMetadata).tradingReconciliation),
                lastReconciledAt: now.toISOString(),
                sourceVersion: SOURCE_VERSION,
                isFlat: aggregate.isFlat,
                openPositionCount: aggregate.openPositionCount,
                latestPositionSnapshot: positions,
                latestAccountState: accountState,
                readErrors,
                result: reconciliation
              }
            }
          }
        });

        await upsertReconciliationCursor(tx, {
          botVaultId: botVault.id,
          streamType: "fills",
          cursorTs: normalizedFills.at(-1)?.fillTs ?? now
        });
        await upsertReconciliationCursor(tx, {
          botVaultId: botVault.id,
          streamType: "funding",
          cursorTs: normalizedFunding.at(-1)?.fundingTs ?? now
        });
        await upsertReconciliationCursor(tx, {
          botVaultId: botVault.id,
          streamType: "positions",
          cursorTs: now,
          cursorValue: JSON.stringify({
            openPositionCount: aggregate.openPositionCount,
            isFlat: aggregate.isFlat
          })
        });

        logger.info("bot_vault_trading_reconciliation_applied", {
          botVaultId: botVault.id,
          userId: botVault.userId,
          gridInstanceId: botVault.gridInstanceId,
          newOrders,
          newFills,
          newFundingEvents,
          realizedPnlNet: aggregate.realizedPnlNet,
          isFlat: aggregate.isFlat,
          openPositionCount: aggregate.openPositionCount,
          reconciliationStatus: reconciliation.status,
          reconciliationDriftCount: reconciliation.driftCount
        });

        return {
          botVaultId: botVault.id,
          newOrders,
          newFills,
          newFundingEvents,
          aggregate,
          reconciliation
        };
      }, {
        maxWait: 5_000,
        timeout: 60_000
      });
    } catch (error) {
      const blocked = buildVaultReconciliationResult({
        scope: "trading",
        entityType: "bot_vault",
        entityId: botVault.id,
        observedAt: new Date(),
        blockedReasons: [String(error)],
        metadata: {
          executionProvider: botVault.executionProvider,
          executionStatus: botVault.executionStatus
        }
      });
      await db.botVault.update({
        where: { id: botVault.id },
        data: {
          executionLastError: String(error),
          executionLastErrorAt: new Date(),
          executionMetadata: {
            ...toRecord(botVault.executionMetadata),
            tradingReconciliation: {
              ...toRecord(toRecord(botVault.executionMetadata).tradingReconciliation),
              lastError: String(error),
              lastErrorAt: new Date().toISOString(),
              result: blocked
            }
          }
        }
      }).catch(() => {
        // best effort only
      });
      logger.warn("bot_vault_trading_reconciliation_failed", {
        botVaultId: botVault.id,
        userId: botVault.userId,
        error: String(error)
      });
      throw error;
    } finally {
      await adapter.close().catch(() => {
        // ignore close failures
      });
    }
  }

  async function reconcileHyperliquidBotVaults(params?: { limit?: number }): Promise<ReconcileSummary> {
    const mode = await getEffectiveVaultExecutionMode(db).catch(() => "offchain_shadow");
    if (!isOnchainMode(mode as any)) {
      return {
        scanned: 0,
        processed: 0,
        failed: 0,
        newOrders: 0,
        newFills: 0,
        newFundingEvents: 0,
        statusCounts: {
          clean: 0,
          warning: 0,
          drift_detected: 0,
          blocked: 0
        }
      };
    }

    const limit = Math.max(1, Math.min(500, Math.trunc(Number(params?.limit ?? 100))));
    const botVaults = await getEligibleBotVaults(limit);
    let processed = 0;
    let failed = 0;
    let newOrders = 0;
    let newFills = 0;
    let newFundingEvents = 0;
    const statusCounts: Record<VaultReconciliationStatus, number> = {
      clean: 0,
      warning: 0,
      drift_detected: 0,
      blocked: 0
    };

    for (const botVault of botVaults) {
      try {
        const result = await reconcileBotVault({ botVaultId: botVault.id });
        processed += 1;
        newOrders += result.newOrders;
        newFills += result.newFills;
        newFundingEvents += result.newFundingEvents;
        statusCounts[result.reconciliation.status] += 1;
      } catch {
        failed += 1;
        statusCounts.blocked += 1;
      }
    }

    return {
      scanned: botVaults.length,
      processed,
      failed,
      newOrders,
      newFills,
      newFundingEvents,
      statusCounts
    };
  }

  async function getBotVaultPnlReport(params: {
    userId: string;
    botVaultId: string;
    fillsLimit?: number;
  }): Promise<BotVaultPnlReport> {
    const botVault = await getBotVaultById({ userId: params.userId, botVaultId: params.botVaultId });
    if (!botVault) throw new Error("bot_vault_not_found");
    const aggregate = await db.botVaultPnlAggregate.findUnique({
      where: { botVaultId: botVault.id }
    });
    if (!aggregate) throw new Error("bot_vault_report_not_ready");

    const fillsLimit = Math.max(1, Math.min(100, Math.trunc(Number(params.fillsLimit ?? 20))));
    const fills = await db.botFill.findMany({
      where: { botVaultId: botVault.id },
      orderBy: [{ fillTs: "desc" }],
      take: fillsLimit
    });
    const metadata = toRecord(aggregate.metadata);

    return {
      botVaultId: botVault.id,
      isFlat: Boolean(aggregate.isFlat),
      grossRealizedPnl: roundMoney(aggregate.grossRealizedPnl),
      tradingFeesTotal: roundMoney(aggregate.tradingFeesTotal),
      fundingTotal: roundMoney(aggregate.fundingTotal),
      realizedPnlNet: roundMoney(aggregate.realizedPnlNet),
      netWithdrawableProfit: roundMoney(aggregate.netWithdrawableProfit),
      openPositionCount: Math.max(0, Math.trunc(Number(aggregate.openPositionCount ?? 0))),
      lastReconciledAt: toIso(aggregate.lastReconciledAt),
      latestPositionSnapshot: metadata.latestPositionSnapshot ?? null,
      fillsPreview: fills.map((row: any) => ({
        id: String(row.id),
        exchangeFillId: row.exchangeFillId ? String(row.exchangeFillId) : null,
        exchangeOrderId: row.exchangeOrderId ? String(row.exchangeOrderId) : null,
        symbol: String(row.symbol),
        side: String(row.side),
        price: Number(row.price ?? 0),
        qty: Number(row.qty ?? 0),
        notional: Number(row.notional ?? 0),
        feeAmount: Number(row.feeAmount ?? 0),
        realizedPnl: row.realizedPnl == null ? null : Number(row.realizedPnl),
        fillTs: toIso(row.fillTs),
        metadata: row.metadata ?? null
      }))
    };
  }

  async function getBotVaultAudit(params: {
    userId: string;
    botVaultId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BotVaultAuditResult> {
    const botVault = await getBotVaultById({ userId: params.userId, botVaultId: params.botVaultId });
    if (!botVault) throw new Error("bot_vault_not_found");

    const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit ?? 50))));
    const cursorDate = params.cursor ? toTimestamp(params.cursor) : null;
    const beforeDate = cursorDate ?? new Date("9999-12-31T23:59:59.999Z");

    const [orders, fills, funding, feeEvents] = await Promise.all([
      db.botOrder.findMany({
        where: {
          botVaultId: botVault.id,
          createdAt: { lt: beforeDate }
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit
      }),
      db.botFill.findMany({
        where: {
          botVaultId: botVault.id,
          fillTs: { lt: beforeDate }
        },
        orderBy: [{ fillTs: "desc" }],
        take: limit
      }),
      db.botFundingEvent.findMany({
        where: {
          botVaultId: botVault.id,
          fundingTs: { lt: beforeDate }
        },
        orderBy: [{ fundingTs: "desc" }],
        take: limit
      }),
      db.feeEvent.findMany({
        where: {
          botVaultId: botVault.id,
          createdAt: { lt: beforeDate }
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit
      })
    ]);

    const items: AuditItem[] = [
      ...orders.map((row: any) => ({
        kind: "order" as const,
        ts: toIso(row.createdAt) ?? new Date().toISOString(),
        id: String(row.id),
        payload: {
          exchangeOrderId: row.exchangeOrderId ? String(row.exchangeOrderId) : null,
          clientOrderId: row.clientOrderId ? String(row.clientOrderId) : null,
          symbol: String(row.symbol),
          side: String(row.side),
          orderType: String(row.orderType),
          status: String(row.status),
          price: row.price == null ? null : Number(row.price),
          qty: Number(row.qty ?? 0),
          reduceOnly: Boolean(row.reduceOnly),
          metadata: row.metadata ?? null
        }
      })),
      ...fills.map((row: any) => ({
        kind: "fill" as const,
        ts: toIso(row.fillTs) ?? new Date().toISOString(),
        id: String(row.id),
        payload: {
          exchangeFillId: row.exchangeFillId ? String(row.exchangeFillId) : null,
          exchangeOrderId: row.exchangeOrderId ? String(row.exchangeOrderId) : null,
          symbol: String(row.symbol),
          side: String(row.side),
          price: Number(row.price ?? 0),
          qty: Number(row.qty ?? 0),
          notional: Number(row.notional ?? 0),
          feeAmount: Number(row.feeAmount ?? 0),
          realizedPnl: row.realizedPnl == null ? null : Number(row.realizedPnl),
          metadata: row.metadata ?? null
        }
      })),
      ...funding.map((row: any) => ({
        kind: "funding" as const,
        ts: toIso(row.fundingTs) ?? new Date().toISOString(),
        id: String(row.id),
        payload: {
          exchange: String(row.exchange ?? "hyperliquid"),
          symbol: String(row.symbol),
          amount: Number(row.amount ?? 0),
          positionSide: row.positionSide ? String(row.positionSide) : null,
          metadata: row.metadata ?? null
        }
      })),
      ...feeEvents.map((row: any) => ({
        kind: "fee_event" as const,
        ts: toIso(row.createdAt) ?? new Date().toISOString(),
        id: String(row.id),
        payload: {
          eventType: String(row.eventType),
          profitBase: Number(row.profitBase ?? 0),
          feeAmount: Number(row.feeAmount ?? 0),
          sourceKey: row.sourceKey ? String(row.sourceKey) : null,
          metadata: row.metadata ?? null
        }
      }))
    ]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit);

    return {
      botVaultId: botVault.id,
      items,
      nextCursor: items.length === limit ? items[items.length - 1]?.ts ?? null : null
    };
  }

  return {
    reconcileBotVault,
    reconcileHyperliquidBotVaults,
    getBotVaultPnlReport,
    getBotVaultAudit,
    getBotVaultPnlAggregate: readAggregate,
    getFeeBasisForBotVault
  };
}

export type BotVaultTradingReconciliationService = ReturnType<typeof createBotVaultTradingReconciliationService>;
