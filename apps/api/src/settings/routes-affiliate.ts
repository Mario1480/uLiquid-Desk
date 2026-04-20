import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import type { BotVaultV3Service } from "../vaults/botVaultV3.service.js";
import { getAffiliateOverviewForUser } from "../affiliate/program.js";

export type RegisterSettingsAffiliateRoutesDeps = {
  db: any;
  botVaultV3Service?: BotVaultV3Service | null;
};

const withdrawAffiliateHypeSchema = z.object({
  amountHype: z.number().positive().optional(),
  reserveHype: z.number().min(0).max(1000).optional()
});

const withdrawAffiliateUsdcSchema = z.object({
  amountUsdc: z.number().positive().optional()
});

export function registerSettingsAffiliateRoutes(
  app: express.Express,
  deps: RegisterSettingsAffiliateRoutesDeps
) {
  app.get("/settings/affiliate", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const [overview, payoutWallet] = await Promise.all([
      getAffiliateOverviewForUser(deps.db, user.id, { limit: 20 }),
      deps.botVaultV3Service
        ? deps.botVaultV3Service.getAffiliatePayoutWalletSummary({ userId: user.id }).catch(() => null)
        : Promise.resolve(null)
    ]);
    return res.json({
      ...overview,
      payoutWallet,
      referralPath: `/register?ref=${encodeURIComponent(overview.profile.code)}`
    });
  });

  if (!deps.botVaultV3Service) return;

  app.post("/settings/affiliate/payout-wallet/create", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      const payoutWallet = await deps.botVaultV3Service!.createAffiliatePayoutWallet({ userId: user.id });
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
      const result = await deps.botVaultV3Service!.withdrawHypeFromAffiliatePayoutWallet({
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
      const result = await deps.botVaultV3Service!.withdrawUsdcFromAffiliatePayoutWallet({
        userId: user.id,
        amountUsdc: parsed.data.amountUsdc ?? null
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: "affiliate_payout_wallet_withdraw_usdc_failed", message: String(error) });
    }
  });
}
