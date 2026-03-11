export type GridMode = "long" | "short" | "neutral" | "cross";
export type GridPriceMode = "arithmetic" | "geometric";
export type GridAllocationMode = "EQUAL_NOTIONAL_PER_GRID" | "EQUAL_BASE_QTY_PER_GRID" | "WEIGHTED_NEAR_PRICE";
export type GridBudgetSplitPolicy = "FIXED_50_50" | "FIXED_CUSTOM" | "DYNAMIC_BY_PRICE_POSITION";
export type GridMarginPolicy = "MANUAL_ONLY" | "AUTO_ALLOWED";
export type GridInstanceMarginMode = "MANUAL" | "AUTO";
export type GridAutoReservePolicy = "FIXED_RATIO" | "LIQ_GUARD_MAX_GRID";

export type BotVaultSnapshot = {
  id: string;
  masterVaultId?: string;
  principalAllocated?: number;
  principalReturned?: number;
  realizedPnlNet?: number;
  feePaidTotal?: number;
  highWaterMark?: number;
  allocatedUsd: number;
  realizedGrossUsd?: number;
  realizedFeesUsd?: number;
  realizedNetUsd: number;
  profitShareAccruedUsd: number;
  withdrawnUsd: number;
  withdrawableUsd: number;
  availableUsd: number;
  status?: string;
  executionProvider?: string | null;
  executionUnitId?: string | null;
  executionStatus?: string | null;
  executionLastSyncedAt?: string | null;
  executionLastError?: string | null;
  executionLastErrorAt?: string | null;
  providerMetadataSummary?: {
    providerMode?: string | null;
    chain?: string | null;
    marketDataExchange?: string | null;
    vaultAddress?: string | null;
    agentWallet?: string | null;
    subaccountAddress?: string | null;
    lastAction?: string | null;
    providerSelectionReason?: string | null;
    pilotScope?: string | null;
  } | null;
  providerMetadataRaw?: Record<string, unknown> | null;
  updatedAt?: string | null;
};

export type MasterVaultSummary = {
  id: string;
  userId: string;
  executionMode?: "offchain_shadow" | "onchain_simulated" | "onchain_live";
  onchainAddress?: string | null;
  treasuryRecipient?: string | null;
  freeBalance: number;
  reservedBalance: number;
  withdrawableBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalAllocatedUsd: number;
  totalRealizedNetUsd: number;
  totalProfitShareAccruedUsd: number;
  botVaultCount: number;
  updatedAt: string | null;
};

export type ExchangeAccount = {
  id: string;
  exchange: string;
  label: string;
  apiKeyMasked: string;
  supportsPerpManual?: boolean;
  marketDataExchange?: string | null;
  marketDataLabel?: string | null;
};

export type GridTemplate = {
  id: string;
  name: string;
  description?: string | null;
  symbol: string;
  marketType?: "perp";
  mode: GridMode;
  gridMode: GridPriceMode;
  allocationMode: GridAllocationMode;
  budgetSplitPolicy: GridBudgetSplitPolicy;
  longBudgetPct: number;
  shortBudgetPct: number;
  marginPolicy: GridMarginPolicy;
  autoMarginMaxUSDT: number | null;
  autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW" | "MARGIN_RATIO_ABOVE" | null;
  autoMarginTriggerValue: number | null;
  autoMarginStepUSDT: number | null;
  autoMarginCooldownSec: number | null;
  autoReservePolicy: GridAutoReservePolicy;
  autoReserveFixedGridPct: number;
  autoReserveTargetLiqDistancePct: number | null;
  autoReserveMaxPreviewIterations: number;
  initialSeedEnabled?: boolean;
  initialSeedPct?: number;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  leverageMin?: number;
  leverageMax?: number;
  leverageDefault: number;
  investMinUsd: number;
  investMaxUsd: number;
  investDefaultUsd: number;
  slippageDefaultPct: number;
  slippageMinPct?: number;
  slippageMaxPct?: number;
  tpDefaultPct: number | null;
  slDefaultPrice: number | null;
  allowAutoMargin?: boolean;
  allowManualMarginAdjust: boolean;
  allowProfitWithdraw: boolean;
  isPublished?: boolean;
  isArchived?: boolean;
  version?: number;
  updatedAt?: string;
};

export type GridInstance = {
  id: string;
  exchangeAccountId: string;
  templateId: string;
  botId: string;
  state: "created" | "running" | "paused" | "stopped" | "archived" | "error";
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
  restartable?: boolean;
  allocationMode: GridAllocationMode;
  budgetSplitPolicy: GridBudgetSplitPolicy;
  longBudgetPct: number;
  shortBudgetPct: number;
  marginPolicy: GridMarginPolicy;
  investUsd: number;
  leverage: number;
  extraMarginUsd: number;
  triggerPrice: number | null;
  slippagePct: number;
  tpPct: number | null;
  slPrice: number | null;
  autoMarginEnabled: boolean;
  marginMode: GridInstanceMarginMode;
  autoMarginMaxUSDT: number | null;
  autoMarginTriggerType: "LIQ_DISTANCE_PCT_BELOW" | "MARGIN_RATIO_ABOVE" | null;
  autoMarginTriggerValue: number | null;
  autoMarginStepUSDT: number | null;
  autoMarginCooldownSec: number | null;
  autoReservePolicy?: GridAutoReservePolicy;
  autoReserveFixedGridPct?: number;
  autoReserveTargetLiqDistancePct?: number | null;
  autoReserveMaxPreviewIterations?: number;
  initialSeedEnabled?: boolean;
  initialSeedPct?: number;
  autoMarginUsedUSDT: number;
  lastAutoMarginAt: string | null;
  metricsJson: Record<string, unknown>;
  lastPlanAt: string | null;
  lastPlanError: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  template: GridTemplate | null;
  botVault?: BotVaultSnapshot | null;
  pilotStatus?: {
    allowed: boolean;
    reason: string;
    provider?: string | null;
    providerSelectionReason?: string | null;
    scope?: string | null;
    lastBlockAt?: string | null;
    lastSyncErrorAt?: string | null;
  } | null;
};

export type GridInstanceDetail = GridInstance & {
  stateJson: Record<string, unknown>;
  executionState?: Record<string, unknown> | null;
};

export type BotVaultPnlReport = {
  botVaultId: string;
  grossRealizedPnl: number;
  tradingFeesTotal: number;
  fundingTotal: number;
  realizedPnlNet: number;
  netWithdrawableProfit: number;
  isFlat: boolean;
  openPositionCount: number;
  lastReconciledAt: string | null;
  latestPositionSnapshot?: Record<string, unknown> | null;
  fillsPreview?: GridFillsResponse["items"];
};

export type OnchainActionItem = {
  id: string;
  actionKey: string;
  actionType: string;
  status: string;
  userId?: string | null;
  masterVaultId?: string | null;
  botVaultId?: string | null;
  chainId: number;
  txHash: string | null;
  toAddress: string;
  dataHex: string;
  valueWei: string;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UserOnchainActionsResponse = {
  mode: "offchain_shadow" | "onchain_simulated" | "onchain_live";
  items: OnchainActionItem[];
};

export type OnchainTxRequest = {
  to: string;
  data: string;
  value: string;
  chainId: number;
};

export type OnchainBuildActionResponse = {
  ok: true;
  mode: "offchain_shadow" | "onchain_simulated" | "onchain_live";
  action: OnchainActionItem;
  txRequest: OnchainTxRequest;
  settlementPreview?: {
    contractVersion: string;
    treasuryPayoutModel: string;
    treasuryRecipient: string | null;
    releasedReservedUsd: number;
    grossReturnedUsd: number;
    feeBaseUsd: number;
    feeAmountUsd: number;
    netReturnedUsd: number;
    realizedPnlAfterUsd: number;
    highWaterMarkBeforeUsd: number;
    highWaterMarkAfterUsd: number;
  } | null;
};

export type GridInstancePreviewResponse = {
  markPrice: number;
  marketDataVenue?: string | null;
  pilotAccess?: {
    allowed: boolean;
    reason: string;
    scope?: string;
  } | null;
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
    longBudgetPct?: number | null;
    shortBudgetPct?: number | null;
    sideNotionalPerOrderLong?: number;
    sideNotionalPerOrderShort?: number;
    qtyPerOrderLong?: number;
    qtyPerOrderShort?: number;
  } | null;
  qtyModel?: {
    mode?: string;
    qtyPerOrder?: number | null;
    qtyBase?: number | null;
  } | null;
  windowMeta?: {
    activeOrdersTotal?: number;
    activeBuys?: number;
    activeSells?: number;
    windowLowerIdx?: number;
    windowUpperIdx?: number;
    recenterReason?: string;
  } | null;
  profitPerGridEstimateUSDT?: number | null;
  liq: {
    liqEstimateLong: number | null;
    liqEstimateShort: number | null;
    worstCaseLiqPrice: number | null;
    worstCaseLiqDistancePct: number | null;
    liqDistanceMinPct: number;
  };
  warnings: string[];
};

export type GridMetricsResponse = {
  id: string;
  state: string;
  metrics: Record<string, unknown>;
  stateJson: Record<string, unknown>;
  lastPlanAt: string | null;
  lastPlanError: string | null;
  lastPlanVersion: string | null;
};

export type GridOrdersResponse = {
  items: Array<{
    id: string;
    exchangeOrderId: string | null;
    clientOrderId: string;
    gridLeg: "long" | "short";
    gridIndex: number;
    intentType: "entry" | "tp" | "sl" | "rebalance";
    side: "buy" | "sell";
    price: number | null;
    qty: number;
    reduceOnly: boolean;
    status: "open" | "filled" | "canceled" | "rejected";
    createdAt: string;
    updatedAt: string;
  }>;
};

export type GridFillsResponse = {
  items: Array<{
    id: string;
    exchangeOrderId: string | null;
    clientOrderId: string | null;
    fillPrice: number;
    fillQty: number;
    fillNotionalUsd: number;
    feeUsd: number;
    side: "buy" | "sell";
    gridLeg: "long" | "short";
    gridIndex: number;
    fillTs: string;
    rawJson?: Record<string, unknown> | null;
  }>;
};

export type GridEventsResponse = {
  items: Array<{
    id: string;
    type: string;
    severity: string;
    message: string;
    createdAt: string;
    meta: Record<string, unknown> | null;
  }>;
};

export type MeResponse = {
  isSuperadmin?: boolean;
  hasAdminBackendAccess?: boolean;
  walletAddress?: string | null;
  user?: {
    id?: string;
    email?: string | null;
    walletAddress?: string | null;
  };
};
