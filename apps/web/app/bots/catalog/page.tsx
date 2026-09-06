"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAccount } from "wagmi";
import { ApiError, apiDelete, apiGet, apiPost } from "../../../lib/api";
import { buildBotVaultFundingBreakdown, type BotVaultFundingBreakdown } from "../../../components/grid/botVaultFunding";
import { useOnchainActionFlow } from "../../../components/grid/OnchainVaultActions";
import { withLocalePath, type AppLocale } from "../../../i18n/config";
import type { WalletFundingOverview } from "../../../lib/funding/types";
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
import { AppIcon } from "../../components/AppIcon";
import { Notice } from "../../components/ui";
import Web3Providers from "../../components/Web3Providers";

type GridPilotAccess = {
  allowed: boolean;
  reason: "admin" | "allowlist" | "disabled" | "not_listed";
  scope: "global" | "user" | "workspace" | "none";
  provider?: "mock" | "hyperliquid_demo" | "hyperliquid";
  allowLiveHyperliquid?: boolean;
};

type LaunchFeePreview = {
  platformFeeRatePct: number;
  affiliateFeeRatePct: number;
  totalFeeRatePct: number;
  affiliateUserId: string | null;
  affiliateRecipientAddress: string | null;
  feeConfigLockedAt?: string | null;
};

type AffiliateLaunchOverview = {
  lockedFeePreview?: LaunchFeePreview | null;
};

type FundingVaultOverview = {
  mode?: string;
  fundingVault?: {
    id: string | null;
    onchainAddress: string | null;
    freeBalance?: number;
    reservedBalance?: number;
    availableBalance?: number;
    status?: string;
  } | null;
  ready?: boolean;
  setup?: {
    canCreate?: boolean;
    needsLinkedWallet?: boolean;
    needsAgentWallet?: boolean;
    needsOnchainAddress?: boolean;
  } | null;
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
    || String(instance?.botVault?.lifecycle?.state ?? "").trim().toLowerCase() === "execution_active"
  );
}

function effectiveProvisioningPhase(instance: GridInstance | null | undefined): string {
  if (isGridExecutionRunning(instance)) return "completed";
  const lifecycleState = String(instance?.botVault?.lifecycle?.state ?? "").trim().toLowerCase();
  if (lifecycleState === "execution_ready" || lifecycleState === "execution_active") return "completed";
  return normalizeGridProvisioningPhase(instance?.provisioningStatus?.phase);
}

function buildProvisioningProgressSteps(
  instance: GridInstance | null,
  tGrid: ReturnType<typeof useTranslations<"grid.marketplace">>
): ProvisioningProgressStep[] {
  const normalized = effectiveProvisioningPhase(instance);
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

function GridBotCatalogPageContent() {
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const tGrid = useTranslations("grid.marketplace");
  const { address: connectedWalletAddress } = useAccount();
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
      if (!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending) return;
      hypercoreProvisionTriggeredRef.current = true;
      const completed = await flow.executeAction({
        busyKey: "fund-hypercore-grid-bot-catalog",
        buildPath: `/grid/instances/${encodeURIComponent(instanceId)}/onchain/fund-hypercore-tx`,
        body: {
          actionKey: createIdempotencyKey(`grid_hypercore_funding:${botVaultId}`)
        },
        submitPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/submit-tx`,
        failPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/fail-tx`
      });
      if (!completed) hypercoreProvisionTriggeredRef.current = false;
      return;
    }
    if (phase === "pending_reserve_signature") {
      const botVaultId = String(latest?.botVault?.id ?? "").trim();
      if (!botVaultId || reserveProvisionTriggeredRef.current) return;
      if (!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending) return;
      reserveProvisionTriggeredRef.current = true;
      const completed = await flow.executeAction({
        busyKey: "reserve-grid-bot-catalog",
        buildPath: `/grid/instances/${encodeURIComponent(instanceId)}/onchain/reserve-tx`,
        body: {
          actionKey: createIdempotencyKey(`grid_reserve_provision:${botVaultId}`)
        },
        submitPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/submit-tx`,
        failPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/fail-tx`
      });
      if (!completed) reserveProvisionTriggeredRef.current = false;
      return;
    }
  }
  const flow = useOnchainActionFlow(async () => {
    if (!createdInstanceId || flowRedirectedRef.current) return;
    const latest = await apiGet<GridInstance>(`/grid/instances/${encodeURIComponent(createdInstanceId)}`).catch(() => null);
    if (latest) setCreatedInstance(latest);
    await continueProvisioning(latest, createdInstanceId);
  }, { actionsPath: "/grid/onchain/actions?limit=25" });

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
    const [launchFeePreview, setLaunchFeePreview] = useState<LaunchFeePreview | null>(null);
    const [walletFundingOverview, setWalletFundingOverview] = useState<WalletFundingOverview | null>(null);
    const [walletFundingLoading, setWalletFundingLoading] = useState(false);
    const [walletFundingError, setWalletFundingError] = useState<string | null>(null);
    const [fundingVaultOverview, setFundingVaultOverview] = useState<FundingVaultOverview | null>(null);
    const [fundingVaultLoading, setFundingVaultLoading] = useState(false);
    const [fundingVaultError, setFundingVaultError] = useState<string | null>(null);
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
    const [fundingSource, setFundingSource] = useState<"wallet_direct" | "funding_vault">("wallet_direct");
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
    () => provisioningPhaseLabel(effectiveProvisioningPhase(createdInstance), tGrid),
    [createdInstance, tGrid]
  );
  const provisioningHintText = useMemo(() => {
    if (provisioningFinished) return tGrid("provisioningTrackerReadyToClose");
    if (!createdInstance) return tGrid("provisioningPhaseUnknown");
    const normalized = effectiveProvisioningPhase(createdInstance);
    if (normalized === "ready" || normalized === "completed") {
      if (createdInstance.lastPlanError) return createdInstance.lastPlanError;
      if (!hasInitialSeedExecution(createdInstance) && createdInstance.initialSeedEnabled !== false) {
        return tGrid("provisioningTrackerSeeding");
      }
      if (!hasGridPlacement(createdInstance)) return tGrid("provisioningTrackerPlacingGrid");
      return tGrid("provisioningTrackerStartingBot");
    }
    return createdInstance.provisioningStatus?.walletSignatureRequired
      ? tGrid("provisioningWalletSignatureRequired")
      : tGrid("provisioningIndexerWaiting");
  }, [createdInstance, provisioningFinished, tGrid]);
  const provisioningSignaturePhase = normalizeGridProvisioningPhase(createdInstance?.provisioningStatus?.phase);
  const canResumeProvisioningSignature = Boolean(
    createdInstanceId
      && createdInstance?.botVault?.id
      && !provisioningFinished
      && (
        provisioningSignaturePhase === "pending_reserve_signature"
        || provisioningSignaturePhase === "pending_hypercore_funding_signature"
      )
  );
  const provisioningSignatureButtonLabel = provisioningSignaturePhase === "pending_hypercore_funding_signature"
    ? tGrid("fundHypercoreAction")
    : tGrid("reserveBotVaultAction");

  async function resumeProvisioningSignature() {
    if (provisioningSignaturePhase === "pending_hypercore_funding_signature") {
      hypercoreProvisionTriggeredRef.current = false;
    }
    if (provisioningSignaturePhase === "pending_reserve_signature") {
      reserveProvisionTriggeredRef.current = false;
    }
    await continueProvisioning(createdInstance, createdInstanceId);
  }

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
  const isHyperliquidLaunchAccount = usesHyperliquidMarketData(selectedAccount);
  const stablecoinLabel = isHyperliquidLaunchAccount ? "USDC" : "USDT";
  const autoMarginActive = marginMode === "AUTO";
  const requestedExtraMarginUsd = autoMarginActive ? 0 : Number(extraMarginUsd || 0);
  const launchIncludesCreateFee = isHyperliquidLaunchAccount && !selectedReusableBotVault;
  const launchFundingBreakdown = useMemo(() => buildBotVaultFundingBreakdown({
    investUsd: Number(investUsd),
    extraMarginUsd: requestedExtraMarginUsd,
    includeCreateFee: launchIncludesCreateFee
  }), [investUsd, launchIncludesCreateFee, requestedExtraMarginUsd]);
  const activeLaunchFeePreview = selectedReusableBotVault?.feeConfigSummary ?? launchFeePreview;
  const platformFeeRatePct = Number(activeLaunchFeePreview?.platformFeeRatePct ?? 0);
  const affiliateFeeRatePct = Number(activeLaunchFeePreview?.affiliateFeeRatePct ?? 0);
  const totalFeeRatePct = Number(activeLaunchFeePreview?.totalFeeRatePct ?? platformFeeRatePct + affiliateFeeRatePct);
  const affiliateLinked = Boolean(activeLaunchFeePreview?.affiliateUserId && affiliateFeeRatePct > 0);
  const walletUsdcBalance = walletFundingOverview?.hyperEvm?.usdc ?? null;
  const walletUsdcAvailableValue = walletUsdcBalance?.available && walletUsdcBalance.formatted != null
    ? Number(walletUsdcBalance.formatted)
    : null;
  const walletFundingShortfall = isHyperliquidLaunchAccount
    && !selectedReusableBotVault
    && walletUsdcAvailableValue != null
    && Number.isFinite(walletUsdcAvailableValue)
    && walletUsdcAvailableValue + 1e-9 < launchFundingBreakdown.totalFundingUsd;
    const walletUsdcDisplay = !connectedWalletAddress
      ? tGrid("launchWalletUsdcConnect")
    : walletFundingLoading
      ? tGrid("launchWalletUsdcLoading")
      : walletFundingError || walletUsdcAvailableValue == null || !Number.isFinite(walletUsdcAvailableValue)
        ? tGrid("launchWalletUsdcUnavailable")
          : `${formatNumber(walletUsdcAvailableValue, 2)} USDC`;
    const fundingVaultAvailableValue = Number(fundingVaultOverview?.fundingVault?.availableBalance ?? fundingVaultOverview?.fundingVault?.freeBalance ?? NaN);
    const fundingVaultReady = Boolean(fundingVaultOverview?.fundingVault?.onchainAddress);
    const effectiveFundingSource = isHyperliquidLaunchAccount ? fundingSource : "wallet_direct";
    const usesFundingVaultLaunch = effectiveFundingSource === "funding_vault";
    const fundingVaultShortfall = usesFundingVaultLaunch
      && Number.isFinite(fundingVaultAvailableValue)
      && fundingVaultAvailableValue + 1e-9 < launchFundingBreakdown.totalFundingUsd;
    const fundingVaultDisplay = fundingVaultLoading
      ? tGrid("launchWalletUsdcLoading")
      : fundingVaultError || !fundingVaultReady || !Number.isFinite(fundingVaultAvailableValue)
        ? tGrid("launchFundingVaultUnavailable")
        : `${formatNumber(fundingVaultAvailableValue, 2)} USDC`;
    const fundingVaultHint = fundingVaultReady
      ? tGrid("launchFundingVaultRequired", {
          amount: formatNumber(launchFundingBreakdown.totalFundingUsd, 2),
          stablecoin: stablecoinLabel
        })
      : tGrid("launchFundingVaultSetupHint");
  const walletFundingHint = selectedReusableBotVault
    ? tGrid("launchWalletUsdcReusableHint")
    : tGrid(launchIncludesCreateFee ? "launchWalletUsdcRequiredWithFee" : "launchWalletUsdcRequired", {
        amount: formatNumber(launchFundingBreakdown.totalFundingUsd, 2),
        stablecoin: stablecoinLabel
      });
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
        && (!usesFundingVaultLaunch || (fundingVaultReady && !fundingVaultShortfall))
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
      const [filterResponse, accountResponse, pilotResponse, botVaultResponse, affiliateResponse] = await Promise.all([
        apiGet<GridTemplateFiltersResponse>("/grid/templates/filters"),
        apiGet<{ items: ExchangeAccount[] }>("/exchange-accounts?purpose=execution"),
        apiGet<GridPilotAccess>("/grid/pilot-access"),
        apiGet<{ items: BotVaultSnapshot[] }>("/vaults/bot-vaults?reusableOnly=true").catch(() => ({ items: [] })),
        apiGet<AffiliateLaunchOverview>("/settings/affiliate?refreshPayoutWallet=false").catch(() => null)
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
      setLaunchFeePreview(affiliateResponse?.lockedFeePreview ?? null);
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
      if (!connectedWalletAddress || !isHyperliquidLaunchAccount) {
        setWalletFundingOverview(null);
      setWalletFundingError(null);
      setWalletFundingLoading(false);
      return;
    }

    let cancelled = false;
    setWalletFundingLoading(true);
    setWalletFundingError(null);
    void apiGet<WalletFundingOverview>(`/funding/${encodeURIComponent(connectedWalletAddress)}/overview`)
      .then((response) => {
        if (cancelled) return;
        setWalletFundingOverview(response);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setWalletFundingOverview(null);
        setWalletFundingError(errMsg(loadError));
      })
      .finally(() => {
        if (!cancelled) setWalletFundingLoading(false);
      });

    return () => {
      cancelled = true;
      };
    }, [connectedWalletAddress, isHyperliquidLaunchAccount]);

    useEffect(() => {
      if (!isHyperliquidLaunchAccount) {
        setFundingVaultOverview(null);
        setFundingVaultError(null);
        setFundingVaultLoading(false);
        setFundingSource("wallet_direct");
        return;
      }

      let cancelled = false;
      setFundingVaultLoading(true);
      setFundingVaultError(null);
      void apiGet<FundingVaultOverview>("/vaults/funding-vault")
        .then((response) => {
          if (cancelled) return;
          setFundingVaultOverview(response);
        })
        .catch((loadError) => {
          if (cancelled) return;
          setFundingVaultOverview(null);
          setFundingVaultError(errMsg(loadError));
        })
        .finally(() => {
          if (!cancelled) setFundingVaultLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [isHyperliquidLaunchAccount]);

    useEffect(() => {
      if (fundingSource === "funding_vault" && !fundingVaultReady) {
        setFundingSource("wallet_direct");
      }
    }, [fundingSource, fundingVaultReady]);

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
      const includesCreateFee = launchIncludesCreateFee;
      const fundingBreakdown = launchFundingBreakdown;
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
          fundingSource: effectiveFundingSource,
          fundingVaultId: usesFundingVaultLaunch ? fundingVaultOverview?.fundingVault?.id ?? undefined : undefined,
          idempotencyKey: provisionCreateKey.current
        });
        if (created && typeof created === "object" && "instance" in created && "onchainAction" in created) {
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
          if (created.txRequest) {
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
              },
              submitPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/submit-tx`,
              failPath: (actionId) => `/grid/instances/${encodeURIComponent(instanceId)}/onchain/actions/${encodeURIComponent(actionId)}/fail-tx`
            });
            setNotice(null);
          } else {
            setNotice(tGrid("provisioningTrackerSubmitted"));
            provisionCreateKey.current = createIdempotencyKey("grid_catalog_create");
          }
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
      <DeskSurface dense><section className="card gridCatalogHero">
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
	          <Link href={withLocalePath("/bots/grid", locale)} className="btn">
	            <AppIcon name="dashboard" />
	            {tGrid("dashboard")}
	          </Link>
	          <Link href={withLocalePath("/bots/catalog/new", locale)} className="btn btnPrimary">
	            <AppIcon name="create" />
	            {tGrid("catalogCreateOwnTemplate")}
	          </Link>
	          <Link href={withLocalePath("/bots/grid/new", locale)} className="btn">
	            <AppIcon name="gridBots" />
	            {tGrid("catalogFallbackCta")}
	          </Link>
	        </div>
      </section></DeskSurface>

      {error || flow.error ? (
        <Notice tone="danger" className="card gridCatalogStatus gridCatalogStatusError" dismissible onDismiss={error ? () => setError(null) : undefined}>
          {error ?? flow.error}
        </Notice>
      ) : null}
      {notice || flow.notice ? (
        <Notice tone="success" className="card gridCatalogStatus gridCatalogStatusSuccess" onDismiss={notice ? () => setNotice(null) : undefined}>
          {notice ?? flow.notice}
        </Notice>
      ) : null}
      <DeskSurface dense><section className="card gridCatalogFilters">
        <div className="gridCatalogFilterGrid">
          <label className="gridCatalogField">
            {tGrid("catalogSearch")}
            <DeskInput className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tGrid("catalogSearchPlaceholder")} />
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogCategory")}
            <DeskSelect className="input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </DeskSelect>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogTag")}
            <DeskSelect className="input" value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </DeskSelect>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogDifficulty")}
            <DeskSelect className="input" value={selectedDifficulty} onChange={(event) => setSelectedDifficulty(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.difficulties.map((value) => <option key={value} value={value}>{tGrid(`catalogDifficultyValues.${value}`)}</option>)}
            </DeskSelect>
          </label>
          <label className="gridCatalogField">
            {tGrid("catalogRisk")}
            <DeskSelect className="input" value={selectedRisk} onChange={(event) => setSelectedRisk(event.target.value)}>
              <option value="ALL">{tGrid("catalogAll")}</option>
              {filters.risks.map((value) => <option key={value} value={value}>{tGrid(`catalogRiskValues.${value}`)}</option>)}
            </DeskSelect>
          </label>
        </div>
        <div className="gridCatalogFilterFooter">
          <label className="settingsToggle gridCatalogToggle">
            <DeskInput type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
            <span>{tGrid("catalogFavoritesOnly")}</span>
          </label>
          <label className="settingsToggle gridCatalogToggle">
            <DeskInput type="checkbox" checked={ownOnly} onChange={(event) => setOwnOnly(event.target.checked)} />
            <span>{tGrid("catalogOwnOnly")}</span>
          </label>
          <div className="gridCatalogFilterActions">
            <div className="gridCatalogViewToggle" role="group" aria-label={tGrid("catalogViewLabel")}>
              <DeskButton
                className={`btn gridCatalogViewButton ${catalogView === "grid" ? "gridCatalogViewButtonActive" : ""}`}
                type="button"
	                onClick={() => setCatalogView("grid")}
	              >
	                <AppIcon name="grid" />
	                {tGrid("catalogViewGrid")}
	              </DeskButton>
              <DeskButton
                className={`btn gridCatalogViewButton ${catalogView === "list" ? "gridCatalogViewButtonActive" : ""}`}
                type="button"
	                onClick={() => setCatalogView("list")}
	              >
	                <AppIcon name="list" />
	                {tGrid("catalogViewList")}
	              </DeskButton>
            </div>
	            {hasActiveFilters ? (
	              <DeskButton className="btn" type="button" onClick={resetFilters}>
	                <AppIcon name="reset" />
	                {tGrid("catalogResetFilters")}
	              </DeskButton>
	            ) : null}
          </div>
        </div>
      </section></DeskSurface>

      {(loadingCatalog || loadingMeta) ? (
        <DeskSurface dense><div className="card gridCatalogState">{tGrid("catalogLoading")}</div></DeskSurface>
      ) : templates.length === 0 ? (
        <DeskSurface dense><div className="card gridCatalogState">
	          <div className="gridCatalogStateTitle">{tGrid("catalogEmptyTitle")}</div>
	          <div className="gridCatalogStateBody">{tGrid("catalogEmptyBody")}</div>
	          <DeskButton className="btn" type="button" onClick={resetFilters}>
	            <AppIcon name="reset" />
	            {tGrid("catalogResetFilters")}
	          </DeskButton>
        </div></DeskSurface>
      ) : (
        <div className={`gridCatalogGrid ${catalogView === "list" ? "gridCatalogGridList" : ""}`}>
          {templates.map((template) => (
            <DeskSurface dense><article
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
                  <DeskButton
                    type="button"
                    className={`btn gridCatalogFavoriteButton ${template.isFavorite ? "btnPrimary" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFavorite(template);
                    }}
	                    disabled={favoriteBusyId === template.id}
	                    aria-label={template.isFavorite ? tGrid("catalogUnfavorite") : tGrid("catalogFavorite")}
	                  >
	                    <AppIcon name="favorite" />
	                    {favoriteBusyId === template.id ? "..." : template.isFavorite ? tGrid("catalogUnfavorite") : tGrid("catalogFavorite")}
	                  </DeskButton>
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
            </article></DeskSurface>
          ))}
        </div>
      )}

      {selectedTemplate ? (
        <div
          className="gridCatalogDrawerBackdrop"
          onClick={closeDrawer}
        >
          <DeskSurface dense><aside
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
	              <DeskButton className="btn" type="button" onClick={closeDrawer}>
	                <AppIcon name="close" />
	                {tGrid("catalogClose")}
	              </DeskButton>
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
              <DeskSurface dense><div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateSymbol")}</strong>
                <div className="gridCatalogStatValue">{selectedTemplate.symbol}</div>
              </div></DeskSurface>
                <DeskSurface dense><div className="card gridCatalogStatCard">
                  <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateMode")}</strong>
                  <div className="gridCatalogStatValue">{formatCatalogEnumLabel(selectedTemplate.mode)} · {formatCatalogEnumLabel(selectedTemplate.gridMode)}</div>
                </div></DeskSurface>
              <DeskSurface dense><div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateRange")}</strong>
                <div className="gridCatalogStatValue">{rangeSummary(selectedTemplate)}</div>
              </div></DeskSurface>
              <DeskSurface dense><div className="card gridCatalogStatCard">
                <strong className="gridCatalogStatLabel">{tGrid("catalogTemplateLeverage")}</strong>
                <div className="gridCatalogStatValue">{selectedTemplate.leverageDefault}x</div>
              </div></DeskSurface>
              {selectedTemplate.isOwnTemplate ? (
                <DeskSurface dense><div className="card gridCatalogStatCard">
                  <strong className="gridCatalogStatLabel">{tGrid("catalogCreatorProfitShare")}</strong>
                  <div className="gridCatalogStatValue">{formatNumber(Number(selectedTemplate.creatorProfitSharePct ?? 0), 2)}%</div>
                </div></DeskSurface>
              ) : null}
            </div>

            <form onSubmit={createInstance} className="gridCatalogLaunchForm">
              <DeskSurface dense><section className="card gridCatalogSection">
                <div className="gridCatalogSectionHeader">
                  <div>
                    <strong className="gridCatalogSectionTitle">{tGrid("launchSetupTitle")}</strong>
                    <div className="gridCatalogSectionHint">{replaceStablecoinUnit(autoMarginActive ? tGrid("launchSetupAutoHint") : tGrid("launchSetupManualHint"), stablecoinLabel)}</div>
                  </div>
                </div>
                {isHyperliquidLaunchAccount ? (
                  <div className="gridCatalogLaunchHighlights">
                      <div className={`gridCatalogMiniPanel ${walletFundingShortfall ? "gridCatalogMiniPanelWarn" : ""}`}>
                      <div className="gridCatalogMiniPanelTop">
                        <span className="gridCatalogMiniPanelLabel">{tGrid("launchWalletUsdcLabel")}</span>
                        {walletFundingShortfall ? <span className="badge badgeWarn">{tGrid("launchWalletUsdcShortfall")}</span> : null}
                      </div>
                      <strong className="gridCatalogMiniPanelValue">{walletUsdcDisplay}</strong>
                        <div className="gridCatalogMiniPanelHint">{walletFundingHint}</div>
                      </div>
                      <div className={`gridCatalogMiniPanel ${fundingVaultShortfall ? "gridCatalogMiniPanelWarn" : ""}`}>
                        <div className="gridCatalogMiniPanelTop">
                          <span className="gridCatalogMiniPanelLabel">{tGrid("launchFundingVaultLabel")}</span>
                          {fundingVaultShortfall ? <span className="badge badgeWarn">{tGrid("launchWalletUsdcShortfall")}</span> : null}
                        </div>
                        <strong className="gridCatalogMiniPanelValue">{fundingVaultDisplay}</strong>
                        <div className="gridCatalogMiniPanelHint">{fundingVaultHint}</div>
                      </div>
                      <div className="gridCatalogMiniPanel">
                      <div className="gridCatalogMiniPanelTop">
                        <span className="gridCatalogMiniPanelLabel">{tGrid("launchProfitshareLabel")}</span>
                        <span className="badge">{tGrid("launchProfitshareTotal", { rate: formatNumber(totalFeeRatePct, 2) })}</span>
                      </div>
                      <div className="gridCatalogProfitshareChips">
                        <span className="badge">{tGrid("launchPlatformShare", { rate: formatNumber(platformFeeRatePct, 2) })}</span>
                        <span className={`badge ${affiliateLinked ? "badgeOk" : ""}`}>
                          {affiliateLinked
                            ? tGrid("launchAffiliateShare", { rate: formatNumber(affiliateFeeRatePct, 2) })
                            : tGrid("launchAffiliateShareNone")}
                        </span>
                      </div>
                      <div className="gridCatalogMiniPanelHint">
                        {affiliateLinked
                          ? tGrid("launchProfitshareLinkedHint", {
                              platformRate: formatNumber(platformFeeRatePct, 2),
                              affiliateRate: formatNumber(affiliateFeeRatePct, 2)
                            })
                          : tGrid("launchProfitshareUnlinkedHint", {
                              platformRate: formatNumber(platformFeeRatePct, 2)
                            })}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="gridCatalogLaunchGrid">
                  <label className="gridCatalogField">
                    {usesHyperliquidMarketData(selectedAccount) ? tGrid("vaultAccount") : tGrid("exchangeAccount")}
                    <DeskSelect className="input" value={exchangeAccountId} onChange={(event) => setExchangeAccountId(event.target.value)}>
                      {accounts.length > 0 ? accounts.map((row) => (
                        <option key={row.id} value={row.id}>{formatExecutionAccountOption(row)}</option>
                      )) : <option value="">{tGrid("noExecutionAccountsOption")}</option>}
                    </DeskSelect>
                  </label>
                    {usesHyperliquidMarketData(selectedAccount) ? (
                      <>
                        <label className="gridCatalogField">
                          {tGrid("launchFundingSourceLabel")}
                          <DeskSelect className="input" value={fundingSource} onChange={(event) => setFundingSource(event.target.value === "funding_vault" ? "funding_vault" : "wallet_direct")}>
                            <option value="wallet_direct">{tGrid("launchFundingSourceWallet")}</option>
                            <option value="funding_vault" disabled={!fundingVaultReady}>{tGrid("launchFundingSourceVault")}</option>
                          </DeskSelect>
                        </label>
                        <label className="gridCatalogField">
                        {tGrid("botVaultReuseLabel")}
                        <DeskSelect className="input" value={selectedBotVaultId} onChange={(event) => setSelectedBotVaultId(event.target.value)}>
                          <option value="">{tGrid("botVaultReuseCreateNew")}</option>
                          {reusableBotVaults.map((row) => (
                            <option key={row.id} value={row.id}>{formatReusableBotVaultOption(row, stablecoinLabel)}</option>
                          ))}
                        </DeskSelect>
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
                    <DeskInput className="input" type="number" min="1" step="0.01" value={investUsd} onChange={(event) => setInvestUsd(event.target.value)} />
                  </label>
                  {!autoMarginActive ? (
                    <label className="gridCatalogField">
                      {replaceStablecoinUnit(tGrid("extraMargin"), stablecoinLabel)}
                      <DeskInput className="input" type="number" min="0" step="0.01" value={extraMarginUsd} onChange={(event) => setExtraMarginUsd(event.target.value)} />
                    </label>
                  ) : null}
                  <label className="gridCatalogField">
                    {tGrid("triggerPrice")}
                    <DeskInput className="input" type="number" min="0" step="0.0001" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("tpPct")}
                    <DeskInput className="input" type="number" min="0" step="0.01" value={tpPct} onChange={(event) => setTpPct(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("slPrice")}
                    <DeskInput className="input" type="number" min="0" step="0.01" value={slPrice} onChange={(event) => setSlPrice(event.target.value)} />
                  </label>
                  <label className="gridCatalogField">
                    {tGrid("marginMode")}
                    <DeskSelect className="input" value={marginMode} disabled={selectedTemplate.marginPolicy !== "AUTO_ALLOWED"} onChange={(event) => setMarginMode(event.target.value === "AUTO" ? "AUTO" : "MANUAL")}>
                      <option value="MANUAL">{tGrid("marginModeManualOption")}</option>
                      <option value="AUTO">{tGrid("marginModeAutoOption")}</option>
                    </DeskSelect>
                  </label>
                </div>
              </section></DeskSurface>

              {accounts.length === 0 ? (
                <DeskSurface dense><div className="card gridCatalogCallout gridCatalogCalloutWarn">
                  <div className="gridCatalogCalloutTitle">{tGrid("noExecutionAccountsTitle")}</div>
                  <div className="gridCatalogCalloutBody">{tGrid("noExecutionAccountsBody")}</div>
                  <div className="gridCatalogCalloutBody">
                    {tGrid("noExecutionAccountsHint", { exchanges: [...allowedGridExchanges].join(", ") })}
                  </div>
	                  <Link href={withLocalePath("/settings", locale)} className="btn">
	                    <AppIcon name="settings" />
	                    {tGrid("openExchangeSettings")}
	                  </Link>
                </div></DeskSurface>
              ) : null}

              {preview ? (
                <section className="gridCatalogPreviewSummaryGrid">
                  <DeskSurface dense><div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("investTotalBudget"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.totalBudgetUsd, 2)} {stablecoinLabel}</div>
                  </div></DeskSurface>
                  <DeskSurface dense><div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("invest"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.gridInvestUsd, 2)} {stablecoinLabel}</div>
                  </div></DeskSurface>
                  <DeskSurface dense><div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{replaceStablecoinUnit(tGrid("extraMargin"), stablecoinLabel)}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.extraMarginUsd, 2)} {stablecoinLabel}</div>
                  </div></DeskSurface>
                  <DeskSurface dense><div className="card gridCatalogStatCard">
                    <strong className="gridCatalogStatLabel">{tGrid("targetLiqDistance")}</strong>
                    <div className="gridCatalogStatValue">{formatNumber(preview.allocation.targetLiqDistancePct, 2)}%</div>
                  </div></DeskSurface>
                </section>
              ) : null}

              <DeskSurface dense><div className={`card gridCatalogPreview ${previewInsufficient ? "gridCatalogPreviewInsufficient" : liqRiskActive ? "gridCatalogPreviewRisk" : ""}`}>
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
              </div></DeskSurface>

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
	                <DeskButton className="btn" type="button" onClick={closeDrawer}>
	                  <AppIcon name="close" />
	                  {tGrid("catalogClose")}
	                </DeskButton>
	                <DeskButton className="btn btnPrimary" type="submit" disabled={!canCreate}>
	                  <AppIcon name="launch" />
	                  {creating ? tGrid("creating") : tGrid("catalogStart")}
	                </DeskButton>
              </div>
            </form>
          </aside></DeskSurface>
        </div>
      ) : null}

      {createdInstanceId && provisioningMeta ? (
        <div className="gridCatalogProgressBackdrop">
          <DeskSurface dense><section className="card gridCatalogProgressModal" aria-live="polite" aria-busy={!provisioningFinished}>
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

            {canResumeProvisioningSignature ? (
              <div className="gridCatalogActionRow">
                <div className="gridCatalogActionMeta">
                  <div className="gridCatalogActionMetaHint">{tGrid("provisioningWalletSignatureRequired")}</div>
                </div>
                <DeskButton
                  className="btn btnPrimary"
                  type="button"
                  disabled={!flow.canSignLiveActions || flow.busyKey !== null || flow.isWalletPending}
                  onClick={() => void resumeProvisioningSignature()}
                >
                  <AppIcon name="deposit" />
                  {provisioningSignatureButtonLabel}
                </DeskButton>
              </div>
            ) : null}

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
	                <DeskButton className="btn btnPrimary" type="button" onClick={closeProvisioningTracker}>
	                  <AppIcon name="check" />
	                  {tGrid("catalogClose")}
	                </DeskButton>
              </div>
            ) : null}
          </section></DeskSurface>
        </div>
      ) : null}
    </div>
  );
}

export default function GridBotCatalogPage() {
  return (
    <Web3Providers>
      <GridBotCatalogPageContent />
    </Web3Providers>
  );
}
