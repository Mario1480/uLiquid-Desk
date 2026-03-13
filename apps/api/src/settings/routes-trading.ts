import express from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";

export type RegisterSettingsTradingRoutesDeps = {
  getPredictionDefaultsSettings(): Promise<any>;
  getTradingSettings(userId: string): Promise<any>;
  saveTradingSettings(userId: string, input: any): Promise<any>;
  tradingSettingsSchema: any;
};

export function registerSettingsTradingRoutes(
  app: express.Express,
  deps: RegisterSettingsTradingRoutesDeps
) {
  app.get("/settings/prediction-defaults", requireAuth, async (_req, res) => {
    const effective = await deps.getPredictionDefaultsSettings();
    return res.json(effective);
  });

  app.get("/api/trading/settings", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const settings = await deps.getTradingSettings(user.id);
    return res.json(settings);
  });

  app.post("/api/trading/settings", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.tradingSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const settings = await deps.saveTradingSettings(user.id, {
      ...parsed.data,
      marketType: parsed.data.marketType ?? undefined
    });
    return res.json(settings);
  });
}
