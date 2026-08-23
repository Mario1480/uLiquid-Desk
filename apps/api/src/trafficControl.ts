import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE } from "./auth/cookies.js";
import { logger } from "./logger.js";
import { getCorrelationId } from "./requestContext.js";

const RATE_LIMIT_MEMORY = new Map<string, { count: number; resetAt: number }>();
const IDEMPOTENCY_MEMORY = new Map<string, { status: number; body: unknown; expiresAt: number }>();
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{1,128}$/;
let redisInitPromise: Promise<any | null> | null = null;

function readMaxEntriesEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(100, Math.floor(parsed));
}

const RATE_LIMIT_MEMORY_MAX_ENTRIES = readMaxEntriesEnv("RATE_LIMIT_MEMORY_MAX_ENTRIES", 10000);
const IDEMPOTENCY_MEMORY_MAX_ENTRIES = readMaxEntriesEnv("IDEMPOTENCY_MEMORY_MAX_ENTRIES", 10000);

async function getRedis(): Promise<any | null> {
  if (redisInitPromise) return redisInitPromise;
  redisInitPromise = (async () => {
    const redisUrl = String(process.env.API_RATE_LIMIT_REDIS_URL ?? process.env.REDIS_URL ?? "").trim();
    if (!redisUrl) return null;
    try {
      const mod = await import("ioredis");
      const RedisCtor = (mod as any)?.default ?? mod;
      const client = new RedisCtor(redisUrl);
      client.on("error", () => undefined);
      return client;
    } catch {
      return null;
    }
  })();
  return redisInitPromise;
}

function nowMs(): number {
  return Date.now();
}

function buildScopeKey(prefix: string, key: string): string {
  return `${prefix}:${key}`;
}

function hashScopeValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !IDEMPOTENCY_KEY_PATTERN.test(normalized)) return null;
  return normalized;
}

function readRawIdempotencyKey(req: Request): string {
  const header = String(req.get("x-idempotency-key") ?? "").trim();
  if (header) return header;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : null;
  const bodyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (bodyKey) return bodyKey;
  return typeof body?.actionKey === "string" ? body.actionKey.trim() : "";
}

export function readIdempotencyKey(req: Request): string | null {
  return normalizeIdempotencyKey(readRawIdempotencyKey(req));
}

function sweepMemoryMap<T extends { expiresAt?: number; resetAt?: number }>(
  map: Map<string, T>,
  maxEntries: number
): void {
  const now = nowMs();
  for (const [key, value] of map) {
    const expiresAt = value.expiresAt ?? value.resetAt ?? 0;
    if (expiresAt && expiresAt <= now) {
      map.delete(key);
    }
  }
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) break;
    map.delete(oldest);
  }
}

function sweepMemoryStores(): void {
  sweepMemoryMap(RATE_LIMIT_MEMORY, RATE_LIMIT_MEMORY_MAX_ENTRIES);
  sweepMemoryMap(IDEMPOTENCY_MEMORY, IDEMPOTENCY_MEMORY_MAX_ENTRIES);
}

const sweepInterval = setInterval(sweepMemoryStores, 60_000);
sweepInterval.unref?.();

async function incrementRateLimit(key: string, windowMs: number): Promise<{ count: number; resetAt: number; redis: boolean }> {
  const redis = await getRedis();
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
  if (redis) {
    const count = Number(await redis.incr(key));
    if (count === 1) {
      await redis.expire(key, ttlSec);
    }
    const ttl = Number(await redis.ttl(key));
    const resetAt = nowMs() + Math.max(1, ttl) * 1000;
    return { count, resetAt, redis: true };
  }

  const now = nowMs();
  sweepMemoryMap(RATE_LIMIT_MEMORY, RATE_LIMIT_MEMORY_MAX_ENTRIES);
  const existing = RATE_LIMIT_MEMORY.get(key);
  if (!existing || existing.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    RATE_LIMIT_MEMORY.set(key, next);
    return { ...next, redis: false };
  }
  existing.count += 1;
  return { ...existing, redis: false };
}

async function readIdempotentResponse(key: string): Promise<{ status: number; body: unknown } | null> {
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { status: number; body: unknown; state?: string };
      if (parsed.state && parsed.state !== "completed") return null;
      return { status: Number(parsed.status ?? 200), body: parsed.body ?? null };
    } catch {
      return null;
    }
  }

  sweepMemoryMap(IDEMPOTENCY_MEMORY, IDEMPOTENCY_MEMORY_MAX_ENTRIES);
  const row = IDEMPOTENCY_MEMORY.get(key);
  if (!row || row.expiresAt <= nowMs()) {
    if (row) IDEMPOTENCY_MEMORY.delete(key);
    return null;
  }
  return { status: row.status, body: row.body };
}

async function claimIdempotencyLock(key: string, ttlMs: number): Promise<"claimed" | "replay" | "in_progress"> {
  const redis = await getRedis();
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  if (redis) {
    const lockKey = `${key}:lock`;
    const acquired = await redis.set(lockKey, "1", "EX", ttlSec, "NX");
    if (acquired === "OK") return "claimed";
    const completed = await readIdempotentResponse(key);
    return completed ? "replay" : "in_progress";
  }

  sweepMemoryMap(IDEMPOTENCY_MEMORY, IDEMPOTENCY_MEMORY_MAX_ENTRIES);
  const existing = IDEMPOTENCY_MEMORY.get(key);
  if (existing && existing.expiresAt > nowMs()) return "replay";
  const lockKey = `${key}:lock`;
  const lock = IDEMPOTENCY_MEMORY.get(lockKey);
  if (lock && lock.expiresAt > nowMs()) return "in_progress";
  IDEMPOTENCY_MEMORY.set(lockKey, { status: 0, body: null, expiresAt: nowMs() + ttlMs });
  return "claimed";
}

async function clearIdempotencyLock(key: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.del(`${key}:lock`);
    return;
  }
  IDEMPOTENCY_MEMORY.delete(`${key}:lock`);
}

async function storeIdempotentResponse(key: string, ttlMs: number, payload: { status: number; body: unknown }): Promise<void> {
  const redis = await getRedis();
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const value = JSON.stringify({ state: "completed", status: payload.status, body: payload.body });
  if (redis) {
    await redis.set(key, value, "EX", ttlSec);
    await redis.del(`${key}:lock`);
    return;
  }
  sweepMemoryMap(IDEMPOTENCY_MEMORY, IDEMPOTENCY_MEMORY_MAX_ENTRIES);
  IDEMPOTENCY_MEMORY.set(key, { status: payload.status, body: payload.body, expiresAt: nowMs() + ttlMs });
  IDEMPOTENCY_MEMORY.delete(`${key}:lock`);
}

export function createRateLimitMiddleware(options: {
  name: string;
  max: number;
  windowMs: number;
  keyFn: (req: Request, res: Response) => string | null;
}) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const scope = options.keyFn(req, res);
    if (!scope) return next();
    const key = buildScopeKey(`rate_limit:${options.name}`, scope);
    const result = await incrementRateLimit(key, options.windowMs);
    if (!result.redis && process.env.NODE_ENV === "production") {
      logger.warn("api_rate_limit_store_fallback_memory", { limiter: options.name });
    }
    if (result.count <= options.max) return next();
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - nowMs()) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    logger.warn("api_rate_limit_blocked", {
      limiter: options.name,
      scope,
      correlationId: getCorrelationId(res),
      retryAfterSec
    });
    return res.status(429).json({ error: "rate_limited", retryAfterSec });
  };
}

export function createIdempotencyMiddleware(options: {
  name: string;
  ttlMs?: number;
  required?: boolean;
  resolveKey?: (req: Request, res: Response) => string | null;
}) {
  const ttlMs = Math.max(60_000, options.ttlMs ?? 10 * 60_000);
  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    const rawKey = options.resolveKey ? options.resolveKey(req, res) : readRawIdempotencyKey(req);
    const resolvedKey = normalizeIdempotencyKey(rawKey);
    if (!resolvedKey) {
      if (rawKey) {
        return res.status(400).json({ error: "idempotency_key_invalid" });
      }
      if (!options.required) return next();
      return res.status(400).json({ error: "idempotency_key_required" });
    }
    const storageKey = buildScopeKey(`idempotency:${options.name}`, resolvedKey);
    const existing = await readIdempotentResponse(storageKey);
    if (existing) {
      return res.status(existing.status).json(existing.body);
    }
    const lockResult = await claimIdempotencyLock(storageKey, ttlMs);
    if (lockResult === "replay") {
      const replay = await readIdempotentResponse(storageKey);
      if (replay) return res.status(replay.status).json(replay.body);
    }
    if (lockResult === "in_progress") {
      return res.status(409).json({ error: "idempotency_in_progress" });
    }

    res.locals.idempotencyKey = resolvedKey;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode < 500) {
        void storeIdempotentResponse(storageKey, ttlMs, { status: res.statusCode || 200, body });
      } else {
        void clearIdempotencyLock(storageKey);
      }
      return originalJson(body);
    }) as typeof res.json;

    res.on("close", () => {
      if (!res.writableEnded) {
        void clearIdempotencyLock(storageKey);
      }
    });

    return next();
  };
}

export function rateLimitByIp(req: Request): string | null {
  return String(req.ip ?? req.headers["x-forwarded-for"] ?? "").trim() || null;
}

export function rateLimitByBodyEmailOrIp(req: Request): string | null {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email) return `email:${email}`;
  return rateLimitByIp(req);
}

export function rateLimitByUser(_req: Request, res: Response): string | null {
  return typeof res.locals.user?.id === "string" && res.locals.user.id.trim()
    ? res.locals.user.id.trim()
    : null;
}

export function rateLimitBySessionOrIp(req: Request, res: Response): string | null {
  const session = String(req.cookies?.[SESSION_COOKIE] ?? "").trim();
  if (session) return `session:${hashScopeValue(session)}`;
  return rateLimitByIp(req) ?? rateLimitByUser(req, res);
}
