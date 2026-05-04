import type { Express } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { buildGridPreviewResponse } from "./previewValidation.js";

function compareCatalogRows(left: any, right: any) {
  const featuredDiff = Number(Boolean(right?.catalogFeatured)) - Number(Boolean(left?.catalogFeatured));
  if (featuredDiff !== 0) return featuredDiff;
  const sortOrderDiff = Number(left?.catalogSortOrder ?? 0) - Number(right?.catalogSortOrder ?? 0);
  if (sortOrderDiff !== 0) return sortOrderDiff;
  const leftUpdated = new Date(left?.updatedAt ?? 0).getTime();
  const rightUpdated = new Date(right?.updatedAt ?? 0).getTime();
  return rightUpdated - leftUpdated;
}

function matchesCatalogQuery(template: any, query: {
  search?: string;
  category?: string;
  tag?: string;
  difficulty?: string;
  risk?: string;
  featured?: boolean;
  favoritesOnly?: boolean;
  ownOnly?: boolean;
}) {
  const search = String(query.search ?? "").trim().toLowerCase();
  const category = String(query.category ?? "").trim().toLowerCase();
  const tag = String(query.tag ?? "").trim().toLowerCase();
  const difficulty = String(query.difficulty ?? "").trim().toUpperCase();
  const risk = String(query.risk ?? "").trim().toUpperCase();
  const tags = Array.isArray(template?.catalogTags)
    ? template.catalogTags.map((entry: unknown) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  if (query.favoritesOnly && !template?.isFavorite) return false;
  if (query.ownOnly && !template?.isOwnTemplate) return false;
  if (query.featured !== undefined && Boolean(template?.catalogFeatured) !== query.featured) return false;
  if (category && String(template?.catalogCategory ?? "").trim().toLowerCase() !== category) return false;
  if (tag && !tags.some((entry: string) => entry.toLowerCase() === tag)) return false;
  if (difficulty && String(template?.catalogDifficulty ?? "").trim().toUpperCase() !== difficulty) return false;
  if (risk && String(template?.catalogRiskLevel ?? "").trim().toUpperCase() !== risk) return false;

  if (!search) return true;
  const haystacks = [
    template?.name,
    template?.description,
    template?.catalogShortDescription,
    template?.symbol,
    template?.catalogCategory,
    ...tags
  ];
  return haystacks.some((value) => String(value ?? "").toLowerCase().includes(search));
}

const userTemplateModeSchema = z.enum(["long", "short", "neutral"]);
const userTemplateDraftInputBaseSchema = z.object({
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(280).nullable().optional(),
  symbol: z.string().trim().min(1).max(40),
  mode: userTemplateModeSchema,
  gridMode: z.enum(["arithmetic", "geometric"]),
  lowerPrice: z.number().positive(),
  upperPrice: z.number().positive(),
  gridCount: z.number().int().min(2).max(500),
  leverage: z.number().int().min(1).max(125),
  tpDefaultPct: z.number().positive().max(200).nullable().optional(),
  slDefaultPrice: z.number().positive().nullable().optional(),
  creatorProfitSharePct: z.number().min(0).max(25).default(0)
});

function validateUserTemplateBounds(value: z.infer<typeof userTemplateDraftInputBaseSchema>, ctx: z.RefinementCtx): void {
  if (value.upperPrice <= value.lowerPrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["upperPrice"],
      message: "upperPrice must be greater than lowerPrice"
    });
  }
}

const userTemplateDraftInputSchema = userTemplateDraftInputBaseSchema.superRefine(validateUserTemplateBounds);

const userTemplatePreviewInputSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  investUsd: z.number().positive(),
  extraMarginUsd: z.number().min(0).default(0),
  triggerPrice: z.number().positive().nullable().optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: z.enum(["MANUAL", "AUTO"]).optional(),
  autoMarginEnabled: z.boolean().default(false),
  markPriceOverride: z.number().positive().nullable().optional()
});

const userTemplateDraftPreviewSchema = z.object({
  draftTemplate: userTemplateDraftInputSchema,
  previewInput: userTemplatePreviewInputSchema
});

const userTemplateCreateSchema = z.object({
  draftTemplate: userTemplateDraftInputBaseSchema.extend({
    name: z.string().trim().min(1).max(120)
  }).superRefine(validateUserTemplateBounds),
  previewInput: userTemplatePreviewInputSchema
});

function deriveInvestMaxUsdFromDefault(investDefaultUsd: number): number {
  const candidate = investDefaultUsd * 20;
  return Number(Math.max(investDefaultUsd, candidate, 100_000).toFixed(2));
}

function buildUserTemplatePayload(input: z.infer<typeof userTemplateDraftInputSchema>, previewInput: z.infer<typeof userTemplatePreviewInputSchema>) {
  const investDefaultUsd = Number.isFinite(Number(previewInput.investUsd)) && Number(previewInput.investUsd) > 0
    ? Number(previewInput.investUsd)
    : 100;
  const leverage = Math.trunc(Number(input.leverage));
  const description = String(input.description ?? "").trim();
  return {
    name: String(input.name ?? "__draft_grid_template__").trim() || "__draft_grid_template__",
    description: description || null,
    catalogCategory: null,
    catalogTags: ["custom"],
    catalogDifficulty: "BEGINNER",
    catalogRiskLevel: "MEDIUM",
    catalogImageUrl: null,
    catalogShortDescription: description || null,
    catalogSortOrder: 0,
    catalogFeatured: false,
    templateVisibility: "PRIVATE",
    creatorProfitSharePct: Number(input.creatorProfitSharePct ?? 0),
    symbol: String(input.symbol ?? "").trim().toUpperCase(),
    marketType: "perp",
    mode: input.mode,
    gridMode: input.gridMode,
    allocationMode: "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: "FIXED_50_50",
    longBudgetPct: 50,
    shortBudgetPct: 50,
    marginPolicy: "AUTO_ALLOWED",
    autoMarginMaxUSDT: 0,
    autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW",
    autoMarginTriggerValue: 3,
    autoMarginStepUSDT: 25,
    autoMarginCooldownSec: 300,
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: 70,
    autoReserveTargetLiqDistancePct: 30,
    autoReserveMaxPreviewIterations: 12,
    initialSeedEnabled: true,
    initialSeedPct: 30,
    activeOrderWindowSize: 100,
    recenterDriftLevels: 1,
    lowerPrice: input.lowerPrice,
    upperPrice: input.upperPrice,
    gridCount: input.gridCount,
    crossSideConfig: null,
    leverageMin: leverage,
    leverageMax: leverage,
    leverageDefault: leverage,
    investMaxUsd: deriveInvestMaxUsdFromDefault(investDefaultUsd),
    investDefaultUsd,
    slippageDefaultPct: 0.1,
    slippageMinPct: 0.0001,
    slippageMaxPct: 5,
    tpDefaultPct: input.tpDefaultPct ?? null,
    slDefaultPrice: input.slDefaultPrice ?? null,
    allowAutoMargin: true,
    allowManualMarginAdjust: true,
    allowProfitWithdraw: true,
    version: 1
  };
}

async function computeDraftPreviewPayload(params: {
  deps: any;
  shared: any;
  user: { id: string; email: string };
  draftTemplate: Record<string, unknown>;
  previewInput: any;
  adminExchangeBypass: boolean;
}) {
  const account = await params.deps.db.exchangeAccount.findFirst({
    where: {
      id: params.previewInput.exchangeAccountId,
      userId: params.user.id
    }
  });
  if (!account) {
    return { status: 404, body: { error: "exchange_account_not_found" } };
  }

  const [pilotAccess, executionContext] = await Promise.all([
    params.deps.resolveGridHyperliquidPilotAccess(params.deps.db, {
      userId: params.user.id,
      email: params.user.email
    }),
    params.shared.getGridHyperliquidExecutionContext(params.deps.db)
  ]);
  const allowedExchanges = params.adminExchangeBypass || pilotAccess.allowed || executionContext.allowLiveHyperliquid
    ? new Set([...params.shared.allowedGridExchanges, "hyperliquid"])
    : params.shared.allowedGridExchanges;
  const allowed = params.shared.ensureGridExchangeAllowed({
    exchange: account.exchange,
    allowedExchanges
  });
  if (!allowed.ok) {
    return {
      status: 400,
      body: {
        error: "grid_exchange_not_allowed",
        exchange: allowed.exchange,
        allowedExchanges: allowed.allowedExchanges
      }
    };
  }

  const template = params.shared.mapDraftTemplateToPreviewContext(params.draftTemplate);
  if (!params.shared.isTemplatePolicyImplemented(template)) {
    return {
      status: 400,
      body: {
        error: "grid_policy_not_implemented",
        reason: "WEIGHTED_NEAR_PRICE and DYNAMIC_BY_PRICE_POSITION are not enabled in v1.4"
      }
    };
  }

  const templateMarginPolicy = String(template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"));
  const requestedMarginMode = params.previewInput.marginMode
    ?? (params.previewInput.autoMarginEnabled ? "AUTO" : "MANUAL");
  if (requestedMarginMode === "AUTO" && templateMarginPolicy !== "AUTO_ALLOWED") {
    return { status: 400, body: { error: "grid_template_auto_margin_not_allowed" } };
  }
  const autoMarginEnabled = requestedMarginMode === "AUTO";

  const fixedLeverage = Number(template.leverageDefault ?? template.leverageMin ?? 1);
  if (fixedLeverage < template.leverageMin || fixedLeverage > template.leverageMax) {
    return { status: 400, body: { error: "grid_template_leverage_invalid" } };
  }
  const fixedSlippagePct = Number(template.slippageDefaultPct ?? 0.1);
  if (!(fixedSlippagePct >= 0.0001 && fixedSlippagePct <= 5)) {
    return { status: 400, body: { error: "grid_template_slippage_invalid" } };
  }

  const computed = await params.deps.computeGridPreviewAndAllocation({
    userId: params.user.id,
    exchangeAccountId: account.id,
    template,
    autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: template.autoReserveFixedGridPct ?? 70,
    autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct ?? null,
    autoReserveMaxPreviewIterations: template.autoReserveMaxPreviewIterations ?? 8,
    investUsd: params.previewInput.investUsd,
    extraMarginUsd: autoMarginEnabled ? 0 : params.previewInput.extraMarginUsd,
    autoMarginEnabled,
    tpPct: params.previewInput.tpPct ?? template.tpDefaultPct ?? null,
    slPrice: params.previewInput.slPrice ?? template.slDefaultPrice ?? null,
    triggerPrice: params.previewInput.triggerPrice ?? null,
    markPriceOverride: params.previewInput.markPriceOverride ?? null,
    leverage: Math.trunc(fixedLeverage),
    slippagePct: fixedSlippagePct,
    resolveVenueContext: params.deps.resolveVenueContext
  });

  return {
    status: 200,
    template,
    body: buildGridPreviewResponse({
      computed,
      marginMode: requestedMarginMode,
      autoMarginEnabled,
      leverage: Math.trunc(fixedLeverage),
      extras: { pilotAccess }
    })
  };
}

function handleDraftPreviewError(res: any, deps: any, shared: any, error: unknown) {
  if (error instanceof deps.ManualTradingError) {
    const manualError = error as any;
    return res.status(manualError.status).json({ error: manualError.code, reason: manualError.message });
  }
  if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
  return res.status(503).json({ error: "grid_preview_failed", reason: String(error) });
}

export function registerGridTemplateRoutes(app: Express, deps: any, shared: any) {
  app.get("/admin/grid/templates", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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

      return res.json(buildGridPreviewResponse({
        computed,
        marginMode: requestedMarginMode,
        autoMarginEnabled,
        leverage: Math.trunc(fixedLeverage),
        extras: { pilotAccess }
      }));
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
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
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

  app.post("/grid/templates/draft-preview", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;

    const rawBody = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const parsed = userTemplateDraftPreviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const fullTemplate = buildUserTemplatePayload(parsed.data.draftTemplate, parsed.data.previewInput);
      const normalizedTemplate = shared.normalizeTemplatePolicyInput(fullTemplate);
      const preview = await computeDraftPreviewPayload({
        deps,
        shared,
        user,
        draftTemplate: normalizedTemplate,
        previewInput: parsed.data.previewInput,
        adminExchangeBypass: false
      });
      return res.status(preview.status).json(preview.body);
    } catch (error) {
      return handleDraftPreviewError(res, deps, shared, error);
    }
  });

  app.post("/grid/templates", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;

    const rawBody = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const parsed = userTemplateCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const user = getUserFromLocals(res);
    try {
      const fullTemplate = buildUserTemplatePayload(parsed.data.draftTemplate, parsed.data.previewInput);
      const normalizedTemplate = shared.normalizeTemplatePolicyInput(fullTemplate);
      const templateParsed = shared.gridTemplateCreateSchema.safeParse(normalizedTemplate);
      if (!templateParsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: templateParsed.error.flatten() });
      }
      if (templateParsed.data.mode === "cross") {
        return res.status(400).json({ error: "grid_user_template_cross_mode_not_allowed" });
      }

      const preview = await computeDraftPreviewPayload({
        deps,
        shared,
        user,
        draftTemplate: normalizedTemplate,
        previewInput: parsed.data.previewInput,
        adminExchangeBypass: false
      });
      if (preview.status !== 200) {
        return res.status(preview.status).json(preview.body);
      }
      const previewBody = preview.body && typeof preview.body === "object" ? preview.body as Record<string, any> : {};
      if (previewBody.status?.ready === false) {
        return res.status(400).json({
          error: "grid_template_preview_not_ready",
          status: previewBody.status,
          validation: previewBody.validation ?? null
        });
      }

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
          ...shared.toGridTemplatePersistence(templateParsed.data),
          templateVisibility: "PRIVATE",
          creatorProfitSharePct: templateParsed.data.creatorProfitSharePct,
          isPublished: true,
          isArchived: false,
          symbol: shared.normalizeTemplateSymbol(templateParsed.data.symbol)
        }
      });
      return res.status(201).json(shared.mapGridTemplateRow(shared.decorateGridTemplateRowForUser(row, user.id)));
    } catch (error) {
      if ((error as any)?.code === "P2002") {
        return res.status(409).json({ error: "grid_template_name_version_exists" });
      }
      if (shared.isMissingTableError(error)) {
        return res.status(503).json({ error: "grid_schema_not_ready" });
      }
      return res.status(500).json({ error: "grid_template_create_failed", reason: String(error) });
    }
  });

  app.get("/grid/templates", requireAuth, async (_req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    try {
      const user = getUserFromLocals(res);
      const parsed = shared.gridTemplateListQuerySchema.safeParse(_req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
      }
      const rows = await deps.db.gridBotTemplate.findMany({
        where: shared.buildVisibleGridTemplateWhere(user.id),
        include: {
          favorites: {
            where: { userId: user.id },
            select: { userId: true }
          }
        },
        orderBy: [
          { catalogFeatured: "desc" },
          { catalogSortOrder: "asc" },
          { updatedAt: "desc" }
        ]
      });
      const items = rows
        .filter((row: any) => shared.isTemplatePolicyImplemented(row))
        .map((row: any) => shared.mapGridTemplateRow(shared.decorateGridTemplateRowForUser(row, user.id)))
        .filter((row: any) => matchesCatalogQuery(row, parsed.data))
        .sort(compareCatalogRows);
      return res.json({
        items
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_list_failed", reason: String(error) });
    }
  });

  app.get("/grid/templates/filters", requireAuth, async (_req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    try {
      const user = getUserFromLocals(res);
      const rows = await deps.db.gridBotTemplate.findMany({
        where: shared.buildVisibleGridTemplateWhere(user.id),
        orderBy: [{ updatedAt: "desc" }]
      });
      const templates = rows
        .filter((row: any) => shared.isTemplatePolicyImplemented(row))
        .map((row: any) => shared.mapGridTemplateRow(shared.decorateGridTemplateRowForUser(row, user.id)));
      const categories = new Set<string>();
      const tags = new Set<string>();
      const difficulties = new Set<string>();
      const risks = new Set<string>();
      for (const template of templates) {
        const category = String(template.catalogCategory ?? "").trim();
        if (category) categories.add(category);
        for (const tag of Array.isArray(template.catalogTags) ? template.catalogTags : []) {
          const normalizedTag = String(tag ?? "").trim();
          if (normalizedTag) tags.add(normalizedTag);
        }
        const difficulty = String(template.catalogDifficulty ?? "").trim();
        if (difficulty) difficulties.add(difficulty);
        const risk = String(template.catalogRiskLevel ?? "").trim();
        if (risk) risks.add(risk);
      }
      return res.json({
        categories: [...categories].sort((left, right) => left.localeCompare(right)),
        tags: [...tags].sort((left, right) => left.localeCompare(right)),
        difficulties: [...difficulties].sort((left, right) => left.localeCompare(right)),
        risks: [...risks].sort((left, right) => left.localeCompare(right))
      });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_filters_failed", reason: String(error) });
    }
  });

  app.post("/grid/templates/:id/favorite", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    try {
      const user = getUserFromLocals(res);
      const template = await deps.db.gridBotTemplate.findFirst({
        where: shared.buildVisibleGridTemplateWhere(user.id, { id: req.params.id })
      });
      if (!template || !shared.isTemplatePolicyImplemented(template)) {
        return res.status(404).json({ error: "grid_template_not_found" });
      }
      try {
        await deps.db.gridTemplateFavorite.create({
          data: {
            userId: user.id,
            templateId: template.id
          }
        });
      } catch (error) {
        if ((error as any)?.code !== "P2002") throw error;
      }
      return res.json({ ok: true, isFavorite: true, templateId: template.id });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_favorite_failed", reason: String(error) });
    }
  });

  app.delete("/grid/templates/:id/favorite", requireAuth, async (req, res) => {
    if (!(await shared.requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await shared.requireGridCapabilityOrRespond(res, deps))) return;
    try {
      const user = getUserFromLocals(res);
      const template = await deps.db.gridBotTemplate.findFirst({
        where: shared.buildVisibleGridTemplateWhere(user.id, { id: req.params.id })
      });
      if (!template || !shared.isTemplatePolicyImplemented(template)) {
        return res.status(404).json({ error: "grid_template_not_found" });
      }
      await deps.db.gridTemplateFavorite.deleteMany({
        where: {
          userId: user.id,
          templateId: req.params.id
        }
      });
      return res.json({ ok: true, isFavorite: false, templateId: req.params.id });
    } catch (error) {
      if (shared.isMissingTableError(error)) return res.status(503).json({ error: "grid_schema_not_ready" });
      return res.status(500).json({ error: "grid_template_unfavorite_failed", reason: String(error) });
    }
  });
}
