import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";

const adminPredictionRefreshSchema = z.object({
  triggerDebounceSec: z.number().int().min(0).max(3600),
  aiCooldownSec: z.number().int().min(30).max(3600),
  eventThrottleSec: z.number().int().min(0).max(3600),
  hysteresisRatio: z.number().min(0.2).max(0.95),
  unstableFlipLimit: z.number().int().min(2).max(20),
  unstableFlipWindowSeconds: z.number().int().min(60).max(86400)
});

const adminPredictionDefaultsSchema = z.object({
  signalMode: z.enum(["local_only", "ai_only", "both"]).default("both")
});

export type RegisterAdminPredictionSettingsRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  GLOBAL_SETTING_PREDICTION_REFRESH_KEY: string;
  GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY: string;
  setGlobalSettingValue(key: string, value: unknown): Promise<any>;
  parseStoredPredictionRefreshSettings(value: unknown): any;
  toEffectivePredictionRefreshSettings(value: any): any;
  applyPredictionRefreshRuntimeSettings(value: unknown): any;
  clearPredictionTriggerDebounceState(): void;
  parseStoredPredictionDefaultsSettings(value: unknown): any;
  toEffectivePredictionDefaultsSettings(value: any): any;
  normalizePredictionSignalMode(value: unknown): any;
};

export function registerAdminPredictionSettingsRoutes(app: express.Express, deps: RegisterAdminPredictionSettingsRoutesDeps) {
  app.get("/admin/settings/prediction-refresh", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_PREDICTION_REFRESH_KEY },
      select: { value: true, updatedAt: true }
    });
    const stored = deps.parseStoredPredictionRefreshSettings(row?.value);
    const effective = deps.toEffectivePredictionRefreshSettings(stored);
    return res.json({ ...effective, updatedAt: row?.updatedAt ?? null, source: row ? "db" : "env", defaults: deps.toEffectivePredictionRefreshSettings(null) });
  });

  app.put("/admin/settings/prediction-refresh", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminPredictionRefreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const value = {
      triggerDebounceSec: parsed.data.triggerDebounceSec,
      aiCooldownSec: parsed.data.aiCooldownSec,
      eventThrottleSec: parsed.data.eventThrottleSec,
      hysteresisRatio: parsed.data.hysteresisRatio,
      unstableFlipLimit: parsed.data.unstableFlipLimit,
      unstableFlipWindowSeconds: parsed.data.unstableFlipWindowSeconds
    };
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_PREDICTION_REFRESH_KEY, value);
    const runtime = deps.applyPredictionRefreshRuntimeSettings(updated.value);
    deps.clearPredictionTriggerDebounceState();
    return res.json({ ...runtime, updatedAt: updated.updatedAt, source: "db", defaults: deps.toEffectivePredictionRefreshSettings(null) });
  });

  app.get("/admin/settings/prediction-defaults", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const row = await deps.db.globalSetting.findUnique({
      where: { key: deps.GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY },
      select: { value: true, updatedAt: true }
    });
    const effective = deps.toEffectivePredictionDefaultsSettings(deps.parseStoredPredictionDefaultsSettings(row?.value));
    return res.json({ ...effective, updatedAt: row?.updatedAt ?? null, source: row ? "db" : "env", defaults: deps.toEffectivePredictionDefaultsSettings(null) });
  });

  app.put("/admin/settings/prediction-defaults", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = adminPredictionDefaultsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const value = { signalMode: deps.normalizePredictionSignalMode(parsed.data.signalMode) };
    const updated = await deps.setGlobalSettingValue(deps.GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY, value);
    const effective = deps.toEffectivePredictionDefaultsSettings(deps.parseStoredPredictionDefaultsSettings(updated.value));
    return res.json({ ...effective, updatedAt: updated.updatedAt, source: "db", defaults: deps.toEffectivePredictionDefaultsSettings(null) });
  });
}
