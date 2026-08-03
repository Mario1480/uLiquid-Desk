export type CacheEntry<T> = {
  value: T;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
};

export class StaleWhileRevalidateCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, now = Date.now()): { value: T; stale: boolean } | null {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry || entry.staleUntil <= now) {
      if (entry) this.entries.delete(key);
      return null;
    }
    return { value: entry.value, stale: entry.freshUntil <= now };
  }

  set<T>(key: string, value: T, freshTtlMs: number, staleTtlMs: number, now = Date.now()): void {
    this.entries.set(key, {
      value,
      createdAt: now,
      freshUntil: now + Math.max(1, freshTtlMs),
      staleUntil: now + Math.max(freshTtlMs, staleTtlMs)
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

type CircuitEntry = { failures: number; openedAt: number | null };

export class ProviderCircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 60_000
  ) {}

  state(providerId: string, now = Date.now()): "closed" | "open" | "half_open" {
    const entry = this.entries.get(providerId);
    if (!entry || entry.openedAt === null) return "closed";
    return now - entry.openedAt >= this.cooldownMs ? "half_open" : "open";
  }

  canRequest(providerId: string, now = Date.now()): boolean {
    return this.state(providerId, now) !== "open";
  }

  success(providerId: string): void {
    this.entries.set(providerId, { failures: 0, openedAt: null });
  }

  failure(providerId: string, now = Date.now()): void {
    const current = this.entries.get(providerId) ?? { failures: 0, openedAt: null };
    const failures = current.failures + 1;
    this.entries.set(providerId, {
      failures,
      openedAt: failures >= this.failureThreshold ? now : current.openedAt
    });
  }
}
