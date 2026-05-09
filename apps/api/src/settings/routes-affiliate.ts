import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import type { BotVaultRuntimeService, BotVaultV3Service } from "../vaults/botVaultRuntime.service.js";
import {
  MAX_AFFILIATE_SELF_FEE_RATE_PCT,
  getAffiliateOverviewForUser,
  resolveLockedAffiliateFeeConfig,
  setAffiliateSelfSelectedFeeRate
} from "../affiliate/program.js";

export type RegisterSettingsAffiliateRoutesDeps = {
  db: any;
  botVaultRuntimeService?: BotVaultRuntimeService | null;
  /** @deprecated Use botVaultRuntimeService for new call sites. */
  botVaultV3Service?: BotVaultRuntimeService | BotVaultV3Service | null;
};

const withdrawAffiliateHypeSchema = z.object({
  amountHype: z.number().positive().optional(),
  reserveHype: z.number().min(0).max(1000).optional()
});

const withdrawAffiliateUsdcSchema = z.object({
  amountUsdc: z.number().positive().optional()
});

const updateAffiliateProfitshareRateSchema = z.object({
  feeRatePct: z.number().min(0).max(MAX_AFFILIATE_SELF_FEE_RATE_PCT)
});

export function registerSettingsAffiliateRoutes(
  app: express.Express,
  deps: RegisterSettingsAffiliateRoutesDeps
) {
  const botVaultRuntimeService = deps.botVaultRuntimeService ?? deps.botVaultV3Service ?? null;

  app.get("/settings/affiliate", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const refreshPayoutWallet = String(req.query.refreshPayoutWallet ?? "true") !== "false";
    const [overview, payoutWallet, lockedFeePreview] = await Promise.all([
      getAffiliateOverviewForUser(deps.db, user.id, { limit: 20 }),
      botVaultRuntimeService
        ? botVaultRuntimeService.getAffiliatePayoutWalletSummary({
            userId: user.id,
            refresh: refreshPayoutWallet
          }).catch(() => null)
        : Promise.resolve(null),
      resolveLockedAffiliateFeeConfig(deps.db, user.id).catch(() => null)
    ]);
    return res.json({
      ...overview,
      payoutWallet,
      lockedFeePreview,
      referralPath: `/register?ref=${encodeURIComponent(overview.profile.code)}`
    });
  });

  app.put("/settings/affiliate/profitshare-rate", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = updateAffiliateProfitshareRateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    try {
      const selfSelectedFeeRate = await setAffiliateSelfSelectedFeeRate(deps.db, {
        affiliateUserId: user.id,
        feeRatePct: parsed.data.feeRatePct
      });
      const overview = await getAffiliateOverviewForUser(deps.db, user.id, { limit: 20 });
      return res.json({ ok: true, selfSelectedFeeRate, ...overview });
    } catch (error) {
      return res.status(400).json({ error: "affiliate_profitshare_rate_update_failed", message: String(error) });
    }
  });

  if (!botVaultRuntimeService) return;

  app.post("/settings/affiliate/payout-wallet/create", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const payoutWallet = await botVaultRuntimeService.createAffiliatePayoutWallet({ userId: user.id });
      return res.json({ ok: true, payoutWallet });
    } catch (error) {
      const code = String(error instanceof Error ? error.message : error);
      const status = code === "affiliate_payout_wallet_already_configured" ? 409 : 400;
      return res.status(status).json({ error: "affiliate_payout_wallet_create_failed", code, message: String(error) });
    }
  });

  app.post("/settings/affiliate/payout-wallet/withdraw-hype", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = withdrawAffiliateHypeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try {
      const result = await botVaultRuntimeService.withdrawHypeFromAffiliatePayoutWallet({
        userId: user.id,
        amountHype: parsed.data.amountHype ?? null,
        reserveHype: parsed.data.reserveHype ?? null
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: "affiliate_payout_wallet_withdraw_hype_failed", message: String(error) });
    }
  });

  app.post("/settings/affiliate/payout-wallet/withdraw-usdc", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = withdrawAffiliateUsdcSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try {
      const result = await botVaultRuntimeService.withdrawUsdcFromAffiliatePayoutWallet({
        userId: user.id,
        amountUsdc: parsed.data.amountUsdc ?? null
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: "affiliate_payout_wallet_withdraw_usdc_failed", message: String(error) });
    }
  });
}
