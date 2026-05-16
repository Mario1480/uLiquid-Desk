import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { attachRequestContext } from "../requestContext.js";

const DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";

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
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    }
  }));
  app.use(attachRequestContext);
}
