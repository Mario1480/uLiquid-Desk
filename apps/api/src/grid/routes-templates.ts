import type { Express } from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";

export function registerGridTemplateRoutes(app: Express, deps: any, shared: any) {
  app.get("/admin/grid/templates", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = shared.gridTemplateListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    try {
      const rows = await deps.db.gridBotTemplate.findMany({
        where: {
          ...(parsed.data.published !== undefined ? { isPublished: parsed.data.published } : {}),
          ...(parsed.data.archived !== undefined ? { isArchived: parsed.data.archived } : {}),
          ...(parsed.data.symbol ? { symbol: shared.normalizeTemplateSymbol(parsed.data.symbol) } : {}),
          ...(parsed.data.mode ? { mode: parsed.data.mode } : {})
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      return res.json({ items: rows.map(shared.mapGridTemplateRow) });
    } catch (error) {
      if (shared.isMissingTableError(error)) {
        return res.status(503).json({ error: "grid_schema_not_ready" });
      }
      return res.status(500).json({ error: "grid_template_list_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const normalizedInput = shared.normalizeTemplatePolicyInput((req.body ?? {}) as Record<string, unknown>);
    const parsed = shared.gridTemplateCreateSchema.safeParse(normalizedInput);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    if (!shared.isTemplatePolicyImplemented(parsed.data)) {
      return res.status(400).json({
        error: "grid_policy_not_implemented",
        reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
      });
    }

    const user = getUserFromLocals(res);
    try {
      const membership = await deps.db.workspaceMember.findFirst({
        where: { userId: user.id },
        select: { workspaceId: true }
      });
      if (!membership?.workspaceId) {
        return res.status(400).json({ error: "workspace_not_found" });
      }

      const row = await deps.db.gridBotTemplate.create({
        data: {
          workspaceId: membership.workspaceId,
          createdByUserId: user.id,
          ...shared.toGridTemplatePersistence(parsed.data),
          symbol: shared.normalizeTemplateSymbol(parsed.data.symbol)
        }
      });
      return res.status(201).json(shared.mapGridTemplateRow(row));
    } catch (error) {
      if (shared.isMissingTableError(error)) {
        return res.status(503).json({ error: "grid_schema_not_ready" });
      }
      return res.status(500).json({ error: "grid_template_create_failed", reason: String(error) });
    }
  });

  app.put("/admin/grid/templates/:id", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = shared.gridTemplateUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const existing = await deps.db.gridBotTemplate.findUnique({
        where: { id: req.params.id }
      });
      if (!existing) return res.status(404).json({ error: "grid_template_not_found" });
      const mergedPayload = shared.normalizeTemplatePolicyInput({
        ...existing,
        ...(parsed.data as Record<string, unknown>)
      });
      const mergedParsed = shared.gridTemplateCreateSchema.safeParse(mergedPayload);
      if (!mergedParsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: mergedParsed.error.flatten() });
      }
      if (!shared.isTemplatePolicyImplemented(mergedParsed.data)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }
      const nextTemplate = mergedParsed.data;
      const row = await deps.db.gridBotTemplate.update({
        where: { id: req.params.id },
        data: {
          ...shared.toGridTemplatePersistence(nextTemplate),
          symbol: shared.normalizeTemplateSymbol(nextTemplate.symbol)
        }
      });
      return res.json(shared.mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_update_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/publish", requireAuth, async (_req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const row = await deps.db.gridBotTemplate.update({
        where: { id: _req.params.id },
        data: { isPublished: true, isArchived: false }
      });
      return res.json(shared.mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_publish_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/archive", requireAuth, async (_req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const row = await deps.db.gridBotTemplate.update({
        where: { id: _req.params.id },
        data: { isArchived: true, isPublished: false }
      });
      return res.json(shared.mapGridTemplateRow(row));
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_archive_failed", reason: String(error) });
    }
  });

  app.delete("/admin/grid/templates/:id", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;
    try {
      const instanceCount = await deps.db.gridBotInstance.count({
        where: { templateId: req.params.id }
      });
      if (instanceCount > 0) {
        return res.status(409).json({
          error: "grid_template_in_use",
          instanceCount
        });
      }
      await deps.db.gridBotTemplate.delete({ where: { id: req.params.id } });
      return res.json({ ok: true, id: req.params.id });
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "grid_template_not_found" });
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_delete_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/draft-preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const rawBody = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const normalizedBody = {
      ...rawBody,
      draftTemplate: shared.normalizeTemplatePolicyInput(
        rawBody.draftTemplate && typeof rawBody.draftTemplate === "object" && !Array.isArray(rawBody.draftTemplate)
          ? rawBody.draftTemplate as Record<string, unknown>
          : {}
      )
    };
    const parsed = shared.gridTemplateDraftPreviewSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const account = await deps.db.exchangeAccount.findFirst({
        where: {
          id: parsed.data.previewInput.exchangeAccountId,
          userId: user.id
        }
      });
      if (!account) return res.status(404).json({ error: "exchange_account_not_found" });
      const pilotAccess = await deps.resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email
      });
      if (!shared.isAdminGridDraftPreviewExchangeAllowed(account.exchange)) {
        const allowed = shared.ensureGridExchangeAllowed({
          exchange: account.exchange,
          allowedExchanges: new Set([...shared.allowedGridExchanges, "hyperliquid"])
        });
        const blockedExchange = shared.normalizeGridExchange(account.exchange);
        const allowedExchanges = "allowedExchanges" in allowed
          ? allowed.allowedExchanges
          : [...shared.allowedGridExchanges, "hyperliquid"];
        return res.status(400).json({
          error: "grid_exchange_not_allowed",
          exchange: blockedExchange,
          allowedExchanges
        });
      }

      const template = shared.mapDraftTemplateToPreviewContext(parsed.data.draftTemplate);
      if (!shared.isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
      const requestedMarginMode = parsed.data.previewInput.marginMode
        ?? (parsed.data.previewInput.autoMarginEnabled ? "AUTO" : "MANUAL");
      if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
        return res.status(400).json({ error: "grid_template_auto_margin_not_allowed" });
      }
      const autoMarginEnabled = requestedMarginMode === "AUTO";

      const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
      if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
        return res.status(400).json({ error: "grid_template_leverage_invalid" });
      }
      const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
      if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
        return res.status(400).json({ error: "grid_template_slippage_invalid" });
      }

      const computed = await deps.computeGridPreviewAndAllocation({
        userId: user.id,
        exchangeAccountId: account.id,
        template,
        autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
        autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
        autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
        autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
        investUsd: parsed.data.previewInput.investUsd,
        extraMarginUsd: autoMarginEnabled ? 0 : parsed.data.previewInput.extraMarginUsd,
        autoMarginEnabled,
        tpPct: parsed.data.previewInput.tpPct ?? template.tpDefaultPct ?? null,
        slPrice: parsed.data.previewInput.slPrice ?? template.slDefaultPrice ?? null,
        triggerPrice: parsed.data.previewInput.triggerPrice ?? null,
        markPriceOverride: parsed.data.previewInput.markPriceOverride ?? null,
        leverage: Math.trunc(fixedLeverage),
        slippagePct: fixedSlippagePct,
        resolveVenueContext: deps.resolveVenueContext
      });

      const minLiqDistancePct = Number.isFinite(Number(computed.preview.liqDistanceMinPct))
        ? Number(computed.preview.liqDistanceMinPct)
        : Number(computed.venueContext.liqDistanceMinPct);
      const worstCaseLiqDistancePct = Number.isFinite(Number(computed.preview.worstCaseLiqDistancePct))
        ? Number(computed.preview.worstCaseLiqDistancePct)
        : null;
      const liqRisk = worstCaseLiqDistancePct !== null && worstCaseLiqDistancePct < minLiqDistancePct;
      const insufficient = Boolean(computed.allocation.insufficient || computed.allocation.gridInvestUsd + 1e-9 < computed.minInvestmentUSDT);
      const statusCodeSet = new Set<string>(computed.allocation.reasonCodes ?? []);
      if (insufficient) statusCodeSet.add("insufficient_budget");
      if (liqRisk) statusCodeSet.add("liq_distance_below_threshold");

      return res.json({
        markPrice: computed.markPrice,
        marketDataVenue: computed.venueContext.marketDataVenue,
        minInvestmentUSDT: computed.minInvestmentUSDT,
        minInvestmentBreakdown: computed.minInvestmentBreakdown,
        initialSeed: computed.initialSeed,
        marginMode: requestedMarginMode,
        allocation: computed.allocation,
        allocationBreakdown: (computed.preview as any).allocationBreakdown ?? null,
        qtyModel: (computed.preview as any).qtyModel ?? null,
        venueChecks: (computed.preview as any).venueChecks ?? null,
        windowMeta: (computed.preview as any).windowMeta ?? null,
        profitPerGridEstimateUSDT: Number((computed.preview as any).profitPerGridEstimateUSDT ?? computed.preview.profitPerGridNetUsd ?? 0),
        liq: {
          liqEstimateLong: computed.preview.liqEstimateLong ?? null,
          liqEstimateShort: computed.preview.liqEstimateShort ?? null,
          worstCaseLiqPrice: computed.preview.worstCaseLiqPrice ?? null,
          worstCaseLiqDistancePct,
          liqDistanceMinPct: minLiqDistancePct
        },
        warnings: computed.warnings,
        status: {
          ready: !insufficient && !liqRisk,
          codes: [...statusCodeSet]
        },
        pilotAccess
      });
    } catch (error) {
      if (error instanceof deps.ManualTradingError) {
        const manualError = error as any;
        return res.status(manualError.status).json({ error: manualError.code, reason: manualError.message });
      }
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason: String(error) });
    }
  });

  app.post("/admin/grid/templates/:id/preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await deps.requireSuperadmin(res))) return;

    const parsed = shared.gridTemplatePreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    try {
      const template = await deps.db.gridBotTemplate.findUnique({ where: { id: req.params.id } });
      if (!template) return res.status(404).json({ error: "grid_template_not_found" });
      if (!shared.isTemplatePolicyImplemented(template)) {
        return res.status(400).json({
          error: "grid_policy_not_implemented",
          reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
        });
      }

      const normalizedTemplate = shared.mapGridTemplateRow(template);
      const preview = await deps.requestGridPreview({
        mode: normalizedTemplate.mode,
        gridMode: normalizedTemplate.gridMode,
        allocationMode: normalizedTemplate.allocationMode,
        budgetSplitPolicy: normalizedTemplate.budgetSplitPolicy,
        longBudgetPct: normalizedTemplate.longBudgetPct,
        shortBudgetPct: normalizedTemplate.shortBudgetPct,
        lowerPrice: normalizedTemplate.lowerPrice,
        upperPrice: normalizedTemplate.upperPrice,
        gridCount: normalizedTemplate.gridCount,
        crossSideConfig: normalizedTemplate.crossSideConfig ?? null,
        activeOrderWindowSize: normalizedTemplate.activeOrderWindowSize ?? 100,
        recenterDriftLevels: normalizedTemplate.recenterDriftLevels ?? 1,
        investUsd: parsed.data.investUsd,
        leverage: parsed.data.leverage,
        markPrice: parsed.data.markPrice,
        slippagePct: parsed.data.slippagePct ?? normalizedTemplate.slippageDefaultPct,
        tpPct: parsed.data.tpPct,
        slPrice: parsed.data.slPrice,
        triggerPrice: parsed.data.triggerPrice,
        trailingEnabled: parsed.data.trailingEnabled ?? false,
        initialSeedEnabled: normalizedTemplate.initialSeedEnabled ?? true,
        initialSeedPct: normalizedTemplate.initialSeedPct ?? 30
      });

      return res.json({ template: normalizedTemplate, preview });
    } catch (error) {
      const reason = String(error);
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(503).json({ error: "grid_preview_failed", reason });
    }
  });

  app.get("/grid/templates", requireAuth, async (_req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    try {
      const rows = await deps.db.gridBotTemplate.findMany({
        where: {
          isPublished: true,
          isArchived: false
        },
        orderBy: [{ updatedAt: "desc" }]
      });
      return res.json({
        items: rows
          .filter((row: any) => shared.isTemplatePolicyImplemented(row))
          .map(shared.mapGridTemplateRow)
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_list_failed", reason: String(error) });
    }
  });
}
