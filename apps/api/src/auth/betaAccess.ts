import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { readRegistrationSettings } from "./registrationSettings.js";
import { logger } from "../logger.js";
import { LEGAL_ACKNOWLEDGEMENT_VERSION, LEGAL_ACKNOWLEDGEMENT_TEXT_HASH } from "../legalAcknowledgement.js";
import { BetaAccessError, betaConfig, betaHash, createBetaLimiter, verifyBetaTurnstile, type BetaLimit } from "./betaAccessSecurity.js";

const SETTING = "auth.beta-access.v1";
const DAY = 86400000;
const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
const applicationSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  motivation: z.string().trim().min(1).max(1000), locale: z.enum(["de", "en"]).default("en"),
  companyWebsite: z.string().max(500).default(""), turnstileToken: z.string().max(2048)
});
const completionSchema = tokenSchema.extend({ password: z.string().min(8).max(256), legalAcknowledgementAccepted: z.literal(true), legalAcknowledgementVersion: z.string().max(64) });
const actionSchema = z.object({ action: z.enum(["approve", "resend", "defer", "reject", "revoke", "delete"]) });
type Mail = { to: string; subject: string; text: string };
type Audit = { tx: Prisma.TransactionClient; actorUserId: string; action: string; targetType: string; targetId: string; metadata: Prisma.InputJsonObject; ip: string | null };
export type BetaAccessDeps = {
  db: PrismaClient;
  requireSuperadmin(res: Response): Promise<boolean>;
  recordAdminAuditEvent(input: Audit): Promise<void>;
  hashPassword(password: string): Promise<string>;
  provision(userId: string, email: string): Promise<void>;
  sendMail(input: Mail): Promise<{ ok: boolean }>;
  adminNotificationRecipients?: string[];
  limit?: BetaLimit;
  verifyBot?: (token: string, action: string) => Promise<void>;
};

export function getBetaAccessNotificationRecipients(env: Record<string, string | undefined> = process.env): string[] {
  return Array.from(new Set(
    String(env.BETA_ACCESS_NOTIFICATION_EMAILS ?? "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
      .map(value => z.string().email().max(254).parse(value))
  ));
}

export async function readBetaAccessEnabled(db: PrismaClient) {
  const row = await db.globalSetting.findUnique({ where: { key: SETTING } });
  return z.object({ enabled: z.boolean() }).strict().safeParse(row?.value).data?.enabled === true;
}

export function createBetaAccessService(deps: BetaAccessDeps) {
  const { db } = deps;
  const limit = deps.limit ?? createBetaLimiter();
  const verifyBot = deps.verifyBot ?? verifyBetaTurnstile;
  async function intakeAvailable() {
    return betaConfig().ready && await readBetaAccessEnabled(db) && !(await readRegistrationSettings(db)).enabled;
  }
  async function sendToken(requestId: string, purpose: "VERIFY" | "INVITE", actor?: { id: string; ip: string | null; action: string }, quotaReserved = false) {
    const request = await db.betaAccessRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new BetaAccessError("beta_invalid_request", 404);
    if (!betaConfig().ready) throw new BetaAccessError("beta_unavailable", 503);
    if (!quotaReserved) await limit(purpose === "VERIFY" ? "mail" : "adminMail", request.email);
    const raw = randomBytes(32).toString("hex");
    const attemptId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (purpose === "VERIFY" ? DAY : 7 * DAY));
    await db.$transaction(async tx => {
      const claim = await tx.betaAccessRequest.updateMany({
        where: { id: requestId, status: purpose === "VERIFY" ? "UNVERIFIED" : { in: actor?.action === "resend" ? ["INVITED"] : ["PENDING", "DEFERRED"] } },
        data: { mailStatus: "PENDING", mailAttemptId: attemptId, mailAttemptAt: now,
          ...(purpose === "INVITE" ? { status: "INVITED", reviewedBy: actor!.id, reviewedAt: now } : {}) }
      });
      if (claim.count !== 1) throw new BetaAccessError("beta_invalid_request", 409);
      await tx.betaAccessToken.deleteMany({ where: { requestId, purpose } });
      await tx.betaAccessToken.create({ data: { requestId, purpose, tokenHash: betaHash(raw), expiresAt } });
      if (actor) await deps.recordAdminAuditEvent({ tx, actorUserId: actor.id, action: `admin.beta.${actor.action}`, targetType: "beta_access", targetId: requestId, metadata: {}, ip: actor.ip });
    });
    // Fragments never reach access logs or referrers; only explicit POSTs consume tokens.
    const url = `${betaConfig().origin}/${request.locale}/register/beta#${purpose === "VERIFY" ? "verify" : "invite"}=${raw}`;
    const de = request.locale === "de";
    const subject = purpose === "VERIFY" ? (de ? "Beta-Antrag: E-Mail bestätigen" : "Beta request: confirm your email") : (de ? "Dein uLiquid Beta-Zugang" : "Your uLiquid beta invitation");
    const text = purpose === "VERIFY"
      ? (de ? `Bitte bestätige deinen Beta-Antrag über diesen Link (24 Stunden gültig):\n${url}\nFalls du keinen Antrag gestellt hast, ignoriere diese Nachricht.` : `Confirm your beta request using this link (valid for 24 hours):\n${url}\nIf you did not apply, ignore this message.`)
      : (de ? `Dein Antrag wurde freigegeben. Erstelle dein Konto innerhalb von sieben Tagen:\n${url}` : `Your request was approved. Create your account within seven days:\n${url}`);
    let sent = false;
    try { sent = (await deps.sendMail({ to: request.email, subject, text })).ok; } catch { /* Persist a sanitized delivery result, never provider errors or tokens. */ }
    await db.betaAccessRequest.updateMany({ where: { id: requestId, mailAttemptId: attemptId }, data: { mailStatus: sent ? "SENT" : "FAILED" } });
    return { sent };
  }
  async function apply(req: Request, resend = false) {
    await limit("ip", req.ip ?? "unknown");
    if (!(await intakeAvailable())) throw new BetaAccessError("beta_unavailable", 503);
    const input = applicationSchema.parse(req.body);
    if (input.companyWebsite.trim()) return;
    await verifyBot(input.turnstileToken, resend ? "beta_resend" : "beta_apply");
    // Lookup outcomes do not alter the public response or overwrite existing motivation.
    if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) return;
    let request = await db.betaAccessRequest.findUnique({ where: { email: input.email } });
    if ((request && request.status !== "UNVERIFIED") || (!request && resend)) return;
    // Reserve before inserting an application, so exhausted mail quotas cannot flood storage.
    try { await limit("mail", input.email); }
    catch (error) { if (error instanceof BetaAccessError && error.status === 429) return; throw error; }
    if (!request && !resend) {
      request = await db.betaAccessRequest.upsert({ where: { email: input.email }, update: {}, create: { email: input.email, motivation: input.motivation, locale: input.locale } });
    }
    if (request?.status === "UNVERIFIED") {
      try { await sendToken(request.id, "VERIFY", undefined, true); }
      catch (error) {
        if (!(error instanceof BetaAccessError && [429, 409].includes(error.status))) throw error;
      }
    }
  }
  async function validToken(raw: string, purpose: string) {
    const token = await db.betaAccessToken.findUnique({ where: { tokenHash: betaHash(raw) }, include: { request: true } });
    if (!token || token.purpose !== purpose || token.consumedAt || token.expiresAt <= new Date() || token.request.status !== (purpose === "VERIFY" ? "UNVERIFIED" : "INVITED")) throw new BetaAccessError("beta_invalid_token");
    return token;
  }
  async function confirm(raw: string) {
    const token = await validToken(raw, "VERIFY");
    const confirmedAt = new Date();
    await db.$transaction(async tx => {
      const changed = await tx.betaAccessRequest.updateMany({ where: { id: token.requestId, status: "UNVERIFIED" }, data: { status: "PENDING", verifiedAt: confirmedAt } });
      if (changed.count !== 1) throw new BetaAccessError("beta_invalid_token");
      const used = await tx.betaAccessToken.updateMany({ where: { id: token.id, purpose: "VERIFY", consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (used.count !== 1) throw new BetaAccessError("beta_invalid_token");
    });
    const recipients = deps.adminNotificationRecipients ?? [];
    if (recipients.length > 0) {
      const result = await Promise.allSettled(recipients.map(to => deps.sendMail({
        to,
        subject: "New verified uLiquid beta application",
        text: `A new beta application has been verified.\n\nEmail: ${token.request.email}\nVerified at: ${confirmedAt.toISOString()}\n\nReview it in uLiquid Desk:\n${betaConfig().origin}/admin/system/access-section`
      })));
      const failed = result.filter(entry => entry.status === "rejected" || (entry.status === "fulfilled" && !entry.value.ok)).length;
      if (failed > 0) logger.warn("beta_access_admin_notification_failed", { failedRecipientCount: failed });
    }
  }
  async function complete(req: Request) {
    const input = completionSchema.parse(req.body);
    if (input.legalAcknowledgementVersion !== LEGAL_ACKNOWLEDGEMENT_VERSION) throw new BetaAccessError("legal_acknowledgement_version_mismatch");
    const token = await validToken(input.token, "INVITE");
    const passwordHash = await deps.hashPassword(input.password);
    await db.$transaction(async tx => {
      const claimed = await tx.betaAccessRequest.updateMany({ where: { id: token.requestId, status: "INVITED" }, data: { status: "COMPLETED", completedAt: new Date() } });
      if (claimed.count !== 1) throw new BetaAccessError("beta_invalid_token");
      const used = await tx.betaAccessToken.updateMany({ where: { id: token.id, purpose: "INVITE", consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (used.count !== 1) throw new BetaAccessError("beta_invalid_token");
      if (await tx.user.findUnique({ where: { email: token.request.email }, select: { id: true } })) throw new BetaAccessError("beta_existing_account", 409);
      const user = await tx.user.create({ data: { email: token.request.email, passwordHash, emailVerifiedAt: null }, select: { id: true } });
      await tx.userLegalAcknowledgement.create({ data: { userId: user.id, version: LEGAL_ACKNOWLEDGEMENT_VERSION, textHash: LEGAL_ACKNOWLEDGEMENT_TEXT_HASH, acceptedAt: new Date(), ipAddress: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 500) ?? null } });
      await tx.betaAccessRequest.update({ where: { id: token.requestId }, data: { userId: user.id } });
    });
    // No session is created here. A recoverable job completes provisioning before email login is enabled.
    await provisionPending(token.requestId);
    return { ok: true, provisioningPending: !(await db.betaAccessRequest.findUnique({ where: { id: token.requestId }, select: { provisionedAt: true } }))?.provisionedAt };
  }
  async function provisionPending(id?: string) {
    const now = new Date();
    const pending = await db.betaAccessRequest.findMany({ where: { ...(id ? { id } : {}), status: "COMPLETED", provisionedAt: null, OR: [{ provisioningLeaseUntil: null }, { provisioningLeaseUntil: { lt: now } }] }, take: 20 });
    for (const row of pending) {
      if (!row.userId) continue;
      const lease = new Date(Date.now() + 300000);
      const claim = await db.betaAccessRequest.updateMany({ where: { id: row.id, provisionedAt: null, OR: [{ provisioningLeaseUntil: null }, { provisioningLeaseUntil: { lt: now } }] }, data: { provisioningLeaseUntil: lease } });
      if (claim.count !== 1) continue;
      try {
        await deps.provision(row.userId, row.email);
        await db.$transaction(async tx => {
          await tx.user.update({ where: { id: row.userId! }, data: { emailVerifiedAt: row.verifiedAt } });
          await tx.betaAccessRequest.update({ where: { id: row.id }, data: { provisionedAt: new Date(), provisioningLeaseUntil: null } });
        });
      } catch { logger.warn("beta_access_provisioning_retry", { requestId: row.id }); }
    }
  }
  async function cleanup() {
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    await db.betaAccessRequest.deleteMany({ where: { OR: [
      { status: "UNVERIFIED", createdAt: { lt: ago(7) } },
      { status: { in: ["REJECTED", "REVOKED"] }, reviewedAt: { lt: ago(30) } },
      { status: { in: ["PENDING", "DEFERRED", "INVITED"] }, createdAt: { lt: ago(90) }, tokens: { none: { purpose: "INVITE", expiresAt: { gt: new Date() }, consumedAt: null } } },
      { status: "COMPLETED", completedAt: { lt: ago(30) } }
    ] } });
    await db.betaAccessToken.deleteMany({ where: { expiresAt: { lt: ago(7) } } });
  }
  return { apply, confirm, complete, validToken, sendToken, intakeAvailable, provisionPending, cleanup, limit };
}

export function registerBetaAccessRoutes(app: Express, deps: BetaAccessDeps) {
  const service = createBetaAccessService(deps);
  const safe = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    try { await handler(req, res); } catch (error) {
      const code = error instanceof BetaAccessError ? error.code : error instanceof z.ZodError ? "invalid_payload" : "beta_unavailable";
      const status = error instanceof BetaAccessError ? error.status : error instanceof z.ZodError ? 400 : 503;
      res.status(status).json({ error: code });
    }
  };
  app.get("/auth/beta-access", safe(async (_req, res) => res.json({ enabled: await service.intakeAvailable(), siteKey: betaConfig().siteKey })));
  app.post("/auth/beta-access", safe(async (req, res) => { await service.apply(req); res.status(202).json({ ok: true }); }));
  app.post("/auth/beta-access/resend", safe(async (req, res) => { await service.apply(req, true); res.status(202).json({ ok: true }); }));
  app.post("/auth/beta-access/confirm", safe(async (req, res) => { await service.limit("verify", req.ip ?? "unknown"); await service.confirm(tokenSchema.parse(req.body).token); res.json({ ok: true }); }));
  app.post("/auth/beta-access/invitation", safe(async (req, res) => { await service.limit("verify", req.ip ?? "unknown"); const token = await service.validToken(tokenSchema.parse(req.body).token, "INVITE"); res.json({ email: token.request.email, legalVersion: LEGAL_ACKNOWLEDGEMENT_VERSION }); }));
  app.post("/auth/beta-access/complete", safe(async (req, res) => { await service.limit("verify", req.ip ?? "unknown"); res.json(await service.complete(req)); }));
  app.get("/admin/beta-access", requireAuth, safe(async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const page = z.coerce.number().int().min(0).max(100000).catch(0).parse(req.query.page);
    const where = { verifiedAt: { not: null } };
    const [items, total] = await Promise.all([deps.db.betaAccessRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: page * 30, take: 30, select: { id: true, email: true, motivation: true, status: true, createdAt: true, reviewedAt: true, mailStatus: true, provisionedAt: true, tokens: { where: { purpose: "INVITE", consumedAt: null }, select: { expiresAt: true }, take: 1 } } }), deps.db.betaAccessRequest.count({ where })]);
    res.json({ enabled: await readBetaAccessEnabled(deps.db), configured: betaConfig().ready, items, total, page });
  }));
  app.put("/admin/beta-access/settings", requireAuth, safe(async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const input = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    if (input.enabled && !betaConfig().ready) throw new BetaAccessError("beta_unavailable", 503);
    await deps.db.$transaction(async tx => {
      await tx.globalSetting.upsert({ where: { key: SETTING }, create: { key: SETTING, value: input }, update: { value: input } });
      await deps.recordAdminAuditEvent({ tx, actorUserId: getUserFromLocals(res).id, action: "admin.beta.settings", targetType: "global_setting", targetId: SETTING, metadata: input, ip: req.ip ?? null });
    });
    res.json(input);
  }));
  app.post("/admin/beta-access/:id/action", requireAuth, safe(async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const { action } = actionSchema.parse(req.body);
    const id = z.string().max(100).parse(req.params.id);
    const actor = { id: getUserFromLocals(res).id, ip: req.ip ?? null, action };
    if (action === "approve" || action === "resend") { res.json(await service.sendToken(id, "INVITE", actor)); return; }
    await deps.db.$transaction(async tx => {
      const allowed = action === "revoke" ? ["INVITED"] : action === "delete" ? ["UNVERIFIED", "PENDING", "DEFERRED", "REJECTED", "REVOKED", "INVITED"] : ["PENDING", "DEFERRED"];
      const updated = await tx.betaAccessRequest.updateMany({ where: { id, status: { in: allowed } }, data: { status: action === "defer" ? "DEFERRED" : action === "reject" ? "REJECTED" : "REVOKED", reviewedBy: actor.id, reviewedAt: new Date() } });
      if (updated.count !== 1) throw new BetaAccessError("beta_invalid_request", 409);
      await tx.betaAccessToken.deleteMany({ where: { requestId: id } });
      if (action === "delete") await tx.betaAccessRequest.delete({ where: { id } });
      await deps.recordAdminAuditEvent({ tx, actorUserId: actor.id, action: `admin.beta.${action}`, targetType: "beta_access", targetId: id, metadata: {}, ip: actor.ip });
    });
    res.json({ ok: true });
  }));
  return service;
}
