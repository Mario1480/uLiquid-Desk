import express from "express";
import { requireAuth } from "../auth.js";

export type RegisterAdminIndicatorSettingsRoutesDeps = {
  db: any;
  requireSuperadmin(res: express.Response): Promise<boolean>;
  adminIndicatorSettingsResolvedQuerySchema: any;
  indicatorSettingsUpsertSchema: any;
  normalizeIndicatorSettingsPatch(value: unknown): any;
  mergeIndicatorSettings(defaults: any, patch: any): any;
  DEFAULT_INDICATOR_SETTINGS: any;
  normalizeIndicatorSettingExchange(value: unknown): string | null;
  normalizeIndicatorSettingAccountId(value: unknown): string | null;
  normalizeIndicatorSettingSymbol(value: unknown): string | null;
  normalizeIndicatorSettingTimeframe(value: unknown): string | null;
  resolveIndicatorSettings(input: any): Promise<any>;
  clearIndicatorSettingsCache(): void;
};

export function registerAdminIndicatorSettingsRoutes(app: express.Express, deps: RegisterAdminIndicatorSettingsRoutesDeps) {
  app.get("/api/admin/indicator-settings", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.db.indicatorSetting || typeof deps.db.indicatorSetting.findMany !== "function") {
      return res.status(503).json({ error: "indicator_settings_not_ready" });
    }

    const rows = await deps.db.indicatorSetting.findMany({ orderBy: { updatedAt: "desc" } });
    return res.json({
      items: rows.map((row: any) => {
        const configPatch = deps.normalizeIndicatorSettingsPatch(row.configJson);
        const configEffective = deps.mergeIndicatorSettings(deps.DEFAULT_INDICATOR_SETTINGS, configPatch);
        return {
          id: row.id,
          scopeType: row.scopeType,
          exchange: row.exchange,
          accountId: row.accountId,
          symbol: row.symbol,
          timeframe: row.timeframe,
          configPatch,
          configEffective,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        };
      })
    });
  });

  app.get("/api/admin/indicator-settings/resolved", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = deps.adminIndicatorSettingsResolvedQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const resolved = await deps.resolveIndicatorSettings({
      db: deps.db,
      exchange: deps.normalizeIndicatorSettingExchange(parsed.data.exchange),
      accountId: deps.normalizeIndicatorSettingAccountId(parsed.data.accountId),
      symbol: deps.normalizeIndicatorSettingSymbol(parsed.data.symbol),
      timeframe: deps.normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
    });

    return res.json({ ...resolved, defaults: deps.DEFAULT_INDICATOR_SETTINGS });
  });

  app.post("/api/admin/indicator-settings", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.db.indicatorSetting || typeof deps.db.indicatorSetting.findMany !== "function") {
      return res.status(503).json({ error: "indicator_settings_not_ready" });
    }
    const parsed = deps.indicatorSettingsUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const configPatch = deps.normalizeIndicatorSettingsPatch(parsed.data.config);
    const keyFields = {
      scopeType: parsed.data.scopeType,
      exchange: deps.normalizeIndicatorSettingExchange(parsed.data.exchange),
      accountId: deps.normalizeIndicatorSettingAccountId(parsed.data.accountId),
      symbol: deps.normalizeIndicatorSettingSymbol(parsed.data.symbol),
      timeframe: deps.normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
    };

    const existing = await deps.db.indicatorSetting.findFirst({ where: keyFields, select: { id: true } });
    if (existing) return res.status(409).json({ error: "duplicate_scope", message: "An entry for this scope already exists." });

    const created = await deps.db.indicatorSetting.create({ data: { ...keyFields, configJson: configPatch } });
    deps.clearIndicatorSettingsCache();
    return res.status(201).json({
      id: created.id,
      scopeType: created.scopeType,
      exchange: created.exchange,
      accountId: created.accountId,
      symbol: created.symbol,
      timeframe: created.timeframe,
      configPatch,
      configEffective: deps.mergeIndicatorSettings(deps.DEFAULT_INDICATOR_SETTINGS, configPatch),
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    });
  });

  app.put("/api/admin/indicator-settings/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.db.indicatorSetting || typeof deps.db.indicatorSetting.findMany !== "function") {
      return res.status(503).json({ error: "indicator_settings_not_ready" });
    }
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });
    const parsed = deps.indicatorSettingsUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const current = await deps.db.indicatorSetting.findUnique({ where: { id }, select: { id: true } });
    if (!current) return res.status(404).json({ error: "not_found" });

    const configPatch = deps.normalizeIndicatorSettingsPatch(parsed.data.config);
    const keyFields = {
      scopeType: parsed.data.scopeType,
      exchange: deps.normalizeIndicatorSettingExchange(parsed.data.exchange),
      accountId: deps.normalizeIndicatorSettingAccountId(parsed.data.accountId),
      symbol: deps.normalizeIndicatorSettingSymbol(parsed.data.symbol),
      timeframe: deps.normalizeIndicatorSettingTimeframe(parsed.data.timeframe)
    };
    const duplicate = await deps.db.indicatorSetting.findFirst({ where: { ...keyFields, NOT: { id } }, select: { id: true } });
    if (duplicate) return res.status(409).json({ error: "duplicate_scope", message: "An entry for this scope already exists." });

    const updated = await deps.db.indicatorSetting.update({ where: { id }, data: { ...keyFields, configJson: configPatch } });
    deps.clearIndicatorSettingsCache();
    return res.json({
      id: updated.id,
      scopeType: updated.scopeType,
      exchange: updated.exchange,
      accountId: updated.accountId,
      symbol: updated.symbol,
      timeframe: updated.timeframe,
      configPatch,
      configEffective: deps.mergeIndicatorSettings(deps.DEFAULT_INDICATOR_SETTINGS, configPatch),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    });
  });

  app.delete("/api/admin/indicator-settings/:id", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    if (!deps.db.indicatorSetting || typeof deps.db.indicatorSetting.findMany !== "function") {
      return res.status(503).json({ error: "indicator_settings_not_ready" });
    }
    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const existing = await deps.db.indicatorSetting.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "not_found" });

    await deps.db.indicatorSetting.delete({ where: { id } });
    deps.clearIndicatorSettingsCache();
    return res.json({ ok: true });
  });
}
