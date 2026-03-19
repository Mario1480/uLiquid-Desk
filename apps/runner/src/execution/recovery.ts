import type { NormalizedOrder } from "@mm/futures-exchange";

export type ExecutionRetryCategory =
  | "safe_retry"
  | "unsafe_retry"
  | "manual_intervention_required";

export type GridPendingExecutionIntentType =
  | "entry"
  | "tp"
  | "sl"
  | "rebalance";

export type GridPendingExecutionStatus =
  | "pending_confirmation"
  | "manual_intervention_required";

export type GridPendingExecution = {
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  qty: number | null;
  price: number | null;
  reduceOnly: boolean;
  gridLeg: "long" | "short";
  gridIndex: number;
  intentType: GridPendingExecutionIntentType;
  executionExchange: string;
  retryCategory: ExecutionRetryCategory;
  status: GridPendingExecutionStatus;
  createdAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  exchangeOrderId: string | null;
};

type GridExecutionRecoveryState = {
  version: 1;
  pendingOrders: Record<string, GridPendingExecution>;
};

type RecoverableOrderLike = Pick<NormalizedOrder, "orderId" | "raw">;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePositiveNumber(value: unknown): number | null {
  const parsed = Number(value ?? NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeRetryCategory(value: unknown): ExecutionRetryCategory {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "safe_retry") return "safe_retry";
  if (normalized === "unsafe_retry") return "unsafe_retry";
  return "manual_intervention_required";
}

function normalizePendingStatus(value: unknown): GridPendingExecutionStatus {
  return normalizeText(value).toLowerCase() === "manual_intervention_required"
    ? "manual_intervention_required"
    : "pending_confirmation";
}

function normalizeIntentType(value: unknown): GridPendingExecutionIntentType {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "tp" || normalized === "sl" || normalized === "rebalance") return normalized;
  return "entry";
}

function normalizeGridLeg(value: unknown): "long" | "short" {
  return normalizeText(value).toLowerCase() === "short" ? "short" : "long";
}

function normalizePendingExecution(value: unknown): GridPendingExecution | null {
  const row = asRecord(value);
  if (!row) return null;
  const clientOrderId = normalizeText(row.clientOrderId);
  if (!clientOrderId) return null;
  return {
    clientOrderId,
    symbol: normalizeText(row.symbol).toUpperCase(),
    side: normalizeText(row.side).toLowerCase() === "sell" ? "sell" : "buy",
    orderType: normalizeText(row.orderType).toLowerCase() === "market" ? "market" : "limit",
    qty: normalizePositiveNumber(row.qty),
    price: normalizePositiveNumber(row.price),
    reduceOnly: row.reduceOnly === true,
    gridLeg: normalizeGridLeg(row.gridLeg),
    gridIndex: Math.max(0, Math.trunc(Number(row.gridIndex ?? 0))),
    intentType: normalizeIntentType(row.intentType),
    executionExchange: normalizeText(row.executionExchange).toLowerCase(),
    retryCategory: normalizeRetryCategory(row.retryCategory),
    status: normalizePendingStatus(row.status),
    createdAt: normalizeText(row.createdAt) || new Date(0).toISOString(),
    lastAttemptAt: normalizeText(row.lastAttemptAt) || null,
    lastError: normalizeText(row.lastError) || null,
    exchangeOrderId: normalizeText(row.exchangeOrderId) || null
  };
}

function readGridExecutionRecoveryState(value: unknown): GridExecutionRecoveryState {
  const stateJson = asRecord(value);
  const recovery = asRecord(stateJson?.executionRecovery);
  const pendingOrdersRecord = asRecord(recovery?.pendingOrders);
  const pendingOrders: Record<string, GridPendingExecution> = {};
  if (pendingOrdersRecord) {
    for (const entry of Object.values(pendingOrdersRecord)) {
      const pending = normalizePendingExecution(entry);
      if (!pending) continue;
      pendingOrders[pending.clientOrderId] = pending;
    }
  }
  return {
    version: 1,
    pendingOrders
  };
}

function serializeGridExecutionRecoveryState(
  stateJson: Record<string, unknown> | null | undefined,
  recovery: GridExecutionRecoveryState
): Record<string, unknown> {
  const nextStateJson = { ...(stateJson ?? {}) };
  const pendingValues = Object.values(recovery.pendingOrders);
  if (pendingValues.length === 0) {
    delete nextStateJson.executionRecovery;
    return nextStateJson;
  }
  nextStateJson.executionRecovery = {
    version: recovery.version,
    pendingOrders: Object.fromEntries(
      pendingValues.map((pending) => [pending.clientOrderId, pending])
    )
  };
  return nextStateJson;
}

function collectOrderReferenceCandidates(value: unknown): string[] {
  const direct = normalizeText(value);
  return direct ? [direct] : [];
}

function collectOrderCandidates(order: RecoverableOrderLike): Set<string> {
  const out = new Set<string>();
  for (const entry of collectOrderReferenceCandidates(order.orderId)) {
    out.add(entry);
  }
  const raw = asRecord(order.raw);
  if (!raw) return out;
  const nestedRaw = asRecord(raw.raw);
  const candidates: unknown[] = [
    raw.clientOrderId,
    raw.clientOid,
    raw.clOrdId,
    raw.cloid,
    raw.orderId,
    raw.order_id,
    nestedRaw?.clientOrderId,
    nestedRaw?.clientOid,
    nestedRaw?.clOrdId,
    nestedRaw?.cloid,
    nestedRaw?.orderId,
    nestedRaw?.order_id
  ];
  for (const candidate of candidates) {
    for (const entry of collectOrderReferenceCandidates(candidate)) {
      out.add(entry);
    }
  }
  return out;
}

export function categorizeExecutionRetry(params: {
  executionExchange: string;
  error: unknown;
}): {
  category: ExecutionRetryCategory;
  reasonCode: string;
} {
  const exchange = normalizeText(params.executionExchange).toLowerCase();
  const lower = String(params.error ?? "").trim().toLowerCase();
  const networkLike =
    lower.includes("timeout")
    || lower.includes("timed out")
    || lower.includes("abort")
    || lower.includes("fetch failed")
    || lower.includes("network")
    || lower.includes("socket")
    || lower.includes("econnreset")
    || lower.includes("temporarily unavailable")
    || lower.includes("service unavailable");
  if (networkLike) {
    return exchange === "paper"
      ? { category: "safe_retry", reasonCode: "transport_retryable" }
      : { category: "unsafe_retry", reasonCode: "acceptance_unknown" };
  }

  const retryUnsafe =
    lower.includes("invalid")
    || lower.includes("unknown symbol")
    || lower.includes("insufficient")
    || lower.includes("rejected")
    || lower.includes("forbidden")
    || lower.includes("unauthorized")
    || lower.includes("not supported")
    || lower.includes("bad request");
  if (retryUnsafe) {
    return {
      category: "manual_intervention_required",
      reasonCode: "retry_not_safe"
    };
  }

  return {
    category: "manual_intervention_required",
    reasonCode: "manual_review_required"
  };
}

export function createPendingGridExecution(params: {
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  qty?: number | null;
  price?: number | null;
  reduceOnly?: boolean;
  gridLeg: "long" | "short";
  gridIndex: number;
  intentType: GridPendingExecutionIntentType;
  executionExchange: string;
  now: Date;
}): GridPendingExecution {
  return {
    clientOrderId: normalizeText(params.clientOrderId),
    symbol: normalizeText(params.symbol).toUpperCase(),
    side: params.side === "sell" ? "sell" : "buy",
    orderType: params.orderType === "market" ? "market" : "limit",
    qty: normalizePositiveNumber(params.qty),
    price: normalizePositiveNumber(params.price),
    reduceOnly: params.reduceOnly === true,
    gridLeg: params.gridLeg === "short" ? "short" : "long",
    gridIndex: Math.max(0, Math.trunc(Number(params.gridIndex ?? 0))),
    intentType: normalizeIntentType(params.intentType),
    executionExchange: normalizeText(params.executionExchange).toLowerCase(),
    retryCategory:
      normalizeText(params.executionExchange).toLowerCase() === "paper"
        ? "safe_retry"
        : "unsafe_retry",
    status: "pending_confirmation",
    createdAt: params.now.toISOString(),
    lastAttemptAt: params.now.toISOString(),
    lastError: null,
    exchangeOrderId: null
  };
}

export function listPendingGridExecutions(
  stateJson: Record<string, unknown> | null | undefined
): GridPendingExecution[] {
  const recovery = readGridExecutionRecoveryState(stateJson);
  return Object.values(recovery.pendingOrders).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}

export function upsertPendingGridExecution(
  stateJson: Record<string, unknown> | null | undefined,
  pending: GridPendingExecution
): Record<string, unknown> {
  const recovery = readGridExecutionRecoveryState(stateJson);
  recovery.pendingOrders[pending.clientOrderId] = pending;
  return serializeGridExecutionRecoveryState(stateJson, recovery);
}

export function clearPendingGridExecution(
  stateJson: Record<string, unknown> | null | undefined,
  clientOrderId: string
): Record<string, unknown> {
  const recovery = readGridExecutionRecoveryState(stateJson);
  delete recovery.pendingOrders[normalizeText(clientOrderId)];
  return serializeGridExecutionRecoveryState(stateJson, recovery);
}

export function mergeGridExecutionRecoveryState(
  baseStateJson: Record<string, unknown> | null | undefined,
  currentStateJson: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const recovery = readGridExecutionRecoveryState(currentStateJson);
  return serializeGridExecutionRecoveryState(baseStateJson, recovery);
}

export function matchOrderToPendingExecution(
  order: RecoverableOrderLike,
  clientOrderId: string
): boolean {
  const target = normalizeText(clientOrderId);
  if (!target) return false;
  return collectOrderCandidates(order).has(target);
}

async function listVenueOrders(adapter: any): Promise<RecoverableOrderLike[]> {
  if (typeof adapter?.listOpenOrders === "function") {
    const rows = await adapter.listOpenOrders();
    return Array.isArray(rows)
      ? rows.map((row) => ({
          orderId: normalizeText((row as any)?.orderId),
          raw: (row as any)?.raw ?? row
        }))
      : [];
  }

  const tradeApi = adapter?.tradeApi;
  if (!tradeApi) return [];
  const [openOrders, openPlans] = await Promise.all([
    typeof tradeApi.getPendingOrders === "function"
      ? tradeApi.getPendingOrders({ pageSize: 200 })
      : Promise.resolve([]),
    typeof tradeApi.getPendingPlanOrders === "function"
      ? tradeApi.getPendingPlanOrders({ pageSize: 200 })
      : Promise.resolve([])
  ]);
  const rows = [
    ...(Array.isArray(openOrders) ? openOrders : []),
    ...(Array.isArray(openPlans) ? openPlans : [])
  ];
  return rows.map((row) => {
    const raw = asRecord(row);
    return {
      orderId:
        normalizeText(raw?.orderId)
        || normalizeText(raw?.order_id)
        || normalizeText(raw?.planOrderId)
        || normalizeText(raw?.clientOid),
      raw: row
    };
  });
}

export async function recoverGridPendingExecutions(params: {
  instanceId: string;
  botId: string;
  botSymbol: string;
  exchangeAccountId: string;
  executionExchange: string;
  now: Date;
  stateJson: Record<string, unknown> | null | undefined;
  openOrders: Array<{ exchangeOrderId?: string | null; clientOrderId?: string | null }>;
  adapter?: unknown;
  manualInterventionAfterMs?: number;
  deps: {
    placePaperLimitOrder?: (input: {
      exchangeAccountId: string;
      symbol: string;
      side: "buy" | "sell";
      qty: number;
      price: number;
      reduceOnly: boolean;
      clientOrderId: string;
    }) => Promise<{ orderId?: string | null }>;
    createOrderMapEntry: (input: {
      instanceId: string;
      botId: string;
      clientOrderId: string;
      exchangeOrderId?: string | null;
      gridLeg: "long" | "short";
      gridIndex: number;
      intentType: GridPendingExecutionIntentType;
      side: "buy" | "sell";
      price?: number | null;
      qty?: number | null;
      reduceOnly?: boolean;
      status?: "open" | "filled" | "canceled" | "rejected";
    }) => Promise<void>;
    listGridOpenOrders: () => Promise<Array<{
      exchangeOrderId?: string | null;
      clientOrderId?: string | null;
    }>>;
  };
}): Promise<{
  stateJson: Record<string, unknown>;
  openOrders: Array<{ exchangeOrderId?: string | null; clientOrderId?: string | null }>;
  blockedReason: string | null;
  summary: {
    recoveredCount: number;
    pendingCount: number;
    manualInterventionCount: number;
  };
}> {
  const manualInterventionAfterMs = Math.max(1_000, Number(params.manualInterventionAfterMs ?? 120_000));
  let nextStateJson = { ...(params.stateJson ?? {}) };
  let nextOpenOrders = params.openOrders.slice();
  let blockedReason: string | null = null;
  let recoveredCount = 0;
  let pendingCount = 0;
  let manualInterventionCount = 0;
  let venueOrders: RecoverableOrderLike[] | null = null;

  for (const pending of listPendingGridExecutions(params.stateJson)) {
    const alreadyTracked = nextOpenOrders.some((row) => {
      const clientOrderId = normalizeText(row.clientOrderId);
      const exchangeOrderId = normalizeText(row.exchangeOrderId);
      return clientOrderId === pending.clientOrderId
        || (pending.exchangeOrderId ? exchangeOrderId === pending.exchangeOrderId : false);
    });
    if (alreadyTracked) {
      nextStateJson = clearPendingGridExecution(nextStateJson, pending.clientOrderId);
      recoveredCount += 1;
      continue;
    }

    if (
      normalizeText(params.executionExchange).toLowerCase() === "paper"
      && params.deps.placePaperLimitOrder
      && pending.orderType === "limit"
      && pending.qty
      && pending.price
    ) {
      const placed = await params.deps.placePaperLimitOrder({
        exchangeAccountId: params.exchangeAccountId,
        symbol: params.botSymbol,
        side: pending.side,
        qty: pending.qty,
        price: pending.price,
        reduceOnly: pending.reduceOnly,
        clientOrderId: pending.clientOrderId
      });
      await params.deps.createOrderMapEntry({
        instanceId: params.instanceId,
        botId: params.botId,
        clientOrderId: pending.clientOrderId,
        exchangeOrderId: normalizeText(placed.orderId) || null,
        gridLeg: pending.gridLeg,
        gridIndex: pending.gridIndex,
        intentType: pending.intentType,
        side: pending.side,
        price: pending.price,
        qty: pending.qty,
        reduceOnly: pending.reduceOnly,
        status: "open"
      });
      nextStateJson = clearPendingGridExecution(nextStateJson, pending.clientOrderId);
      nextOpenOrders = await params.deps.listGridOpenOrders();
      recoveredCount += 1;
      continue;
    }

    if (params.adapter) {
      venueOrders ??= await listVenueOrders(params.adapter);
      const matched = venueOrders.find((order) =>
        matchOrderToPendingExecution(order, pending.clientOrderId)
      );
      if (matched) {
        const exchangeOrderId = normalizeText(matched.orderId) || pending.exchangeOrderId || null;
        await params.deps.createOrderMapEntry({
          instanceId: params.instanceId,
          botId: params.botId,
          clientOrderId: pending.clientOrderId,
          exchangeOrderId,
          gridLeg: pending.gridLeg,
          gridIndex: pending.gridIndex,
          intentType: pending.intentType,
          side: pending.side,
          price: pending.price,
          qty: pending.qty,
          reduceOnly: pending.reduceOnly,
          status: "open"
        });
        nextStateJson = clearPendingGridExecution(nextStateJson, pending.clientOrderId);
        nextOpenOrders = await params.deps.listGridOpenOrders();
        recoveredCount += 1;
        continue;
      }
    }

    const ageMs = Math.max(0, params.now.getTime() - new Date(pending.createdAt).getTime());
    const needsManualIntervention = ageMs >= manualInterventionAfterMs;
    const nextPending: GridPendingExecution = needsManualIntervention
      ? {
          ...pending,
          retryCategory: "manual_intervention_required",
          status: "manual_intervention_required",
          lastError: pending.lastError ?? "recovery_confirmation_timeout"
        }
      : pending;
    nextStateJson = upsertPendingGridExecution(nextStateJson, nextPending);
    if (needsManualIntervention) {
      manualInterventionCount += 1;
      blockedReason ??= "grid_execution_manual_intervention_required";
    } else {
      pendingCount += 1;
      blockedReason ??= "grid_execution_confirmation_pending";
    }
  }

  return {
    stateJson: nextStateJson,
    openOrders: nextOpenOrders,
    blockedReason,
    summary: {
      recoveredCount,
      pendingCount,
      manualInterventionCount
    }
  };
}
