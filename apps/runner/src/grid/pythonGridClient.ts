export type GridPlanMode = "long" | "short" | "neutral" | "cross";
export type GridPriceMode = "arithmetic" | "geometric";

export type GridPlannerOpenOrder = {
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  side?: "buy" | "sell" | null;
  price?: number | null;
  qty?: number | null;
  reduceOnly?: boolean | null;
  status?: string | null;
};

export type GridPlannerPosition = {
  side?: "long" | "short" | null;
  qty?: number | null;
  entryPrice?: number | null;
  markPrice?: number | null;
};

export type GridPlanRequest = {
  instanceId: string;
  mode: GridPlanMode;
  gridMode: GridPriceMode;
  allocationMode?: "EQUAL_NOTIONAL_PER_GRID" | "EQUAL_BASE_QTY_PER_GRID" | "WEIGHTED_NEAR_PRICE";
  budgetSplitPolicy?: "FIXED_50_50" | "FIXED_CUSTOM" | "DYNAMIC_BY_PRICE_POSITION";
  longBudgetPct?: number;
  shortBudgetPct?: number;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  activeOrderWindowSize?: number;
  recenterDriftLevels?: number;
  investUsd: number;
  leverage: number;
  slippagePct: number;
  triggerPrice?: number | null;
  tpPct?: number | null;
  slPct?: number | null;
  trailingEnabled?: boolean;
  markPrice: number;
  openOrders: GridPlannerOpenOrder[];
  position?: GridPlannerPosition | null;
  stateJson?: Record<string, unknown>;
  fillEvents?: Array<Record<string, unknown>>;
  feeModel?: {
    takerPct?: number;
  };
  venueConstraints?: {
    minQty?: number | null;
    qtyStep?: number | null;
    priceTick?: number | null;
    minNotional?: number | null;
    feeRate?: number | null;
  };
  feeBufferPct?: number;
  mmrPct?: number;
  extraMarginUsd?: number;
  liqDistanceMinPct?: number;
  initialSeedEnabled?: boolean;
  initialSeedPct?: number;
};

export type GridPlannerIntent = {
  type: "place_order" | "cancel_order" | "replace_order" | "set_protection";
  side?: "buy" | "sell";
  price?: number;
  qty?: number;
  reduceOnly?: boolean;
  clientOrderId?: string;
  exchangeOrderId?: string;
  limitOffsetBps?: number;
  gridLeg?: "long" | "short";
  gridIndex?: number;
  tpPrice?: number;
  slPrice?: number;
};

export type GridPlanResponse = {
  intents: GridPlannerIntent[];
  nextStateJson: Record<string, unknown>;
  metricsDelta: Record<string, unknown>;
  windowMeta: Record<string, unknown>;
  risk: Record<string, unknown>;
  reasonCodes: string[];
};

export class GridPlannerClientError extends Error {
  code: string;
  status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEnabled(): boolean {
  return String(process.env.PY_GRID_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function resolveBaseUrl(): string {
  const raw = String(process.env.PY_GRID_URL ?? process.env.PY_STRATEGY_URL ?? "http://localhost:9000").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function normalizeBaseUrl(raw: string): string | null {
  const normalized = String(raw ?? "").trim();
  if (!normalized) return null;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function resolveFallbackBaseUrls(primaryBaseUrl: string): string[] {
  const primary = normalizeBaseUrl(primaryBaseUrl) ?? primaryBaseUrl;
  const candidates = [
    process.env.PY_GRID_FALLBACK_URL,
    process.env.PY_STRATEGY_URL,
    "http://py-strategy-service:9000",
    "http://localhost:9000"
  ];
  const out: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(String(candidate ?? ""));
    if (!normalized || normalized === primary || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function resolveAuthToken(): string {
  return String(process.env.PY_GRID_AUTH_TOKEN ?? process.env.PY_STRATEGY_AUTH_TOKEN ?? "").trim();
}

function resolveTimeoutMs(): number {
  const parsed = Number(process.env.PY_GRID_TIMEOUT_MS ?? 1500);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.max(200, Math.min(10000, Math.trunc(parsed)));
}

function resolveCircuitWindowMs(): number {
  const parsed = Number(process.env.PY_GRID_CB_WINDOW_MS ?? 60_000);
  if (!Number.isFinite(parsed)) return 60_000;
  return Math.max(1_000, Math.min(600_000, Math.trunc(parsed)));
}

function resolveCircuitMaxFailures(): number {
  const parsed = Number(process.env.PY_GRID_CB_MAX_FAILURES ?? 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function resolveCircuitCooldownMs(): number {
  const parsed = Number(process.env.PY_GRID_CB_COOLDOWN_MS ?? 60_000);
  if (!Number.isFinite(parsed)) return 60_000;
  return Math.max(1_000, Math.min(1_800_000, Math.trunc(parsed)));
}

type GridPlannerCircuitState = {
  windowStartMs: number;
  failures: number;
  openUntilMs: number;
};

const circuitState: GridPlannerCircuitState = {
  windowStartMs: 0,
  failures: 0,
  openUntilMs: 0
};

function registerPlannerFailure(nowMs: number): void {
  const windowMs = resolveCircuitWindowMs();
  if (circuitState.windowStartMs <= 0 || nowMs - circuitState.windowStartMs > windowMs) {
    circuitState.windowStartMs = nowMs;
    circuitState.failures = 0;
  }
  circuitState.failures += 1;
  if (circuitState.failures >= resolveCircuitMaxFailures()) {
    circuitState.openUntilMs = nowMs + resolveCircuitCooldownMs();
  }
}

function registerPlannerSuccess(nowMs: number): void {
  circuitState.windowStartMs = nowMs;
  circuitState.failures = 0;
  circuitState.openUntilMs = 0;
}

function normalizeIntent(value: unknown): GridPlannerIntent | null {
  const row = asRecord(value);
  if (!row) return null;
  const type = String(row.type ?? "").trim().toLowerCase();
  if (type !== "place_order" && type !== "cancel_order" && type !== "replace_order" && type !== "set_protection") {
    return null;
  }
  const sideRaw = String(row.side ?? "").trim().toLowerCase();
  const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : undefined;
  const gridLegRaw = String(row.gridLeg ?? "").trim().toLowerCase();
  const gridLeg = gridLegRaw === "long" || gridLegRaw === "short" ? gridLegRaw : undefined;
  return {
    type,
    side,
    price: toNumber(row.price) ?? undefined,
    qty: toNumber(row.qty) ?? undefined,
    reduceOnly: typeof row.reduceOnly === "boolean" ? row.reduceOnly : undefined,
    clientOrderId: typeof row.clientOrderId === "string" ? row.clientOrderId.trim() || undefined : undefined,
    exchangeOrderId: typeof row.exchangeOrderId === "string" ? row.exchangeOrderId.trim() || undefined : undefined,
    limitOffsetBps: toNumber(row.limitOffsetBps) ?? undefined,
    gridLeg,
    gridIndex: Number.isFinite(Number(row.gridIndex)) ? Math.trunc(Number(row.gridIndex)) : undefined,
    tpPrice: toNumber(row.tpPrice) ?? undefined,
    slPrice: toNumber(row.slPrice) ?? undefined
  };
}

function normalizePlanResponse(value: unknown): GridPlanResponse {
  const row = asRecord(value);
  if (!row) {
    throw new GridPlannerClientError("grid planner response is not an object", "invalid_response");
  }
  const intents = Array.isArray(row.intents)
    ? row.intents.map((entry) => normalizeIntent(entry)).filter((entry): entry is GridPlannerIntent => Boolean(entry))
    : [];
  const nextStateJson = asRecord(row.nextStateJson) ?? {};
  const metricsDelta = asRecord(row.metricsDelta) ?? {};
  const reasonCodes = Array.isArray(row.reasonCodes)
    ? row.reasonCodes
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean)
      .slice(0, 50)
    : [];

  return {
    intents,
    nextStateJson,
    metricsDelta,
    windowMeta: asRecord(row.windowMeta) ?? {},
    risk: asRecord(row.risk) ?? {},
    reasonCodes
  };
}

async function requestJson(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const requestToBase = async (baseUrl: string): Promise<unknown> => {
    const controller = new AbortController();
    const timeoutMs = resolveTimeoutMs();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers({ "content-type": "application/json" });
    const token = resolveAuthToken();
    if (token) headers.set("x-py-strategy-token", token);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new GridPlannerClientError("grid planner returned invalid_json", "invalid_json", response.status);
        }
      }
      if (!response.ok) {
        const detail = asRecord(parsed);
        const message = typeof detail?.detail === "string"
          ? detail.detail
          : typeof detail?.error === "string"
            ? detail.error
            : `grid planner HTTP ${response.status}`;
        throw new GridPlannerClientError(message, "http_error", response.status);
      }
      return parsed;
    } catch (error) {
      if (error instanceof GridPlannerClientError) throw error;
      if ((error as any)?.name === "AbortError") {
        throw new GridPlannerClientError("grid planner request timeout", "timeout");
      }
      throw new GridPlannerClientError(String(error), "network_error");
    } finally {
      clearTimeout(timer);
    }
  };

  const primaryBaseUrl = resolveBaseUrl();
  try {
    return await requestToBase(primaryBaseUrl);
  } catch (error) {
    const retryable = error instanceof GridPlannerClientError
      && (error.code === "network_error" || error.code === "timeout");
    if (retryable) {
      try {
        // One same-host retry for transient DNS/socket blips.
        return await requestToBase(primaryBaseUrl);
      } catch (retryError) {
        error = retryError;
      }
    }
    const fallbackBaseUrls = resolveFallbackBaseUrls(primaryBaseUrl);
    if (!retryable || fallbackBaseUrls.length === 0) throw error;
    for (const fallbackBaseUrl of fallbackBaseUrls) {
      try {
        return await requestToBase(fallbackBaseUrl);
      } catch (fallbackError) {
        error = fallbackError;
      }
    }
    throw error;
  }
}

export async function runGridPlan(payload: GridPlanRequest): Promise<GridPlanResponse> {
  if (!resolveEnabled()) {
    throw new GridPlannerClientError("grid planner disabled", "disabled");
  }
  const nowMs = Date.now();
  if (circuitState.openUntilMs > nowMs) {
    throw new GridPlannerClientError("grid planner circuit open", "circuit_open");
  }

  try {
    const json = await requestJson("/v1/grid/plan", payload as unknown as Record<string, unknown>);
    const normalized = normalizePlanResponse(json);
    registerPlannerSuccess(nowMs);
    return normalized;
  } catch (error) {
    registerPlannerFailure(nowMs);
    throw error;
  }
}
