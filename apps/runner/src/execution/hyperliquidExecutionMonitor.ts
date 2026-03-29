import type { FuturesPosition } from "@mm/futures-core";
import type { NormalizedOrder } from "@mm/futures-exchange";

export type OrderState =
  | "submitted"
  | "enqueued"
  | "open"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "stale";

export type OrderRecord = {
  key: string;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  liveOrderId: string | null;
  cloid: string | null;
  symbol: string | null;
  side: "buy" | "sell" | null;
  orderType: "market" | "limit" | null;
  price: number | null;
  qty: number | null;
  reduceOnly: boolean;
  state: OrderState;
  submittedAt: string | null;
  submittedTxHash: string | null;
  lastSeenLiveAt: string | null;
  cancelRequestedAt: string | null;
  filledQty: number;
  lastFillAt: string | null;
  metadata: Record<string, unknown>;
};

export type FillRecord = {
  key: string;
  exchangeFillId: string | null;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  cloid: string | null;
  symbol: string | null;
  side: "buy" | "sell" | null;
  fillPrice: number;
  fillQty: number;
  feeUsd: number;
  filledAt: string;
  raw: Record<string, unknown>;
};

export type VaultSnapshot = {
  capturedAt: string;
  equityUsd: number;
  availableMarginUsd: number;
  coreUsdcSpotBalanceUsd: number;
  liveOpenOrdersCount: number;
  totalPositionNotionalUsd: number;
  positions: Array<{
    symbol: string;
    side: "long" | "short";
    size: number;
    entryPrice: number | null;
    markPrice: number | null;
    notionalUsd: number;
    unrealizedPnl: number | null;
  }>;
};

export type ReconciliationDrift = {
  key: string;
  severity: "warning" | "critical";
  kind:
    | "local_open_missing_live"
    | "live_open_missing_local"
    | "cancel_delayed"
    | "submitted_not_visible";
  message: string;
  orderKey?: string;
};

export type ReconciliationAlert = {
  key: string;
  severity: "warning" | "critical";
  code: string;
  message: string;
  orderKey?: string;
};

export type ReconciliationResult = {
  at: string;
  status: "ok" | "warning" | "critical";
  orders: OrderRecord[];
  liveOpenOrders: NormalizedOrder[];
  recentFills: FillRecord[];
  newFills: FillRecord[];
  snapshot: VaultSnapshot | null;
  drifts: ReconciliationDrift[];
  alerts: ReconciliationAlert[];
  newAlerts: ReconciliationAlert[];
  statusChanges: Array<{
    orderKey: string;
    previousState: OrderState;
    nextState: OrderState;
  }>;
};

type MonitorOptions = {
  orderVisibilityTimeoutMs?: number;
  cancelVisibilityTimeoutMs?: number;
};

type SubmittedOrderInput = {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  symbol?: string | null;
  side?: "buy" | "sell" | null;
  orderType?: "market" | "limit" | null;
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean;
  txHash?: string | null;
  now?: Date;
  metadata?: Record<string, unknown> | null;
};

type LiveOrderRef = {
  key: string;
  order: NormalizedOrder;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  liveOrderId: string | null;
  cloid: string | null;
};

type AdapterLike = {
  listOpenOrders?: (params?: { symbol?: string }) => Promise<NormalizedOrder[]>;
  getPositions?: () => Promise<FuturesPosition[]>;
  getAccountState?: () => Promise<{ equity?: number; availableMargin?: number }>;
  getCoreUsdcSpotBalance?: () => Promise<{ amountUsd?: number }>;
  getRecentFills?: (params?: { symbol?: string; limit?: number }) => Promise<unknown[]>;
  tradeApi?: {
    getPendingOrders?: (params?: { symbol?: string; pageSize?: number }) => Promise<unknown[]>;
    getPendingPlanOrders?: (params?: { symbol?: string; pageSize?: number }) => Promise<unknown[]>;
    getFills?: (params?: { symbol?: string; limit?: number }) => Promise<unknown[]>;
  };
};

const monitorCache = new Map<string, HyperliquidExecutionMonitor>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeCloid(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const match = /^cloid:\d+:(\d+)$/.exec(text);
  if (match) return match[1] ?? null;
  if (/^\d+$/.test(text)) return text;
  return null;
}

function buildOrderKey(params: {
  clientOrderId?: string | null;
  exchangeOrderId?: string | null;
  cloid?: string | null;
}): string | null {
  const clientOrderId = toText(params.clientOrderId);
  if (clientOrderId) return `client:${clientOrderId}`;
  const cloid = normalizeCloid(params.cloid ?? params.exchangeOrderId);
  if (cloid) return `cloid:${cloid}`;
  const exchangeOrderId = toText(params.exchangeOrderId);
  if (exchangeOrderId) return `order:${exchangeOrderId}`;
  return null;
}

function isTerminalState(state: OrderState): boolean {
  return state === "filled" || state === "canceled" || state === "rejected" || state === "stale";
}

function compareStateRank(state: OrderState): number {
  switch (state) {
    case "submitted":
      return 1;
    case "enqueued":
      return 2;
    case "open":
      return 3;
    case "partially_filled":
      return 4;
    case "filled":
      return 5;
    case "canceled":
      return 5;
    case "rejected":
      return 5;
    case "stale":
      return 5;
    default:
      return 0;
  }
}

function toOrderStateFromOrderStatus(status: unknown): OrderState | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("cancel")) return "canceled";
  if (normalized.includes("reject")) return "rejected";
  if (normalized.includes("fill")) return "filled";
  if (normalized.includes("open") || normalized.includes("rest")) return "open";
  return null;
}

function normalizeLiveOrder(row: NormalizedOrder): LiveOrderRef {
  const raw = asRecord(row.raw);
  const clientOrderId =
    toText(raw?.clientOid)
    ?? toText(raw?.clientOrderId)
    ?? toText(raw?.clOrdId)
    ?? null;
  const liveOrderId = toText(row.orderId) ?? toText(raw?.oid) ?? null;
  const cloid = normalizeCloid(raw?.cloid);
  const key =
    buildOrderKey({
      clientOrderId,
      exchangeOrderId: liveOrderId,
      cloid
    })
    ?? `live:${liveOrderId ?? clientOrderId ?? Math.random().toString(36).slice(2, 10)}`;
  return {
    key,
    order: row,
    clientOrderId,
    exchangeOrderId: liveOrderId,
    liveOrderId,
    cloid
  };
}

function normalizeFillRecord(raw: unknown): FillRecord | null {
  const row = asRecord(raw);
  if (!row) return null;
  const fillPrice = toPositiveNumber(row.px ?? row.fillPrice ?? row.price);
  const fillQty = toPositiveNumber(row.sz ?? row.fillQty ?? row.qty);
  const filledAtRaw = row.time ?? row.timestamp ?? row.fillTime ?? row.fillTs;
  const filledAtDate = filledAtRaw instanceof Date
    ? filledAtRaw
    : new Date(Number.isFinite(Number(filledAtRaw)) ? Number(filledAtRaw) : String(filledAtRaw ?? ""));
  if (!fillPrice || !fillQty || Number.isNaN(filledAtDate.getTime())) return null;
  const exchangeFillId = toText(row.tid) ?? toText(row.fillId) ?? toText(row.id) ?? null;
  const exchangeOrderId = toText(row.oid) ?? toText(row.orderId) ?? null;
  const clientOrderId = toText(row.clientOid) ?? toText(row.clientOrderId) ?? null;
  const cloid = normalizeCloid(row.cloid);
  const symbol = toText(row.coin) ?? toText(row.symbol) ?? null;
  const sideRaw = String(row.side ?? "").trim().toLowerCase();
  const side: "buy" | "sell" | null = sideRaw.includes("b") || sideRaw.includes("buy") ? "buy" : sideRaw ? "sell" : null;
  const key = [
    exchangeFillId ?? "",
    exchangeOrderId ?? "",
    cloid ?? "",
    fillPrice.toFixed(8),
    fillQty.toFixed(8),
    filledAtDate.toISOString()
  ].join("|");
  return {
    key,
    exchangeFillId,
    exchangeOrderId,
    clientOrderId,
    cloid,
    symbol,
    side,
    fillPrice,
    fillQty,
    feeUsd: Number(row.fee ?? row.feeUsd ?? 0) || 0,
    filledAt: filledAtDate.toISOString(),
    raw: row
  };
}

function matchOrderRef(params: {
  record: OrderRecord;
  live: LiveOrderRef;
}): boolean {
  return Boolean(
    (params.record.clientOrderId && params.live.clientOrderId && params.record.clientOrderId === params.live.clientOrderId)
    || (params.record.cloid && params.live.cloid && params.record.cloid === params.live.cloid)
    || (params.record.liveOrderId && params.live.liveOrderId && params.record.liveOrderId === params.live.liveOrderId)
    || (params.record.exchangeOrderId && params.live.exchangeOrderId && params.record.exchangeOrderId === params.live.exchangeOrderId)
  );
}

function matchFillRef(params: {
  record: OrderRecord;
  fill: FillRecord;
}): boolean {
  return Boolean(
    (params.record.clientOrderId && params.fill.clientOrderId && params.record.clientOrderId === params.fill.clientOrderId)
    || (params.record.cloid && params.fill.cloid && params.record.cloid === params.fill.cloid)
    || (params.record.liveOrderId && params.fill.exchangeOrderId && params.record.liveOrderId === params.fill.exchangeOrderId)
    || (params.record.exchangeOrderId && params.fill.exchangeOrderId && params.record.exchangeOrderId === params.fill.exchangeOrderId)
  );
}

export function detectStateDrift(params: {
  localOrders: OrderRecord[];
  localOpenOrders: Array<{ clientOrderId?: string | null; exchangeOrderId?: string | null }>;
  liveOpenOrders: NormalizedOrder[];
  now?: Date;
  orderVisibilityTimeoutMs?: number;
  cancelVisibilityTimeoutMs?: number;
}): ReconciliationDrift[] {
  const nowMs = (params.now ?? new Date()).getTime();
  const orderVisibilityTimeoutMs = Math.max(5_000, Number(params.orderVisibilityTimeoutMs ?? 45_000));
  const cancelVisibilityTimeoutMs = Math.max(2_000, Number(params.cancelVisibilityTimeoutMs ?? 20_000));
  const drifts: ReconciliationDrift[] = [];
  const liveRefs = params.liveOpenOrders.map((row) => normalizeLiveOrder(row));

  for (const row of params.localOpenOrders) {
    const orderKey = buildOrderKey({
      clientOrderId: row.clientOrderId,
      exchangeOrderId: row.exchangeOrderId
    });
    const tracked = orderKey ? params.localOrders.find((item) => item.key === orderKey) ?? null : null;
    const matchedLive = liveRefs.some((live) =>
      (row.clientOrderId && live.clientOrderId === row.clientOrderId)
      || (row.exchangeOrderId && (live.exchangeOrderId === row.exchangeOrderId || live.cloid === normalizeCloid(row.exchangeOrderId)))
      || (tracked ? matchOrderRef({ record: tracked, live }) : false)
    );
    if (matchedLive) continue;
    const submittedAtMs = tracked?.submittedAt ? new Date(tracked.submittedAt).getTime() : 0;
    const ageMs = submittedAtMs > 0 ? nowMs - submittedAtMs : orderVisibilityTimeoutMs + 1;
    if (ageMs < orderVisibilityTimeoutMs) continue;
    drifts.push({
      key: `missing-live:${orderKey ?? row.clientOrderId ?? row.exchangeOrderId ?? "unknown"}`,
      severity: "warning",
      kind: "local_open_missing_live",
      message: "local order is tracked as open but is not visible on HyperCore",
      orderKey: orderKey ?? undefined
    });
  }

  for (const live of liveRefs) {
    const matchedLocal = params.localOpenOrders.some((row) =>
      (row.clientOrderId && live.clientOrderId === row.clientOrderId)
      || (row.exchangeOrderId && (live.exchangeOrderId === row.exchangeOrderId || live.cloid === normalizeCloid(row.exchangeOrderId)))
    );
    if (matchedLocal) continue;
    drifts.push({
      key: `missing-local:${live.key}`,
      severity: "warning",
      kind: "live_open_missing_local",
      message: "HyperCore reports an open order that is not tracked locally",
      orderKey: live.key
    });
  }

  for (const record of params.localOrders) {
    if (!record.cancelRequestedAt) continue;
    if (record.state !== "open" && record.state !== "partially_filled") continue;
    const cancelRequestedAtMs = new Date(record.cancelRequestedAt).getTime();
    if (!Number.isFinite(cancelRequestedAtMs) || nowMs - cancelRequestedAtMs < cancelVisibilityTimeoutMs) continue;
    drifts.push({
      key: `cancel-delay:${record.key}`,
      severity: "warning",
      kind: "cancel_delayed",
      message: "cancel was requested but the order is still open on HyperCore",
      orderKey: record.key
    });
  }

  return drifts;
}

export class HyperliquidExecutionMonitor {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly fills = new Map<string, FillRecord>();
  private readonly options: Required<MonitorOptions>;
  private lastResult: ReconciliationResult | null = null;

  constructor(options: MonitorOptions = {}) {
    this.options = {
      orderVisibilityTimeoutMs: Math.max(5_000, Number(options.orderVisibilityTimeoutMs ?? 45_000)),
      cancelVisibilityTimeoutMs: Math.max(2_000, Number(options.cancelVisibilityTimeoutMs ?? 20_000))
    };
  }

  recordSubmittedOrder(input: SubmittedOrderInput): OrderRecord {
    const now = input.now ?? new Date();
    const key = buildOrderKey({
      clientOrderId: input.clientOrderId,
      exchangeOrderId: input.exchangeOrderId
    });
    if (!key) {
      throw new Error("hyperliquid_monitor_order_ref_required");
    }
    const current = this.orders.get(key);
    const next: OrderRecord = {
      key,
      clientOrderId: toText(input.clientOrderId) ?? current?.clientOrderId ?? null,
      exchangeOrderId: toText(input.exchangeOrderId) ?? current?.exchangeOrderId ?? null,
      liveOrderId: current?.liveOrderId ?? null,
      cloid: normalizeCloid(input.exchangeOrderId) ?? current?.cloid ?? null,
      symbol: toText(input.symbol) ?? current?.symbol ?? null,
      side: input.side ?? current?.side ?? null,
      orderType: input.orderType ?? current?.orderType ?? null,
      price: toPositiveNumber(input.price) ?? current?.price ?? null,
      qty: toPositiveNumber(input.qty) ?? current?.qty ?? null,
      reduceOnly: input.reduceOnly === true || current?.reduceOnly === true,
      state: current?.state && compareStateRank(current.state) > compareStateRank("submitted") ? current.state : "submitted",
      submittedAt: current?.submittedAt ?? now.toISOString(),
      submittedTxHash: toText(input.txHash) ?? current?.submittedTxHash ?? null,
      lastSeenLiveAt: current?.lastSeenLiveAt ?? null,
      cancelRequestedAt: current?.cancelRequestedAt ?? null,
      filledQty: current?.filledQty ?? 0,
      lastFillAt: current?.lastFillAt ?? null,
      metadata: {
        ...(current?.metadata ?? {}),
        ...(input.metadata ?? {})
      }
    };
    this.orders.set(key, next);
    return next;
  }

  recordCancelRequested(input: {
    clientOrderId?: string | null;
    exchangeOrderId?: string | null;
    now?: Date;
  }): void {
    const key = buildOrderKey({
      clientOrderId: input.clientOrderId,
      exchangeOrderId: input.exchangeOrderId
    });
    if (!key) return;
    const existing = this.orders.get(key);
    if (!existing) return;
    this.orders.set(key, {
      ...existing,
      cancelRequestedAt: (input.now ?? new Date()).toISOString()
    });
  }

  getOrderByCloid(cloid: string): OrderRecord | null {
    const normalized = normalizeCloid(cloid);
    if (!normalized) return null;
    for (const order of this.orders.values()) {
      if (order.cloid === normalized) return order;
    }
    return null;
  }

  async getLiveOpenOrders(adapter: AdapterLike, symbol?: string): Promise<NormalizedOrder[]> {
    if (typeof adapter.listOpenOrders === "function") {
      const rows = await adapter.listOpenOrders({ symbol });
      return Array.isArray(rows) ? rows : [];
    }
    const tradeApi = adapter.tradeApi;
    const [openOrders, openPlans] = await Promise.all([
      tradeApi?.getPendingOrders ? tradeApi.getPendingOrders({ symbol, pageSize: 100 }) : Promise.resolve([]),
      tradeApi?.getPendingPlanOrders ? tradeApi.getPendingPlanOrders({ symbol, pageSize: 100 }) : Promise.resolve([])
    ]);
    return [...(Array.isArray(openOrders) ? openOrders : []), ...(Array.isArray(openPlans) ? openPlans : [])] as NormalizedOrder[];
  }

  async getRecentFills(adapter: AdapterLike, symbol?: string): Promise<FillRecord[]> {
    const rawRows = typeof adapter.getRecentFills === "function"
      ? await adapter.getRecentFills({ symbol, limit: 100 })
      : adapter.tradeApi?.getFills
        ? await adapter.tradeApi.getFills({ symbol, limit: 100 })
        : [];
    return (Array.isArray(rawRows) ? rawRows : [])
      .map((row) => normalizeFillRecord(row))
      .filter((row): row is FillRecord => Boolean(row));
  }

  async buildVaultSnapshot(adapter: AdapterLike, liveOpenOrders?: NormalizedOrder[]): Promise<VaultSnapshot | null> {
    if (typeof adapter.getAccountState !== "function" || typeof adapter.getPositions !== "function") {
      return null;
    }
    const [accountState, positions, coreSpotBalance] = await Promise.all([
      adapter.getAccountState().catch(() => null),
      adapter.getPositions().catch(() => []),
      typeof adapter.getCoreUsdcSpotBalance === "function"
        ? adapter.getCoreUsdcSpotBalance().catch(() => null)
        : Promise.resolve(null)
    ]);
    const normalizedPositions = (Array.isArray(positions) ? positions : []).map((row) => {
      const markPrice = Number(row.markPrice ?? NaN);
      const size = Math.abs(Number(row.size ?? 0));
      return {
        symbol: row.symbol,
        side: row.side,
        size,
        entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
        markPrice: Number.isFinite(markPrice) && markPrice > 0 ? markPrice : null,
        notionalUsd: Number.isFinite(markPrice) && markPrice > 0 ? Number((size * markPrice).toFixed(8)) : 0,
        unrealizedPnl: Number.isFinite(Number(row.unrealizedPnl)) ? Number(row.unrealizedPnl) : null
      };
    });
    return {
      capturedAt: new Date().toISOString(),
      equityUsd: Number(accountState?.equity ?? 0) || 0,
      availableMarginUsd: Number(accountState?.availableMargin ?? 0) || 0,
      coreUsdcSpotBalanceUsd: Number(coreSpotBalance?.amountUsd ?? 0) || 0,
      liveOpenOrdersCount: Array.isArray(liveOpenOrders) ? liveOpenOrders.length : 0,
      totalPositionNotionalUsd: normalizedPositions.reduce((sum, row) => sum + row.notionalUsd, 0),
      positions: normalizedPositions
    };
  }

  async reconcileVaultState(params: {
    adapter: AdapterLike;
    symbol?: string;
    localOpenOrders?: Array<{ clientOrderId?: string | null; exchangeOrderId?: string | null }>;
    now?: Date;
  }): Promise<{
    snapshot: VaultSnapshot | null;
    drifts: ReconciliationDrift[];
  }> {
    const liveOpenOrders = await this.getLiveOpenOrders(params.adapter, params.symbol);
    const snapshot = await this.buildVaultSnapshot(params.adapter, liveOpenOrders);
    const drifts = detectStateDrift({
      localOrders: [...this.orders.values()],
      localOpenOrders: params.localOpenOrders ?? [],
      liveOpenOrders,
      now: params.now,
      orderVisibilityTimeoutMs: this.options.orderVisibilityTimeoutMs,
      cancelVisibilityTimeoutMs: this.options.cancelVisibilityTimeoutMs
    });
    return { snapshot, drifts };
  }

  getVaultExposure(): VaultSnapshot | null {
    return this.lastResult?.snapshot ?? null;
  }

  getVaultReconciliationStatus(): Pick<ReconciliationResult, "status" | "at" | "drifts" | "alerts"> | null {
    if (!this.lastResult) return null;
    return {
      status: this.lastResult.status,
      at: this.lastResult.at,
      drifts: this.lastResult.drifts,
      alerts: this.lastResult.alerts
    };
  }

  async reconcileOrders(params: {
    adapter: AdapterLike;
    symbol?: string;
    localOpenOrders?: Array<{
      clientOrderId?: string | null;
      exchangeOrderId?: string | null;
      side?: "buy" | "sell" | null;
      price?: number | null;
      qty?: number | null;
      reduceOnly?: boolean | null;
    }>;
    now?: Date;
  }): Promise<ReconciliationResult> {
    const now = params.now ?? new Date();
    for (const row of params.localOpenOrders ?? []) {
      this.recordSubmittedOrder({
        clientOrderId: row.clientOrderId,
        exchangeOrderId: row.exchangeOrderId,
        symbol: params.symbol,
        side: row.side ?? null,
        orderType: toPositiveNumber(row.price) ? "limit" : "market",
        price: row.price ?? null,
        qty: row.qty ?? null,
        reduceOnly: row.reduceOnly === true,
        now,
        metadata: { source: "local_open_order_snapshot" }
      });
    }

    const liveOpenOrders = await this.getLiveOpenOrders(params.adapter, params.symbol);
    const liveRefs = liveOpenOrders.map((row) => normalizeLiveOrder(row));
    const recentFills = await this.getRecentFills(params.adapter, params.symbol);
    const newFills: FillRecord[] = [];
    for (const fill of recentFills) {
      if (this.fills.has(fill.key)) continue;
      this.fills.set(fill.key, fill);
      newFills.push(fill);
    }

    const statusChanges: ReconciliationResult["statusChanges"] = [];
    const newAlerts: ReconciliationAlert[] = [];
    for (const order of this.orders.values()) {
      const previousState = order.state;
      const matchedLive = liveRefs.find((live) => matchOrderRef({ record: order, live })) ?? null;
      const matchedFills = [...this.fills.values()].filter((fill) => matchFillRef({ record: order, fill }));
      const filledQty = matchedFills.reduce((sum, fill) => sum + fill.fillQty, 0);
      let nextState = previousState;
      let nextLiveOrderId = order.liveOrderId;
      let nextLastSeenLiveAt = order.lastSeenLiveAt;

      if (matchedLive) {
        nextLiveOrderId = matchedLive.liveOrderId;
        nextLastSeenLiveAt = now.toISOString();
        const liveStatus = toOrderStateFromOrderStatus(matchedLive.order.status);
        if (filledQty > 0 && order.qty && filledQty + 1e-9 < order.qty) {
          nextState = "partially_filled";
        } else {
          nextState = liveStatus === "canceled" || liveStatus === "rejected" ? liveStatus : "open";
        }
      } else if (filledQty > 0) {
        if (order.qty && filledQty + 1e-9 < order.qty) {
          nextState = "partially_filled";
        } else {
          nextState = "filled";
        }
      } else if (!isTerminalState(previousState)) {
        const submittedAtMs = order.submittedAt ? new Date(order.submittedAt).getTime() : now.getTime();
        const ageMs = now.getTime() - submittedAtMs;
        if (
          order.cancelRequestedAt
          && (previousState === "open" || previousState === "partially_filled")
          && ageMs >= this.options.cancelVisibilityTimeoutMs
        ) {
          newAlerts.push({
            key: `cancel-delayed:${order.key}`,
            severity: "warning",
            code: "cancel_delayed",
            message: "cancel was requested but HyperCore still has no terminal state for the order",
            orderKey: order.key
          });
        }
        if (ageMs >= this.options.orderVisibilityTimeoutMs && previousState !== "open" && previousState !== "partially_filled") {
          nextState = "stale";
          newAlerts.push({
            key: `submitted-stale:${order.key}`,
            severity: "warning",
            code: "submitted_not_visible",
            message: "submitted order did not become visible on HyperCore before the timeout",
            orderKey: order.key
          });
        } else if (previousState === "submitted") {
          nextState = "enqueued";
        }
      }

      if (order.cancelRequestedAt && !matchedLive && previousState !== "filled" && previousState !== "rejected" && previousState !== "stale" && filledQty + 1e-9 < Number(order.qty ?? filledQty + 1)) {
        nextState = "canceled";
      }

      const next: OrderRecord = {
        ...order,
        liveOrderId: nextLiveOrderId,
        lastSeenLiveAt: nextLastSeenLiveAt,
        filledQty: Number(filledQty.toFixed(8)),
        lastFillAt: matchedFills.at(-1)?.filledAt ?? order.lastFillAt,
        state:
          compareStateRank(nextState) >= compareStateRank(previousState)
          || (previousState === "open" && nextState === "canceled")
          || (previousState === "partially_filled" && nextState === "canceled")
            ? nextState
            : previousState
      };
      this.orders.set(order.key, next);
      if (next.state !== previousState) {
        statusChanges.push({
          orderKey: order.key,
          previousState,
          nextState: next.state
        });
      }
    }

    const snapshot = await this.buildVaultSnapshot(params.adapter, liveOpenOrders);
    const drifts = detectStateDrift({
      localOrders: [...this.orders.values()],
      localOpenOrders: params.localOpenOrders ?? [],
      liveOpenOrders,
      now,
      orderVisibilityTimeoutMs: this.options.orderVisibilityTimeoutMs,
      cancelVisibilityTimeoutMs: this.options.cancelVisibilityTimeoutMs
    });
    for (const drift of drifts) {
      const alertKey = `drift:${drift.key}`;
      if (!newAlerts.some((item) => item.key === alertKey)) {
        newAlerts.push({
          key: alertKey,
          severity: drift.severity,
          code: drift.kind,
          message: drift.message,
          orderKey: drift.orderKey
        });
      }
    }
    const alerts = dedupeAlerts(newAlerts);
    const status: ReconciliationResult["status"] = alerts.some((row) => row.severity === "critical")
      ? "critical"
      : alerts.length > 0 || drifts.length > 0
        ? "warning"
        : "ok";
    const result: ReconciliationResult = {
      at: now.toISOString(),
      status,
      orders: [...this.orders.values()],
      liveOpenOrders,
      recentFills: [...this.fills.values()],
      newFills,
      snapshot,
      drifts,
      alerts,
      newAlerts: alerts,
      statusChanges
    };
    this.lastResult = result;
    return result;
  }
}

function dedupeAlerts(alerts: ReconciliationAlert[]): ReconciliationAlert[] {
  const seen = new Set<string>();
  const out: ReconciliationAlert[] = [];
  for (const alert of alerts) {
    if (seen.has(alert.key)) continue;
    seen.add(alert.key);
    out.push(alert);
  }
  return out;
}

export function getOrCreateHyperliquidExecutionMonitor(
  key: string,
  options?: MonitorOptions
): HyperliquidExecutionMonitor {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) {
    throw new Error("hyperliquid_monitor_key_required");
  }
  const cached = monitorCache.get(normalizedKey);
  if (cached) return cached;
  const created = new HyperliquidExecutionMonitor(options);
  monitorCache.set(normalizedKey, created);
  return created;
}

