"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "../../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../../i18n/config";
import {
  labelFromAllocationMode,
  labelFromAutoReservePolicy,
  labelFromBudgetSplitPolicy,
  labelFromGridMode,
  labelFromMarginPolicy,
  labelFromMode,
  labelFromReasonCode,
  labelFromTriggerType,
  toneFromReasonCode
} from "../i18nLabels";

type GridMode = "long" | "short" | "neutral" | "cross";
type GridPriceMode = "arithmetic" | "geometric";
type GridAllocationMode = "EQUAL_NOTIONAL_PER_GRID" | "EQUAL_BASE_QTY_PER_GRID" | "WEIGHTED_NEAR_PRICE";
type GridBudgetSplitPolicy = "FIXED_50_50" | "FIXED_CUSTOM" | "DYNAMIC_BY_PRICE_POSITION";
type GridMarginPolicy = "MANUAL_ONLY" | "AUTO_ALLOWED";
type GridAutoMarginTriggerType = "LIQ_DISTANCE_PCT_BELOW" | "MARGIN_RATIO_ABOVE";
type GridAutoReservePolicy = "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
type AutoReservePresetKey = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
type GridCatalogDifficulty = "BEGINNER" | "ADVANCED" | "EXPERT";
type GridCatalogRiskLevel = "LOW" | "MEDIUM" | "HIGH";
type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  marketDataExchange?: string | null;
};
type PerpSymbolOption = {
  symbol: string;
  tradable?: boolean;
  minLeverage?: number | null;
  maxLeverage?: number | null;
};

type PerpSymbolFeedResponse = {
  items?: PerpSymbolOption[];
  defaultSymbol?: string | null;
};

type GridCrossSide = {
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
};

type GridCrossSideConfig = {
  long: GridCrossSide;
  short: GridCrossSide;
};

type GridTemplate = {
  id: string;
  name: string;
  description: string | null;
  catalogCategory: string | null;
  catalogTags: string[];
  catalogDifficulty: GridCatalogDifficulty;
  catalogRiskLevel: GridCatalogRiskLevel;
  catalogImageUrl: string | null;
  catalogShortDescription: string | null;
  catalogSortOrder: number;
  catalogFeatured: boolean;
  symbol: string;
  marketType: "perp";
  mode: GridMode;
  gridMode: GridPriceMode;
  allocationMode: GridAllocationMode;
  budgetSplitPolicy: GridBudgetSplitPolicy;
  longBudgetPct: number;
  shortBudgetPct: number;
  marginPolicy: GridMarginPolicy;
  autoMarginMaxUSDT: number | null;
  autoMarginTriggerType: GridAutoMarginTriggerType | null;
  autoMarginTriggerValue: number | null;
  autoMarginStepUSDT: number | null;
  autoMarginCooldownSec: number | null;
  autoReservePolicy: GridAutoReservePolicy;
  autoReserveFixedGridPct: number;
  autoReserveTargetLiqDistancePct: number | null;
  autoReserveMaxPreviewIterations: number;
  initialSeedEnabled: boolean;
  initialSeedPct: number;
  activeOrderWindowSize: number;
  recenterDriftLevels: number;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  crossSideConfig?: GridCrossSideConfig | null;
  leverageMin: number;
  leverageMax: number;
  leverageDefault: number;
  investMaxUsd: number;
  investDefaultUsd: number;
  slippageDefaultPct: number;
  slippageMinPct: number;
  slippageMaxPct: number;
  tpDefaultPct: number | null;
  slDefaultPrice: number | null;
  allowAutoMargin: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  isPublished: boolean;
  isArchived: boolean;
  version: number;
  updatedAt: string;
};

type TemplatePreviewResponse = {
  template: GridTemplate;
  preview: {
    levels: Array<{ index: number; price: number }>;
    perGridQty: number;
    perGridNotional: number;
    profitPerGridNetPct: number;
    profitPerGridNetUsd: number;
    liqEstimate?: number | null;
    liqEstimateLong?: number | null;
    liqEstimateShort?: number | null;
    worstCaseLiqPrice?: number | null;
    worstCaseLiqDistancePct?: number | null;
    liqDistanceMinPct?: number | null;
    minInvestmentUSDT?: number;
    minInvestmentBreakdown?: {
      long?: number;
      short?: number;
      seed?: number;
      total?: number;
    };
    initialSeed?: {
      enabled?: boolean;
      seedPct?: number;
      seedSide?: "buy" | "sell" | null;
      seedQty?: number;
      seedNotionalUsd?: number;
      seedMarginUsd?: number;
      seedMinMarginUsd?: number;
    };
    allocationBreakdown?: {
      mode?: string;
      slotsLong?: number;
      slotsShort?: number;
      longBudgetPct?: number | null;
      shortBudgetPct?: number | null;
      sideNotionalPerOrderLong?: number;
      sideNotionalPerOrderShort?: number;
      qtyPerOrderLong?: number;
      qtyPerOrderShort?: number;
    };
    qtyModel?: {
      mode?: string;
      qtyPerOrder?: number | null;
      qtyBase?: number | null;
    };
    windowMeta?: {
      activeOrdersTotal?: number;
      activeBuys?: number;
      activeSells?: number;
      windowLowerIdx?: number;
      windowUpperIdx?: number;
      windowCenterIdx?: number;
      activeOrderWindowSize?: number;
      recenterReason?: string;
      driftLevels?: number | null;
    };
    profitPerGridEstimateUSDT?: number;
    effectiveGridSlots?: number;
    qtyPerOrderRounded?: number;
    venueChecks?: {
      minQtyHit?: boolean;
      minNotionalHit?: boolean;
      roundedByStep?: boolean;
      fallbackUsed?: boolean;
    };
    warnings: string[];
    validationErrors: string[];
  };
};

type EditFormState = {
  name: string;
  description: string;
  catalogCategory: string;
  catalogTags: string;
  catalogDifficulty: GridCatalogDifficulty;
  catalogRiskLevel: GridCatalogRiskLevel;
  catalogImageUrl: string;
  catalogShortDescription: string;
  catalogSortOrder: string;
  catalogFeatured: boolean;
  symbol: string;
  mode: GridMode;
  gridMode: GridPriceMode;
  allocationMode: GridAllocationMode;
  budgetSplitPolicy: GridBudgetSplitPolicy;
  longBudgetPct: string;
  shortBudgetPct: string;
  marginPolicy: GridMarginPolicy;
  autoMarginMaxUSDT: string;
  autoMarginTriggerType: GridAutoMarginTriggerType;
  autoMarginTriggerValue: string;
  autoMarginStepUSDT: string;
  autoMarginCooldownSec: string;
  autoReservePolicy: GridAutoReservePolicy;
  autoReserveFixedGridPct: string;
  autoReserveTargetLiqDistancePct: string;
  autoReserveMaxPreviewIterations: string;
  initialSeedEnabled: boolean;
  initialSeedPct: string;
  activeOrderWindowSize: string;
  recenterDriftLevels: string;
  lowerPrice: string;
  upperPrice: string;
  gridCount: string;
  crossLongLowerPrice: string;
  crossLongUpperPrice: string;
  crossLongGridCount: string;
  crossShortLowerPrice: string;
  crossShortUpperPrice: string;
  crossShortGridCount: string;
  leverage: string;
  slippageDefaultPct: string;
  tpDefaultPct: string;
  slDefaultPrice: string;
  allowAutoMargin: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  version: string;
};

type PreviewInputState = {
  investUsd: string;
  leverage: string;
  markPrice: string;
  slippagePct: string;
  tpPct: string;
  slPrice: string;
  triggerPrice: string;
};

const AUTO_RESERVE_PRESETS: Record<AutoReservePresetKey, {
  labelKey: "presets.conservative" | "presets.balanced" | "presets.aggressive";
  autoReservePolicy: GridAutoReservePolicy;
  autoReserveFixedGridPct: string;
  autoReserveTargetLiqDistancePct: string;
  autoReserveMaxPreviewIterations: string;
}> = {
  CONSERVATIVE: {
    labelKey: "presets.conservative",
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: "70",
    autoReserveTargetLiqDistancePct: "30",
    autoReserveMaxPreviewIterations: "12"
  },
  BALANCED: {
    labelKey: "presets.balanced",
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: "70",
    autoReserveTargetLiqDistancePct: "20",
    autoReserveMaxPreviewIterations: "10"
  },
  AGGRESSIVE: {
    labelKey: "presets.aggressive",
    autoReservePolicy: "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: "70",
    autoReserveTargetLiqDistancePct: "12",
    autoReserveMaxPreviewIterations: "8"
  }
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = typeof error.payload?.reason === "string" ? error.payload.reason.trim() : "";
    const suffix = reason ? `: ${reason}` : "";
    return `${error.message}${suffix} (HTTP ${error.status})`;
  }
  if (error && typeof error === "object" && "message" in error) return String((error as any).message ?? error);
  return String(error);
}

function toEditForm(template: GridTemplate): EditFormState {
  return {
    name: template.name,
    description: template.description ?? "",
    catalogCategory: template.catalogCategory ?? "",
    catalogTags: Array.isArray(template.catalogTags) ? template.catalogTags.join(", ") : "",
    catalogDifficulty: template.catalogDifficulty ?? "BEGINNER",
    catalogRiskLevel: template.catalogRiskLevel ?? "MEDIUM",
    catalogImageUrl: template.catalogImageUrl ?? "",
    catalogShortDescription: template.catalogShortDescription ?? "",
    catalogSortOrder: String(template.catalogSortOrder ?? 0),
    catalogFeatured: Boolean(template.catalogFeatured),
    symbol: template.symbol,
    mode: template.mode,
    gridMode: template.gridMode,
    allocationMode: template.allocationMode ?? "EQUAL_NOTIONAL_PER_GRID",
    budgetSplitPolicy: template.budgetSplitPolicy ?? "FIXED_50_50",
    longBudgetPct: String(template.longBudgetPct ?? 50),
    shortBudgetPct: String(template.shortBudgetPct ?? 50),
    marginPolicy: template.marginPolicy ?? (template.allowAutoMargin ? "AUTO_ALLOWED" : "MANUAL_ONLY"),
    autoMarginMaxUSDT: String(template.autoMarginMaxUSDT ?? 0),
    autoMarginTriggerType: template.autoMarginTriggerType ?? "LIQ_DISTANCE_PCT_BELOW",
    autoMarginTriggerValue: String(template.autoMarginTriggerValue ?? 3),
    autoMarginStepUSDT: String(template.autoMarginStepUSDT ?? 25),
    autoMarginCooldownSec: String(template.autoMarginCooldownSec ?? 300),
    autoReservePolicy: template.autoReservePolicy ?? "LIQ_GUARD_MAX_GRID",
    autoReserveFixedGridPct: String(template.autoReserveFixedGridPct ?? 70),
    autoReserveTargetLiqDistancePct: template.autoReserveTargetLiqDistancePct == null ? "" : String(template.autoReserveTargetLiqDistancePct),
    autoReserveMaxPreviewIterations: String(template.autoReserveMaxPreviewIterations ?? 8),
    initialSeedEnabled: typeof template.initialSeedEnabled === "boolean" ? template.initialSeedEnabled : true,
    initialSeedPct: String(template.initialSeedPct ?? 30),
    activeOrderWindowSize: String(template.activeOrderWindowSize ?? 100),
    recenterDriftLevels: String(template.recenterDriftLevels ?? 1),
    lowerPrice: String(template.lowerPrice),
    upperPrice: String(template.upperPrice),
    gridCount: String(template.gridCount),
    crossLongLowerPrice: template.crossSideConfig ? String(template.crossSideConfig.long.lowerPrice) : String(template.lowerPrice),
    crossLongUpperPrice: template.crossSideConfig ? String(template.crossSideConfig.long.upperPrice) : String(template.upperPrice),
    crossLongGridCount: template.crossSideConfig ? String(template.crossSideConfig.long.gridCount) : String(template.gridCount),
    crossShortLowerPrice: template.crossSideConfig ? String(template.crossSideConfig.short.lowerPrice) : String(template.lowerPrice),
    crossShortUpperPrice: template.crossSideConfig ? String(template.crossSideConfig.short.upperPrice) : String(template.upperPrice),
    crossShortGridCount: template.crossSideConfig ? String(template.crossSideConfig.short.gridCount) : String(template.gridCount),
    leverage: String(template.leverageDefault),
    slippageDefaultPct: String(template.slippageDefaultPct),
    tpDefaultPct: template.tpDefaultPct == null ? "" : String(template.tpDefaultPct),
    slDefaultPrice: template.slDefaultPrice == null ? "" : String(template.slDefaultPrice),
    allowAutoMargin: template.allowAutoMargin,
    allowManualMarginAdjust: template.allowManualMarginAdjust,
    allowProfitWithdraw: template.allowProfitWithdraw,
    version: String(template.version)
  };
}

function toPreviewInput(template: GridTemplate): PreviewInputState {
  const mid = (Number(template.lowerPrice) + Number(template.upperPrice)) / 2;
  return {
    investUsd: String(template.investDefaultUsd),
    leverage: String(template.leverageDefault),
    markPrice: String(Number.isFinite(mid) ? mid : template.upperPrice),
    slippagePct: String(template.slippageDefaultPct),
    tpPct: template.tpDefaultPct == null ? "" : String(template.tpDefaultPct),
    slPrice: template.slDefaultPrice == null ? "" : String(template.slDefaultPrice),
    triggerPrice: ""
  };
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function deriveInvestMaxUsdFromDefault(investDefaultUsd: number): number {
  const candidate = investDefaultUsd * 20;
  return Number(Math.max(investDefaultUsd, candidate, 100_000).toFixed(2));
}

function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.NEXT_PUBLIC_GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

function usesHyperliquidAccount(account: ExchangeAccount | null | undefined): boolean {
  const exchange = String(account?.exchange ?? "").trim().toLowerCase();
  const marketDataExchange = String(account?.marketDataExchange ?? "").trim().toLowerCase();
  return exchange === "hyperliquid" || marketDataExchange === "hyperliquid";
}

function replaceStablecoinUnit(label: string, stablecoinLabel: string): string {
  return label.replaceAll("USDT", stablecoinLabel);
}

function preferredSymbolFromFeed(
  items: PerpSymbolOption[],
  defaultSymbol: string | null | undefined
): string | null {
  const normalizedDefault = String(defaultSymbol ?? "").trim().toUpperCase();
  if (normalizedDefault && items.some((item) => item.symbol === normalizedDefault)) {
    return normalizedDefault;
  }
  return items.find((item) => item.tradable)?.symbol ?? items[0]?.symbol ?? null;
}

function shouldAutoReplaceSymbol(currentSymbol: string, items: PerpSymbolOption[]): boolean {
  const normalized = currentSymbol.trim().toUpperCase();
  if (!normalized) return true;
  if (items.some((item) => item.symbol === normalized)) return false;
  if (normalized === "BTCUSDT" || normalized === "BTCUSDC") return true;
  return /(USDT|USDC)$/.test(normalized);
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return parsed.toFixed(digits);
}

export default function AdminGridTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const templateId = String(params?.id ?? "").trim();
  const locale = useLocale() as AppLocale;
  const tCommon = useTranslations("admin.common");
  const tCreate = useTranslations("admin.gridTemplatesCreate");
  const tDetail = useTranslations("admin.gridTemplatesDetail");

  const [template, setTemplate] = useState<GridTemplate | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [previewInput, setPreviewInput] = useState<PreviewInputState | null>(null);
  const [preview, setPreview] = useState<TemplatePreviewResponse["preview"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [symbolSourceAccountId, setSymbolSourceAccountId] = useState<string>("");
  const [symbolOptions, setSymbolOptions] = useState<PerpSymbolOption[]>([]);
  const [symbolFeedDefault, setSymbolFeedDefault] = useState<string | null>(null);
  const [symbolOptionsLoading, setSymbolOptionsLoading] = useState(false);
  const [symbolOptionsError, setSymbolOptionsError] = useState<string | null>(null);
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);
  const availableSymbolAccounts = useMemo(() => {
    return accounts.filter((account) => {
      const exchange = String(account.exchange ?? "").trim().toLowerCase();
      if (exchange === "hyperliquid") return true;
      return allowedGridExchanges.has(exchange);
    });
  }, [accounts, allowedGridExchanges]);
  const selectedSymbolSourceAccount = useMemo(
    () => availableSymbolAccounts.find((account) => account.id === symbolSourceAccountId) ?? null,
    [availableSymbolAccounts, symbolSourceAccountId]
  );
  const stablecoinLabel = usesHyperliquidAccount(selectedSymbolSourceAccount) ? "USDC" : "USDT";
  const normalizedFormSymbol = useMemo(() => form?.symbol?.trim().toUpperCase() ?? "", [form?.symbol]);
  const symbolExistsInOptions = useMemo(
    () => symbolOptions.some((entry) => entry.symbol === normalizedFormSymbol),
    [symbolOptions, normalizedFormSymbol]
  );
  const selectedSymbolOption = useMemo(
    () => symbolOptions.find((entry) => entry.symbol === normalizedFormSymbol) ?? null,
    [symbolOptions, normalizedFormSymbol]
  );
  const selectedSymbolMaxLeverage = useMemo(() => {
    const parsed = Number(selectedSymbolOption?.maxLeverage ?? Number.NaN);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }, [selectedSymbolOption]);

  const disabled = loading || saving || !template || !form;

  async function load() {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const [response, accountResponse] = await Promise.all([
        apiGet<{ items: GridTemplate[] }>("/admin/grid/templates"),
        apiGet<{ items?: ExchangeAccount[] }>("/exchange-accounts?purpose=execution")
      ]);
      const found = (response.items ?? []).find((item) => item.id === templateId) ?? null;
      const rawAccounts = Array.isArray(accountResponse.items) ? accountResponse.items : [];
      setAccounts(rawAccounts);
      if (!symbolSourceAccountId && rawAccounts.length > 0) {
        const preferred = rawAccounts.find((account) => {
          const exchange = String(account.exchange ?? "").trim().toLowerCase();
          return exchange === "hyperliquid" || allowedGridExchanges.has(exchange);
        }) ?? rawAccounts[0];
        setSymbolSourceAccountId(preferred.id);
      }
      if (!found) {
        setTemplate(null);
        setForm(null);
        setPreviewInput(null);
        setError(tDetail("messages.templateNotFound"));
        return;
      }
      setTemplate(found);
      setForm(toEditForm(found));
      setPreviewInput(toPreviewInput(found));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [templateId, symbolSourceAccountId, allowedGridExchanges]);

  useEffect(() => {
    const accountId = symbolSourceAccountId.trim();
    if (!accountId) {
      setSymbolOptions([]);
      setSymbolFeedDefault(null);
      setSymbolOptionsError(null);
      setSymbolOptionsLoading(false);
      return;
    }
    let cancelled = false;
    setSymbolOptionsLoading(true);
    setSymbolOptionsError(null);
    void apiGet<PerpSymbolFeedResponse>(`/api/symbols?marketType=perp&exchangeAccountId=${encodeURIComponent(accountId)}`)
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const normalized = items
          .map((item) => ({
            symbol: String(item.symbol ?? "").trim().toUpperCase(),
            tradable: Boolean(item.tradable),
            minLeverage: item.minLeverage == null ? null : Number(item.minLeverage),
            maxLeverage: item.maxLeverage == null ? null : Number(item.maxLeverage)
          }))
          .filter((item) => item.symbol.length > 0);
        setSymbolOptions(normalized);
        setSymbolFeedDefault(preferredSymbolFromFeed(normalized, payload.defaultSymbol));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setSymbolOptions([]);
        setSymbolFeedDefault(null);
        setSymbolOptionsError(errMsg(loadError));
      })
      .finally(() => {
        if (cancelled) return;
        setSymbolOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbolSourceAccountId]);

  useEffect(() => {
    if (!form || !symbolOptions.length || !symbolFeedDefault) return;
    if (!shouldAutoReplaceSymbol(normalizedFormSymbol, symbolOptions)) return;
    if (normalizedFormSymbol === symbolFeedDefault) return;
    setForm((prev) => prev ? { ...prev, symbol: symbolFeedDefault } : prev);
  }, [form, normalizedFormSymbol, symbolFeedDefault, symbolOptions]);

  const hasPreviewIssues = useMemo(() => {
    if (!preview) return false;
    return preview.validationErrors.length > 0 || preview.warnings.length > 0;
  }, [preview]);

  function applyAutoReservePreset(presetKey: AutoReservePresetKey) {
    const preset = AUTO_RESERVE_PRESETS[presetKey];
    setForm((prev) => prev ? {
      ...prev,
      autoReservePolicy: preset.autoReservePolicy,
      autoReserveFixedGridPct: preset.autoReserveFixedGridPct,
      autoReserveTargetLiqDistancePct: preset.autoReserveTargetLiqDistancePct,
      autoReserveMaxPreviewIterations: preset.autoReserveMaxPreviewIterations
    } : prev);
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!template || !form || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const leverage = Math.trunc(parseNumber(form.leverage, template.leverageDefault));
      const crossLongLowerPrice = parseNumber(form.crossLongLowerPrice, template.crossSideConfig?.long.lowerPrice ?? template.lowerPrice);
      const crossLongUpperPrice = parseNumber(form.crossLongUpperPrice, template.crossSideConfig?.long.upperPrice ?? template.upperPrice);
      const crossLongGridCount = Math.trunc(parseNumber(form.crossLongGridCount, template.crossSideConfig?.long.gridCount ?? template.gridCount));
      const crossShortLowerPrice = parseNumber(form.crossShortLowerPrice, template.crossSideConfig?.short.lowerPrice ?? template.lowerPrice);
      const crossShortUpperPrice = parseNumber(form.crossShortUpperPrice, template.crossSideConfig?.short.upperPrice ?? template.upperPrice);
      const crossShortGridCount = Math.trunc(parseNumber(form.crossShortGridCount, template.crossSideConfig?.short.gridCount ?? template.gridCount));
      const crossSideConfig = form.mode === "cross"
        ? {
            long: {
              lowerPrice: crossLongLowerPrice,
              upperPrice: crossLongUpperPrice,
              gridCount: crossLongGridCount,
            },
            short: {
              lowerPrice: crossShortLowerPrice,
              upperPrice: crossShortUpperPrice,
              gridCount: crossShortGridCount,
            }
          }
        : null;
      const effectiveLowerPrice = form.mode === "cross"
        ? Math.min(crossLongLowerPrice, crossShortLowerPrice)
        : parseNumber(form.lowerPrice, template.lowerPrice);
      const effectiveUpperPrice = form.mode === "cross"
        ? Math.max(crossLongUpperPrice, crossShortUpperPrice)
        : parseNumber(form.upperPrice, template.upperPrice);
      const effectiveGridCount = form.mode === "cross"
        ? Math.max(crossLongGridCount, crossShortGridCount)
        : Math.trunc(parseNumber(form.gridCount, template.gridCount));
      if (form.mode === "cross") {
        if (!Number.isFinite(crossLongLowerPrice) || crossLongLowerPrice <= 0) {
          setError(tCreate("errors.crossLongLowerPriceInvalid"));
          return;
        }
        if (!Number.isFinite(crossLongUpperPrice) || crossLongUpperPrice <= crossLongLowerPrice) {
          setError(tCreate("errors.crossLongUpperPriceGreaterThanLower"));
          return;
        }
        if (!Number.isFinite(crossLongGridCount) || crossLongGridCount < 2 || crossLongGridCount > 500) {
          setError(tCreate("errors.crossLongGridCountRange"));
          return;
        }
        if (!Number.isFinite(crossShortLowerPrice) || crossShortLowerPrice <= 0) {
          setError(tCreate("errors.crossShortLowerPriceInvalid"));
          return;
        }
        if (!Number.isFinite(crossShortUpperPrice) || crossShortUpperPrice <= crossShortLowerPrice) {
          setError(tCreate("errors.crossShortUpperPriceGreaterThanLower"));
          return;
        }
        if (!Number.isFinite(crossShortGridCount) || crossShortGridCount < 2 || crossShortGridCount > 500) {
          setError(tCreate("errors.crossShortGridCountRange"));
          return;
        }
      }
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
        setError(tCreate("errors.leverageRange"));
        return;
      }
      if (selectedSymbolMaxLeverage !== null && leverage > selectedSymbolMaxLeverage) {
        setError(tCreate("errors.leverageAboveSymbolMax", { max: selectedSymbolMaxLeverage }));
        return;
      }
      const parsedPreviewInvestUsd = parseNumber(previewInput?.investUsd ?? "", Number.NaN);
      const investDefaultUsd = Number.isFinite(parsedPreviewInvestUsd) && parsedPreviewInvestUsd > 0
        ? parsedPreviewInvestUsd
        : (Number(template.investDefaultUsd) > 0 ? Number(template.investDefaultUsd) : 100);
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        catalogCategory: form.catalogCategory.trim() || null,
        catalogTags: form.catalogTags.split(",").map((item) => item.trim()).filter(Boolean),
        catalogDifficulty: form.catalogDifficulty,
        catalogRiskLevel: form.catalogRiskLevel,
        catalogImageUrl: form.catalogImageUrl.trim() || null,
        catalogShortDescription: form.catalogShortDescription.trim() || null,
        catalogSortOrder: Math.trunc(parseNumber(form.catalogSortOrder, 0)),
        catalogFeatured: form.catalogFeatured,
        symbol: form.symbol.trim().toUpperCase(),
        mode: form.mode,
        gridMode: form.gridMode,
        allocationMode: form.allocationMode,
        budgetSplitPolicy: form.budgetSplitPolicy,
        longBudgetPct: parseNumber(form.longBudgetPct, template.longBudgetPct ?? 50),
        shortBudgetPct: parseNumber(form.shortBudgetPct, template.shortBudgetPct ?? 50),
        marginPolicy: form.marginPolicy,
        autoMarginMaxUSDT: form.marginPolicy === "AUTO_ALLOWED" ? parseNumber(form.autoMarginMaxUSDT, template.autoMarginMaxUSDT ?? 0) : null,
        autoMarginTriggerType: form.marginPolicy === "AUTO_ALLOWED" ? form.autoMarginTriggerType : null,
        autoMarginTriggerValue: form.marginPolicy === "AUTO_ALLOWED" ? parseNumber(form.autoMarginTriggerValue, template.autoMarginTriggerValue ?? 3) : null,
        autoMarginStepUSDT: form.marginPolicy === "AUTO_ALLOWED" ? parseNumber(form.autoMarginStepUSDT, template.autoMarginStepUSDT ?? 25) : null,
        autoMarginCooldownSec: form.marginPolicy === "AUTO_ALLOWED" ? Math.trunc(parseNumber(form.autoMarginCooldownSec, template.autoMarginCooldownSec ?? 300)) : null,
        autoReservePolicy: form.autoReservePolicy,
        autoReserveFixedGridPct: parseNumber(form.autoReserveFixedGridPct, template.autoReserveFixedGridPct ?? 70),
        autoReserveTargetLiqDistancePct: form.autoReserveTargetLiqDistancePct.trim() ? parseNumber(form.autoReserveTargetLiqDistancePct, 0) : null,
        autoReserveMaxPreviewIterations: Math.trunc(parseNumber(form.autoReserveMaxPreviewIterations, template.autoReserveMaxPreviewIterations ?? 8)),
        initialSeedEnabled: form.initialSeedEnabled,
        initialSeedPct: parseNumber(form.initialSeedPct, template.initialSeedPct ?? 30),
        activeOrderWindowSize: Math.trunc(parseNumber(form.activeOrderWindowSize, template.activeOrderWindowSize ?? 100)),
        recenterDriftLevels: Math.trunc(parseNumber(form.recenterDriftLevels, template.recenterDriftLevels ?? 1)),
        lowerPrice: effectiveLowerPrice,
        upperPrice: effectiveUpperPrice,
        gridCount: effectiveGridCount,
        crossSideConfig,
        leverageMin: leverage,
        leverageMax: leverage,
        leverageDefault: leverage,
        investMaxUsd: deriveInvestMaxUsdFromDefault(investDefaultUsd),
        investDefaultUsd,
        slippageDefaultPct: parseNumber(form.slippageDefaultPct, template.slippageDefaultPct),
        slippageMinPct: 0.0001,
        slippageMaxPct: 5,
        tpDefaultPct: form.tpDefaultPct.trim() ? parseNumber(form.tpDefaultPct, 0) : null,
        slDefaultPrice: form.slDefaultPrice.trim() ? parseNumber(form.slDefaultPrice, 0) : null,
        allowAutoMargin: form.marginPolicy === "AUTO_ALLOWED",
        allowManualMarginAdjust: form.allowManualMarginAdjust,
        allowProfitWithdraw: form.allowProfitWithdraw,
        version: Math.trunc(parseNumber(form.version, template.version))
      };

      await apiPut(`/admin/grid/templates/${template.id}`, payload);
      setNotice(tDetail("messages.templateUpdated"));
      await load();
    } catch (saveError) {
      setError(errMsg(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    if (!template || !previewInput || previewLoading) return;
    setPreviewLoading(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        investUsd: parseNumber(previewInput.investUsd, template.investDefaultUsd),
        leverage: parseNumber(previewInput.leverage, template.leverageDefault),
        markPrice: parseNumber(previewInput.markPrice, template.upperPrice),
        slippagePct: parseNumber(previewInput.slippagePct, template.slippageDefaultPct),
        tpPct: previewInput.tpPct.trim() ? parseNumber(previewInput.tpPct, 0) : null,
        slPrice: previewInput.slPrice.trim() ? parseNumber(previewInput.slPrice, 0) : null,
        triggerPrice: previewInput.triggerPrice.trim() ? parseNumber(previewInput.triggerPrice, 0) : null
      };
      const response = await apiPost<TemplatePreviewResponse>(`/admin/grid/templates/${template.id}/preview`, payload);
      setPreview(response.preview);
      setNotice(tDetail("messages.previewUpdated"));
    } catch (previewError) {
      setError(errMsg(previewError));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function togglePublish() {
    if (!template || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (template.isPublished) {
        await apiPost(`/admin/grid/templates/${template.id}/archive`, {});
        setNotice(tDetail("messages.templateArchived"));
      } else {
        await apiPost(`/admin/grid/templates/${template.id}/publish`, {});
        setNotice(tDetail("messages.templatePublished"));
      }
      await load();
    } catch (publishError) {
      setError(errMsg(publishError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!template || saving) return;
    const confirmed = window.confirm(tDetail("messages.confirmDelete", { name: template.name }));
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/admin/grid/templates/${template.id}`);
      setNotice(tDetail("messages.templateDeleted"));
      window.location.href = withLocalePath("/admin/grid-templates", locale);
    } catch (deleteError) {
      if (deleteError instanceof ApiError && deleteError.status === 409 && deleteError.payload?.error === "grid_template_in_use") {
        const count = Number(deleteError.payload?.instanceCount ?? 0);
        setError(tDetail("messages.templateDeleteBlockedInUse", { count: Number.isFinite(count) ? count : 0 }));
      } else {
        setError(errMsg(deleteError));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap" style={{ maxWidth: 1400 }}>
      <h2 style={{ marginTop: 0 }}>{tDetail("title")}</h2>
      {template ? (
        <div className="settingsMutedText" style={{ marginBottom: 10 }}>
          {template.name} · {template.symbol} · {labelFromMode(template.mode, tCreate)} · {labelFromGridMode(template.gridMode, tCreate)}
        </div>
      ) : null}

      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      <div className="gridTemplateCreateLayout" style={{ marginTop: 12 }}>
      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>{tDetail("sections.settings")}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={template?.isPublished ? "btn btnDanger" : "btn btnPrimary"} disabled={disabled} onClick={() => void togglePublish()}>
              {template?.isPublished ? tDetail("actions.archive") : tDetail("actions.publish")}
            </button>
            <button className="btn btnDanger" disabled={disabled} onClick={() => void deleteTemplate()}>
              {tDetail("actions.delete")}
            </button>
          </div>
        </div>

        {loading || !form ? (
          <div className="settingsMutedText">{tDetail("states.loadingTemplate")}</div>
        ) : (
          <form onSubmit={saveTemplate} className="settingsFormGrid gridTemplateFormCompact" style={{ marginTop: 12 }}>
            <div className="gridTemplateSubsectionTitle">{tDetail("sections.basicSettings")}</div>
            <label>
              {tDetail("fields.name")}
              <input className="input" value={form.name} onChange={(event) => setForm((prev) => prev ? { ...prev, name: event.target.value } : prev)} required />
            </label>
            <label>
              {tDetail("fields.symbol")}
              {symbolOptionsError || symbolOptions.length === 0 ? (
                <input className="input" value={form.symbol} onChange={(event) => setForm((prev) => prev ? { ...prev, symbol: event.target.value.toUpperCase() } : prev)} required />
              ) : (
                <select className="input" value={normalizedFormSymbol} onChange={(event) => setForm((prev) => prev ? { ...prev, symbol: event.target.value.toUpperCase() } : prev)}>
                  {!symbolExistsInOptions && normalizedFormSymbol ? (
                    <option value={normalizedFormSymbol}>{normalizedFormSymbol} ({tCreate("fields.customSymbol")})</option>
                  ) : null}
                  {symbolOptions.map((item) => (
                    <option key={item.symbol} value={item.symbol}>
                      {item.symbol}{item.tradable === false ? ` · ${tCreate("fields.notTradable")}` : ""}
                    </option>
                  ))}
                </select>
              )}
              {symbolOptionsLoading ? <div className="settingsMutedText">{tCreate("hints.loadingSymbols")}</div> : null}
              {symbolOptionsError ? <div className="settingsMutedText">{tCreate("hints.symbolFeedFallback")}</div> : null}
            </label>
            <label>
              {tDetail("fields.symbolSourceAccount")}
              <select className="input" value={symbolSourceAccountId} onChange={(event) => setSymbolSourceAccountId(event.target.value)}>
                <option value="">{tDetail("fields.symbolSourceAccountAuto")}</option>
                {availableSymbolAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.exchange}{account.marketDataExchange ? ` -> ${account.marketDataExchange}` : ""})
                  </option>
                ))}
              </select>
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="settingsFieldLabel">{tDetail("fields.mode")}</div>
              <div className="gridModeButtonGroup">
                {(["long", "short", "neutral", "cross"] as const).map((mode) => (
                  <button key={mode} type="button" className={`btn ${form.mode === mode ? "btnPrimary" : ""}`} onClick={() => setForm((prev) => prev ? {
                    ...prev,
                    mode,
                    ...(mode === "cross" ? {
                      crossLongLowerPrice: prev.crossLongLowerPrice || prev.lowerPrice,
                      crossLongUpperPrice: prev.crossLongUpperPrice || prev.upperPrice,
                      crossLongGridCount: prev.crossLongGridCount || prev.gridCount,
                      crossShortLowerPrice: prev.crossShortLowerPrice || prev.lowerPrice,
                      crossShortUpperPrice: prev.crossShortUpperPrice || prev.upperPrice,
                      crossShortGridCount: prev.crossShortGridCount || prev.gridCount,
                    } : {})
                  } : prev)}>
                    {labelFromMode(mode, tCreate)}
                  </button>
                ))}
              </div>
            </div>
            {form.mode === "cross" ? (
              <>
                <label>
                  {tDetail("fields.crossLongLowerPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.crossLongLowerPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, crossLongLowerPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.crossLongUpperPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.crossLongUpperPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, crossLongUpperPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.crossLongGridCount")}
                  <input className="input" type="number" min="2" max="500" value={form.crossLongGridCount} onChange={(event) => setForm((prev) => prev ? { ...prev, crossLongGridCount: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.crossShortLowerPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.crossShortLowerPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, crossShortLowerPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.crossShortUpperPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.crossShortUpperPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, crossShortUpperPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.crossShortGridCount")}
                  <input className="input" type="number" min="2" max="500" value={form.crossShortGridCount} onChange={(event) => setForm((prev) => prev ? { ...prev, crossShortGridCount: event.target.value } : prev)} />
                </label>
              </>
            ) : (
              <>
                <label>
                  {tDetail("fields.lowerPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.lowerPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, lowerPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.upperPrice")}
                  <input className="input" type="number" min="0" step="0.0001" value={form.upperPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, upperPrice: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.gridCount")}
                  <input className="input" type="number" min="2" max="500" value={form.gridCount} onChange={(event) => setForm((prev) => prev ? { ...prev, gridCount: event.target.value } : prev)} />
                </label>
              </>
            )}
            <label>
              {tDetail("fields.leverageFixed")}
              <input className="input" type="number" min="1" max="125" value={form.leverage} onChange={(event) => setForm((prev) => prev ? { ...prev, leverage: event.target.value } : prev)} required />
              {selectedSymbolMaxLeverage !== null ? <div className="settingsMutedText">{tCreate("hints.symbolMaxLeverage", { max: selectedSymbolMaxLeverage })}</div> : null}
            </label>
            <label>
              {tDetail("fields.tpDefaultPct")}
              <input className="input" type="number" min="0" step="0.01" value={form.tpDefaultPct} onChange={(event) => setForm((prev) => prev ? { ...prev, tpDefaultPct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.slDefaultPrice")}
              <input className="input" type="number" min="0" step="0.01" value={form.slDefaultPrice} onChange={(event) => setForm((prev) => prev ? { ...prev, slDefaultPrice: event.target.value } : prev)} />
            </label>

            <div className="gridTemplateSubsectionTitle">{tDetail("sections.advancedSettings")}</div>
            <label>
              {tDetail("fields.gridMode")}
              <select className="input" value={form.gridMode} onChange={(event) => setForm((prev) => prev ? { ...prev, gridMode: event.target.value as GridPriceMode } : prev)}>
                <option value="arithmetic">{labelFromGridMode("arithmetic", tCreate)}</option>
                <option value="geometric">{labelFromGridMode("geometric", tCreate)}</option>
              </select>
            </label>
            <label>
              {tDetail("fields.allocationMode")}
              <select className="input" value={form.allocationMode} onChange={(event) => setForm((prev) => prev ? { ...prev, allocationMode: event.target.value as GridAllocationMode } : prev)}>
                <option value="EQUAL_NOTIONAL_PER_GRID">{labelFromAllocationMode("EQUAL_NOTIONAL_PER_GRID", tCreate)}</option>
                <option value="EQUAL_BASE_QTY_PER_GRID">{labelFromAllocationMode("EQUAL_BASE_QTY_PER_GRID", tCreate)}</option>
                <option value="WEIGHTED_NEAR_PRICE" disabled>{tCreate("comingSoon.weightedNearPrice")}</option>
              </select>
            </label>
            {form.mode === "cross" ? (
              <>
                <label>
                  {tDetail("fields.budgetSplitPolicy")}
                  <select className="input" value={form.budgetSplitPolicy} onChange={(event) => setForm((prev) => prev ? { ...prev, budgetSplitPolicy: event.target.value as GridBudgetSplitPolicy } : prev)}>
                    <option value="FIXED_50_50">{labelFromBudgetSplitPolicy("FIXED_50_50", tCreate)}</option>
                    <option value="FIXED_CUSTOM">{labelFromBudgetSplitPolicy("FIXED_CUSTOM", tCreate)}</option>
                    <option value="DYNAMIC_BY_PRICE_POSITION" disabled>{tCreate("comingSoon.dynamicByPricePosition")}</option>
                  </select>
                </label>
                <label>
                  {tDetail("fields.longBudgetPct")}
                  <input className="input" type="number" min="0" max="100" step="0.01" value={form.longBudgetPct} disabled={form.budgetSplitPolicy !== "FIXED_CUSTOM"} onChange={(event) => setForm((prev) => prev ? { ...prev, longBudgetPct: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.shortBudgetPct")}
                  <input className="input" type="number" min="0" max="100" step="0.01" value={form.shortBudgetPct} disabled={form.budgetSplitPolicy !== "FIXED_CUSTOM"} onChange={(event) => setForm((prev) => prev ? { ...prev, shortBudgetPct: event.target.value } : prev)} />
                </label>
              </>
            ) : (
              <div className="settingsMutedText" style={{ gridColumn: "1 / -1", fontSize: 12 }}>
                {tDetail("hints.splitOnlyCross")}
              </div>
            )}
            <label>
              {tDetail("fields.marginPolicy")}
              <select className="input" value={form.marginPolicy} onChange={(event) => setForm((prev) => prev ? { ...prev, marginPolicy: event.target.value as GridMarginPolicy } : prev)}>
                <option value="MANUAL_ONLY">{labelFromMarginPolicy("MANUAL_ONLY", tCreate)}</option>
                <option value="AUTO_ALLOWED">{labelFromMarginPolicy("AUTO_ALLOWED", tCreate)}</option>
              </select>
            </label>
            <label>
              {tDetail("fields.autoReservePolicy")}
              <select className="input" value={form.autoReservePolicy} onChange={(event) => setForm((prev) => prev ? { ...prev, autoReservePolicy: event.target.value as GridAutoReservePolicy } : prev)}>
                <option value="LIQ_GUARD_MAX_GRID">{labelFromAutoReservePolicy("LIQ_GUARD_MAX_GRID", tCreate)}</option>
                <option value="FIXED_RATIO">{labelFromAutoReservePolicy("FIXED_RATIO", tCreate)}</option>
              </select>
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="settingsMutedText" style={{ fontSize: 12 }}>{tDetail("fields.preset")}</span>
              {(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const).map((presetKey) => (
                <button key={presetKey} type="button" className="btn" onClick={() => applyAutoReservePreset(presetKey)}>
                  {tCreate(AUTO_RESERVE_PRESETS[presetKey].labelKey)}
                </button>
              ))}
            </div>
            <label>
              {tDetail("fields.autoReserveFixedGridPct")}
              <input className="input" type="number" min="0" max="100" step="0.01" value={form.autoReserveFixedGridPct} disabled={form.autoReservePolicy !== "FIXED_RATIO"} onChange={(event) => setForm((prev) => prev ? { ...prev, autoReserveFixedGridPct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.autoReserveTargetLiqDistancePct")}
              <input className="input" type="number" min="0" max="100" step="0.01" value={form.autoReserveTargetLiqDistancePct} placeholder={tDetail("fields.defaultVenueSystem")} onChange={(event) => setForm((prev) => prev ? { ...prev, autoReserveTargetLiqDistancePct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.autoReserveMaxPreviewIterations")}
              <input className="input" type="number" min="1" max="16" step="1" value={form.autoReserveMaxPreviewIterations} disabled={form.autoReservePolicy !== "LIQ_GUARD_MAX_GRID"} onChange={(event) => setForm((prev) => prev ? { ...prev, autoReserveMaxPreviewIterations: event.target.value } : prev)} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={form.initialSeedEnabled} onChange={(event) => setForm((prev) => prev ? { ...prev, initialSeedEnabled: event.target.checked } : prev)} />
              <span>{tDetail("fields.initialSeedEnabled")}</span>
            </label>
            <label>
              {tDetail("fields.initialSeedPct")}
              <input className="input" type="number" min="0" max="60" step="0.1" value={form.initialSeedPct} onChange={(event) => setForm((prev) => prev ? { ...prev, initialSeedPct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.activeOrderWindowSize")}
              <input className="input" type="number" min="40" max="120" step="1" value={form.activeOrderWindowSize} onChange={(event) => setForm((prev) => prev ? { ...prev, activeOrderWindowSize: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.recenterDriftLevels")}
              <input className="input" type="number" min="1" max="10" step="1" value={form.recenterDriftLevels} onChange={(event) => setForm((prev) => prev ? { ...prev, recenterDriftLevels: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.slippageDefaultPct")}
              <input className="input" type="number" min="0.0001" max="5" step="0.0001" value={form.slippageDefaultPct} onChange={(event) => setForm((prev) => prev ? { ...prev, slippageDefaultPct: event.target.value } : prev)} required />
            </label>
            {form.marginPolicy === "AUTO_ALLOWED" ? (
              <>
                <label>
                  {replaceStablecoinUnit(tDetail("fields.autoMarginMaxUsdt"), stablecoinLabel)}
                  <input className="input" type="number" min="0" step="0.01" value={form.autoMarginMaxUSDT} onChange={(event) => setForm((prev) => prev ? { ...prev, autoMarginMaxUSDT: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.autoMarginTrigger")}
                  <select className="input" value={form.autoMarginTriggerType} onChange={(event) => setForm((prev) => prev ? { ...prev, autoMarginTriggerType: event.target.value as GridAutoMarginTriggerType } : prev)}>
                    <option value="LIQ_DISTANCE_PCT_BELOW">{labelFromTriggerType("LIQ_DISTANCE_PCT_BELOW", tCreate)}</option>
                    <option value="MARGIN_RATIO_ABOVE">{labelFromTriggerType("MARGIN_RATIO_ABOVE", tCreate)}</option>
                  </select>
                </label>
                <label>
                  {tDetail("fields.autoMarginTriggerValue")}
                  <input className="input" type="number" min="0.0001" step="0.01" value={form.autoMarginTriggerValue} onChange={(event) => setForm((prev) => prev ? { ...prev, autoMarginTriggerValue: event.target.value } : prev)} />
                </label>
                <label>
                  {replaceStablecoinUnit(tDetail("fields.autoMarginStepUsdt"), stablecoinLabel)}
                  <input className="input" type="number" min="0.01" step="0.01" value={form.autoMarginStepUSDT} onChange={(event) => setForm((prev) => prev ? { ...prev, autoMarginStepUSDT: event.target.value } : prev)} />
                </label>
                <label>
                  {tDetail("fields.autoMarginCooldownSec")}
                  <input className="input" type="number" min="0" step="1" value={form.autoMarginCooldownSec} onChange={(event) => setForm((prev) => prev ? { ...prev, autoMarginCooldownSec: event.target.value } : prev)} />
                </label>
              </>
            ) : null}
            <label style={{ gridColumn: "1 / -1" }}>
              {tDetail("fields.description")}
              <textarea className="input" rows={3} value={form.description} onChange={(event) => setForm((prev) => prev ? { ...prev, description: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.catalogCategory")}
              <input className="input" value={form.catalogCategory} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogCategory: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.catalogTags")}
              <input className="input" value={form.catalogTags} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogTags: event.target.value } : prev)} placeholder={tDetail("fields.catalogTagsPlaceholder")} />
            </label>
            <label>
              {tDetail("fields.catalogDifficulty")}
              <select className="input" value={form.catalogDifficulty} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogDifficulty: event.target.value as GridCatalogDifficulty } : prev)}>
                <option value="BEGINNER">{tDetail("enums.catalogDifficulty.BEGINNER")}</option>
                <option value="ADVANCED">{tDetail("enums.catalogDifficulty.ADVANCED")}</option>
                <option value="EXPERT">{tDetail("enums.catalogDifficulty.EXPERT")}</option>
              </select>
            </label>
            <label>
              {tDetail("fields.catalogRiskLevel")}
              <select className="input" value={form.catalogRiskLevel} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogRiskLevel: event.target.value as GridCatalogRiskLevel } : prev)}>
                <option value="LOW">{tDetail("enums.catalogRiskLevel.LOW")}</option>
                <option value="MEDIUM">{tDetail("enums.catalogRiskLevel.MEDIUM")}</option>
                <option value="HIGH">{tDetail("enums.catalogRiskLevel.HIGH")}</option>
              </select>
            </label>
            <label>
              {tDetail("fields.catalogImageUrl")}
              <input className="input" type="url" value={form.catalogImageUrl} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogImageUrl: event.target.value } : prev)} placeholder="https://..." />
            </label>
            <label>
              {tDetail("fields.catalogSortOrder")}
              <input className="input" type="number" step="1" value={form.catalogSortOrder} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogSortOrder: event.target.value } : prev)} />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              {tDetail("fields.catalogShortDescription")}
              <textarea className="input" rows={2} value={form.catalogShortDescription} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogShortDescription: event.target.value } : prev)} />
            </label>
            <label className="settingsToggle">
              <input type="checkbox" checked={form.catalogFeatured} onChange={(event) => setForm((prev) => prev ? { ...prev, catalogFeatured: event.target.checked } : prev)} />
              <span>{tDetail("fields.catalogFeatured")}</span>
            </label>
            <label className="settingsToggle">
              <input type="checkbox" checked={form.marginPolicy === "AUTO_ALLOWED"} readOnly />
              <span>{tDetail("fields.allowAutoMarginDerived")}</span>
            </label>
            <label className="settingsToggle">
              <input type="checkbox" checked={form.allowManualMarginAdjust} onChange={(event) => setForm((prev) => prev ? { ...prev, allowManualMarginAdjust: event.target.checked } : prev)} />
              <span>{tDetail("fields.allowManualMarginAdjust")}</span>
            </label>
            <label className="settingsToggle">
              <input type="checkbox" checked={form.allowProfitWithdraw} onChange={(event) => setForm((prev) => prev ? { ...prev, allowProfitWithdraw: event.target.checked } : prev)} />
              <span>{tDetail("fields.allowProfitWithdraw")}</span>
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btnPrimary" type="submit" disabled={disabled}>{saving ? tDetail("states.saving") : tDetail("actions.saveTemplate")}</button>
            </div>
          </form>
        )}
      </section>

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>{tDetail("sections.preview")}</h3>
          <button className="btn" onClick={() => void runPreview()} disabled={!template || !previewInput || previewLoading}>
            {previewLoading ? tDetail("states.previewing") : tDetail("actions.runPreview")}
          </button>
        </div>

        {!previewInput ? (
          <div className="settingsMutedText">{tDetail("states.loadFirst")}</div>
        ) : (
          <div className="settingsFormGrid gridTemplatePreviewInputGrid" style={{ marginTop: 12 }}>
            <label>
              {replaceStablecoinUnit(tDetail("fields.investUsd"), stablecoinLabel)}
              <input className="input" type="number" min="1" step="0.01" value={previewInput.investUsd} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, investUsd: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.leverage")}
              <input className="input" type="number" min="1" max="125" value={previewInput.leverage} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, leverage: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.markPrice")}
              <input className="input" type="number" min="0" step="0.0001" value={previewInput.markPrice} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, markPrice: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.slippagePct")}
              <input className="input" type="number" min="0.0001" max="5" step="0.0001" value={previewInput.slippagePct} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, slippagePct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.tpPct")}
              <input className="input" type="number" min="0" step="0.01" value={previewInput.tpPct} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, tpPct: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.slPrice")}
              <input className="input" type="number" min="0" step="0.01" value={previewInput.slPrice} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, slPrice: event.target.value } : prev)} />
            </label>
            <label>
              {tDetail("fields.triggerPrice")}
              <input className="input" type="number" min="0" step="0.0001" value={previewInput.triggerPrice} onChange={(event) => setPreviewInput((prev) => prev ? { ...prev, triggerPrice: event.target.value } : prev)} />
            </label>
          </div>
        )}

        {preview ? (
          <div className="card gridTemplatePreviewCard" style={{ marginTop: 12, padding: 12 }}>
            <div className="gridTemplatePreviewStatsGrid">
              <div><strong>{tDetail("previewStats.levels")}</strong><div>{preview.levels.length}</div></div>
              <div><strong>{tDetail("previewStats.perGridQty")}</strong><div>{formatNumber(preview.perGridQty, 6)}</div></div>
              <div><strong>{tDetail("previewStats.roundedQtyOrder")}</strong><div>{formatNumber(preview.qtyPerOrderRounded ?? preview.perGridQty, 6)}</div></div>
              <div><strong>{tDetail("previewStats.perGridNotional")}</strong><div>{formatNumber(preview.perGridNotional, 2)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.netGridPct")}</strong><div>{formatNumber(preview.profitPerGridNetPct, 4)}%</div></div>
              <div><strong>{replaceStablecoinUnit(tDetail("previewStats.netGridUsdt"), stablecoinLabel)}</strong><div>{formatNumber(preview.profitPerGridNetUsd, 4)} {stablecoinLabel}</div></div>
              <div><strong>{replaceStablecoinUnit(tDetail("previewStats.estimatedGridUsdt"), stablecoinLabel)}</strong><div>{formatNumber(preview.profitPerGridEstimateUSDT ?? preview.profitPerGridNetUsd, 4)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.minInvestment")}</strong><div>{formatNumber(preview.minInvestmentUSDT ?? null, 2)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.minInvestLong")}</strong><div>{formatNumber(preview.minInvestmentBreakdown?.long ?? null, 2)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.minInvestShort")}</strong><div>{formatNumber(preview.minInvestmentBreakdown?.short ?? null, 2)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.minInvestSeed")}</strong><div>{formatNumber(preview.minInvestmentBreakdown?.seed ?? null, 2)} {stablecoinLabel}</div></div>
              <div><strong>{tDetail("previewStats.effectiveSlots")}</strong><div>{formatNumber(preview.effectiveGridSlots ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.liqEstimate")}</strong><div>{formatNumber(preview.liqEstimate ?? null, 2)}</div></div>
              <div><strong>{tDetail("previewStats.liqLong")}</strong><div>{formatNumber(preview.liqEstimateLong ?? null, 2)}</div></div>
              <div><strong>{tDetail("previewStats.liqShort")}</strong><div>{formatNumber(preview.liqEstimateShort ?? null, 2)}</div></div>
              <div><strong>{tDetail("previewStats.worstLiqDist")}</strong><div>{formatNumber(preview.worstCaseLiqDistancePct ?? null, 2)}%</div></div>
              <div><strong>{tDetail("previewStats.liqMinThreshold")}</strong><div>{formatNumber(preview.liqDistanceMinPct ?? null, 2)}%</div></div>
              <div><strong>{tDetail("previewStats.autoReservePolicy")}</strong><div>{labelFromAutoReservePolicy(template?.autoReservePolicy, tCreate)}</div></div>
              <div><strong>{tDetail("previewStats.reserveFixedGridPct")}</strong><div>{formatNumber(template?.autoReserveFixedGridPct ?? null, 2)}%</div></div>
              <div><strong>{tDetail("previewStats.reserveTargetLiqPct")}</strong><div>{formatNumber(template?.autoReserveTargetLiqDistancePct ?? null, 2)}%</div></div>
              <div><strong>{tDetail("previewStats.reserveMaxIterations")}</strong><div>{formatNumber(template?.autoReserveMaxPreviewIterations ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.activeOrderWindowSize")}</strong><div>{formatNumber(template?.activeOrderWindowSize ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.recenterDriftLevels")}</strong><div>{formatNumber(template?.recenterDriftLevels ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.activeOrdersTotal")}</strong><div>{formatNumber(preview.windowMeta?.activeOrdersTotal ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.activeBuysSells")}</strong><div>{formatNumber(preview.windowMeta?.activeBuys ?? null, 0)} / {formatNumber(preview.windowMeta?.activeSells ?? null, 0)}</div></div>
              <div><strong>{tDetail("previewStats.windowRange")}</strong><div>{formatNumber(preview.windowMeta?.windowLowerIdx ?? null, 0)}-{formatNumber(preview.windowMeta?.windowUpperIdx ?? null, 0)}</div></div>
            </div>
            {preview.allocationBreakdown ? (
              <div className="settingsMutedText gridTemplatePreviewMetaLine" style={{ fontSize: 12 }}>
                {tDetail("previewNotes.allocationLine", {
                  mode: labelFromAllocationMode(preview.allocationBreakdown.mode ?? null, tCreate),
                  slotsLong: formatNumber(preview.allocationBreakdown.slotsLong ?? null, 0),
                  slotsShort: formatNumber(preview.allocationBreakdown.slotsShort ?? null, 0),
                  budgetLong: formatNumber(preview.allocationBreakdown.longBudgetPct ?? null, 2),
                  budgetShort: formatNumber(preview.allocationBreakdown.shortBudgetPct ?? null, 2)
                })}
              </div>
            ) : null}
            {preview.qtyModel ? (
              <div className="settingsMutedText gridTemplatePreviewMetaLine" style={{ fontSize: 12 }}>
                {tDetail("previewNotes.qtyModelLine", {
                  mode: labelFromAllocationMode(preview.qtyModel.mode ?? null, tCreate),
                  qtyOrder: formatNumber(preview.qtyModel.qtyPerOrder ?? null, 6),
                  qtyBase: formatNumber(preview.qtyModel.qtyBase ?? null, 6)
                })}
              </div>
            ) : null}
            {preview.initialSeed?.enabled ? (
              <div className="settingsMutedText gridTemplatePreviewMetaLine" style={{ fontSize: 12 }}>
                {replaceStablecoinUnit(
                  tDetail("previewNotes.initialSeedLine", {
                    side: preview.initialSeed.seedSide ?? "n/a",
                    qty: formatNumber(preview.initialSeed.seedQty ?? null, 6),
                    notional: formatNumber(preview.initialSeed.seedNotionalUsd ?? null, 2),
                    margin: formatNumber(preview.initialSeed.seedMarginUsd ?? null, 2),
                    pct: formatNumber(preview.initialSeed.seedPct ?? null, 2)
                  }),
                  stablecoinLabel
                )}
              </div>
            ) : null}

            {preview.levels.length > 0 ? (
              <div className="settingsMutedText gridTemplatePreviewMetaLine" style={{ fontSize: 12 }}>
                {tDetail("previewNotes.firstLastLevel", {
                  first: formatNumber(preview.levels[0]?.price, 4),
                  last: formatNumber(preview.levels[preview.levels.length - 1]?.price, 4)
                })}
              </div>
            ) : null}

            {hasPreviewIssues ? (
              <div className="gridTemplatePreviewMetaLine" style={{ fontSize: 13 }}>
                {preview.validationErrors.length > 0 ? (
                  <div>
                    <div style={{ color: "#ef4444" }}>{tDetail("previewNotes.errors")}:</div>
                    <div className="gridTemplatePreviewTagRow" style={{ marginTop: 6 }}>
                      {preview.validationErrors.map((code) => (
                        <span key={code} className={`tag tag-${toneFromReasonCode(code)}`}>{labelFromReasonCode(code, tCreate)}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {preview.warnings.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: "#f59e0b" }}>{tDetail("previewNotes.warnings")}:</div>
                    <div className="gridTemplatePreviewTagRow" style={{ marginTop: 6 }}>
                      {preview.warnings.map((code) => (
                        <span key={code} className={`tag tag-${toneFromReasonCode(code)}`}>{labelFromReasonCode(code, tCreate)}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {preview.venueChecks ? (
                  <div className="settingsMutedText" style={{ marginTop: 6 }}>
                    {tDetail("previewNotes.venueChecks", {
                      minQty: preview.venueChecks.minQtyHit ? tDetail("previewNotes.values.hit") : tDetail("previewNotes.values.ok"),
                      minNotional: preview.venueChecks.minNotionalHit ? tDetail("previewNotes.values.hit") : tDetail("previewNotes.values.ok"),
                      stepRound: preview.venueChecks.roundedByStep ? tDetail("previewNotes.values.yes") : tDetail("previewNotes.values.no"),
                      fallback: preview.venueChecks.fallbackUsed ? tDetail("previewNotes.values.yes") : tDetail("previewNotes.values.no")
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="settingsMutedText gridTemplatePreviewMetaLine" style={{ fontSize: 12 }}>{tDetail("previewNotes.noWarnings")}</div>
            )}
          </div>
        ) : null}
      </section>
      </div>
    </div>
  );
}
