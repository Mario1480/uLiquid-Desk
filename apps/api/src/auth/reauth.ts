import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { prisma } from "@mm/db";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { logger } from "../logger.js";
import {
  createRateLimitMiddleware,
  rateLimitByUser
} from "../trafficControl.js";
import {
  clearAuthCookieOptions,
  REAUTH_COOKIE,
  sessionCookieOptions
} from "./cookies.js";

export { REAUTH_COOKIE } from "./cookies.js";
export const REAUTH_OTP_PURPOSE = "reauth";

const passwordSchema = z.object({
  password: z.string().min(1).max(1_024)
});

const otpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/)
});

export type RegisterReauthRoutesDeps = {
  db: any;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  generateNumericCode(length?: number): string;
  hashOneTimeCode(code: string): string;
  sendReauthOtpEmail(input: {
    to: string;
    code: string;
    expiresAt: Date;
  }): Promise<{ ok: boolean; error?: string }>;
};

type ReauthGuardOptions = {
  consume?: boolean;
};

function readPositiveInt(value: string | undefined, fallback: number, minimum = 1): number {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.trunc(parsed));
}

function reauthSessionTtlMs(): number {
  return readPositiveInt(process.env.REAUTH_TTL_MIN, 10, 1) * 60_000;
}

function reauthOtpTtlMs(): number {
  return readPositiveInt(process.env.REAUTH_OTP_TTL_MIN, 10, 5) * 60_000;
}

function otpMaxAttempts(): number {
  return readPositiveInt(process.env.AUTH_OTP_MAX_ATTEMPTS, 5, 1);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clearReauthCookie(res: Response): void {
  res.clearCookie(REAUTH_COOKIE, clearAuthCookieOptions());
}

type ReauthSessionCredentials = {
  token: string;
  tokenHash: string;
  maxAgeMs: number;
  expiresAt: Date;
};

function buildReauthSessionCredentials(): ReauthSessionCredentials {
  const token = crypto.randomBytes(32).toString("hex");
  const maxAgeMs = reauthSessionTtlMs();
  const expiresAt = new Date(Date.now() + maxAgeMs);
  return { token, tokenHash: hashToken(token), maxAgeMs, expiresAt };
}

async function persistReauthSession(
  db: any,
  userId: string,
  credentials: ReauthSessionCredentials
): Promise<void> {
  await db.reauthSession.deleteMany({
    where: {
      OR: [
        { userId },
        { expiresAt: { lte: new Date() } }
      ]
    }
  });
  await db.reauthSession.create({
    data: {
      userId,
      tokenHash: credentials.tokenHash,
      expiresAt: credentials.expiresAt
    }
  });
}

function setReauthCookie(res: Response, credentials: ReauthSessionCredentials): void {
  res.cookie(REAUTH_COOKIE, credentials.token, sessionCookieOptions(credentials.maxAgeMs));
}

async function createReauthSession(
  db: any,
  res: Response,
  userId: string
): Promise<{ expiresAt: Date }> {
  const credentials = buildReauthSessionCredentials();
  await persistReauthSession(db, userId, credentials);
  setReauthCookie(res, credentials);
  return { expiresAt: credentials.expiresAt };
}

function sendReauthRequired(res: Response) {
  clearReauthCookie(res);
  return res.status(401).json({
    error: "REAUTH_REQUIRED",
    message: "Recent re-authentication is required."
  });
}

export function createRecentReauthGuard(db: any, options: ReauthGuardOptions = {}) {
  return async function recentReauthGuard(req: Request, res: Response, next: NextFunction) {
    const token = String(req.cookies?.[REAUTH_COOKIE] ?? "").trim();
    const userId = typeof res.locals.user?.id === "string" ? res.locals.user.id.trim() : "";
    if (!token || !userId) return sendReauthRequired(res);

    try {
      const tokenHash = hashToken(token);
      const session = await db.reauthSession.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true }
      });
      const expiresAt = session?.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session?.expiresAt ?? 0);

      if (!session || session.userId !== userId || expiresAt.getTime() <= Date.now()) {
        if (session && expiresAt.getTime() <= Date.now()) {
          await db.reauthSession.deleteMany({ where: { id: session.id } });
        }
        return sendReauthRequired(res);
      }

      if (options.consume) {
        const deleted = await db.reauthSession.deleteMany({
          where: {
            id: session.id,
            userId,
            tokenHash,
            expiresAt: { gt: new Date() }
          }
        });
        if (Number(deleted?.count ?? 0) !== 1) return sendReauthRequired(res);
        clearReauthCookie(res);
      }

      res.locals.reauth = {
        id: session.id,
        userId,
        expiresAt
      };
      return next();
    } catch (error) {
      logger.warn("reauth_session_check_failed", {
        userId,
        reason: error instanceof Error ? error.message : String(error)
      });
      return res.status(503).json({
        error: "reauth_unavailable",
        message: "Re-authentication is temporarily unavailable."
      });
    }
  };
}

const runtimeDb = prisma as any;

/** Validates a recent re-authentication session without consuming it. */
export const requireRecentReauth = createRecentReauthGuard(runtimeDb);

/** Atomically consumes a recent re-authentication session before a sensitive write. */
export const consumeRecentReauth = createRecentReauthGuard(runtimeDb, { consume: true });

export function registerReauthRoutes(app: express.Express, deps: RegisterReauthRoutesDeps) {
  const passwordRateLimit = createRateLimitMiddleware({
    name: "auth_reauth_password",
    max: readPositiveInt(process.env.REAUTH_PASSWORD_MAX_ATTEMPTS, 8),
    windowMs: 10 * 60_000,
    keyFn: rateLimitByUser
  });
  const requestOtpRateLimit = createRateLimitMiddleware({
    name: "auth_reauth_request_otp",
    max: readPositiveInt(process.env.REAUTH_OTP_REQUEST_MAX, 3),
    windowMs: 10 * 60_000,
    keyFn: rateLimitByUser
  });
  const verifyOtpRateLimit = createRateLimitMiddleware({
    name: "auth_reauth_verify_otp",
    max: readPositiveInt(process.env.REAUTH_OTP_VERIFY_MAX_ATTEMPTS, 8),
    windowMs: 10 * 60_000,
    keyFn: rateLimitByUser
  });

  app.post("/auth/reauth", requireAuth, passwordRateLimit, async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    const row = await deps.db.user.findUnique({
      where: { id: user.id },
      select: { id: true, passwordHash: true }
    });
    if (!row?.passwordHash) return res.status(400).json({ error: "password_not_set" });

    let passwordOk = false;
    try {
      passwordOk = await deps.verifyPassword(parsed.data.password, row.passwordHash);
    } catch (error) {
      logger.warn("reauth_password_verify_failed", {
        userId: user.id,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    if (!passwordOk) return res.status(401).json({ error: "invalid_credentials" });

    await deps.db.reauthOtp.deleteMany({
      where: { userId: user.id, purpose: REAUTH_OTP_PURPOSE }
    });
    const session = await createReauthSession(deps.db, res, user.id);
    return res.json({ ok: true, expiresAt: session.expiresAt.toISOString() });
  });

  app.post("/auth/reauth/request-otp", requireAuth, requestOtpRateLimit, async (_req, res) => {
    const user = getUserFromLocals(res);
    const row = await deps.db.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, emailVerifiedAt: true }
    });
    if (!row?.email) return res.status(400).json({ error: "email_not_set" });
    if (!row.emailVerifiedAt) return res.status(403).json({ error: "email_not_verified" });

    const code = deps.generateNumericCode(6);
    const expiresAt = new Date(Date.now() + reauthOtpTtlMs());
    await deps.db.reauthOtp.deleteMany({
      where: { userId: user.id, purpose: REAUTH_OTP_PURPOSE }
    });
    await deps.db.reauthOtp.create({
      data: {
        userId: user.id,
        purpose: REAUTH_OTP_PURPOSE,
        codeHash: deps.hashOneTimeCode(code),
        attemptCount: 0,
        lockedUntil: null,
        expiresAt
      }
    });

    let sent: { ok: boolean; error?: string };
    try {
      sent = await deps.sendReauthOtpEmail({ to: row.email, code, expiresAt });
    } catch (error) {
      sent = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!sent.ok) {
      logger.warn("reauth_otp_email_failed", { userId: user.id, reason: sent.error ?? "unknown" });
      if (process.env.NODE_ENV === "production") {
        await deps.db.reauthOtp.deleteMany({
          where: { userId: user.id, purpose: REAUTH_OTP_PURPOSE }
        });
        return res.status(503).json({ error: "email_unavailable" });
      }
    }

    return res.json({
      ok: true,
      expiresAt: expiresAt.toISOString(),
      expiresInMinutes: Math.ceil(reauthOtpTtlMs() / 60_000),
      ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {})
    });
  });

  app.post("/auth/reauth/verify-otp", requireAuth, verifyOtpRateLimit, async (req, res) => {
    const parsed = otpSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    const now = new Date();
    const otp = await deps.db.reauthOtp.findFirst({
      where: {
        userId: user.id,
        purpose: REAUTH_OTP_PURPOSE,
        expiresAt: { gt: now }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        codeHash: true,
        attemptCount: true,
        lockedUntil: true,
        expiresAt: true
      }
    });
    const lockedUntil = otp?.lockedUntil instanceof Date
      ? otp.lockedUntil
      : otp?.lockedUntil
        ? new Date(otp.lockedUntil)
        : null;
    if (!otp || (lockedUntil && lockedUntil.getTime() > Date.now())) {
      return res.status(400).json({ error: "invalid_or_expired_code" });
    }

    const submittedHash = deps.hashOneTimeCode(parsed.data.code);
    if (!constantTimeEqual(submittedHash, otp.codeHash)) {
      const nextAttemptCount = Number(otp.attemptCount ?? 0) + 1;
      await deps.db.reauthOtp.updateMany({
        where: {
          id: otp.id,
          userId: user.id,
          purpose: REAUTH_OTP_PURPOSE,
          codeHash: otp.codeHash,
          attemptCount: Number(otp.attemptCount ?? 0),
          expiresAt: { gt: new Date() },
          OR: [
            { lockedUntil: null },
            { lockedUntil: { lte: new Date() } }
          ]
        },
        data: {
          attemptCount: { increment: 1 },
          lockedUntil: nextAttemptCount >= otpMaxAttempts() ? otp.expiresAt : null
        }
      });
      return res.status(400).json({ error: "invalid_or_expired_code" });
    }

    if (typeof deps.db.$transaction !== "function") {
      logger.warn("reauth_otp_transaction_unavailable", { userId: user.id });
      return res.status(503).json({ error: "reauth_unavailable" });
    }

    const credentials = buildReauthSessionCredentials();
    let claimed = false;
    try {
      claimed = await deps.db.$transaction(async (tx: any) => {
        const deleted = await tx.reauthOtp.deleteMany({
          where: {
            id: otp.id,
            userId: user.id,
            purpose: REAUTH_OTP_PURPOSE,
            codeHash: submittedHash,
            attemptCount: Number(otp.attemptCount ?? 0),
            expiresAt: { gt: new Date() },
            OR: [
              { lockedUntil: null },
              { lockedUntil: { lte: new Date() } }
            ]
          }
        });
        if (Number(deleted?.count ?? 0) !== 1) return false;
        await persistReauthSession(tx, user.id, credentials);
        return true;
      });
    } catch (error) {
      logger.warn("reauth_otp_claim_failed", {
        userId: user.id,
        reason: error instanceof Error ? error.message : String(error)
      });
      return res.status(503).json({ error: "reauth_unavailable" });
    }
    if (!claimed) return res.status(400).json({ error: "invalid_or_expired_code" });

    setReauthCookie(res, credentials);
    return res.json({ ok: true, expiresAt: credentials.expiresAt.toISOString() });
  });
}
