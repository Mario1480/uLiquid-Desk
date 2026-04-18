import express from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getAffiliateOverviewForUser } from "../affiliate/program.js";

export type RegisterSettingsAffiliateRoutesDeps = {
  db: any;
};

export function registerSettingsAffiliateRoutes(
  app: express.Express,
  deps: RegisterSettingsAffiliateRoutesDeps
) {
  app.get("/settings/affiliate", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const overview = await getAffiliateOverviewForUser(deps.db, user.id, { limit: 20 });
    return res.json({
      ...overview,
      referralPath: `/register?ref=${encodeURIComponent(overview.profile.code)}`
    });
  });
}
