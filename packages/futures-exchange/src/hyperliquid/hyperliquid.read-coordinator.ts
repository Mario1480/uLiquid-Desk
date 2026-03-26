import { computeRetryDelayMs } from "../core/retry-policy.js";

export type HyperliquidReadErrorCategory =
  | "rate_limited"
  | "timeout"
  | "network"
  | "upstream"
  | "client"
  | "unknown";

export class HyperliquidReadCoordinatorError extends Error {
  readonly category: HyperliquidReadErrorCategory;
  readonly status?: number;
  readonly cacheAgeMs: number | null;
  readonly key: string;

  constructor(params: {
    key: string;
    message: string;
    category: HyperliquidReadErrorCategory;
    status?: number;
    cacheAgeMs?: number | null;
  }) {
    super(params.message);
    this.name = "HyperliquidReadCoordinatorError";
    this.key = params.key;
    this.category = params.category;
    this.status = params.status;
    this.cacheAgeMs = params.cacheAgeMs ?? null;
  }
}

export type HyperliquidReadResult<T> = {
  value: T;
  fromCache: boolean;
  stale: boolean;
  degraded: boolean;
  rateLimited: boolean;
  cacheAgeMs: number | null;
  category: HyperliquidReadErrorCategory | null;
  reason: string | null;
  retryCount: number;
};

type CacheEntry = {
  value: unknown;
  storedAt: number;
  cooldownUntil: number;
  lastErrorMessage: string | null;
  lastErrorCategory: HyperliquidReadErrorCategory | null;
  lastErrorStatus?: number;
};

type ExecuteHyperliquidReadParams<T> = {
  key: string;
  ttlMs: number;
  staleMs: number;
  cooldownMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  read: () => Promise<T>;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<HyperliquidReadResult<unknown>>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const direct = Number(record.status ?? record.statusCode);
  if (Number.isFinite(direct) && direct >= 100) return Math.trunc(direct);
  const response = record.response;
  if (response && typeof response === "object") {
    const nested = Number((response as Record<string, unknown>).status);
    if (Number.isFinite(nested) && nested >= 100) return Math.trunc(nested);
  }
  return undefined;
}

export function classifyHyperliquidReadError(error: unknown): {
  category: HyperliquidReadErrorCategory;
  status?: number;
  message: string;
} {
  const status = parseStatus(error);
  const message = String(
    (error && typeof error === "object" && "message" in error
      ? (error as Record<string, unknown>).message
      : error) ?? "hyperliquid_read_failed"
  );
  const normalized = message.trim().toLowerCase();
  const code = String(
    error && typeof error === "object" && "code" in error
      ? (error as Record<string, unknown>).code
      : ""
  ).toUpperCase();
  const name = String(
    error && typeof error === "object" && "name" in error
      ? (error as Record<string, unknown>).name
      : ""
  );

  if (status === 429 || normalized.includes("429")) {
    return { category: "rate_limited", status, message };
  }
  if (status !== undefined) {
    if (status >= 500) return { category: "upstream", status, message };
    if (status >= 400) return { category: "client", status, message };
  }
  if (
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return { category: "timeout", status, message };
  }
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    normalized.includes("network") ||
    normalized.includes("fetch failed") ||
    normalized.includes("connection reset")
  ) {
    return { category: "network", status, message };
  }
  return { category: "unknown", status, message };
}

function shouldRetry(category: HyperliquidReadErrorCategory, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  return category === "timeout" || category === "network" || category === "upstream";
}

function getCachedEntry(key: string): CacheEntry | null {
  const entry = cache.get(key);
  return entry ?? null;
}

function buildCacheResult<T>(
  entry: CacheEntry,
  params: {
    stale: boolean;
    degraded: boolean;
    retryCount?: number;
  }
): HyperliquidReadResult<T> {
  return {
    value: entry.value as T,
    fromCache: true,
    stale: params.stale,
    degraded: params.degraded,
    rateLimited: entry.lastErrorCategory === "rate_limited",
    cacheAgeMs: Math.max(0, Date.now() - entry.storedAt),
    category: entry.lastErrorCategory,
    reason: entry.lastErrorMessage,
    retryCount: Math.max(0, Math.trunc(params.retryCount ?? 0))
  };
}

function cacheValue<T>(key: string, value: T, retryCount: number): HyperliquidReadResult<T> {
  const now = Date.now();
  cache.set(key, {
    value,
    storedAt: now,
    cooldownUntil: 0,
    lastErrorMessage: null,
    lastErrorCategory: null,
    lastErrorStatus: undefined
  });
  return {
    value,
    fromCache: false,
    stale: false,
    degraded: false,
    rateLimited: false,
    cacheAgeMs: 0,
    category: null,
    reason: null,
    retryCount: Math.max(0, Math.trunc(retryCount))
  };
}

export function buildHyperliquidReadKey(params: {
  scope: string;
  identity?: string | null;
  endpoint?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
}): string {
  return [
    `scope=${params.scope}`,
    `identity=${String(params.identity ?? "").trim().toLowerCase()}`,
    `endpoint=${String(params.endpoint ?? "").trim().toLowerCase()}`,
    `symbol=${String(params.symbol ?? "").trim().toUpperCase()}`,
    `timeframe=${String(params.timeframe ?? "").trim().toLowerCase()}`
  ].join("|");
}

export async function executeHyperliquidRead<T>(
  params: ExecuteHyperliquidReadParams<T>
): Promise<HyperliquidReadResult<T>> {
  const ttlMs = Math.max(1, Math.trunc(params.ttlMs));
  const staleMs = Math.max(ttlMs, Math.trunc(params.staleMs));
  const cooldownMs = Math.max(1_000, Math.trunc(params.cooldownMs ?? 15_000));
  const retryAttempts = Math.max(1, Math.trunc(params.retryAttempts ?? 2));
  const retryBaseDelayMs = Math.max(25, Math.trunc(params.retryBaseDelayMs ?? 200));
  const now = Date.now();
  const cached = getCachedEntry(params.key);
  if (cached) {
    const ageMs = now - cached.storedAt;
    if (ageMs <= ttlMs) {
      return buildCacheResult<T>(cached, { stale: false, degraded: false });
    }
    if (cached.cooldownUntil > now && ageMs <= staleMs) {
      return buildCacheResult<T>(cached, { stale: true, degraded: true });
    }
  }

  const existing = inflight.get(params.key);
  if (existing) {
    return existing as Promise<HyperliquidReadResult<T>>;
  }

  const task = (async (): Promise<HyperliquidReadResult<T>> => {
    let attempt = 0;
    let retryCount = 0;
    let lastError: unknown = null;

    while (attempt < retryAttempts) {
      attempt += 1;
      try {
        const value = await params.read();
        return cacheValue(params.key, value, retryCount);
      } catch (error) {
        lastError = error;
        const classified = classifyHyperliquidReadError(error);
        const current = getCachedEntry(params.key);
        const cacheAgeMs = current ? Math.max(0, Date.now() - current.storedAt) : null;

        if (classified.category === "rate_limited") {
          if (current) {
            cache.set(params.key, {
              ...current,
              cooldownUntil: Date.now() + cooldownMs,
              lastErrorMessage: classified.message,
              lastErrorCategory: classified.category,
              lastErrorStatus: classified.status
            });
            if (cacheAgeMs !== null && cacheAgeMs <= staleMs) {
              return buildCacheResult<T>(cache.get(params.key) as CacheEntry, {
                stale: true,
                degraded: true,
                retryCount
              });
            }
          }
          throw new HyperliquidReadCoordinatorError({
            key: params.key,
            message: classified.message,
            category: classified.category,
            status: classified.status,
            cacheAgeMs
          });
        }

        if (!shouldRetry(classified.category, attempt, retryAttempts)) {
          if (current) {
            cache.set(params.key, {
              ...current,
              cooldownUntil: current.cooldownUntil,
              lastErrorMessage: classified.message,
              lastErrorCategory: classified.category,
              lastErrorStatus: classified.status
            });
            if (cacheAgeMs !== null && cacheAgeMs <= staleMs) {
              return buildCacheResult<T>(cache.get(params.key) as CacheEntry, {
                stale: true,
                degraded: true,
                retryCount
              });
            }
          }
          throw new HyperliquidReadCoordinatorError({
            key: params.key,
            message: classified.message,
            category: classified.category,
            status: classified.status,
            cacheAgeMs
          });
        }

        retryCount += 1;
        const jitter = Math.max(0, Math.trunc(Math.random() * 50));
        await sleep(computeRetryDelayMs(attempt, retryBaseDelayMs, 2_000) + jitter);
      }
    }

    const classified = classifyHyperliquidReadError(lastError);
    const current = getCachedEntry(params.key);
    const cacheAgeMs = current ? Math.max(0, Date.now() - current.storedAt) : null;
    if (current && cacheAgeMs !== null && cacheAgeMs <= staleMs) {
      cache.set(params.key, {
        ...current,
        lastErrorMessage: classified.message,
        lastErrorCategory: classified.category,
        lastErrorStatus: classified.status
      });
      return buildCacheResult<T>(cache.get(params.key) as CacheEntry, {
        stale: true,
        degraded: true,
        retryCount
      });
    }
    throw new HyperliquidReadCoordinatorError({
      key: params.key,
      message: classified.message,
      category: classified.category,
      status: classified.status,
      cacheAgeMs
    });
  })();

  inflight.set(params.key, task as Promise<HyperliquidReadResult<unknown>>);
  try {
    return await task;
  } finally {
    inflight.delete(params.key);
  }
}

export function clearHyperliquidReadCoordinatorForTests(): void {
  cache.clear();
  inflight.clear();
}
