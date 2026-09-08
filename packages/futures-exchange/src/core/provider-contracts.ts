import type { MarginMode, OrderSide, OrderType } from "@mm/futures-core";
import type {
  FuturesMarketDataCapabilities,
  FuturesProviderKind,
  ProviderLiveCertificationStatus
} from "./exchange-capabilities.js";

export type ProviderMarketType = "spot" | "perpetual";
export type ProviderHealthStatus = "healthy" | "degraded" | "stale" | "unavailable" | "disabled";
export type ProviderObservationQuality = "fresh" | "degraded" | "stale";

export type CapabilityDescriptor = {
  schemaVersion: "1.0.0";
  providerId: string;
  providerKind: FuturesProviderKind;
  venue: string;
  marketTypes: readonly ProviderMarketType[];
  marketData: FuturesMarketDataCapabilities;
  execution: {
    supported: boolean;
    enabledByDefault: boolean;
    orderTypes: readonly OrderType[];
    positionModes: readonly ("one-way" | "hedge")[];
    marginModes: readonly MarginMode[];
    reduceOnly: boolean;
  };
  liveCertificationStatus: ProviderLiveCertificationStatus;
};

export type ProviderHealth = {
  providerId: string;
  status: ProviderHealthStatus;
  checkedAt: string;
  lastObservedAt: string | null;
  latencyMs: number | null;
  consecutiveFailures: number;
  reasons: readonly string[];
};

export type ProviderObservation<T> = {
  providerId: string;
  venue: string;
  marketType: ProviderMarketType;
  symbol: string;
  data: T;
  observedAt: string | null;
  fetchedAt: string;
  quality: ProviderObservationQuality;
  warnings: readonly string[];
  latencyMs: number;
};

export type ProviderTicker = {
  last: number;
  bid: number | null;
  ask: number | null;
  mark: number | null;
};

export type ProviderOrderBook = {
  bids: readonly [number, number][];
  asks: readonly [number, number][];
  quantityUnit: "base_asset";
};

export type ProviderCandle = {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBase: number;
};

export type ProviderFunding = {
  rate: number;
  intervalHours: number | null;
  markPrice: number | null;
};

export type ProviderTradingRule = {
  tickSize: number;
  stepSize: number;
  minQuantity: number;
  minNotional: number | null;
};

export interface MarketDataProvider {
  readonly capability: CapabilityDescriptor;
  getHealth(): Promise<ProviderHealth>;
  getTicker(symbol: string): Promise<ProviderObservation<ProviderTicker>>;
  getOrderBook(symbol: string, depth: number): Promise<ProviderObservation<ProviderOrderBook>>;
  getCandles(symbol: string, interval: string, limit: number): Promise<ProviderObservation<readonly ProviderCandle[]>>;
  getFunding(symbol: string): Promise<ProviderObservation<ProviderFunding>>;
  getTradingRules(symbol: string): Promise<ProviderObservation<ProviderTradingRule>>;
  close(): Promise<void>;
}

export interface ExchangeProvider {
  readonly capability: CapabilityDescriptor;
  readonly marketData: MarketDataProvider;
  getHealth(): Promise<ProviderHealth>;
  close(): Promise<void>;
}

export type ExecutionIntent = {
  schemaVersion: "1.0.0";
  executionId: string;
  idempotencyKey: string;
  tenantId: string;
  exchangeConnectionId: string;
  providerId: string;
  venue: string;
  marketType: "perpetual";
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
  reduceOnly: boolean;
};

export type CanonicalExecutionIdentity = Pick<
  ExecutionIntent,
  "executionId" | "idempotencyKey" | "tenantId" | "exchangeConnectionId" | "providerId"
> & { key: string };

export class ProviderContractError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "ProviderContractError";
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function requiredIdentifier(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_IDENTIFIER.test(normalized)) throw new ProviderContractError(`provider_${field}_invalid`);
  return normalized;
}

function positiveNumber(value: unknown, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ProviderContractError(code);
  return parsed;
}

export function canonicalExecutionIdentity(intent: ExecutionIntent): CanonicalExecutionIdentity {
  if (intent.schemaVersion !== "1.0.0") throw new ProviderContractError("execution_intent_version_unsupported");
  const executionId = requiredIdentifier(intent.executionId, "execution_id");
  const idempotencyKey = requiredIdentifier(intent.idempotencyKey, "idempotency_key");
  const tenantId = requiredIdentifier(intent.tenantId, "tenant_id");
  const exchangeConnectionId = requiredIdentifier(intent.exchangeConnectionId, "exchange_connection_id");
  const providerId = requiredIdentifier(intent.providerId, "provider_id");
  requiredIdentifier(intent.venue, "venue");
  requiredIdentifier(intent.symbol, "symbol");
  positiveNumber(intent.quantity, "execution_quantity_invalid");
  if (intent.orderType === "limit") positiveNumber(intent.price, "execution_price_invalid");
  return Object.freeze({
    executionId,
    idempotencyKey,
    tenantId,
    exchangeConnectionId,
    providerId,
    key: `v1:${JSON.stringify([tenantId, exchangeConnectionId, providerId, executionId, idempotencyKey])}`
  });
}

export function assertProviderCapability(
  descriptor: CapabilityDescriptor,
  capability: keyof FuturesMarketDataCapabilities
): void {
  const support = descriptor.marketData?.[capability];
  if (support !== "native" && support !== "linked") {
    throw new ProviderContractError("provider_capability_unsupported", `${descriptor.providerId} does not support ${capability}`);
  }
}

export function normalizeProviderTimestamp(params: {
  value: unknown;
  fetchedAtMs: number;
  staleAfterMs: number;
  futureToleranceMs?: number;
}): Pick<ProviderObservation<unknown>, "observedAt" | "fetchedAt" | "quality" | "warnings"> {
  const fetchedAt = new Date(params.fetchedAtMs).toISOString();
  const parsed = Number(params.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { observedAt: null, fetchedAt, quality: "degraded", warnings: ["provider_timestamp_missing"] };
  }
  const millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  const observedDate = new Date(millis);
  if (!Number.isFinite(observedDate.getTime())) {
    return { observedAt: null, fetchedAt, quality: "degraded", warnings: ["provider_timestamp_invalid"] };
  }
  const futureToleranceMs = Math.max(0, params.futureToleranceMs ?? 5_000);
  if (millis > params.fetchedAtMs + futureToleranceMs) {
    return { observedAt: observedDate.toISOString(), fetchedAt, quality: "degraded", warnings: ["provider_timestamp_in_future"] };
  }
  if (params.fetchedAtMs - millis > Math.max(0, params.staleAfterMs)) {
    return { observedAt: observedDate.toISOString(), fetchedAt, quality: "stale", warnings: ["provider_observation_stale"] };
  }
  return { observedAt: observedDate.toISOString(), fetchedAt, quality: "fresh", warnings: [] };
}

export function deriveProviderHealth(params: {
  providerId: string;
  enabled: boolean;
  checkedAtMs: number;
  lastObservedAt: string | null;
  latencyMs: number | null;
  consecutiveFailures: number;
  staleAfterMs: number;
  reasons?: readonly string[];
}): ProviderHealth {
  const providerId = requiredIdentifier(params.providerId, "id");
  const checkedAt = new Date(params.checkedAtMs).toISOString();
  const failures = Math.max(0, Math.trunc(params.consecutiveFailures));
  const observedMs = params.lastObservedAt ? Date.parse(params.lastObservedAt) : Number.NaN;
  const stale = Number.isFinite(observedMs) && params.checkedAtMs - observedMs > Math.max(0, params.staleAfterMs);
  const reasons = [...new Set(params.reasons ?? [])];
  let status: ProviderHealthStatus = "healthy";
  if (!params.enabled) status = "disabled";
  else if (failures > 0 && !Number.isFinite(observedMs)) status = "unavailable";
  else if (stale) status = "stale";
  else if (failures > 0 || !Number.isFinite(observedMs) || reasons.length > 0) status = "degraded";
  return Object.freeze({
    providerId,
    status,
    checkedAt,
    lastObservedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
    latencyMs: params.latencyMs !== null && Number.isFinite(params.latencyMs) && params.latencyMs >= 0
      ? params.latencyMs
      : null,
    consecutiveFailures: failures,
    reasons
  });
}

function normalizeLevel(value: unknown, quantityUnit: "base_asset" | "contracts", contractSize?: number): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new ProviderContractError("provider_orderbook_level_malformed");
  const price = positiveNumber(value[0], "provider_orderbook_price_invalid");
  const rawQuantity = positiveNumber(value[1], "provider_orderbook_quantity_invalid");
  const quantity = quantityUnit === "contracts"
    ? rawQuantity * positiveNumber(contractSize, "provider_contract_size_invalid")
    : rawQuantity;
  return [price, quantity];
}

export function normalizeProviderOrderBook(params: {
  bids: unknown;
  asks: unknown;
  quantityUnit: "base_asset" | "contracts";
  contractSize?: number;
  depth: number;
}): ProviderOrderBook {
  if (!Array.isArray(params.bids) || !Array.isArray(params.asks)) {
    throw new ProviderContractError("provider_orderbook_malformed");
  }
  const depth = Math.max(1, Math.min(500, Math.trunc(params.depth)));
  const bids = params.bids.slice(0, depth).map((level) => normalizeLevel(level, params.quantityUnit, params.contractSize));
  const asks = params.asks.slice(0, depth).map((level) => normalizeLevel(level, params.quantityUnit, params.contractSize));
  if (bids.length === 0 || asks.length === 0) throw new ProviderContractError("provider_orderbook_empty");
  bids.sort((left, right) => right[0] - left[0]);
  asks.sort((left, right) => left[0] - right[0]);
  if (bids[0][0] >= asks[0][0]) throw new ProviderContractError("provider_orderbook_crossed");
  return { bids, asks, quantityUnit: "base_asset" };
}

export async function runBoundedProviderRead<T>(params: {
  operation: string;
  maxAttempts: number;
  timeoutMs: number;
  read: (context: { attempt: number; signal: AbortSignal }) => Promise<T>;
  isRetryable: (error: unknown) => boolean;
}): Promise<{ value: T; attempts: number; latencyMs: number }> {
  const maxAttempts = Math.max(1, Math.min(3, Math.trunc(params.maxAttempts)));
  const timeoutMs = Math.max(1, Math.min(30_000, Math.trunc(params.timeoutMs)));
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new ProviderContractError("provider_read_timeout")), timeoutMs);
    try {
      const value = await Promise.race([
        params.read({ attempt, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        })
      ]);
      return { value, attempts: attempt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderContractError && error.code === "provider_read_timeout") throw error;
      if (attempt >= maxAttempts || !params.isRetryable(error)) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new ProviderContractError("provider_read_failed", params.operation);
}

const SECRET_FIELD = /(?:authorization|api[_-]?(?:key|secret)|access[_-]?(?:key|secret|passphrase)|secret[_-]?key|passphrase|password|private[_-]?key|token|credential)/i;
const SECRET_TEXT = /(?:authorization\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s,;]+|(?:bearer|basic)\s+[^\s,;]+|(?:api[_-]?(?:key|secret)|access[_-]?(?:key|secret|passphrase)|secret[_-]?key|passphrase|password|private[_-]?key|token|credential)\s*[:=]\s*[^\s,;]+)/gi;

export function redactProviderDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, 4_000).replace(SECRET_TEXT, "[REDACTED]");
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactProviderDiagnostics(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 200)) {
    result[key] = SECRET_FIELD.test(key) ? "[REDACTED]" : redactProviderDiagnostics(nested, depth + 1);
  }
  return result;
}

export type ProviderAccountBinding = {
  tenantId: string;
  exchangeConnectionId: string;
  providerId: string;
  providerAccountRef: string;
  enabled: boolean;
};

export function assertProviderAccountBinding(
  binding: ProviderAccountBinding | null,
  request: Pick<ProviderAccountBinding, "tenantId" | "exchangeConnectionId" | "providerId">
): ProviderAccountBinding {
  if (!binding || !binding.enabled) throw new ProviderContractError("provider_account_binding_unavailable");
  const bindingTenantId = requiredIdentifier(binding.tenantId, "tenant_id");
  const bindingConnectionId = requiredIdentifier(binding.exchangeConnectionId, "exchange_connection_id");
  const bindingProviderId = requiredIdentifier(binding.providerId, "provider_id");
  const requestTenantId = requiredIdentifier(request.tenantId, "tenant_id");
  const requestConnectionId = requiredIdentifier(request.exchangeConnectionId, "exchange_connection_id");
  const requestProviderId = requiredIdentifier(request.providerId, "provider_id");
  if (
    bindingTenantId !== requestTenantId
    || bindingConnectionId !== requestConnectionId
    || bindingProviderId !== requestProviderId
  ) {
    throw new ProviderContractError("provider_account_binding_mismatch");
  }
  requiredIdentifier(binding.providerAccountRef, "account_ref");
  return Object.freeze({ ...binding });
}
