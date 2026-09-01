import type express from "express";
import { z } from "zod";
import type { SiweService } from "../auth/siwe.service.js";
import {
  PRESALE_CSRF_COOKIE,
  PRESALE_SESSION_COOKIE,
  PRESALE_SIWE_NONCE_COOKIE,
  clearAuthCookieOptions,
  createCsrfToken,
  csrfCookieOptions,
  sessionCookieOptions
} from "../auth/cookies.js";
import { createRateLimitMiddleware, rateLimitByIp } from "../trafficControl.js";
import { getUliqPublicPresaleConfig, getUliqPublicPresaleFlags } from "./publicPresale.config.js";
import type { UliqPublicPresaleService } from "./publicPresale.service.js";
import {
  ULIQ_PUBLIC_PRESALE_SESSION_TTL_MS,
  type UliqPublicPresaleSessionContext,
  type UliqPublicPresaleSessionService
} from "./publicPresaleSession.service.js";

const uint256Schema = z.string().trim().regex(/^(0|[1-9]\d*)$/).max(78);
const addressSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/);
const transactionHashSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/);
const roundIdSchema = z.enum(["round-1", "round-2"]);
const verifySchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  signature: z.string().trim().min(1).max(2_000),
  address: addressSchema
});
const termsSchema = z.object({
  accepted: z.literal(true),
  version: z.string().trim().min(1).max(128),
  textHash: z.string().trim().regex(/^[0-9a-fA-F]{64}$/)
});
const quoteSchema = z.object({ requestedUsdcRaw: uint256Schema });
const purchaseSchema = z.object({
  maxUsdcAmountRaw: uint256Schema,
  minUliqAllocationRaw: uint256Schema
});
const trackingSchema = purchaseSchema.extend({ transactionHash: transactionHashSchema });
const trackingRefreshSchema = z.object({ transactionHash: transactionHashSchema });
const trackingReplaceSchema = z.object({
  transactionHash: transactionHashSchema,
  replacementTransactionHash: transactionHashSchema,
  reason: z.enum(["cancelled", "replaced", "repriced"]).optional()
});
const purchaseIdSchema = z.object({ purchaseId: uint256Schema });

function requestIp(req: express.Request): string | null {
  return String(req.ip ?? req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() || null;
}

function mapError(error: unknown): { status: number; error: string } {
  const reason = error instanceof Error ? error.message : String(error);
  if (reason.includes("disabled") || reason.includes("activation_forbidden")) return { status: 404, error: "not_found" };
  if (reason.includes("terms")) return { status: 409, error: reason };
  if (reason.includes("not_found")) return { status: 404, error: reason };
  if (reason.includes("invalid_")) return { status: 400, error: reason };
  if (
    reason.includes("mismatch")
    || reason.includes("not_pending")
    || reason.includes("not_active")
    || reason.includes("wallet_mismatch")
  ) return { status: 409, error: reason };
  if (reason.includes("rpc")) return { status: 503, error: "uliq_rpc_unavailable" };
  return { status: 500, error: "uliq_public_presale_request_failed" };
}

export function registerUliqPublicPresaleRoutes(app: express.Express, deps: {
  service: UliqPublicPresaleService;
  sessionService: UliqPublicPresaleSessionService;
  siweService: SiweService;
}) {
  const nonceRateLimit = createRateLimitMiddleware({
    name: "uliq_public_presale_nonce",
    max: 10,
    windowMs: 10 * 60_000,
    keyFn: (req) => rateLimitByIp(req)
  });
  const verifyRateLimit = createRateLimitMiddleware({
    name: "uliq_public_presale_verify",
    max: 5,
    windowMs: 10 * 60_000,
    keyFn: (req) => rateLimitByIp(req)
  });
  const walletWriteRateLimit = createRateLimitMiddleware({
    name: "uliq_public_presale_wallet_write",
    max: 60,
    windowMs: 10 * 60_000,
    keyFn: (req, res) => String((res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext | undefined)?.walletAddress ?? req.ip ?? "anon")
  });

  function enabled(res: express.Response): boolean {
    try {
      if (!getUliqPublicPresaleFlags().enabled) {
        res.status(404).json({ error: "not_found" });
        return false;
      }
      return true;
    } catch {
      res.status(404).json({ error: "not_found" });
      return false;
    }
  }

  const requireSession: express.RequestHandler = (req, res, next) => {
    if (!enabled(res)) return;
    void deps.sessionService.resolve(req.cookies?.[PRESALE_SESSION_COOKIE]).then((session) => {
      if (!session) {
        res.status(401).json({ error: "presale_session_required" });
        return;
      }
      const config = getUliqPublicPresaleConfig();
      if (session.chainId !== config.chainId) {
        res.status(401).json({ error: "presale_session_chain_mismatch" });
        return;
      }
      res.locals.uliqPresaleSession = session;
      next();
    }).catch(next);
  };

  async function requireCurrentTerms(res: express.Response): Promise<boolean> {
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    const config = getUliqPublicPresaleConfig();
    if (!config.terms.ready) {
      res.status(409).json({ error: "uliq_public_presale_terms_not_ready" });
      return false;
    }
    const accepted = await deps.sessionService.getTermsAcceptance(session, config.terms);
    if (!accepted) {
      res.status(409).json({ error: "uliq_public_presale_terms_required", terms: config.terms });
      return false;
    }
    return true;
  }

  app.get("/uliq/public/presale", async (_req, res) => {
    if (!enabled(res)) return;
    try { return res.json(await deps.service.getOverview()); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.get("/uliq/public/session/nonce", nonceRateLimit, async (_req, res) => {
    if (!enabled(res)) return;
    try {
      const issued = await deps.siweService.issueNonce();
      res.cookie(PRESALE_SIWE_NONCE_COOKIE, issued.token, deps.siweService.buildNonceCookieOptions(issued.ttlMs));
      return res.json({ nonce: issued.nonce, expiresAt: issued.expiresAt.toISOString() });
    } catch {
      return res.status(500).json({ error: "presale_nonce_issue_failed" });
    }
  });

  app.post("/uliq/public/session/verify", verifyRateLimit, async (req, res) => {
    if (!enabled(res)) return;
    const parsed = verifySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try {
      const config = getUliqPublicPresaleConfig();
      const verified = await deps.siweService.verify({
        message: parsed.data.message,
        signature: parsed.data.signature,
        nonceToken: req.cookies?.[PRESALE_SIWE_NONCE_COOKIE],
        requestHost: req.get("host") ?? null,
        expectedAddress: parsed.data.address
      });
      if (verified.chainId !== config.chainId) return res.status(401).json({ error: "siwe_chain_not_allowed" });
      const created = await deps.sessionService.create({
        walletAddress: verified.address,
        chainId: verified.chainId,
        ipAddress: requestIp(req),
        userAgent: req.get("user-agent")
      });
      const clear = clearAuthCookieOptions();
      res.clearCookie(PRESALE_SIWE_NONCE_COOKIE, clear);
      res.cookie(PRESALE_SESSION_COOKIE, created.token, sessionCookieOptions(ULIQ_PUBLIC_PRESALE_SESSION_TTL_MS));
      res.cookie(PRESALE_CSRF_COOKIE, createCsrfToken(), csrfCookieOptions(ULIQ_PUBLIC_PRESALE_SESSION_TTL_MS));
      return res.json({
        walletAddress: created.session.walletAddress,
        chainId: created.session.chainId,
        expiresAt: created.expiresAt.toISOString(),
        termsAccepted: false,
        terms: config.terms
      });
    } catch (error) {
      res.clearCookie(PRESALE_SIWE_NONCE_COOKIE, clearAuthCookieOptions());
      const mapped = mapError(error);
      return res.status(mapped.status === 500 ? 401 : mapped.status).json({ error: mapped.error });
    }
  });

  app.get("/uliq/public/session", requireSession, async (_req, res) => {
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    const config = getUliqPublicPresaleConfig();
    const accepted = await deps.sessionService.getTermsAcceptance(session, config.terms);
    return res.json({
      walletAddress: session.walletAddress,
      chainId: session.chainId,
      expiresAt: session.expiresAt.toISOString(),
      termsAccepted: Boolean(accepted),
      terms: config.terms
    });
  });

  app.delete("/uliq/public/session", requireSession, async (req, res) => {
    await deps.sessionService.revoke(req.cookies?.[PRESALE_SESSION_COOKIE]);
    const clear = clearAuthCookieOptions();
    res.clearCookie(PRESALE_SESSION_COOKIE, clear);
    res.clearCookie(PRESALE_CSRF_COOKIE, clear);
    return res.json({ ok: true });
  });

  app.post("/uliq/public/terms/accept", requireSession, walletWriteRateLimit, async (req, res) => {
    const parsed = termsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const config = getUliqPublicPresaleConfig();
    if (!config.terms.ready || parsed.data.version !== config.terms.version || parsed.data.textHash.toLowerCase() !== config.terms.textHash) {
      return res.status(409).json({ error: "uliq_public_presale_terms_version_mismatch", terms: config.terms });
    }
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    const accepted = await deps.sessionService.acceptTerms({
      session,
      version: parsed.data.version,
      textHash: parsed.data.textHash.toLowerCase(),
      ipAddress: requestIp(req),
      userAgent: req.get("user-agent")
    });
    return res.json({ accepted: true, acceptedAt: accepted.acceptedAt, terms: config.terms });
  });

  app.get("/uliq/public/me", requireSession, async (_req, res) => {
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.getWalletState(session.walletAddress)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/quote", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = quoteSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    if (!await requireCurrentTerms(res)) return;
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.quote(round.data, session.walletAddress, parsed.data.requestedUsdcRaw)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/purchase/prepare", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = purchaseSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    if (!await requireCurrentTerms(res)) return;
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.preparePurchase({ roundId: round.data, walletAddress: session.walletAddress, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/purchase/track", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = trackingSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.trackSubmitted({ roundId: round.data, walletAddress: session.walletAddress, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/purchase/track/refresh", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = trackingRefreshSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.refreshTracking(round.data, session.walletAddress, parsed.data.transactionHash)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/purchase/track/replace", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = trackingReplaceSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.replaceTracking({ roundId: round.data, walletAddress: session.walletAddress, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/withdraw/prepare", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = purchaseIdSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.prepareWithdraw(round.data, session.walletAddress, parsed.data.purchaseId)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/presale/:roundId/finalize/prepare", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    const parsed = purchaseIdSchema.safeParse(req.body ?? {});
    if (!round.success || !parsed.success) return res.status(400).json({ error: "invalid_payload" });
    try { return res.json(await deps.service.prepareFinalize(round.data, parsed.data.purchaseId)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/public/vesting/:roundId/claim/prepare", requireSession, walletWriteRateLimit, async (req, res) => {
    const round = roundIdSchema.safeParse(req.params.roundId);
    if (!round.success) return res.status(400).json({ error: "invalid_payload" });
    const session = res.locals.uliqPresaleSession as UliqPublicPresaleSessionContext;
    try { return res.json(await deps.service.prepareClaim(round.data, session.walletAddress)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });
}
