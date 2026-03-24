import express from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { clearSiweNonceCookie } from "./siwe.service.js";

export type RegisterAuthRoutesDeps = {
  db: any;
  registerSchema: any;
  registerVerifySchema: any;
  registerResendSchema: any;
  loginSchema: any;
  changePasswordSchema: any;
  passwordResetRequestSchema: any;
  passwordResetConfirmSchema: any;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  createSession(res: express.Response, userId: string): Promise<void>;
  destroySession(res: express.Response, token: string | null): Promise<void>;
  toSafeUser(user: any): any;
  ensureWorkspaceMembership(userId: string, email: string): Promise<any>;
  setUserToFreePlan(params: { userId: string; syncWorkspaceEntitlements: boolean }): Promise<any>;
  resolveEffectivePlanForUser(userId: string): Promise<{ plan: string }>;
  syncPrimaryWorkspaceEntitlementsForUser(params: { userId: string; effectivePlan: string }): Promise<void>;
  resolveUserContext(user: { id: string; email: string }): Promise<any>;
  getAccessSectionSettings(): Promise<any>;
  DEFAULT_ACCESS_SECTION_SETTINGS: any;
  toAuthMePayload(user: any, ctx: any, extras?: Record<string, unknown>): any;
  generateNumericCode(length?: number): string;
  hashOneTimeCode(code: string): string;
  PASSWORD_RESET_PURPOSE: string;
  PASSWORD_RESET_OTP_TTL_MIN: number;
  EMAIL_VERIFICATION_PURPOSE: string;
  EMAIL_VERIFICATION_OTP_TTL_MIN: number;
  sendReauthOtpEmail(input: { to: string; code: string; expiresAt: Date }): Promise<{ ok: boolean; error?: string }>;
  sendEmailVerificationOtpEmail(input: { to: string; code: string; expiresAt: Date }): Promise<{ ok: boolean; error?: string }>;
};

export function registerAuthRoutes(app: express.Express, deps: RegisterAuthRoutesDeps) {
  async function issueEmailVerificationCode(user: { id: string; email: string }) {
    const code = deps.generateNumericCode(6);
    const codeHash = deps.hashOneTimeCode(code);
    const expiresAt = new Date(Date.now() + deps.EMAIL_VERIFICATION_OTP_TTL_MIN * 60_000);

    await deps.db.reauthOtp.deleteMany({ where: { userId: user.id, purpose: deps.EMAIL_VERIFICATION_PURPOSE } });
    await deps.db.reauthOtp.create({
      data: { userId: user.id, purpose: deps.EMAIL_VERIFICATION_PURPOSE, codeHash, expiresAt }
    });

    const sent = await deps.sendEmailVerificationOtpEmail({ to: user.email, code, expiresAt });
    if (!sent.ok) {
      console.warn("[email-verification] email send failed", { email: user.email, reason: sent.error });
    }

    return {
      expiresAt,
      devCode: process.env.NODE_ENV !== "production" ? code : undefined
    };
  }

  async function findPendingEmailVerification(userId: string) {
    return deps.db.reauthOtp.findFirst({
      where: { userId, purpose: deps.EMAIL_VERIFICATION_PURPOSE },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiresAt: true }
    });
  }

  app.post("/auth/register", async (req, res) => {
    const parsed = deps.registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await deps.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true }
    });
    if (existing) {
      const pendingOtp = !existing.emailVerifiedAt ? await findPendingEmailVerification(existing.id) : null;
      if (!existing.emailVerifiedAt && pendingOtp) {
        const issued = await issueEmailVerificationCode(existing);
        return res.json({
          ok: true,
          pendingVerification: true,
          email: existing.email,
          expiresInMinutes: deps.EMAIL_VERIFICATION_OTP_TTL_MIN,
          ...(issued.devCode ? { devCode: issued.devCode } : {})
        });
      }
      return res.status(409).json({ error: "email_already_exists" });
    }

    const passwordHash = await deps.hashPassword(parsed.data.password);
    const user = await deps.db.user.create({
      data: { email, passwordHash, emailVerifiedAt: null },
      select: { id: true, email: true }
    });

    await deps.ensureWorkspaceMembership(user.id, user.email);
    try {
      await deps.setUserToFreePlan({ userId: user.id, syncWorkspaceEntitlements: true });
    } catch {
      // ignore billing sync issues during registration
    }
    const issued = await issueEmailVerificationCode(user);
    return res.status(201).json({
      ok: true,
      pendingVerification: true,
      email: user.email,
      expiresInMinutes: deps.EMAIL_VERIFICATION_OTP_TTL_MIN,
      ...(issued.devCode ? { devCode: issued.devCode } : {})
    });
  });

  app.post("/auth/register/resend", async (req, res) => {
    const parsed = deps.registerResendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true }
    });

    if (!user || user.emailVerifiedAt) {
      return res.json({ ok: true, expiresInMinutes: deps.EMAIL_VERIFICATION_OTP_TTL_MIN });
    }

    const pendingOtp = await findPendingEmailVerification(user.id);
    if (!pendingOtp) {
      return res.json({ ok: true, expiresInMinutes: deps.EMAIL_VERIFICATION_OTP_TTL_MIN });
    }

    const issued = await issueEmailVerificationCode(user);
    return res.json({
      ok: true,
      expiresInMinutes: deps.EMAIL_VERIFICATION_OTP_TTL_MIN,
      ...(issued.devCode ? { devCode: issued.devCode } : {})
    });
  });

  app.post("/auth/register/verify", async (req, res) => {
    const parsed = deps.registerVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, walletAddress: true, emailVerifiedAt: true }
    });
    if (!user) return res.status(400).json({ error: "invalid_or_expired_code" });

    const otp = await deps.db.reauthOtp.findFirst({
      where: { userId: user.id, purpose: deps.EMAIL_VERIFICATION_PURPOSE, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true }
    });
    if (!otp) return res.status(400).json({ error: "invalid_or_expired_code" });
    if (deps.hashOneTimeCode(parsed.data.code) !== otp.codeHash) {
      return res.status(400).json({ error: "invalid_or_expired_code" });
    }

    const verified = await deps.db.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      select: { id: true, email: true, walletAddress: true, emailVerifiedAt: true }
    });
    await deps.db.reauthOtp.deleteMany({ where: { userId: user.id, purpose: deps.EMAIL_VERIFICATION_PURPOSE } });
    await deps.createSession(res, user.id);
    return res.json({ ok: true, user: deps.toSafeUser(verified) });
  });

  app.post("/auth/login", async (req, res) => {
    const parsed = deps.loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, walletAddress: true, passwordHash: true, emailVerifiedAt: true }
    });
    if (!user?.passwordHash) return res.status(401).json({ error: "invalid_credentials" });

    const pendingEmailVerification = !user.emailVerifiedAt
      ? await findPendingEmailVerification(user.id)
      : null;
    if (pendingEmailVerification) {
      return res.status(403).json({ error: "email_not_verified", resendAvailable: true });
    }

    const passwordOk = await deps.verifyPassword(parsed.data.password, user.passwordHash);
    if (!passwordOk) return res.status(401).json({ error: "invalid_credentials" });

    await deps.ensureWorkspaceMembership(user.id, user.email);
    try {
      const resolvedPlan = await deps.resolveEffectivePlanForUser(user.id);
      await deps.syncPrimaryWorkspaceEntitlementsForUser({ userId: user.id, effectivePlan: resolvedPlan.plan });
    } catch {
      // ignore billing sync issues during login
    }
    await deps.createSession(res, user.id);
    return res.json({ user: deps.toSafeUser(user) });
  });

  app.post("/auth/logout", async (req, res) => {
    const token = req.cookies?.mm_session ?? null;
    await deps.destroySession(res, token);
    clearSiweNonceCookie(res);
    return res.json({ ok: true });
  });

  const authMeHandler = async (_req: express.Request, res: express.Response) => {
    const user = getUserFromLocals(res);
    const ctx = await deps.resolveUserContext(user);
    let accessSettings = deps.DEFAULT_ACCESS_SECTION_SETTINGS;
    try {
      accessSettings = await deps.getAccessSectionSettings();
    } catch {
      accessSettings = deps.DEFAULT_ACCESS_SECTION_SETTINGS;
    }
    return res.json(deps.toAuthMePayload(user, ctx, {
      maintenance: {
        enabled: accessSettings.maintenance.enabled,
        activeForUser: accessSettings.maintenance.enabled && !ctx.hasAdminBackendAccess
      }
    }));
  };

  app.get("/auth/me", requireAuth, authMeHandler);
  app.get("/me", requireAuth, authMeHandler);

  app.post("/auth/change-password", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const row = await deps.db.user.findUnique({ where: { id: user.id }, select: { id: true, passwordHash: true } });
    if (!row?.passwordHash) return res.status(400).json({ error: "password_not_set" });

    const ok = await deps.verifyPassword(parsed.data.currentPassword, row.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    const nextHash = await deps.hashPassword(parsed.data.newPassword);
    await deps.db.user.update({ where: { id: user.id }, data: { passwordHash: nextHash } });
    return res.json({ ok: true });
  });

  app.post("/auth/password-reset/request", async (req, res) => {
    const parsed = deps.passwordResetRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.db.user.findUnique({ where: { email }, select: { id: true, email: true } });

    let devCode: string | null = null;
    if (user) {
      const code = deps.generateNumericCode(6);
      const codeHash = deps.hashOneTimeCode(code);
      const expiresAt = new Date(Date.now() + deps.PASSWORD_RESET_OTP_TTL_MIN * 60_000);

      await deps.db.reauthOtp.deleteMany({ where: { userId: user.id, purpose: deps.PASSWORD_RESET_PURPOSE } });
      await deps.db.reauthOtp.create({
        data: { userId: user.id, purpose: deps.PASSWORD_RESET_PURPOSE, codeHash, expiresAt }
      });

      const sent = await deps.sendReauthOtpEmail({ to: user.email, code, expiresAt });
      if (!sent.ok) {
        console.warn("[password-reset] email send failed", { email: user.email, reason: sent.error });
      }

      if (process.env.NODE_ENV !== "production") devCode = code;
    }

    return res.json({ ok: true, expiresInMinutes: deps.PASSWORD_RESET_OTP_TTL_MIN, ...(devCode ? { devCode } : {}) });
  });

  app.post("/auth/password-reset/confirm", async (req, res) => {
    const parsed = deps.passwordResetConfirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await deps.db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return res.status(400).json({ error: "invalid_or_expired_code" });

    const otp = await deps.db.reauthOtp.findFirst({
      where: { userId: user.id, purpose: deps.PASSWORD_RESET_PURPOSE, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, codeHash: true }
    });
    if (!otp) return res.status(400).json({ error: "invalid_or_expired_code" });
    if (deps.hashOneTimeCode(parsed.data.code) !== otp.codeHash) {
      return res.status(400).json({ error: "invalid_or_expired_code" });
    }

    const passwordHash = await deps.hashPassword(parsed.data.newPassword);
    await deps.db.user.update({ where: { id: user.id }, data: { passwordHash } });
    await deps.db.reauthOtp.deleteMany({ where: { userId: user.id, purpose: deps.PASSWORD_RESET_PURPOSE } });
    return res.json({ ok: true });
  });
}
