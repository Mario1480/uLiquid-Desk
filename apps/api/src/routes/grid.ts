import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { requestGridPreview } from "../grid/pythonGridClient.js";
import { createGridLifecycleService } from "../grid/lifecycle.js";
import { computeGridPreviewAndAllocation as sharedComputeGridPreviewAndAllocation } from "../grid/previewComputation.js";
import { registerGridTemplateRoutes } from "../grid/routes-templates.js";
import { registerGridInstanceRoutes } from "../grid/routes-instances.js";
import { computeAutoMarginAllocation, computeAutoReserveAllocationDynamic } from "../grid/autoMargin.js";
import { ManualTradingError, normalizeSymbolInput } from "../trading.js";
import {
  mapBotVaultSnapshot,
  extractBotVaultProviderMetadataRaw,
  summarizeBotVaultProviderMetadata,
  type VaultService
} from "../vaults/service.js";
import type { OnchainActionService } from "../vaults/onchainAction.service.js";
import type { ExecutionProviderOrchestrator } from "../vaults/executionProvider.orchestrator.js";
import { getEffectiveVaultExecutionProvider } from "../vaults/executionProvider.settings.js";
import { resolveGridHyperliquidPilotAccess } from "../vaults/gridHyperliquidPilot.settings.js";

const gridModeSchema = z.enum(["long", "short", "neutral", "cross"]);
const gridPriceModeSchema = z.enum(["arithmetic", "geometric"]);
const gridStateSchema = z.enum(["created", "running", "paused", "stopped", "archived", "error"]);
const gridAllocationModeSchema = z.enum([
  "EQUAL_NOTIONAL_PER_GRID",
  "EQUAL_BASE_QTY_PER_GRID",
  "WEIGHTED_NEAR_PRICE"
]);
const gridBudgetSplitPolicySchema = z.enum([
  "FIXED_50_50",
  "FIXED_CUSTOM",
  "DYNAMIC_BY_PRICE_POSITION"
]);
const gridMarginPolicySchema = z.enum(["MANUAL_ONLY", "AUTO_ALLOWED"]);
const gridAutoMarginTriggerTypeSchema = z.enum(["LIQ_DISTANCE_PCT_BELOW", "MARGIN_RATIO_ABOVE"]);
const gridInstanceMarginModeSchema = z.enum(["MANUAL", "AUTO"]);
const gridAutoReservePolicySchema = z.enum(["FIXED_RATIO", "LIQ_GUARD_MAX_GRID"]);
const gridCatalogDifficultySchema = z.enum(["BEGINNER", "ADVANCED", "EXPERT"]);
const gridCatalogRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const gridCrossSideSchema = z.object({
  lowerPrice: z.number().positive(),
  upperPrice: z.number().positive(),
  gridCount: z.number().int().min(2).max(500)
});
const gridCrossSideConfigSchema = z.object({
  long: gridCrossSideSchema,
  short: gridCrossSideSchema
});

type GridCrossSide = z.infer<typeof gridCrossSideSchema>;
type GridCrossSideConfig = z.infer<typeof gridCrossSideConfigSchema>;

function normalizeCatalogString(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeCatalogTags(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of candidates) {
    const tag = String(candidate ?? "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag.slice(0, 40));
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function coerceCatalogDifficulty(value: unknown): z.infer<typeof gridCatalogDifficultySchema> {
  const normalized = String(value ?? "").trim().toUpperCase();
  return gridCatalogDifficultySchema.options.includes(normalized as any)
    ? normalized as z.infer<typeof gridCatalogDifficultySchema>
    : "BEGINNER";
}

function coerceCatalogRiskLevel(value: unknown): z.infer<typeof gridCatalogRiskLevelSchema> {
  const normalized = String(value ?? "").trim().toUpperCase();
  return gridCatalogRiskLevelSchema.options.includes(normalized as any)
    ? normalized as z.infer<typeof gridCatalogRiskLevelSchema>
    : "MEDIUM";
}

function deriveCrossTemplateBounds(crossSideConfig: GridCrossSideConfig): {
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
} {
  return {
    lowerPrice: Math.min(crossSideConfig.long.lowerPrice, crossSideConfig.short.lowerPrice),
    upperPrice: Math.max(crossSideConfig.long.upperPrice, crossSideConfig.short.upperPrice),
    gridCount: Math.max(crossSideConfig.long.gridCount, crossSideConfig.short.gridCount),
  };
}

function normalizeCrossSideCandidate(
  side: unknown,
  fallback: GridCrossSide
): GridCrossSide {
  const record = side && typeof side === "object" && !Array.isArray(side)
    ? side as Record<string, unknown>
    : {};
  const lowerPrice = Number(record.lowerPrice);
  const upperPrice = Number(record.upperPrice);
  const gridCount = Math.trunc(Number(record.gridCount));
  const candidate = {
    lowerPrice: Number.isFinite(lowerPrice) && lowerPrice > 0 ? lowerPrice : fallback.lowerPrice,
    upperPrice: Number.isFinite(upperPrice) && upperPrice > 0 ? upperPrice : fallback.upperPrice,
    gridCount: Number.isFinite(gridCount) && gridCount >= 2 && gridCount <= 500 ? gridCount : fallback.gridCount,
  };
  if (candidate.upperPrice <= candidate.lowerPrice) {
    return fallback;
  }
  return candidate;
}

function normalizeCrossSideConfigValue(input: Record<string, unknown>): GridCrossSideConfig | null {
  const mode = String(input.mode ?? "").trim();
  if (mode !== "cross") return null;
  const fallback: GridCrossSide = {
    lowerPrice: Number(input.lowerPrice),
    upperPrice: Number(input.upperPrice),
    gridCount: Math.trunc(Number(input.gridCount)),
  };
  if (
    !Number.isFinite(fallback.lowerPrice) || fallback.lowerPrice <= 0
    || !Number.isFinite(fallback.upperPrice) || fallback.upperPrice <= fallback.lowerPrice
    || !Number.isFinite(fallback.gridCount) || fallback.gridCount < 2 || fallback.gridCount > 500
  ) {
    return null;
  }
  const rawConfig = input.crossSideConfig && typeof input.crossSideConfig === "object" && !Array.isArray(input.crossSideConfig)
    ? input.crossSideConfig as Record<string, unknown>
    : {};
  const rowConfig = {
    long: {
      lowerPrice: input.crossLongLowerPrice,
      upperPrice: input.crossLongUpperPrice,
      gridCount: input.crossLongGridCount,
    },
    short: {
      lowerPrice: input.crossShortLowerPrice,
      upperPrice: input.crossShortUpperPrice,
      gridCount: input.crossShortGridCount,
    }
  };
  return {
    long: normalizeCrossSideCandidate(rawConfig.long ?? rowConfig.long, fallback),
    short: normalizeCrossSideCandidate(rawConfig.short ?? rowConfig.short, fallback),
  };
}

function applyCrossSideConfigToTemplateRecord(input: Record<string, unknown>): Record<string, unknown> {
  const crossSideConfig = normalizeCrossSideConfigValue(input);
  if (!crossSideConfig) {
    return {
      ...input,
      crossSideConfig: null,
      crossLongLowerPrice: null,
      crossLongUpperPrice: null,
      crossLongGridCount: null,
      crossShortLowerPrice: null,
      crossShortUpperPrice: null,
      crossShortGridCount: null,
    };
  }
  const derived = deriveCrossTemplateBounds(crossSideConfig);
  return {
    ...input,
    lowerPrice: derived.lowerPrice,
    upperPrice: derived.upperPrice,
    gridCount: derived.gridCount,
    crossSideConfig,
    crossLongLowerPrice: crossSideConfig.long.lowerPrice,
    crossLongUpperPrice: crossSideConfig.long.upperPrice,
    crossLongGridCount: crossSideConfig.long.gridCount,
    crossShortLowerPrice: crossSideConfig.short.lowerPrice,
    crossShortUpperPrice: crossSideConfig.short.upperPrice,
    crossShortGridCount: crossSideConfig.short.gridCount,
  };
}

function toGridTemplatePersistence(input: Record<string, unknown>): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description ?? null,
    catalogCategory: input.catalogCategory ?? null,
    catalogTags: Array.isArray(input.catalogTags) ? input.catalogTags : [],
    catalogDifficulty: input.catalogDifficulty,
    catalogRiskLevel: input.catalogRiskLevel,
    catalogImageUrl: input.catalogImageUrl ?? null,
    catalogShortDescription: input.catalogShortDescription ?? null,
    catalogSortOrder: input.catalogSortOrder,
    catalogFeatured: input.catalogFeatured,
    symbol: input.symbol,
    marketType: input.marketType,
    mode: input.mode,
    gridMode: input.gridMode,
    allocationMode: input.allocationMode,
    budgetSplitPolicy: input.budgetSplitPolicy,
    longBudgetPct: input.longBudgetPct,
    shortBudgetPct: input.shortBudgetPct,
    marginPolicy: input.marginPolicy,
    autoMarginMaxUSDT: input.autoMarginMaxUSDT ?? null,
    autoMarginTriggerType: input.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: input.autoMarginTriggerValue ?? null,
    autoMarginStepUSDT: input.autoMarginStepUSDT ?? null,
    autoMarginCooldownSec: input.autoMarginCooldownSec ?? null,
    autoReservePolicy: input.autoReservePolicy,
    autoReserveFixedGridPct: input.autoReserveFixedGridPct,
    autoReserveTargetLiqDistancePct: input.autoReserveTargetLiqDistancePct ?? null,
    autoReserveMaxPreviewIterations: input.autoReserveMaxPreviewIterations,
    initialSeedEnabled: input.initialSeedEnabled,
    initialSeedPct: input.initialSeedPct,
    activeOrderWindowSize: input.activeOrderWindowSize,
    recenterDriftLevels: input.recenterDriftLevels,
    lowerPrice: input.lowerPrice,
    upperPrice: input.upperPrice,
    gridCount: input.gridCount,
    crossLongLowerPrice: input.crossLongLowerPrice ?? null,
    crossLongUpperPrice: input.crossLongUpperPrice ?? null,
    crossLongGridCount: input.crossLongGridCount ?? null,
    crossShortLowerPrice: input.crossShortLowerPrice ?? null,
    crossShortUpperPrice: input.crossShortUpperPrice ?? null,
    crossShortGridCount: input.crossShortGridCount ?? null,
    leverageMin: input.leverageMin,
    leverageMax: input.leverageMax,
    leverageDefault: input.leverageDefault,
    investMaxUsd: input.investMaxUsd,
    investDefaultUsd: input.investDefaultUsd,
    slippageDefaultPct: input.slippageDefaultPct,
    slippageMinPct: input.slippageMinPct,
    slippageMaxPct: input.slippageMaxPct,
    tpDefaultPct: input.tpDefaultPct ?? null,
    slDefaultPrice: input.slDefaultPrice ?? null,
    allowAutoMargin: input.allowAutoMargin,
    allowManualMarginAdjust: input.allowManualMarginAdjust,
    allowProfitWithdraw: input.allowProfitWithdraw,
    version: input.version,
  };
}

function normalizeGridExchange(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((entry) => normalizeGridExchange(entry))
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

function ensureGridExchangeAllowed(params: {
  exchange: unknown;
  allowedExchanges: Set<string>;
}): { ok: true } | { ok: false; exchange: string; allowedExchanges: string[] } {
  const exchange = normalizeGridExchange(params.exchange);
  if (params.allowedExchanges.has(exchange)) return { ok: true };
  return {
    ok: false,
    exchange,
    allowedExchanges: [...params.allowedExchanges]
  };
}

const gridTemplateBaseObjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  catalogCategory: z.string().trim().max(80).nullable().optional(),
  catalogTags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  catalogDifficulty: gridCatalogDifficultySchema.default("BEGINNER"),
  catalogRiskLevel: gridCatalogRiskLevelSchema.default("MEDIUM"),
  catalogImageUrl: z.string().trim().url().max(2048).nullable().optional(),
  catalogShortDescription: z.string().trim().max(280).nullable().optional(),
  catalogSortOrder: z.number().int().min(-100000).max(100000).default(0),
  catalogFeatured: z.boolean().default(false),
  symbol: z.string().trim().min(1).max(40),
  marketType: z.literal("perp").default("perp"),
  mode: gridModeSchema,
  gridMode: gridPriceModeSchema,
  allocationMode: gridAllocationModeSchema.default("EQUAL_NOTIONAL_PER_GRID"),
  budgetSplitPolicy: gridBudgetSplitPolicySchema.default("FIXED_50_50"),
  longBudgetPct: z.number().min(0).max(100).default(50),
  shortBudgetPct: z.number().min(0).max(100).default(50),
  marginPolicy: gridMarginPolicySchema.default("MANUAL_ONLY"),
  autoMarginMaxUSDT: z.number().min(0).nullable().optional(),
  autoMarginTriggerType: gridAutoMarginTriggerTypeSchema.nullable().optional(),
  autoMarginTriggerValue: z.number().positive().nullable().optional(),
  autoMarginStepUSDT: z.number().positive().nullable().optional(),
  autoMarginCooldownSec: z.number().int().min(0).nullable().optional(),
  autoReservePolicy: gridAutoReservePolicySchema.default("LIQ_GUARD_MAX_GRID"),
  autoReserveFixedGridPct: z.number().min(0).max(100).default(70),
  autoReserveTargetLiqDistancePct: z.number().min(0).max(100).nullable().optional(),
  autoReserveMaxPreviewIterations: z.number().int().min(1).max(16).default(8),
  initialSeedEnabled: z.boolean().default(true),
  initialSeedPct: z.number().min(0).max(60).default(30),
  activeOrderWindowSize: z.number().int().min(40).max(120).default(100),
  recenterDriftLevels: z.number().int().min(1).max(10).default(1),
  lowerPrice: z.number().positive(),
  upperPrice: z.number().positive(),
  gridCount: z.number().int().min(2).max(500),
  crossSideConfig: gridCrossSideConfigSchema.nullable().optional(),
  leverageMin: z.number().int().min(1).max(125).default(1),
  leverageMax: z.number().int().min(1).max(125).default(3),
  leverageDefault: z.number().int().min(1).max(125).default(3),
  investMaxUsd: z.number().positive().default(100_000),
  investDefaultUsd: z.number().positive().default(100),
  slippageDefaultPct: z.number().min(0.0001).max(5).default(0.1),
  slippageMinPct: z.number().min(0.0001).max(5).default(0.0001),
  slippageMaxPct: z.number().min(0.0001).max(5).default(5),
  tpDefaultPct: z.number().positive().max(200).nullable().optional(),
  slDefaultPrice: z.number().positive().nullable().optional(),
  // legacy compatibility, derived from marginPolicy
  allowAutoMargin: z.boolean().default(false),
  allowManualMarginAdjust: z.boolean().default(true),
  allowProfitWithdraw: z.boolean().default(true),
  version: z.number().int().min(1).default(1)
});

function validateGridTemplateBounds(value: z.infer<typeof gridTemplateBaseObjectSchema>, ctx: z.RefinementCtx): void {
  if (value.upperPrice <= value.lowerPrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["upperPrice"],
      message: "upperPrice must be greater than lowerPrice"
    });
  }
  if (value.mode === "cross") {
    const crossSideConfig = value.crossSideConfig;
    if (!crossSideConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crossSideConfig"],
        message: "crossSideConfig is required for cross mode"
      });
    } else {
      if (crossSideConfig.long.upperPrice <= crossSideConfig.long.lowerPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["crossSideConfig", "long", "upperPrice"],
          message: "cross long upperPrice must be greater than lowerPrice"
        });
      }
      if (crossSideConfig.short.upperPrice <= crossSideConfig.short.lowerPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["crossSideConfig", "short", "upperPrice"],
          message: "cross short upperPrice must be greater than lowerPrice"
        });
      }
    }
  }
  if (value.leverageDefault < value.leverageMin || value.leverageDefault > value.leverageMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["leverageDefault"],
      message: "leverageDefault must be between leverageMin and leverageMax"
    });
  }
  if (value.investDefaultUsd > value.investMaxUsd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["investDefaultUsd"],
      message: "investDefaultUsd must be less than or equal to investMaxUsd"
    });
  }
  if (value.slippageDefaultPct < value.slippageMinPct || value.slippageDefaultPct > value.slippageMaxPct) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["slippageDefaultPct"],
      message: "slippageDefaultPct must be between slippageMinPct and slippageMaxPct"
    });
  }
  if (value.mode === "cross" && value.budgetSplitPolicy === "FIXED_CUSTOM" && Math.abs((value.longBudgetPct + value.shortBudgetPct) - 100) > 0.000001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["longBudgetPct"],
      message: "longBudgetPct + shortBudgetPct must equal 100 for FIXED_CUSTOM"
    });
  }
  if (value.autoReservePolicy === "FIXED_RATIO") {
    if (!Number.isFinite(Number(value.autoReserveFixedGridPct))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoReserveFixedGridPct"],
        message: "autoReserveFixedGridPct is required when autoReservePolicy is FIXED_RATIO"
      });
    }
  }
  if (value.autoReservePolicy === "LIQ_GUARD_MAX_GRID") {
    if (!Number.isFinite(Number(value.autoReserveMaxPreviewIterations))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoReserveMaxPreviewIterations"],
        message: "autoReserveMaxPreviewIterations is required when autoReservePolicy is LIQ_GUARD_MAX_GRID"
      });
    }
  }
  if (!Number.isFinite(Number(value.activeOrderWindowSize)) || Math.trunc(Number(value.activeOrderWindowSize)) < 40 || Math.trunc(Number(value.activeOrderWindowSize)) > 120) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["activeOrderWindowSize"],
      message: "activeOrderWindowSize must be between 40 and 120"
    });
  }
  if (!Number.isFinite(Number(value.recenterDriftLevels)) || Math.trunc(Number(value.recenterDriftLevels)) < 1 || Math.trunc(Number(value.recenterDriftLevels)) > 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recenterDriftLevels"],
      message: "recenterDriftLevels must be between 1 and 10"
    });
  }
  if (value.marginPolicy === "MANUAL_ONLY") {
    if (value.autoMarginMaxUSDT != null || value.autoMarginTriggerType != null || value.autoMarginTriggerValue != null || value.autoMarginStepUSDT != null || value.autoMarginCooldownSec != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["marginPolicy"],
        message: "auto margin fields must be null when marginPolicy is MANUAL_ONLY"
      });
    }
  } else {
    if (!value.autoMarginTriggerType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginTriggerType"],
        message: "autoMarginTriggerType is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginTriggerValue == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginTriggerValue"],
        message: "autoMarginTriggerValue is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginStepUSDT == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginStepUSDT"],
        message: "autoMarginStepUSDT is required when marginPolicy is AUTO_ALLOWED"
      });
    }
    if (value.autoMarginCooldownSec == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["autoMarginCooldownSec"],
        message: "autoMarginCooldownSec is required when marginPolicy is AUTO_ALLOWED"
      });
    }
  }
}

const gridTemplateCreateSchema = gridTemplateBaseObjectSchema.superRefine(validateGridTemplateBounds);
const gridTemplateUpdateSchema = gridTemplateBaseObjectSchema.partial();

const gridTemplateListQuerySchema = z.object({
  published: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  symbol: z.string().trim().min(1).optional(),
  mode: gridModeSchema.optional(),
  search: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  difficulty: gridCatalogDifficultySchema.optional(),
  risk: gridCatalogRiskLevelSchema.optional(),
  featured: z.coerce.boolean().optional(),
  favoritesOnly: z.coerce.boolean().optional()
});

const gridTemplatePreviewSchema = z.object({
  investUsd: z.number().positive(),
  leverage: z.number().positive(),
  markPrice: z.number().positive(),
  slippagePct: z.number().min(0.0001).max(5).optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  triggerPrice: z.number().positive().nullable().optional(),
  trailingEnabled: z.boolean().optional()
});

const gridInstanceCreateSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  investUsd: z.number().positive(),
  extraMarginUsd: z.number().min(0).default(0),
  triggerPrice: z.number().positive().nullable().optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().default(false),
  name: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

const gridInstancePreviewSchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  investUsd: z.number().positive(),
  extraMarginUsd: z.number().min(0).default(0),
  triggerPrice: z.number().positive().nullable().optional(),
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().default(false),
});

const gridTemplateDraftPreviewSchema = z.object({
  draftTemplate: gridTemplateCreateSchema,
  previewInput: z.object({
    exchangeAccountId: z.string().trim().min(1),
    investUsd: z.number().positive(),
    extraMarginUsd: z.number().min(0).default(0),
    triggerPrice: z.number().positive().nullable().optional(),
    tpPct: z.number().positive().max(200).nullable().optional(),
    slPrice: z.number().positive().nullable().optional(),
    marginMode: gridInstanceMarginModeSchema.optional(),
    autoMarginEnabled: z.boolean().default(false),
    markPriceOverride: z.number().positive().nullable().optional()
  })
});

const gridInstanceListQuerySchema = z.object({
  state: gridStateSchema.optional(),
  exchangeAccountId: z.string().trim().min(1).optional(),
  includeArchived: z.coerce.boolean().optional()
});

const gridInstanceRiskUpdateSchema = z.object({
  tpPct: z.number().positive().max(200).nullable().optional(),
  slPrice: z.number().positive().nullable().optional(),
  marginMode: gridInstanceMarginModeSchema.optional(),
  autoMarginEnabled: z.boolean().optional()
});

const gridMarginAdjustSchema = z.object({
  amountUsd: z.number().positive()
});

const gridWithdrawSchema = z.object({
  amountUsd: z.number().positive()
});

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as any).code ?? "") : "";
  const message = "message" in error ? String((error as any).message ?? "") : String(error);
  if (code === "P2021") return true;
  return /table .* does not exist/i.test(message) || /relation .* does not exist/i.test(message);
}

async function requireGridFeatureEnabledOrRespond(res: express.Response): Promise<boolean> {
  const raw = process.env.FUTURES_GRID_V1;
  const normalized = String(raw ?? "").trim().toLowerCase();
  const enabled = raw == null || raw === "" || !(normalized === "off" || normalized === "disabled");
  if (enabled) return true;
  res.status(404).json({ error: "futures_grid_disabled" });
  return false;
}

async function requireGridCapabilityOrRespond(
  res: express.Response,
  deps: RegisterGridRoutesDeps
): Promise<boolean> {
  if (!deps.resolvePlanCapabilitiesForUserId || !deps.isCapabilityAllowed || !deps.sendCapabilityDenied) {
    return true;
  }
  const user = getUserFromLocals(res);
  if (deps.hasAdminBackendAccess && (await deps.hasAdminBackendAccess(user))) {
    return true;
  }
  const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({
    userId: user.id
  });
  if (deps.isCapabilityAllowed(capabilityContext.capabilities, "product.grid_bots")) {
    return true;
  }
  deps.sendCapabilityDenied(res, {
    capability: "product.grid_bots",
    currentPlan: capabilityContext.plan,
    legacyCode: "grid_not_available"
  });
  return false;
}

function extractRiskErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const rawCode = "code" in error ? String((error as any).code ?? "").trim() : "";
    if (rawCode.startsWith("risk_")) return rawCode;
  }
  const message = error instanceof Error
    ? String(error.message ?? "")
    : String(error ?? "");
  const match = message.match(/risk_[a-z0-9_]+/i);
  if (!match?.[0]) return null;
  return match[0].toLowerCase();
}

function mapRiskErrorToHttp(error: unknown): { status: number; code: string; reason: string } | null {
  const code = extractRiskErrorCode(error);
  if (!code) return null;
  const status = code === "risk_invalid_status_transition" ? 409 : 400;
  return {
    status,
    code,
    reason: error instanceof Error ? String(error.message ?? code) : code
  };
}

function normalizeTemplateSymbol(value: string): string {
  return normalizeSymbolInput(value) || String(value ?? "").trim().toUpperCase();
}

function toTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toNullableString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function parseAdminBackendAccessSetting(value: unknown): { userIds: string[] } {
  const record = asRecord(value);
  const raw = Array.isArray(record.userIds) ? record.userIds : [];
  return {
    userIds: Array.from(
      new Set(
        raw
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      )
    )
  };
}

async function isAdminGridViewer(db: any, user: { id: string; email: string }): Promise<boolean> {
  const superadminEmail = String(process.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  if (superadminEmail && user.email.trim().toLowerCase() === superadminEmail) return true;
  const row = await db?.globalSetting?.findUnique?.({
    where: { key: "admin.backendAccess" },
    select: { value: true }
  });
  const access = parseAdminBackendAccessSetting(row?.value);
  return access.userIds.includes(String(user.id));
}

function isDirectHyperliquidExchange(exchange: unknown): boolean {
  return normalizeGridExchange(exchange) === "hyperliquid";
}

function sendGridHyperliquidPilotRequired(
  res: express.Response,
  pilotAccess: { allowed: boolean; reason: string; scope: string },
  exchangeAccountId: string,
  marketDataVenue: string
) {
  return res.status(403).json({
    error: "grid_hyperliquid_pilot_required",
    reason: pilotAccess.reason,
    scope: pilotAccess.scope,
    allowed: false,
    exchangeAccountId,
    marketDataVenue
  });
}

async function resolveGridHyperliquidAccountUsage(params: {
  deps: RegisterGridRoutesDeps;
  userId: string;
  exchangeAccount: { id: string; exchange: string };
  symbol: string;
}): Promise<{ usesHyperliquid: boolean; marketDataVenue: string | null }> {
  if (isDirectHyperliquidExchange(params.exchangeAccount.exchange)) {
    return { usesHyperliquid: true, marketDataVenue: "hyperliquid" };
  }
  if (normalizeGridExchange(params.exchangeAccount.exchange) !== "paper") {
    return { usesHyperliquid: false, marketDataVenue: normalizeGridExchange(params.exchangeAccount.exchange) || null };
  }
  try {
    const venueContext = await params.deps.resolveVenueContext({
      userId: params.userId,
      exchangeAccountId: params.exchangeAccount.id,
      symbol: params.symbol
    });
    const marketDataVenue = normalizeGridExchange(venueContext.marketDataVenue);
    return {
      usesHyperliquid: marketDataVenue === "hyperliquid",
      marketDataVenue: marketDataVenue || null
    };
  } catch {
    return { usesHyperliquid: false, marketDataVenue: null };
  }
}

function mergeExecutionStateIntoBotVault(
  botVault: Record<string, unknown> | null,
  executionState: Record<string, unknown> | null,
  includeProviderMetadataRaw: boolean
): Record<string, unknown> | null {
  if (!botVault) return null;
  if (!executionState) return botVault;
  const providerMetadataRaw = extractBotVaultProviderMetadataRaw(asRecord(executionState).providerMetadata);
  const currentSummary = asRecord(botVault.providerMetadataSummary);
  const incomingSummary = asRecord(summarizeBotVaultProviderMetadata(providerMetadataRaw));
  const mergeNullableStringField = (field: string): string | null =>
    toNullableString(incomingSummary[field]) ?? toNullableString(currentSummary[field]) ?? null;
  const mergedProviderMetadataSummary = {
    providerMode: mergeNullableStringField("providerMode"),
    chain: mergeNullableStringField("chain"),
    marketDataExchange: mergeNullableStringField("marketDataExchange"),
    vaultAddress: mergeNullableStringField("vaultAddress"),
    agentWallet: mergeNullableStringField("agentWallet"),
    subaccountAddress: mergeNullableStringField("subaccountAddress"),
    lastAction: mergeNullableStringField("lastAction"),
    providerSelectionReason: mergeNullableStringField("providerSelectionReason"),
    pilotScope: mergeNullableStringField("pilotScope")
  };
  return {
    ...botVault,
    executionStatus: toNullableString(executionState.status) ?? botVault.executionStatus ?? null,
    executionLastSyncedAt: toNullableString(executionState.observedAt) ?? botVault.executionLastSyncedAt ?? null,
    providerMetadataSummary: Object.values(mergedProviderMetadataSummary).some((value) => value !== null)
      ? mergedProviderMetadataSummary
      : null,
    providerMetadataRaw: includeProviderMetadataRaw ? (providerMetadataRaw ?? botVault.providerMetadataRaw ?? null) : null
  };
}

function deriveHasOnchainBotVault(botVault: Record<string, unknown> | null): boolean {
  if (!botVault) return false;
  if (toNullableString(botVault.onchainVaultAddress)) {
    return true;
  }
  const lifecycle = asRecord(botVault.lifecycle);
  const lifecycleState = String(lifecycle.state ?? "").trim().toLowerCase();
  if (lifecycleState === "close_only" || lifecycleState === "closed" || lifecycleState === "settling") {
    return true;
  }
  const executionStatus = String(botVault.executionStatus ?? "").trim().toLowerCase();
  if (executionStatus === "close_only" || executionStatus === "closed") {
    return true;
  }
  return false;
}

function buildGridPilotStatus(params: {
  botVault: Record<string, unknown> | null;
  currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
}): Record<string, unknown> | null {
  const botVault = params.botVault ? asRecord(params.botVault) : null;
  const provider = toNullableString(botVault?.executionProvider);
  const executionLastErrorAt = toNullableString(botVault?.executionLastErrorAt);
  const summary = asRecord(botVault?.providerMetadataSummary);
  const providerSelectionReason = toNullableString(summary.providerSelectionReason);
  const pilotScope = toNullableString(summary.pilotScope) ?? params.currentPilotAccess?.scope ?? "none";
  const isDemoProvider = provider === "hyperliquid_demo";
  const isLiveProvider = provider === "hyperliquid";
  const allowState = isLiveProvider || isDemoProvider || Boolean(params.currentPilotAccess?.allowed);
  if (!provider && !params.currentPilotAccess && !isDemoProvider && !isLiveProvider) return null;
  return {
    allowed: allowState,
    reason: allowState
      ? (
          isLiveProvider
            ? "live_provider"
            : (params.currentPilotAccess?.reason ?? (isDemoProvider ? "allowlist" : "not_listed"))
        )
      : (params.currentPilotAccess?.reason ?? "not_listed"),
    provider,
    providerSelectionReason,
    scope: pilotScope,
    lastBlockAt: null,
    lastSyncErrorAt: executionLastErrorAt
  };
}

async function getGridHyperliquidExecutionContext(db: any): Promise<{
  provider: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid: boolean;
}> {
  const provider = await getEffectiveVaultExecutionProvider(db).catch(
    () => "mock" as "mock" | "hyperliquid_demo" | "hyperliquid"
  );
  return {
    provider: provider as "mock" | "hyperliquid_demo" | "hyperliquid",
    allowLiveHyperliquid: provider === "hyperliquid"
  };
}

function resolvePositiveMarkPrice(params: {
  override?: number | null;
  venueMarkPrice?: number | null;
  lowerPrice: number;
  upperPrice: number;
}): number {
  const override = Number(params.override);
  if (Number.isFinite(override) && override > 0) return override;
  const venueMarkPrice = Number(params.venueMarkPrice);
  if (Number.isFinite(venueMarkPrice) && venueMarkPrice > 0) return venueMarkPrice;
  const lower = Number(params.lowerPrice);
  const upper = Number(params.upperPrice);
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower > 0 && upper > lower) {
    return (lower + upper) / 2;
  }
  if (Number.isFinite(lower) && lower > 0) return lower;
  if (Number.isFinite(upper) && upper > 0) return upper;
  return 1;
}

function isTemplatePolicyImplemented(template: {
  allocationMode?: string | null;
  budgetSplitPolicy?: string | null;
}): boolean {
  const allocationMode = String(template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(template.budgetSplitPolicy ?? "FIXED_50_50");
  if (allocationMode === "WEIGHTED_NEAR_PRICE") return false;
  if (budgetSplitPolicy === "DYNAMIC_BY_PRICE_POSITION") return false;
  return true;
}

function normalizeTemplatePolicyInput(input: Record<string, unknown>): Record<string, unknown> {
  const marginPolicyRaw = String(input.marginPolicy ?? "").trim();
  const allowAutoMarginRaw = Boolean(input.allowAutoMargin);
  const marginPolicy = marginPolicyRaw === "AUTO_ALLOWED" || marginPolicyRaw === "MANUAL_ONLY"
    ? marginPolicyRaw
    : (allowAutoMarginRaw ? "AUTO_ALLOWED" : "MANUAL_ONLY");
  const allowAutoMargin = marginPolicy === "AUTO_ALLOWED";

  const normalizedBase: Record<string, unknown> = {
    ...input,
    marginPolicy,
    allowAutoMargin,
    catalogCategory: normalizeCatalogString(input.catalogCategory, 80),
    catalogTags: normalizeCatalogTags(input.catalogTags),
    catalogDifficulty: coerceCatalogDifficulty(input.catalogDifficulty),
    catalogRiskLevel: coerceCatalogRiskLevel(input.catalogRiskLevel),
    catalogImageUrl: normalizeCatalogString(input.catalogImageUrl, 2048),
    catalogShortDescription: normalizeCatalogString(input.catalogShortDescription, 280),
    catalogSortOrder: Number.isFinite(Number(input.catalogSortOrder))
      ? Math.trunc(Number(input.catalogSortOrder))
      : 0,
    catalogFeatured: Boolean(input.catalogFeatured),
    allocationMode: String(input.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID"),
    budgetSplitPolicy: String(input.budgetSplitPolicy ?? "FIXED_50_50"),
    longBudgetPct: Number.isFinite(Number(input.longBudgetPct)) ? Number(input.longBudgetPct) : 50,
    shortBudgetPct: Number.isFinite(Number(input.shortBudgetPct)) ? Number(input.shortBudgetPct) : 50,
    autoReservePolicy: String(input.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"),
    autoReserveFixedGridPct: Number.isFinite(Number(input.autoReserveFixedGridPct)) ? Number(input.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(input.autoReserveTargetLiqDistancePct))
      ? Number(input.autoReserveTargetLiqDistancePct)
      : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(input.autoReserveMaxPreviewIterations))
      ? Math.trunc(Number(input.autoReserveMaxPreviewIterations))
      : 8,
    initialSeedEnabled: typeof input.initialSeedEnabled === "boolean"
      ? input.initialSeedEnabled
      : true,
    initialSeedPct: Number.isFinite(Number(input.initialSeedPct))
      ? Math.max(0, Math.min(60, Number(input.initialSeedPct)))
      : 30,
    activeOrderWindowSize: Number.isFinite(Number(input.activeOrderWindowSize))
      ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize))))
      : 100,
    recenterDriftLevels: Number.isFinite(Number(input.recenterDriftLevels))
      ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels))))
      : 1,
  };
  const normalized = applyCrossSideConfigToTemplateRecord(normalizedBase);

  if (!allowAutoMargin) {
    normalized.autoMarginMaxUSDT = null;
    normalized.autoMarginTriggerType = null;
    normalized.autoMarginTriggerValue = null;
    normalized.autoMarginStepUSDT = null;
    normalized.autoMarginCooldownSec = null;
  } else {
    if (!Number.isFinite(Number(normalized.autoMarginMaxUSDT))) normalized.autoMarginMaxUSDT = 0;
    if (!normalized.autoMarginTriggerType) normalized.autoMarginTriggerType = "LIQ_DISTANCE_PCT_BELOW";
    if (!Number.isFinite(Number(normalized.autoMarginTriggerValue))) normalized.autoMarginTriggerValue = 3;
    if (!Number.isFinite(Number(normalized.autoMarginStepUSDT))) normalized.autoMarginStepUSDT = 25;
    if (!Number.isFinite(Number(normalized.autoMarginCooldownSec))) normalized.autoMarginCooldownSec = 300;
  }

  return normalized;
}

function mapDraftTemplateToPreviewContext(
  input: z.infer<typeof gridTemplateCreateSchema>
): z.infer<typeof gridTemplateCreateSchema> {
  const normalized = normalizeTemplatePolicyInput({
    ...input,
    symbol: normalizeTemplateSymbol(input.symbol)
  });
  const parsed = gridTemplateCreateSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`draft_template_invalid:${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }
  return parsed.data;
}

type GridPreviewComputationInput = {
  userId: string;
  exchangeAccountId: string;
  template: any;
  autoReservePolicy?: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
  autoReserveFixedGridPct?: number | null;
  autoReserveTargetLiqDistancePct?: number | null;
  autoReserveMaxPreviewIterations?: number | null;
  activeOrderWindowSize?: number | null;
  recenterDriftLevels?: number | null;
  investUsd: number;
  extraMarginUsd: number;
  autoMarginEnabled: boolean;
  tpPct: number | null;
  slPrice: number | null;
  triggerPrice: number | null;
  markPriceOverride?: number | null;
  leverage: number;
  slippagePct: number;
  resolveVenueContext: RegisterGridRoutesDeps["resolveVenueContext"];
};

type GridPreviewComputationOutput = {
  markPrice: number;
  minInvestmentUSDT: number;
  preview: Awaited<ReturnType<typeof requestGridPreview>>;
  warnings: string[];
  minInvestmentBreakdown: {
    long: number;
    short: number;
    seed: number;
    total: number;
  };
  initialSeed: {
    enabled: boolean;
    seedPct: number;
    seedSide: "buy" | "sell" | null;
    seedQty: number;
    seedNotionalUsd: number;
    seedMarginUsd: number;
    seedMinMarginUsd: number;
  };
  allocation: {
    totalBudgetUsd: number;
    gridInvestUsd: number;
    extraMarginUsd: number;
    splitMode: "manual" | "auto_fixed_ratio" | "auto_liq_guard_dynamic";
    policy: "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID" | null;
    targetLiqDistancePct: number | null;
    searchIterationsUsed: number;
    insufficient: boolean;
    reasonCodes: string[];
  };
  venueContext: Awaited<ReturnType<RegisterGridRoutesDeps["resolveVenueContext"]>>;
};

async function computeGridPreviewAndAllocation(
  input: GridPreviewComputationInput
): Promise<GridPreviewComputationOutput> {
  const template = applyCrossSideConfigToTemplateRecord(asRecord(input.template));
  const allocationMode = String(template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID");
  const budgetSplitPolicy = String(template.budgetSplitPolicy ?? "FIXED_50_50");
  const longBudgetPct = Number.isFinite(Number(template.longBudgetPct)) ? Number(template.longBudgetPct) : 50;
  const shortBudgetPct = Number.isFinite(Number(template.shortBudgetPct)) ? Number(template.shortBudgetPct) : 50;
  const autoReservePolicy = (String(
    input.autoReservePolicy ?? template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID"
  ) === "FIXED_RATIO" ? "FIXED_RATIO" : "LIQ_GUARD_MAX_GRID") as "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
  const autoReserveFixedGridPct = Number.isFinite(Number(input.autoReserveFixedGridPct ?? template.autoReserveFixedGridPct))
    ? Number(input.autoReserveFixedGridPct ?? template.autoReserveFixedGridPct)
    : 70;
  const autoReserveMaxPreviewIterations = Number.isFinite(Number(input.autoReserveMaxPreviewIterations ?? template.autoReserveMaxPreviewIterations))
    ? Math.max(1, Math.min(16, Math.trunc(Number(input.autoReserveMaxPreviewIterations ?? template.autoReserveMaxPreviewIterations))))
    : 8;
  const initialSeedEnabled = typeof (template.initialSeedEnabled) === "boolean"
    ? Boolean(template.initialSeedEnabled)
    : true;
  const initialSeedPct = Number.isFinite(Number(template.initialSeedPct))
    ? Math.max(0, Math.min(60, Number(template.initialSeedPct)))
    : 30;
  const activeOrderWindowSize = Number.isFinite(Number(input.activeOrderWindowSize ?? template.activeOrderWindowSize))
    ? Math.max(40, Math.min(120, Math.trunc(Number(input.activeOrderWindowSize ?? template.activeOrderWindowSize))))
    : 100;
  const recenterDriftLevels = Number.isFinite(Number(input.recenterDriftLevels ?? template.recenterDriftLevels))
    ? Math.max(1, Math.min(10, Math.trunc(Number(input.recenterDriftLevels ?? template.recenterDriftLevels))))
    : 1;

  const venueContext = await input.resolveVenueContext({
    userId: input.userId,
    exchangeAccountId: input.exchangeAccountId,
    symbol: String(template.symbol ?? "")
  });
  const effectiveMarkPrice = resolvePositiveMarkPrice({
    override: input.markPriceOverride,
    venueMarkPrice: Number(venueContext.markPrice),
    lowerPrice: Number(template.lowerPrice),
    upperPrice: Number(template.upperPrice)
  });

  const totalBudgetUsd = input.autoMarginEnabled
    ? toTwoDecimals(input.investUsd)
    : toTwoDecimals(input.investUsd + input.extraMarginUsd);
  const targetLiqDistancePct = Number.isFinite(Number(input.autoReserveTargetLiqDistancePct ?? template.autoReserveTargetLiqDistancePct))
    ? Number(input.autoReserveTargetLiqDistancePct ?? template.autoReserveTargetLiqDistancePct)
    : Number(venueContext.liqDistanceMinPct);

  const runPreview = (gridInvestUsd: number, extraMarginUsd: number) =>
    requestGridPreview({
      mode: String(template.mode) as "long" | "short" | "neutral" | "cross",
      gridMode: String(template.gridMode) as "arithmetic" | "geometric",
      lowerPrice: Number(template.lowerPrice),
      upperPrice: Number(template.upperPrice),
      gridCount: Math.trunc(Number(template.gridCount)),
      crossSideConfig: template.crossSideConfig as GridCrossSideConfig | null | undefined,
      activeOrderWindowSize,
      recenterDriftLevels,
      investUsd: gridInvestUsd,
      leverage: input.leverage,
      markPrice: effectiveMarkPrice,
      slippagePct: input.slippagePct,
      tpPct: input.tpPct,
      slPrice: input.slPrice,
      triggerPrice: input.triggerPrice,
      trailingEnabled: false,
      allocationMode,
      budgetSplitPolicy,
      longBudgetPct,
      shortBudgetPct,
      venueConstraints: venueContext.venueConstraints,
      feeBufferPct: venueContext.feeBufferPct,
      mmrPct: venueContext.mmrPct,
      extraMarginUsd,
      initialSeedEnabled,
      initialSeedPct
    });

  const firstPassPreview = await runPreview(
    input.autoMarginEnabled ? totalBudgetUsd : input.investUsd,
    input.autoMarginEnabled ? 0 : input.extraMarginUsd
  );

  const minInvestmentUSDT = Number(firstPassPreview.minInvestmentUSDT ?? 0);
  let allocation: GridPreviewComputationOutput["allocation"] = {
    totalBudgetUsd,
    gridInvestUsd: toTwoDecimals(input.investUsd),
    extraMarginUsd: toTwoDecimals(input.extraMarginUsd),
    splitMode: "manual",
    policy: null,
    targetLiqDistancePct: null,
    searchIterationsUsed: 0,
    insufficient: false,
    reasonCodes: []
  };

  if (input.autoMarginEnabled) {
    if (autoReservePolicy === "FIXED_RATIO") {
      const split = computeAutoMarginAllocation({
        totalBudgetUsd,
        minInvestmentUSDT,
        ratioGrid: autoReserveFixedGridPct / 100
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_fixed_ratio",
        policy: "FIXED_RATIO",
        targetLiqDistancePct: null,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    } else {
      const split = await computeAutoReserveAllocationDynamic({
        totalBudgetUsd,
        minInvestmentUSDT,
        targetLiqDistancePct,
        maxIterations: autoReserveMaxPreviewIterations,
        evaluateGridInvestment: async (gridInvestUsd) => {
          const preview = await runPreview(gridInvestUsd, toTwoDecimals(totalBudgetUsd - gridInvestUsd));
          return {
            worstCaseLiqDistancePct: preview.worstCaseLiqDistancePct
          };
        }
      });
      allocation = {
        totalBudgetUsd,
        gridInvestUsd: split.gridInvestUsd,
        extraMarginUsd: split.extraMarginUsd,
        splitMode: "auto_liq_guard_dynamic",
        policy: "LIQ_GUARD_MAX_GRID",
        targetLiqDistancePct: split.targetLiqDistancePct,
        searchIterationsUsed: split.searchIterationsUsed,
        insufficient: split.insufficient,
        reasonCodes: split.reasonCodes
      };
    }
  }

  const finalPreview = await runPreview(
    allocation.gridInvestUsd,
    allocation.extraMarginUsd
  );

  return {
    markPrice: effectiveMarkPrice,
    minInvestmentUSDT,
    preview: finalPreview,
    warnings: [...(finalPreview.warnings ?? []), ...(venueContext.warnings ?? [])],
    minInvestmentBreakdown: {
      long: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.long)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.long) : 0,
      short: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.short)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.short) : 0,
      seed: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.seed)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.seed) : 0,
      total: Number.isFinite(Number((finalPreview as any)?.minInvestmentBreakdown?.total)) ? Number((finalPreview as any)?.minInvestmentBreakdown?.total) : minInvestmentUSDT
    },
    initialSeed: {
      enabled: Boolean((finalPreview as any)?.initialSeed?.enabled),
      seedPct: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedPct)) ? Number((finalPreview as any)?.initialSeed?.seedPct) : 0,
      seedSide: (String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "sell"
        ? "sell"
        : String((finalPreview as any)?.initialSeed?.seedSide ?? "").trim().toLowerCase() === "buy"
          ? "buy"
          : null) as "buy" | "sell" | null,
      seedQty: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedQty)) ? Number((finalPreview as any)?.initialSeed?.seedQty) : 0,
      seedNotionalUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedNotionalUsd)) ? Number((finalPreview as any)?.initialSeed?.seedNotionalUsd) : 0,
      seedMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMarginUsd) : 0,
      seedMinMarginUsd: Number.isFinite(Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd)) ? Number((finalPreview as any)?.initialSeed?.seedMinMarginUsd) : 0,
    },
    allocation,
    venueContext
  };
}

type RegisterGridRoutesDeps = {
  db: any;
  requireSuperadmin: (res: express.Response) => Promise<boolean>;
  hasAdminBackendAccess?: (user: { id: string; email: string }) => Promise<boolean>;
  resolvePlanCapabilitiesForUserId?: (input: {
    userId: string;
  }) => Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  isCapabilityAllowed?: (capabilities: PlanCapabilities, capability: CapabilityKey) => boolean;
  sendCapabilityDenied?: (
    res: express.Response,
    params: {
      capability: CapabilityKey;
      currentPlan: PlanTier;
      legacyCode?: string;
    }
  ) => express.Response;
  enqueueBotRun: (botId: string) => Promise<void>;
  cancelBotRun: (botId: string) => Promise<void>;
  vaultService: VaultService;
  onchainActionService?: OnchainActionService | null;
  executionOrchestrator?: ExecutionProviderOrchestrator | null;
  resolveVenueContext: (params: {
    userId: string;
    exchangeAccountId: string;
    symbol: string;
  }) => Promise<{
    markPrice: number;
    marketDataVenue: string;
    venueConstraints: {
      minQty: number | null;
      qtyStep: number | null;
      priceTick: number | null;
      minNotional: number | null;
      feeRate: number | null;
    };
    feeBufferPct: number;
    mmrPct: number;
    liqDistanceMinPct: number;
    warnings: string[];
  }>;
};

function buildGridProvisioningStatus(row: any) {
  const state = String(row?.state ?? "").trim().toLowerCase();
  const lifecycleState = String(row?.botVault?.lifecycle?.state ?? "").trim().toLowerCase();
  const pendingActionType = String(row?.botVault?.lifecycle?.pendingActionType ?? "").trim().toLowerCase();
  const pendingActionStatus = String(row?.botVault?.lifecycle?.pendingActionStatus ?? "").trim().toLowerCase();
  const provisioning = row?.stateJson && typeof row.stateJson === "object" && !Array.isArray(row.stateJson)
    ? (row.stateJson as Record<string, unknown>).provisioning
    : null;
  const provisioningRecord = provisioning && typeof provisioning === "object" && !Array.isArray(provisioning)
    ? provisioning as Record<string, unknown>
    : null;

  const phase = (() => {
    if (state === "running" || lifecycleState === "execution_active") return null;
    if (pendingActionType === "create_bot_vault" && pendingActionStatus === "submitted") return "submitted_waiting_indexer";
    if (pendingActionType === "create_bot_vault" && pendingActionStatus === "prepared") return "pending_signature";
    if (pendingActionType === "reserve_for_bot_vault" && pendingActionStatus === "submitted") return "submitted_waiting_reserve_indexer";
    if (pendingActionType === "reserve_for_bot_vault" && pendingActionStatus === "prepared") return "pending_reserve_signature";
    if (pendingActionType === "fund_bot_vault_hypercore" && pendingActionStatus === "submitted") return "submitted_waiting_hypercore_funding_indexer";
    if (pendingActionType === "fund_bot_vault_hypercore" && pendingActionStatus === "prepared") return "pending_hypercore_funding_signature";
    const recordPhase = String(provisioningRecord?.phase ?? "").trim();
    return recordPhase || null;
  })();

  if (!phase) return null;
  return {
    phase,
    reason: typeof provisioningRecord?.reason === "string" ? provisioningRecord.reason : null,
    pendingActionId: typeof provisioningRecord?.pendingActionId === "string" ? provisioningRecord.pendingActionId : null,
    walletSignatureRequired:
      phase === "pending_signature"
      || phase === "pending_reserve_signature"
      || phase === "pending_hypercore_funding_signature"
  };
}

async function loadGridInstanceForUser(params: {
  db: any;
  userId: string;
  instanceId: string;
}) {
  const row = await params.db.gridBotInstance.findFirst({
    where: {
      id: params.instanceId,
      userId: params.userId
    },
    include: {
      template: true,
      bot: {
        include: {
          futuresConfig: true,
          runtime: {
            select: {
              mid: true,
              bid: true,
              ask: true,
              updatedAt: true,
              status: true,
              reason: true,
              lastError: true
            }
          },
          exchangeAccount: {
            select: {
              id: true,
              exchange: true,
              label: true
            }
          }
        }
      }
    }
  });
  if (!row) return row;
  const vaultByInstanceId = await loadBotVaultByInstanceIds(params.db, [row.id]);
  return {
    ...row,
    botVault: vaultByInstanceId.get(row.id) ?? null
  };
}

async function loadBotVaultByInstanceIds(db: any, instanceIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!instanceIds.length) return map;
  const botVaultModel = db?.botVault;
  if (!botVaultModel || typeof botVaultModel.findMany !== "function") return map;
  try {
    const rows = await botVaultModel.findMany({
      where: {
        gridInstanceId: {
          in: instanceIds
        }
      },
      include: {
        onchainActions: {
          where: {
            status: { in: ["prepared", "submitted"] }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 1
        }
      }
    });
    for (const row of rows) {
      const key = String(row?.gridInstanceId ?? "");
      if (!key) continue;
      map.set(key, row);
    }
  } catch {
    // Optional compatibility fallback: older Prisma clients may not expose BotVault yet.
  }
  return map;
}

function mapGridTemplateRow(row: any) {
  const normalizedRow = applyCrossSideConfigToTemplateRecord(asRecord(row));
  const catalogTags = normalizeCatalogTags(row?.catalogTags);
  const favoriteRows = Array.isArray(row?.favorites)
    ? row.favorites
    : Array.isArray(row?.gridTemplateFavorites)
      ? row.gridTemplateFavorites
      : [];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? null,
    catalogCategory: normalizeCatalogString(row.catalogCategory, 80),
    catalogTags,
    catalogDifficulty: coerceCatalogDifficulty(row.catalogDifficulty),
    catalogRiskLevel: coerceCatalogRiskLevel(row.catalogRiskLevel),
    catalogImageUrl: normalizeCatalogString(row.catalogImageUrl, 2048),
    catalogShortDescription: normalizeCatalogString(row.catalogShortDescription, 280),
    catalogSortOrder: Number.isFinite(Number(row.catalogSortOrder)) ? Math.trunc(Number(row.catalogSortOrder)) : 0,
    catalogFeatured: Boolean(row.catalogFeatured),
    isFavorite: typeof row?.isFavorite === "boolean" ? row.isFavorite : favoriteRows.length > 0,
    symbol: row.symbol,
    marketType: row.marketType,
    mode: row.mode,
    gridMode: row.gridMode,
    allocationMode: row.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : 50,
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : 50,
    marginPolicy: row.marginPolicy ?? (row.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean" ? row.initialSeedEnabled : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct)) ? Number(row.initialSeedPct) : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize)) ? Math.trunc(Number(row.activeOrderWindowSize)) : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels)) ? Math.trunc(Number(row.recenterDriftLevels)) : 1,
    lowerPrice: Number(normalizedRow.lowerPrice),
    upperPrice: Number(normalizedRow.upperPrice),
    gridCount: Math.trunc(Number(normalizedRow.gridCount)),
    crossSideConfig: normalizedRow.crossSideConfig ?? null,
    leverageMin: row.leverageMin,
    leverageMax: row.leverageMax,
    leverageDefault: row.leverageDefault,
    investMaxUsd: row.investMaxUsd,
    investDefaultUsd: row.investDefaultUsd,
    slippageDefaultPct: row.slippageDefaultPct,
    slippageMinPct: row.slippageMinPct,
    slippageMaxPct: row.slippageMaxPct,
    tpDefaultPct: row.tpDefaultPct ?? null,
    slDefaultPrice: row.slDefaultPrice ?? null,
    allowAutoMargin: row.allowAutoMargin,
    allowManualMarginAdjust: row.allowManualMarginAdjust,
    allowProfitWithdraw: row.allowProfitWithdraw,
    isPublished: row.isPublished,
    isArchived: row.isArchived,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapGridInstanceRow(
  row: any,
  options?: {
    includeProviderMetadataRaw?: boolean;
    currentPilotAccess?: { allowed: boolean; reason: string; scope: string } | null;
  }
) {
  const botVault = row.botVault
    ? mapBotVaultSnapshot(row.botVault, { includeProviderMetadataRaw: options?.includeProviderMetadataRaw })
    : null;
  const hasOnchainBotVault = deriveHasOnchainBotVault(
    botVault ? (botVault as Record<string, unknown>) : null
  );
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    exchangeAccountId: row.exchangeAccountId,
    templateId: row.templateId,
    botId: row.botId,
    state: row.state,
    isArchived: String(row.state ?? "").trim().toLowerCase() === "archived",
    archivedAt: row.archivedAt ?? null,
    archivedReason: row.archivedReason ?? null,
    restartable: String(row.state ?? "").trim().toLowerCase() !== "archived",
    allocationMode: row.allocationMode ?? row.template?.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: row.budgetSplitPolicy ?? row.template?.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: Number.isFinite(Number(row.longBudgetPct)) ? Number(row.longBudgetPct) : Number(row.template?.longBudgetPct ?? 50),
    shortBudgetPct: Number.isFinite(Number(row.shortBudgetPct)) ? Number(row.shortBudgetPct) : Number(row.template?.shortBudgetPct ?? 50),
    marginPolicy: row.marginPolicy ?? row.template?.marginPolicy ?? (row.template?.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    marginMode: row.marginMode ?? (row.autoMarginEnabled ? "AUTO" : "MANUAL"),
    autoMarginMaxUSDT: Number.isFinite(Number(row.autoMarginMaxUSDT)) ? Number(row.autoMarginMaxUSDT) : Number.isFinite(Number(row.template?.autoMarginMaxUSDT)) ? Number(row.template?.autoMarginMaxUSDT) : null,
    autoMarginTriggerType: row.autoMarginTriggerType ?? row.template?.autoMarginTriggerType ?? null,
    autoMarginTriggerValue: Number.isFinite(Number(row.autoMarginTriggerValue)) ? Number(row.autoMarginTriggerValue) : Number.isFinite(Number(row.template?.autoMarginTriggerValue)) ? Number(row.template?.autoMarginTriggerValue) : null,
    autoMarginStepUSDT: Number.isFinite(Number(row.autoMarginStepUSDT)) ? Number(row.autoMarginStepUSDT) : Number.isFinite(Number(row.template?.autoMarginStepUSDT)) ? Number(row.template?.autoMarginStepUSDT) : null,
    autoMarginCooldownSec: Number.isFinite(Number(row.autoMarginCooldownSec)) ? Number(row.autoMarginCooldownSec) : Number.isFinite(Number(row.template?.autoMarginCooldownSec)) ? Number(row.template?.autoMarginCooldownSec) : null,
    autoReservePolicy: row.autoReservePolicy ?? row.template?.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: Number.isFinite(Number(row.autoReserveFixedGridPct)) ? Number(row.autoReserveFixedGridPct) : Number.isFinite(Number(row.template?.autoReserveFixedGridPct)) ? Number(row.template?.autoReserveFixedGridPct) : 70,
    autoReserveTargetLiqDistancePct: Number.isFinite(Number(row.autoReserveTargetLiqDistancePct)) ? Number(row.autoReserveTargetLiqDistancePct) : Number.isFinite(Number(row.template?.autoReserveTargetLiqDistancePct)) ? Number(row.template?.autoReserveTargetLiqDistancePct) : null,
    autoReserveMaxPreviewIterations: Number.isFinite(Number(row.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.autoReserveMaxPreviewIterations)) : Number.isFinite(Number(row.template?.autoReserveMaxPreviewIterations)) ? Math.trunc(Number(row.template?.autoReserveMaxPreviewIterations)) : 8,
    initialSeedEnabled: typeof row.initialSeedEnabled === "boolean"
      ? row.initialSeedEnabled
      : typeof row.template?.initialSeedEnabled === "boolean"
        ? row.template.initialSeedEnabled
        : true,
    initialSeedPct: Number.isFinite(Number(row.initialSeedPct))
      ? Number(row.initialSeedPct)
      : Number.isFinite(Number(row.template?.initialSeedPct))
        ? Number(row.template.initialSeedPct)
        : 30,
    activeOrderWindowSize: Number.isFinite(Number(row.activeOrderWindowSize))
      ? Math.trunc(Number(row.activeOrderWindowSize))
      : Number.isFinite(Number(row.template?.activeOrderWindowSize))
        ? Math.trunc(Number(row.template?.activeOrderWindowSize))
        : 100,
    recenterDriftLevels: Number.isFinite(Number(row.recenterDriftLevels))
      ? Math.trunc(Number(row.recenterDriftLevels))
      : Number.isFinite(Number(row.template?.recenterDriftLevels))
        ? Math.trunc(Number(row.template?.recenterDriftLevels))
        : 1,
    autoMarginUsedUSDT: Number.isFinite(Number(row.autoMarginUsedUSDT)) ? Number(row.autoMarginUsedUSDT) : 0,
    lastAutoMarginAt: row.lastAutoMarginAt ?? null,
    investUsd: row.investUsd,
    leverage: row.leverage,
    extraMarginUsd: row.extraMarginUsd,
    triggerPrice: row.triggerPrice ?? null,
    slippagePct: row.slippagePct,
    tpPct: row.tpPct ?? null,
    slPrice: row.slPrice ?? null,
    autoMarginEnabled: row.autoMarginEnabled,
    stateJson: row.stateJson ?? {},
    metricsJson: row.metricsJson ?? {},
    lastPlanAt: row.lastPlanAt ?? null,
    lastPlanError: row.lastPlanError ?? null,
    lastPlanVersion: row.lastPlanVersion ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    botVault,
    hasOnchainBotVault,
    provisioningStatus: buildGridProvisioningStatus(row),
    pilotStatus: buildGridPilotStatus({
      botVault: botVault ? (botVault as Record<string, unknown>) : null,
      currentPilotAccess: options?.currentPilotAccess ?? null
    }),
    template: row.template ? mapGridTemplateRow(row.template) : null,
    bot: row.bot
      ? {
          id: row.bot.id,
          name: row.bot.name,
          symbol: row.bot.symbol,
          status: row.bot.status,
          exchange: row.bot.exchange,
          exchangeAccount: row.bot.exchangeAccount
            ? {
                id: row.bot.exchangeAccount.id,
                exchange: row.bot.exchangeAccount.exchange,
                label: row.bot.exchangeAccount.label
              }
            : null
        }
      : null
  };
}
export function registerGridRoutes(app: Express, deps: RegisterGridRoutesDeps) {
  const allowedGridExchanges = readAllowedGridExchanges();
  const gridLifecycle = createGridLifecycleService({
    db: deps.db,
    vaultService: deps.vaultService,
    resolveVenueContext: deps.resolveVenueContext,
    allowedGridExchanges
  });

  function isAdminGridDraftPreviewExchangeAllowed(exchange: unknown): boolean {
    const normalized = normalizeGridExchange(exchange);
    return allowedGridExchanges.has(normalized) || normalized === "hyperliquid";
  }

  const shared = {
    allowedGridExchanges,
    buildGridPilotStatus,
    ensureGridExchangeAllowed,
    getGridHyperliquidExecutionContext,
    gridInstanceCreateSchema,
    gridInstanceListQuerySchema,
    gridInstancePreviewSchema,
    gridInstanceRiskUpdateSchema,
    gridMarginAdjustSchema,
    gridTemplateCreateSchema,
    gridTemplateDraftPreviewSchema,
    gridTemplateListQuerySchema,
    gridTemplatePreviewSchema,
    gridTemplateUpdateSchema,
    gridWithdrawSchema,
    isAdminGridDraftPreviewExchangeAllowed,
    isAdminGridViewer,
    isMissingTableError,
    isTemplatePolicyImplemented,
    mapDraftTemplateToPreviewContext,
    deriveHasOnchainBotVault,
    mapGridInstanceRow,
    mapGridTemplateRow,
    mapRiskErrorToHttp,
    mergeExecutionStateIntoBotVault,
    normalizeGridExchange,
    normalizeTemplatePolicyInput,
    normalizeTemplateSymbol,
    toGridTemplatePersistence,
    requireGridCapabilityOrRespond,
    requireGridFeatureEnabledOrRespond,
    resolveGridHyperliquidAccountUsage,
    sendGridHyperliquidPilotRequired,
    toTwoDecimals
  };

  const childDeps = {
    ...deps,
    computeGridPreviewAndAllocation: sharedComputeGridPreviewAndAllocation,
    requestGridPreview,
    loadBotVaultByInstanceIds,
    loadGridInstanceForUser,
    resolveGridHyperliquidPilotAccess,
    gridLifecycle,
    ManualTradingError
  };

  registerGridTemplateRoutes(app, childDeps, shared);

  app.get("/grid/pilot-access", requireAuth, async (_req, res) => {
    if (!(await requireGridFeatureEnabledOrRespond(res))) return;
    if (!(await requireGridCapabilityOrRespond(res, deps))) return;
    const user = getUserFromLocals(res);
    const [pilotAccess, executionContext] = await Promise.all([
      resolveGridHyperliquidPilotAccess(deps.db, {
        userId: user.id,
        email: user.email
      }),
      getGridHyperliquidExecutionContext(deps.db)
    ]);
    return res.json({
      ...pilotAccess,
      provider: executionContext.provider,
      allowLiveHyperliquid: executionContext.allowLiveHyperliquid
    });
  });

  registerGridInstanceRoutes(app, childDeps, shared);
}
