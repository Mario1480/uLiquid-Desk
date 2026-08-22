import type express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getUliqFeatureFlags } from "./config.js";
import { UliqEntitlementService } from "./entitlement.service.js";
import { mapUliqEntitlementForApi } from "./benefitReservation.service.js";
import { UliqPresaleService } from "./presale.service.js";

const uint256Schema = z.string().trim().regex(/^(0|[1-9]\d*)$/).max(78);
const quoteSchema = z.object({ requestedUsdcRaw: uint256Schema });
const purchaseSchema = z.object({
  maxUsdcAmountRaw: uint256Schema,
  minUliqAllocationRaw: uint256Schema
});
const purchaseIdSchema = z.object({ purchaseId: uint256Schema });
const lockSchema = z.object({ amountRaw: uint256Schema, durationDays: z.union([z.literal(30), z.literal(90), z.literal(180)]) });
const lockIdSchema = z.object({ lockId: uint256Schema });

function mapError(error: unknown): { status: number; error: string } {
  const reason = error instanceof Error ? error.message : String(error);
  if (reason === "uliq_disabled" || reason === "uliq_production_activation_forbidden") return { status: 404, error: "not_found" };
  if (reason === "wallet_not_linked") return { status: 422, error: reason };
  if (reason.includes("invalid_") || reason === "unsupported_lock_duration") return { status: 400, error: reason };
  if (reason.includes("mismatch") || reason.includes("not_pending")) return { status: 409, error: reason };
  if (reason.includes("rpc")) return { status: 503, error: "uliq_rpc_unavailable" };
  return { status: 500, error: "uliq_request_failed" };
}

export function registerUliqRoutes(app: express.Express, deps: {
  presaleService: UliqPresaleService;
  entitlementService: UliqEntitlementService;
}) {
  function allowed(flag: "presaleEnabled" | "lockingEnabled" | "enabled", res: express.Response): boolean {
    try {
      const flags = getUliqFeatureFlags();
      if (!flags.enabled || !flags[flag]) {
        res.status(404).json({ error: "not_found" });
        return false;
      }
      return true;
    } catch {
      res.status(404).json({ error: "not_found" });
      return false;
    }
  }

  app.get("/uliq/presale", async (_req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    try { return res.json(await deps.presaleService.getOverview()); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.get("/uliq/me", requireAuth, async (_req, res) => {
    if (!allowed("enabled", res)) return;
    try { return res.json(await deps.presaleService.getForUser(getUserFromLocals(res).id)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.get("/uliq/entitlement", requireAuth, async (_req, res) => {
    if (!allowed("enabled", res)) return;
    try {
      const result = await deps.entitlementService.getForUser(getUserFromLocals(res).id);
      return res.json(mapUliqEntitlementForApi(result));
    } catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/presale/quote", requireAuth, async (req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    const parsed = quoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.quotePurchase(parsed.data.requestedUsdcRaw)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/presale/purchase/prepare", requireAuth, async (req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    const parsed = purchaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.preparePurchase({ userId: getUserFromLocals(res).id, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/presale/withdraw/prepare", requireAuth, async (req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    const parsed = purchaseIdSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.prepareWithdraw(getUserFromLocals(res).id, parsed.data.purchaseId)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/presale/finalize/prepare", requireAuth, async (req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    const parsed = purchaseIdSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.prepareFinalize(parsed.data.purchaseId)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.get("/uliq/vesting", requireAuth, async (_req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    try { return res.json(await deps.presaleService.getVesting(getUserFromLocals(res).id)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/vesting/claim/prepare", requireAuth, async (_req, res) => {
    if (!allowed("presaleEnabled", res)) return;
    try { return res.json(await deps.presaleService.prepareVestingClaim(getUserFromLocals(res).id)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.get("/uliq/locking", requireAuth, async (_req, res) => {
    if (!allowed("lockingEnabled", res)) return;
    try { return res.json(await deps.presaleService.getLocks(getUserFromLocals(res).id)); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/locking/lock/prepare", requireAuth, async (req, res) => {
    if (!allowed("lockingEnabled", res)) return;
    const parsed = lockSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.prepareLock({ userId: getUserFromLocals(res).id, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });

  app.post("/uliq/locking/unlock/prepare", requireAuth, async (req, res) => {
    if (!allowed("lockingEnabled", res)) return;
    const parsed = lockIdSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    try { return res.json(await deps.presaleService.prepareUnlock({ userId: getUserFromLocals(res).id, ...parsed.data })); }
    catch (error) { const mapped = mapError(error); return res.status(mapped.status).json({ error: mapped.error }); }
  });
}
