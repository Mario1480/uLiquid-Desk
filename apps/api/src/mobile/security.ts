import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";
import { getCorrelationId, getRequestId } from "../requestContext.js";
import {
  createRateLimitMiddleware,
  rateLimitByIp,
  rateLimitBySessionOrIp
} from "../trafficControl.js";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_STRING_LENGTH = 4096;
const MAX_INPUT_DEPTH = 12;

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeMobileInput(value: unknown, depth = 0): unknown {
  if (depth > MAX_INPUT_DEPTH) return null;
  if (typeof value === "string") {
    return value.replace(CONTROL_CHARS, "").trim().slice(0, MAX_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMobileInput(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(CONTROL_CHARS, "").trim().slice(0, 191),
        sanitizeMobileInput(item, depth + 1)
      ])
    );
  }
  return value;
}

export function sanitizeMobileRequest(req: Request, _res: Response, next: NextFunction) {
  req.body = sanitizeMobileInput(req.body);
  req.query = sanitizeMobileInput(req.query) as typeof req.query;
  req.params = sanitizeMobileInput(req.params) as typeof req.params;
  next();
}

export function createMobileRateLimitMiddlewares() {
  const readLimit = createRateLimitMiddleware({
    name: "mobile_read",
    max: readPositiveNumberEnv("MOBILE_API_READ_RATE_LIMIT_MAX", 300),
    windowMs: readPositiveNumberEnv("MOBILE_API_READ_RATE_LIMIT_WINDOW_MS", 5 * 60_000),
    keyFn: rateLimitBySessionOrIp
  });
  const writeLimit = createRateLimitMiddleware({
    name: "mobile_write",
    max: readPositiveNumberEnv("MOBILE_API_WRITE_RATE_LIMIT_MAX", 60),
    windowMs: readPositiveNumberEnv("MOBILE_API_WRITE_RATE_LIMIT_WINDOW_MS", 5 * 60_000),
    keyFn: rateLimitBySessionOrIp
  });
  const anonymousLimit = createRateLimitMiddleware({
    name: "mobile_anonymous",
    max: readPositiveNumberEnv("MOBILE_API_ANON_RATE_LIMIT_MAX", 60),
    windowMs: readPositiveNumberEnv("MOBILE_API_ANON_RATE_LIMIT_WINDOW_MS", 5 * 60_000),
    keyFn: (req) => String(req.cookies?.mm_session ?? "").trim() ? null : rateLimitByIp(req)
  });

  return [
    anonymousLimit,
    (req: Request, res: Response, next: NextFunction) => {
      const method = String(req.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        return readLimit(req, res, next);
      }
      return writeLimit(req, res, next);
    }
  ];
}

export function standardizeMobileErrorResponses(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && isRecord(body) && typeof body.error === "string") {
      const errorCode = body.error;
      const message = typeof body.message === "string" && body.message.trim()
        ? body.message
        : errorCode;
      return originalJson({
        ...body,
        error: errorCode,
        message,
        ok: false,
        requestId: getRequestId(res),
        correlationId: getCorrelationId(res)
      });
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
}

export function monitorFailedMobileRequests(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    if (res.statusCode < 400) return;
    logger.warn("mobile_api_request_failed", {
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode: res.statusCode,
      requestId: getRequestId(res),
      correlationId: getCorrelationId(res),
      userId: typeof res.locals.user?.id === "string" ? res.locals.user.id : null
    });
  });
  next();
}
