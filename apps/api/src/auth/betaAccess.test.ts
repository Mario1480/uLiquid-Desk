import assert from "node:assert/strict";
import test from "node:test";
import type { Express, Request, RequestHandler, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createBetaAccessService, registerBetaAccessRoutes, type BetaAccessDeps } from "./betaAccess.js";
import { betaConfig, betaHash, verifyBetaTurnstile, BETA_LIMIT_SCRIPT, BetaAccessError } from "./betaAccessSecurity.js";
import { LEGAL_ACKNOWLEDGEMENT_VERSION } from "../legalAcknowledgement.js";

test("Turnstile fails closed on configuration, provider, host, action and replay errors", async () => {
  assert.equal(betaConfig({}).ready, false);
  const config = { ready: true, origin: "https://example.test", hostnames: ["example.test"], siteKey: "test-site", secret: "test-secret" };
  for (const payload of [{ success: false }, { success: true, hostname: "evil.test", action: "beta_apply" }, { success: true, hostname: "example.test", action: "other" }]) {
    await assert.rejects(verifyBetaTurnstile("test", "beta_apply", config, async () => new globalThis.Response(JSON.stringify(payload))), /beta_bot_check_failed/);
  }
  await assert.rejects(verifyBetaTurnstile("test", "beta_apply", config, async () => { throw Error("network"); }), /beta_unavailable/);
  await verifyBetaTurnstile("test", "beta_apply", config, async () => new globalThis.Response(JSON.stringify({ success: true, hostname: "example.test", action: "beta_apply" })));
});

const databaseUrl = process.env.BETA_TEST_DATABASE_URL;
test("beta flow: real PostgreSQL atomicity, administration, delivery and retention", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/beta_test", "Only the isolated local beta_test database is allowed");
  Object.assign(process.env, { BETA_ACCESS_WEB_ORIGIN: "https://example.test", TURNSTILE_ALLOWED_HOSTNAMES: "example.test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test-site", TURNSTILE_SECRET_KEY: "test-secret", BETA_ACCESS_PRIVACY_APPROVED: "true" });
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const mails: string[] = []; let mailFails = false; let provisioningFails = false; let provisionCalls = 0; let botCalls = 0;
  const audit: string[] = [];
  const deps: BetaAccessDeps = { db, requireSuperadmin: async () => true, recordAdminAuditEvent: async input => { audit.push(input.action); }, hashPassword: async () => "test-hash", provision: async () => { provisionCalls++; if (provisioningFails) throw Error("provision"); }, sendMail: async input => { mails.push(input.text); return { ok: !mailFails }; }, limit: async () => {}, verifyBot: async () => { botCalls++; } };
  const service = createBetaAccessService(deps);
  const request = (body: unknown) => ({ body, ip: "127.0.0.1", get: () => "test" }) as unknown as Request;
  const body = (email: string) => ({ email, motivation: "Test the dashboard", locale: "en", companyWebsite: "", turnstileToken: "test" });
  const lastToken = () => mails.at(-1)!.match(/(?:verify|invite)=([a-f0-9]{64})/)![1];
  const setting = async (key: string, enabled: boolean) => db.globalSetting.upsert({ where: { key }, create: { key, value: { enabled } }, update: { value: { enabled } } });
  const routes = new Map<string, RequestHandler[]>();
  const app = Object.fromEntries(["get", "post", "put"].map(method => [method, (path: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${path}`, handlers)])) as unknown as Express;
  registerBetaAccessRoutes(app, deps);
  async function call(path: string, body: unknown, id = "", allowed = true) {
    const response = { locals: { user: { id: "test-admin" } }, statusCode: 200, body: {} as Record<string, unknown>, setHeader() {}, status(status: number) { this.statusCode = status; return this; }, json(value: Record<string, unknown>) { this.body = value; return this; } };
    deps.requireSuperadmin = async res => { if (!allowed) res.status(403).json({ error: "forbidden" }); return allowed; };
    await routes.get(path)!.at(-1)!({ ...request(body), params: { id }, query: {} } as unknown as Request, response as unknown as Response, () => {});
    return response;
  }
  async function approved(email: string) {
    await service.apply(request(body(email))); const verify = lastToken(); await service.confirm(verify);
    const row = await db.betaAccessRequest.findUniqueOrThrow({ where: { email } });
    await service.sendToken(row.id, "INVITE", { id: "test-admin", ip: null, action: "approve" });
    return { row, token: lastToken(), verify };
  }
  try {
    await db.betaAccessRequest.deleteMany(); await db.user.deleteMany({ where: { email: { endsWith: "@beta-test.invalid" } } });
    await setting("auth.registration.v1", false); await setting("auth.beta-access.v1", false);
    await t.test("closed intake, honeypot and bot failure have no signup side effects", async () => {
      await assert.rejects(service.apply(request(body("one@beta-test.invalid"))), /beta_unavailable/);
      await setting("auth.beta-access.v1", true);
      await service.apply(request({ ...body("honey@beta-test.invalid"), companyWebsite: "spam" }));
      assert.equal(botCalls, 0); assert.equal(mails.length, 0); assert.equal(await db.betaAccessRequest.count(), 0);
      const failedBot = createBetaAccessService({ ...deps, verifyBot: async () => { throw Error("bot unavailable"); } });
      await assert.rejects(failedBot.apply(request(body("bad@beta-test.invalid"))));
      assert.equal(await db.betaAccessRequest.count(), 0);
    });
    await t.test("duplicates preserve application, mails contain fragments, verification is purpose-bound", async () => {
      await service.apply(request(body("ONE@beta-test.invalid"))); const original = lastToken();
      await service.apply(request({ ...body("one@beta-test.invalid"), motivation: "must not overwrite" })); const fresh = lastToken();
      assert.equal(await db.betaAccessRequest.count(), 1);
      assert.equal((await db.betaAccessRequest.findFirstOrThrow()).motivation, "Test the dashboard");
      assert.equal(await db.user.count({ where: { email: "one@beta-test.invalid" } }), 0);
      await assert.rejects(service.confirm(original), /beta_invalid_token/);
      await assert.rejects(service.validToken(fresh, "INVITE"), /beta_invalid_token/);
      const persisted = await db.betaAccessToken.findFirstOrThrow(); assert.equal(persisted.tokenHash, betaHash(fresh)); assert.notEqual(persisted.tokenHash, fresh);
      await service.confirm(fresh); await assert.rejects(service.confirm(fresh), /beta_invalid_token/);
    });
    await t.test("Redis outage and exhausted delivery quotas do not insert applications", async () => {
      const count = await db.betaAccessRequest.count(); const deliveries = mails.length;
      const unavailable = createBetaAccessService({ ...deps, limit: async () => { throw new BetaAccessError("beta_unavailable", 503); } });
      await assert.rejects(unavailable.apply(request(body("redis@beta-test.invalid"))), /beta_unavailable/);
      const exhausted = createBetaAccessService({ ...deps, limit: async kind => { if (kind === "mail") throw new BetaAccessError("beta_rate_limited", 429); } });
      await exhausted.apply(request(body("quota@beta-test.invalid")));
      assert.equal(await db.betaAccessRequest.count(), count); assert.equal(mails.length, deliveries);
    });
    await t.test("superadmin guard, audited transitions, mail failure and link rotation", async () => {
      const row = await db.betaAccessRequest.findFirstOrThrow();
      assert.equal(routes.get("post /admin/beta-access/:id/action")!.length, 2);
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "approve" }, row.id, false)).statusCode, 403);
      mailFails = true;
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "approve" }, row.id)).statusCode, 200);
      const stale = lastToken(); assert.equal((await db.betaAccessRequest.findUniqueOrThrow({ where: { id: row.id } })).mailStatus, "FAILED");
      mailFails = false; await call("post /admin/beta-access/:id/action", { action: "resend" }, row.id);
      await assert.rejects(service.validToken(stale, "INVITE"), /beta_invalid_token/);
      const fresh = lastToken(); await call("post /admin/beta-access/:id/action", { action: "revoke" }, row.id);
      await assert.rejects(service.validToken(fresh, "INVITE"), /beta_invalid_token/);
      assert.ok(audit.includes("admin.beta.approve"));
    });
    await t.test("expired and outdated legal acknowledgements cannot create accounts", async () => {
      const { token } = await approved("expired@beta-test.invalid");
      await assert.rejects(service.complete(request({ token, password: "password123", legalAcknowledgementAccepted: false, legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION })));
      await assert.rejects(service.complete(request({ token, password: "password123", legalAcknowledgementAccepted: true, legalAcknowledgementVersion: "old" })), /version_mismatch/);
      await db.betaAccessToken.update({ where: { tokenHash: betaHash(token) }, data: { expiresAt: new Date(0) } });
      await assert.rejects(service.validToken(token, "INVITE"), /beta_invalid_token/);
      assert.equal(await db.user.count({ where: { email: "expired@beta-test.invalid" } }), 0);
    });
    await t.test("parallel approval issues one invitation; deferred/rejected/deleted states are guarded", async () => {
      await service.apply(request(body("parallel@beta-test.invalid"))); await service.confirm(lastToken());
      const row = await db.betaAccessRequest.findUniqueOrThrow({ where: { email: "parallel@beta-test.invalid" } });
      const result = await Promise.allSettled([service.sendToken(row.id, "INVITE", { id: "admin", ip: null, action: "approve" }), service.sendToken(row.id, "INVITE", { id: "admin", ip: null, action: "approve" })]);
      assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await db.betaAccessToken.count({ where: { requestId: row.id, purpose: "INVITE" } }), 1);
      await service.apply(request(body("review@beta-test.invalid"))); await service.confirm(lastToken());
      const review = await db.betaAccessRequest.findUniqueOrThrow({ where: { email: "review@beta-test.invalid" } });
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "defer" }, review.id)).statusCode, 200);
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "reject" }, review.id)).statusCode, 200);
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "approve" }, review.id)).statusCode, 409);
      assert.equal((await call("post /admin/beta-access/:id/action", { action: "delete" }, review.id)).statusCode, 200);
      assert.equal(await db.betaAccessRequest.findUnique({ where: { id: review.id } }), null);
      assert.equal((await call("get /admin/beta-access", {}, "", false)).statusCode, 403);
    });
    await t.test("invitation works with intake off; concurrent completion creates one account and one acknowledgement", async () => {
      const { token, row } = await approved("complete@beta-test.invalid");
      await setting("auth.beta-access.v1", false);
      const payload = { token, password: "password123", legalAcknowledgementAccepted: true, legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION };
      const results = await Promise.allSettled([service.complete(request(payload)), service.complete(request(payload))]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const user = await db.user.findUniqueOrThrow({ where: { email: row.email } });
      assert.ok(user.emailVerifiedAt); assert.equal(await db.userLegalAcknowledgement.count({ where: { userId: user.id } }), 1);
      assert.equal(provisionCalls, 1); await service.provisionPending(); assert.equal(provisionCalls, 1);
      await setting("auth.beta-access.v1", true);
    });
    await t.test("existing accounts are never overwritten; failed transaction does not consume invitation", async () => {
      const { token, row } = await approved("existing@beta-test.invalid");
      const user = await db.user.create({ data: { email: row.email, passwordHash: "unchanged" } });
      await assert.rejects(service.complete(request({ token, password: "password123", legalAcknowledgementAccepted: true, legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION })), /beta_existing_account/);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, "unchanged");
      assert.equal((await service.validToken(token, "INVITE")).consumedAt, null);
    });
    await t.test("provisioning retries without duplicating account or acknowledgement", async () => {
      const { token, row } = await approved("retry@beta-test.invalid"); provisioningFails = true;
      assert.equal((await service.complete(request({ token, password: "password123", legalAcknowledgementAccepted: true, legalAcknowledgementVersion: LEGAL_ACKNOWLEDGEMENT_VERSION }))).provisioningPending, true);
      assert.equal((await db.user.findUniqueOrThrow({ where: { email: row.email } })).emailVerifiedAt, null);
      provisioningFails = false; await db.betaAccessRequest.update({ where: { id: row.id }, data: { provisioningLeaseUntil: new Date(0) } });
      await service.provisionPending(); assert.ok((await db.user.findUniqueOrThrow({ where: { email: row.email } })).emailVerifiedAt);
    });
    await t.test("retention deletes expired application data but retains account acknowledgement", async () => {
      const row = await db.betaAccessRequest.findUniqueOrThrow({ where: { email: "complete@beta-test.invalid" } });
      await db.betaAccessRequest.update({ where: { id: row.id }, data: { completedAt: new Date(0) } });
      await db.betaAccessRequest.create({ data: { email: "old@beta-test.invalid", motivation: "old", createdAt: new Date(0) } });
      await service.cleanup(); assert.equal(await db.betaAccessRequest.findUnique({ where: { id: row.id } }), null);
      assert.equal(await db.betaAccessRequest.findUnique({ where: { email: "old@beta-test.invalid" } }), null);
      assert.equal(await db.userLegalAcknowledgement.count({ where: { userId: row.userId! } }), 1);
    });
  } finally { await db.$disconnect(); }
});

test("Redis quotas are atomic and do not increment other keys on rejection", { skip: !process.env.BETA_TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.BETA_TEST_REDIS_URL!); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const redis = new Redis(url.toString()); const prefix = `beta-test:${Date.now()}:`;
  try {
    const result = await Promise.all(Array.from({ length: 20 }, () => redis.eval(BETA_LIMIT_SCRIPT, 2, prefix + "ip", prefix + "global", 5, 900000, 100, 3600000)));
    assert.equal(result.filter(r => Number(r) === 1).length, 5);
    assert.equal(await redis.get(prefix + "global"), "5"); assert.ok(await redis.pttl(prefix + "ip") > 0);
  } finally { await redis.del(prefix + "ip", prefix + "global"); await redis.quit(); }
});
