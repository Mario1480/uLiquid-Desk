"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiDelete, apiGet, apiPost } from "../../../lib/api";
import { buildBotVaultFundingBreakdown, type BotVaultFundingBreakdown } from "../../../components/grid/botVaultFunding";
import { useOnchainActionFlow } from "../../../components/grid/OnchainVaultActions";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import type {
  BotVaultSnapshot,
  ExchangeAccount,
  GridInstance,
  GridInstanceCreateResponse,
  GridInstancePreviewResponse,
  GridTemplate,
  GridTemplateFiltersResponse
} from "../../../components/grid/types";
import {
  createIdempotencyKey,
  errMsg,
  formatNumber,
  isPerpCapable,
  normalizeGridProvisioningPhase,
  provisioningPhaseTone,
  readAllowedGridExchanges
} from "../../../components/grid/utils";
import { buildGridCatalogQuery, updateGridCatalogFavoriteState } from "../../../src/grid/catalog";
import { deriveNeutralModePreviewHints } from "../../../src/grid/neutralModeHints";

type GridPilotAccess = {
  allowed: boolean;
  reason: "admin" | "allowlist" | "disabled" | "not_listed";
  scope: "global" | "user" | "workspace" | "none";
  provider?: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid?: boolean;
};

function usesHyperliquidMarketData(account: ExchangeAccount | null | undefined): boolean {
  const exchange = String(account?.exchange ?? "").trim().toLowerCase();
  const marketDataExchange = String(account?.marketDataExchange ?? "").trim().toLowerCase();
  return exchange === "hyperliquid" || marketDataExchange === "hyperliquid";
}

function formatExecutionAccountOption(row: ExchangeAccount): string {
  if (usesHyperliquidMarketData(row)) {
    return `${row.label} (HyperVaults)`;
  }
  const exchange = String(row.exchange ?? "").trim();
  const marketDataExchange = String(row.marketDataExchange ?? "").trim();
  if (exchange && marketDataExchange && exchange.toLowerCase() !== marketDataExchange.toLowerCase()) {
    return `${row.label} (${exchange} -> ${marketDataExchange})`;
  }
  return exchange ? `${row.label} (${exchange})` : row.label;
}

function replaceStablecoinUnit(label: string, stablecoinLabel: string): string {
  return label.replaceAll("USDT", stablecoinLabel);
}

function formatReusableBotVaultOption(row: BotVaultSnapshot, stablecoinLabel: string): string {
  const ownerBotName = String(row.ownerSummary?.botName ?? "").trim();
  return [
    row.id,
    `${formatNumber(Number(row.availableUsd ?? 0), 2)} ${stablecoinLabel}`,
    ownerBotName
  ].filter(Boolean).join(" · ");
}

function rangeSummary(template: GridTemplate): string {
  if (template.mode === "cross" && template.crossSideConfig) {
    return `L ${formatNumber(template.crossSideConfig.long.lowerPrice, 0)}-${formatNumber(template.crossSideConfig.long.upperPrice, 0)} · S ${formatNumber(template.crossSideConfig.short.lowerPrice, 0)}-${formatNumber(template.crossSideConfig.short.upperPrice, 0)}`;
  }
  return `${formatNumber(template.lowerPrice, 0)}-${formatNumber(template.upperPrice, 0)}`;
}

function formatCatalogEnumLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function visibleCatalogTags(template: GridTemplate | null): string[] {
  if (!template || !Array.isArray(template.catalogTags)) return [];
  const redundant = new Set<string>([
    String(template.symbol ?? "").trim().toLowerCase(),
    String(template.catalogCategory ?? "").trim().toLowerCase(),
    String(template.catalogDifficulty ?? "").trim().toLowerCase(),
    String(template.catalogRiskLevel ?? "").trim().toLowerCase(),
    "featured",
  ]);
  return template.catalogTags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .filter((tag, index, source) => source.findIndex((entry) => entry.toLowerCase() === tag.toLowerCase()) === index)
    .filter((tag) => !redundant.has(tag.toLowerCase()));
}

function provisioningPhaseLabel(phase: string | null | undefined, tGrid: ReturnType<typeof useTranslations<"grid.marketplace">>): string {
  switch (normalizeGridProvisioningPhase(phase)) {
    case "pending_signature":
      return tGrid("provisioningPhasePendingSignature");
    case "submitted_waiting_indexer":
      return tGrid("provisioningPhaseSubmittedWaitingIndexer");
    case "pending_reserve_signature":
      return tGrid("provisioningPhasePendingReserveSignature");
    case "submitted_waiting_reserve_indexer":
      return tGrid("provisioningPhaseSubmittedWaitingReserveIndexer");
    case "pending_hypercore_funding_signature":
      return tGrid("provisioningPhasePendingHypercoreFundingSignature");
    case "submitted_waiting_hypercore_funding_indexer":
      return tGrid("provisioningPhaseSubmittedWaitingHypercoreFundingIndexer");
    case "ready":
    case "completed":
      return tGrid("provisioningPhaseCompleted");
    default:
      return tGrid("provisioningPhaseUnknown");
  }
}

function isBlockingProvisioningPhase(phase: string | null | undefined): boolean {
  const normalized = normalizeGridProvisioningPhase(phase);
  return (
    normalized === "pending_signature"
    || normalized === "submitted_waiting_indexer"
    || normalized === "pending_reserve_signature"
    || normalized === "submitted_waiting_reserve_indexer"
    || normalized === "pending_hypercore_funding_signature"
    || normalized === "submitted_waiting_hypercore_funding_indexer"
  );
}

type ProvisioningProgressMeta = {
  templateName: string;
  symbol: string;
  accountLabel: string;
  accountType: "exchange" | "vault";
} & BotVaultFundingBreakdown & {
  stablecoinLabel: string;
  includesCreateFee: boolean;
};

type ProvisioningProgressStep = {
  key: string;
  label: string;
  state: "complete" | "active" | "pending";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasInitialSeedExecution(instance: GridInstance | null | undefined): boolean {
  const metrics = asRecord(instance?.metricsJson);
  const initialSeed = asRecord(metrics?.initialSeed);
  if (!initialSeed) return false;
  const enabled = initialSeed.enabled !== false;
  if (!enabled) return true;
  const seedQty = Number(initialSeed.seedQty ?? NaN);
  const seedNotionalUsd = Number(initialSeed.seedNotionalUsd ?? NaN);
  const seedMarginUsd = Number(initialSeed.seedMarginUsd ?? NaN);
  return seedQty > 0 || seedNotionalUsd > 0 || seedMarginUsd > 0;
}

function hasGridPlacement(instance: GridInstance | null | undefined): boolean {
  return Boolean(
    instance?.lastPlanAt
    || String(instance?.state ?? "").trim().toLowerCase() === "running"
    || String(instance?.state ?? "").trim().toLowerCase() === "paused"
    || String(instance?.state ?? "").trim().toLowerCase() === "stopped"
  );
}

function isGridExecutionRunning(instance: GridInstance | null | undefined): boolean {
  return (
    String(instance?.state ?? "").trim().toLowerCase() === "running"
    || String(instance?.bot?.status ?? "").trim().toLowerCase() === "running"
    || String(instance?.bot?.runtime?.status ?? "").trim().toLowerCase() === "running"
    || String(instance?.botVault?.executionStatus ?? "").trim().toLowerCase() === "running"
  );
}

function buildProvisioningProgressSteps(
  instance: GridInstance | null,
  tGrid: ReturnType<typeof useTranslations<"grid.marketplace">>
): ProvisioningProgressStep[] {
  const phase = instance?.provisioningStatus?.phase;
  const normalized = normalizeGridProvisioningPhase(phase);
  const currentIndex =
    normalized === "pending_reserve_signature" || normalized === "submitted_waiting_reserve_indexer"
      ? 1
      : normalized === "pending_hypercore_funding_signature" || normalized === "submitted_waiting_hypercore_funding_indexer"
        ? 2
        : normalized === "ready" || normalized === "completed"
          ? 3
          : 0;
  const allComplete = currentIndex >= 3;
  const runComplete = isGridExecutionRunning(instance);
  const gridPlaced = hasGridPlacement(instance) || runComplete;
  const initialSeedEnabled = instance?.initialSeedEnabled !== false;
  const initialSeedComplete = !initialSeedEnabled || hasInitialSeedExecution(instance) || gridPlaced;

  const seedState: ProvisioningProgressStep["state"] =
    currentIndex < 3
      ? "pending"
      : initialSeedComplete
        ? "complete"
        : "active";
  const gridState: ProvisioningProgressStep["state"] =
    currentIndex < 3
      ? "pending"
      : gridPlaced
        ? "complete"
        : seedState === "complete"
          ? "active"
          : "pending";
  const runState: ProvisioningProgressStep["state"] =
    currentIndex < 3
      ? "pending"
      : runComplete
        ? "complete"
        : gridState === "complete"
          ? "active"
          : "pending";

  return [
    {
      key: "create",
      label: tGrid("provisioningStepCreateVault"),
      state: allComplete || currentIndex > 0 ? "complete" : currentIndex === 0 ? "active" : "pending"
    },
    {
      key: "reserve",
      label: tGrid("provisioningStepReserveCapital"),
      state: allComplete || currentIndex > 1 ? "complete" : currentIndex === 1 ? "active" : "pending"
    },
    {
      key: "fund",
      label: tGrid("provisioningStepFundHypercore"),
      state: allComplete || currentIndex > 2 ? "complete" : currentIndex === 2 ? "active" : "pending"
    },
    {
      key: "seed",
      label: tGrid("provisioningStepFirstSeed"),
      state: seedState
    },
    {
      key: "place-grid",
      label: tGrid("provisioningStepPlaceGrid"),
      state: gridState
    },
    {
      key: "run",
      label: tGrid("provisioningStepRunBot"),
      state: runState
    }
  ];
}

function provisioningProgressToneLabel(
  state: ProvisioningProgressStep["state"],
  tGrid: ReturnType<typeof useTranslations<"grid.marketplace">>
): string {
  if (state === "complete") return tGrid("provisioningStepStateDone");
  if (state === "active") return tGrid("provisioningStepStateActive");
  return tGrid("provisioningStepStatePending");
}

function formatGridPreviewError(message: string, tGrid: ReturnType<typeof useTranslations<"grid.marketplace">>): string {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return message;
  if (
    normalized.includes("grid_python_http_401")
    || normalized.includes("strategy_auth_failed")
    || normalized.includes("grid runtime authorization failed")
  ) {
    return tGrid("previewRuntimeAuthError");
  }
  return message;
}

export default function GridBotCatalogPage() {
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const tGrid = useTranslations("grid.marketplace");
  const allowedGridExchanges = useMemo(() => readAllowedGridExchanges(), []);
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null);
  const [createdInstance, setCreatedInstance] = useState<GridInstance | null>(null);
  const [provisioningMeta, setProvisioningMeta] = useState<ProvisioningProgressMeta | null>(null);
  const flowRedirectedRef = useRef(false);
  const provisionCreateKey = useRef<string>(createIdempotencyKey("grid_catalog_create"));
  const reserveProvisionTriggeredRef = useRef(false);
  const hypercoreProvisionTriggeredRef = useRef(false);
  async function continueProvisioning(latest: GridInstance | null, instanceId: string | null) {
    if (!latest || !instanceId || flowRedirectedRef.current) return;
    const phase = String(latest?.provisioningStatus?.phase ?? "").trim().toLowerCase();
    if (isGridExecutionRunning(latest)) {
      return;
    }
    if (phase === "pending_hypercore_funding_signature") {
      const botVaultId = String(latest?.botVault?.id ?? "").trim();
      if (!botVaultId || hypercoreProvisionTriggeredRef.current) return;
      hypercoreProvisionTriggeredRef.current = true;
      await flow.executeAction({
        busyKey: "fund-hypercore-grid-bot-catalog",
        buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVaultId)}/fund-hypercore-tx`,
        body: {
          actionKey: createIdempotencyKey(`grid_hypercore_funding:${botVaultId}`)
        }
      });
      return;
    }
    if (phase === "pending_reserve_signature") {
      const botVaultId = String(latest?.botVault?.id ?? "").trim();
      if (!botVaultId || reserveProvisionTriggeredRef.current) return;
      reserveProvisionTriggeredRef.current = true;
      await flow.executeAction({
        busyKey: "reserve-grid-bot-catalog",
        buildPath: `/vaults/onchain/bot-vaults/${encodeURIComponent(botVaultId)}/reserve-tx`,
        body: {
          actionKey: createIdempotencyKey(`grid_reserve_provision:${botVaultId}`)
        }
      });
      return;
    }
  }
  const flow = useOnchainActionFlow(async () => {
    if (!createdInstanceId || flowRedirectedRef.current) return;
    const latest = await apiGet<GridInstance>(`/grid/instances/${encodeURIComponent(createdInstanceId)}`).catch(() => null);
    if (latest) setCreatedInstance(latest);
    await continueProvisioning(latest, createdInstanceId);
  });

  async function cleanupPendingProvisioningInstance(instanceId: string | null) {
    const targetId = String(instanceId ?? "").trim();
    if (!targetId) return;
    await apiPost(`/grid/instances/${encodeURIComponent(targetId)}/cancel-provisioning`, {}).catch(() => undefined);
    setCreatedInstanceId(null);
    setCreatedInstance(null);
    setProvisioningMeta(null);
    flowRedirectedRef.current = false;
    reserveProvisionTriggeredRef.current = false;
    hypercoreProvisionTriggeredRef.current = false;
    provisionCreateKey.current = createIdempotencyKey("grid_catalog_create");
  }

  const [templates, setTemplates] = useState<GridTemplate[]>([]);
  const [filters, setFilters] = useState<GridTemplateFiltersResponse>({
    categories: [],
    tags: [],
    difficulties: [],
    risks: []
  });
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [reusableBotVaults, setReusableBotVaults] = useState<BotVaultSnapshot[]>([]);
  const [pilotAccess, setPilotAccess] = useState<GridPilotAccess | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedTag, setSelectedTag] = useState("ALL");
  const [selectedDifficulty, setSelectedDifficulty] = useState("ALL");
  const [selectedRisk, setSelectedRisk] = useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [ownOnly, setOwnOnly] = useState(() => searchParams.get("ownOnly") === "true");
  const [catalogView, setCatalogView] = useState<"grid" | "list">("grid");

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [exchangeAccountId, setExchangeAccountId] = useState("");
  const [selectedBotVaultId, setSelectedBotVaultId] = useState("");
  const [investUsd, setInvestUsd] = useState("300");
  const [extraMarginUsd, setExtraMarginUsd] = useState("0");
  const [tpPct, setTpPct] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [marginMode, setMarginMode] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [preview, setPreview] = useState<GridInstancePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInsufficient, setPreviewInsufficient] = useState(false);
  const [creating, setCreating] = useState(false);
  const previewRequestSeq = useRef(0);
  const provisioningSteps = useMemo(
    () => buildProvisioningProgressSteps(createdInstance, tGrid),
    [createdInstance, tGrid]
  );
  const provisioningFinished = useMemo(
    () => provisioningSteps.length > 0 && provisioningSteps.every((step) => step.state === "complete"),
    [provisioningSteps]
  );
  const provisioningPhaseText = useMemo(
    () => provisioningPhaseLabel(createdInstance?.provisioningStatus?.phase, tGrid),
    [createdInstance?.provisioningStatus?.phase, tGrid]
  );
  const provisioningHintText = useMemo(() => {
    if (provisioningFinished) return tGrid("provisioningTrackerReadyToClose");
    if (!createdInstance?.provisioningStatus) return tGrid("provisioningPhaseUnknown");
    const normalized = normalizeGridProvisioningPhase(createdInstance.provisioningStatus.phase);
    if (normalized === "ready" || normalized === "completed") {
      if (createdInstance.lastPlanError) return createdInstance.lastPlanError;
      if (!hasInitialSeedExecution(createdInstance) && createdInstance.initialSeedEnabled !== false) {
        return tGrid("provisioningTrackerSeeding");
      }
      if (!hasGridPlacement(createdInstance)) return tGrid("provisioningTrackerPlacingGrid");
      return tGrid("provisioningTrackerStartingBot");
    }
    return createdInstance.provisioningStatus.walletSignatureRequired
      ? tGrid("provisioningWalletSignatureRequired")
      : tGrid("provisioningIndexerWaiting");
  }, [createdInstance, provisioningFinished, tGrid]);

  useEffect(() => {
    if (!createdInstanceId || flowRedirectedRef.current || provisioningFinished) return undefined;
    let cancelled = false;
    const loadLatest = async () => {
      const latest = await apiGet<GridInstance>(`/grid/instances/${encodeURIComponent(createdInstanceId)}`).catch(() => null);
      if (cancelled || !latest) return;
      setCreatedInstance(latest);
      await continueProvisioning(latest, createdInstanceId);
    };
    void loadLatest();
    const timer = window.setInterval(() => {
      void loadLatest();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [createdInstanceId, locale, provisioningFinished, router]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === exchangeAccountId) ?? null,
    [accounts, exchangeAccountId]
  );
  const selectedReusableBotVault = useMemo(
    () => reusableBotVaults.find((row) => row.id === selectedBotVaultId) ?? null,
    [reusableBotVaults, selectedBotVaultId]
  );
  const selectedTemplateTags = useMemo(() => visibleCatalogTags(selectedTemplate), [selectedTemplate]);
  const stablecoinLabel = usesHyperliquidMarketData(selectedAccount) ? "USDC" : "USDT";
  const autoMarginActive = marginMode === "AUTO";
  const neutralPreviewHints = useMemo(
    () => deriveNeutralModePreviewHints({ template: selectedTemplate, preview }),
    [preview, selectedTemplate]
  );
  const liqRiskActive = Boolean(
    preview
      && Number.isFinite(Number(preview.liq?.worstCaseLiqDistancePct))
      && Number(preview.liq.worstCaseLiqDistancePct) < Number(preview.liq?.liqDistanceMinPct ?? 8)
  );
  const previewReadyForLaunch = Boolean(preview && !previewError && !previewLoading && !previewInsufficient);

  const canCreate = Boolean(
    selectedTemplate
      && exchangeAccountId
      && !creating
      && !previewLoading
      && previewReadyForLaunch
      && !previewInsufficient
      && Number(investUsd) > 0
      && (autoMarginActive || Number(extraMarginUsd) >= 0)
  );
  const hasActiveFilters = Boolean(
    search.trim()
      || selectedCategory !== "ALL"
      || selectedTag !== "ALL"
      || selectedDifficulty !== "ALL"
      || selectedRisk !== "ALL"
      || favoritesOnly
      || ownOnly
  );

  async function loadMeta() {
    setLoadingMeta(true);
    try {
      const [filterResponse, accountResponse, pilotResponse, botVaultResponse] = await Promise.all([
        apiGet<GridTemplateFiltersResponse>("/grid/templates/filters"),
        apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts?purpose=execution"),
        apiGet<GridPilotAccess>("/grid/pilot-access"),
        apiGet<{ items: BotVaultSnapshot[] }>("/vaults/bot-vaults?reusableOnly=true")
      ]);
      const allowHyperliquid = Boolean(pilotResponse?.allowed || pilotResponse?.allowLiveHyperliquid);
      const accountItems = (accountResponse.items ?? [])
        .filter(isPerpCapable)
        .filter((row) => {
          const exchange = String(row.exchange ?? "").trim().toLowerCase();
          if (allowedGridExchanges.has(exchange)) return true;
          return allowHyperliquid && usesHyperliquidMarketData(row);
        })
        .filter((row) => allowHyperliquid || !usesHyperliquidMarketData(row));
      setFilters({
        categories: Array.isArray(filterResponse.categories) ? filterResponse.categories : [],
        tags: Array.isArray(filterResponse.tags) ? filterResponse.tags : [],
        difficulties: Array.isArray(filterResponse.difficulties) ? filterResponse.difficulties : [],
        risks: Array.isArray(filterResponse.risks) ? filterResponse.risks : []
      });
      setAccounts(accountItems);
      setReusableBotVaults(Array.isArray(botVaultResponse.items) ? botVaultResponse.items : []);
      setPilotAccess(pilotResponse ?? null);
      setExchangeAccountId((previous) => previous && accountItems.some((row) => row.id === previous) ? previous : (accountItems[0]?.id ?? ""));
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoadingMeta(false);
    }
  }

  async function loadCatalog() {
    setLoadingCatalog(true);
    setError(null);
    try {
      const query = buildGridCatalogQuery({
        search: deferredSearch,
        category: selectedCategory,
        tag: selectedTag,
        difficulty: selectedDifficulty,
        risk: selectedRisk,
        favoritesOnly,
        ownOnly
      });
      const response = await apiGet<{ items: GridTemplate[] }>(
        `/grid/templates${query ? `?${query}` : ""}`
      );
      const items = Array.isArray(response.items) ? response.items : [];
      setTemplates(items);
      setSelectedTemplateId((previous) => previous && items.some((row) => row.id === previous) ? previous : "");
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadMeta(), loadCatalog()]);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedView = window.localStorage.getItem("gridCatalogView");
    if (storedView === "grid" || storedView === "list") {
      setCatalogView(storedView);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("gridCatalogView", catalogView);
  }, [catalogView]);

  useEffect(() => {
    void loadCatalog();
  }, [deferredSearch, selectedCategory, selectedTag, selectedDifficulty, selectedRisk, favoritesOnly, ownOnly]);

  useEffect(() => {
    if (!selectedTemplate) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      return;
    }
    setInvestUsd(String(selectedTemplate.investDefaultUsd ?? 300));
    setExtraMarginUsd("0");
    setTpPct(selectedTemplate.tpDefaultPct == null ? "" : String(selectedTemplate.tpDefaultPct));
    setSlPrice(selectedTemplate.slDefaultPrice == null ? "" : String(selectedTemplate.slDefaultPrice));
    setTriggerPrice("");
    setMarginMode(selectedTemplate.marginPolicy === "AUTO_ALLOWED" ? "AUTO" : "MANUAL");
    setPreview(null);
    setPreviewError(null);
    setPreviewInsufficient(false);
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!usesHyperliquidMarketData(selectedAccount)) {
      setSelectedBotVaultId("");
      return;
    }
    setSelectedBotVaultId((previous) => (
      previous && reusableBotVaults.some((row) => row.id === previous)
        ? previous
        : ""
    ));
  }, [reusableBotVaults, selectedAccount]);

  useEffect(() => {
    if (!selectedTemplate || !exchangeAccountId) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }
    const investValue = Number(investUsd);
    const extraMarginValue = autoMarginActive ? 0 : Number(extraMarginUsd || 0);
    if (!Number.isFinite(investValue) || investValue <= 0 || !Number.isFinite(extraMarginValue) || extraMarginValue < 0) {
      setPreview(null);
      setPreviewError(null);
      setPreviewInsufficient(false);
      setPreviewLoading(false);
      return;
    }

    const requestId = ++previewRequestSeq.current;
    const timer = setTimeout(() => {
      if (
        !(pilotAccess?.allowed || pilotAccess?.allowLiveHyperliquid)
        && usesHyperliquidMarketData(selectedAccount)
      ) {
        setPreview(null);
        setPreviewError(tGrid("pilotRequired"));
        setPreviewInsufficient(false);
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      void apiPost<GridInstancePreviewResponse>(`/grid/templates/${selectedTemplate.id}/instance-preview`, {
        exchangeAccountId,
        investUsd: investValue,
        extraMarginUsd: extraMarginValue,
        triggerPrice: triggerPrice.trim() ? Number(triggerPrice) : null,
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: autoMarginActive
      }).then((response) => {
        if (requestId !== previewRequestSeq.current) return;
        setPreview(response);
        setPreviewError(null);
        setPreviewInsufficient(Boolean(response.allocation?.insufficient));
      }).catch((previewLoadError) => {
        if (requestId !== previewRequestSeq.current) return;
        if (previewLoadError instanceof ApiError && previewLoadError.status === 400 && previewLoadError.payload?.error === "grid_instance_invest_below_minimum") {
          const payload = previewLoadError.payload as Record<string, any>;
          setPreview({
            markPrice: Number(payload.markPrice ?? 0),
            minInvestmentUSDT: Number(payload.requiredMinInvestmentUSDT ?? 0),
            allocation: {
              totalBudgetUsd: Number(payload.allocation?.totalBudgetUsd ?? investValue + extraMarginValue),
              gridInvestUsd: Number(payload.allocation?.gridInvestUsd ?? 0),
              extraMarginUsd: Number(payload.allocation?.extraMarginUsd ?? 0),
              splitMode: payload.allocation?.splitMode === "auto_fixed_ratio" || payload.allocation?.splitMode === "auto_liq_guard_dynamic" ? payload.allocation.splitMode : "manual",
              policy: payload.allocation?.policy === "FIXED_RATIO" ? "FIXED_RATIO" : payload.allocation?.policy === "LIQ_GUARD_MAX_GRID" ? "LIQ_GUARD_MAX_GRID" : null,
              targetLiqDistancePct: Number.isFinite(Number(payload.allocation?.targetLiqDistancePct)) ? Number(payload.allocation.targetLiqDistancePct) : null,
              searchIterationsUsed: Number.isFinite(Number(payload.allocation?.searchIterationsUsed)) ? Math.trunc(Number(payload.allocation.searchIterationsUsed)) : 0,
              insufficient: true,
              reasonCodes: Array.isArray(payload.allocation?.reasonCodes) ? payload.allocation.reasonCodes : []
            },
            minInvestmentBreakdown: payload.minInvestmentBreakdown ?? null,
            initialSeed: payload.initialSeed ?? null,
            marginMode: payload.marginMode === "AUTO" ? "AUTO" : "MANUAL",
            allocationBreakdown: payload.allocationBreakdown ?? null,
            qtyModel: payload.qtyModel ?? null,
            windowMeta: payload.windowMeta ?? null,
            profitPerGridEstimateUSDT: Number.isFinite(Number(payload.profitPerGridEstimateUSDT)) ? Number(payload.profitPerGridEstimateUSDT) : null,
            liq: {
              liqEstimateLong: Number.isFinite(Number(payload.liq?.liqEstimateLong)) ? Number(payload.liq.liqEstimateLong) : null,
              liqEstimateShort: Number.isFinite(Number(payload.liq?.liqEstimateShort)) ? Number(payload.liq.liqEstimateShort) : null,
              worstCaseLiqPrice: Number.isFinite(Number(payload.liq?.worstCaseLiqPrice)) ? Number(payload.liq.worstCaseLiqPrice) : null,
              worstCaseLiqDistancePct: Number.isFinite(Number(payload.liq?.worstCaseLiqDistancePct)) ? Number(payload.liq.worstCaseLiqDistancePct) : null,
              liqDistanceMinPct: Number.isFinite(Number(payload.liq?.liqDistanceMinPct)) ? Number(payload.liq.liqDistanceMinPct) : 8
            },
            warnings: Array.isArray(payload.warnings) ? payload.warnings.map((row) => String(row)) : []
          });
          setPreviewError(
            replaceStablecoinUnit(
              tGrid("minimumRequiredInvestment", { value: formatNumber(Number(payload.requiredMinInvestmentUSDT ?? 0), 2) }),
              stablecoinLabel
            )
          );
          setPreviewInsufficient(true);
          return;
        }
        if (previewLoadError instanceof ApiError && previewLoadError.status === 403 && previewLoadError.payload?.error === "grid_hyperliquid_pilot_required") {
          setPreview(null);
          setPreviewError(tGrid("pilotRequired"));
          setPreviewInsufficient(false);
          return;
        }
        setPreview((current) => current);
        setPreviewError(formatGridPreviewError(errMsg(previewLoadError), tGrid));
        setPreviewInsufficient(false);
      }).finally(() => {
        if (requestId === previewRequestSeq.current) setPreviewLoading(false);
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [autoMarginActive, exchangeAccountId, extraMarginUsd, investUsd, marginMode, pilotAccess, selectedAccount, selectedTemplate, slPrice, stablecoinLabel, tGrid, tpPct, triggerPrice]);

  async function toggleFavorite(template: GridTemplate) {
    setFavoriteBusyId(template.id);
    setError(null);
    try {
      const nextIsFavorite = !template.isFavorite;
      if (template.isFavorite) {
        await apiDelete(`/grid/templates/${template.id}/favorite`);
      } else {
        await apiPost(`/grid/templates/${template.id}/favorite`, {});
      }
      setTemplates((previous) => updateGridCatalogFavoriteState(previous, template.id, nextIsFavorite, favoritesOnly));
      if (favoritesOnly && !nextIsFavorite && selectedTemplateId === template.id) setSelectedTemplateId("");
    } catch (favoriteError) {
      setError(errMsg(favoriteError));
    } finally {
      setFavoriteBusyId(null);
    }
  }

  async function createInstance(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTemplate || !canCreate) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      if (
        !(pilotAccess?.allowed || pilotAccess?.allowLiveHyperliquid)
        && usesHyperliquidMarketData(selectedAccount)
      ) {
        setError(tGrid("pilotRequired"));
        return;
      }
      const requestedExtraMarginUsd = autoMarginActive ? 0 : Number(extraMarginUsd || 0);
      const includesCreateFee = usesHyperliquidMarketData(selectedAccount) && !selectedReusableBotVault;
      const fundingBreakdown = buildBotVaultFundingBreakdown({
        investUsd: Number(investUsd),
        extraMarginUsd: requestedExtraMarginUsd,
        includeCreateFee: includesCreateFee
      });
      const created = await apiPost<GridInstanceCreateResponse>(`/grid/templates/${selectedTemplate.id}/instances`, {
        exchangeAccountId,
        investUsd: Number(investUsd),
        extraMarginUsd: requestedExtraMarginUsd,
        triggerPrice: triggerPrice.trim() ? Number(triggerPrice) : null,
        tpPct: tpPct.trim() ? Number(tpPct) : null,
        slPrice: slPrice.trim() ? Number(slPrice) : null,
        marginMode,
        autoMarginEnabled: autoMarginActive,
        botVaultId: selectedReusableBotVault?.id ?? undefined,
        idempotencyKey: provisionCreateKey.current
      });
      if (created && typeof created === "object" && "txRequest" in created && "onchainAction" in created) {
        const instanceId = String(created.instance?.id ?? "");
        if (instanceId) setCreatedInstanceId(instanceId);
        setCreatedInstance(created.instance ?? null);
        setProvisioningMeta({
          templateName: selectedTemplate.name,
          symbol: selectedTemplate.symbol,
          accountLabel: selectedAccount ? formatExecutionAccountOption(selectedAccount) : tGrid("noExecutionAccountsOption"),
          accountType: includesCreateFee ? "vault" : "exchange",
          stablecoinLabel,
          includesCreateFee,
          ...fundingBreakdown
        });
        setSelectedTemplateId("");
        await flow.executeBuiltAction({
          busyKey: "create-grid-bot-catalog",
          built: {
            ok: true,
            mode: created.mode,
            action: created.onchainAction,
            txRequest: created.txRequest
          },
          onBeforeTxSubmittedError: async () => {
            await cleanupPendingProvisioningInstance(instanceId || null);
          }
        });
        setNotice(null);
      } else {
        setNotice(tGrid("createdAutoStarted"));
        setSelectedTemplateId("");
        provisionCreateKey.current = createIdempotencyKey("grid_catalog_create");
        if ("id" in created) {
          router.push(withLocalePath(`/bots/grid/${created.id}`, locale));
        }
      }
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 403 && createError.payload?.error === "grid_hyperliquid_pilot_required") {
        setError(tGrid("pilotRequired"));
      } else if (createError instanceof ApiError && createError.status === 409 && createError.payload?.error === "grid_agent_wallet_required") {
        setError(tGrid("agentWalletRequired"));
      } else if (createError instanceof ApiError && createError.status === 409 && createError.payload?.error === "grid_agent_wallet_hype_required") {
        setError(tGrid("agentWalletLowHype"));
      } else if (createError instanceof ApiError && createError.status === 403 && createError.payload?.error === "workspace_access_denied") {
        setError(tGrid("workspaceAccessDenied"));
      } else if (createError instanceof ApiError && createError.status === 400 && createError.payload?.error === "workspace_not_found") {
        setError(tGrid("workspaceNotFound"));
      } else {
        setError(errMsg(createError));
      }
      setCreatedInstanceId(null);
      setCreatedInstance(null);
      setProvisioningMeta(null);
      flowRedirectedRef.current = false;
      reserveProvisionTriggeredRef.current = false;
      hypercoreProvisionTriggeredRef.current = false;
      provisionCreateKey.current = createIdempotencyKey("grid_catalog_create");
    } finally {
      setCreating(false);
    }
  }

  function closeDrawer() {
    setSelectedTemplateId("");
    setPreview(null);
    setPreviewError(null);
    setPreviewInsufficient(false);
    setNotice(null);
  }

  function resetFilters() {
    setSearch("");
    setSelectedCategory("ALL");
    setSelectedTag("ALL");
    setSelectedDifficulty("ALL");
    setSelectedRisk("ALL");
    setFavoritesOnly(false);
    setOwnOnly(false);
  }

  function openTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
  }

  function closeProvisioningTracker() {
    const instanceId = createdInstanceId;
    flowRedirectedRef.current = true;
    setCreatedInstanceId(null);
    setCreatedInstance(null);
    setProvisioningMeta(null);
    reserveProvisionTriggeredRef.current = false;
    hypercoreProvisionTriggeredRef.current = false;
    provisionCreateKey.current = createIdempotencyKey("grid_catalog_create");
    router.push(
      instanceId
        ? `${withLocalePath("/bots/grid", locale)}?instanceId=${encodeURIComponent(instanceId)}`
        : withLocalePath("/bots/grid", locale)
    );
  }

  return (
    <div className="botsPage gridCatalogPage">
      <section className="card gridCatalogHero">
        <div className="gridCatalogHeroCopy">
          <div className="gridCatalogHeroText">
            <h1 className="gridCatalogHeroTitle">{tGrid("catalogTitle")}</h1>
            <p className="gridCatalogHeroSubtitle">{tGrid("catalogSubtitle")}</p>
          </div>
          <div className="gridCatalogHeroBadges">
            <span className="badge">{tGrid("catalogCategory")}: {filters.categories.length}</span>
            <span className="badge">{tGrid("catalogTag")}: {filters.tags.length}</span>
            {favoritesOnly ? <span className="badge badgeOk">{tGrid("catalogFavoritesOnly")}</span> : null}
            {ownOnly ? <span className="badge badgeOk">{tGrid("catalogOwnOnly")}</span> : null}
          </div>
        </div>
        <div className="gridCatalogHeroActions">
          <Link href={withLocalePath("/bots/grid", locale)} className="btn">{tGrid("dashboard")}</Link>
          <Link href={withLocalePath("/bots/catalog/new", locale)} className="btn btnPrimary">{tGrid("catalogCreateOwnTemplate")}</Link>
          <Link href={withLocalePath("/bots/grid/new", locale)} className="btn">{tGrid("catalogFallbackCta")}</Link>
        </div>
      </section>

      {error || flow.error ? <div className="card gridCatalogStatus gridCatalogStatusError">{error ?? flow.error}</div> : null}
      {notice || flow.notice ? <div className="card gridCatalogStatus gridCatalogStatusSuccess">{notice ?? flow.notice}</div> : null}
      <section className="card gridCatalogFilters">
        <div className="gridCatalogFilterGrid">
          <label className="gridCatalogField">
            {tGrid("catalogSearch")}
            <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tGrid("catalogSearchPlaceholder")} />
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogCategory")}
            <select className="input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogTag")}
            <select className="input" value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogDifficulty")}
            <select className="input" value={selectedDifficulty} onChange={(event) => setSelectedDifficulty(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.difficulties.map((value) => <option key={value} value={value}>{tGrid(`catalogDifficultyValues.${value}`)}</option>)}
            </select>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogRisk")}
            <select className="input" value={selectedRisk} onChange={(event) => setSelectedRisk(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.risks.map((value) => <option key={value} value={value}>{tGrid(`catalogRiskValues.${value}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="gridCatalogFilterFooter">
          <label className="settingsToggle gridCatalogToggle">
            <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
            <span>{tGrid("catalogFavoritesOnly")}</span>
          </label>
          <label className="settingsToggle gridCatalogToggle">
            <input type="checkbox" checked={ownOnly} onChange={(event) => setOwnOnly(event.target.checked)} />
            <span>{tGrid("catalogOwnOnly")}</span>
          </label>
          <div className="gridCatalogFilterActions">
            <div className="gridCatalogViewToggle" role="group" aria-label={tGrid("catalogViewLabel")}>
              <button
                className={`btn gridCatalogViewButton ${catalogView === "grid" ? "gridCatalogViewButtonActive" : ""}`}
                type="button"
                onClick={() => setCatalogView("grid")}
              >
                {tGrid("catalogViewGrid")}
              </button>
              <button
                className={`btn gridCatalogViewButton ${catalogView === "list" ? "gridCatalogViewButtonActive" : ""}`}
                type="button"
                onClick={() => setCatalogView("list")}
              >
                {tGrid("catalogViewList")}
              </button>
            </div>
            {hasActiveFilters ? (
              <button className="btn" type="button" onClick={resetFilters}>
                {tGrid("catalogResetFilters")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {(loadingCatalog || loadingMeta) ? (
        <div className="card gridCatalogState">{tGrid("catalogLoading")}</div>
      ) : templates.length === 0 ? (
        <div className="card gridCatalogState">
          <div className="gridCatalogStateTitle">{tGrid("catalogEmptyTitle")}</div>
          <div className="gridCatalogStateBody">{tGrid("catalogEmptyBody")}</div>
          <button className="btn" type="button" onClick={resetFilters}>
            {tGrid("catalogResetFilters")}
          </button>
        </div>
      ) : (
        <div className={`gridCatalogGrid ${catalogView === "list" ? "gridCatalogGridList" : ""}`}>
          {templates.map((template) => (
            <article
              key={template.id}
              className={`card gridCatalogCard ${catalogView === "list" ? "gridCatalogCardList" : ""}`}
              onClick={() => openTemplate(template.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openTemplate(template.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              {template.catalogImageUrl ? (
                <img
                  src={template.catalogImageUrl}
                  alt={template.name}
                  className="gridCatalogCardImage"
                />
              ) : (
                <div className="gridCatalogCardPlaceholder">
                  {template.symbol}
                </div>
              )}

              <div className="gridCatalogCardBody">
                <div className="gridCatalogCardHeader">
                  <div className="gridCatalogCardCopy">
                    <div className="gridCatalogCardTitle">{template.name}</div>
                    <div className="gridCatalogCardDescription">
                      {template.catalogShortDescription || template.description || tGrid("catalogNoDescription")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn gridCatalogFavoriteButton ${template.isFavorite ? "btnPrimary" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFavorite(template);
                    }}
                    disabled={favoriteBusyId === template.id}
                    aria-label={template.isFavorite ? tGrid("catalogUnfavorite") : tGrid("catalogFavorite")}
                  >
                    {favoriteBusyId === template.id ? "..." : template.isFavorite ? tGrid("catalogUnfavorite") : tGrid("catalogFavorite")}
                  </button>
                </div>

                <div className="gridCatalogBadgeRow">
                  <span className="badge">{template.symbol}</span>
                  <span className="badge">{tGrid(`catalogDifficultyValues.${template.catalogDifficulty ?? "BEGINNER"}`)}</span>
                  <span className="badge">{tGrid(`catalogRiskValues.${template.catalogRiskLevel ?? "MEDIUM"}`)}</span>
                  {template.isOwnTemplate ? <span className="badge badgeOk">{tGrid("catalogOwnTemplate")}</span> : null}
                  {template.catalogFeatured ? <span className="badge badgeOk">{tGrid("catalogFeatured")}</span> : null}
                </div>

                <div className="gridCatalogMetaList">
                  <div>{tGrid("catalogCardMode", { mode: formatCatalogEnumLabel(template.mode), leverage: String(template.leverageDefault) })}</div>
                  <div>{tGrid("catalogCardRange", { range: rangeSummary(template) })}</div>
                  {template.catalogCategory ? <div>{tGrid("catalogCardCategory", { category: template.catalogCategory })}</div> : null}
                </div>

                {visibleCatalogTags(template).length > 0 ? (
                  <div className="gridCatalogTagList">
                    {visibleCatalogTags(template).slice(0, catalogView === "list" ? 6 : 4).map((tag) => <span key={tag} className="badge">{tag}</span>)}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedTemplate ? (
        <div
          className="gridCatalogDrawerBackdrop"
          onClick={closeDrawer}
        >
          <aside
            className="card gridCatalogDrawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="gridCatalogDrawerHeader">
              <div className="gridCatalogDrawerHeaderCopy">
                <h2 className="gridCatalogDrawerTitle">{selectedTemplate.name}</h2>
                <div className="gridCatalogDrawerDescription">
                  {selectedTemplate.catalogShortDescription || selectedTemplate.description || tGrid("catalogNoDescription")}
                </div>
              </div>
              <button className="btn" type="button" onClick={closeDrawer}>{tGrid("catalogClose")}</button>
            </div>

              <div className="gridCatalogDrawerIntro">
                {selectedTemplate.catalogImageUrl ? (
                  <img
                  src={selectedTemplate.catalogImageUrl}
                  alt={selectedTemplate.name}
                  className="gridCatalogDrawerImage"
                />
              ) : (
                <div className="gridCatalogCardPlaceholder gridCatalogDrawerPlaceholder">
                  {selectedTemplate.symbol}
                </div>
              )}
              <div className="gridCatalogDrawerIntroCopy">
                <div className="gridCatalogBadgeRow">
                  <span className="badge">{tGrid(`catalogDifficultyValues.${selectedTemplate.catalogDifficulty ?? "BEGINNER"}`)}</span>
                  <span className="badge">{tGrid(`catalogRiskValues.${selectedTemplate.catalogRiskLevel ?? "MEDIUM"}`)}</span>
                  {selectedTemplate.isOwnTemplate ? <span className="badge badgeOk">{tGrid("catalogOwnTemplate")}</span> : null}
                  {selectedTemplate.catalogFeatured ? <span className="badge badgeOk">{tGrid("catalogFeatured")}</span> : null}
                </div>
	                <div className="gridCatalogDrawerMetaBlock">
	                  <div className="gridCatalogDrawerMetaEyebrow">{tGrid("catalogMetaSummary")}</div>
	                  <div className="gridCatalogDrawerMetaValue">{formatCatalogEnumLabel(selectedTemplate.mode)} · {formatCatalogEnumLabel(selectedTemplate.gridMode)} · {rangeSummary(selectedTemplate)} · {selectedTemplate.leverageDefault}x</div>
	                </div>
                {selectedTemplate.catalogCategory ? (
                  <div className="gridCatalogDrawerCategory">
                    {tGrid("catalogCardCategory", { category: selectedTemplate.catalogCategory })}
                  </div>
                ) : null}
                {selectedTemplateTags.length > 0 ? (
                  <div className="gridCatalogTagList">
                    {selectedTemplateTags.map((tag) => <span key={tag} className="badge">{tag}</span>)}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="gridCatalogStatsGrid">
              <div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateSymbol")}</strong>
                <div className="gridCatalogStatValue">{selectedTemplate.symbol}</div>
              </div>
	              <div className="card gridCatalogStatCard">
	                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateMode")}</strong>
	                <div className="gridCatalogStatValue">{formatCatalogEnumLabel(selectedTemplate.mode)} · {formatCatalogEnumLabel(selectedTemplate.gridMode)}</div>
	              </div>
              <div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateRange")}</strong>
                <div className="gridCatalogStatValue">{rangeSummary(selectedTemplate)}</div>
              </div>
              <div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateLeverage")}</strong>
                <div className="gridCatalogStatValue">{selectedTemplate.leverageDefault}x</div>
              </div>
              {selectedTemplate.isOwnTemplate ? (
                <div className="card gridCatalogStatCard">
                  <strong className="gridCatalogStatLabel">{tGrid("catalogCreatorProfitShare")}</strong>
                  <div className="gridCatalogStatValue">{formatNumber(Number(selectedTemplate.creatorProfitSharePct ?? 0), 2)}%</div>
                </div>
              ) : null}
            </div>

            <form onSubmit={createInstance} className="gridCatalogLaunchForm">
              <section className="card gridCatalogSection">
                <div className="gridCatalogSectionHeader">
                  <div>
                    <strong className="gridCatalogSectionTitle">{tGrid("launchSetupTitle")}</strong>
                    <div className="gridCatalogSectionHint">{replaceStablecoinUnit(autoMarginActive ? tGrid("launchSetupAutoHint") : tGrid("launchSetupManualHint"), stablecoinLabel)}</div>
                  </div>
                </div>
                <div className="gridCatalogLaunchGrid">
                  <label className="gridCatalogField">
                    {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                    <select className="input" value={exchangeAccountId} onChange={(event) => setExchangeAccountId(event.target.value)}>
                      {accounts.length > 0 ? accounts.map((row) => (
                        <option key={row.id} value={row.id}>{formatExecutionAccountOption(row)}</option>
                      )) : <option value="">{tGrid("noExecutionAccountsOption")}</option>}
                    </select>
                  </label>
                  {usesHyperliquidMarketData(selectedAccount) ? (
                    <>
                      <label className="gridCatalogField">
                        {tGrid("botVaultReuseLabel")}
                        <select className="input" value={selectedBotVaultId} onChange={(event) => setSelectedBotVaultId(event.target.value)}>
                          <option value="">{tGrid("botVaultReuseCreateNew")}</option>
                          {reusableBotVaults.map((row) => (
                            <option key={row.id} value={row.id}>{formatReusableBotVaultOption(row, stablecoinLabel)}</option>
                          ))}
                        </select>
                      </label>
                      <div className="gridCatalogSectionHint">
                        {selectedReusableBotVault
                          ? tGrid("botVaultReuseSelectedHint", {
                              id: selectedReusableBotVault.id,
                              amount: formatNumber(Number(selectedReusableBotVault.availableUsd ?? 0), 2),
                              stablecoin: stablecoinLabel
                            })
                          : reusableBotVaults.length > 0
                            ? tGrid("botVaultReuseAvailableHint", { count: reusableBotVaults.length })
                            : tGrid("botVaultReuseEmptyHint")}
                      </div>
                    </>
                  ) : null}
                  <label className="gridCatalogField">
                    {replaceStablecoinUnit(autoMarginActive ? tGrid("investTotalBudget") : tGrid("invest"), stablecoinLabel)}
                    <input className="input" type="number" min="1" step="0.01" value={investUsd} onChange={(event) => setInvestUsd(event.target.value)} />
                  </label>
                  {!autoMarginActive ? (
                    <label className="gridCatalogField">
                      {replaceStablecoinUnit(tGrid("extraMargin"), stablecoinLabel)}
                      <input className="input" type="number" min="0" step="0.01" value={extraMarginUsd} onChange={(event) => setExtraMarginUsd(event.target.value)} />
                    </label>
                  ) : null}
                  <label className="gridCatalogField">
                    {tGrid("triggerPrice")}
                    <input className="input" type="number" min="0" step="0.0001" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("tpPct")}
                    <input className="input" type="number" min="0" step="0.01" value={tpPct} onChange={(event) => setTpPct(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("slPrice")}
                    <input className="input" type="number" min="0" step="0.01" value={slPrice} onChange={(event) => setSlPrice(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("marginMode")}
                    <select className="input" value={marginMode} disabled={selectedTemplate.marginPolicy !== "AUTO_ALLOWED"} onChange={(event) => setMarginMode(event.target.value === "AUTO" ? "AUTO" : "MANUAL")}>
                      <option value="MANUAL">{tGrid("marginModeManualOption")}</option>
                      <option value="AUTO">{tGrid("marginModeAutoOption")}</option>
                    </select>
                  </label>
                </div>
              </section>

              {accounts.length === 0 ? (
                <div className="card gridCatalogCallout gridCatalogCalloutWarn">
                  <div className="gridCatalogCalloutTitle">{tGrid("noExecutionAccountsTitle")}</div>
                  <div className="gridCatalogCalloutBody">{tGrid("noExecutionAccountsBody")}</div>
                  <div className="gridCatalogCalloutBody">
                    {tGrid("noExecutionAccountsHint", { exchanges: [...allowedGridExchanges].join(", ") })}
                  </div>
                  <Link href={withLocalePath("/settings", locale)} className="btn">{tGrid("openExchangeSettings")}</Link>
                </div>
              ) : null}

              {preview ? (
                <section className="gridCatalogPreviewSummaryGrid">
                  <div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("investTotalBudget"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.totalBudgetUsd, 2)} {stablecoinLabel}</div>
                  </div>
                  <div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("invest"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.gridInvestUsd, 2)} {stablecoinLabel}</div>
                  </div>
                  <div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("extraMargin"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.extraMarginUsd, 2)} {stablecoinLabel}</div>
                  </div>
                  <div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{tGrid("targetLiqDistance")}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.targetLiqDistancePct, 2)}%</div>
                  </div>
                </section>
              ) : null}

              <div className={`card gridCatalogPreview ${previewInsufficient ? "gridCatalogPreviewInsufficient" : liqRiskActive ? "gridCatalogPreviewRisk" : ""}`}>
                <div className="gridCatalogPreviewHeader">
                  <div>
                    <strong>{tGrid("previewTitle")}</strong>
                    <div className="gridCatalogSectionHint">{tGrid("previewSectionHint")}</div>
                  </div>
                  {previewLoading ? <span className="badge badgeWarn">{tGrid("previewUpdating")}</span> : previewInsufficient ? <span className="badge badgeDanger">{tGrid("previewInsufficient")}</span> : preview ? <span className={`badge ${liqRiskActive ? "badgeWarn" : "badgeOk"}`}>{liqRiskActive ? tGrid("previewLiqRisk") : tGrid("previewReady")}</span> : <span className="badge">{tGrid("previewWaiting")}</span>}
                </div>
                <div className="gridCatalogPreviewHint">{tGrid("previewOnlyHint")}</div>
                {neutralPreviewHints.show ? (
                  <div style={{ marginTop: 10, marginBottom: 10, padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "rgba(148, 163, 184, 0.08)" }}>
                    <strong style={{ display: "block", marginBottom: 6 }}>{tGrid("neutralModeTitle")}</strong>
                    {neutralPreviewHints.symmetric ? (
                      <div className="gridCatalogPreviewHint">{tGrid("neutralModeSymmetricHint")}</div>
                    ) : null}
                    {neutralPreviewHints.fullBudgetOneWay ? (
                      <div className="gridCatalogPreviewHint" style={{ marginTop: 4 }}>{tGrid("neutralModeBudgetHint")}</div>
                    ) : null}
                    {neutralPreviewHints.seedDirectionDependsOnMark ? (
                      <div className="gridCatalogPreviewHint" style={{ marginTop: 4 }}>
                        {neutralPreviewHints.currentSeedSide
                          ? tGrid("neutralModeSeedHintWithSide", { side: neutralPreviewHints.currentSeedSide })
                          : tGrid("neutralModeSeedHint")}
                      </div>
                    ) : null}
                    {neutralPreviewHints.syntheticMarkPreview ? (
                      <div className="gridCatalogPreviewWarning" style={{ marginTop: 8 }}>
                        {tGrid("neutralModeSyntheticMarkHint")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {preview ? (
                  <div className="gridCatalogPreviewGrid">
                    <div className="gridCatalogPreviewMetric">{tGrid("mark")}: <strong>{formatNumber(preview.markPrice, 4)}</strong></div>
                    <div className="gridCatalogPreviewMetric">{tGrid("minInvest")}: <strong>{formatNumber(preview.minInvestmentUSDT, 2)} {stablecoinLabel}</strong></div>
                    <div className="gridCatalogPreviewMetric">{tGrid("profitPerGridEstimate")}: <strong>{formatNumber(preview.profitPerGridEstimateUSDT ?? null, 4)} {stablecoinLabel}</strong></div>
                    <div className="gridCatalogPreviewMetric">{tGrid("marginMode")}: <strong>{preview.marginMode ?? marginMode}</strong></div>
                    <div className="gridCatalogPreviewMetric">{tGrid("liqLong")}: <strong>{formatNumber(preview.liq.liqEstimateLong, 2)}</strong></div>
                    <div className="gridCatalogPreviewMetric">{tGrid("liqShort")}: <strong>{formatNumber(preview.liq.liqEstimateShort, 2)}</strong></div>
                  </div>
                ) : null}
                {previewError ? <div className="gridCatalogPreviewWarning gridCatalogPreviewError">{previewError}</div> : null}
                {liqRiskActive && preview ? <div className="gridCatalogPreviewWarning">{tGrid("liqRiskWarning", { actual: formatNumber(preview.liq.worstCaseLiqDistancePct, 2), min: formatNumber(preview.liq.liqDistanceMinPct, 2) })}</div> : null}
              </div>

              <div className="gridCatalogActionRow">
                <div className="gridCatalogActionMeta">
                  <div className="gridCatalogActionMetaLabel">
                    {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                  </div>
                  <div className="gridCatalogActionMetaValue">
                    {selectedAccount ? formatExecutionAccountOption(selectedAccount) : tGrid("noExecutionAccountsOption")}
                  </div>
                  <div className="gridCatalogActionMetaHint">
                    {previewLoading
                      ? tGrid("previewUpdating")
                      : previewError
                        ? previewError
                        : previewInsufficient
                          ? tGrid("previewInsufficient")
                          : liqRiskActive
                            ? tGrid("previewLiqRisk")
                            : preview
                              ? tGrid("previewReady")
                              : tGrid("previewWaiting")}
                  </div>
                </div>
                <button className="btn" type="button" onClick={closeDrawer}>{tGrid("catalogClose")}</button>
                <button className="btn btnPrimary" type="submit" disabled={!canCreate}>
                  {creating ? tGrid("creating") : tGrid("catalogStart")}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {createdInstanceId && provisioningMeta ? (
        <div className="gridCatalogProgressBackdrop">
          <section className="card gridCatalogProgressModal" aria-live="polite" aria-busy={!provisioningFinished}>
            <div className="gridCatalogProgressHeader">
              <div>
                <div className="gridCatalogProgressTitle">{tGrid("provisioningTrackerTitle")}</div>
                <div className="gridCatalogProgressSubtitle">{tGrid("provisioningTrackerSubtitle")}</div>
              </div>
              <span className={`badge ${
                provisioningPhaseTone(createdInstance?.provisioningStatus?.phase) === "success"
                  ? "badgeOk"
                  : provisioningPhaseTone(createdInstance?.provisioningStatus?.phase) === "warning"
                    ? "badgeWarn"
                    : "badge"
              }`}>
                {provisioningPhaseText}
              </span>
            </div>

            <div className="gridCatalogProgressSummary">
              <div className="gridCatalogProgressMetaRow">
                <span className="gridCatalogProgressMetaLabel">{tGrid("catalogTemplateSymbol")}</span>
                <strong>{provisioningMeta.templateName} · {provisioningMeta.symbol}</strong>
              </div>
              <div className="gridCatalogProgressMetaRow">
                <span className="gridCatalogProgressMetaLabel">
                  {provisioningMeta.accountType === "vault" ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                </span>
                <strong>{provisioningMeta.accountLabel}</strong>
              </div>
              {createdInstance ? (
                <div className="gridCatalogProgressMetaRow">
                  <span className="gridCatalogProgressMetaLabel">{tGrid("provisioningStatusTitle")}</span>
                  <strong>{tGrid("provisioningInstanceLine", { id: createdInstance.id })}</strong>
                </div>
              ) : null}
              {createdInstance?.botVault?.id ? (
                <div className="gridCatalogProgressMetaRow">
                  <span className="gridCatalogProgressMetaLabel">BotVault</span>
                  <strong>{createdInstance.botVault.id}</strong>
                </div>
              ) : null}
            </div>

            {provisioningMeta.totalFundingUsd > 0 ? (
              <div className="settingsMutedText" style={{ marginTop: 12 }}>
                {tGrid("provisioningFundingLine", {
                  total: formatNumber(provisioningMeta.totalFundingUsd, 2),
                  invest: formatNumber(provisioningMeta.investUsd, 2),
                  reserve: formatNumber(provisioningMeta.extraMarginUsd, 2),
                  fee: formatNumber(provisioningMeta.createFeeUsd, 2),
                  stablecoin: provisioningMeta.stablecoinLabel
                })}
              </div>
            ) : null}
            {provisioningMeta.includesCreateFee ? (
              <div className="settingsMutedText" style={{ marginTop: 6 }}>
                {tGrid("provisioningFundingFeeHint", {
                  fee: formatNumber(provisioningMeta.createFeeUsd, 2),
                  stablecoin: provisioningMeta.stablecoinLabel
                })}
              </div>
            ) : null}

            <div className="gridCatalogProgressHint">{provisioningHintText}</div>

            <div className="gridCatalogProgressList">
              {provisioningSteps.map((step) => (
                <div key={step.key} className={`gridCatalogProgressItem gridCatalogProgressItem-${step.state}`}>
                  <div className="gridCatalogProgressDot" />
                  <div className="gridCatalogProgressCopy">
                    <div className="gridCatalogProgressStepTop">
                      <strong>{step.label}</strong>
                      <span className={`badge ${
                        step.state === "complete"
                          ? "badgeOk"
                          : step.state === "active"
                            ? "badgeWarn"
                            : "badge"
                      }`}>
                        {provisioningProgressToneLabel(step.state, tGrid)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {provisioningFinished ? (
              <div className="gridCatalogActionRow">
                <div className="gridCatalogActionMeta">
                  <div className="gridCatalogActionMetaHint">{tGrid("provisioningTrackerReadyToClose")}</div>
                </div>
                <button className="btn btnPrimary" type="button" onClick={closeProvisioningTracker}>
                  {tGrid("catalogClose")}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
