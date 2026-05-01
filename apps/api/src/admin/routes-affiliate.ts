import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  assignAffiliateReferral,
  clearAffiliateReferral,
  getAdminAffiliateUserDetail,
  getAffiliateProgramSettings,
  getAffiliateProgramSummary,
  MAX_AFFILIATE_SELF_FEE_RATE_PCT,
  normalizeAffiliateCode,
  normalizeAffiliateSelfFeeRatePct,
  resolveAffiliateUserIdByCode,
  setAffiliateProgramSettings,
  setAffiliateRateOverride
} from "../affiliate/program.js";

const affiliateProgramSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  platformFeeRatePct: z.number().min(0).max(100).optional(),
  defaultAffiliateFeeRatePct: z.number().min(0).max(MAX_AFFILIATE_SELF_FEE_RATE_PCT).optional()
});

const affiliateOverrideSchema = z.object({
  feeRatePct: z.number().min(0).max(MAX_AFFILIATE_SELF_FEE_RATE_PCT).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional()
});

const affiliateReferralMutationSchema = z.object({
  affiliateUserId: z.string().trim().min(1).nullable().optional(),
  referralCode: z.string().trim().min(4).max(64).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  clear: z.boolean().optional()
});

export type RegisterAdminAffiliateRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  recordAdminAuditEvent(input: {
    tx?: any;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void>;
};

function errorResponse(error: unknown) {
  const reason = String(error ?? "");
  if (reason.includes("invalid_platform_fee_rate_pct")) return { status: 400, body: { error: "invalid_platform_fee_rate_pct" } };
  if (reason.includes("invalid_default_affiliate_fee_rate_pct")) return { status: 400, body: { error: "invalid_default_affiliate_fee_rate_pct" } };
  if (reason.includes("invalid_total_fee_rate_pct")) return { status: 400, body: { error: "invalid_total_fee_rate_pct" } };
  if (reason.includes("invalid_affiliate_fee_rate_pct")) return { status: 400, body: { error: "invalid_affiliate_fee_rate_pct" } };
  if (reason.includes("affiliate_self_referral_not_allowed")) return { status: 400, body: { error: "affiliate_self_referral_not_allowed" } };
  return { status: 500, body: { error: "affiliate_operation_failed", reason } };
}

async function withAuditTransaction<T>(db: any, run: (tx: any) => Promise<T>): Promise<T> {
  if (typeof db?.$transaction === "function") {
    return db.$transaction(async (tx: any) => run(tx));
  }
  return run(db);
}

export function registerAdminAffiliateRoutes(app: express.Express, deps: RegisterAdminAffiliateRoutesDeps) {
  app.get("/admin/settings/affiliate-program", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    return res.json(await getAffiliateProgramSettings(deps.db));
  });

  app.put("/admin/settings/affiliate-program", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = affiliateProgramSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (
      parsed.data.enabled === undefined
      && parsed.data.platformFeeRatePct === undefined
      && parsed.data.defaultAffiliateFeeRatePct === undefined
    ) {
      return res.status(400).json({ error: "invalid_payload", reason: "settings_required" });
    }
    try {
      const actor = getUserFromLocals(res);
      const updated = await withAuditTransaction(deps.db, async (tx) => {
        const current = await getAffiliateProgramSettings(tx);
        const next = await setAffiliateProgramSettings(tx, {
          enabled: parsed.data.enabled ?? current.enabled,
          platformFeeRatePct: parsed.data.platformFeeRatePct ?? current.platformFeeRatePct,
          defaultAffiliateFeeRatePct: parsed.data.defaultAffiliateFeeRatePct ?? current.defaultAffiliateFeeRatePct
        });
        await deps.recordAdminAuditEvent({
          tx,
          actorUserId: actor.id,
          action: "affiliate_program_settings_updated",
          targetType: "global_setting",
          targetId: "affiliate_program",
          targetLabel: "Affiliate Program",
          metadata: next
        });
        return next;
      });
      return res.json(updated);
    } catch (error) {
      const mapped = errorResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.get("/admin/affiliate/summary", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const [settings, summary] = await Promise.all([
      getAffiliateProgramSettings(deps.db),
      getAffiliateProgramSummary(deps.db)
    ]);
    return res.json({ settings, ...summary });
  });

  app.get("/admin/users/:id/affiliate", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const detail = await getAdminAffiliateUserDetail(deps.db, req.params.id);
    if (!detail) return res.status(404).json({ error: "not_found" });
    return res.json(detail);
  });

  app.put("/admin/users/:id/affiliate", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = affiliateOverrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (parsed.data.feeRatePct === undefined && parsed.data.reason === undefined) {
      return res.status(400).json({ error: "invalid_payload", reason: "fee_rate_or_reason_required" });
    }
    try {
      const feeRatePct =
        parsed.data.feeRatePct === undefined
          ? null
          : normalizeAffiliateSelfFeeRatePct(parsed.data.feeRatePct);
      if (parsed.data.feeRatePct !== undefined && feeRatePct == null) {
        return res.status(400).json({ error: "invalid_affiliate_fee_rate_pct" });
      }
      const actor = getUserFromLocals(res);
      const detail = await withAuditTransaction(deps.db, async (tx) => {
        await setAffiliateRateOverride(tx, {
          affiliateUserId: req.params.id,
          feeRatePct,
          reason: parsed.data.reason ?? null
        });
        await deps.recordAdminAuditEvent({
          tx,
          actorUserId: actor.id,
          action: feeRatePct == null ? "affiliate_override_cleared" : "affiliate_override_updated",
          targetType: "user",
          targetId: req.params.id,
          metadata: {
            feeRatePct,
            reason: parsed.data.reason ?? null
          }
        });
        return getAdminAffiliateUserDetail(tx, req.params.id);
      });
      return res.json(detail);
    } catch (error) {
      const mapped = errorResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/admin/users/:id/referral", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = affiliateReferralMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    try {
      const actor = getUserFromLocals(res);
      if (parsed.data.clear) {
        const detail = await withAuditTransaction(deps.db, async (tx) => {
          await clearAffiliateReferral(tx, req.params.id);
          await deps.recordAdminAuditEvent({
            tx,
            actorUserId: actor.id,
            action: "affiliate_referral_cleared",
            targetType: "user",
            targetId: req.params.id,
            metadata: {
              affiliateUserId: parsed.data.affiliateUserId ?? null,
              referralCode: parsed.data.referralCode ? normalizeAffiliateCode(parsed.data.referralCode) : null,
              source: parsed.data.source ?? null
            }
          });
          return getAdminAffiliateUserDetail(tx, req.params.id);
        });
        return res.json(detail);
      } else {
        let affiliateUserId = parsed.data.affiliateUserId?.trim() || null;
        if (!affiliateUserId && parsed.data.referralCode) {
          const normalizedCode = normalizeAffiliateCode(parsed.data.referralCode);
          if (!normalizedCode) return res.status(400).json({ error: "invalid_referral_code" });
          affiliateUserId = await resolveAffiliateUserIdByCode(deps.db, normalizedCode);
        }
        if (!affiliateUserId) {
          return res.status(400).json({ error: "affiliate_user_required" });
        }
        const detail = await withAuditTransaction(deps.db, async (tx) => {
          await assignAffiliateReferral(tx, {
            referredUserId: req.params.id,
            affiliateUserId,
            source: parsed.data.source ?? "admin_manual",
            metadata: parsed.data.referralCode ? { referralCode: normalizeAffiliateCode(parsed.data.referralCode) } : null
          });
          await deps.recordAdminAuditEvent({
            tx,
            actorUserId: actor.id,
            action: "affiliate_referral_assigned",
            targetType: "user",
            targetId: req.params.id,
            metadata: {
              affiliateUserId: parsed.data.affiliateUserId ?? null,
              referralCode: parsed.data.referralCode ? normalizeAffiliateCode(parsed.data.referralCode) : null,
              source: parsed.data.source ?? null
            }
          });
          return getAdminAffiliateUserDetail(tx, req.params.id);
        });
        return res.json(detail);
      }
    } catch (error) {
      const mapped = errorResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }
  });
}
