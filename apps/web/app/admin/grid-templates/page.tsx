"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet, apiPost, apiPut } from "../../../lib/api";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import {
  labelFromAllocationMode,
  labelFromAutoReservePolicy,
  labelFromBudgetSplitPolicy,
  labelFromGridMode,
  labelFromMarginPolicy,
  labelFromMode,
  labelFromReasonCode,
  labelFromSplitMode,
  labelFromTriggerType,
  toneFromReasonCode
} from "./i18nLabels";

type GridMode = "long" | "short" | "neutral" | "cross";
type GridPriceMode = "arithmetic" | "geometric";
type GridAllocationMode = "EQUAL_NOTIONAL_PER_GRID" | "EQUAL_BASE_QTY_PER_GRID" | "WEIGHTED_NEAR_PRICE";
type GridBudgetSplitPolicy = "FIXED_50_50" | "FIXED_CUSTOM" | "DYNAMIC_BY_PRICE_POSITION";
type GridMarginPolicy = "MANUAL_ONLY" | "AUTO_ALLOWED";
type GridAutoMarginTriggerType = "LIQ_DISTANCE_PCT_BELOW" | "MARGIN_RATIO_ABOVE";
type GridAutoReservePolicy = "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";
type GridInstanceMarginMode = "MANUAL" | "AUTO";
type AutoReservePresetKey = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  supportsPerpManual?: boolean;
  marketDataExchange?: string | null;
  marketDataLabel?: string | null;
};

type GridTemplate = {
  id: string;
  name: string;
  description: string | null;
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
  leverageMin: number;
  leverageMax: number;
  leverageDefault: number;
  investMinUsd: number;
  investMaxUsd: number;
  investDefaultUsd: number;
  slippageDefaultPct: number;
  slippageMinPct: number;
  slippageMaxPct: number;
  tpDefaultPct: number | null;
  slDefaultPct: number | null;
  allowAutoMargin: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  isPublished: boolean;
  isArchived: boolean;
  version: number;
  updatedAt: string;
};

type GridTemplateListResponse = {
  items: GridTemplate[];
};

type DraftPreviewResponse = {
  markPrice: number;
  minInvestmentUSDT: number;
  minInvestmentBreakdown?: {
    long?: number;
    short?: number;
    seed?: number;
    total?: number;
  } | null;
  initialSeed?: {
    enabled?: boolean;
    seedPct?: number;
    seedSide?: "buy" | "sell" | null;
    seedQty?: number;
    seedNotionalUsd?: number;
    seedMarginUsd?: number;
    seedMinMarginUsd?: number;
  } | null;
  marginMode?: GridInstanceMarginMode;
  allocation: {
    totalBudgetUsd: number;
    gridInvestUsd: number;
    extraMarginUsd: number;
    splitMode: "manual" | "auto_fixed_ratio" | "auto_liq_guard_dynamic";
    policy: GridAutoReservePolicy | null;
    targetLiqDistancePct: number | null;
    searchIterationsUsed: number;
    insufficient: boolean;
    reasonCodes: string[];
  };
  allocationBreakdown?: {
    mode?: string;
    slotsLong?: number;
    slotsShort?: number;
    qtyPerOrderLong?: number;
    qtyPerOrderShort?: number;
    effectiveGridInvestUsd?: number;
  } | null;
  qtyModel?: {
    mode?: string;
    qtyPerOrder?: number | null;
    qtyBase?: number | null;
  } | null;
  venueChecks?: {
    minQtyHit?: boolean;
    minNotionalHit?: boolean;
    roundedByStep?: boolean;
    fallbackUsed?: boolean;
    minQtyUsed?: number | null;
    minNotionalUsed?: number | null;
  } | null;
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
    activeBuyLowerPrice?: number | null;
    activeBuyUpperPrice?: number | null;
    activeSellLowerPrice?: number | null;
    activeSellUpperPrice?: number | null;
    activeRangeLowPrice?: number | null;
    activeRangeHighPrice?: number | null;
  } | null;
  profitPerGridEstimateUSDT?: number;
  liq: {
    liqEstimateLong: number | null;
    liqEstimateShort: number | null;
    worstCaseLiqPrice: number | null;
    worstCaseLiqDistancePct: number | null;
    liqDistanceMinPct: number;
  };
  warnings: string[];
  status?: {
    ready: boolean;
    codes: string[];
  };
};

type CreateFormState = {
  name: string;
  description: string;
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
  leverage: string;
  investMinUsd: string;
  slippageDefaultPct: string;
  tpDefaultPct: string;
  slDefaultPct: string;
  allowAutoMargin: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  version: string;
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = typeof error.payload?.reason === "string" ? error.payload.reason.trim() : "";
    const suffix = reason ? `: ${reason}` : "";
    return `${error.message}${suffix} (HTTP ${error.status})`;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as any).message ?? error);
  }
  return String(error);
}

function validationDetails(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.payload?.details;
  if (!details || typeof details !== "object") return null;
  const fieldErrors = (details as any).fieldErrors;
  const formErrors = Array.isArray((details as any).formErrors) ? (details as any).formErrors : [];
  const entries = Object.entries((fieldErrors ?? {}) as Record<string, unknown[]>)
    .flatMap(([field, messages]) => {
      if (!Array.isArray(messages)) return [];
      return messages
        .map((message) => String(message ?? "").trim())
        .filter(Boolean)
        .map((message) => `${field}: ${message}`);
    });
  const formEntries = formErrors
    .map((message) => String(message ?? "").trim())
    .filter(Boolean)
    .map((message) => `form: ${message}`);
  const combined = [...entries, ...formEntries];
  if (combined.length === 0) return null;
  return combined.join(" | ");
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "n/a";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return parsed.toFixed(digits);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleString();
}

const DEFAULT_FORM: CreateFormState = {
  name: "",
  description: "",
  symbol: "BTCUSDT",
  mode: "long",
  gridMode: "arithmetic",
  allocationMode: "EQUAL_NOTIONAL_PER_GRID",
  budgetSplitPolicy: "FIXED_50_50",
  longBudgetPct: "50",
  shortBudgetPct: "50",
  marginPolicy: "MANUAL_ONLY",
  autoMarginMaxUSDT: "0",
  autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW",
  autoMarginTriggerValue: "3",
  autoMarginStepUSDT: "25",
  autoMarginCooldownSec: "300",
  autoReservePolicy: "LIQ_GUARD_MAX_GRID",
  autoReserveFixedGridPct: "70",
  autoReserveTargetLiqDistancePct: "",
  autoReserveMaxPreviewIterations: "8",
  initialSeedEnabled: true,
  initialSeedPct: "30",
  activeOrderWindowSize: "100",
  recenterDriftLevels: "1",
  lowerPrice: "",
  upperPrice: "",
  gridCount: "",
  leverage: "",
  investMinUsd: "",
  slippageDefaultPct: "0.1",
  tpDefaultPct: "",
  slDefaultPct: "",
  allowAutoMargin: false,
  allowManualMarginAdjust: true,
  allowProfitWithdraw: true,
  version: "1"
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

function parseNumberInput(value: string, fallback: number): number {
  const raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return fallback;

  let normalized = raw;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && !hasDot) {
    normalized = normalized.replace(",", ".");
  } else if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    if (lastComma > lastDot) {
      // 70.000,25 -> 70000.25
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      // 70,000.25 -> 70000.25
      normalized = normalized.replace(/,/g, "");
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function deriveInvestMaxUsd(investMinUsd: number): number {
  const candidate = investMinUsd * 20;
  return Number(Math.max(investMinUsd, candidate).toFixed(2));
}

function readAllowedGridExchanges(): Set<string> {
  const raw = String(process.env.NEXT_PUBLIC_GRID_ALLOWED_EXCHANGES ?? "paper");
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(values.length > 0 ? values : ["paper"]);
}

export default function AdminGridTemplatesPage() {
  const locale = useLocale() as AppLocale;
  const tCommon = useTranslations("admin.common");
  const tCreate = useTranslations("admin.gridTemplatesCreate");
  const [items, setItems] = useState<GridTemplate[]>([]);
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>(DEFAULT_FORM);
  const [showArchived, setShowArchived] = useState(false);
  const [previewAccountId, setPreviewAccountId] = useState<string>("");
  const [previewInvestUsd, setPreviewInvestUsd] = useState<string>("");
  const [previewExtraMarginUsd, setPreviewExtraMarginUsd] = useState<string>("0");
  const [previewTpPct, setPreviewTpPct] = useState<string>("");
  const [previewSlPct, setPreviewSlPct] = useState<string>("");
  const [previewTriggerPrice, setPreviewTriggerPrice] = useState<string>("");
  const [previewMarkOverride, setPreviewMarkOverride] = useState<string>("");
  const [previewMarginMode, setPreviewMarginMode] = useState<GridInstanceMarginMode>(
    DEFAULT_FORM.marginPolicy === "AUTO_ALLOWED" ? "AUTO" : "MANUAL"
  );
  const [previewMarginModeTouched, setPreviewMarginModeTouched] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DraftPreviewResponse | null>(null);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  const previewRequestSeq = useRef(0);
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);

  const activeItems = useMemo(() => {
    if (showArchived) return items;
    return items.filter((row) => !row.isArchived);
  }, [items, showArchived]);

  const availablePreviewAccounts = useMemo(() => {
    return accounts.filter((account) => allowedGridExchanges.has(String(account.exchange ?? "").trim().toLowerCase()));
  }, [accounts, allowedGridExchanges]);
  const selectedPreviewAccount = useMemo(
    () => availablePreviewAccounts.find((account) => account.id === previewAccountId) ?? null,
    [availablePreviewAccounts, previewAccountId]
  );
  const previewLiqRiskActive = Boolean(
    preview
    && Number.isFinite(Number(preview.liq?.worstCaseLiqDistancePct))
    && Number(preview.liq.worstCaseLiqDistancePct) < Number(preview.liq?.liqDistanceMinPct ?? 8)
  );
  const previewInsufficient = Boolean(
    preview?.allocation?.insufficient
    || preview?.status?.codes?.includes("insufficient_budget")
  );

  function applyAutoReservePreset(presetKey: AutoReservePresetKey) {
    const preset = AUTO_RESERVE_PRESETS[presetKey];
    setForm((prev) => ({
      ...prev,
      autoReservePolicy: preset.autoReservePolicy,
      autoReserveFixedGridPct: preset.autoReserveFixedGridPct,
      autoReserveTargetLiqDistancePct: preset.autoReserveTargetLiqDistancePct,
      autoReserveMaxPreviewIterations: preset.autoReserveMaxPreviewIterations
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [response, accountsResponse] = await Promise.all([
        apiGet<GridTemplateListResponse>("/admin/grid/templates"),
        apiGet<{ items?: ExchangeAccount[] }>("/exchange-accounts?purpose=execution")
      ]);
      setItems(Array.isArray(response.items) ? response.items : []);
      const rawAccounts = Array.isArray(accountsResponse.items) ? accountsResponse.items : [];
      setAccounts(rawAccounts);
      if (!previewAccountId && rawAccounts.length > 0) {
        const preferred = rawAccounts.find((account) => allowedGridExchanges.has(String(account.exchange ?? "").trim().toLowerCase()))
          ?? rawAccounts[0];
        setPreviewAccountId(String(preferred.id));
      }
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!previewInvestUsd.trim() && form.investMinUsd.trim()) {
      setPreviewInvestUsd(form.investMinUsd.trim());
    }
  }, [form.investMinUsd, previewInvestUsd]);

  useEffect(() => {
    if (form.marginPolicy !== "AUTO_ALLOWED" && previewMarginMode === "AUTO") {
      setPreviewMarginMode("MANUAL");
      setPreviewMarginModeTouched(false);
      return;
    }
    if (form.marginPolicy === "AUTO_ALLOWED" && !previewMarginModeTouched) {
      setPreviewMarginMode("AUTO");
    }
  }, [form.marginPolicy, previewMarginMode, previewMarginModeTouched]);

  useEffect(() => {
    if (!availablePreviewAccounts.length) return;
    const hasCurrent = availablePreviewAccounts.some((account) => account.id === previewAccountId);
    if (!hasCurrent) {
      setPreviewAccountId(availablePreviewAccounts[0].id);
    }
  }, [availablePreviewAccounts, previewAccountId]);

  function buildDraftTemplatePayload(): { payload: Record<string, unknown> | null; reason: string | null } {
    const lowerPrice = parseNumberInput(form.lowerPrice, Number.NaN);
    const upperPrice = parseNumberInput(form.upperPrice, Number.NaN);
    const gridCount = Math.trunc(parseNumberInput(form.gridCount, Number.NaN));
    const leverage = Math.trunc(parseNumberInput(form.leverage, Number.NaN));
    const investMinUsd = parseNumberInput(form.investMinUsd, Number.NaN);
    const slippageDefaultPct = parseNumberInput(form.slippageDefaultPct, Number.NaN);
    const longBudgetPct = parseNumberInput(form.longBudgetPct, Number.NaN);
    const shortBudgetPct = parseNumberInput(form.shortBudgetPct, Number.NaN);
    const autoReserveFixedGridPct = parseNumberInput(form.autoReserveFixedGridPct, Number.NaN);
    const autoReserveTargetLiqDistancePct = form.autoReserveTargetLiqDistancePct.trim()
      ? parseNumberInput(form.autoReserveTargetLiqDistancePct, Number.NaN)
      : null;
    const autoReserveMaxPreviewIterations = Math.trunc(parseNumberInput(form.autoReserveMaxPreviewIterations, Number.NaN));
    const initialSeedPct = parseNumberInput(form.initialSeedPct, Number.NaN);
    const activeOrderWindowSize = Math.trunc(parseNumberInput(form.activeOrderWindowSize, Number.NaN));
    const recenterDriftLevels = Math.trunc(parseNumberInput(form.recenterDriftLevels, Number.NaN));
    const autoMarginMaxUSDT = parseNumberInput(form.autoMarginMaxUSDT, Number.NaN);
    const autoMarginTriggerValue = parseNumberInput(form.autoMarginTriggerValue, Number.NaN);
    const autoMarginStepUSDT = parseNumberInput(form.autoMarginStepUSDT, Number.NaN);
    const autoMarginCooldownSec = Math.trunc(parseNumberInput(form.autoMarginCooldownSec, Number.NaN));
    const tpDefaultPct = form.tpDefaultPct.trim() ? parseNumberInput(form.tpDefaultPct, Number.NaN) : null;
    const slDefaultPct = form.slDefaultPct.trim() ? parseNumberInput(form.slDefaultPct, Number.NaN) : null;
    const version = Math.trunc(parseNumberInput(form.version, 1));

    if (!Number.isFinite(lowerPrice) || lowerPrice <= 0) return { payload: null, reason: tCreate("errors.lowerPriceInvalid") };
    if (!Number.isFinite(upperPrice) || upperPrice <= lowerPrice) return { payload: null, reason: tCreate("errors.upperPriceGreaterThanLower") };
    if (!Number.isFinite(gridCount) || gridCount < 2 || gridCount > 500) return { payload: null, reason: tCreate("errors.gridCountRange") };
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) return { payload: null, reason: tCreate("errors.leverageRange") };
    if (!Number.isFinite(investMinUsd) || investMinUsd <= 0) return { payload: null, reason: tCreate("errors.investMinInvalid") };
    if (!Number.isFinite(slippageDefaultPct) || slippageDefaultPct < 0.0001 || slippageDefaultPct > 5) {
      return { payload: null, reason: tCreate("errors.slippageRange") };
    }
    if (!Number.isFinite(longBudgetPct) || longBudgetPct < 0 || longBudgetPct > 100) {
      return { payload: null, reason: tCreate("errors.longBudgetRange") };
    }
    if (!Number.isFinite(shortBudgetPct) || shortBudgetPct < 0 || shortBudgetPct > 100) {
      return { payload: null, reason: tCreate("errors.shortBudgetRange") };
    }
    if (form.mode === "cross" && form.budgetSplitPolicy === "FIXED_CUSTOM" && Math.abs((longBudgetPct + shortBudgetPct) - 100) > 0.000001) {
      return { payload: null, reason: tCreate("errors.budgetSplitMustEqual100") };
    }
    if (form.autoReservePolicy === "FIXED_RATIO" && (!Number.isFinite(autoReserveFixedGridPct) || autoReserveFixedGridPct < 0 || autoReserveFixedGridPct > 100)) {
      return { payload: null, reason: tCreate("errors.autoReserveFixedRange") };
    }
    if (form.autoReservePolicy === "LIQ_GUARD_MAX_GRID"
      && (!Number.isFinite(autoReserveMaxPreviewIterations) || autoReserveMaxPreviewIterations < 1 || autoReserveMaxPreviewIterations > 16)) {
      return { payload: null, reason: tCreate("errors.autoReserveIterationsRange") };
    }
    if (!Number.isFinite(initialSeedPct) || initialSeedPct < 0 || initialSeedPct > 60) {
      return { payload: null, reason: tCreate("errors.initialSeedPctRange") };
    }
    if (!Number.isFinite(activeOrderWindowSize) || activeOrderWindowSize < 40 || activeOrderWindowSize > 120) {
      return { payload: null, reason: tCreate("errors.activeOrderWindowSizeRange") };
    }
    if (!Number.isFinite(recenterDriftLevels) || recenterDriftLevels < 1 || recenterDriftLevels > 10) {
      return { payload: null, reason: tCreate("errors.recenterDriftLevelsRange") };
    }
    if (autoReserveTargetLiqDistancePct !== null && (!Number.isFinite(autoReserveTargetLiqDistancePct) || autoReserveTargetLiqDistancePct < 0 || autoReserveTargetLiqDistancePct > 100)) {
      return { payload: null, reason: tCreate("errors.autoReserveTargetRange") };
    }
    if (form.marginPolicy === "AUTO_ALLOWED") {
      if (!Number.isFinite(autoMarginMaxUSDT) || autoMarginMaxUSDT < 0) return { payload: null, reason: tCreate("errors.autoMarginMaxInvalid") };
      if (!Number.isFinite(autoMarginTriggerValue) || autoMarginTriggerValue <= 0) return { payload: null, reason: tCreate("errors.autoMarginTriggerInvalid") };
      if (!Number.isFinite(autoMarginStepUSDT) || autoMarginStepUSDT <= 0) return { payload: null, reason: tCreate("errors.autoMarginStepInvalid") };
      if (!Number.isFinite(autoMarginCooldownSec) || autoMarginCooldownSec < 0) return { payload: null, reason: tCreate("errors.autoMarginCooldownInvalid") };
    }
    if (tpDefaultPct !== null && (!Number.isFinite(tpDefaultPct) || tpDefaultPct <= 0 || tpDefaultPct > 200)) {
      return { payload: null, reason: tCreate("errors.tpDefaultRange") };
    }
    if (slDefaultPct !== null && (!Number.isFinite(slDefaultPct) || slDefaultPct <= 0 || slDefaultPct > 200)) {
      return { payload: null, reason: tCreate("errors.slDefaultRange") };
    }

    const name = form.name.trim() || "__draft_template_preview__";
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) return { payload: null, reason: tCreate("errors.symbolRequired") };

    return {
      payload: {
        name,
        description: form.description.trim() || null,
        symbol,
        marketType: "perp",
        mode: form.mode,
        gridMode: form.gridMode,
        allocationMode: form.allocationMode,
        budgetSplitPolicy: form.budgetSplitPolicy,
        longBudgetPct,
        shortBudgetPct,
        marginPolicy: form.marginPolicy,
        autoMarginMaxUSDT: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginMaxUSDT : null,
        autoMarginTriggerType: form.marginPolicy === "AUTO_ALLOWED" ? form.autoMarginTriggerType : null,
        autoMarginTriggerValue: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginTriggerValue : null,
        autoMarginStepUSDT: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginStepUSDT : null,
        autoMarginCooldownSec: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginCooldownSec : null,
        autoReservePolicy: form.autoReservePolicy,
        autoReserveFixedGridPct: Number.isFinite(autoReserveFixedGridPct) ? autoReserveFixedGridPct : 70,
        autoReserveTargetLiqDistancePct: autoReserveTargetLiqDistancePct,
        autoReserveMaxPreviewIterations: Number.isFinite(autoReserveMaxPreviewIterations) ? autoReserveMaxPreviewIterations : 8,
        initialSeedEnabled: form.initialSeedEnabled,
        initialSeedPct: Number.isFinite(initialSeedPct) ? initialSeedPct : 30,
        activeOrderWindowSize: Number.isFinite(activeOrderWindowSize) ? activeOrderWindowSize : 100,
        recenterDriftLevels: Number.isFinite(recenterDriftLevels) ? recenterDriftLevels : 1,
        lowerPrice,
        upperPrice,
        gridCount,
        leverageMin: leverage,
        leverageMax: leverage,
        leverageDefault: leverage,
        investMinUsd,
        investMaxUsd: deriveInvestMaxUsd(investMinUsd),
        investDefaultUsd: investMinUsd,
        slippageDefaultPct,
        slippageMinPct: 0.0001,
        slippageMaxPct: 5,
        tpDefaultPct,
        slDefaultPct,
        allowAutoMargin: form.marginPolicy === "AUTO_ALLOWED",
        allowManualMarginAdjust: form.allowManualMarginAdjust,
        allowProfitWithdraw: form.allowProfitWithdraw,
        version: Number.isFinite(version) && version >= 1 ? version : 1
      },
      reason: null
    };
  }

  useEffect(() => {
    const draftPayload = buildDraftTemplatePayload();
    if (!draftPayload.payload) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(draftPayload.reason ?? tCreate("preview.errors.completeTemplateSettings"));
      return;
    }
    if (!previewAccountId) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.selectExchangeAccount"));
      return;
    }

    const investUsd = parseNumberInput(previewInvestUsd, Number.NaN);
    if (!Number.isFinite(investUsd) || investUsd <= 0) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.investGreaterThanZero"));
      return;
    }
    const extraMarginUsd = parseNumberInput(previewExtraMarginUsd, 0);
    if (!Number.isFinite(extraMarginUsd) || extraMarginUsd < 0) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.extraMarginNonNegative"));
      return;
    }

    const tpPct = previewTpPct.trim() ? parseNumberInput(previewTpPct, Number.NaN) : null;
    if (tpPct !== null && (!Number.isFinite(tpPct) || tpPct <= 0 || tpPct > 200)) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.tpRange"));
      return;
    }
    const slPct = previewSlPct.trim() ? parseNumberInput(previewSlPct, Number.NaN) : null;
    if (slPct !== null && (!Number.isFinite(slPct) || slPct <= 0 || slPct > 200)) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.slRange"));
      return;
    }
    const triggerPrice = previewTriggerPrice.trim() ? parseNumberInput(previewTriggerPrice, Number.NaN) : null;
    if (triggerPrice !== null && (!Number.isFinite(triggerPrice) || triggerPrice <= 0)) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.triggerGreaterThanZero"));
      return;
    }
    const markPriceOverride = previewMarkOverride.trim() ? parseNumberInput(previewMarkOverride, Number.NaN) : null;
    if (markPriceOverride !== null && (!Number.isFinite(markPriceOverride) || markPriceOverride <= 0)) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(tCreate("preview.errors.markOverrideGreaterThanZero"));
      return;
    }

    const requestId = ++previewRequestSeq.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewNotice(tCreate("preview.notice"));

    const timeout = setTimeout(() => {
      void apiPost<DraftPreviewResponse>("/admin/grid/templates/draft-preview", {
        draftTemplate: draftPayload.payload,
        previewInput: {
          exchangeAccountId: previewAccountId,
          investUsd,
          extraMarginUsd,
          marginMode: previewMarginMode,
          autoMarginEnabled: previewMarginMode === "AUTO",
          triggerPrice,
          tpPct,
          slPct,
          markPriceOverride
        }
      })
        .then((response) => {
          if (requestId !== previewRequestSeq.current) return;
          setPreview(response);
          setPreviewError(null);
        })
        .catch((previewLoadError) => {
          if (requestId !== previewRequestSeq.current) return;
          setPreviewError(errMsg(previewLoadError));
        })
        .finally(() => {
          if (requestId === previewRequestSeq.current) {
            setPreviewLoading(false);
          }
        });
    }, 450);

    return () => {
      clearTimeout(timeout);
    };
  }, [
    form,
    previewAccountId,
    previewInvestUsd,
    previewExtraMarginUsd,
    previewTpPct,
    previewSlPct,
    previewTriggerPrice,
    previewMarkOverride,
    previewMarginMode
  ]);

  async function createTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const name = form.name.trim();
      const symbol = form.symbol.trim().toUpperCase();
      const lowerPrice = parseNumberInput(form.lowerPrice, Number.NaN);
      const upperPrice = parseNumberInput(form.upperPrice, Number.NaN);
      const gridCount = Math.trunc(parseNumberInput(form.gridCount, Number.NaN));
      const leverage = Math.trunc(parseNumberInput(form.leverage, Number.NaN));
      const investMinUsd = parseNumberInput(form.investMinUsd, Number.NaN);
      const slippageDefaultPct = parseNumberInput(form.slippageDefaultPct, Number.NaN);
      const version = Math.trunc(parseNumberInput(form.version, Number.NaN));
      const longBudgetPct = parseNumberInput(form.longBudgetPct, Number.NaN);
      const shortBudgetPct = parseNumberInput(form.shortBudgetPct, Number.NaN);
      const tpDefaultPct = form.tpDefaultPct.trim() ? parseNumberInput(form.tpDefaultPct, Number.NaN) : null;
      const slDefaultPct = form.slDefaultPct.trim() ? parseNumberInput(form.slDefaultPct, Number.NaN) : null;
      const autoMarginMaxUSDT = parseNumberInput(form.autoMarginMaxUSDT, Number.NaN);
      const autoMarginTriggerValue = parseNumberInput(form.autoMarginTriggerValue, Number.NaN);
      const autoMarginStepUSDT = parseNumberInput(form.autoMarginStepUSDT, Number.NaN);
      const autoMarginCooldownSec = Math.trunc(parseNumberInput(form.autoMarginCooldownSec, Number.NaN));
      const autoReserveFixedGridPct = parseNumberInput(form.autoReserveFixedGridPct, Number.NaN);
      const autoReserveTargetLiqDistancePct = form.autoReserveTargetLiqDistancePct.trim()
        ? parseNumberInput(form.autoReserveTargetLiqDistancePct, Number.NaN)
        : null;
      const autoReserveMaxPreviewIterations = Math.trunc(parseNumberInput(form.autoReserveMaxPreviewIterations, Number.NaN));
      const initialSeedPct = parseNumberInput(form.initialSeedPct, Number.NaN);
      const activeOrderWindowSize = Math.trunc(parseNumberInput(form.activeOrderWindowSize, Number.NaN));
      const recenterDriftLevels = Math.trunc(parseNumberInput(form.recenterDriftLevels, Number.NaN));

      if (!name) {
        setError(tCreate("errors.nameRequired"));
        return;
      }
      if (!symbol) {
        setError(tCreate("errors.symbolRequired"));
        return;
      }

      if (!Number.isFinite(lowerPrice) || lowerPrice <= 0) {
        setError(tCreate("errors.lowerPriceInvalid"));
        return;
      }
      if (!Number.isFinite(upperPrice) || upperPrice <= lowerPrice) {
        setError(tCreate("errors.upperPriceGreaterThanLower"));
        return;
      }
      if (!Number.isFinite(gridCount) || gridCount < 2 || gridCount > 500) {
        setError(tCreate("errors.gridCountRange"));
        return;
      }
      if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
        setError(tCreate("errors.leverageRange"));
        return;
      }
      if (!Number.isFinite(investMinUsd) || investMinUsd <= 0) {
        setError(tCreate("errors.investMinInvalid"));
        return;
      }
      if (!Number.isFinite(slippageDefaultPct) || slippageDefaultPct < 0.0001 || slippageDefaultPct > 5) {
        setError(tCreate("errors.slippageRange"));
        return;
      }
      if (!Number.isFinite(longBudgetPct) || longBudgetPct < 0 || longBudgetPct > 100) {
        setError(tCreate("errors.longBudgetRange"));
        return;
      }
      if (!Number.isFinite(shortBudgetPct) || shortBudgetPct < 0 || shortBudgetPct > 100) {
        setError(tCreate("errors.shortBudgetRange"));
        return;
      }
      if (form.autoReservePolicy === "FIXED_RATIO") {
        if (!Number.isFinite(autoReserveFixedGridPct) || autoReserveFixedGridPct < 0 || autoReserveFixedGridPct > 100) {
          setError(tCreate("errors.autoReserveFixedRange"));
          return;
        }
      }
      if (form.autoReservePolicy === "LIQ_GUARD_MAX_GRID") {
        if (!Number.isFinite(autoReserveMaxPreviewIterations) || autoReserveMaxPreviewIterations < 1 || autoReserveMaxPreviewIterations > 16) {
          setError(tCreate("errors.autoReserveIterationsRange"));
          return;
        }
      }
      if (!Number.isFinite(initialSeedPct) || initialSeedPct < 0 || initialSeedPct > 60) {
        setError(tCreate("errors.initialSeedPctRange"));
        return;
      }
      if (!Number.isFinite(activeOrderWindowSize) || activeOrderWindowSize < 40 || activeOrderWindowSize > 120) {
        setError(tCreate("errors.activeOrderWindowSizeRange"));
        return;
      }
      if (!Number.isFinite(recenterDriftLevels) || recenterDriftLevels < 1 || recenterDriftLevels > 10) {
        setError(tCreate("errors.recenterDriftLevelsRange"));
        return;
      }
      if (autoReserveTargetLiqDistancePct !== null && (!Number.isFinite(autoReserveTargetLiqDistancePct) || autoReserveTargetLiqDistancePct <= 0 || autoReserveTargetLiqDistancePct > 100)) {
        setError(tCreate("errors.autoReserveTargetRange"));
        return;
      }
      if (form.mode === "cross" && form.budgetSplitPolicy === "FIXED_CUSTOM" && Math.abs((longBudgetPct + shortBudgetPct) - 100) > 0.000001) {
        setError(tCreate("errors.budgetSplitMustEqual100"));
        return;
      }
      if (form.marginPolicy === "AUTO_ALLOWED") {
        if (!Number.isFinite(autoMarginMaxUSDT) || autoMarginMaxUSDT < 0) {
          setError(tCreate("errors.autoMarginMaxInvalid"));
          return;
        }
        if (!Number.isFinite(autoMarginTriggerValue) || autoMarginTriggerValue <= 0) {
          setError(tCreate("errors.autoMarginTriggerInvalid"));
          return;
        }
        if (!Number.isFinite(autoMarginStepUSDT) || autoMarginStepUSDT <= 0) {
          setError(tCreate("errors.autoMarginStepInvalid"));
          return;
        }
        if (!Number.isFinite(autoMarginCooldownSec) || autoMarginCooldownSec < 0) {
          setError(tCreate("errors.autoMarginCooldownInvalid"));
          return;
        }
      }
      if (tpDefaultPct !== null && (!Number.isFinite(tpDefaultPct) || tpDefaultPct <= 0 || tpDefaultPct > 200)) {
        setError(tCreate("errors.tpDefaultRange"));
        return;
      }
      if (slDefaultPct !== null && (!Number.isFinite(slDefaultPct) || slDefaultPct <= 0 || slDefaultPct > 200)) {
        setError(tCreate("errors.slDefaultRange"));
        return;
      }
      if (!Number.isFinite(version) || version < 1) {
        setError(tCreate("errors.versionMin"));
        return;
      }

      const payload = {
        name,
        description: form.description.trim() || undefined,
        symbol,
        marketType: "perp" as const,
        mode: form.mode,
        gridMode: form.gridMode,
        allocationMode: form.allocationMode,
        budgetSplitPolicy: form.budgetSplitPolicy,
        longBudgetPct,
        shortBudgetPct,
        marginPolicy: form.marginPolicy,
        autoMarginMaxUSDT: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginMaxUSDT : null,
        autoMarginTriggerType: form.marginPolicy === "AUTO_ALLOWED" ? form.autoMarginTriggerType : null,
        autoMarginTriggerValue: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginTriggerValue : null,
        autoMarginStepUSDT: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginStepUSDT : null,
        autoMarginCooldownSec: form.marginPolicy === "AUTO_ALLOWED" ? autoMarginCooldownSec : null,
        autoReservePolicy: form.autoReservePolicy,
        autoReserveFixedGridPct: Number.isFinite(autoReserveFixedGridPct) ? autoReserveFixedGridPct : 70,
        autoReserveTargetLiqDistancePct: autoReserveTargetLiqDistancePct,
        autoReserveMaxPreviewIterations: Number.isFinite(autoReserveMaxPreviewIterations) ? autoReserveMaxPreviewIterations : 8,
        initialSeedEnabled: form.initialSeedEnabled,
        initialSeedPct: Number.isFinite(initialSeedPct) ? initialSeedPct : 30,
        activeOrderWindowSize: Number.isFinite(activeOrderWindowSize) ? activeOrderWindowSize : 100,
        recenterDriftLevels: Number.isFinite(recenterDriftLevels) ? recenterDriftLevels : 1,
        lowerPrice,
        upperPrice,
        gridCount,
        leverageMin: leverage,
        leverageMax: leverage,
        leverageDefault: leverage,
        investMinUsd,
        investMaxUsd: deriveInvestMaxUsd(investMinUsd),
        investDefaultUsd: investMinUsd,
        slippageDefaultPct,
        slippageMinPct: 0.0001,
        slippageMaxPct: 5,
        tpDefaultPct,
        slDefaultPct,
        allowAutoMargin: form.marginPolicy === "AUTO_ALLOWED",
        allowManualMarginAdjust: form.allowManualMarginAdjust,
        allowProfitWithdraw: form.allowProfitWithdraw,
        version
      };

      await apiPost<GridTemplate>("/admin/grid/templates", payload);
      setNotice(tCreate("messages.created"));
      setForm(DEFAULT_FORM);
      setPreviewMarginMode(DEFAULT_FORM.marginPolicy === "AUTO_ALLOWED" ? "AUTO" : "MANUAL");
      setPreviewMarginModeTouched(false);
      await load();
    } catch (createError) {
      const details = validationDetails(createError);
      setError(details ? `${errMsg(createError)} | ${details}` : errMsg(createError));
    } finally {
      setSaving(false);
    }
  }

  async function setPublishState(template: GridTemplate, publish: boolean) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (publish) {
        await apiPost(`/admin/grid/templates/${template.id}/publish`, {});
        setNotice(tCreate("messages.published", { name: template.name }));
      } else {
        await apiPost(`/admin/grid/templates/${template.id}/archive`, {});
        setNotice(tCreate("messages.archived", { name: template.name }));
      }
      await load();
    } catch (publishError) {
      setError(errMsg(publishError));
    } finally {
      setSaving(false);
    }
  }

  async function bumpVersion(template: GridTemplate) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiPut(`/admin/grid/templates/${template.id}`, {
        version: Number(template.version) + 1,
        isArchived: false
      });
      setNotice(tCreate("messages.versionBumped", { name: template.name }));
      await load();
    } catch (bumpError) {
      setError(errMsg(bumpError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settingsWrap" style={{ maxWidth: 1400 }}>

      <h2 style={{ marginTop: 0 }}>{tCreate("title")}</h2>
      <div className="settingsMutedText" style={{ marginBottom: 12 }}>
        {tCreate("subtitle")}
      </div>

      {error ? <div className="card settingsSection settingsAlert settingsAlertError">{error}</div> : null}
      {notice ? <div className="card settingsSection settingsAlert settingsAlertSuccess">{notice}</div> : null}

      <section className="card settingsSection">
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>{tCreate("createTitle")}</h3>
          <div className="settingsSectionMeta">{tCreate("createMeta")}</div>
        </div>
        <div className="gridTemplateCreateLayout" style={{ marginTop: 12 }}>
        <form onSubmit={createTemplate} className="settingsFormGrid gridTemplateFormCompact">
          <label>
            {tCreate("fields.name")}
            <input className="input" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.symbol")}
            <input className="input" value={form.symbol} onChange={(event) => setForm((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} required />
          </label>
          <label>
            {tCreate("fields.mode")}
            <select className="input" value={form.mode} onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value as GridMode }))}>
              <option value="long">{labelFromMode("long", tCreate)}</option>
              <option value="short">{labelFromMode("short", tCreate)}</option>
              <option value="neutral">{labelFromMode("neutral", tCreate)}</option>
              <option value="cross">{labelFromMode("cross", tCreate)}</option>
            </select>
          </label>
          <label>
            {tCreate("fields.gridMode")}
            <select className="input" value={form.gridMode} onChange={(event) => setForm((prev) => ({ ...prev, gridMode: event.target.value as GridPriceMode }))}>
              <option value="arithmetic">{labelFromGridMode("arithmetic", tCreate)}</option>
              <option value="geometric">{labelFromGridMode("geometric", tCreate)}</option>
            </select>
          </label>
          <label>
            {tCreate("fields.allocationMode")}
            <select className="input" value={form.allocationMode} onChange={(event) => setForm((prev) => ({ ...prev, allocationMode: event.target.value as GridAllocationMode }))}>
              <option value="EQUAL_NOTIONAL_PER_GRID">{labelFromAllocationMode("EQUAL_NOTIONAL_PER_GRID", tCreate)}</option>
              <option value="EQUAL_BASE_QTY_PER_GRID">{labelFromAllocationMode("EQUAL_BASE_QTY_PER_GRID", tCreate)}</option>
              <option value="WEIGHTED_NEAR_PRICE" disabled>{tCreate("comingSoon.weightedNearPrice")}</option>
            </select>
          </label>
          {form.mode === "cross" ? (
            <>
              <label>
                {tCreate("fields.budgetSplitPolicy")}
                <select className="input" value={form.budgetSplitPolicy} onChange={(event) => setForm((prev) => ({ ...prev, budgetSplitPolicy: event.target.value as GridBudgetSplitPolicy }))}>
                  <option value="FIXED_50_50">{labelFromBudgetSplitPolicy("FIXED_50_50", tCreate)}</option>
                  <option value="FIXED_CUSTOM">{labelFromBudgetSplitPolicy("FIXED_CUSTOM", tCreate)}</option>
                  <option value="DYNAMIC_BY_PRICE_POSITION" disabled>{tCreate("comingSoon.dynamicByPricePosition")}</option>
                </select>
              </label>
              <label>
                {tCreate("fields.longBudgetPct")}
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.longBudgetPct}
                  disabled={form.budgetSplitPolicy !== "FIXED_CUSTOM"}
                  onChange={(event) => setForm((prev) => ({ ...prev, longBudgetPct: event.target.value }))}
                />
              </label>
              <label>
                {tCreate("fields.shortBudgetPct")}
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.shortBudgetPct}
                  disabled={form.budgetSplitPolicy !== "FIXED_CUSTOM"}
                  onChange={(event) => setForm((prev) => ({ ...prev, shortBudgetPct: event.target.value }))}
                />
              </label>
            </>
          ) : (
            <div className="settingsMutedText" style={{ gridColumn: "1 / -1", fontSize: 12 }}>
              {tCreate("hints.splitOnlyCross")}
            </div>
          )}
          <label>
            {tCreate("fields.marginPolicy")}
            <select
              className="input"
              value={form.marginPolicy}
              onChange={(event) => setForm((prev) => ({ ...prev, marginPolicy: event.target.value as GridMarginPolicy }))}
            >
              <option value="MANUAL_ONLY">{labelFromMarginPolicy("MANUAL_ONLY", tCreate)}</option>
              <option value="AUTO_ALLOWED">{labelFromMarginPolicy("AUTO_ALLOWED", tCreate)}</option>
            </select>
          </label>
          <label>
            {tCreate("fields.autoReservePolicy")}
            <select
              className="input"
              value={form.autoReservePolicy}
              onChange={(event) => setForm((prev) => ({ ...prev, autoReservePolicy: event.target.value as GridAutoReservePolicy }))}
            >
              <option value="LIQ_GUARD_MAX_GRID">{labelFromAutoReservePolicy("LIQ_GUARD_MAX_GRID", tCreate)}</option>
              <option value="FIXED_RATIO">{labelFromAutoReservePolicy("FIXED_RATIO", tCreate)}</option>
            </select>
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="settingsMutedText" style={{ fontSize: 12 }}>{tCreate("fields.preset")}</span>
            {(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const).map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                className="btn"
                onClick={() => applyAutoReservePreset(presetKey)}
              >
                {tCreate(AUTO_RESERVE_PRESETS[presetKey].labelKey)}
              </button>
            ))}
          </div>
          <label>
            {tCreate("fields.autoReserveFixedGridPct")}
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.autoReserveFixedGridPct}
              disabled={form.autoReservePolicy !== "FIXED_RATIO"}
              onChange={(event) => setForm((prev) => ({ ...prev, autoReserveFixedGridPct: event.target.value }))}
            />
          </label>
          <label>
            {tCreate("fields.autoReserveTargetLiqDistancePct")}
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder={tCreate("fields.defaultVenueSystem")}
              value={form.autoReserveTargetLiqDistancePct}
              onChange={(event) => setForm((prev) => ({ ...prev, autoReserveTargetLiqDistancePct: event.target.value }))}
            />
          </label>
          <label>
            {tCreate("fields.autoReserveMaxPreviewIterations")}
            <input
              className="input"
              type="number"
              min="1"
              max="16"
              step="1"
              value={form.autoReserveMaxPreviewIterations}
              disabled={form.autoReservePolicy !== "LIQ_GUARD_MAX_GRID"}
              onChange={(event) => setForm((prev) => ({ ...prev, autoReserveMaxPreviewIterations: event.target.value }))}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <input
              type="checkbox"
              checked={form.initialSeedEnabled}
              onChange={(event) => setForm((prev) => ({ ...prev, initialSeedEnabled: event.target.checked }))}
            />
            <span>{tCreate("fields.initialSeedEnabled")}</span>
          </label>
          <label>
            {tCreate("fields.initialSeedPct")}
            <input
              className="input"
              type="number"
              min="0"
              max="60"
              step="0.1"
              value={form.initialSeedPct}
              onChange={(event) => setForm((prev) => ({ ...prev, initialSeedPct: event.target.value }))}
            />
          </label>
          <label>
            {tCreate("fields.activeOrderWindowSize")}
            <input
              className="input"
              type="number"
              min="40"
              max="120"
              step="1"
              value={form.activeOrderWindowSize}
              onChange={(event) => setForm((prev) => ({ ...prev, activeOrderWindowSize: event.target.value }))}
            />
          </label>
          <label>
            {tCreate("fields.recenterDriftLevels")}
            <input
              className="input"
              type="number"
              min="1"
              max="10"
              step="1"
              value={form.recenterDriftLevels}
              onChange={(event) => setForm((prev) => ({ ...prev, recenterDriftLevels: event.target.value }))}
            />
          </label>
          <label>
            {tCreate("fields.lowerPrice")}
            <input className="input" type="number" step="0.0001" min="0" value={form.lowerPrice} onChange={(event) => setForm((prev) => ({ ...prev, lowerPrice: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.upperPrice")}
            <input className="input" type="number" step="0.0001" min="0" value={form.upperPrice} onChange={(event) => setForm((prev) => ({ ...prev, upperPrice: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.gridCount")}
            <input className="input" type="number" min="2" max="500" value={form.gridCount} onChange={(event) => setForm((prev) => ({ ...prev, gridCount: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.leverageFixed")}
            <input className="input" type="number" min="1" max="125" value={form.leverage} onChange={(event) => setForm((prev) => ({ ...prev, leverage: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.investMinUsd")}
            <input className="input" type="number" min="1" step="0.01" value={form.investMinUsd} onChange={(event) => setForm((prev) => ({ ...prev, investMinUsd: event.target.value }))} required />
          </label>
          <label>
            {tCreate("fields.slippageDefaultPct")}
            <input className="input" type="number" min="0.0001" max="5" step="0.0001" value={form.slippageDefaultPct} onChange={(event) => setForm((prev) => ({ ...prev, slippageDefaultPct: event.target.value }))} required />
          </label>
          {form.marginPolicy === "AUTO_ALLOWED" ? (
            <>
              <label>
                {tCreate("fields.autoMarginMaxUsdt")}
                <input className="input" type="number" min="0" step="0.01" value={form.autoMarginMaxUSDT} onChange={(event) => setForm((prev) => ({ ...prev, autoMarginMaxUSDT: event.target.value }))} />
              </label>
              <label>
                {tCreate("fields.autoMarginTrigger")}
                <select className="input" value={form.autoMarginTriggerType} onChange={(event) => setForm((prev) => ({ ...prev, autoMarginTriggerType: event.target.value as GridAutoMarginTriggerType }))}>
                  <option value="LIQ_DISTANCE_PCT_BELOW">{labelFromTriggerType("LIQ_DISTANCE_PCT_BELOW", tCreate)}</option>
                  <option value="MARGIN_RATIO_ABOVE">{labelFromTriggerType("MARGIN_RATIO_ABOVE", tCreate)}</option>
                </select>
              </label>
              <label>
                {tCreate("fields.autoMarginTriggerValue")}
                <input className="input" type="number" min="0.0001" step="0.01" value={form.autoMarginTriggerValue} onChange={(event) => setForm((prev) => ({ ...prev, autoMarginTriggerValue: event.target.value }))} />
              </label>
              <label>
                {tCreate("fields.autoMarginStepUsdt")}
                <input className="input" type="number" min="0.01" step="0.01" value={form.autoMarginStepUSDT} onChange={(event) => setForm((prev) => ({ ...prev, autoMarginStepUSDT: event.target.value }))} />
              </label>
              <label>
                {tCreate("fields.autoMarginCooldownSec")}
                <input className="input" type="number" min="0" step="1" value={form.autoMarginCooldownSec} onChange={(event) => setForm((prev) => ({ ...prev, autoMarginCooldownSec: event.target.value }))} />
              </label>
            </>
          ) : null}
          <label>
            {tCreate("fields.tpDefaultPct")}
            <input className="input" type="number" min="0" step="0.01" placeholder={tCreate("fields.optional")} value={form.tpDefaultPct} onChange={(event) => setForm((prev) => ({ ...prev, tpDefaultPct: event.target.value }))} />
          </label>
          <label>
            {tCreate("fields.slDefaultPct")}
            <input className="input" type="number" min="0" step="0.01" placeholder={tCreate("fields.optional")} value={form.slDefaultPct} onChange={(event) => setForm((prev) => ({ ...prev, slDefaultPct: event.target.value }))} />
          </label>
          <label>
            {tCreate("fields.version")}
            <input className="input" type="number" min="1" step="1" value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            {tCreate("fields.description")}
            <textarea className="input" rows={3} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
          </label>

          <label className="settingsToggle">
            <input type="checkbox" checked={form.marginPolicy === "AUTO_ALLOWED"} readOnly />
            <span>{tCreate("fields.allowAutoMarginDerived")}</span>
          </label>
          <label className="settingsToggle">
            <input type="checkbox" checked={form.allowManualMarginAdjust} onChange={(event) => setForm((prev) => ({ ...prev, allowManualMarginAdjust: event.target.checked }))} />
            <span>{tCreate("fields.allowManualMarginAdjust")}</span>
          </label>
          <label className="settingsToggle">
            <input type="checkbox" checked={form.allowProfitWithdraw} onChange={(event) => setForm((prev) => ({ ...prev, allowProfitWithdraw: event.target.checked }))} />
            <span>{tCreate("fields.allowProfitWithdraw")}</span>
          </label>

          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn btnPrimary" type="submit" disabled={saving}>{saving ? tCommon("saving") : tCreate("actions.createTemplate")}</button>
          </div>
        </form>

        <div className="gridTemplatePreviewSticky">
        <div className="card settingsSection">
          <div className="settingsSectionHeader">
            <h4 style={{ margin: 0 }}>{tCreate("preview.title")}</h4>
            <div className="settingsSectionMeta">{tCreate("preview.meta")}</div>
          </div>
          <div className="settingsMutedText" style={{ marginTop: 8 }}>
            {previewNotice ?? tCreate("preview.notice")}
          </div>

          <div className="settingsFormGrid gridTemplatePreviewInputGrid" style={{ marginTop: 12 }}>
            <label>
              {tCreate("preview.fields.exchangeAccount")}
              <select
                className="input"
                value={previewAccountId}
                onChange={(event) => setPreviewAccountId(event.target.value)}
              >
                <option value="">{tCreate("preview.fields.selectExchangeAccount")}</option>
                {availablePreviewAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.exchange}{account.marketDataExchange ? ` -> ${account.marketDataExchange}` : ""})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tCreate("preview.fields.investUsd")}
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={previewInvestUsd}
                onChange={(event) => setPreviewInvestUsd(event.target.value)}
              />
            </label>
            <label>
              {tCreate("preview.fields.extraMarginUsd")}
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                disabled={previewMarginMode === "AUTO"}
                value={previewMarginMode === "AUTO" ? "0" : previewExtraMarginUsd}
                onChange={(event) => setPreviewExtraMarginUsd(event.target.value)}
              />
            </label>
            <label>
              {tCreate("preview.fields.marginMode")}
              <select
                className="input"
                value={previewMarginMode}
                onChange={(event) => {
                  setPreviewMarginMode(event.target.value as GridInstanceMarginMode);
                  setPreviewMarginModeTouched(true);
                }}
              >
                <option value="MANUAL">{tCreate("preview.fields.manual")}</option>
                <option value="AUTO" disabled={form.marginPolicy !== "AUTO_ALLOWED"}>{tCreate("preview.fields.auto")}</option>
              </select>
            </label>
            <label>
              {tCreate("preview.fields.triggerPriceOptional")}
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                value={previewTriggerPrice}
                onChange={(event) => setPreviewTriggerPrice(event.target.value)}
              />
            </label>
            <label>
              {tCreate("preview.fields.tpPct")}
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={previewTpPct}
                onChange={(event) => setPreviewTpPct(event.target.value)}
              />
            </label>
            <label>
              {tCreate("preview.fields.slPct")}
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={previewSlPct}
                onChange={(event) => setPreviewSlPct(event.target.value)}
              />
            </label>
            <label>
              {tCreate("preview.fields.markPriceOverrideOptional")}
              <input
                className="input"
                type="number"
                min="0"
                step="0.0001"
                value={previewMarkOverride}
                onChange={(event) => setPreviewMarkOverride(event.target.value)}
              />
            </label>
          </div>

          {previewLoading ? (
            <div className="settingsMutedText" style={{ marginTop: 12 }}>{tCreate("preview.loading")}</div>
          ) : null}
          {previewError ? (
            <div className="settingsAlert settingsAlertError" style={{ marginTop: 12 }}>{previewError}</div>
          ) : null}
          {preview ? (
            <div
              className="card settingsSection"
              style={{
                marginTop: 12,
                borderColor: previewInsufficient ? "#ef4444" : previewLiqRiskActive ? "#f59e0b" : "var(--border)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h4 style={{ margin: 0 }}>{tCreate("preview.title")}</h4>
                <span className={`badge ${previewInsufficient ? "badgeWarn" : previewLiqRiskActive ? "badgeWarn" : "badgeOk"}`}>
                  {previewInsufficient
                    ? tCreate("preview.status.insufficientBudget")
                    : previewLiqRiskActive
                      ? tCreate("preview.status.liqRisk")
                      : preview.status?.ready === false
                        ? tCreate("preview.status.needsReview")
                        : tCreate("preview.status.ready")}
                </span>
              </div>
              <div className="settingsFormGrid gridTemplatePreviewStatsGrid" style={{ marginTop: 10 }}>
                <div className="settingsMutedText">{tCreate("preview.stats.actualInvestAfterLeverage")}: <strong>{formatNumber(preview.allocation.totalBudgetUsd * parseNumberInput(form.leverage, 1), 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.minInvest")}: <strong>{formatNumber(preview.minInvestmentUSDT, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.minInvestLong")}: <strong>{formatNumber(preview.minInvestmentBreakdown?.long ?? null, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.minInvestShort")}: <strong>{formatNumber(preview.minInvestmentBreakdown?.short ?? null, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.minInvestSeed")}: <strong>{formatNumber(preview.minInvestmentBreakdown?.seed ?? null, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.mark")}: <strong>{formatNumber(preview.markPrice, 4)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.marketDataVenue")}: <strong>{selectedPreviewAccount?.marketDataExchange ? `${selectedPreviewAccount.marketDataExchange}${selectedPreviewAccount.marketDataLabel ? ` · ${selectedPreviewAccount.marketDataLabel}` : ""}` : "n/a"}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.marginMode")}: <strong>{labelFromMarginPolicy((preview.marginMode ?? previewMarginMode) === "AUTO" ? "AUTO_ALLOWED" : "MANUAL_ONLY", tCreate)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.reservePolicy")}: <strong>{labelFromAutoReservePolicy(preview.allocation.policy, tCreate)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.splitMode")}: <strong>{labelFromSplitMode(preview.allocation.splitMode, tCreate)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.targetLiqDistance")}: <strong>{formatNumber(preview.allocation.targetLiqDistancePct ?? null, 2)}%</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.searchIterations")}: <strong>{formatNumber(preview.allocation.searchIterationsUsed, 0)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.activeOrdersTotal")}: <strong>{formatNumber(preview.windowMeta?.activeOrdersTotal ?? null, 0)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.activeBuysSells")}: <strong>{formatNumber(preview.windowMeta?.activeBuys ?? null, 0)} / {formatNumber(preview.windowMeta?.activeSells ?? null, 0)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.windowRange")}: <strong>{formatNumber(preview.windowMeta?.windowLowerIdx ?? null, 0)}-{formatNumber(preview.windowMeta?.windowUpperIdx ?? null, 0)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.windowPriceRange")}: <strong>{formatNumber(preview.windowMeta?.activeRangeLowPrice ?? null, 2)} → {formatNumber(preview.windowMeta?.activeRangeHighPrice ?? null, 2)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.gridAllocation")}: <strong>{formatNumber(preview.allocation.gridInvestUsd, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.marginAllocation")}: <strong>{formatNumber(preview.allocation.extraMarginUsd, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.gridInvestAfterSeed")}: <strong>{formatNumber(preview.allocationBreakdown?.effectiveGridInvestUsd ?? null, 2)} USDT</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.liqLong")}: <strong>{formatNumber(preview.liq.liqEstimateLong, 2)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.liqShort")}: <strong>{formatNumber(preview.liq.liqEstimateShort, 2)}</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.worstCaseLiqDistance")}: <strong>{formatNumber(preview.liq.worstCaseLiqDistancePct, 2)}%</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.minLiqDistance")}: <strong>{formatNumber(preview.liq.liqDistanceMinPct, 2)}%</strong></div>
                <div className="settingsMutedText">{tCreate("preview.stats.profitPerGridEstimate")}: <strong>{formatNumber(preview.profitPerGridEstimateUSDT ?? null, 4)} USDT</strong></div>
                {preview.initialSeed?.enabled ? (
                  <div className="settingsMutedText" style={{ gridColumn: "1 / -1" }}>
                    {tCreate("preview.stats.initialSeedLine", {
                      side: preview.initialSeed.seedSide ?? "n/a",
                      qty: formatNumber(preview.initialSeed.seedQty ?? null, 6),
                      notional: formatNumber(preview.initialSeed.seedNotionalUsd ?? null, 2),
                      margin: formatNumber(preview.initialSeed.seedMarginUsd ?? null, 2),
                      pct: formatNumber(preview.initialSeed.seedPct ?? null, 2)
                    })}
                  </div>
                ) : null}
              </div>
              {Array.isArray(preview.allocation.reasonCodes) && preview.allocation.reasonCodes.length > 0 ? (
                <div className="settingsMutedText" style={{ marginTop: 8 }}>
                  {tCreate("preview.stats.splitReasons")}: <strong>{preview.allocation.reasonCodes.map((code) => labelFromReasonCode(code, tCreate)).join(", ")}</strong>
                </div>
              ) : null}
              {preview.venueChecks ? (
                <div className="settingsMutedText" style={{ marginTop: 8 }}>
                  {tCreate("preview.stats.venueChecks")}: <strong>{[
                    `minQty=${formatNumber(preview.venueChecks.minQtyUsed ?? null, 6)}`,
                    `minNotional=${formatNumber(preview.venueChecks.minNotionalUsed ?? null, 2)}`,
                    `stepRound=${preview.venueChecks.roundedByStep ? "yes" : "no"}`,
                    `fallback=${preview.venueChecks.fallbackUsed ? "yes" : "no"}`
                  ].join(" · ")}</strong>
                </div>
              ) : null}
              {Array.isArray(preview.status?.codes) && preview.status!.codes.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {preview.status!.codes.map((code) => (
                    <span key={code} className={`tag tag-${toneFromReasonCode(code)}`}>{labelFromReasonCode(code, tCreate)}</span>
                  ))}
                </div>
              ) : null}
              {Array.isArray(preview.warnings) && preview.warnings.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {preview.warnings.map((warning) => (
                    <span key={warning} className={`tag tag-${toneFromReasonCode(warning)}`}>{labelFromReasonCode(warning, tCreate)}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        </div>
        </div>
      </section>

      <section className="card settingsSection" style={{ marginTop: 12 }}>
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>{tCreate("list.title")}</h3>
          <label className="settingsToggle" style={{ margin: 0 }}>
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            <span>{tCreate("list.showArchived")}</span>
          </label>
        </div>

        {loading ? (
          <div className="settingsMutedText">{tCreate("list.loading")}</div>
        ) : activeItems.length === 0 ? (
          <div className="settingsMutedText">{tCreate("list.empty")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {activeItems.map((template) => (
              <article key={template.id} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{template.name}</div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {template.symbol} · {labelFromMode(template.mode, tCreate)} · {labelFromGridMode(template.gridMode, tCreate)} · {tCreate("list.labels.grids")} {template.gridCount}
                    </div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {tCreate("list.labels.allocation")} {labelFromAllocationMode(template.allocationMode, tCreate)}
                      {template.mode === "cross"
                        ? ` · ${tCreate("list.labels.split")} ${labelFromBudgetSplitPolicy(template.budgetSplitPolicy, tCreate)} (${formatNumber(template.longBudgetPct, 2)} / ${formatNumber(template.shortBudgetPct, 2)})`
                        : ` · ${tCreate("hints.splitOnlyCross")}`}
                    </div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {tCreate("list.labels.marginPolicy")} {labelFromMarginPolicy(template.marginPolicy, tCreate)} · {tCreate("list.labels.reserve")} {labelFromAutoReservePolicy(template.autoReservePolicy, tCreate)}
                    </div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {tCreate("list.labels.reserveFixed")} {formatNumber(template.autoReserveFixedGridPct, 2)}% · {tCreate("list.labels.reserveLiqTarget")} {formatNumber(template.autoReserveTargetLiqDistancePct, 2)}% · {tCreate("list.labels.reserveIterations")} {formatNumber(template.autoReserveMaxPreviewIterations, 0)}
                    </div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {tCreate("list.labels.range")} {formatNumber(template.lowerPrice, 2)} → {formatNumber(template.upperPrice, 2)} · v{template.version} · {tCreate("list.labels.updated")} {formatDateTime(template.updatedAt)}
                    </div>
                    <div className="settingsMutedText" style={{ fontSize: 12 }}>
                      {tCreate("list.labels.publish")}: {template.isPublished ? tCreate("list.values.yes") : tCreate("list.values.no")} · {tCreate("list.labels.archived")}: {template.isArchived ? tCreate("list.values.yes") : tCreate("list.values.no")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Link href={withLocalePath(`/admin/grid-templates/${template.id}`, locale)} className="btn">{tCreate("list.actions.open")}</Link>
                    <button className="btn" onClick={() => void bumpVersion(template)} disabled={saving}>{tCreate("list.actions.bumpVersion")}</button>
                    {template.isPublished ? (
                      <button className="btn btnDanger" onClick={() => void setPublishState(template, false)} disabled={saving}>{tCreate("list.actions.archive")}</button>
                    ) : (
                      <button className="btn btnPrimary" onClick={() => void setPublishState(template, true)} disabled={saving}>{tCreate("list.actions.publish")}</button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
