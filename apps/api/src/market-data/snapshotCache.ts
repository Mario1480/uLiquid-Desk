import { z } from "zod";

export type SnapshotCacheOptions = { now?: () => number; maxEntries?: number; maxInFlight?: number; timeoutMs?: number };

// Only validated, normalized public snapshots may enter this cache.
export function createSnapshotCache<T>(options: SnapshotCacheOptions = {}) {
  const config = z.object({ maxEntries: z.number().int().positive(), maxInFlight: z.number().int().positive(), timeoutMs: z.number().int().positive() })
    .parse({ maxEntries: options.maxEntries ?? 128, maxInFlight: options.maxInFlight ?? 32, timeoutMs: options.timeoutMs ?? 8_000 });
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; snapshot: T }>();
  const inFlight = new Map<string, Promise<T>>();
  return {
    async read(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ snapshot: T; cacheHit: boolean }> {
      for (const [k, value] of cache) if (value.expiresAt <= now()) cache.delete(k);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key); cache.set(key, cached);
        return { snapshot: structuredClone(cached.snapshot), cacheHit: true };
      }
      const pending = inFlight.get(key);
      if (pending) return { snapshot: structuredClone(await pending), cacheHit: true };
      if (inFlight.size >= config.maxInFlight) throw new Error("shared_market_data_busy");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const loading = Promise.resolve().then(load);
      const task = Promise.race([loading, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("shared_market_data_timeout")), config.timeoutMs);
      })]).then((snapshot) => {
        if (cache.size >= config.maxEntries) cache.delete(cache.keys().next().value!);
        cache.set(key, { expiresAt: now() + ttlMs, snapshot: structuredClone(snapshot) });
        return snapshot;
      }).finally(() => {
        if (timer) clearTimeout(timer);
        // Retain the slot until an uncancellable underlying request settles.
        void loading.then(() => inFlight.delete(key), () => inFlight.delete(key));
      });
      inFlight.set(key, task);
      return { snapshot: structuredClone(await task), cacheHit: false };
    }
  };
}

// Weak ownership ties pinned snapshots to an execution context, never to a user-
// supplied run ID. Rejected reads are retryable; successful inputs remain pinned.
const runs = new WeakMap<object, Map<string, Promise<unknown>>>();
export async function pinRunSnapshot<T>(owner: object, key: string, load: () => Promise<T>): Promise<T> {
  let snapshots = runs.get(owner);
  if (!snapshots) { snapshots = new Map(); runs.set(owner, snapshots); }
  const existing = snapshots.get(key);
  if (existing) return structuredClone(await existing) as T;
  if (snapshots.size >= 32) throw new Error("agent_market_snapshot_budget_exceeded");
  const task = Promise.resolve().then(load).catch((error) => { snapshots!.delete(key); throw error; });
  snapshots.set(key, task);
  return structuredClone(await task);
}
