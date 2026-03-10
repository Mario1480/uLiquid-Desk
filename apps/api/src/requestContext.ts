import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function pickHeaderValue(req: Request, name: string): string | null {
  const raw = req.get(name);
  const trimmed = String(raw ?? "").trim();
  return trimmed || null;
}

function deriveCorrelationId(req: Request): string {
  const explicit = pickHeaderValue(req, "x-correlation-id");
  if (explicit) return explicit;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : null;
  const bodyKey = body && typeof body.idempotencyKey === "string"
    ? body.idempotencyKey.trim()
    : body && typeof body.actionKey === "string"
      ? body.actionKey.trim()
      : "";
  if (bodyKey) return bodyKey;
  const idempotencyHeader = pickHeaderValue(req, "x-idempotency-key");
  if (idempotencyHeader) return idempotencyHeader;
  return pickHeaderValue(req, "x-request-id") ?? crypto.randomUUID();
}

export function attachRequestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = pickHeaderValue(req, "x-request-id") ?? crypto.randomUUID();
  const correlationId = deriveCorrelationId(req) || requestId;
  res.locals.requestId = requestId;
  res.locals.correlationId = correlationId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-correlation-id", correlationId);
  next();
}

export function getRequestId(res: Response): string | null {
  return typeof res.locals.requestId === "string" && res.locals.requestId.trim()
    ? res.locals.requestId.trim()
    : null;
}

export function getCorrelationId(res: Response): string | null {
  return typeof res.locals.correlationId === "string" && res.locals.correlationId.trim()
    ? res.locals.correlationId.trim()
    : getRequestId(res);
}
