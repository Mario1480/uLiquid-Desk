import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  PRESALE_CSRF_COOKIE,
  PRESALE_SESSION_COOKIE,
  SESSION_COOKIE,
  createCsrfToken,
  csrfCookieOptions
} from "../auth/cookies.js";
import { attachRequestContext } from "../requestContext.js";

const DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "30");
const CSRF_MAX_AGE_MS = CSRF_TTL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_AGENT_CHAT_REQUEST_TIMEOUT_MS = 120_000;

function resolveCorsOrigins(): string[] {
  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.includes("http://localhost:3000") && !origins.includes("http://127.0.0.1:3000")) {
    origins.push("http://127.0.0.1:3000");
  }
  if (origins.includes("http://127.0.0.1:3000") && !origins.includes("http://localhost:3000")) {
    origins.push("http://localhost:3000");
  }

  return origins;
}

function isPrivateIpv4Host(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
}

function isDevLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.port && parsed.port !== "3000") return false;
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".local")) return true;
    if (!host.includes(".")) return true;
    return isPrivateIpv4Host(host);
  } catch {
    return false;
  }
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureCsrfCookie(req: express.Request, res: express.Response, cookieName = CSRF_COOKIE): string {
  const current = typeof req.cookies?.[cookieName] === "string"
    ? String(req.cookies[cookieName]).trim()
    : "";
  if (current) return current;
  const token = createCsrfToken();
  res.cookie(cookieName, token, csrfCookieOptions(CSRF_MAX_AGE_MS));
  return token;
}

export function enforceSessionCsrf(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const deskSessionToken = typeof req.cookies?.[SESSION_COOKIE] === "string"
    ? String(req.cookies[SESSION_COOKIE]).trim()
    : "";
  const presaleSessionToken = typeof req.cookies?.[PRESALE_SESSION_COOKIE] === "string"
    ? String(req.cookies[PRESALE_SESSION_COOKIE]).trim()
    : "";
  const sessionToken = deskSessionToken || presaleSessionToken;
  if (!sessionToken) return next();

  const presaleRequest = req.path === "/uliq/public" || req.path.startsWith("/uliq/public/");
  const csrfCookieName = presaleRequest || (presaleSessionToken && !deskSessionToken)
    ? PRESALE_CSRF_COOKIE
    : CSRF_COOKIE;

  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    ensureCsrfCookie(req, res, csrfCookieName);
    return next();
  }

  const csrfCookie = typeof req.cookies?.[csrfCookieName] === "string"
    ? String(req.cookies[csrfCookieName]).trim()
    : "";
  const csrfHeader = String(req.get(CSRF_HEADER) ?? "").trim();
  if (csrfCookie && csrfHeader && timingSafeStringEqual(csrfCookie, csrfHeader)) {
    return next();
  }

  if (!csrfCookie) {
    res.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions(CSRF_MAX_AGE_MS));
  }
  res.status(403).json({ error: "invalid_csrf_token" });
}

function readRequestTimeoutMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.trunc(parsed)) : fallback;
}

export function resolveRequestTimeoutMs(
  req: Pick<express.Request, "method" | "path">,
  env: NodeJS.ProcessEnv = process.env
): number {
  const defaultTimeoutMs = readRequestTimeoutMs(env.API_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
  const isAgentChatMessage = req.method.toUpperCase() === "POST"
    && /^\/api\/agent-chat\/conversations\/[^/]+\/messages\/?$/.test(req.path);
  if (!isAgentChatMessage) return defaultTimeoutMs;
  return Math.max(
    defaultTimeoutMs,
    readRequestTimeoutMs(env.API_AGENT_CHAT_REQUEST_TIMEOUT_MS, DEFAULT_AGENT_CHAT_REQUEST_TIMEOUT_MS)
  );
}

export function requestTimeoutMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const timeoutMs = resolveRequestTimeoutMs(req);
  const timer = setTimeout(() => {
    if (res.headersSent || res.writableEnded) return;
    res.status(504).json({
      error: "request_timeout",
      message: "The request took too long to complete."
    });
  }, timeoutMs);
  timer.unref?.();

  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));
  next();
}

export function configureApiBaseMiddleware(app: express.Express): void {
  const origins = resolveCorsOrigins();

  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      hsts: process.env.NODE_ENV === "production" ? undefined : false
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (origins.includes("*") || origins.includes(origin)) return callback(null, true);
        if (process.env.NODE_ENV !== "production" && isDevLocalOrigin(origin)) return callback(null, true);
        return callback(new Error("not_allowed_by_cors"));
      },
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(enforceSessionCsrf);
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    }
  }));
  app.use(attachRequestContext);
  app.use(requestTimeoutMiddleware);
}
