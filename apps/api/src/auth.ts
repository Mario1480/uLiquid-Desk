import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import argon2 from "argon2";
import { prisma } from "@mm/db";
import { buildPermissions, PERMISSION_KEYS } from "./rbac.js";
import {
  hasPermissionRequirement,
  resolvePermissionRequirementForRequest
} from "./auth/permissions.js";
import { isSuperadminEmail } from "./auth/superadmin.js";
import {
  CSRF_COOKIE,
  REAUTH_COOKIE,
  SESSION_COOKIE,
  clearAuthCookieOptions,
  createCsrfToken,
  csrfCookieOptions,
  sessionCookieOptions
} from "./auth/cookies.js";

const db = prisma as any;

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "30");
const SESSION_IDLE_GRACE_MS = 5_000;
const SESSION_DEVICE_HEADER_MAX = 191;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parsePermissions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sanitizeSessionMetaValue(value: unknown, max = SESSION_DEVICE_HEADER_MAX): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  return normalized || null;
}

function readHeader(req: Request | undefined, ...names: string[]): string | null {
  if (!req) return null;
  for (const name of names) {
    const value = sanitizeSessionMetaValue(req.get(name));
    if (value) return value;
  }
  return null;
}

function readRequestIp(req: Request | undefined): string | null {
  if (!req) return null;
  return sanitizeSessionMetaValue(String(req.ip ?? req.headers["x-forwarded-for"] ?? ""), 255);
}

function readSessionDeviceMeta(req?: Request) {
  return {
    deviceId: readHeader(req, "x-mobile-device-id", "x-device-id"),
    deviceName: readHeader(req, "x-mobile-device-name", "x-device-name"),
    devicePlatform: readHeader(req, "x-mobile-platform", "x-platform") ?? "web",
    appVersion: readHeader(req, "x-mobile-app-version", "x-app-version"),
    ipAddress: readRequestIp(req),
    userAgent: sanitizeSessionMetaValue(req?.get("user-agent"), 500)
  };
}

function isSessionIdleExpired(session: any): boolean {
  if (!session?.user?.autoLogoutEnabled) return false;
  const minutes = Number(session.user.autoLogoutMinutes ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  const lastActiveAt = session.lastActiveAt instanceof Date
    ? session.lastActiveAt.getTime()
    : new Date(session.lastActiveAt ?? 0).getTime();
  if (!Number.isFinite(lastActiveAt)) return false;
  return Date.now() - lastActiveAt > (minutes * 60_000 + SESSION_IDLE_GRACE_MS);
}

async function resolvePermissionsForSessionUser(user: { id: string; email: string }): Promise<Record<string, unknown>> {
  if (isSuperadminEmail(user.email)) return buildPermissions(PERMISSION_KEYS);
  const member = await db.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { role: true },
    orderBy: { createdAt: "asc" }
  });
  return parsePermissions(member?.role?.permissions);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

export async function createSession(res: Response, userId: string, req?: Request) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const maxAgeMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + maxAgeMs);
  const now = new Date();
  const meta = readSessionDeviceMeta(req);

  await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      lastActiveAt: now,
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      devicePlatform: meta.devicePlatform,
      appVersion: meta.appVersion,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent
    }
  });

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(maxAgeMs));
  res.cookie(CSRF_COOKIE, createCsrfToken(), csrfCookieOptions(maxAgeMs));
}

export async function destroySession(res: Response, token?: string | null) {
  if (token) {
    await db.session.deleteMany({
      where: { tokenHash: hashToken(token) }
    });
  }

  const opts = clearAuthCookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, opts);
  res.clearCookie(REAUTH_COOKIE, opts);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: "unauthorized", message: "Authentication is required." });

    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true }
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
      await destroySession(res, token);
      return res.status(401).json({ error: "session_expired", message: "Session expired. Please sign in again." });
    }

    if (isSessionIdleExpired(session)) {
      await destroySession(res, token);
      return res.status(401).json({ error: "session_expired", message: "Session expired. Please sign in again." });
    }

    const meta = readSessionDeviceMeta(req);
    await db.session.update({
      where: { id: session.id },
      data: {
        lastActiveAt: new Date(),
        ...(meta.deviceId && !session.deviceId ? { deviceId: meta.deviceId } : {}),
        ...(meta.deviceName && !session.deviceName ? { deviceName: meta.deviceName } : {}),
        ...(meta.devicePlatform && !session.devicePlatform ? { devicePlatform: meta.devicePlatform } : {}),
        ...(meta.appVersion ? { appVersion: meta.appVersion } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {})
      }
    });

    res.locals.user = {
      id: session.user.id,
      email: session.user.email,
      walletAddress: session.user.walletAddress ?? null,
      emailVerifiedAt: session.user.emailVerifiedAt ?? null
    };

    const permissionRequirement = resolvePermissionRequirementForRequest(
      req.method,
      req.originalUrl ?? req.path,
      req.body
    );
    if (permissionRequirement) {
      const permissions = await resolvePermissionsForSessionUser({
        id: session.user.id,
        email: session.user.email
      });
      res.locals.permissions = permissions;
      if (!hasPermissionRequirement(permissions, permissionRequirement)) {
        return res.status(403).json({
          error: "forbidden",
          message: "permission_required",
          requiredPermissions: permissionRequirement.any
        });
      }
    }
    next();
  } catch (error) {
    console.error("[auth] requireAuth failed", error);
    return res.status(503).json({ error: "auth_unavailable" });
  }
}

export function getUserFromLocals(res: Response): {
  id: string;
  email: string;
  walletAddress?: string | null;
  emailVerifiedAt?: Date | null;
} {
  return res.locals.user as {
    id: string;
    email: string;
    walletAddress?: string | null;
    emailVerifiedAt?: Date | null;
  };
}
