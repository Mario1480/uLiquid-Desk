import crypto from "node:crypto";
import type { Request } from "express";

type FailureState = {
  count: number;
  resetAt: number;
  lockedUntil: number;
};

const failures = new Map<string, FailureState>();

const MAX_FAILURES = Math.max(1, Number(process.env.AUTH_LOGIN_FAILURE_MAX ?? "5"));
const WINDOW_MS = Math.max(60_000, Number(process.env.AUTH_LOGIN_FAILURE_WINDOW_MS ?? String(15 * 60_000)));
const LOCK_MS = Math.max(60_000, Number(process.env.AUTH_LOGIN_FAILURE_LOCK_MS ?? String(15 * 60_000)));

function nowMs(): number {
  return Date.now();
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readEmail(req: Request): string {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  return normalizeEmail(body.email);
}

function readIp(req: Request): string {
  return String(req.ip ?? req.headers["x-forwarded-for"] ?? "unknown").trim() || "unknown";
}

export function loginFailureKey(req: Request): string {
  const email = readEmail(req) || "missing-email";
  return crypto
    .createHash("sha256")
    .update(`${email}:${readIp(req)}`)
    .digest("hex");
}

export function getLoginFailureState(req: Request): FailureState | null {
  const key = loginFailureKey(req);
  const state = failures.get(key);
  if (!state) return null;
  const now = nowMs();
  if (state.resetAt <= now && state.lockedUntil <= now) {
    failures.delete(key);
    return null;
  }
  return state;
}

export function isLoginLocked(req: Request): { locked: boolean; retryAfterSec: number } {
  const state = getLoginFailureState(req);
  if (!state || state.lockedUntil <= nowMs()) return { locked: false, retryAfterSec: 0 };
  return {
    locked: true,
    retryAfterSec: Math.max(1, Math.ceil((state.lockedUntil - nowMs()) / 1000))
  };
}

export function recordLoginFailure(req: Request): FailureState {
  const key = loginFailureKey(req);
  const now = nowMs();
  const existing = getLoginFailureState(req);
  const state: FailureState = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + WINDOW_MS, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= MAX_FAILURES) {
    state.lockedUntil = now + LOCK_MS;
  }
  failures.set(key, state);
  return state;
}

export function clearLoginFailures(req: Request): void {
  failures.delete(loginFailureKey(req));
}

export function resetLoginFailureMemoryForTests(): void {
  failures.clear();
}
