import type express from "express";
import { z } from "zod";
import { requireAuth, getUserFromLocals } from "../auth.js";
import { getUliqMainnetLockingFlags } from "./mainnetLocking.config.js";
import type { UliqMainnetLockingService } from "./mainnetLocking.service.js";

const uint = z.string().regex(/^(0|[1-9]\d*)$/).max(78);
const position = z.object({ lockId: uint, contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
export function registerUliqMainnetLockingRoutes(app: express.Express, service: UliqMainnetLockingService) {
  const gate: express.RequestHandler = (_req, res, next) => {
    if (!getUliqMainnetLockingFlags().enabled) { res.status(404).json({ error: "not_found" }); return; }
    next();
  };
  const handle = (run: (req: express.Request, userId: string) => Promise<unknown>): express.RequestHandler => async (req, res) => {
    try { res.json(await run(req, getUserFromLocals(res).id)); }
    catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_payload" }); return; }
      const reason = error instanceof Error ? error.message : "";
      const badInput = reason.startsWith("invalid_") || reason === "unsupported_lock_duration";
      const conflict = ["lock_wallet_mismatch", "lock_already_withdrawn", "lock_expiry_not_increasing", "lock_still_active", "insufficient_uliq_balance"];
      const disabled = /uliq_mainnet_locking_(deposits|extensions)_disabled/.test(reason);
      const status = badInput ? 400 : reason === "wallet_not_linked" ? 422 : disabled ? 403 : conflict.includes(reason) ? 409 : 503;
      res.status(status).json({ error: status === 503 ? "uliq_mainnet_locking_unavailable" : reason });
    }
  };
  const base = "/uliq/mainnet-locking";
  app.get(base, gate, requireAuth, handle((req, user) => service.getForUser(user, z.object({ before: uint.optional() }).parse(req.query).before)));
  app.post(`${base}/lock/prepare`, gate, requireAuth, handle((req, user) => {
    const body = z.object({ amountRaw: uint, durationDays: z.union([z.literal(32), z.literal(185), z.literal(367)]) }).parse(req.body);
    return service.prepareLock(user, body.amountRaw, body.durationDays);
  }));
  app.post(`${base}/unlock/prepare`, gate, requireAuth, handle((req, user) => {
    const body = position.parse(req.body);
    return service.preparePosition(user, body.lockId, body.contractAddress);
  }));
  app.post(`${base}/extend/prepare`, gate, requireAuth, handle((req, user) => {
    const body = position.extend({ newUnlockAt: uint }).parse(req.body);
    return service.preparePosition(user, body.lockId, body.contractAddress, body.newUnlockAt);
  }));
}
