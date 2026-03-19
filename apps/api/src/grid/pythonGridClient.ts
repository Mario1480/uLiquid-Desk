import { z } from "zod";

const envelopeErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  retryable: z.boolean().optional().default(false),
  details: z.record(z.any()).nullish()
});

const intentSchema = z.object({
  type: z.enum(["place_order", "cancel_order", "replace_order", "set_protection"]),
  side: z.enum(["buy", "sell"]).nullable().optional(),
  price: z.number().nullable().optional(),
  qty: z.number().nullable().optional(),
  reduceOnly: z.boolean().nullable().optional(),
  clientOrderId: z.string().trim().min(1).nullable().optional(),
  exchangeOrderId: z.string().trim().min(1).nullable().optional(),
  limitOffsetBps: z.number().nullable().optional(),
  gridLeg: z.enum(["long", "short"]).nullable().optional(),
  gridIndex: z.number().int().nullable().optional(),
  tpPrice: z.number().nullable().optional(),
  slPrice: z.number().nullable().optional()
});

const planResponseSchema = z.object({
  intents: z.array(intentSchema).default([]),
  nextStateJson: z.record(z.any()).default({}),
  metricsDelta: z.record(z.any()).default({}),
  windowMeta: z.record(z.any()).default({}),
  risk: z.record(z.any()).default({}),
  reasonCodes: z.array(z.string()).default([])
});

const previewResponseSchema = z.object({
  levels: z.array(z.object({ index: z.number().int(), price: z.number() })).default([]),
  perGridQty: z.number(),
  perGridNotional: z.number(),
  profitPerGridNetPct: z.number(),
  profitPerGridNetUsd: z.number(),
  liqEstimate: z.number().nullable().optional(),
  liqEstimateLong: z.number().nullable().optional(),
  liqEstimateShort: z.number().nullable().optional(),
  worstCaseLiqPrice: z.number().nullable().optional(),
  worstCaseLiqDistancePct: z.number().nullable().optional(),
  liqDistanceMinPct: z.number().nullable().optional(),
  entryBlockedByLiq: z.boolean().optional(),
  minInvestmentUSDT: z.number().optional().default(0),
  minInvestmentBreakdown: z.object({
    long: z.number().optional().default(0),
    short: z.number().optional().default(0),
    seed: z.number().optional().default(0),
    total: z.number().optional().default(0)
  }).optional().default({ long: 0, short: 0, seed: 0, total: 0 }),
  initialSeed: z.object({
    enabled: z.boolean().optional().default(false),
    seedPct: z.number().optional().default(0),
    seedSide: z.enum(["buy", "sell"]).nullable().optional().default(null),
    seedQty: z.number().optional().default(0),
    seedNotionalUsd: z.number().optional().default(0),
    seedMarginUsd: z.number().optional().default(0),
    seedMinMarginUsd: z.number().optional().default(0),
  }).optional().default({
    enabled: false,
    seedPct: 0,
    seedSide: null,
    seedQty: 0,
    seedNotionalUsd: 0,
    seedMarginUsd: 0,
    seedMinMarginUsd: 0,
  }),
  effectiveGridSlots: z.number().int().optional().default(0),
  allocationBreakdown: z.object({
    mode: z.string().optional().default("EQUAL_NOTIONAL_PER_GRID"),
    slotsLong: z.number().int().optional().default(0),
    slotsShort: z.number().int().optional().default(0),
    longBudgetPct: z.number().nullable().optional().default(null),
    shortBudgetPct: z.number().nullable().optional().default(null),
    sideNotionalPerOrderLong: z.number().optional().default(0),
    sideNotionalPerOrderShort: z.number().optional().default(0),
    qtyPerOrderLong: z.number().optional().default(0),
    qtyPerOrderShort: z.number().optional().default(0),
  }).optional().default({
    mode: "EQUAL_NOTIONAL_PER_GRID",
    slotsLong: 0,
    slotsShort: 0,
    longBudgetPct: null,
    shortBudgetPct: null,
    sideNotionalPerOrderLong: 0,
    sideNotionalPerOrderShort: 0,
    qtyPerOrderLong: 0,
    qtyPerOrderShort: 0
  }),
  qtyModel: z.object({
    mode: z.string().optional().default("EQUAL_NOTIONAL_PER_GRID"),
    qtyPerOrder: z.number().nullable().optional(),
    qtyBase: z.number().nullable().optional(),
  }).optional().default({
    mode: "EQUAL_NOTIONAL_PER_GRID"
  }),
  profitPerGridEstimateUSDT: z.number().optional().default(0),
  qtyPerOrderRounded: z.number().optional().default(0),
  venueChecks: z.object({
    minQtyHit: z.boolean().optional().default(false),
    minNotionalHit: z.boolean().optional().default(false),
    roundedByStep: z.boolean().optional().default(false),
    fallbackUsed: z.boolean().optional().default(false),
    minQtyUsed: z.number().nullable().optional(),
    minNotionalUsed: z.number().nullable().optional()
  }).optional().default({
    minQtyHit: false,
    minNotionalHit: false,
    roundedByStep: false,
    fallbackUsed: false,
    minQtyUsed: null,
    minNotionalUsed: null
  }),
  windowMeta: z.object({
    activeOrdersTotal: z.number().int().optional().default(0),
    activeBuys: z.number().int().optional().default(0),
    activeSells: z.number().int().optional().default(0),
    windowLowerIdx: z.number().int().optional().default(0),
    windowUpperIdx: z.number().int().optional().default(0),
    windowCenterIdx: z.number().int().optional().default(0),
    activeOrderWindowSize: z.number().int().optional().default(0),
    recenterReason: z.string().optional().default("seed"),
    driftLevels: z.number().nullable().optional().default(null)
  }).optional().default({
    activeOrdersTotal: 0,
    activeBuys: 0,
    activeSells: 0,
    windowLowerIdx: 0,
    windowUpperIdx: 0,
    windowCenterIdx: 0,
    activeOrderWindowSize: 0,
    recenterReason: "seed",
    driftLevels: null
  }),
  capitalSummary: z.object({
    investUsd: z.number().optional().default(0),
    extraMarginUsd: z.number().optional().default(0),
    effectiveGridInvestUsd: z.number().optional().default(0),
    effectiveGridSlots: z.number().int().optional().default(0),
    initialSeedMarginUsd: z.number().optional().default(0),
    initialSeedPct: z.number().optional().default(0),
    capitalPerGridUsd: z.number().optional().default(0),
    minimumCapitalPerGridUsd: z.number().optional().default(0),
    minimumGridCapitalUsd: z.number().optional().default(0),
    minimumRequiredBudgetUsd: z.number().optional().default(0),
    minimumRecommendedBudgetUsd: z.number().optional().default(0),
    currentBudgetShortfallUsd: z.number().optional().default(0),
    recommendedBudgetShortfallUsd: z.number().optional().default(0),
    tooManyGridsForCapital: z.boolean().optional().default(false),
  }).optional().default({
    investUsd: 0,
    extraMarginUsd: 0,
    effectiveGridInvestUsd: 0,
    effectiveGridSlots: 0,
    initialSeedMarginUsd: 0,
    initialSeedPct: 0,
    capitalPerGridUsd: 0,
    minimumCapitalPerGridUsd: 0,
    minimumGridCapitalUsd: 0,
    minimumRequiredBudgetUsd: 0,
    minimumRecommendedBudgetUsd: 0,
    currentBudgetShortfallUsd: 0,
    recommendedBudgetShortfallUsd: 0,
    tooManyGridsForCapital: false,
  }),
  safetySummary: z.object({
    leverage: z.number().optional().default(0),
    leverageBand: z.string().optional().default("normal"),
    rangeWidthPct: z.number().optional().default(0),
    nearestBoundaryDistancePct: z.number().optional().default(0),
    worstCaseLiqDistancePct: z.number().nullable().optional().default(null),
    liqDistanceMinPct: z.number().optional().default(0),
    liquidationBufferPct: z.number().nullable().optional().default(null),
    liquidationStatus: z.string().optional().default("ok"),
    narrowRangeLowBuffer: z.boolean().optional().default(false),
    autoMarginExpectation: z.string().optional().default("optional"),
  }).optional().default({
    leverage: 0,
    leverageBand: "normal",
    rangeWidthPct: 0,
    nearestBoundaryDistancePct: 0,
    worstCaseLiqDistancePct: null,
    liqDistanceMinPct: 0,
    liquidationBufferPct: null,
    liquidationStatus: "ok",
    narrowRangeLowBuffer: false,
    autoMarginExpectation: "optional",
  }),
  warnings: z.array(z.string()).default([]),
  validationErrors: z.array(z.string()).default([])
});

const previewEnvelopeResponseSchema = z.object({
  protocolVersion: z.string().trim().min(1),
  requestId: z.string().trim().min(1).nullish(),
  ok: z.boolean(),
  payload: previewResponseSchema.nullish(),
  error: envelopeErrorSchema.nullish()
});

const planEnvelopeResponseSchema = z.object({
  protocolVersion: z.string().trim().min(1),
  requestId: z.string().trim().min(1).nullish(),
  ok: z.boolean(),
  payload: planResponseSchema.nullish(),
  error: envelopeErrorSchema.nullish()
});

export type GridPlanResponse = z.infer<typeof planResponseSchema>;
export type GridPreviewResponse = z.infer<typeof previewResponseSchema>;

export class GridPythonClientError extends Error {
  code: string;
  status: number | null;

  constructor(message: string, code: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function resolveEnabled(): boolean {
  return String(process.env.PY_GRID_ENABLED ?? "false").trim().toLowerCase() === "true";
}

function resolveBaseUrl(): string {
  const raw = String(process.env.PY_GRID_URL ?? process.env.PY_STRATEGY_URL ?? "http://localhost:9000").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function resolveFallbackBaseUrl(primaryBaseUrl: string): string | null {
  const raw = String(process.env.PY_GRID_FALLBACK_URL ?? "http://localhost:9000").trim();
  if (!raw) return null;
  const fallback = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (!fallback) return null;
  if (fallback === primaryBaseUrl) return null;
  return fallback;
}

function resolveAuthToken(): string {
  return String(process.env.PY_GRID_AUTH_TOKEN ?? process.env.PY_STRATEGY_AUTH_TOKEN ?? "").trim();
}

function resolveTimeoutMs(): number {
  const parsed = Number(process.env.PY_GRID_TIMEOUT_MS ?? 1500);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.max(200, Math.min(10_000, Math.trunc(parsed)));
}

async function requestJson(path: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!resolveEnabled()) {
    throw new GridPythonClientError("grid_python_disabled", "disabled");
  }

  const requestToBase = async (baseUrl: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolveTimeoutMs());
    const headers = new Headers({ "content-type": "application/json" });
    const token = resolveAuthToken();
    if (token) headers.set("x-py-strategy-token", token);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new GridPythonClientError("grid_python_invalid_json", "invalid_json", response.status);
        }
      }
      if (!response.ok) {
        const detail = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
        const detailValue = detail?.detail;
        const detailText = typeof detailValue === "string"
          ? detailValue
          : Array.isArray(detailValue)
            ? detailValue
              .map((entry) => {
                if (typeof entry === "string") return entry;
                if (entry && typeof entry === "object") {
                  const location = Array.isArray((entry as any).loc)
                    ? (entry as any).loc.join(".")
                    : "payload";
                  const message = typeof (entry as any).msg === "string"
                    ? (entry as any).msg
                    : JSON.stringify(entry);
                  return `${location}: ${message}`;
                }
                return String(entry);
              })
              .filter(Boolean)
              .join(" | ")
            : null;
        const message = detailText
          ?? (typeof detail?.error === "string" ? detail.error : `grid_python_http_${response.status}`);
        throw new GridPythonClientError(message, "http_error", response.status);
      }
      return parsed;
    } catch (error) {
      if (error instanceof GridPythonClientError) throw error;
      if ((error as any)?.name === "AbortError") {
        throw new GridPythonClientError("grid_python_timeout", "timeout");
      }
      throw new GridPythonClientError(String(error), "network_error");
    } finally {
      clearTimeout(timer);
    }
  };

  const primaryBaseUrl = resolveBaseUrl();
  try {
    return await requestToBase(primaryBaseUrl);
  } catch (error) {
    const retryable = error instanceof GridPythonClientError
      && (error.code === "network_error" || error.code === "timeout");
    const fallbackBaseUrl = resolveFallbackBaseUrl(primaryBaseUrl);
    if (!retryable || !fallbackBaseUrl) throw error;
    return requestToBase(fallbackBaseUrl);
  }
}

function createRequestId(): string {
  return `grid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function shouldFallbackToV1(error: unknown): boolean {
  return error instanceof GridPythonClientError
    && (error.status === 404 || error.status === 405);
}

async function requestGridWithVersionFallback<T>(
  v2Path: string,
  v1Path: string,
  payload: Record<string, unknown>,
  parseEnvelope: (value: unknown) => { ok: boolean; payload?: T | null; error?: { code: string; message: string } | null }
): Promise<T> {
  try {
    const envelopeJson = await requestJson(v2Path, {
      protocolVersion: "grid.v2",
      requestId: createRequestId(),
      payload
    });
    let envelope: ReturnType<typeof parseEnvelope>;
    try {
      envelope = parseEnvelope(envelopeJson);
    } catch (parseError) {
      try {
        return v1Path.endsWith("/preview")
          ? previewResponseSchema.parse(envelopeJson) as T
          : planResponseSchema.parse(envelopeJson) as T;
      } catch {
        throw parseError;
      }
    }
    if (!envelope.ok) {
      const errorCode = envelope.error?.code ?? "grid_envelope_error";
      const errorMessage = envelope.error?.message ?? "grid python v2 request failed";
      throw new GridPythonClientError(errorMessage, errorCode);
    }
    if (!envelope.payload) {
      throw new GridPythonClientError("grid python v2 response missing payload", "invalid_response");
    }
    return envelope.payload;
  } catch (error) {
    if (!shouldFallbackToV1(error)) throw error;
    const legacyJson = await requestJson(v1Path, payload);
    return v1Path.endsWith("/preview")
      ? previewResponseSchema.parse(legacyJson) as T
      : planResponseSchema.parse(legacyJson) as T;
  }
}

export async function requestGridPreview(payload: Record<string, unknown>): Promise<GridPreviewResponse> {
  return requestGridWithVersionFallback<GridPreviewResponse>(
    "/v2/grid/preview",
    "/v1/grid/preview",
    payload,
    (value) => previewEnvelopeResponseSchema.parse(value)
  );
}

export async function requestGridPlan(payload: Record<string, unknown>): Promise<GridPlanResponse> {
  return requestGridWithVersionFallback<GridPlanResponse>(
    "/v2/grid/plan",
    "/v1/grid/plan",
    payload,
    (value) => planEnvelopeResponseSchema.parse(value)
  );
}
