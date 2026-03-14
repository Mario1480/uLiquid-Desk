import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { prisma } from "@mm/db";
import { logger } from "./logger.js";
import {
  createSession,
  destroySession,
  getUserFromLocals,
  hashPassword,
  requireAuth,
  verifyPassword
} from "./auth.js";
import { createSiweService } from "./auth/siwe.service.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { ensureDefaultRoles, buildPermissions, PERMISSION_KEYS } from "./rbac.js";
import { sendReauthOtpEmail, sendSmtpTestEmail } from "./email.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";
import {
  evaluateAiPromptAccess,
  evaluateStrategyAccess,
  enforceBotStartLicense,
  getAiPromptAllowedPublicIds,
  getAiPromptLicenseMode,
  isAiModelAllowed,
  isStrategyIdAllowed,
  isStrategyKindAllowed,
  resolveStrategyEntitlementsForWorkspace,
  isLicenseEnforcementEnabled
} from "./license.js";
import { listPluginCatalogForCapabilities } from "./plugins/catalog.js";
import { registerBillingRoutes } from "./billing/routes.js";
import {
  attachPluginPolicySnapshot,
  validateBotPluginConfigValue
} from "./plugins/params.js";
import {
  getNotificationDestinationsSettingsForUser,
  getNotificationPluginSettingsForUser,
  type NotificationDestinationsSettings,
  updateNotificationDestinationsSettingsForUser,
  updateNotificationPluginSettingsForUser
} from "./plugins/notificationSettings.js";
import { buildPluginPolicySnapshot, normalizePlanTier } from "./plugins/policy.js";
import {
  isCapabilityAllowed,
  resolveCapabilitiesForPlan,
  sendCapabilityDenied
} from "./capabilities/guard.js";
import {
  adjustAiTokenBalanceByAdmin,
  applyPaidOrder,
  canCreateBot as canCreateBotWithQuota,
  canCreatePrediction as canCreatePredictionWithQuota,
  canEnablePredictionSchedule,
  createBillingCheckout,
  deleteBillingPackage,
  downgradeExpiredSubscriptions,
  ensureBillingDefaults,
  getBillingFeatureFlagsSettings,
  isBillingEnabled,
  isBillingWebhookEnabled,
  listBillingPackages,
  listSubscriptionOrders,
  markOrderFailed,
  recordWebhookEvent,
  resolveEffectivePlanForUser,
  resolveEffectiveQuotaForUser,
  setUserToFreePlan,
  syncPrimaryWorkspaceEntitlementsForUser,
  updateBillingFeatureFlags,
  upsertBillingPackage,
  getSubscriptionSummary
} from "./billing/service.js";
import { invalidateCcpayConfigCache, resolveCcpayConfig, verifyCcpayWebhook } from "./billing/ccpayment.js";
import {
  closeOrchestration,
  cancelBacktestRun,
  cancelBotRun,
  enqueueBacktestRun,
  enqueueBotRun,
  getQueueMetrics,
  getRuntimeOrchestrationMode
} from "./orchestration.js";
import { ExchangeSyncError, syncExchangeAccount } from "./exchange-sync.js";
import { buildManualTradingErrorResponse } from "./manual-trading-error.js";
import {
  createResolvedPollingPerpMarketDataRuntime,
  createPollingPerpMarketDataClient,
  createStreamingPerpExecutionAdapter,
  resolvePerpMarketStreamingMode
} from "./execution/perp-market-data-runtime.js";
import {
  createManualPerpMarketDataClient,
  createManualSpotClient,
  ensureManualPerpEligibility,
  ensureManualSpotEligibility,
  inferSpotSummaryCurrency,
  listBitgetSpotPositions,
  parseSpotOrderType,
  resolveManualMarketType,
  resolveManualOrderSide
} from "./manual-trading/support.js";
import { registerManualTradingMarketDataRoutes } from "./manual-trading/routes-market-data.js";
import { registerManualTradingExecutionRoutes } from "./manual-trading/routes-execution.js";
import { registerExchangeAccountRoutes } from "./exchange-accounts/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerPredictionReadRoutes } from "./predictions/routes-read.js";
import { registerPredictionGenerateRoutes } from "./predictions/routes-generate.js";
import { registerPredictionStateRoutes } from "./predictions/routes-state.js";
import { registerPredictionLifecycleRoutes } from "./predictions/routes-lifecycle.js";
import { registerBotRoutes } from "./bots/routes.js";
import { registerSettingsCoreRoutes } from "./settings/routes-core.js";
import { registerSettingsTradingRoutes } from "./settings/routes-trading.js";
import { registerSettingsRiskRoutes } from "./settings/routes-risk.js";
import { registerStrategyReadRoutes } from "./strategies/routes-read.js";
import { registerStrategyWriteRoutes } from "./strategies/routes-write.js";
import { registerAdminOperationsRoutes } from "./admin/routes-operations.js";
import { registerAdminApiKeyRoutes } from "./admin/routes-api-keys.js";
import { registerAdminPredictionSettingsRoutes } from "./admin/routes-prediction-settings.js";
import { registerAdminVaultOperationsRoutes } from "./admin/routes-vault-operations.js";
import { registerAdminIndicatorSettingsRoutes } from "./admin/routes-indicator-settings.js";
import { createGridVenueContextResolver } from "./grid/venueContext.js";
import { recoverRunningBotJobs } from "./bot-run-recovery.js";
import {
  AI_PROVIDER_OPTIONS,
  OPENAI_ADMIN_MODEL_OPTIONS,
  getAiModel,
  getAiModelAsync,
  invalidateAiApiKeyCache,
  invalidateAiModelCache,
  normalizeAiProvider,
  resolveAiModelFromConfig,
  type OpenAiAdminModel
} from "./ai/provider.js";
import {
  getSaladRuntimeStatus,
  resolveSaladRuntimeConfig,
  startSaladContainer,
  stopSaladContainer
} from "./ai/saladRuntime.js";
import {
  buildPredictionExplainerPromptPreview,
  fallbackExplain,
  generatePredictionExplanation,
  type ExplainerOutput
} from "./ai/predictionExplainer.js";
import {
  createGeneratedPromptDraft,
  generateHybridPromptText
} from "./ai/promptGenerator.js";
import {
  createUserAiPromptTemplate,
  deleteUserAiPromptTemplateById,
  listUserAiPromptTemplates,
  resolveAiPromptRuntimeForUserSelection
} from "./ai/userPromptSettings.js";
import {
  buildAndAttachHistoryContext
} from "./ai/historyContext.js";
import {
  AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY,
  DEFAULT_AI_PROMPT_SETTINGS,
  getAiPromptRuntimeSettings,
  getAiPromptRuntimeSettingsByTemplateId,
  getAiPromptIndicatorOptionsPublic,
  getAiPromptTemplateById,
  getPublicAiPromptTemplates,
  invalidateAiPromptSettingsCache,
  isAiPromptIndicatorKey,
  normalizePromptFieldsByMode,
  parseStoredAiPromptSettings,
  resolvePromptModeFromFlags,
  resolveAiPromptRuntimeSettingsForContext,
  type AiPromptSettingsStored,
  type AiPromptTemplate,
  type AiPromptIndicatorKey
} from "./ai/promptSettings.js";
import {
  AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY,
  DEFAULT_AI_TRACE_SETTINGS,
  getAiTraceSettingsCached,
  invalidateAiTraceSettingsCache,
  parseStoredAiTraceSettings
} from "./ai/traceLog.js";
import {
  getAiPayloadBudgetAlertSnapshot,
  getAiPayloadBudgetTelemetrySnapshot
} from "./ai/payloadBudget.js";
import {
  cancelAllPaperOrders,
  cancelAllPaperSpotOrders,
  cancelPaperOrder,
  cancelPaperSpotOrder,
  clearPaperMarketDataAccountId,
  clearPaperState,
  closePaperPosition,
  closePaperSpotPosition,
  editOpenOrder,
  editPaperOrder,
  editPaperSpotOrder,
  ManualTradingError,
  getPaperAccountState,
  getPaperSpotAccountState,
  isPaperTradingAccount,
  listPaperMarketDataAccountIds,
  listPaperOpenOrders,
  listPaperSpotOpenOrders,
  listPaperPositions,
  listPaperSpotPositions,
  cancelAllOrders,
  closePositionsMarket,
  createPerpExecutionAdapter,
  extractWsDataArray,
  getTradingSettings,
  listOpenOrders,
  listPositions,
  listSymbols,
  normalizeOrderBookPayload,
  normalizeSymbolInput,
  normalizeTickerPayload,
  normalizeTradesPayload,
  placePaperOrder,
  placePaperSpotOrder,
  createBitgetAdapter,
  resolveMarketDataTradingAccount,
  resolvePerpTradingContext,
  resolveTradingAccount,
  saveTradingSettings,
  setPositionTpSl,
  setPaperPositionTpSl,
  type PerpExecutionAdapter,
  type ResolvedPerpTradingContext,
  setPaperMarketDataAccountId
} from "./trading.js";
import {
  computeOpenPnlUsd,
  computeRuntimeMarkPrice,
  readBotPrimaryTradeState,
  deriveStoppedWhy,
  extractLastDecisionConfidence,
  shouldIncludeBotInStandardOverview,
  sumRealizedPnlUsdFromTradeEvents,
  type BotTradeStateOverviewRow
} from "./bots/overview.js";
import {
  classifyOutcomeFromClose,
  computeCoreMetricsFromClosedTrades,
  computeRealizedPnlPct,
  decodeTradeHistoryCursor,
  encodeTradeHistoryCursor,
  type BotTradeHistoryOutcome
} from "./bots/tradeHistory.js";
import { buildBacktestSnapshotFromMarketData } from "./backtest/buildSnapshot.js";
import {
  hashStable,
  resolveBacktestEngineHash
} from "./backtest/hashing.js";
import {
  createBacktestRunRecord,
  getBacktestRunRecord,
  listBacktestRunsForBot,
  loadBacktestReport,
  markBacktestRunCancelRequested,
  updateBacktestRunRecord
} from "./backtest/runs.js";
import {
  DEFAULT_BACKTEST_ASSUMPTIONS,
  type BacktestTimeframe
} from "./backtest/types.js";
import {
  marketTimeframeToBitgetSpotGranularity,
  normalizeSpotSymbol,
  splitCanonicalSymbol
} from "./spot/bitget-spot.mapper.js";
import { createSpotClient, type SpotClient } from "./spot/spot-client-factory.js";
import {
  createPerpMarketDataClient,
  type PerpMarketDataClient
} from "./perp/perp-market-data.client.js";
import {
  generateAndPersistPrediction,
  resolvePredictionTracking,
  type PredictionSignalMode,
  type PredictionSignalSource
} from "./ai/predictionPipeline.js";
import {
  FEATURE_THRESHOLD_VERSION,
  applyConfidencePenalty,
  buildFeatureThresholds,
  calibrationWindowMsForTimeframe,
  deriveRegimeTags,
  expectedBarsForWindow,
  fallbackFeatureThresholds,
  minimumBarsForTimeframe,
  percentileRankFromBands,
  readFeatureThresholds,
  type FeatureThresholdsJson,
  type ResolvedFeatureThresholds,
  type ThresholdMarketType,
  type ThresholdTimeframe
} from "./prediction-thresholds.js";
import {
  computeIndicators,
  minimumCandlesForIndicatorsWithSettings,
  type IndicatorsSnapshot
} from "./market/indicators.js";
import { computeAdvancedIndicators } from "./market/indicators/advancedIndicators.js";
import { bucketCandles, toBucketStart } from "./market/timeframe.js";
import {
  DEFAULT_INDICATOR_SETTINGS,
  indicatorSettingsUpsertSchema,
  mergeIndicatorSettings,
  normalizeIndicatorSettingsPatch,
  type IndicatorSettingsConfig
} from "./dto/indicatorSettings.dto.js";
import {
  clearIndicatorSettingsCache,
  resolveIndicatorSettings
} from "./config/indicatorSettingsResolver.js";
import {
  buildPredictionMetricsSummary,
  computeDirectionalRealizedReturnPct,
  computePredictionErrorMetrics,
  normalizeConfidencePct,
  readRealizedPayloadFromOutcomeMeta,
  type PredictionEvaluatorSample
} from "./jobs/predictionEvaluatorJob.js";
import { createEconomicCalendarRefreshJob } from "./jobs/economicCalendarRefreshJob.js";
import { createEconomicCalendarDailyTelegramJob } from "./jobs/economicCalendarDailyTelegramJob.js";
import { createVaultAccountingJob } from "./jobs/vaultAccountingJob.js";
import { createBotVaultRiskJob } from "./jobs/botVaultRiskJob.js";
import { createBotVaultTradingReconciliationJob } from "./jobs/botVaultTradingReconciliationJob.js";
import { createVaultOnchainIndexerJob } from "./jobs/vaultOnchainIndexerJob.js";
import { createVaultOnchainReconciliationJob } from "./jobs/vaultOnchainReconciliationJob.js";
import { registerPredictionDetailRoute } from "./routes/predictions.js";
import { registerEconomicCalendarRoutes } from "./routes/economic-calendar.js";
import { registerGridRoutes } from "./routes/grid.js";
import { registerVaultRoutes } from "./routes/vaults.js";
import { registerSiweAuthRoutes } from "./routes/auth-siwe.js";
import { attachRequestContext } from "./requestContext.js";
import {
  createIdempotencyMiddleware,
  createRateLimitMiddleware,
  rateLimitByIp,
  rateLimitBySessionOrIp,
  rateLimitByUser
} from "./trafficControl.js";
import {
  readGridVenueConstraintCache,
  upsertGridVenueConstraintCache
} from "./grid/venueConstraintsCache.js";
import { registerNewsRoutes } from "./routes/news.js";
import { registerSystemRoutes } from "./system/routes.js";
import { createVaultService } from "./vaults/service.js";
import { createExecutionProvider } from "./vaults/executionProvider.registry.js";
import { createExecutionProviderOrchestrator } from "./vaults/executionProvider.orchestrator.js";
import { createMasterVaultService } from "./vaults/masterVault.service.js";
import { createBotVaultLifecycleService } from "./vaults/botVaultLifecycle.service.js";
import { createExecutionLifecycleService } from "./vaults/executionLifecycle.service.js";
import { createFeeSettlementService } from "./vaults/feeSettlement.service.js";
import { createBotVaultTradingReconciliationService } from "./vaults/tradingReconciliation.service.js";
import { createRiskPolicyService } from "./vaults/riskPolicy.service.js";
import { createOnchainActionService } from "./vaults/onchainAction.service.js";
import {
  buildVaultSafetyControls,
  GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY,
  parseVaultSafetyControls
} from "./vaults/safetyControls.js";
import {
  getVaultExecutionModeSettings,
  setVaultExecutionModeSettings,
  type VaultExecutionMode
} from "./vaults/executionMode.js";
import {
  getVaultExecutionProviderSettings,
  setVaultExecutionProviderSettings
} from "./vaults/executionProvider.settings.js";
import {
  getGridHyperliquidPilotSettings,
  resolveGridHyperliquidPilotAccess,
  setGridHyperliquidPilotSettings
} from "./vaults/gridHyperliquidPilot.settings.js";
import {
  getVaultProfitShareTreasurySettings,
  normalizeTreasuryWalletAddress,
  ONCHAIN_TREASURY_PAYOUT_MODEL,
  setVaultProfitShareTreasurySettings
} from "./vaults/profitShareTreasury.settings.js";
import {
  buildEventDelta,
  buildPredictionChangeHash,
  evaluateSignificantChange,
  refreshIntervalsMsFromSec,
  refreshIntervalMsForTimeframe,
  resolveEffectiveAutoRefreshIntervalMs,
  resolveRunTimeframeForCadence,
  isMarketAnalysisSnapshot,
  shouldMarkUnstableFlips,
  shouldThrottleRepeatedEvent,
  type PredictionRefreshIntervalsMs,
  type PredictionStateLike
} from "./predictions/refreshService.js";
import {
  applyAiQualityGateCallToState,
  getAiQualityGateTelemetrySnapshot,
  shouldInvokeAiExplain,
  type AiQualityGateRollingState
} from "./ai/qualityGate.js";
import {
  getBuiltinLocalStrategyTemplates,
  getRegisteredLocalStrategy,
  listPythonStrategyRegistry,
  listRegisteredLocalStrategies,
  runLocalStrategy
} from "./local-strategies/registry.js";
import {
  normalizeCompositeGraph,
  validateCompositeGraph
} from "./composite-strategies/graph.js";
import { runCompositeStrategy } from "./composite-strategies/runner.js";
import { shouldRefreshTF, type TriggerDebounceState } from "./predictions/refreshTriggers.js";
import {
  applyNewsRiskToFeatureSnapshot,
  evaluateNewsRiskForSymbol,
  getEconomicCalendarConfig
} from "./services/economicCalendar/index.js";
import { fetchFmpEconomicEvents } from "./services/economicCalendar/providers/fmp.js";
import {
  TELEGRAM_CHAT_ID_IN_USE_ERROR,
  findTelegramChatIdConflict as findTelegramChatIdConflictFromDeps,
  isPrismaUniqueConstraintError,
  normalizeTelegramChatId as normalizeTelegramChatIdValue
} from "./telegram/chatIdUniqueness.js";
import {
  resolveTelegramConfig,
  sendTelegramMessage
} from "./telegram/notifications.js";
import {
  dispatchManualTradingErrorNotification,
  dispatchMarketAnalysisUpdateNotification,
  dispatchPredictionOutcomeNotification,
  dispatchTradablePredictionNotification
} from "./plugins/notificationHost.js";
import {
  type DailyEconomicCalendarSettings,
  dailyEconomicCalendarSettingsKey,
  defaultDailyEconomicCalendarSettings,
  mergeDailyEconomicCalendarSettings,
  parseStoredDailyEconomicCalendarSettings
} from "./telegram/dailyEconomicCalendarSettings.js";

const db = prisma as any;
const economicCalendarRefreshJob = createEconomicCalendarRefreshJob(db);
const economicCalendarDailyTelegramJob = createEconomicCalendarDailyTelegramJob(db);
const siweService = createSiweService(db);
const masterVaultService = createMasterVaultService(db);
const riskPolicyService = createRiskPolicyService(db);
const executionProvider = createExecutionProvider({ db, logger });
const executionOrchestrator = createExecutionProviderOrchestrator({
  db,
  provider: executionProvider,
  logger
});
const executionLifecycleService = createExecutionLifecycleService(db, {
  executionOrchestrator,
  riskPolicyService,
  processControl: {
    enqueueBotRun: async (botId: string) => {
      await enqueueBotRun(botId);
    },
    cancelBotRun: async (botId: string) => {
      await cancelBotRun(botId);
    }
  },
  logger
});
const onchainActionService = createOnchainActionService(db, { logger });
const tradingReconciliationService = createBotVaultTradingReconciliationService(db, { logger });
const feeSettlementService = createFeeSettlementService(db, {
  masterVaultService,
  tradingReconciliationService,
  logger
});
const botVaultLifecycleService = createBotVaultLifecycleService(db, {
  executionOrchestrator,
  masterVaultService,
  feeSettlementService,
  executionLifecycleService,
  riskPolicyService
});
const vaultService = createVaultService(db, {
  executionOrchestrator,
  masterVaultService,
  botVaultLifecycleService,
  feeSettlementService,
  tradingReconciliationService,
  executionLifecycleService,
  riskPolicyService
});
const vaultAccountingJob = createVaultAccountingJob(db, vaultService);
const botVaultRiskJob = createBotVaultRiskJob(db, vaultService);
const botVaultTradingReconciliationJob = createBotVaultTradingReconciliationJob(db, tradingReconciliationService);
const vaultOnchainIndexerJob = createVaultOnchainIndexerJob(db, {
  onchainActionService
});
const vaultOnchainReconciliationJob = createVaultOnchainReconciliationJob(db);

const app = express();
app.set("trust proxy", 1);

const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (origins.includes("http://localhost:3000") && !origins.includes("http://127.0.0.1:3000")) {
  origins.push("http://127.0.0.1:3000");
}
if (origins.includes("http://127.0.0.1:3000") && !origins.includes("http://localhost:3000")) {
  origins.push("http://localhost:3000");
}

function isPrivateIpv4Host(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
}

function isDevLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.port && parsed.port !== "3000") return false;
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (host.endsWith(".local")) return true;
    if (!host.includes(".")) return true;
    return isPrivateIpv4Host(host);
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origins.includes("*") || origins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== "production" && isDevLocalOrigin(origin)) return callback(null, true);
      return callback(new Error("not_allowed_by_cors"));
    },
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString("utf8");
  }
}));
app.use(attachRequestContext);

function buildRouteFingerprint(req: express.Request, userId?: string | null): string {
  const method = String(req.method ?? "GET").toUpperCase();
  const path = req.route?.path ? String(req.route.path) : String(req.path ?? req.originalUrl ?? "");
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  const actor = String(userId ?? "").trim() || String(req.ip ?? "anon");
  return `${method}:${path}:${actor}:${payloadHash}`;
}

const siweNonceRateLimit = createRateLimitMiddleware({
  name: "auth_siwe_nonce",
  max: 10,
  windowMs: 10 * 60_000,
  keyFn: (req) => rateLimitByIp(req)
});
const siweVerifyRateLimit = createRateLimitMiddleware({
  name: "auth_siwe_verify",
  max: 5,
  windowMs: 10 * 60_000,
  keyFn: (req) => rateLimitByIp(req)
});
const siweLinkRateLimit = createRateLimitMiddleware({
  name: "auth_siwe_link",
  max: 5,
  windowMs: 10 * 60_000,
  keyFn: rateLimitByUser
});
const logoutRateLimit = createRateLimitMiddleware({
  name: "auth_logout",
  max: 20,
  windowMs: 10 * 60_000,
  keyFn: rateLimitBySessionOrIp
});
const masterCreateRateLimit = createRateLimitMiddleware({
  name: "vault_master_create",
  max: 5,
  windowMs: 10 * 60_000,
  keyFn: rateLimitByUser
});
const createBotRateLimit = createRateLimitMiddleware({
  name: "vault_create_bot",
  max: 5,
  windowMs: 10 * 60_000,
  keyFn: rateLimitByUser
});
const criticalBotMutationRateLimit = createRateLimitMiddleware({
  name: "vault_critical_bot_mutation",
  max: 10,
  windowMs: 10 * 60_000,
  keyFn: rateLimitByUser
});

app.use("/auth/siwe/nonce", siweNonceRateLimit);
app.use("/auth/siwe/verify", siweVerifyRateLimit);
app.use("/auth/logout", logoutRateLimit);
app.use("/auth/siwe/link", requireAuth, siweLinkRateLimit);

app.use("/vaults/master/create",
  requireAuth,
  masterCreateRateLimit,
  createIdempotencyMiddleware({
    name: "vault_master_create",
    required: false,
    resolveKey: (_req, res) => `master:create:${String(res.locals.user?.id ?? "anon")}`
  })
);
app.use("/vaults/master/deposit",
  requireAuth,
  createIdempotencyMiddleware({ name: "vault_master_deposit", required: true })
);
app.use("/vaults/master/withdraw",
  requireAuth,
  createIdempotencyMiddleware({ name: "vault_master_withdraw", required: true })
);
app.use("/grid/templates/:id/instances",
  requireAuth,
  createBotRateLimit,
  createIdempotencyMiddleware({
    name: "grid_instance_create",
    required: false,
    resolveKey: (req, res) => `grid:create:${buildRouteFingerprint(req, String(res.locals.user?.id ?? ""))}`
  })
);
app.use("/grid/instances/:id/margin/add",
  requireAuth,
  createIdempotencyMiddleware({
    name: "grid_margin_add",
    required: false,
    resolveKey: (req, res) => `grid:margin_add:${buildRouteFingerprint(req, String(res.locals.user?.id ?? ""))}`
  })
);
app.use("/grid/instances/:id/withdraw-profit",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({
    name: "grid_withdraw_profit",
    required: false,
    resolveKey: (req, res) => `grid:withdraw_profit:${buildRouteFingerprint(req, String(res.locals.user?.id ?? ""))}`
  })
);
app.use("/grid/instances/:id/stop",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({
    name: "grid_stop",
    required: false,
    resolveKey: (req, res) => `grid:stop:${buildRouteFingerprint(req, String(res.locals.user?.id ?? ""))}`
  })
);
app.use("/vaults/bot-vaults/:id/close-only",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({
    name: "vault_close_only",
    required: false,
    resolveKey: (req, res) => `vault:close_only:${buildRouteFingerprint(req, String(res.locals.user?.id ?? ""))}`
  })
);
app.use("/vaults/onchain/master/create-tx",
  requireAuth,
  masterCreateRateLimit,
  createIdempotencyMiddleware({ name: "onchain_master_create_tx", required: true })
);
app.use("/vaults/onchain/master/deposit-tx",
  requireAuth,
  createIdempotencyMiddleware({ name: "onchain_master_deposit_tx", required: true })
);
app.use("/vaults/onchain/bot-vaults/:id/create-tx",
  requireAuth,
  createBotRateLimit,
  createIdempotencyMiddleware({ name: "onchain_bot_create_tx", required: true })
);
app.use("/vaults/onchain/bot-vaults/:id/claim-tx",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({ name: "onchain_bot_claim_tx", required: true })
);
app.use("/vaults/onchain/bot-vaults/:id/close-tx",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({ name: "onchain_bot_close_tx", required: true })
);
app.use("/vaults/onchain/actions/:id/submit-tx",
  requireAuth,
  createIdempotencyMiddleware({ name: "onchain_submit_tx", required: true })
);
app.use("/admin/users/:id/vaults/close-only-all",
  requireAuth,
  criticalBotMutationRateLimit,
  createIdempotencyMiddleware({ name: "admin_close_only_all", required: true })
);

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const predictionCopierTimeframeSchema = z.enum(["5m", "15m", "1h", "4h"]);
const predictionSignalModeSchema = z.enum(["local_only", "ai_only", "both"]);
const predictionStrategyKindSchema = z.enum(["local", "ai", "composite"]);

const predictionCopierSettingsSchema = z.object({
  sourceStateId: z.string().trim().min(1).optional(),
  sourceSnapshot: z.object({
    stateId: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
    symbol: z.string().trim().min(1).optional(),
    timeframe: predictionCopierTimeframeSchema.optional(),
    signalMode: predictionSignalModeSchema.optional(),
    strategyRef: z.string().trim().min(1).nullable().optional(),
    strategyKind: predictionStrategyKindSchema.nullable().optional(),
    strategyId: z.string().trim().min(1).nullable().optional(),
    strategyName: z.string().trim().min(1).nullable().optional()
  }).passthrough().optional(),
  timeframe: predictionCopierTimeframeSchema.optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  maxPredictionAgeSec: z.number().int().min(30).max(86_400).optional(),
  symbols: z.array(z.string().trim().min(1)).max(100).optional(),
  positionSizing: z.object({
    type: z.enum(["fixed_usd", "equity_pct", "risk_pct"]).optional(),
    value: z.number().positive().optional()
  }).optional(),
  risk: z.object({
    maxOpenPositions: z.number().int().min(1).max(100).optional(),
    maxDailyTrades: z.number().int().min(1).max(10_000).optional(),
    cooldownSecAfterTrade: z.number().int().min(0).max(86_400).optional(),
    maxNotionalPerSymbolUsd: z.number().positive().optional(),
    maxTotalNotionalUsd: z.number().positive().optional(),
    maxLeverage: z.number().int().min(1).max(125).optional(),
    stopLossPct: z.number().positive().max(95).nullable().optional(),
    takeProfitPct: z.number().positive().max(500).nullable().optional(),
    timeStopMin: z.number().int().positive().max(10_080).nullable().optional()
  }).optional(),
  filters: z.object({
    blockTags: z.array(z.string().trim().min(1)).max(50).optional(),
    newsRiskBlockEnabled: z.boolean().optional(),
    requireTags: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
    allowSignals: z.array(z.enum(["up", "down", "neutral"])).max(3).optional(),
    minExpectedMovePct: z.number().nonnegative().nullable().optional()
  }).optional(),
  execution: z.object({
    orderType: z.enum(["market", "limit"]).optional(),
    limitOffsetBps: z.number().nonnegative().max(500).optional(),
    reduceOnlyOnExit: z.boolean().optional()
  }).optional(),
  exit: z.object({
    onSignalFlip: z.boolean().optional(),
    onConfidenceDrop: z.boolean().optional()
  }).optional()
});

const executionModeSchema = z.enum(["simple", "dca", "grid", "dip_reversion"]);

const executionCommonSchema = z.object({
  maxDailyExecutions: z.number().int().min(1).max(10_000).optional(),
  cooldownSecAfterExecution: z.number().int().min(0).max(86_400).optional(),
  maxNotionalPerSymbolUsd: z.number().positive().nullable().optional(),
  maxTotalNotionalUsd: z.number().positive().nullable().optional(),
  maxOpenPositions: z.number().int().min(1).max(100).optional(),
  enforceReduceOnlyOnClose: z.boolean().optional()
});

const executionSimpleSchema = z.object({
  orderType: z.enum(["market", "limit"]).optional(),
  limitOffsetBps: z.number().nonnegative().max(500).optional()
});

const executionDcaSchema = z.object({
  maxEntries: z.number().int().min(1).max(20).optional(),
  stepPct: z.number().positive().max(50).optional(),
  sizeScale: z.number().min(1).max(5).optional(),
  entryOrderType: z.enum(["market", "limit"]).optional(),
  takeProfitPct: z.number().positive().max(1000).nullable().optional(),
  stopLossPct: z.number().positive().max(100).nullable().optional(),
  cancelPendingOnFlip: z.boolean().optional()
});

const executionGridSchema = z.object({
  levelsPerSide: z.number().int().min(1).max(40).optional(),
  gridSpacingPct: z.number().positive().max(25).optional(),
  baseOrderUsd: z.number().positive().optional(),
  tpPctPerLevel: z.number().positive().max(100).optional(),
  maxActiveOrders: z.number().int().min(1).max(200).optional(),
  rebalanceThresholdPct: z.number().positive().max(50).optional()
});

const executionDipReversionSchema = z.object({
  dipTriggerPct: z.number().positive().max(100).optional(),
  recoveryTakeProfitPct: z.number().positive().max(100).optional(),
  maxHoldMinutes: z.number().int().positive().max(20_160).optional(),
  maxReentriesPerDay: z.number().int().positive().max(100).optional(),
  entryScaleUsd: z.number().positive().optional()
});

const executionSettingsSchema = z.object({
  mode: executionModeSchema.optional(),
  common: executionCommonSchema.optional(),
  simple: executionSimpleSchema.optional(),
  dca: executionDcaSchema.optional(),
  grid: executionGridSchema.optional(),
  dipReversion: executionDipReversionSchema.optional()
});

const botCreateSchema = z.object({
  name: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  exchangeAccountId: z.string().trim().min(1),
  strategyKey: z.string().trim().min(1).default("dummy"),
  marginMode: z.enum(["isolated", "cross"]).default("isolated"),
  leverage: z.number().int().min(1).max(125).default(1),
  tickMs: z.number().int().min(100).max(60_000).default(1000),
  paramsJson: z.record(z.any()).default({}),
  vaultEnabled: z.boolean().optional(),
  vaultAllocationUsd: z.number().positive().optional().nullable()
}).superRefine((value, ctx) => {
  const pluginValidation = validateBotPluginConfigValue(
    value.paramsJson && typeof value.paramsJson === "object" ? value.paramsJson.plugins : undefined
  );
  if (!pluginValidation.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paramsJson", "plugins"],
      message: pluginValidation.message
    });
  }

  if (
    value.paramsJson
    && typeof value.paramsJson === "object"
    && Object.prototype.hasOwnProperty.call(value.paramsJson, "execution")
  ) {
    const executionParsed = executionSettingsSchema.safeParse(value.paramsJson.execution);
    if (!executionParsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paramsJson", "execution"],
        message: "invalid execution configuration"
      });
    }
  }

  if (value.strategyKey !== "prediction_copier") return;

  const root =
    value.paramsJson && typeof value.paramsJson.predictionCopier === "object" && value.paramsJson.predictionCopier
      ? value.paramsJson.predictionCopier
      : value.paramsJson;
  const parsed = predictionCopierSettingsSchema.safeParse(root);
  if (parsed.success) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["paramsJson"],
    message: "invalid prediction_copier configuration"
  });
});

const botUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  strategyKey: z.string().trim().min(1).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  tickMs: z.number().int().min(100).max(60_000).optional(),
  paramsJson: z.record(z.any()).optional(),
  vaultEnabled: z.boolean().optional(),
  vaultAllocationUsd: z.number().positive().optional().nullable()
}).superRefine((value, ctx) => {
  if (value.paramsJson && typeof value.paramsJson === "object") {
    const pluginValidation = validateBotPluginConfigValue(value.paramsJson.plugins);
    if (!pluginValidation.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paramsJson", "plugins"],
        message: pluginValidation.message
      });
    }

    if (Object.prototype.hasOwnProperty.call(value.paramsJson, "execution")) {
      const executionParsed = executionSettingsSchema.safeParse(value.paramsJson.execution);
      if (!executionParsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paramsJson", "execution"],
          message: "invalid execution configuration"
        });
      }
    }
  }

  if (Object.keys(value).length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "at least one field must be provided"
  });
});

const botStopSchema = z.object({
  closeOpenPosition: z.boolean().optional()
});

const botPredictionSourcesQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1),
  strategyKind: predictionStrategyKindSchema.optional(),
  signalMode: predictionSignalModeSchema.optional(),
  symbol: z.string().trim().min(1).optional()
});

const botRiskEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

const botOverviewListQuerySchema = z.object({
  exchangeAccountId: z.string().trim().min(1).optional(),
  status: z.enum(["running", "stopped", "error"]).optional()
});

const botOverviewDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

const botTradeHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
  from: z.string().trim().datetime().optional(),
  to: z.string().trim().datetime().optional(),
  outcome: z.enum([
    "tp_hit",
    "sl_hit",
    "signal_exit",
    "manual_exit",
    "time_stop",
    "unknown"
  ]).optional()
});

const backtestTimeframeSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);

const backtestAssumptionsSchema = z.object({
  fillModel: z.literal("next_bar_open").default("next_bar_open"),
  feeBps: z.number().min(0).max(500).default(DEFAULT_BACKTEST_ASSUMPTIONS.feeBps),
  slippageBps: z.number().min(0).max(500).default(DEFAULT_BACKTEST_ASSUMPTIONS.slippageBps),
  timezone: z.literal("UTC").default("UTC")
});

const backtestCreateSchema = z.object({
  from: z.string().trim().datetime(),
  to: z.string().trim().datetime(),
  timeframe: backtestTimeframeSchema.default("15m"),
  assumptions: backtestAssumptionsSchema.optional(),
  paramsOverride: z.record(z.any()).optional(),
  experimentId: z.string().trim().min(1).max(100).optional(),
  groupId: z.string().trim().min(1).max(100).optional()
}).superRefine((value, ctx) => {
  const from = new Date(value.from);
  const to = new Date(value.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "invalid_backtest_period"
    });
    return;
  }

  const maxWindowMs = 400 * 24 * 60 * 60 * 1000;
  if ((to.getTime() - from.getTime()) > maxWindowMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "backtest_window_too_large"
    });
  }
});

const backtestListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const backtestCompareQuerySchema = z.object({
  experimentId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const dashboardAlertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const dashboardPerformanceQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h")
});

const accessSectionVisibilitySchema = z.object({
  tradingDesk: z.boolean().default(true),
  bots: z.boolean().default(true),
  gridBots: z.boolean().default(true),
  predictionsDashboard: z.boolean().default(true),
  economicCalendar: z.boolean().default(true),
  news: z.boolean().default(true),
  strategy: z.boolean().default(true)
});

const accessSectionLimitsSchema = z.object({
  bots: z.number().int().min(0).nullable().default(null),
  predictionsLocal: z.number().int().min(0).nullable().default(null),
  predictionsAi: z.number().int().min(0).nullable().default(null),
  predictionsComposite: z.number().int().min(0).nullable().default(null)
});

const accessSectionMaintenanceSchema = z.object({
  enabled: z.boolean().default(false)
});

const adminAccessSectionSettingsSchema = z.object({
  visibility: accessSectionVisibilitySchema.default({}),
  limits: accessSectionLimitsSchema.default({}),
  maintenance: accessSectionMaintenanceSchema.default({})
});

const adminServerInfoSchema = z.object({
  serverIpAddress: z.string().trim().max(255).nullable().optional()
});

const exchangeCreateSchema = z.object({
  exchange: z.string().trim().min(1),
  label: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  apiSecret: z.string().trim().optional(),
  passphrase: z.string().trim().optional(),
  marketDataExchangeAccountId: z.string().trim().optional()
}).superRefine((value, ctx) => {
  const exchange = value.exchange.toLowerCase();
  if (exchange === "bitget") {
    if (!value.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required for bitget" });
    }
    if (!value.apiSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required for bitget" });
    }
  }
  if (exchange === "mexc") {
    if (!value.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required for mexc" });
    }
    if (!value.apiSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required for mexc" });
    }
  }
  if (exchange !== "paper" && exchange !== "binance" && !value.apiKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "apiKey is required" });
  }
  if (exchange !== "paper" && exchange !== "binance" && !value.apiSecret) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiSecret"], message: "apiSecret is required" });
  }
  if (exchange === "bitget" && !value.passphrase) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["passphrase"], message: "passphrase is required for bitget" });
  }
  if (exchange === "hyperliquid" && value.apiKey && !/^0x[a-fA-F0-9]{40}$/.test(value.apiKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: "apiKey must be a wallet address (0x + 40 hex) for hyperliquid"
    });
  }
  if (
    exchange === "hyperliquid" &&
    value.apiSecret &&
    !/^(0x)?[a-fA-F0-9]{64}$/.test(value.apiSecret)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiSecret"],
      message: "apiSecret must be a private key (64 hex, optional 0x) for hyperliquid"
    });
  }
  if (exchange === "paper" && !value.marketDataExchangeAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["marketDataExchangeAccountId"],
      message: "marketDataExchangeAccountId is required for paper"
    });
  }
});

const subscriptionCheckoutItemSchema = z.object({
  packageId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1)
});

const subscriptionCheckoutSchema = z.union([
  z.object({
    packageId: z.string().trim().min(1)
  }),
  z.object({
    items: z.array(subscriptionCheckoutItemSchema).min(1).max(20)
  })
]);

const billingPackageIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const adminBillingPackageSchema = z.object({
  code: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullish(),
  kind: z.enum(["plan", "ai_topup", "entitlement_topup"]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  currency: z.string().trim().min(3).max(8).default("USD"),
  priceCents: z.number().int().min(0),
  billingMonths: z.number().int().min(1).max(36).default(1),
  plan: z.enum(["free", "pro"]).nullable().default(null),
  maxRunningBots: z.number().int().min(0).nullable().default(null),
  maxBotsTotal: z.number().int().min(0).nullable().default(null),
  maxRunningPredictionsAi: z.number().int().min(0).nullable().default(null),
  maxPredictionsAiTotal: z.number().int().min(0).nullable().default(null),
  maxRunningPredictionsComposite: z.number().int().min(0).nullable().default(null),
  maxPredictionsCompositeTotal: z.number().int().min(0).nullable().default(null),
  allowedExchanges: z.array(z.string().trim().min(1)).default(["*"]),
  monthlyAiTokens: z.number().int().min(0).default(0),
  topupAiTokens: z.number().int().min(0).default(0),
  topupRunningBots: z.number().int().min(0).nullable().default(null),
  topupBotsTotal: z.number().int().min(0).nullable().default(null),
  topupRunningPredictionsAi: z.number().int().min(0).nullable().default(null),
  topupPredictionsAiTotal: z.number().int().min(0).nullable().default(null),
  topupRunningPredictionsComposite: z.number().int().min(0).nullable().default(null),
  topupPredictionsCompositeTotal: z.number().int().min(0).nullable().default(null),
  meta: z.record(z.unknown()).nullable().optional()
});

const adminBillingAdjustTokensSchema = z.object({
  deltaTokens: z.number().int(),
  note: z.string().trim().max(500).optional()
});

const adminBillingFeatureFlagsSchema = z.object({
  billingEnabled: z.coerce.boolean(),
  billingWebhookEnabled: z.coerce.boolean(),
  aiTokenBillingEnabled: z.coerce.boolean()
});

const dashboardRiskAnalysisQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3)
});

const tradingSettingsSchema = z.object({
  exchangeAccountId: z.string().trim().min(1).nullable().optional(),
  symbol: z.string().trim().min(1).nullable().optional(),
  timeframe: z.string().trim().min(1).nullable().optional(),
  marketType: z.enum(["spot", "perp"]).nullable().optional(),
  marginMode: z.enum(["isolated", "cross"]).nullable().optional(),
  chartPreferences: z.object({
    indicatorToggles: z.object({
      ema5: z.boolean().optional(),
      ema13: z.boolean().optional(),
      ema50: z.boolean().optional(),
      ema200: z.boolean().optional(),
      ema800: z.boolean().optional(),
      emaCloud50: z.boolean().optional(),
      vwapSession: z.boolean().optional(),
      dailyOpen: z.boolean().optional(),
      smcStructure: z.boolean().optional(),
      volumeOverlay: z.boolean().optional(),
      pvsraVector: z.boolean().optional(),
      breakerBlocks: z.boolean().optional(),
      superOrderBlockFvgBos: z.boolean().optional()
    }).optional(),
    showUpMarkers: z.boolean().optional(),
    showDownMarkers: z.boolean().optional()
  }).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email()
});

const passwordResetConfirmSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(8)
});

const adminUserCreateSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().trim().min(8).optional()
});

const adminUserPasswordSchema = z.object({
  password: z.string().trim().min(8)
});

const adminUserAdminAccessSchema = z.object({
  enabled: z.boolean().default(false)
});

const adminTelegramSchema = z.object({
  telegramBotToken: z.string().trim().nullable().optional(),
  telegramChatId: z.string().trim().nullable().optional()
}).superRefine((value, ctx) => {
  const token = typeof value.telegramBotToken === "string" ? value.telegramBotToken.trim() : "";
  const chatId = typeof value.telegramChatId === "string" ? value.telegramChatId.trim() : "";
  if ((token && !chatId) || (!token && chatId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "telegramBotToken and telegramChatId must both be set or both be empty"
    });
  }
});

const adminExchangesSchema = z.object({
  allowed: z.array(z.string().trim().min(1)).min(1).max(20)
});

const adminSmtpSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().min(1),
  from: z.string().trim().min(1),
  secure: z.boolean().default(true),
  password: z.string().trim().min(1).optional()
});

const adminSmtpTestSchema = z.object({
  to: z.string().trim().email()
});

const openAiModelSchema = z.enum(OPENAI_ADMIN_MODEL_OPTIONS);
const aiProviderSchema = z.enum(["openai", "ollama", "disabled"]);

const adminApiKeysSchema = z.object({
  aiProvider: aiProviderSchema.optional(),
  aiBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearAiBaseUrl: z.boolean().default(false),
  aiApiKey: z.string().trim().min(1).max(500).optional(),
  clearAiApiKey: z.boolean().default(false),
  aiModel: z.string().trim().min(1).max(120).optional(),
  clearAiModel: z.boolean().default(false),
  openaiApiKey: z.string().trim().min(10).max(500).optional(),
  clearOpenaiApiKey: z.boolean().default(false),
  fmpApiKey: z.string().trim().min(10).max(500).optional(),
  clearFmpApiKey: z.boolean().default(false),
  openaiModel: openAiModelSchema.optional(),
  clearOpenaiModel: z.boolean().default(false),
  saladApiBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearSaladApiBaseUrl: z.boolean().default(false),
  saladOrganization: z.string().trim().min(1).max(191).optional(),
  clearSaladOrganization: z.boolean().default(false),
  saladProject: z.string().trim().min(1).max(191).optional(),
  clearSaladProject: z.boolean().default(false),
  saladContainer: z.string().trim().min(1).max(191).optional(),
  clearSaladContainer: z.boolean().default(false),
  ccpayAppId: z.string().trim().min(1).max(191).optional(),
  clearCcpayAppId: z.boolean().default(false),
  ccpayAppSecret: z.string().trim().min(1).max(500).optional(),
  clearCcpayAppSecret: z.boolean().default(false),
  ccpayBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearCcpayBaseUrl: z.boolean().default(false),
  ccpayPriceFiatId: z.string().trim().regex(/^\d+$/).max(64).optional(),
  clearCcpayPriceFiatId: z.boolean().default(false),
  ccpayWebBaseUrl: z.string().trim().min(8).max(500).optional(),
  clearCcpayWebBaseUrl: z.boolean().default(false)
}).refine(
  (value) =>
    value.clearOpenaiApiKey ||
    Boolean(value.openaiApiKey) ||
    value.clearFmpApiKey ||
    Boolean(value.fmpApiKey) ||
    value.clearOpenaiModel ||
    Boolean(value.openaiModel) ||
    value.clearAiApiKey ||
    Boolean(value.aiApiKey) ||
    value.clearAiModel ||
    Boolean(value.aiModel) ||
    value.clearAiBaseUrl ||
    Boolean(value.aiBaseUrl) ||
    value.clearSaladApiBaseUrl ||
    Boolean(value.saladApiBaseUrl) ||
    value.clearSaladOrganization ||
    Boolean(value.saladOrganization) ||
    value.clearSaladProject ||
    Boolean(value.saladProject) ||
    value.clearSaladContainer ||
    Boolean(value.saladContainer) ||
    value.clearCcpayAppId ||
    Boolean(value.ccpayAppId) ||
    value.clearCcpayAppSecret ||
    Boolean(value.ccpayAppSecret) ||
    value.clearCcpayBaseUrl ||
    Boolean(value.ccpayBaseUrl) ||
    value.clearCcpayPriceFiatId ||
    Boolean(value.ccpayPriceFiatId) ||
    value.clearCcpayWebBaseUrl ||
    Boolean(value.ccpayWebBaseUrl) ||
    Boolean(value.aiProvider),
  {
    message: "Provide AI/FMP/CCPay fields or set a clear flag."
  }
);

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

const adminAiTraceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  maxSystemMessageChars: z.number().int().min(500).max(50_000).default(12_000),
  maxUserPayloadChars: z.number().int().min(1_000).max(250_000).default(60_000),
  maxRawResponseChars: z.number().int().min(500).max(50_000).default(12_000)
});

const adminAiTraceLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  userId: z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(191).optional())
});

const adminAiTraceCleanupSchema = z.object({
  deleteAll: z.boolean().default(false),
  olderThanDays: z.number().int().min(1).max(3650).default(30)
});

const aiPromptTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(64),
  promptText: z.string().max(8000).default(""),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().default(null),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().default(null),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  promptMode: z.enum(["trading_explainer", "market_analysis"]).optional(),
  marketAnalysisUpdateEnabled: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, timeframe] of value.timeframes.entries()) {
    if (seen.has(timeframe)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeframes must be unique",
        path: ["timeframes", index]
      });
      continue;
    }
    seen.add(timeframe);
  }
  if (value.timeframes.length > 0 && value.runTimeframe && !value.timeframes.includes(value.runTimeframe)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe must be included in timeframes",
      path: ["runTimeframe"]
    });
  }
});

const adminAiPromptsSchema = z.object({
  activePromptId: z.string().trim().nullable().optional(),
  prompts: z.array(aiPromptTemplateSchema).max(500).default([])
});

const adminAiPromptsPreviewSchema = z.object({
  exchange: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]).default("perp"),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("15m"),
  tsCreated: z.string().datetime().optional(),
  prediction: z.object({
    signal: z.enum(["up", "down", "neutral"]),
    expectedMovePct: z.number(),
    confidence: z.number()
  }).optional(),
  featureSnapshot: z.record(z.any()).default({}),
  settingsDraft: z.unknown().optional()
});

function validateAdminAiPromptGeneratorInput(
  value: {
    timeframes: Array<"5m" | "15m" | "1h" | "4h" | "1d">;
    runTimeframe?: "5m" | "15m" | "1h" | "4h" | "1d" | null;
  },
  ctx: z.RefinementCtx
) {
  const seen = new Set<string>();
  for (const [index, timeframe] of value.timeframes.entries()) {
    if (seen.has(timeframe)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeframes must be unique",
        path: ["timeframes", index]
      });
      continue;
    }
    seen.add(timeframe);
  }

  if (value.timeframes.length === 0 && value.runTimeframe) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe requires at least one selected timeframe",
      path: ["runTimeframe"]
    });
  } else if (value.timeframes.length > 0 && value.runTimeframe && !value.timeframes.includes(value.runTimeframe)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runTimeframe must be included in timeframes",
      path: ["runTimeframe"]
    });
  }
}

const adminAiPromptsGenerateBaseSchema = z.object({
  name: z.string().trim().min(1).max(64),
  strategyDescription: z.string().trim().min(1).max(8000),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().optional(),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  promptMode: z.enum(["trading_explainer", "market_analysis"]).optional(),
  setActive: z.boolean().default(false),
  isPublic: z.boolean().default(false)
});

const adminAiPromptsGeneratePreviewSchema = adminAiPromptsGenerateBaseSchema
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const adminAiPromptsGenerateSaveSchema = adminAiPromptsGenerateBaseSchema
  .extend({
    generatedPromptText: z.string().optional(),
    generationMeta: z.object({
      mode: z.enum(["ai", "fallback"]),
      model: z.string().trim().min(1).max(120)
    }).optional()
  })
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const userAiPromptTemplateIdParamSchema = z.object({
  id: z.string().trim().min(1).max(160)
});

const userAiPromptsGenerateBaseSchema = z.object({
  name: z.string().trim().min(1).max(64),
  strategyDescription: z.string().trim().min(1).max(8000),
  indicatorKeys: z.array(z.string().trim().min(1)).max(128).default([]),
  ohlcvBars: z.number().int().min(20).max(500).default(100),
  timeframes: z.array(z.enum(["5m", "15m", "1h", "4h", "1d"])).max(4).default([]),
  runTimeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).nullable().optional(),
  directionPreference: z.enum(["long", "short", "either"]).default("either"),
  confidenceTargetPct: z.number().min(0).max(100).default(60),
  slTpSource: z.enum(["local", "ai", "hybrid"]).default("local"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  promptMode: z.enum(["trading_explainer", "market_analysis"]).optional()
});

const userAiPromptsGeneratePreviewSchema = userAiPromptsGenerateBaseSchema
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

const userAiPromptsGenerateSaveSchema = userAiPromptsGenerateBaseSchema
  .extend({
    generatedPromptText: z.string().optional(),
    generationMeta: z.object({
      mode: z.enum(["ai", "fallback"]),
      model: z.string().trim().min(1).max(120)
    }).optional()
  })
  .superRefine((value, ctx) => validateAdminAiPromptGeneratorInput(value, ctx));

type AdminAiPromptsPayload = z.infer<typeof adminAiPromptsSchema>;

const localStrategyDefinitionSchema = z.object({
  strategyType: z.string().trim().min(1).max(128),
  engine: z.enum(["ts", "python"]).default("ts"),
  shadowMode: z.boolean().default(false),
  remoteStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  fallbackStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  timeoutMs: z.number().int().min(200).max(10000).nullable().optional(),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).default("1.0.0"),
  inputSchema: z.record(z.any()).nullable().optional(),
  configJson: z.record(z.any()).default({}),
  isEnabled: z.boolean().default(true)
});

const localStrategyDefinitionUpdateSchema = z.object({
  strategyType: z.string().trim().min(1).max(128).optional(),
  engine: z.enum(["ts", "python"]).optional(),
  shadowMode: z.boolean().optional(),
  remoteStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  fallbackStrategyType: z.string().trim().min(1).max(128).nullable().optional(),
  timeoutMs: z.number().int().min(200).max(10000).nullable().optional(),
  newsRiskMode: z.enum(["off", "block"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).optional(),
  inputSchema: z.record(z.any()).nullable().optional(),
  configJson: z.record(z.any()).optional(),
  isEnabled: z.boolean().optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

const localStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const localStrategyRunSchema = z.object({
  featureSnapshot: z.record(z.any()).default({}),
  ctx: z.object({
    signal: z.enum(["up", "down", "neutral"]).optional(),
    exchange: z.string().trim().optional(),
    accountId: z.string().trim().optional(),
    symbol: z.string().trim().optional(),
    marketType: z.string().trim().optional(),
    timeframe: z.string().trim().optional()
  }).catchall(z.any()).default({})
});

const compositeNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(["local", "ai"]),
  refId: z.string().trim().min(1).max(160),
  configOverrides: z.record(z.any()).optional(),
  position: z.object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional()
  }).optional()
});

const compositeEdgeSchema = z.object({
  from: z.string().trim().min(1).max(120),
  to: z.string().trim().min(1).max(120),
  rule: z.enum(["always", "if_signal_not_neutral", "if_confidence_gte"]).default("always"),
  confidenceGte: z.number().min(0).max(100).optional()
});

const compositeStrategyCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).default("1.0.0"),
  nodesJson: z.array(compositeNodeSchema).min(1).max(30),
  edgesJson: z.array(compositeEdgeSchema).max(120).default([]),
  combineMode: z.enum(["pipeline", "vote"]).default("pipeline"),
  outputPolicy: z.enum(["first_non_neutral", "override_by_confidence", "local_signal_ai_explain"]).default("local_signal_ai_explain"),
  newsRiskMode: z.enum(["off", "block"]).default("off"),
  isEnabled: z.boolean().default(true)
});

const compositeStrategyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  version: z.string().trim().min(1).max(64).optional(),
  nodesJson: z.array(compositeNodeSchema).min(1).max(30).optional(),
  edgesJson: z.array(compositeEdgeSchema).max(120).optional(),
  combineMode: z.enum(["pipeline", "vote"]).optional(),
  outputPolicy: z.enum(["first_non_neutral", "override_by_confidence", "local_signal_ai_explain"]).optional(),
  newsRiskMode: z.enum(["off", "block"]).optional(),
  isEnabled: z.boolean().optional()
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "Provide at least one field to update." }
);

const compositeStrategyIdParamSchema = z.object({
  id: z.string().trim().min(1)
});

const compositeStrategyDryRunSchema = z.object({
  predictionId: z.string().trim().min(1)
});

const adminIndicatorSettingsResolvedQuerySchema = z.object({
  exchange: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  symbol: z.string().trim().optional(),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional()
});

const adminVaultExecutionModeSchema = z.object({
  mode: z.enum(["offchain_shadow", "onchain_simulated", "onchain_live"]).optional(),
  provider: z.enum(["mock", "hyperliquid_demo", "hyperliquid"]).optional(),
  hyperliquidPilot: z.object({
    enabled: z.boolean().optional(),
    allowedUserIds: z.array(z.string().trim().min(1)).optional(),
    allowedWorkspaceIds: z.array(z.string().trim().min(1)).optional()
  }).optional()
});

const adminVaultProfitShareTreasurySchema = z.object({
  enabled: z.boolean().optional(),
  walletAddress: z.string().trim().max(128).nullable().optional()
});

const adminVaultProfitShareTreasuryConfigTxSchema = z.object({
  actionKey: z.string().trim().min(1).max(190).optional()
});

const adminVaultSafetyControlsSchema = z.object({
  haltNewOrders: z.boolean().optional(),
  closeOnlyAllUserIds: z.array(z.string().trim().min(1)).optional(),
  reason: z.string().trim().max(500).nullable().optional()
});

const adminCloseOnlyAllSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1)
});

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";
type DirectionPreference = "long" | "short" | "either";
type AccessSectionPredictionLimitKey =
  | "predictionsLocal"
  | "predictionsAi"
  | "predictionsComposite";
type AccessSectionLimitKey = "bots" | AccessSectionPredictionLimitKey;
type AccessSectionVisibility = {
  tradingDesk: boolean;
  bots: boolean;
  gridBots: boolean;
  predictionsDashboard: boolean;
  economicCalendar: boolean;
  news: boolean;
  strategy: boolean;
};
type AccessSectionLimits = {
  bots: number | null;
  predictionsLocal: number | null;
  predictionsAi: number | null;
  predictionsComposite: number | null;
};
type AccessSectionMaintenance = {
  enabled: boolean;
};
type StoredAccessSectionSettings = {
  visibility: AccessSectionVisibility;
  limits: AccessSectionLimits;
  maintenance: AccessSectionMaintenance;
};
type AccessSectionUsage = {
  bots: number;
  predictionsLocal: number;
  predictionsAi: number;
  predictionsComposite: number;
};
type StoredServerInfoSettings = {
  serverIpAddress: string | null;
};

const PREDICTION_TIMEFRAMES = new Set<PredictionTimeframe>(["5m", "15m", "1h", "4h", "1d"]);
const PREDICTION_MARKET_TYPES = new Set<PredictionMarketType>(["spot", "perp"]);
const PREDICTION_SIGNALS = new Set<PredictionSignal>(["up", "down", "neutral"]);
const PREDICTION_PRIMARY_SIGNAL_SOURCE: PredictionSignalSource =
  String(process.env.PREDICTION_PRIMARY_SIGNAL_SOURCE ?? "local").trim().toLowerCase() === "ai"
    ? "ai"
    : "local";

type DashboardConnectionStatus = "connected" | "degraded" | "disconnected";

type ExchangeAccountOverview = {
  exchangeAccountId: string;
  exchange: string;
  label: string;
  status: DashboardConnectionStatus;
  lastSyncAt: string | null;
  spotBudget: { total?: number | null; available?: number | null } | null;
  futuresBudget: { equity?: number | null; availableMargin?: number | null } | null;
  pnlTodayUsd: number | null;
  lastSyncError: { at: string | null; message: string | null } | null;
  bots: {
    running: number;
    runningStandard: number;
    runningGrid: number;
    stopped: number;
    error: number;
  };
  runningPredictions: number;
  alerts: { hasErrors: boolean; message?: string | null };
};

type DashboardOverviewTotals = {
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  currency: "USDT";
  includedAccounts: number;
};

type DashboardOverviewResponse = {
  accounts: ExchangeAccountOverview[];
  totals: DashboardOverviewTotals;
};

type DashboardPerformanceRange = "24h" | "7d" | "30d";

type DashboardPerformancePoint = {
  ts: string;
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  includedAccounts: number;
};

type DashboardOpenPositionItem = {
  exchangeAccountId: string;
  exchange: string;
  exchangeLabel: string;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  unrealizedPnl: number | null;
};

type RiskSeverity = "critical" | "warning" | "ok";
type RiskTrigger = "dailyLoss" | "margin" | "insufficientData";

type RiskLimitValues = {
  dailyLossWarnPct: number;
  dailyLossWarnUsd: number;
  dailyLossCriticalPct: number;
  dailyLossCriticalUsd: number;
  marginWarnPct: number;
  marginWarnUsd: number;
  marginCriticalPct: number;
  marginCriticalUsd: number;
};

type AccountRiskAssessment = {
  severity: RiskSeverity;
  triggers: RiskTrigger[];
  riskScore: number;
  insufficientData: boolean;
  lossUsd: number;
  lossPct: number | null;
  marginPct: number | null;
  availableMarginUsd: number | null;
  pnlTodayUsd: number | null;
};

type DashboardAlertSeverity = "critical" | "warning" | "info";
type DashboardAlertType =
  | "API_DOWN"
  | "SYNC_FAIL"
  | "BOT_ERROR"
  | "MARGIN_WARN"
  | "CIRCUIT_BREAKER"
  | "AI_PAYLOAD_BUDGET";
type DashboardAlert = {
  id: string;
  severity: DashboardAlertSeverity;
  type: DashboardAlertType;
  title: string;
  message?: string;
  exchange?: string;
  exchangeAccountId?: string;
  botId?: string;
  ts: string;
  link?: string;
};
const DASHBOARD_CONNECTED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_CONNECTED_SECONDS ?? "120") * 1000;
const DASHBOARD_DEGRADED_WINDOW_MS =
  Number(process.env.DASHBOARD_STATUS_DEGRADED_SECONDS ?? "600") * 1000;
const DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS = Math.max(
  60,
  Number(process.env.DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS ?? "300")
);
const DASHBOARD_PERFORMANCE_RANGE_MS: Record<DashboardPerformanceRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};
const DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS: RiskLimitValues = {
  dailyLossWarnPct: 2.5,
  dailyLossWarnUsd: 250,
  dailyLossCriticalPct: 5,
  dailyLossCriticalUsd: 500,
  marginWarnPct: 20,
  marginWarnUsd: 200,
  marginCriticalPct: 10,
  marginCriticalUsd: 100
};
const EXCHANGE_AUTO_SYNC_INTERVAL_MS =
  Math.max(15, Number(process.env.EXCHANGE_AUTO_SYNC_INTERVAL_SECONDS ?? "60")) * 1000;
const EXCHANGE_AUTO_SYNC_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.EXCHANGE_AUTO_SYNC_ENABLED ?? "1").trim().toLowerCase()
);
const MEXC_SPOT_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.MEXC_SPOT_ENABLED ?? "1").trim().toLowerCase()
);
const MEXC_FUTURES_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.MEXC_FUTURES_ENABLED ?? "0").trim().toLowerCase()
);
const MEXC_PERP_ENABLED =
  typeof process.env.MEXC_PERP_ENABLED === "string"
    ? !["0", "false", "off", "no"].includes(
        String(process.env.MEXC_PERP_ENABLED ?? "0").trim().toLowerCase()
      )
    : MEXC_FUTURES_ENABLED;
const MANUAL_TRADING_SPOT_ENABLED = !["0", "false", "off", "no"].includes(
  String(
    process.env.MANUAL_TRADING_SPOT_ENABLED ??
    (process.env.NODE_ENV === "production" ? "0" : "1")
  ).trim().toLowerCase()
);
const BINANCE_SPOT_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.BINANCE_SPOT_ENABLED ?? "1").trim().toLowerCase()
);
const BINANCE_PERP_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.BINANCE_PERP_ENABLED ?? "1").trim().toLowerCase()
);
const BOT_QUEUE_RECOVERY_INTERVAL_MS =
  Math.max(5_000, Number(process.env.BOT_QUEUE_RECOVERY_INTERVAL_MS ?? "30000"));
const PREDICTION_AUTO_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_AUTO_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_AUTO_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_AUTO_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT =
  Math.max(10, Number(process.env.PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT ?? "300"));
const PREDICTION_AUTO_MAX_RUNS_PER_CYCLE =
  Math.max(1, Number(process.env.PREDICTION_AUTO_MAX_RUNS_PER_CYCLE ?? "25"));
const PREDICTION_OUTCOME_HORIZON_BARS =
  Math.max(2, Number(process.env.PREDICTION_OUTCOME_HORIZON_BARS ?? "12"));
const PREDICTION_OUTCOME_EVAL_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_OUTCOME_EVAL_ENABLED ?? "1").trim().toLowerCase()
);
// Temporary kill switch for TP/SL outcome Telegram alerts.
const PREDICTION_OUTCOME_TELEGRAM_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_OUTCOME_TELEGRAM_ENABLED ?? "0").trim().toLowerCase()
);
const PREDICTION_OUTCOME_EVAL_POLL_MS =
  Math.max(30, Number(process.env.PREDICTION_OUTCOME_EVAL_POLL_SECONDS ?? "60")) * 1000;
const PREDICTION_OUTCOME_EVAL_BATCH_SIZE =
  Math.max(5, Number(process.env.PREDICTION_OUTCOME_EVAL_BATCH_SIZE ?? "50"));
const PREDICTION_EVALUATOR_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_EVALUATOR_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_EVALUATOR_POLL_MS =
  Math.max(60, Number(process.env.PREDICTION_EVALUATOR_POLL_SECONDS ?? "300")) * 1000;
const PREDICTION_EVALUATOR_BATCH_SIZE =
  Math.max(10, Number(process.env.PREDICTION_EVALUATOR_BATCH_SIZE ?? "100"));
const PREDICTION_EVALUATOR_SAFETY_LAG_MS =
  Math.max(0, Number(process.env.PREDICTION_EVALUATOR_SAFETY_LAG_SECONDS ?? "120")) * 1000;
const SETTINGS_SERVER_IP_ADDRESS =
  (typeof process.env.SERVER_PUBLIC_IP === "string" ? process.env.SERVER_PUBLIC_IP : null) ??
  (typeof process.env.PANEL_SERVER_IP === "string" ? process.env.PANEL_SERVER_IP : null) ??
  null;
const DASHBOARD_ALERT_STALE_SYNC_MS =
  Math.max(5 * 60, Number(process.env.DASHBOARD_ALERT_STALE_SYNC_SECONDS ?? "1800")) * 1000;
const DASHBOARD_MARGIN_WARN_RATIO =
  Math.min(1, Math.max(0.01, Number(process.env.DASHBOARD_MARGIN_WARN_RATIO ?? "0.1")));
const PREDICTION_REFRESH_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.PREDICTION_REFRESH_ENABLED ?? "1").trim().toLowerCase()
);
const PREDICTION_REFRESH_SCAN_LIMIT =
  Math.max(10, Number(process.env.PREDICTION_REFRESH_SCAN_LIMIT ?? PREDICTION_AUTO_TEMPLATE_SCAN_LIMIT));
const PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE =
  Math.max(1, Number(process.env.PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE ?? PREDICTION_AUTO_MAX_RUNS_PER_CYCLE));
const PREDICTION_REFRESH_TRIGGER_MIN_AGE_MS =
  Math.max(30, Number(process.env.PREDICTION_REFRESH_TRIGGER_MIN_AGE_SECONDS ?? "120")) * 1000;
const PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT =
  Math.max(1, Number(process.env.PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT ?? "25"));
const DEFAULT_PRED_TRIGGER_DEBOUNCE_SEC = Math.max(
  0,
  Number(process.env.PRED_TRIGGER_DEBOUNCE_SEC ?? "90")
);
const DEFAULT_PRED_AI_COOLDOWN_SEC = Math.max(
  30,
  Number(process.env.PRED_AI_COOLDOWN_SEC ?? process.env.PREDICTION_REFRESH_AI_COOLDOWN_SECONDS ?? "300")
);
const DEFAULT_PRED_EVENT_THROTTLE_SEC = Math.max(
  0,
  Number(process.env.PRED_EVENT_THROTTLE_SEC ?? "180")
);
const DEFAULT_PRED_HYSTERESIS_RATIO = clamp(
  Number(process.env.PRED_HYSTERESIS_RATIO ?? "0.6"),
  0.2,
  0.95
);
const DEFAULT_PRED_UNSTABLE_FLIP_LIMIT = Math.max(
  2,
  Number(process.env.PRED_UNSTABLE_FLIP_LIMIT ?? "4")
);
const DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_SECONDS = Math.max(
  60,
  Number(process.env.PRED_UNSTABLE_FLIP_WINDOW_SECONDS ?? "1800")
);
const DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_MS =
  Math.max(60, Number(process.env.PRED_UNSTABLE_FLIP_WINDOW_SECONDS ?? "1800")) * 1000;
const FEATURE_THRESHOLDS_CACHE_TTL_MS =
  Math.max(30, Number(process.env.FEATURE_THRESHOLDS_CACHE_TTL_SECONDS ?? "600")) * 1000;
const FEATURE_THRESHOLDS_WINSORIZE_PCT = clamp(
  Number(process.env.FEATURE_THRESHOLDS_WINSORIZE_PCT ?? "0.01"),
  0,
  0.25
);
const FEATURE_THRESHOLDS_MAX_GAP_RATIO = clamp(
  Number(process.env.FEATURE_THRESHOLDS_MAX_GAP_RATIO ?? "0.05"),
  0,
  1
);
const FEATURE_THRESHOLDS_CALIBRATION_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.FEATURE_THRESHOLDS_CALIBRATION_ENABLED ?? "1").trim().toLowerCase()
);
const FEATURE_THRESHOLDS_CALIBRATION_SCAN_MS =
  Math.max(5, Number(process.env.FEATURE_THRESHOLDS_CALIBRATION_SCAN_MINUTES ?? "10")) * 60 * 1000;
const FEATURE_THRESHOLDS_SYMBOLS = String(
  process.env.FEATURE_THRESHOLDS_SYMBOLS ?? "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT"
)
  .split(",")
  .map((item) => normalizeSymbolInput(item))
  .filter((item): item is string => Boolean(item));
const FEATURE_THRESHOLDS_TIMEFRAMES = String(
  process.env.FEATURE_THRESHOLDS_TIMEFRAMES ?? "5m,15m,1h,4h,1d"
)
  .split(",")
  .map((item) => item.trim())
  .filter((item): item is ThresholdTimeframe =>
    ["5m", "15m", "1h", "4h", "1d"].includes(item)
  );
const FEATURE_THRESHOLDS_MARKET_TYPES = String(
  process.env.FEATURE_THRESHOLDS_MARKET_TYPES ?? "perp"
)
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter((item): item is ThresholdMarketType => item === "spot" || item === "perp");

const GLOBAL_SETTING_EXCHANGES_KEY = "admin.exchanges";
const GLOBAL_SETTING_SMTP_KEY = "admin.smtp";
const GLOBAL_SETTING_SECURITY_KEY = "settings.security";
const GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY = "settings.securityUserOverrides.v1";
const GLOBAL_SETTING_API_KEYS_KEY = "admin.apiKeys";
const GLOBAL_SETTING_PREDICTION_REFRESH_KEY = "admin.predictionRefresh";
const GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY = "admin.predictionDefaults";
const GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY = "admin.backendAccess";
const GLOBAL_SETTING_ACCESS_SECTION_KEY = "admin.accessSection.v1";
const GLOBAL_SETTING_SERVER_INFO_KEY = "admin.serverInfo.v1";
const GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY = "admin.vaultExecutionMode.v1";
const GLOBAL_SETTING_AI_PROMPTS_KEY = AI_PROMPT_SETTINGS_GLOBAL_SETTING_KEY;
const GLOBAL_SETTING_AI_TRACE_KEY = AI_TRACE_SETTINGS_GLOBAL_SETTING_KEY;
const GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY = "predictions.performanceResetByUser.v1";
const DEFAULT_PREDICTION_SIGNAL_MODE = normalizePredictionSignalMode(
  process.env.PREDICTION_DEFAULT_SIGNAL_MODE
);
const DEFAULT_ACCESS_SECTION_SETTINGS: StoredAccessSectionSettings = {
  visibility: {
    tradingDesk: true,
    bots: true,
    gridBots: true,
    predictionsDashboard: true,
    economicCalendar: true,
    news: true,
    strategy: true
  },
  limits: {
    bots: null,
    predictionsLocal: null,
    predictionsAi: null,
    predictionsComposite: null
  },
  maintenance: {
    enabled: false
  }
};
const SUPERADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@utrade.vip").trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "TempAdmin1234!";
const PASSWORD_RESET_PURPOSE = "password_reset";
const PASSWORD_RESET_OTP_TTL_MIN = Math.max(
  5,
  Number(process.env.PASSWORD_RESET_OTP_TTL_MIN ?? "15")
);

function getMexcExchangeLabel(): string {
  if (MEXC_SPOT_ENABLED && MEXC_PERP_ENABLED) return "MEXC (Spot + Perp)";
  if (MEXC_SPOT_ENABLED) return "MEXC (Spot)";
  if (MEXC_PERP_ENABLED) return "MEXC (Perp)";
  return "MEXC (Disabled)";
}

function isMexcEnabledAtRuntime(): boolean {
  return MEXC_SPOT_ENABLED || MEXC_PERP_ENABLED;
}

function getBinanceExchangeLabel(): string {
  if (BINANCE_SPOT_ENABLED && BINANCE_PERP_ENABLED) return "Binance (Market Data)";
  if (BINANCE_SPOT_ENABLED) return "Binance (Spot Market Data)";
  if (BINANCE_PERP_ENABLED) return "Binance (Perp Market Data)";
  return "Binance (Disabled)";
}

function isBinanceEnabledAtRuntime(): boolean {
  return BINANCE_SPOT_ENABLED || BINANCE_PERP_ENABLED;
}

const EXCHANGE_OPTION_CATALOG = [
  { value: "bitget", label: "Bitget (Futures)" },
  { value: "hyperliquid", label: "Hyperliquid (Perps)" },
  { value: "mexc", label: getMexcExchangeLabel() },
  { value: "binance", label: getBinanceExchangeLabel() },
  { value: "paper", label: "Paper (Simulated Trading)" }
] as const;

type ExchangeOption = (typeof EXCHANGE_OPTION_CATALOG)[number];

const EXCHANGE_OPTION_VALUES = new Set(EXCHANGE_OPTION_CATALOG.map((row) => row.value));

function getRuntimeEnabledExchangeValues(): Set<ExchangeOption["value"]> {
  const enabled = new Set<ExchangeOption["value"]>(["bitget", "hyperliquid", "paper"]);
  if (isMexcEnabledAtRuntime()) {
    enabled.add("mexc");
  }
  if (isBinanceEnabledAtRuntime()) {
    enabled.add("binance");
  }
  return enabled;
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

type AiPredictionSnapshot = {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
};

type PredictionStrategyKind = "ai" | "local" | "composite";

type PredictionStrategyRef = {
  kind: PredictionStrategyKind;
  id: string;
  name: string | null;
};

type PredictionStateStrategyScope = {
  strategyKind: string;
  strategyId: string;
};

function normalizeSnapshotPrediction(value: Record<string, unknown>): AiPredictionSnapshot | null {
  const signal =
    value.signal === "up" || value.signal === "down" || value.signal === "neutral"
      ? value.signal
      : null;
  const expectedMoveRaw = Number(value.expectedMovePct);
  const confidenceRaw = Number(value.confidence);
  if (!signal || !Number.isFinite(expectedMoveRaw) || !Number.isFinite(confidenceRaw)) return null;
  const confidenceNormalized = confidenceRaw <= 1 ? confidenceRaw : confidenceRaw / 100;
  return {
    signal,
    expectedMovePct: Number(clamp(Math.abs(expectedMoveRaw), 0, 25).toFixed(2)),
    confidence: Number(clamp(confidenceNormalized, 0, 1).toFixed(4))
  };
}

function readAiPredictionSnapshot(snapshot: Record<string, unknown>): AiPredictionSnapshot | null {
  return normalizeSnapshotPrediction(asRecord(snapshot.aiPrediction));
}

function readLocalPredictionSnapshot(snapshot: Record<string, unknown>): AiPredictionSnapshot | null {
  return normalizeSnapshotPrediction(asRecord(snapshot.localPrediction));
}

function readSelectedSignalSource(snapshot: Record<string, unknown>): PredictionSignalSource {
  return snapshot.selectedSignalSource === "ai" ? "ai" : "local";
}

function normalizePredictionSignalMode(value: unknown): PredictionSignalMode {
  if (value === "local_only" || value === "ai_only" || value === "both") return value;
  if (value === "local") return "local_only";
  if (value === "ai") return "ai_only";
  return "both";
}

function readSignalMode(snapshot: Record<string, unknown>): PredictionSignalMode {
  return normalizePredictionSignalMode(snapshot.signalMode);
}

function readAiPromptTemplateId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.aiPromptTemplateId !== "string") return null;
  const trimmed = snapshot.aiPromptTemplateId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAiPromptTemplateName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.aiPromptTemplateName !== "string") return null;
  const trimmed = snapshot.aiPromptTemplateName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAiPromptMarketAnalysisUpdateEnabled(snapshot: Record<string, unknown>): boolean {
  const raw = snapshot.aiPromptMarketAnalysisUpdateEnabled;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1" || raw === 1) return true;
  if (raw === "false" || raw === "0" || raw === 0) return false;
  return false;
}

function readLocalStrategyId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.localStrategyId !== "string") return null;
  const trimmed = snapshot.localStrategyId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLocalStrategyName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.localStrategyName !== "string") return null;
  const trimmed = snapshot.localStrategyName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCompositeStrategyId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.compositeStrategyId !== "string") return null;
  const trimmed = snapshot.compositeStrategyId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCompositeStrategyName(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.compositeStrategyName !== "string") return null;
  const trimmed = snapshot.compositeStrategyName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePredictionStrategyKind(value: unknown): PredictionStrategyKind | null {
  if (value === "ai" || value === "local" || value === "composite") return value;
  return null;
}

function readPredictionStrategyRef(snapshot: Record<string, unknown>): PredictionStrategyRef | null {
  const direct = asRecord(snapshot.strategyRef);
  const directKind = normalizePredictionStrategyKind(direct.kind);
  const directId = typeof direct.id === "string" ? direct.id.trim() : "";
  if (directKind && directId) {
    return {
      kind: directKind,
      id: directId,
      name: typeof direct.name === "string" && direct.name.trim() ? direct.name.trim() : null
    };
  }

  const compositeId = readCompositeStrategyId(snapshot);
  if (compositeId) {
    return {
      kind: "composite",
      id: compositeId,
      name: readCompositeStrategyName(snapshot)
    };
  }

  const localId = readLocalStrategyId(snapshot);
  if (localId) {
    return {
      kind: "local",
      id: localId,
      name: readLocalStrategyName(snapshot)
    };
  }

  const aiId = readAiPromptTemplateId(snapshot);
  if (aiId) {
    return {
      kind: "ai",
      id: aiId,
      name: readAiPromptTemplateName(snapshot)
    };
  }
  return null;
}

function resolveNotificationStrategyName(params: {
  signalSource: PredictionSignalSource;
  snapshot?: Record<string, unknown> | null;
  strategyRef?: PredictionStrategyRef | null;
  aiPromptTemplateName?: string | null;
}): string | null {
  const snapshot = params.snapshot ?? null;
  const strategyRef = params.strategyRef ?? (snapshot ? readPredictionStrategyRef(snapshot) : null);
  const strategyName =
    typeof strategyRef?.name === "string" && strategyRef.name.trim()
      ? strategyRef.name.trim()
      : null;

  if (params.signalSource === "local") {
    if (strategyRef?.kind === "local" || strategyRef?.kind === "composite") {
      return strategyName;
    }
    if (snapshot) {
      return readLocalStrategyName(snapshot) ?? readCompositeStrategyName(snapshot);
    }
    return null;
  }

  if (strategyRef?.kind === "ai" && strategyName) {
    return strategyName;
  }
  if (typeof params.aiPromptTemplateName === "string" && params.aiPromptTemplateName.trim()) {
    return params.aiPromptTemplateName.trim();
  }
  if (snapshot) {
    return readAiPromptTemplateName(snapshot);
  }
  return null;
}

function toPredictionStateStrategyScope(
  strategyRef: PredictionStrategyRef | null | undefined
): PredictionStateStrategyScope {
  if (!strategyRef || !strategyRef.id?.trim()) {
    return {
      strategyKind: "legacy",
      strategyId: "legacy"
    };
  }
  return {
    strategyKind: strategyRef.kind,
    strategyId: strategyRef.id.trim()
  };
}

function readStateSignalMode(
  signalModeValue: unknown,
  snapshot: Record<string, unknown>
): PredictionSignalMode {
  if (
    signalModeValue === "local_only"
    || signalModeValue === "ai_only"
    || signalModeValue === "both"
  ) {
    return signalModeValue;
  }
  return readSignalMode(snapshot);
}

function resolvePreferredSignalSourceForMode(
  mode: PredictionSignalMode,
  fallback: PredictionSignalSource
): PredictionSignalSource {
  if (mode === "local_only") return "local";
  if (mode === "ai_only") return "ai";
  return fallback;
}

function resolveStrategyBoundSignalMode(
  baseMode: PredictionSignalMode,
  strategyKind: "ai" | "local" | "composite" | null
): PredictionSignalMode {
  if (strategyKind === "local") return "local_only";
  if (strategyKind === "ai") return "ai_only";
  return baseMode;
}

function withPredictionSnapshots(params: {
  snapshot: Record<string, unknown>;
  localPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  aiPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  } | null;
  selectedSignalSource: PredictionSignalSource;
  signalMode: PredictionSignalMode;
}): Record<string, unknown> {
  return {
    ...params.snapshot,
    localPrediction: normalizeSnapshotPrediction(asRecord(params.localPrediction)) ?? params.localPrediction,
    aiPrediction: params.aiPrediction
      ? (normalizeSnapshotPrediction(asRecord(params.aiPrediction)) ?? params.aiPrediction)
      : null,
    selectedSignalSource: params.selectedSignalSource,
    signalMode: params.signalMode
  };
}

function selectPredictionBySource(params: {
  localPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  aiPrediction: {
    signal: PredictionSignal;
    expectedMovePct: number;
    confidence: number;
  };
  source: PredictionSignalSource;
}): {
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  source: PredictionSignalSource;
} {
  if (params.source === "ai") {
    return {
      signal: params.aiPrediction.signal,
      expectedMovePct: params.aiPrediction.expectedMovePct,
      confidence: params.aiPrediction.confidence,
      source: "ai"
    };
  }
  return {
    signal: params.localPrediction.signal,
    expectedMovePct: params.localPrediction.expectedMovePct,
    confidence: params.localPrediction.confidence,
    source: "local"
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeIndicatorSettingExchange(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIndicatorSettingAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIndicatorSettingSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeSymbolInput(value);
  return normalized ?? null;
}

function normalizeIndicatorSettingTimeframe(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toIndicatorComputeSettings(config: IndicatorSettingsConfig) {
  return {
    enabledPacks: {
      indicatorsV1: config.enabledPacks.indicatorsV1,
      indicatorsV2: config.enabledPacks.indicatorsV2
    },
    stochrsi: {
      rsiLen: config.indicatorsV2.stochrsi.rsiLen,
      stochLen: config.indicatorsV2.stochrsi.stochLen,
      smoothK: config.indicatorsV2.stochrsi.smoothK,
      smoothD: config.indicatorsV2.stochrsi.smoothD
    },
    volume: {
      lookback: config.indicatorsV2.volume.lookback,
      emaFast: config.indicatorsV2.volume.emaFast,
      emaSlow: config.indicatorsV2.volume.emaSlow
    },
    fvg: {
      lookback: config.indicatorsV2.fvg.lookback,
      fillRule: config.indicatorsV2.fvg.fillRule
    },
    vumanchu: {
      wtChannelLen: config.indicatorsV2.vumanchu.wtChannelLen,
      wtAverageLen: config.indicatorsV2.vumanchu.wtAverageLen,
      wtMaLen: config.indicatorsV2.vumanchu.wtMaLen,
      obLevel: config.indicatorsV2.vumanchu.obLevel,
      osLevel: config.indicatorsV2.vumanchu.osLevel,
      osLevel3: config.indicatorsV2.vumanchu.osLevel3,
      wtDivObLevel: config.indicatorsV2.vumanchu.wtDivObLevel,
      wtDivOsLevel: config.indicatorsV2.vumanchu.wtDivOsLevel,
      wtDivObLevelAdd: config.indicatorsV2.vumanchu.wtDivObLevelAdd,
      wtDivOsLevelAdd: config.indicatorsV2.vumanchu.wtDivOsLevelAdd,
      rsiLen: config.indicatorsV2.vumanchu.rsiLen,
      rsiMfiPeriod: config.indicatorsV2.vumanchu.rsiMfiPeriod,
      rsiMfiMultiplier: config.indicatorsV2.vumanchu.rsiMfiMultiplier,
      rsiMfiPosY: config.indicatorsV2.vumanchu.rsiMfiPosY,
      stochLen: config.indicatorsV2.vumanchu.stochLen,
      stochRsiLen: config.indicatorsV2.vumanchu.stochRsiLen,
      stochKSmooth: config.indicatorsV2.vumanchu.stochKSmooth,
      stochDSmooth: config.indicatorsV2.vumanchu.stochDSmooth,
      useHiddenDiv: config.indicatorsV2.vumanchu.useHiddenDiv,
      useHiddenDivNoLimits: config.indicatorsV2.vumanchu.useHiddenDivNoLimits,
      goldRsiThreshold: config.indicatorsV2.vumanchu.goldRsiThreshold,
      goldWtDiffMin: config.indicatorsV2.vumanchu.goldWtDiffMin
    },
    breakerBlocks: {
      len: config.indicatorsV2.breakerBlocks.len,
      breakerCandleOnlyBody: config.indicatorsV2.breakerBlocks.breakerCandleOnlyBody,
      breakerCandle2Last: config.indicatorsV2.breakerBlocks.breakerCandle2Last,
      tillFirstBreak: config.indicatorsV2.breakerBlocks.tillFirstBreak,
      onlyWhenInPDarray: config.indicatorsV2.breakerBlocks.onlyWhenInPDarray,
      showPDarray: config.indicatorsV2.breakerBlocks.showPDarray,
      showBreaks: config.indicatorsV2.breakerBlocks.showBreaks,
      showSPD: config.indicatorsV2.breakerBlocks.showSPD,
      pdTextColor: config.indicatorsV2.breakerBlocks.pdTextColor,
      pdSwingLineColor: config.indicatorsV2.breakerBlocks.pdSwingLineColor,
      enableTp: config.indicatorsV2.breakerBlocks.enableTp,
      tpColor: config.indicatorsV2.breakerBlocks.tpColor,
      rrTp1: config.indicatorsV2.breakerBlocks.rrTp1,
      rrTp2: config.indicatorsV2.breakerBlocks.rrTp2,
      rrTp3: config.indicatorsV2.breakerBlocks.rrTp3,
      bbPlusColorA: config.indicatorsV2.breakerBlocks.bbPlusColorA,
      bbPlusColorB: config.indicatorsV2.breakerBlocks.bbPlusColorB,
      swingBullColor: config.indicatorsV2.breakerBlocks.swingBullColor,
      bbMinusColorA: config.indicatorsV2.breakerBlocks.bbMinusColorA,
      bbMinusColorB: config.indicatorsV2.breakerBlocks.bbMinusColorB,
      swingBearColor: config.indicatorsV2.breakerBlocks.swingBearColor
    },
    superOrderBlockFvgBos: {
      plotOB: config.indicatorsV2.superOrderBlockFvgBos.plotOB,
      obBullColor: config.indicatorsV2.superOrderBlockFvgBos.obBullColor,
      obBearColor: config.indicatorsV2.superOrderBlockFvgBos.obBearColor,
      obBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.obBoxBorderStyle,
      obBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.obBorderTransparency,
      obMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.obMaxBoxSet,
      filterMitOB: config.indicatorsV2.superOrderBlockFvgBos.filterMitOB,
      mitOBColor: config.indicatorsV2.superOrderBlockFvgBos.mitOBColor,
      plotFVG: config.indicatorsV2.superOrderBlockFvgBos.plotFVG,
      plotStructureBreakingFVG: config.indicatorsV2.superOrderBlockFvgBos.plotStructureBreakingFVG,
      fvgBullColor: config.indicatorsV2.superOrderBlockFvgBos.fvgBullColor,
      fvgBearColor: config.indicatorsV2.superOrderBlockFvgBos.fvgBearColor,
      fvgStructBreakingColor: config.indicatorsV2.superOrderBlockFvgBos.fvgStructBreakingColor,
      fvgBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.fvgBoxBorderStyle,
      fvgBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.fvgBorderTransparency,
      fvgMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.fvgMaxBoxSet,
      filterMitFVG: config.indicatorsV2.superOrderBlockFvgBos.filterMitFVG,
      mitFVGColor: config.indicatorsV2.superOrderBlockFvgBos.mitFVGColor,
      plotRJB: config.indicatorsV2.superOrderBlockFvgBos.plotRJB,
      rjbBullColor: config.indicatorsV2.superOrderBlockFvgBos.rjbBullColor,
      rjbBearColor: config.indicatorsV2.superOrderBlockFvgBos.rjbBearColor,
      rjbBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.rjbBoxBorderStyle,
      rjbBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.rjbBorderTransparency,
      rjbMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.rjbMaxBoxSet,
      filterMitRJB: config.indicatorsV2.superOrderBlockFvgBos.filterMitRJB,
      mitRJBColor: config.indicatorsV2.superOrderBlockFvgBos.mitRJBColor,
      plotPVT: config.indicatorsV2.superOrderBlockFvgBos.plotPVT,
      pivotLookup: config.indicatorsV2.superOrderBlockFvgBos.pivotLookup,
      pvtTopColor: config.indicatorsV2.superOrderBlockFvgBos.pvtTopColor,
      pvtBottomColor: config.indicatorsV2.superOrderBlockFvgBos.pvtBottomColor,
      plotBOS: config.indicatorsV2.superOrderBlockFvgBos.plotBOS,
      useHighLowForBullishBoS: config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBullishBoS,
      useHighLowForBearishBoS: config.indicatorsV2.superOrderBlockFvgBos.useHighLowForBearishBoS,
      bosBoxFlag: config.indicatorsV2.superOrderBlockFvgBos.bosBoxFlag,
      bosBoxLength: config.indicatorsV2.superOrderBlockFvgBos.bosBoxLength,
      bosBullColor: config.indicatorsV2.superOrderBlockFvgBos.bosBullColor,
      bosBearColor: config.indicatorsV2.superOrderBlockFvgBos.bosBearColor,
      bosBoxBorderStyle: config.indicatorsV2.superOrderBlockFvgBos.bosBoxBorderStyle,
      bosBorderTransparency: config.indicatorsV2.superOrderBlockFvgBos.bosBorderTransparency,
      bosMaxBoxSet: config.indicatorsV2.superOrderBlockFvgBos.bosMaxBoxSet,
      plotHVB: config.indicatorsV2.superOrderBlockFvgBos.plotHVB,
      hvbBullColor: config.indicatorsV2.superOrderBlockFvgBos.hvbBullColor,
      hvbBearColor: config.indicatorsV2.superOrderBlockFvgBos.hvbBearColor,
      hvbEMAPeriod: config.indicatorsV2.superOrderBlockFvgBos.hvbEMAPeriod,
      hvbMultiplier: config.indicatorsV2.superOrderBlockFvgBos.hvbMultiplier,
      plotPPDD: config.indicatorsV2.superOrderBlockFvgBos.plotPPDD,
      ppddBullColor: config.indicatorsV2.superOrderBlockFvgBos.ppddBullColor,
      ppddBearColor: config.indicatorsV2.superOrderBlockFvgBos.ppddBearColor,
      plotOBFVG: config.indicatorsV2.superOrderBlockFvgBos.plotOBFVG,
      obfvgBullColor: config.indicatorsV2.superOrderBlockFvgBos.obfvgBullColor,
      obfvgBearColor: config.indicatorsV2.superOrderBlockFvgBos.obfvgBearColor,
      plotLabelOB: config.indicatorsV2.superOrderBlockFvgBos.plotLabelOB,
      obLabelColor: config.indicatorsV2.superOrderBlockFvgBos.obLabelColor,
      obLabelSize: config.indicatorsV2.superOrderBlockFvgBos.obLabelSize,
      plotLabelFVG: config.indicatorsV2.superOrderBlockFvgBos.plotLabelFVG,
      fvgLabelColor: config.indicatorsV2.superOrderBlockFvgBos.fvgLabelColor,
      fvgLabelSize: config.indicatorsV2.superOrderBlockFvgBos.fvgLabelSize,
      plotLabelRJB: config.indicatorsV2.superOrderBlockFvgBos.plotLabelRJB,
      rjbLabelColor: config.indicatorsV2.superOrderBlockFvgBos.rjbLabelColor,
      rjbLabelSize: config.indicatorsV2.superOrderBlockFvgBos.rjbLabelSize,
      plotLabelBOS: config.indicatorsV2.superOrderBlockFvgBos.plotLabelBOS,
      bosLabelColor: config.indicatorsV2.superOrderBlockFvgBos.bosLabelColor,
      bosLabelSize: config.indicatorsV2.superOrderBlockFvgBos.bosLabelSize
    }
  };
}

function toAdvancedIndicatorComputeSettings(config: IndicatorSettingsConfig) {
  return {
    enabled: config.enabledPacks.advancedIndicators,
    adrLen: config.advancedIndicators.adrLen,
    awrLen: config.advancedIndicators.awrLen,
    amrLen: config.advancedIndicators.amrLen,
    rdLen: config.advancedIndicators.rdLen,
    rwLen: config.advancedIndicators.rwLen,
    openingRangeMinutes: config.advancedIndicators.openingRangeMin,
    sessionsUseDST: config.advancedIndicators.sessionsUseDST,
    smcInternalLength: config.advancedIndicators.smcInternalLength,
    smcSwingLength: config.advancedIndicators.smcSwingLength,
    smcEqualLength: config.advancedIndicators.smcEqualLength,
    smcEqualThreshold: config.advancedIndicators.smcEqualThreshold,
    smcMaxOrderBlocks: config.advancedIndicators.smcMaxOrderBlocks,
    smcFvgAutoThreshold: config.advancedIndicators.smcFvgAutoThreshold,
    liquiditySweepsEnabled: config.enabledPacks.liquiditySweeps,
    liquiditySweepLen: config.liquiditySweeps.len,
    liquiditySweepMode: config.liquiditySweeps.mode,
    liquiditySweepExtend: config.liquiditySweeps.extend,
    liquiditySweepMaxBars: config.liquiditySweeps.maxBars,
    liquiditySweepMaxRecentEvents: config.liquiditySweeps.maxRecentEvents,
    liquiditySweepMaxActiveZones: config.liquiditySweeps.maxActiveZones
  };
}

function normalizeExchangeValue(value: string): string {
  return value.trim().toLowerCase();
}

type GridDeskVisibilityMask = {
  symbolsByAccount: Map<string, Set<string>>;
  orderIdsByAccount: Map<string, Set<string>>;
};

function createEmptyGridDeskVisibilityMask(): GridDeskVisibilityMask {
  return {
    symbolsByAccount: new Map<string, Set<string>>(),
    orderIdsByAccount: new Map<string, Set<string>>()
  };
}

async function loadGridDeskVisibilityMask(
  userId: string,
  exchangeAccountIds: string[]
): Promise<GridDeskVisibilityMask> {
  const accountIds = Array.from(
    new Set(exchangeAccountIds.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
  if (accountIds.length === 0) return createEmptyGridDeskVisibilityMask();

  const mask = createEmptyGridDeskVisibilityMask();
  const rowsRaw = await ignoreMissingTable(() => db.gridBotInstance.findMany({
    where: {
      userId,
      exchangeAccountId: { in: accountIds },
      state: { not: "archived" }
    },
    select: {
      id: true,
      exchangeAccountId: true,
      template: {
        select: {
          symbol: true
        }
      }
    }
  }));
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const instanceIdToAccountId = new Map<string, string>();
  for (const row of rows as Array<{ id: string; exchangeAccountId: string; template?: { symbol?: string | null } | null }>) {
    const exchangeAccountId = String(row.exchangeAccountId ?? "").trim();
    const symbol = normalizeSymbolInput(String(row.template?.symbol ?? ""));
    if (!exchangeAccountId || !symbol) continue;
    instanceIdToAccountId.set(String(row.id), exchangeAccountId);
    const set = mask.symbolsByAccount.get(exchangeAccountId) ?? new Set<string>();
    set.add(symbol);
    mask.symbolsByAccount.set(exchangeAccountId, set);
  }

  const instanceIds = Array.from(instanceIdToAccountId.keys());
  if (instanceIds.length === 0) return mask;

  const orderRowsRaw = await ignoreMissingTable(() => db.gridBotOrderMap.findMany({
    where: {
      instanceId: { in: instanceIds },
      status: "open"
    },
    select: {
      instanceId: true,
      exchangeOrderId: true,
      clientOrderId: true
    }
  }));
  const orderRows = Array.isArray(orderRowsRaw) ? orderRowsRaw : [];
  for (const row of orderRows as Array<{ instanceId: string; exchangeOrderId?: string | null; clientOrderId?: string | null }>) {
    const exchangeAccountId = instanceIdToAccountId.get(String(row.instanceId));
    if (!exchangeAccountId) continue;
    const set = mask.orderIdsByAccount.get(exchangeAccountId) ?? new Set<string>();
    const exchangeOrderId = String(row.exchangeOrderId ?? "").trim();
    const clientOrderId = String(row.clientOrderId ?? "").trim();
    if (exchangeOrderId) set.add(exchangeOrderId);
    if (clientOrderId) set.add(clientOrderId);
    mask.orderIdsByAccount.set(exchangeAccountId, set);
  }

  return mask;
}

function filterGridBotPositionsForDesk<T extends { symbol?: string | null }>(
  rows: T[],
  mask: GridDeskVisibilityMask,
  exchangeAccountId: string
): T[] {
  const hiddenSymbols = mask.symbolsByAccount.get(exchangeAccountId);
  if (!hiddenSymbols || hiddenSymbols.size === 0) return rows;
  return rows.filter((row) => {
    const normalized = extractDeskRowSymbol(row);
    return !normalized || !hiddenSymbols.has(normalized);
  });
}

function filterGridBotOrdersForDesk<T extends { orderId?: string | null; symbol?: string | null }>(
  rows: T[],
  mask: GridDeskVisibilityMask,
  exchangeAccountId: string
): T[] {
  const hiddenOrderIds = mask.orderIdsByAccount.get(exchangeAccountId);
  const hiddenSymbols = mask.symbolsByAccount.get(exchangeAccountId);
  if ((!hiddenOrderIds || hiddenOrderIds.size === 0) && (!hiddenSymbols || hiddenSymbols.size === 0)) {
    return rows;
  }
  return rows.filter((row) => {
    const orderKeys = extractDeskOrderKeys(row);
    if (orderKeys.some((value) => hiddenOrderIds?.has(value))) return false;
    const symbol = extractDeskRowSymbol(row);
    if (symbol && hiddenSymbols?.has(symbol)) return false;
    return true;
  });
}

function countVisibleDeskPositions<T extends { symbol?: string | null }>(
  rows: T[],
  mask: GridDeskVisibilityMask,
  exchangeAccountId: string
): number {
  return filterGridBotPositionsForDesk(rows, mask, exchangeAccountId)
    .filter((row: any) => Number.isFinite(Number(row?.size ?? row?.qty ?? 0)) && Number(row?.size ?? row?.qty ?? 0) > 0)
    .length;
}

function extractDeskRowSymbol(row: unknown): string | null {
  const raw = row as Record<string, any> | null;
  if (!raw || typeof raw !== "object") return null;
  const candidates = [
    raw.symbol,
    raw.instId,
    raw.instrumentId,
    raw.raw?.symbol,
    raw.raw?.instId,
    raw.raw?.instrumentId
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSymbolInput(String(candidate ?? ""));
    if (normalized) return normalized;
  }
  return null;
}

function extractDeskOrderKeys(row: unknown): string[] {
  const raw = row as Record<string, any> | null;
  if (!raw || typeof raw !== "object") return [];
  return Array.from(
    new Set(
      [
        raw.orderId,
        raw.clientOrderId,
        raw.clientOid,
        raw.exchangeOrderId,
        raw.raw?.orderId,
        raw.raw?.clientOrderId,
        raw.raw?.clientOid,
        raw.raw?.exchangeOrderId
      ]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

function isSuperadminEmail(email: string): boolean {
  return email.trim().toLowerCase() === SUPERADMIN_EMAIL;
}

function generateTempPassword() {
  const raw = crypto.randomBytes(9).toString("base64url");
  return `Tmp-${raw.slice(0, 10)}!`;
}

function generateNumericCode(length = 6): string {
  const max = 10 ** length;
  const random = crypto.randomInt(0, max);
  return String(random).padStart(length, "0");
}

function hashOneTimeCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function getGlobalSettingValue(key: string): Promise<unknown> {
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  return row?.value;
}

async function getVaultSafetyControlsSettings() {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY },
    select: { value: true, updatedAt: true }
  });
  const parsed = parseVaultSafetyControls(row?.value);
  return {
    ...parsed,
    source: row ? "db" : "default",
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : parsed.updatedAt,
    defaults: parseVaultSafetyControls(null)
  };
}

async function setVaultSafetyControlsSettings(input: {
  haltNewOrders: boolean;
  closeOnlyAllUserIds: string[];
  reason?: string | null;
  updatedByUserId: string;
}) {
  const next = buildVaultSafetyControls({
    haltNewOrders: input.haltNewOrders,
    closeOnlyAllUserIds: input.closeOnlyAllUserIds,
    reason: input.reason ?? null,
    updatedByUserId: input.updatedByUserId
  });
  const updated = await setGlobalSettingValue(GLOBAL_SETTING_VAULT_SAFETY_CONTROLS_KEY, next);
  return {
    ...parseVaultSafetyControls(updated.value),
    source: "db",
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : next.updatedAt,
    defaults: parseVaultSafetyControls(null)
  };
}

function parseStoredAdminBackendAccess(value: unknown): { userIds: string[] } {
  const record = parseJsonObject(value);
  const raw = Array.isArray(record.userIds) ? record.userIds : [];
  const userIds = Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
  return { userIds };
}

function parsePredictionPerformanceResetMap(value: unknown): { byUserId: Record<string, string> } {
  const record = parseJsonObject(value);
  const rawByUserId = parseJsonObject(record.byUserId);
  const byUserId: Record<string, string> = {};
  for (const [userId, rawIso] of Object.entries(rawByUserId)) {
    if (typeof rawIso !== "string") continue;
    const parsed = new Date(rawIso);
    if (Number.isNaN(parsed.getTime())) continue;
    byUserId[userId] = parsed.toISOString();
  }
  return { byUserId };
}

function normalizeServerIpAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 255);
}

function parseStoredServerInfoSettings(value: unknown): StoredServerInfoSettings {
  const record = parseJsonObject(value);
  return {
    serverIpAddress: normalizeServerIpAddress(record.serverIpAddress)
  };
}

function normalizeAccessSectionLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  if (normalized < 0) return null;
  return normalized;
}

function parseStoredAccessSectionSettings(value: unknown): StoredAccessSectionSettings {
  const record = parseJsonObject(value);
  const visibilityRaw = parseJsonObject(record.visibility);
  const limitsRaw = parseJsonObject(record.limits);
  const maintenanceRaw = parseJsonObject(record.maintenance);

  return {
    visibility: {
      tradingDesk: asBoolean(
        visibilityRaw.tradingDesk,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.tradingDesk
      ),
      bots: asBoolean(visibilityRaw.bots, DEFAULT_ACCESS_SECTION_SETTINGS.visibility.bots),
      gridBots: asBoolean(
        visibilityRaw.gridBots,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.gridBots
      ),
      predictionsDashboard: asBoolean(
        visibilityRaw.predictionsDashboard,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.predictionsDashboard
      ),
      economicCalendar: asBoolean(
        visibilityRaw.economicCalendar,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.economicCalendar
      ),
      news: asBoolean(
        visibilityRaw.news,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.news
      ),
      strategy: asBoolean(
        visibilityRaw.strategy,
        DEFAULT_ACCESS_SECTION_SETTINGS.visibility.strategy
      )
    },
    limits: {
      bots: normalizeAccessSectionLimit(limitsRaw.bots),
      predictionsLocal: normalizeAccessSectionLimit(limitsRaw.predictionsLocal),
      predictionsAi: normalizeAccessSectionLimit(limitsRaw.predictionsAi),
      predictionsComposite: normalizeAccessSectionLimit(limitsRaw.predictionsComposite)
    },
    maintenance: {
      enabled: asBoolean(
        maintenanceRaw.enabled,
        DEFAULT_ACCESS_SECTION_SETTINGS.maintenance.enabled
      )
    }
  };
}

function toEffectiveAccessSectionSettings(
  stored: StoredAccessSectionSettings | null | undefined
): StoredAccessSectionSettings {
  if (!stored) return DEFAULT_ACCESS_SECTION_SETTINGS;
  return {
    visibility: {
      tradingDesk: Boolean(stored.visibility?.tradingDesk),
      bots: Boolean(stored.visibility?.bots),
      gridBots: Boolean(stored.visibility?.gridBots),
      predictionsDashboard: Boolean(stored.visibility?.predictionsDashboard),
      economicCalendar: Boolean(stored.visibility?.economicCalendar),
      news: Boolean(stored.visibility?.news),
      strategy: Boolean(stored.visibility?.strategy)
    },
    limits: {
      bots: normalizeAccessSectionLimit(stored.limits?.bots),
      predictionsLocal: normalizeAccessSectionLimit(stored.limits?.predictionsLocal),
      predictionsAi: normalizeAccessSectionLimit(stored.limits?.predictionsAi),
      predictionsComposite: normalizeAccessSectionLimit(stored.limits?.predictionsComposite)
    },
    maintenance: {
      enabled: Boolean(stored.maintenance?.enabled)
    }
  };
}

function createEmptyAccessSectionUsage(): AccessSectionUsage {
  return {
    bots: 0,
    predictionsLocal: 0,
    predictionsAi: 0,
    predictionsComposite: 0
  };
}

function computeRemaining(limit: number | null, usage: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - Math.max(0, Math.trunc(usage)));
}

function resolvePredictionLimitBucketFromStrategy(params: {
  strategyRef?: PredictionStrategyRef | null;
  signalMode?: PredictionSignalMode;
}): AccessSectionPredictionLimitKey {
  const kind = params.strategyRef?.kind ?? null;
  if (kind === "local") return "predictionsLocal";
  if (kind === "composite") return "predictionsComposite";
  if (kind === "ai") return "predictionsAi";
  const mode = normalizePredictionSignalMode(params.signalMode);
  if (mode === "local_only") return "predictionsLocal";
  return "predictionsAi";
}

function resolvePredictionLimitBucketFromStateRow(row: {
  featuresSnapshot: unknown;
  signalMode: unknown;
}): AccessSectionPredictionLimitKey {
  const snapshot = asRecord(row.featuresSnapshot);
  const strategyRef = readPredictionStrategyRef(snapshot);
  const signalMode =
    row.signalMode === "local_only" || row.signalMode === "ai_only" || row.signalMode === "both"
      ? row.signalMode
      : readSignalMode(snapshot);
  return resolvePredictionLimitBucketFromStrategy({
    strategyRef,
    signalMode
  });
}

function predictionQuotaKindFromBucket(
  bucket: AccessSectionPredictionLimitKey
): "local" | "ai" | "composite" {
  if (bucket === "predictionsLocal") return "local";
  if (bucket === "predictionsComposite") return "composite";
  return "ai";
}

async function getAccessSectionSettings(): Promise<StoredAccessSectionSettings> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ACCESS_SECTION_KEY },
    select: { value: true }
  });
  return toEffectiveAccessSectionSettings(parseStoredAccessSectionSettings(row?.value));
}

async function getAccessSectionUsageForUser(userId: string): Promise<AccessSectionUsage> {
  const [botsCount, predictionStates] = await Promise.all([
    db.bot.count({ where: { userId } }),
    db.predictionState.findMany({
      where: {
        userId,
        autoScheduleEnabled: true
      },
      select: {
        featuresSnapshot: true,
        signalMode: true
      }
    })
  ]);

  const usage = createEmptyAccessSectionUsage();
  usage.bots = botsCount;
  for (const row of predictionStates) {
    const bucket = resolvePredictionLimitBucketFromStateRow(row);
    usage[bucket] += 1;
  }
  return usage;
}

async function evaluateAccessSectionBypassForUser(
  user: { id: string; email: string }
): Promise<boolean> {
  const ctx = await resolveUserContext(user);
  return Boolean(ctx.hasAdminBackendAccess);
}

async function isStrategyFeatureEnabledForUser(
  user: { id: string; email: string }
): Promise<boolean> {
  const bypass = await evaluateAccessSectionBypassForUser(user);
  if (bypass) return true;
  const settings = await getAccessSectionSettings();
  return Boolean(settings.visibility.strategy);
}

async function canCreateBotForUser(params: {
  userId: string;
  bypass: boolean;
}): Promise<{ allowed: boolean; limit: number | null; usage: number; remaining: number | null }> {
  if (params.bypass) {
    return { allowed: true, limit: null, usage: 0, remaining: null };
  }
  const settings = await getAccessSectionSettings();
  const botLimit = settings.limits.bots;
  const result = await canCreateBotWithQuota({
    userId: params.userId,
    caps: {
      bots: {
        maxRunning: botLimit,
        maxTotal: botLimit
      }
    }
  });
  const limit = result.limits.bots.maxTotal;
  const usage = result.usage.bots.total;
  return {
    allowed: result.allowed,
    limit,
    usage,
    remaining: computeRemaining(limit, usage)
  };
}

async function canCreatePredictionForUser(params: {
  userId: string;
  bypass: boolean;
  bucket: AccessSectionPredictionLimitKey;
  existingStateId: string | null;
  consumesSlot: boolean;
}): Promise<{
  allowed: boolean;
  code: string | null;
  limit: number | null;
  usage: number;
  remaining: number | null;
  runningLimit: number | null;
  runningUsage: number;
  runningRemaining: number | null;
}> {
  if (params.bypass || !params.consumesSlot || params.existingStateId) {
    return {
      allowed: true,
      code: null,
      limit: null,
      usage: 0,
      remaining: null,
      runningLimit: null,
      runningUsage: 0,
      runningRemaining: null
    };
  }
  const settings = await getAccessSectionSettings();
  const result = await canCreatePredictionWithQuota({
    userId: params.userId,
    kind: predictionQuotaKindFromBucket(params.bucket),
    existingStateId: params.existingStateId,
    consumesSlot: params.consumesSlot,
    caps: {
      predictions: {
        ai: {
          maxRunning: settings.limits.predictionsAi,
          maxTotal: settings.limits.predictionsAi
        },
        composite: {
          maxRunning: settings.limits.predictionsComposite,
          maxTotal: settings.limits.predictionsComposite
        }
      }
    }
  });
  const bucketLimits =
    params.bucket === "predictionsAi"
      ? result.limits.predictions.ai
      : params.bucket === "predictionsComposite"
        ? result.limits.predictions.composite
        : result.limits.predictions.local;
  const bucketUsage =
    params.bucket === "predictionsAi"
      ? result.usage.predictions.ai
      : params.bucket === "predictionsComposite"
        ? result.usage.predictions.composite
        : result.usage.predictions.local;
  const code = result.allowed ? null : result.reason;
  const limit = bucketLimits.maxTotal;
  const usage = bucketUsage.total;
  const runningLimit = bucketLimits.maxRunning;
  const runningUsage = bucketUsage.running;
  return {
    allowed: result.allowed,
    code,
    limit,
    usage,
    remaining: computeRemaining(limit, usage),
    runningLimit,
    runningUsage,
    runningRemaining: computeRemaining(runningLimit, runningUsage)
  };
}

async function getPredictionPerformanceResetAt(userId: string): Promise<Date | null> {
  const stored = parsePredictionPerformanceResetMap(
    await getGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY)
  );
  const raw = stored.byUserId[userId];
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function setPredictionPerformanceResetAt(userId: string, nowIso: string): Promise<string> {
  const stored = parsePredictionPerformanceResetMap(
    await getGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY)
  );
  const parsedNow = new Date(nowIso);
  const normalizedNow = Number.isNaN(parsedNow.getTime())
    ? new Date().toISOString()
    : parsedNow.toISOString();
  stored.byUserId[userId] = normalizedNow;
  await setGlobalSettingValue(GLOBAL_SETTING_PREDICTION_PERFORMANCE_RESET_KEY, stored);
  return normalizedNow;
}

async function getAdminBackendAccessUserIdSet(): Promise<Set<string>> {
  const stored = parseStoredAdminBackendAccess(
    await getGlobalSettingValue(GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY)
  );
  return new Set(stored.userIds);
}

async function hasAdminBackendAccess(user: { id: string; email: string }): Promise<boolean> {
  if (isSuperadminEmail(user.email)) return true;
  const ids = await getAdminBackendAccessUserIdSet();
  return ids.has(user.id);
}

async function setGlobalSettingValue(key: string, value: unknown) {
  return db.globalSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
    select: { key: true, value: true, updatedAt: true }
  });
}

async function getServerInfoSettings(): Promise<{
  serverIpAddress: string | null;
  updatedAt: string | null;
  source: "db" | "env" | "none";
  defaults: { serverIpAddress: string | null };
}> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_SERVER_INFO_KEY },
    select: { value: true, updatedAt: true }
  });
  const stored = parseStoredServerInfoSettings(row?.value);
  const envDefault = normalizeServerIpAddress(SETTINGS_SERVER_IP_ADDRESS);
  const effective = stored.serverIpAddress ?? envDefault;
  const source: "db" | "env" | "none" = stored.serverIpAddress
    ? "db"
    : envDefault
      ? "env"
      : "none";
  return {
    serverIpAddress: effective,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    source,
    defaults: { serverIpAddress: envDefault }
  };
}

async function getAllowedExchangeValues(): Promise<string[]> {
  const runtimeEnabled = getRuntimeEnabledExchangeValues();
  const configured = asStringArray(await getGlobalSettingValue(GLOBAL_SETTING_EXCHANGES_KEY))
    .map(normalizeExchangeValue)
    .filter((value) => EXCHANGE_OPTION_VALUES.has(value as ExchangeOption["value"]))
    .filter((value) => runtimeEnabled.has(value as ExchangeOption["value"]));
  if (configured.length > 0) return Array.from(new Set(configured));
  return EXCHANGE_OPTION_CATALOG
    .map((row) => row.value)
    .filter((value) => runtimeEnabled.has(value as ExchangeOption["value"]));
}

function getExchangeOptionsResponse(allowedValues: string[]) {
  const runtimeEnabled = getRuntimeEnabledExchangeValues();
  const allowed = new Set(allowedValues.map(normalizeExchangeValue));
  return EXCHANGE_OPTION_CATALOG.map((row) => ({
    value: row.value,
    label: row.label,
    enabled: runtimeEnabled.has(row.value) && allowed.has(row.value)
  }));
}

async function getSecurityGlobalSettings() {
  const raw = parseJsonObject(await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_KEY));
  return {
    reauthOtpEnabled: asBoolean(raw.reauthOtpEnabled, true)
  };
}

async function setSecurityGlobalSettings(next: { reauthOtpEnabled: boolean }) {
  return setGlobalSettingValue(GLOBAL_SETTING_SECURITY_KEY, {
    reauthOtpEnabled: next.reauthOtpEnabled
  });
}

function parseStoredSecurityUserOverrides(value: unknown): StoredSecurityUserOverrides {
  const record = parseJsonObject(value);
  const rawByUserId = parseJsonObject(record.reauthOtpEnabledByUserId);
  const reauthOtpEnabledByUserId: Record<string, boolean> = {};
  for (const [userId, rawValue] of Object.entries(rawByUserId)) {
    if (typeof userId !== "string" || !userId.trim()) continue;
    if (typeof rawValue !== "boolean") continue;
    reauthOtpEnabledByUserId[userId] = rawValue;
  }
  return { reauthOtpEnabledByUserId };
}

async function getSecurityUserReauthOverride(userId: string): Promise<boolean | null> {
  const stored = parseStoredSecurityUserOverrides(
    await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY)
  );
  if (Object.prototype.hasOwnProperty.call(stored.reauthOtpEnabledByUserId, userId)) {
    return stored.reauthOtpEnabledByUserId[userId];
  }
  return null;
}

async function setSecurityUserReauthOverride(userId: string, enabled: boolean): Promise<void> {
  const stored = parseStoredSecurityUserOverrides(
    await getGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY)
  );
  stored.reauthOtpEnabledByUserId[userId] = Boolean(enabled);
  await setGlobalSettingValue(GLOBAL_SETTING_SECURITY_USER_OVERRIDES_KEY, stored);
}

type StoredSmtpSettings = {
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
  secure: boolean | null;
  passEnc: string | null;
};

type StoredSecurityUserOverrides = {
  reauthOtpEnabledByUserId: Record<string, boolean>;
};

type StoredSaladRuntimeSettings = {
  apiBaseUrl: string | null;
  organization: string | null;
  project: string | null;
  container: string | null;
};

type StoredAiProviderProfile = {
  aiApiKeyEnc: string | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  saladRuntime: StoredSaladRuntimeSettings;
};

type StoredAiProviderProfiles = {
  openai: StoredAiProviderProfile;
  ollama: StoredAiProviderProfile;
};

type StoredCcpaySettings = {
  appIdEnc: string | null;
  appSecretEnc: string | null;
  baseUrl: string | null;
  priceFiatId: string | null;
  webBaseUrl: string | null;
};

type StoredApiKeysSettings = {
  aiApiKeyEnc: string | null;
  openaiApiKeyEnc: string | null;
  fmpApiKeyEnc: string | null;
  aiProvider: "openai" | "ollama" | "disabled" | null;
  aiBaseUrl: string | null;
  aiModel: string | null;
  openaiModel: OpenAiAdminModel | null;
  aiProfiles: StoredAiProviderProfiles;
  ccpay: StoredCcpaySettings;
};

type StoredPredictionRefreshSettings = {
  triggerDebounceSec: number | null;
  aiCooldownSec: number | null;
  eventThrottleSec: number | null;
  hysteresisRatio: number | null;
  unstableFlipLimit: number | null;
  unstableFlipWindowSeconds: number | null;
};

type StoredPredictionDefaultsSettings = {
  signalMode: PredictionSignalMode | null;
};

type PredictionRefreshSettingsPublic = {
  triggerDebounceSec: number;
  aiCooldownSec: number;
  eventThrottleSec: number;
  hysteresisRatio: number;
  unstableFlipLimit: number;
  unstableFlipWindowSeconds: number;
};

type PredictionDefaultsSettingsPublic = {
  signalMode: PredictionSignalMode;
};

type ApiKeySource = "env" | "db" | "none";
type EffectiveAiModelSource = "db" | "env" | "default";
type EffectiveAiProviderSource = "db" | "env" | "default";
type EffectiveAiBaseUrlSource = "db" | "env" | "default";
const OPENAI_ADMIN_MODEL_OPTION_SET = new Set<string>(OPENAI_ADMIN_MODEL_OPTIONS);

function normalizeOpenAiAdminModel(value: unknown): OpenAiAdminModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!OPENAI_ADMIN_MODEL_OPTION_SET.has(trimmed)) return null;
  return trimmed as OpenAiAdminModel;
}

function emptySaladRuntimeSettings(): StoredSaladRuntimeSettings {
  return {
    apiBaseUrl: null,
    organization: null,
    project: null,
    container: null
  };
}

function emptyAiProviderProfile(): StoredAiProviderProfile {
  return {
    aiApiKeyEnc: null,
    aiBaseUrl: null,
    aiModel: null,
    saladRuntime: emptySaladRuntimeSettings()
  };
}

function emptyCcpaySettings(): StoredCcpaySettings {
  return {
    appIdEnc: null,
    appSecretEnc: null,
    baseUrl: null,
    priceFiatId: null,
    webBaseUrl: null
  };
}

function normalizeProviderForProfile(
  provider: "openai" | "ollama" | "disabled" | null | undefined
): "openai" | "ollama" {
  return provider === "ollama" ? "ollama" : "openai";
}

function parseStoredSaladRuntimeSettings(value: unknown): StoredSaladRuntimeSettings {
  const record = parseJsonObject(value);
  const apiBaseUrl =
    typeof record.apiBaseUrl === "string" && record.apiBaseUrl.trim()
      ? record.apiBaseUrl.trim().slice(0, 500)
      : null;
  const organization =
    typeof record.organization === "string" && record.organization.trim()
      ? record.organization.trim().slice(0, 191)
      : null;
  const project =
    typeof record.project === "string" && record.project.trim()
      ? record.project.trim().slice(0, 191)
      : null;
  const container =
    typeof record.container === "string" && record.container.trim()
      ? record.container.trim().slice(0, 191)
      : null;
  return {
    apiBaseUrl,
    organization,
    project,
    container
  };
}

function parseStoredAiProviderProfile(value: unknown): StoredAiProviderProfile {
  const record = parseJsonObject(value);
  const aiApiKeyEnc =
    typeof record.aiApiKeyEnc === "string" && record.aiApiKeyEnc.trim()
      ? record.aiApiKeyEnc.trim()
      : typeof record.openaiApiKeyEnc === "string" && record.openaiApiKeyEnc.trim()
        ? record.openaiApiKeyEnc.trim()
        : null;
  const aiBaseUrl =
    typeof record.aiBaseUrl === "string" && record.aiBaseUrl.trim()
      ? record.aiBaseUrl.trim()
      : null;
  const aiModel =
    typeof record.aiModel === "string" && record.aiModel.trim()
      ? record.aiModel.trim()
      : null;
  const saladRuntime = parseStoredSaladRuntimeSettings(record.saladRuntime);
  return {
    aiApiKeyEnc,
    aiBaseUrl,
    aiModel,
    saladRuntime
  };
}

function parseStoredCcpaySettings(value: unknown): StoredCcpaySettings {
  const record = parseJsonObject(value);
  const nested = parseJsonObject(record.ccpay);
  const appIdEnc =
    typeof nested.appIdEnc === "string" && nested.appIdEnc.trim()
      ? nested.appIdEnc.trim()
      : typeof record.appIdEnc === "string" && record.appIdEnc.trim()
        ? record.appIdEnc.trim()
      : typeof record.ccpayAppIdEnc === "string" && record.ccpayAppIdEnc.trim()
        ? record.ccpayAppIdEnc.trim()
        : null;
  const appSecretEnc =
    typeof nested.appSecretEnc === "string" && nested.appSecretEnc.trim()
      ? nested.appSecretEnc.trim()
      : typeof record.appSecretEnc === "string" && record.appSecretEnc.trim()
        ? record.appSecretEnc.trim()
      : typeof record.ccpayAppSecretEnc === "string" && record.ccpayAppSecretEnc.trim()
        ? record.ccpayAppSecretEnc.trim()
        : null;
  const baseUrl =
    typeof nested.baseUrl === "string" && nested.baseUrl.trim()
      ? nested.baseUrl.trim().replace(/\/$/, "")
      : typeof record.baseUrl === "string" && record.baseUrl.trim()
        ? record.baseUrl.trim().replace(/\/$/, "")
      : typeof record.ccpayBaseUrl === "string" && record.ccpayBaseUrl.trim()
        ? record.ccpayBaseUrl.trim().replace(/\/$/, "")
        : null;
  const priceFiatIdRaw =
    typeof nested.priceFiatId === "string" && nested.priceFiatId.trim()
      ? nested.priceFiatId.trim()
      : typeof record.priceFiatId === "string" && record.priceFiatId.trim()
        ? record.priceFiatId.trim()
      : typeof record.ccpayPriceFiatId === "string" && record.ccpayPriceFiatId.trim()
        ? record.ccpayPriceFiatId.trim()
        : null;
  const priceFiatId = priceFiatIdRaw && /^\d+$/.test(priceFiatIdRaw) ? priceFiatIdRaw : null;
  const webBaseUrl =
    typeof nested.webBaseUrl === "string" && nested.webBaseUrl.trim()
      ? nested.webBaseUrl.trim().replace(/\/$/, "")
      : typeof record.webBaseUrl === "string" && record.webBaseUrl.trim()
        ? record.webBaseUrl.trim().replace(/\/$/, "")
      : typeof record.ccpayWebBaseUrl === "string" && record.ccpayWebBaseUrl.trim()
        ? record.ccpayWebBaseUrl.trim().replace(/\/$/, "")
        : null;

  return {
    appIdEnc,
    appSecretEnc,
    baseUrl,
    priceFiatId,
    webBaseUrl
  };
}

function getStoredAiProfile(
  settings: StoredApiKeysSettings,
  provider: "openai" | "ollama" | "disabled" | null | undefined
): StoredAiProviderProfile {
  return settings.aiProfiles[normalizeProviderForProfile(provider)];
}

function parseStoredSmtpSettings(value: unknown): StoredSmtpSettings {
  const record = parseJsonObject(value);
  const host = typeof record.host === "string" && record.host.trim() ? record.host.trim() : null;
  const user = typeof record.user === "string" && record.user.trim() ? record.user.trim() : null;
  const from = typeof record.from === "string" && record.from.trim() ? record.from.trim() : null;
  const passEnc =
    typeof record.passEnc === "string" && record.passEnc.trim() ? record.passEnc.trim() : null;
  const portNum = Number(record.port);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? Math.floor(portNum) : null;
  const secure =
    typeof record.secure === "boolean"
      ? record.secure
      : typeof record.secure === "string"
        ? asBoolean(record.secure, false)
        : null;
  return {
    host,
    port,
    user,
    from,
    secure,
    passEnc
  };
}

function toPublicSmtpSettings(value: StoredSmtpSettings) {
  return {
    host: value.host,
    port: value.port,
    user: value.user,
    from: value.from,
    secure: value.secure ?? (value.port === 465),
    hasPassword: Boolean(value.passEnc)
  };
}

function parseStoredApiKeysSettings(value: unknown): StoredApiKeysSettings {
  const record = parseJsonObject(value);
  const aiApiKeyEnc =
    typeof record.aiApiKeyEnc === "string" && record.aiApiKeyEnc.trim()
      ? record.aiApiKeyEnc.trim()
      : null;
  const openaiApiKeyEnc =
    typeof record.openaiApiKeyEnc === "string" && record.openaiApiKeyEnc.trim()
      ? record.openaiApiKeyEnc.trim()
      : null;
  const fmpApiKeyEnc =
    typeof record.fmpApiKeyEnc === "string" && record.fmpApiKeyEnc.trim()
      ? record.fmpApiKeyEnc.trim()
      : null;
  const aiProviderRaw = typeof record.aiProvider === "string" ? record.aiProvider.trim().toLowerCase() : "";
  const aiProvider =
    aiProviderRaw === "disabled" || aiProviderRaw === "off" || aiProviderRaw === "none"
      ? "disabled"
      : normalizeAiProvider(aiProviderRaw);
  const aiBaseUrl =
    typeof record.aiBaseUrl === "string" && record.aiBaseUrl.trim()
      ? record.aiBaseUrl.trim()
      : null;
  const aiModel =
    typeof record.aiModel === "string" && record.aiModel.trim()
      ? record.aiModel.trim()
      : typeof record.openaiModel === "string" && record.openaiModel.trim()
        ? record.openaiModel.trim()
        : null;
  const openaiModel = normalizeOpenAiAdminModel(record.openaiModel);
  const aiProfilesRecord = parseJsonObject(record.aiProfiles);
  const parsedOpenAiProfile = parseStoredAiProviderProfile(aiProfilesRecord.openai);
  const parsedOllamaProfile = parseStoredAiProviderProfile(aiProfilesRecord.ollama);
  const parsedCcpay = parseStoredCcpaySettings(record);
  const activeLegacyProvider = normalizeProviderForProfile(aiProvider);
  const openaiModelFromLegacy =
    typeof record.openaiModel === "string" && record.openaiModel.trim()
      ? record.openaiModel.trim()
      : null;

  const openaiProfile: StoredAiProviderProfile = {
    aiApiKeyEnc:
      parsedOpenAiProfile.aiApiKeyEnc
      ?? openaiApiKeyEnc
      ?? (activeLegacyProvider === "openai" ? aiApiKeyEnc : null),
    aiBaseUrl:
      parsedOpenAiProfile.aiBaseUrl
      ?? (activeLegacyProvider === "openai" ? aiBaseUrl : null),
    aiModel:
      parsedOpenAiProfile.aiModel
      ?? openaiModelFromLegacy
      ?? (activeLegacyProvider === "openai" ? aiModel : null),
    saladRuntime: parsedOpenAiProfile.saladRuntime
  };
  const ollamaProfile: StoredAiProviderProfile = {
    aiApiKeyEnc:
      parsedOllamaProfile.aiApiKeyEnc
      ?? (activeLegacyProvider === "ollama" ? aiApiKeyEnc : null),
    aiBaseUrl:
      parsedOllamaProfile.aiBaseUrl
      ?? (activeLegacyProvider === "ollama" ? aiBaseUrl : null),
    aiModel:
      parsedOllamaProfile.aiModel
      ?? (activeLegacyProvider === "ollama" ? aiModel : null),
    saladRuntime: parsedOllamaProfile.saladRuntime
  };
  const effectiveProviderForTopLevel = normalizeProviderForProfile(aiProvider);
  const selectedProfile = effectiveProviderForTopLevel === "ollama" ? ollamaProfile : openaiProfile;
  const resolvedAiApiKeyEnc = selectedProfile.aiApiKeyEnc ?? aiApiKeyEnc ?? openaiApiKeyEnc;
  const resolvedAiBaseUrl = selectedProfile.aiBaseUrl ?? aiBaseUrl;
  const resolvedAiModel = selectedProfile.aiModel ?? aiModel ?? openaiModelFromLegacy;
  const resolvedOpenAiModel = normalizeOpenAiAdminModel(openaiProfile.aiModel) ?? openaiModel;

  return {
    aiApiKeyEnc: resolvedAiApiKeyEnc,
    openaiApiKeyEnc: openaiProfile.aiApiKeyEnc ?? openaiApiKeyEnc ?? aiApiKeyEnc,
    fmpApiKeyEnc,
    aiProvider: aiProvider ?? null,
    aiBaseUrl: resolvedAiBaseUrl,
    aiModel: resolvedAiModel,
    openaiModel: resolvedOpenAiModel,
    aiProfiles: {
      openai: openaiProfile,
      ollama: ollamaProfile
    },
    ccpay: {
      ...emptyCcpaySettings(),
      ...parsedCcpay
    }
  };
}

function parseStoredPredictionRefreshSettings(value: unknown): StoredPredictionRefreshSettings {
  const record = parseJsonObject(value);
  const readInt = (field: string, min: number, max: number): number | null => {
    const parsed = Number(record[field]);
    if (!Number.isFinite(parsed)) return null;
    const valueInt = Math.trunc(parsed);
    if (valueInt < min || valueInt > max) return null;
    return valueInt;
  };
  const readFloat = (field: string, min: number, max: number): number | null => {
    const parsed = Number(record[field]);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < min || parsed > max) return null;
    return parsed;
  };
  return {
    triggerDebounceSec: readInt("triggerDebounceSec", 0, 3600),
    aiCooldownSec: readInt("aiCooldownSec", 30, 3600),
    eventThrottleSec: readInt("eventThrottleSec", 0, 3600),
    hysteresisRatio: readFloat("hysteresisRatio", 0.2, 0.95),
    unstableFlipLimit: readInt("unstableFlipLimit", 2, 20),
    unstableFlipWindowSeconds: readInt("unstableFlipWindowSeconds", 60, 86400)
  };
}

function parseStoredPredictionDefaultsSettings(value: unknown): StoredPredictionDefaultsSettings {
  const record = parseJsonObject(value);
  const raw = record.signalMode;
  if (raw === undefined || raw === null) {
    return { signalMode: null };
  }
  const signalMode = normalizePredictionSignalMode(raw);
  return {
    signalMode
  };
}

function toEffectivePredictionRefreshSettings(
  stored: StoredPredictionRefreshSettings | null
): PredictionRefreshSettingsPublic {
  return {
    triggerDebounceSec: stored?.triggerDebounceSec ?? DEFAULT_PRED_TRIGGER_DEBOUNCE_SEC,
    aiCooldownSec: stored?.aiCooldownSec ?? DEFAULT_PRED_AI_COOLDOWN_SEC,
    eventThrottleSec: stored?.eventThrottleSec ?? DEFAULT_PRED_EVENT_THROTTLE_SEC,
    hysteresisRatio: stored?.hysteresisRatio ?? DEFAULT_PRED_HYSTERESIS_RATIO,
    unstableFlipLimit: stored?.unstableFlipLimit ?? DEFAULT_PRED_UNSTABLE_FLIP_LIMIT,
    unstableFlipWindowSeconds:
      stored?.unstableFlipWindowSeconds ?? DEFAULT_PRED_UNSTABLE_FLIP_WINDOW_SECONDS
  };
}

function toEffectivePredictionDefaultsSettings(
  stored: StoredPredictionDefaultsSettings | null
): PredictionDefaultsSettingsPublic {
  return {
    signalMode: stored?.signalMode ?? DEFAULT_PREDICTION_SIGNAL_MODE
  };
}

async function getPredictionDefaultsSettings(): Promise<PredictionDefaultsSettingsPublic> {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY },
    select: { value: true }
  });
  const stored = parseStoredPredictionDefaultsSettings(row?.value);
  return toEffectivePredictionDefaultsSettings(stored);
}

function toPublicApiKeysSettings(value: StoredApiKeysSettings) {
  const maskEncrypted = (encrypted: string | null): string | null => {
    if (!encrypted) return null;
    try {
      const decrypted = decryptSecret(encrypted);
      return maskSecret(decrypted);
    } catch {
      return "****";
    }
  };

  const selectedProvider = normalizeProviderForProfile(value.aiProvider);
  const selectedProfile = getStoredAiProfile(value, selectedProvider);
  const openaiProfile = value.aiProfiles.openai ?? emptyAiProviderProfile();
  const ollamaProfile = value.aiProfiles.ollama ?? emptyAiProviderProfile();
  const aiKeyEnc = selectedProfile.aiApiKeyEnc ?? value.aiApiKeyEnc ?? value.openaiApiKeyEnc;
  const aiApiKeyMasked = maskEncrypted(aiKeyEnc);
  const openAiApiKeyMasked = maskEncrypted(openaiProfile.aiApiKeyEnc ?? value.openaiApiKeyEnc);
  const fmpApiKeyMasked = maskEncrypted(value.fmpApiKeyEnc);
  const ccpayAppIdMasked = maskEncrypted(value.ccpay.appIdEnc);
  const ccpayAppSecretMasked = maskEncrypted(value.ccpay.appSecretEnc);

  return {
    aiApiKeyMasked,
    hasAiApiKey: Boolean(aiKeyEnc),
    openaiApiKeyMasked: openAiApiKeyMasked,
    hasOpenAiApiKey: Boolean(openaiProfile.aiApiKeyEnc ?? value.openaiApiKeyEnc),
    fmpApiKeyMasked,
    hasFmpApiKey: Boolean(value.fmpApiKeyEnc),
    ccpay: {
      appIdMasked: ccpayAppIdMasked,
      hasAppId: Boolean(value.ccpay.appIdEnc),
      appSecretMasked: ccpayAppSecretMasked,
      hasAppSecret: Boolean(value.ccpay.appSecretEnc),
      baseUrl: value.ccpay.baseUrl,
      priceFiatId: value.ccpay.priceFiatId,
      webBaseUrl: value.ccpay.webBaseUrl
    },
    aiProvider: value.aiProvider,
    aiBaseUrl: selectedProfile.aiBaseUrl ?? value.aiBaseUrl,
    aiModel: selectedProfile.aiModel ?? value.aiModel,
    openaiModel: normalizeOpenAiAdminModel(openaiProfile.aiModel) ?? value.openaiModel,
    aiProfiles: {
      openai: {
        aiBaseUrl: openaiProfile.aiBaseUrl,
        aiModel: openaiProfile.aiModel,
        aiApiKeyMasked: openAiApiKeyMasked,
        hasAiApiKey: Boolean(openaiProfile.aiApiKeyEnc ?? value.openaiApiKeyEnc),
        saladRuntime: {
          apiBaseUrl: openaiProfile.saladRuntime.apiBaseUrl,
          organization: openaiProfile.saladRuntime.organization,
          project: openaiProfile.saladRuntime.project,
          container: openaiProfile.saladRuntime.container
        }
      },
      ollama: {
        aiBaseUrl: ollamaProfile.aiBaseUrl,
        aiModel: ollamaProfile.aiModel,
        aiApiKeyMasked: maskEncrypted(ollamaProfile.aiApiKeyEnc),
        hasAiApiKey: Boolean(ollamaProfile.aiApiKeyEnc),
        saladRuntime: {
          apiBaseUrl: ollamaProfile.saladRuntime.apiBaseUrl,
          organization: ollamaProfile.saladRuntime.organization,
          project: ollamaProfile.saladRuntime.project,
          container: ollamaProfile.saladRuntime.container
        }
      }
    }
  };
}

function resolveEffectiveAiProvider(settings: StoredApiKeysSettings): {
  provider: "openai" | "ollama" | "disabled";
  source: EffectiveAiProviderSource;
} {
  if (settings.aiProvider) {
    return { provider: settings.aiProvider, source: "db" };
  }
  const envProviderRaw = typeof process.env.AI_PROVIDER === "string"
    ? process.env.AI_PROVIDER.trim()
    : "";
  if (envProviderRaw) {
    const normalized = envProviderRaw.toLowerCase();
    if (normalized === "off" || normalized === "disabled" || normalized === "none") {
      return { provider: "disabled", source: "env" };
    }
    return { provider: normalizeAiProvider(normalized) ?? "openai", source: "env" };
  }
  return { provider: "openai", source: "default" };
}

function resolveEffectiveAiBaseUrl(settings: StoredApiKeysSettings): {
  baseUrl: string;
  source: EffectiveAiBaseUrlSource;
} {
  const provider = resolveEffectiveAiProvider(settings).provider;
  const profile = getStoredAiProfile(settings, provider);
  if (profile.aiBaseUrl) {
    return { baseUrl: profile.aiBaseUrl, source: "db" };
  }
  const envBaseUrl = typeof process.env.AI_BASE_URL === "string" ? process.env.AI_BASE_URL.trim() : "";
  if (envBaseUrl) {
    return { baseUrl: envBaseUrl, source: "env" };
  }
  if (provider === "ollama") {
    return { baseUrl: "http://localhost:11434/v1", source: "default" };
  }
  return { baseUrl: "https://api.openai.com/v1", source: "default" };
}

function resolveEffectiveAiModel(settings: StoredApiKeysSettings): {
  model: string;
  source: EffectiveAiModelSource;
} {
  const provider = resolveEffectiveAiProvider(settings).provider;
  const profile = getStoredAiProfile(settings, provider);
  const resolved = resolveAiModelFromConfig({
    provider: provider === "ollama" ? "ollama" : "openai",
    dbModel: profile.aiModel ?? settings.aiModel ?? settings.openaiModel,
    envModel: process.env.AI_MODEL
  });
  return {
    model: resolved.model,
    source: resolved.source
  };
}

function resolveEffectiveAiApiKey(
  settings: StoredApiKeysSettings
): { apiKey: string | null; source: ApiKeySource; decryptError: boolean } {
  const provider = resolveEffectiveAiProvider(settings).provider;
  const profile = getStoredAiProfile(settings, provider);
  const keyEnc = profile.aiApiKeyEnc ?? settings.aiApiKeyEnc ?? settings.openaiApiKeyEnc;
  if (!keyEnc) {
    const envApiKey = process.env.AI_API_KEY?.trim() ?? "";
    if (envApiKey) {
      return { apiKey: envApiKey, source: "env", decryptError: false };
    }
    if (provider === "ollama") {
      return { apiKey: "ollama", source: "none", decryptError: false };
    }
    return { apiKey: null, source: "none", decryptError: false };
  }

  try {
    const decrypted = decryptSecret(keyEnc).trim();
    if (!decrypted) {
      return { apiKey: null, source: "none", decryptError: false };
    }
    return { apiKey: decrypted, source: "db", decryptError: false };
  } catch {
    return { apiKey: null, source: "db", decryptError: true };
  }
}

function resolveOllamaProfileAiApiKey(
  settings: StoredApiKeysSettings
): { apiKey: string | null; source: ApiKeySource; decryptError: boolean } {
  const keyEnc = settings.aiProfiles.ollama.aiApiKeyEnc;
  if (!keyEnc) {
    const envApiKey = process.env.AI_API_KEY?.trim() ?? "";
    if (envApiKey && envApiKey.toLowerCase() !== "ollama") {
      return { apiKey: envApiKey, source: "env", decryptError: false };
    }
    return { apiKey: null, source: "none", decryptError: false };
  }

  try {
    const decrypted = decryptSecret(keyEnc).trim();
    if (!decrypted) {
      return { apiKey: null, source: "none", decryptError: false };
    }
    return { apiKey: decrypted, source: "db", decryptError: false };
  } catch {
    return { apiKey: null, source: "db", decryptError: true };
  }
}

function resolveEffectiveFmpApiKey(
  settings: StoredApiKeysSettings
): { apiKey: string | null; source: ApiKeySource; decryptError: boolean } {
  const envApiKey = process.env.FMP_API_KEY?.trim() ?? "";
  if (envApiKey) {
    return { apiKey: envApiKey, source: "env", decryptError: false };
  }

  if (!settings.fmpApiKeyEnc) {
    return { apiKey: null, source: "none", decryptError: false };
  }

  try {
    const decrypted = decryptSecret(settings.fmpApiKeyEnc).trim();
    if (!decrypted) {
      return { apiKey: null, source: "none", decryptError: false };
    }
    return { apiKey: decrypted, source: "db", decryptError: false };
  } catch {
    return { apiKey: null, source: "db", decryptError: true };
  }
}

async function ensureWorkspaceMembership(userId: string, userEmail: string) {
  const existing = await db.workspaceMember.findFirst({
    where: { userId },
    include: {
      role: true
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) {
    return {
      workspaceId: existing.workspaceId as string,
      roleId: existing.roleId as string,
      permissions: parseJsonObject(existing.role?.permissions)
    };
  }

  const workspaceName = `${userEmail.split("@")[0] || "Workspace"} Workspace`;
  const workspace = await db.workspace.create({
    data: {
      name: workspaceName
    }
  });
  const { adminRoleId } = await ensureDefaultRoles(workspace.id);
  const member = await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId,
      roleId: adminRoleId
    },
    include: {
      role: true
    }
  });

  return {
    workspaceId: member.workspaceId as string,
    roleId: member.roleId as string,
    permissions: parseJsonObject(member.role?.permissions)
  };
}

async function resolveUserContext(user: { id: string; email: string }) {
  const member = await ensureWorkspaceMembership(user.id, user.email);
  try {
    const resolvedPlan = await resolveEffectivePlanForUser(user.id);
    await syncPrimaryWorkspaceEntitlementsForUser({
      userId: user.id,
      effectivePlan: resolvedPlan.plan
    });
  } catch {
    // billing sync is best-effort and must not block auth context resolution
  }
  const isSuperadmin = isSuperadminEmail(user.email);
  const hasAdminAccess = isSuperadmin || (await hasAdminBackendAccess(user));
  const permissions = hasAdminAccess
    ? buildPermissions(PERMISSION_KEYS)
    : member.permissions;
  return {
    workspaceId: member.workspaceId,
    permissions,
    isSuperadmin,
    hasAdminBackendAccess: hasAdminAccess
  };
}

async function resolveWorkspaceIdForUserId(userId: string): Promise<string | null> {
  const member = await db.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  if (!member?.workspaceId || typeof member.workspaceId !== "string") return null;
  const trimmed = member.workspaceId.trim();
  return trimmed || null;
}

async function resolvePlanCapabilitiesForUserId(params: {
  userId: string;
  policySnapshot?: { capabilitySnapshot?: unknown } | null;
}) {
  const workspaceId = await resolveWorkspaceIdForUserId(params.userId);
  const entitlements = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: workspaceId ?? "unknown"
  });
  const plan = normalizePlanTier(entitlements.plan);
  const resolved = await resolveCapabilitiesForPlan({
    plan,
    policySnapshot: params.policySnapshot ?? null
  });
  return {
    plan: resolved.plan,
    capabilities: resolved.capabilities,
    capabilitySnapshot: resolved.capabilitySnapshot
  };
}

function readUserFromLocals(res: express.Response): { id: string; email: string } {
  return getUserFromLocals(res);
}

async function requireSuperadmin(res: express.Response): Promise<boolean> {
  const user = readUserFromLocals(res);
  if (!(await hasAdminBackendAccess(user))) {
    res.status(403).json({ error: "forbidden", message: "admin_backend_access_required" });
    return false;
  }
  return true;
}

async function ensureAdminUserSeed() {
  const email = SUPERADMIN_EMAIL;
  const existing = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });

  let user = existing;
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD)
      },
      select: {
        id: true,
        email: true,
        passwordHash: true
      }
    });
    // eslint-disable-next-line no-console
    console.log(`[admin] created default admin user ${email}`);
  } else if (!user.passwordHash) {
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD)
      }
    });
  }

  const membership = await ensureWorkspaceMembership(user.id, user.email);
  const { adminRoleId } = await ensureDefaultRoles(membership.workspaceId);
  if (membership.roleId !== adminRoleId) {
    await db.workspaceMember.updateMany({
      where: {
        userId: user.id,
        workspaceId: membership.workspaceId
      },
      data: {
        roleId: adminRoleId
      }
    });
  }
}

function pickNumber(snapshot: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = Number(snapshot[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizePredictionTimeframe(value: unknown): PredictionTimeframe {
  if (typeof value === "string" && PREDICTION_TIMEFRAMES.has(value as PredictionTimeframe)) {
    return value as PredictionTimeframe;
  }
  return "15m";
}

function normalizePredictionMarketType(value: unknown): PredictionMarketType {
  if (typeof value === "string" && PREDICTION_MARKET_TYPES.has(value as PredictionMarketType)) {
    return value as PredictionMarketType;
  }
  return "perp";
}

function normalizePredictionSignal(value: unknown): PredictionSignal {
  if (typeof value === "string" && PREDICTION_SIGNALS.has(value as PredictionSignal)) {
    return value as PredictionSignal;
  }
  return "neutral";
}

function derivePredictionKeyDrivers(snapshot: Record<string, unknown>) {
  const preferred = [
    "atr_pct_rank_0_100",
    "ema_spread_abs_rank_0_100",
    "rsi",
    "emaSpread",
    "emaFast",
    "emaSlow",
    "macd",
    "atrPct",
    "volatility",
    "spreadBps",
    "liquidityScore",
    "fundingRate",
    "newsRisk"
  ];

  const out: Array<{ name: string; value: unknown }> = [];
  for (const key of preferred) {
    if (!(key in snapshot)) continue;
    out.push({ name: key, value: snapshot[key] });
    if (out.length >= 5) return out;
  }

  const fallbackKeys = Object.keys(snapshot).sort().slice(0, 5);
  for (const key of fallbackKeys) {
    out.push({ name: key, value: snapshot[key] });
  }
  return out.slice(0, 5);
}

function deriveSuggestedEntry(snapshot: Record<string, unknown>) {
  const rawType = String(
    snapshot.suggestedEntryType ??
      snapshot.entryType ??
      snapshot.orderType ??
      ""
  )
    .trim()
    .toLowerCase();

  const entryPrice = pickNumber(snapshot, [
    "suggestedEntryPrice",
    "entryPrice",
    "limitPrice",
    "entry"
  ]);

  if (rawType === "market") {
    return { type: "market" as const };
  }

  const inferredType = rawType === "limit" || entryPrice !== null ? "limit" : "market";
  if (inferredType === "limit") {
    return {
      type: "limit" as const,
      price: entryPrice ?? undefined
    };
  }
  return { type: "market" as const };
}

function derivePositionSizeHint(snapshot: Record<string, unknown>) {
  const raw = snapshot.positionSizeHint;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const modeValue = String((raw as any).mode ?? "").trim().toLowerCase();
    const value = Number((raw as any).value);
    if ((modeValue === "percent_balance" || modeValue === "fixed_quote") && Number.isFinite(value) && value > 0) {
      return {
        mode: modeValue as "percent_balance" | "fixed_quote",
        value
      };
    }
  }

  const percentValue = pickNumber(snapshot, ["positionSizePercent", "sizePercent", "balancePercent"]);
  if (percentValue !== null && percentValue > 0) {
    return {
      mode: "percent_balance" as const,
      value: percentValue
    };
  }

  const quoteValue = pickNumber(snapshot, ["positionSizeQuote", "sizeQuote", "sizeUsdt"]);
  if (quoteValue !== null && quoteValue > 0) {
    return {
      mode: "fixed_quote" as const,
      value: quoteValue
    };
  }

  return null;
}

function derivePredictionTrackingFromSnapshot(
  snapshot: Record<string, unknown>,
  timeframe: PredictionTimeframe
): {
  entryPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  horizonMs: number | null;
} {
  const entryPrice = pickNumber(snapshot, ["suggestedEntryPrice", "entryPrice", "entry"]);
  const stopLossPrice = pickNumber(snapshot, ["suggestedStopLoss", "stopLoss", "slPrice", "sl"]);
  const takeProfitPrice = pickNumber(snapshot, ["suggestedTakeProfit", "takeProfit", "tpPrice", "tp"]);
  const customHorizonMs = pickNumber(snapshot, ["horizonMs", "predictionHorizonMs"]);
  const horizonMs = customHorizonMs !== null
    ? Math.max(60_000, Math.trunc(customHorizonMs))
    : timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  return {
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    horizonMs
  };
}

type CandleBar = {
  ts: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type OhlcvSeriesRow = [number | null, number, number, number, number, number | null];

const AI_PROMPT_OHLCV_FORMAT = ["ts", "open", "high", "low", "close", "volume"] as const;

function readAiPromptOhlcvMaxBars(): number {
  const parsed = Number(process.env.AI_PROMPT_OHLCV_MAX_BARS ?? "500");
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(20, Math.min(500, Math.trunc(parsed)));
}

const AI_PROMPT_OHLCV_MAX_BARS = readAiPromptOhlcvMaxBars();

function readAiHistoryContextMaxEvents(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_MAX_EVENTS ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(5, Math.min(30, Math.trunc(parsed)));
}

function readAiHistoryContextLastBars(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_LAST_BARS ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(10, Math.min(30, Math.trunc(parsed)));
}

function readAiHistoryContextMaxBytes(): number {
  const parsed = Number(process.env.AI_HISTORY_CONTEXT_MAX_BYTES ?? "16384");
  if (!Number.isFinite(parsed)) return 16384;
  return Math.max(4096, Math.min(16384, Math.trunc(parsed)));
}

function readAiHistoryContextEnabled(): boolean {
  const raw = String(process.env.AI_HISTORY_CONTEXT_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

const AI_HISTORY_CONTEXT_OPTIONS = {
  enabled: readAiHistoryContextEnabled(),
  maxEvents: readAiHistoryContextMaxEvents(),
  lastBars: readAiHistoryContextLastBars(),
  maxBytes: readAiHistoryContextMaxBytes()
} as const;

function toRecordSafe(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBitgetCandles(value: unknown): CandleBar[] {
  const normalizeTs = (raw: number | null): number | null => {
    if (raw === null || !Number.isFinite(raw)) return null;
    return raw < 1_000_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
  };

  // MEXC packed format: { time:[], open:[], high:[], low:[], close:[], vol:[] }
  if (!Array.isArray(value)) {
    const packed = toRecordSafe(value);
    if (!packed) return [];

    const time = Array.isArray(packed.time) ? packed.time : [];
    const open = Array.isArray(packed.open) ? packed.open : [];
    const high = Array.isArray(packed.high) ? packed.high : [];
    const low = Array.isArray(packed.low) ? packed.low : [];
    const close = Array.isArray(packed.close) ? packed.close : [];
    const vol = Array.isArray(packed.vol) ? packed.vol : [];
    const size = Math.min(time.length, open.length, high.length, low.length, close.length);
    if (size <= 0) return [];

    const out: CandleBar[] = [];
    for (let i = 0; i < size; i += 1) {
      const o = asNumber(open[i]);
      const h = asNumber(high[i]);
      const l = asNumber(low[i]);
      const c = asNumber(close[i]);
      if (o === null || h === null || l === null || c === null) continue;
      out.push({
        ts: normalizeTs(asNumber(time[i])),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: asNumber(vol[i])
      });
    }
    out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    return out;
  }

  const out: CandleBar[] = [];

  for (const row of value) {
    if (Array.isArray(row)) {
      const ts = normalizeTs(asNumber(row[0]));
      const open = asNumber(row[1]);
      const high = asNumber(row[2]);
      const low = asNumber(row[3]);
      const close = asNumber(row[4]);
      const volume = asNumber(row[5]);
      if (open === null || high === null || low === null || close === null) continue;
      out.push({ ts, open, high, low, close, volume });
      continue;
    }

    const rec = toRecordSafe(row);
    if (!rec) continue;
    const open = asNumber(rec.open ?? rec.o);
    const high = asNumber(rec.high ?? rec.h);
    const low = asNumber(rec.low ?? rec.l);
    const close = asNumber(rec.close ?? rec.c);
    if (open === null || high === null || low === null || close === null) continue;
    out.push({
      ts: normalizeTs(asNumber(rec.ts ?? rec.t ?? rec.time ?? rec.timestamp ?? rec.T)),
      open,
      high,
      low,
      close,
      volume: asNumber(rec.volume ?? rec.v ?? rec.baseVolume)
    });
  }

  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return out;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildOhlcvSeriesFeature(
  candles: CandleBar[],
  timeframe: PredictionTimeframe
): {
  timeframe: PredictionTimeframe;
  format: readonly ["ts", "open", "high", "low", "close", "volume"];
  bars: OhlcvSeriesRow[];
  count: number;
} {
  const source = candles.slice(-AI_PROMPT_OHLCV_MAX_BARS);
  const bars: OhlcvSeriesRow[] = [];
  for (const row of source) {
    if (!Number.isFinite(row.open) || !Number.isFinite(row.high) || !Number.isFinite(row.low) || !Number.isFinite(row.close)) {
      continue;
    }
    const ts = Number.isFinite(row.ts) ? Math.trunc(Number(row.ts)) : null;
    const volume = Number.isFinite(row.volume) ? Number(Number(row.volume).toFixed(8)) : null;
    bars.push([
      ts,
      Number(row.open.toFixed(8)),
      Number(row.high.toFixed(8)),
      Number(row.low.toFixed(8)),
      Number(row.close.toFixed(8)),
      volume
    ]);
  }

  return {
    timeframe,
    format: AI_PROMPT_OHLCV_FORMAT,
    bars,
    count: bars.length
  };
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const delta = next - prev;
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function timeframeToBitgetGranularity(timeframe: PredictionTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

function marketTimeframeToBitgetGranularity(timeframe: "1m" | PredictionTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

function timeframeToIntervalMs(timeframe: PredictionTimeframe): number {
  if (timeframe === "5m") return 5 * 60 * 1000;
  if (timeframe === "15m") return 15 * 60 * 1000;
  if (timeframe === "1h") return 60 * 60 * 1000;
  if (timeframe === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

const SESSION_LOOKBACK_BUFFER_BARS = Math.max(
  1,
  Number(process.env.PRED_SESSION_LOOKBACK_BUFFER_BARS ?? 6)
);

function resolvePredictionCandleLookback(params: {
  timeframe: PredictionTimeframe;
  indicatorSettings: Parameters<typeof minimumCandlesForIndicatorsWithSettings>[1];
  baseMinBars: number;
  nowMs?: number;
}): number {
  const indicatorMinBars = minimumCandlesForIndicatorsWithSettings(
    params.timeframe,
    params.indicatorSettings
  );
  if (params.timeframe === "1d") {
    return Math.max(params.baseMinBars, indicatorMinBars);
  }
  const nowMs = params.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const sessionStartUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const intervalMs = timeframeToIntervalMs(params.timeframe);
  const elapsedMs = Math.max(0, nowMs - sessionStartUtcMs);
  const barsSinceSessionStart = Math.floor(elapsedMs / intervalMs) + 1;
  const sessionCoverageBars = barsSinceSessionStart + SESSION_LOOKBACK_BUFFER_BARS;

  return Math.max(params.baseMinBars, indicatorMinBars, sessionCoverageBars);
}

function normalizePredictionTimeframeCandidate(value: unknown): PredictionTimeframe | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as PredictionTimeframe;
  return PREDICTION_TIMEFRAMES.has(trimmed) ? trimmed : null;
}

function normalizePromptTimeframeSetForRuntime(
  settings: {
    timeframe?: unknown;
    timeframes?: unknown;
    runTimeframe?: unknown;
  } | null | undefined,
  fallbackTimeframe: PredictionTimeframe
): { timeframes: PredictionTimeframe[]; runTimeframe: PredictionTimeframe } {
  const out: PredictionTimeframe[] = [];
  const seen = new Set<PredictionTimeframe>();
  const pushTf = (value: unknown) => {
    const normalized = normalizePredictionTimeframeCandidate(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  if (settings && Array.isArray(settings.timeframes)) {
    for (const value of settings.timeframes) {
      pushTf(value);
      if (out.length >= 4) break;
    }
  }

  const legacyTimeframe = normalizePredictionTimeframeCandidate(settings?.timeframe);
  if (out.length === 0 && legacyTimeframe) {
    pushTf(legacyTimeframe);
  }

  let runTimeframe =
    normalizePredictionTimeframeCandidate(settings?.runTimeframe)
    ?? legacyTimeframe
    ?? fallbackTimeframe;
  if (!seen.has(runTimeframe)) {
    if (out.length >= 4) {
      runTimeframe = out[0];
    } else {
      out.push(runTimeframe);
      seen.add(runTimeframe);
    }
  }
  if (out.length === 0) {
    out.push(runTimeframe);
  }
  return { timeframes: out, runTimeframe };
}

async function buildMtfFramesForPrediction(params: {
  marketDataClient: PerpMarketDataClient;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframes: PredictionTimeframe[];
  runTimeframe: PredictionTimeframe;
  runFrame: {
    candles: CandleBar[];
    indicators: ReturnType<typeof computeIndicators>;
    advancedIndicators: ReturnType<typeof computeAdvancedIndicators>;
  };
}): Promise<{
  runTimeframe: PredictionTimeframe;
  timeframes: PredictionTimeframe[];
  frames: Record<string, Record<string, unknown>>;
}> {
  const dedupedTimeframes = normalizePromptTimeframeSetForRuntime(
    {
      timeframes: params.timeframes,
      runTimeframe: params.runTimeframe
    },
    params.runTimeframe
  ).timeframes;
  const frames: Record<string, Record<string, unknown>> = {};

  for (const timeframe of dedupedTimeframes) {
    let candles: CandleBar[];
    let indicators: ReturnType<typeof computeIndicators>;
    let advancedIndicators: ReturnType<typeof computeAdvancedIndicators>;

    if (timeframe === params.runTimeframe) {
      candles = params.runFrame.candles;
      indicators = params.runFrame.indicators;
      advancedIndicators = params.runFrame.advancedIndicators;
    } else {
      const indicatorSettingsResolution = await resolveIndicatorSettings({
        db,
        exchange: params.exchange,
        accountId: params.accountId,
        symbol: params.symbol,
        timeframe
      });
      const indicatorComputeSettings = toIndicatorComputeSettings(
        indicatorSettingsResolution.config
      );
      const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(
        indicatorSettingsResolution.config
      );
      const candleLookback = resolvePredictionCandleLookback({
        timeframe,
        indicatorSettings: indicatorComputeSettings,
        baseMinBars: 120
      });
      const candlesRaw = await params.marketDataClient.getCandles({
        symbol: params.symbol,
        timeframe,
        granularity: timeframeToBitgetGranularity(timeframe),
        limit: candleLookback
      });
      candles = bucketCandles(parseBitgetCandles(candlesRaw), timeframe);
      if (candles.length < 20) continue;
      indicators = computeIndicators(candles, timeframe, {
        exchange: params.exchange,
        symbol: params.symbol,
        marketType: params.marketType,
        logVwapMetrics: false,
        settings: indicatorComputeSettings
      });
      advancedIndicators = computeAdvancedIndicators(
        candles,
        timeframe,
        advancedIndicatorSettings
      );
    }

    const frameSnapshot: Record<string, unknown> = {
      timeframe,
      indicators,
      advancedIndicators,
      rsi: asNumber(indicators.rsi_14),
      atrPct: asNumber(indicators.atr_pct),
      ohlcvSeries: buildOhlcvSeriesFeature(candles, timeframe)
    };

    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: frameSnapshot,
      candles,
      timeframe,
      indicators,
      advancedIndicators,
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(frameSnapshot.riskFlags) ?? {};
      frameSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    frames[timeframe] = frameSnapshot;
  }

  const effectiveTimeframes = dedupedTimeframes.filter((timeframe) => Boolean(frames[timeframe]));
  if (!effectiveTimeframes.includes(params.runTimeframe)) {
    const runFrameSnapshot: Record<string, unknown> = {
      timeframe: params.runTimeframe,
      indicators: params.runFrame.indicators,
      advancedIndicators: params.runFrame.advancedIndicators,
      rsi: asNumber(params.runFrame.indicators.rsi_14),
      atrPct: asNumber(params.runFrame.indicators.atr_pct),
      ohlcvSeries: buildOhlcvSeriesFeature(params.runFrame.candles, params.runTimeframe)
    };
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: runFrameSnapshot,
      candles: params.runFrame.candles,
      timeframe: params.runTimeframe,
      indicators: params.runFrame.indicators,
      advancedIndicators: params.runFrame.advancedIndicators,
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (params.runFrame.advancedIndicators.dataGap) {
      const riskFlags = asRecord(runFrameSnapshot.riskFlags) ?? {};
      runFrameSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    frames[params.runTimeframe] = runFrameSnapshot;
    effectiveTimeframes.unshift(params.runTimeframe);
  }

  return {
    runTimeframe: params.runTimeframe,
    timeframes: effectiveTimeframes,
    frames
  };
}

type FeatureThresholdRecord = {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  windowFrom: Date;
  windowTo: Date;
  nBars: number;
  computedAt: Date;
  version: string;
  thresholdsJson: FeatureThresholdsJson;
};

type FeatureThresholdResolution = {
  thresholds: ResolvedFeatureThresholds;
  source: "db" | "fallback";
  computedAt: string | null;
  version: string;
  windowFrom: string | null;
  windowTo: string | null;
  nBars: number | null;
};

const featureThresholdCache = new Map<string, {
  expiresAt: number;
  row: FeatureThresholdRecord | null;
}>();

function featureThresholdKey(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}) {
  return [
    params.exchange.trim().toLowerCase(),
    normalizeSymbolInput(params.symbol) ?? params.symbol.trim().toUpperCase(),
    params.marketType,
    params.timeframe
  ].join(":");
}

async function readLatestFeatureThresholdRow(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): Promise<FeatureThresholdRecord | null> {
  const key = featureThresholdKey(params);
  const now = Date.now();
  const cached = featureThresholdCache.get(key);
  if (cached && cached.expiresAt > now) return cached.row;

  const row = await db.featureThreshold.findFirst({
    where: {
      exchange: params.exchange.trim().toLowerCase(),
      accountScope: "global",
      symbol: (normalizeSymbolInput(params.symbol) ?? params.symbol.trim().toUpperCase()),
      marketType: params.marketType,
      timeframe: params.timeframe
    },
    orderBy: { computedAt: "desc" },
    select: {
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      windowFrom: true,
      windowTo: true,
      nBars: true,
      computedAt: true,
      version: true,
      thresholdsJson: true
    }
  });

  const normalized = row
    ? {
        exchange: row.exchange,
        symbol: row.symbol,
        marketType: normalizePredictionMarketType(row.marketType),
        timeframe: normalizePredictionTimeframe(row.timeframe),
        windowFrom: row.windowFrom,
        windowTo: row.windowTo,
        nBars: Number(row.nBars),
        computedAt: row.computedAt,
        version: String(row.version ?? FEATURE_THRESHOLD_VERSION),
        thresholdsJson: asRecord(row.thresholdsJson) as FeatureThresholdsJson
      }
    : null;

  featureThresholdCache.set(key, {
    expiresAt: now + FEATURE_THRESHOLDS_CACHE_TTL_MS,
    row: normalized
  });
  return normalized;
}

function setFeatureThresholdCacheRow(row: FeatureThresholdRecord) {
  featureThresholdCache.set(featureThresholdKey({
    exchange: row.exchange,
    symbol: row.symbol,
    marketType: row.marketType,
    timeframe: row.timeframe
  }), {
    expiresAt: Date.now() + FEATURE_THRESHOLDS_CACHE_TTL_MS,
    row
  });
}

async function resolveFeatureThresholds(params: {
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): Promise<FeatureThresholdResolution> {
  const row = await readLatestFeatureThresholdRow(params);
  if (!row) {
    return {
      thresholds: fallbackFeatureThresholds(),
      source: "fallback",
      computedAt: null,
      version: FEATURE_THRESHOLD_VERSION,
      windowFrom: null,
      windowTo: null,
      nBars: null
    };
  }

  const parsed = readFeatureThresholds(row.thresholdsJson);
  if (!parsed) {
    return {
      thresholds: fallbackFeatureThresholds(),
      source: "fallback",
      computedAt: toIso(row.computedAt),
      version: row.version,
      windowFrom: toIso(row.windowFrom),
      windowTo: toIso(row.windowTo),
      nBars: row.nBars
    };
  }

  return {
    thresholds: parsed,
    source: "db",
    computedAt: toIso(row.computedAt),
    version: row.version,
    windowFrom: toIso(row.windowFrom),
    windowTo: toIso(row.windowTo),
    nBars: row.nBars
  };
}

function computeAtrPctSeries(candles: CandleBar[], period = 14): number[] {
  const trValues: number[] = [];
  const out: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1]?.close;
    const bar = candles[i];
    if (!bar || !Number.isFinite(prevClose) || !Number.isFinite(bar.close) || bar.close <= 0) continue;
    const tr = Math.max(
      Math.abs(bar.high - bar.low),
      Math.abs(bar.high - (prevClose as number)),
      Math.abs(bar.low - (prevClose as number))
    );
    trValues.push(tr);
    if (trValues.length > period) trValues.shift();
    if (trValues.length === period) {
      out.push(average(trValues) / bar.close);
    }
  }
  return out;
}

function computeAbsEmaSpreadSeries(candles: CandleBar[], fast = 12, slow = 26): number[] {
  const out: number[] = [];
  const fastK = 2 / (fast + 1);
  const slowK = 2 / (slow + 1);
  let emaFast: number | null = null;
  let emaSlow: number | null = null;

  for (const bar of candles) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    emaFast = emaFast === null ? bar.close : bar.close * fastK + emaFast * (1 - fastK);
    emaSlow = emaSlow === null ? bar.close : bar.close * slowK + emaSlow * (1 - slowK);
    if (emaSlow !== null && emaSlow !== 0 && emaFast !== null) {
      out.push(Math.abs((emaFast - emaSlow) / emaSlow));
    }
  }

  return out;
}

function computeGapRatio(timeframe: PredictionTimeframe, windowMs: number, nBars: number): number {
  const expectedBars = expectedBarsForWindow(timeframe as ThresholdTimeframe, windowMs);
  if (expectedBars <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - nBars / Math.max(1, expectedBars)));
}

function isDailyCalibrationTime(now: Date): boolean {
  return now.getUTCHours() === 2 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() < 25;
}

function isoWeekBucket(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function isWeeklyCalibrationTime(now: Date): boolean {
  return now.getUTCDay() === 0 && now.getUTCHours() === 3 && now.getUTCMinutes() < 15;
}

type PredictionQualityContext = {
  sampleSize: number;
  winRatePct: number | null;
  avgOutcomePnlPct: number | null;
  tpCount: number;
  slCount: number;
  expiredCount: number;
};

async function getPredictionQualityContext(
  userId: string,
  symbol: string,
  timeframe: PredictionTimeframe,
  marketType: PredictionMarketType
): Promise<PredictionQualityContext> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol,
      timeframe,
      marketType,
      outcomeStatus: "closed"
    },
    orderBy: { tsCreated: "desc" },
    take: 100,
    select: {
      outcomeResult: true,
      outcomePnlPct: true
    }
  });

  let tpCount = 0;
  let slCount = 0;
  let expiredCount = 0;
  let pnlSum = 0;
  let pnlCount = 0;

  for (const row of rows) {
    const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
    if (result === "tp_hit") tpCount += 1;
    else if (result === "sl_hit") slCount += 1;
    else if (result === "expired") expiredCount += 1;

    const pnl = Number(row.outcomePnlPct);
    if (Number.isFinite(pnl)) {
      pnlSum += pnl;
      pnlCount += 1;
    }
  }

  const sampleSize = rows.length;
  const winRatePct = sampleSize > 0 ? Number(((tpCount / sampleSize) * 100).toFixed(2)) : null;
  const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;

  return {
    sampleSize,
    winRatePct,
    avgOutcomePnlPct,
    tpCount,
    slCount,
    expiredCount
  };
}

function deriveSignalFromScore(
  score: number,
  threshold: number,
  directionPreference: DirectionPreference
): PredictionSignal {
  let adjustedScore = score;
  if (directionPreference === "long") adjustedScore = Math.max(0, adjustedScore);
  if (directionPreference === "short") adjustedScore = Math.min(0, adjustedScore);

  if (adjustedScore > threshold) return "up";
  if (adjustedScore < -threshold) return "down";
  return "neutral";
}

function inferPredictionFromMarket(params: {
  closes: number[];
  highs: number[];
  lows: number[];
  indicators: IndicatorsSnapshot;
  referencePrice: number;
  timeframe: PredictionTimeframe;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage?: number;
  marketType: PredictionMarketType;
  exchangeAccountId: string;
  exchange: string;
  thresholdResolution: FeatureThresholdResolution;
}): {
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  featureSnapshot: Record<string, unknown>;
  tracking: {
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    horizonMs: number;
  };
} {
  const closes = params.closes;
  const highs = params.highs;
  const lows = params.lows;
  const last = closes[closes.length - 1] ?? params.referencePrice;
  const prev5 = closes[Math.max(0, closes.length - 6)] ?? last;
  const momentum = prev5 > 0 ? (last - prev5) / prev5 : 0;

  const sma20 = average(closes.slice(-20));
  const emaSpread = sma20 > 0 ? (last - sma20) / sma20 : 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (prev > 0 && next > 0) returns.push((next - prev) / prev);
  }
  const volatility = stddev(returns.slice(-30));
  const atrProxyFallback = average(
    highs.slice(-20).map((high, idx) => {
      const low = lows.slice(-20)[idx] ?? high;
      if (last <= 0) return 0;
      return Math.abs(high - low) / last;
    })
  );
  const atrProxy = typeof params.indicators.atr_pct === "number"
    ? params.indicators.atr_pct
    : atrProxyFallback;
  const absEmaSpread = Math.abs(emaSpread);

  const rawScore = emaSpread * 0.65 + momentum * 0.35;
  const threshold = 0.0008 + volatility * 0.25;
  let signal = deriveSignalFromScore(rawScore, threshold, params.directionPreference);

  const confidencePrePenalty = clamp(
    0.3 + (Math.abs(rawScore) / Math.max(0.0004, threshold + volatility)) * 0.5,
    0.05,
    0.95
  );
  const confidenceRaw = applyConfidencePenalty({
    baseConfidence: confidencePrePenalty,
    atrPct: atrProxy,
    emaSpreadPct: emaSpread,
    thresholds: params.thresholdResolution.thresholds
  });
  const targetConfidence = clamp(params.confidenceTargetPct / 100, 0, 1);
  const confidence = confidenceRaw >= targetConfidence ? confidenceRaw : Math.max(0.2, confidenceRaw * 0.85);

  if (confidenceRaw < targetConfidence) {
    signal = "neutral";
  }

  const expectedMovePct = clamp((Math.abs(momentum) + Math.max(volatility, atrProxy) * 1.2) * 100, 0.1, 6);
  const referencePrice = params.referencePrice > 0 ? params.referencePrice : last;
  const entryPrice = signal === "down"
    ? referencePrice * (1 + 0.0005)
    : referencePrice * (1 - 0.0005);
  const slMultiplier = Math.max(0.004, volatility * 1.7 + 0.0025);
  const tpMultiplier = Math.max(expectedMovePct / 100, volatility * 2.2 + 0.003);
  const suggestedStopLoss = signal === "down"
    ? referencePrice * (1 + slMultiplier)
    : referencePrice * (1 - slMultiplier);
  const suggestedTakeProfit = signal === "down"
    ? referencePrice * (1 - tpMultiplier)
    : referencePrice * (1 + tpMultiplier);

  const rsi = typeof params.indicators.rsi_14 === "number"
    ? params.indicators.rsi_14
    : computeRsi(closes);
  const sizePercent = clamp(Math.round((confidence * 100) * 0.35), 10, 35);
  const horizonMs = timeframeToIntervalMs(params.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
  const tags = deriveRegimeTags({
    signal,
    atrPct: atrProxy,
    emaSpreadPct: emaSpread,
    rsi,
    thresholds: params.thresholdResolution.thresholds
  });
  const atrPctRank = percentileRankFromBands(atrProxy, params.thresholdResolution.thresholds.atrPct);
  const emaSpreadAbsRank = percentileRankFromBands(
    absEmaSpread,
    params.thresholdResolution.thresholds.absEmaSpreadPct
  );

  return {
    prediction: {
      signal,
      expectedMovePct: Number(expectedMovePct.toFixed(2)),
      confidence: Number(confidence.toFixed(4))
    },
    featureSnapshot: {
      rsi: rsi !== null ? Number(rsi.toFixed(2)) : null,
      emaSpread: Number(emaSpread.toFixed(6)),
      momentum: Number(momentum.toFixed(6)),
      volatility: Number(volatility.toFixed(6)),
      atrPct: Number(atrProxy.toFixed(6)),
      atr_pct_rank_0_100: atrPctRank !== null ? Number(atrPctRank.toFixed(2)) : null,
      ema_spread_abs_rank_0_100:
        emaSpreadAbsRank !== null ? Number(emaSpreadAbsRank.toFixed(2)) : null,
      indicators: params.indicators,
      thresholdSource: params.thresholdResolution.source,
      thresholdVersion: params.thresholdResolution.version,
      thresholdComputedAt: params.thresholdResolution.computedAt,
      thresholdWindowFrom: params.thresholdResolution.windowFrom,
      thresholdWindowTo: params.thresholdResolution.windowTo,
      thresholdBars: params.thresholdResolution.nBars,
      suggestedEntryType: "market",
      suggestedEntryPrice: Number(entryPrice.toFixed(2)),
      suggestedStopLoss: Number(suggestedStopLoss.toFixed(2)),
      suggestedTakeProfit: Number(suggestedTakeProfit.toFixed(2)),
      positionSizeHint: {
        mode: "percent_balance",
        value: sizePercent
      },
      requestedLeverage: params.marketType === "perp" ? params.leverage ?? 1 : null,
      directionPreference: params.directionPreference,
      confidenceTargetPct: params.confidenceTargetPct,
      prefillExchangeAccountId: params.exchangeAccountId,
      prefillExchange: params.exchange,
      tags,
      ...(params.indicators.dataGap ? { riskFlags: { dataGap: true } } : {})
    },
    tracking: {
      entryPrice: Number(entryPrice.toFixed(2)),
      stopLossPrice: Number(suggestedStopLoss.toFixed(2)),
      takeProfitPrice: Number(suggestedTakeProfit.toFixed(2)),
      horizonMs
    }
  };
}

type PredictionGenerateAutoInput = {
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  leverage?: number;
  modelVersionBase?: string;
  aiPromptTemplateId?: string | null;
  compositeStrategyId?: string | null;
  strategyRef?: {
    kind: "ai" | "local" | "composite";
    id: string;
  } | null;
};

function parseDirectionPreference(value: unknown): DirectionPreference {
  if (value === "long" || value === "short" || value === "either") return value;
  return "either";
}

async function generateAutoPredictionForUser(
  userId: string,
  payload: PredictionGenerateAutoInput,
  options?: {
    isSuperadmin?: boolean;
    hasAdminBackendAccess?: boolean;
    userEmail?: string;
  }
): Promise<{
  persisted: boolean;
  prediction: { signal: PredictionSignal; expectedMovePct: number; confidence: number };
  timeframe: PredictionTimeframe;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  signalSource: PredictionSignalSource;
  signalMode: PredictionSignalMode;
  explanation: Awaited<ReturnType<typeof generateAndPersistPrediction>>["explanation"];
  modelVersion: string;
  predictionId: string | null;
  tsCreated: string;
  aiPromptTemplateId: string | null;
  aiPromptTemplateName: string | null;
  localStrategyId: string | null;
  localStrategyName: string | null;
  compositeStrategyId: string | null;
  compositeStrategyName: string | null;
  strategyRef: PredictionStrategyRef | null;
  existing?: boolean;
  existingStateId?: string | null;
}> {
  const predictionMarketRuntime = await createResolvedPollingPerpMarketDataRuntime(
    userId,
    payload.exchangeAccountId,
    "prediction/generate-auto"
  );
  const account = predictionMarketRuntime.context.selectedAccount;
  const perpClient = predictionMarketRuntime.client;

  try {
    const requestIsSuperadmin = Boolean(options?.isSuperadmin);
    const canonicalSymbol = normalizeSymbolInput(payload.symbol);
    if (!canonicalSymbol) {
      throw new ManualTradingError("symbol_required", 400, "symbol_required");
    }
    const predictionDefaults = await getPredictionDefaultsSettings();
    const defaultSignalMode = predictionDefaults.signalMode;
    const requestedTimeframe = payload.timeframe;
    const promptScopeContextDraft = {
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      timeframe: requestedTimeframe
    };
    const payloadStrategyKind = normalizePredictionStrategyKind(payload.strategyRef?.kind);
    const payloadStrategyId =
      typeof payload.strategyRef?.id === "string" && payload.strategyRef.id.trim()
        ? payload.strategyRef.id.trim()
        : null;
    const requestedPromptTemplateId =
      payloadStrategyKind === "ai"
        ? payloadStrategyId
        : (typeof payload.aiPromptTemplateId === "string" && payload.aiPromptTemplateId.trim()
            ? payload.aiPromptTemplateId.trim()
            : null);
    const requestedLocalStrategyId =
      payloadStrategyKind === "local"
        ? payloadStrategyId
        : null;
    const requestedCompositeStrategyId =
      payloadStrategyKind === "composite"
        ? payloadStrategyId
        : (typeof payload.compositeStrategyId === "string" && payload.compositeStrategyId.trim()
            ? payload.compositeStrategyId.trim()
            : null);
    const selectedLocalStrategy = requestedLocalStrategyId
      ? await getEnabledLocalStrategyById(requestedLocalStrategyId)
      : null;
    const selectedCompositeStrategy = requestedCompositeStrategyId
      ? await getEnabledCompositeStrategyById(requestedCompositeStrategyId)
      : null;
    let selectedStrategyRef: PredictionStrategyRef | null =
      selectedCompositeStrategy
        ? { kind: "composite", id: selectedCompositeStrategy.id, name: selectedCompositeStrategy.name }
        : selectedLocalStrategy
          ? { kind: "local", id: selectedLocalStrategy.id, name: selectedLocalStrategy.name }
          : requestedPromptTemplateId
            ? { kind: "ai", id: requestedPromptTemplateId, name: null }
            : null;
    const signalMode = resolveStrategyBoundSignalMode(
      defaultSignalMode,
      selectedStrategyRef?.kind ?? "ai"
    );
    if (requestedLocalStrategyId && !selectedLocalStrategy) {
      throw new ManualTradingError(
        "Selected local strategy is not available.",
        400,
        "invalid_local_strategy"
      );
    }
    if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
      throw new ManualTradingError(
        "Selected composite strategy is not available.",
        400,
        "invalid_composite_strategy"
      );
    }
    const workspaceId = await resolveWorkspaceIdForUserId(userId);
    const strategyEntitlements = await resolveStrategyEntitlementsForWorkspace({
      workspaceId: workspaceId ?? "unknown"
    });
    const requestedPromptSelection = requestedPromptTemplateId
      ? await resolveAiPromptRuntimeForUserSelection({
          userId,
          templateId: requestedPromptTemplateId,
          context: promptScopeContextDraft,
          requirePublicGlobalPrompt: !requestIsSuperadmin
        })
      : null;
    if (requestedPromptTemplateId && !requestedPromptSelection) {
      throw new ManualTradingError(
        "Selected AI prompt is not available.",
        400,
        "invalid_ai_prompt_template"
      );
    }
    const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
    if (selectedPromptIsOwn) {
      const strategyFeatureEnabled = options?.userEmail
        ? await isStrategyFeatureEnabledForUser({
            id: userId,
            email: options.userEmail
          })
        : (
            Boolean(options?.hasAdminBackendAccess || options?.isSuperadmin)
            || Boolean((await getAccessSectionSettings()).visibility.strategy)
          );
      if (!strategyFeatureEnabled) {
        throw new ManualTradingError(
          "Own strategies are currently disabled by access settings.",
          403,
          "forbidden"
        );
      }
    }
    if (selectedStrategyRef?.kind === "ai" && requestedPromptSelection?.templateName) {
      selectedStrategyRef = {
        ...selectedStrategyRef,
        name: requestedPromptSelection.templateName
      };
    }
    const selectedKind: "ai" | "local" | "composite" =
      selectedStrategyRef?.kind ?? "ai";
    const predictionLimitBucket = resolvePredictionLimitBucketFromStrategy({
      strategyRef: selectedStrategyRef,
      signalMode
    });
    const selectedId =
      selectedStrategyRef?.id
      ?? (
        selectedKind === "ai"
          ? (selectedPromptIsOwn ? null : (requestedPromptTemplateId ?? "default"))
          : null
      );
    const strategyAccess = evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: selectedKind,
      strategyId: selectedId,
      aiModel: selectedKind === "ai" ? await getAiModelAsync() : null,
      compositeNodes:
        selectedKind === "composite"
          ? countCompositeStrategyNodes(selectedCompositeStrategy)
          : null
    });
    if (!strategyAccess.allowed) {
      throw new ManualTradingError(
        "Selected strategy is blocked by license entitlements.",
        403,
        `strategy_license_blocked:${strategyAccess.reason}`
      );
    }
    const promptLicenseDecision = selectedPromptIsOwn
      ? {
          allowed: true,
          reason: "ok" as const,
          mode: "off" as const,
          wouldBlock: false
        }
      : evaluateAiPromptAccess({
          userId,
          selectedPromptId: requestedPromptTemplateId
        });
    if (!promptLicenseDecision.allowed) {
      throw new ManualTradingError(
        "Selected AI prompt is blocked by license policy.",
        403,
        "ai_prompt_license_blocked"
      );
    }
    if (promptLicenseDecision.wouldBlock) {
      // eslint-disable-next-line no-console
      console.warn("[license] ai prompt selection would be blocked in enforce mode", {
        userId,
        selectedPromptId: requestedPromptTemplateId,
        mode: promptLicenseDecision.mode
      });
    }
    const selectedPromptSettings = requestedPromptTemplateId
      ? requestedPromptSelection?.runtimeSettings ?? null
      : await getAiPromptRuntimeSettings(promptScopeContextDraft);
    if (requestedPromptTemplateId && !selectedPromptSettings) {
      throw new ManualTradingError(
        "Selected AI prompt is not available.",
        400,
        "invalid_ai_prompt_template"
      );
    }
    const promptTimeframeConfig = normalizePromptTimeframeSetForRuntime(
      selectedPromptSettings,
      requestedTimeframe
    );
    const allowPromptTimeframeOverride =
      !selectedStrategyRef || selectedStrategyRef.kind === "ai";
    const effectiveTimeframe = (
      allowPromptTimeframeOverride
        ? promptTimeframeConfig.runTimeframe
        : requestedTimeframe
    ) as PredictionTimeframe;
    const effectivePromptTimeframes = allowPromptTimeframeOverride
      ? promptTimeframeConfig.timeframes
      : [requestedTimeframe];
    const effectiveDirectionPreference = parseDirectionPreference(
      selectedPromptSettings?.directionPreference
    );
    const effectiveConfidenceTargetPct = clamp(
      Number(selectedPromptSettings?.confidenceTargetPct ?? 60),
      0,
      100
    );
    const promptScopeContext = {
      ...promptScopeContextDraft,
      timeframe: effectiveTimeframe
    };
    const requestedStrategyRefForScope: PredictionStrategyRef | null =
      selectedStrategyRef?.kind === "ai"
        ? {
            kind: "ai",
            id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
            name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
          }
        : selectedStrategyRef;
    const existingStateId = await findPredictionStateIdByScope({
      userId,
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      strategyRef: requestedStrategyRefForScope
    });
    if (existingStateId) {
      const existingState = await db.predictionState.findUnique({
        where: { id: existingStateId },
        select: {
          id: true,
          timeframe: true,
          signalMode: true,
          signal: true,
          expectedMovePct: true,
          confidence: true,
          explanation: true,
          tags: true,
          keyDrivers: true,
          featuresSnapshot: true,
          modelVersion: true,
          tsUpdated: true,
          directionPreference: true,
          confidenceTargetPct: true
        }
      });
      if (existingState) {
        const existingSnapshot = asRecord(existingState.featuresSnapshot);
        const existingStrategyRef = readPredictionStrategyRef(existingSnapshot);
        const existingSignal: PredictionSignal =
          existingState.signal === "up" || existingState.signal === "down" || existingState.signal === "neutral"
            ? existingState.signal
            : "neutral";
        const existingExpectedMovePct = Number.isFinite(Number(existingState.expectedMovePct))
          ? Number(clamp(Math.abs(Number(existingState.expectedMovePct)), 0, 25).toFixed(2))
          : 0;
        const existingConfidence = Number.isFinite(Number(existingState.confidence))
          ? Number(clamp(Number(existingState.confidence), 0, 1).toFixed(4))
          : 0;
        const existingTimeframe = normalizePredictionTimeframeCandidate(existingState.timeframe)
          ?? effectiveTimeframe;
        const existingSignalMode = normalizePredictionSignalMode(existingState.signalMode);
        const existingSignalSource = readSelectedSignalSource(existingSnapshot);
        const existingAiPrediction =
          readAiPredictionSnapshot(existingSnapshot)
          ?? {
            signal: existingSignal,
            expectedMovePct: existingExpectedMovePct,
            confidence: existingConfidence
          };
        const existingTags = normalizeTagList(existingState.tags);
        const existingKeyDrivers = normalizeKeyDriverList(existingState.keyDrivers);
        return {
          persisted: false,
          existing: true,
          existingStateId: existingState.id,
          prediction: {
            signal: existingSignal,
            expectedMovePct: existingExpectedMovePct,
            confidence: existingConfidence
          },
          timeframe: existingTimeframe,
          directionPreference: parseDirectionPreference(existingState.directionPreference),
          confidenceTargetPct: Number.isFinite(Number(existingState.confidenceTargetPct))
            ? clamp(Number(existingState.confidenceTargetPct), 0, 100)
            : effectiveConfidenceTargetPct,
          signalSource: existingSignalSource,
          signalMode: existingSignalMode,
          explanation: {
            explanation:
              typeof existingState.explanation === "string" && existingState.explanation.trim()
                ? existingState.explanation
                : "Existing prediction schedule reused for this scope.",
            tags: existingTags,
            keyDrivers: existingKeyDrivers,
            aiPrediction: existingAiPrediction,
            disclaimer: "grounded_features_only"
          },
          modelVersion: existingState.modelVersion,
          predictionId: null,
          tsCreated: existingState.tsUpdated.toISOString(),
          aiPromptTemplateId: readAiPromptTemplateId(existingSnapshot),
          aiPromptTemplateName: readAiPromptTemplateName(existingSnapshot),
          localStrategyId: readLocalStrategyId(existingSnapshot),
          localStrategyName: readLocalStrategyName(existingSnapshot),
          compositeStrategyId: readCompositeStrategyId(existingSnapshot),
          compositeStrategyName: readCompositeStrategyName(existingSnapshot),
          strategyRef: existingStrategyRef
        };
      }
    }
    const predictionCreateAccess = await canCreatePredictionForUser({
      userId,
      bypass: Boolean(options?.hasAdminBackendAccess || options?.isSuperadmin),
      bucket: predictionLimitBucket,
      existingStateId,
      consumesSlot: true
    });
    if (!predictionCreateAccess.allowed) {
      const code = predictionCreateAccess.code ?? "prediction_create_limit_exceeded";
      throw new ManualTradingError(
        code,
        403,
        code
      );
    }
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      symbol: canonicalSymbol,
      timeframe: effectiveTimeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);
    const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(indicatorSettingsResolution.config);

    const candleLookback = resolvePredictionCandleLookback({
      timeframe: effectiveTimeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 120
    });
    const [tickerRaw, candlesRaw] = await Promise.all([
      perpClient.getTicker(canonicalSymbol),
      perpClient.getCandles({
        symbol: canonicalSymbol,
        timeframe: effectiveTimeframe,
        granularity: timeframeToBitgetGranularity(effectiveTimeframe),
        limit: candleLookback
      })
    ]);

    const candles = parseBitgetCandles(candlesRaw);
    const alignedCandles = bucketCandles(candles, effectiveTimeframe);
    if (alignedCandles.length < 20) {
      throw new ManualTradingError(
        "Not enough candle data to generate prediction.",
        422,
        "insufficient_market_data"
      );
    }

    const closes = alignedCandles.map((row) => row.close);
    const highs = alignedCandles.map((row) => row.high);
    const lows = alignedCandles.map((row) => row.low);
    const indicators = computeIndicators(alignedCandles, effectiveTimeframe, {
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      logVwapMetrics: true,
      settings: indicatorComputeSettings
    });
    const advancedIndicators = computeAdvancedIndicators(
      alignedCandles,
      effectiveTimeframe,
      advancedIndicatorSettings
    );
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      throw new ManualTradingError(
        "Cannot determine reference price from market data.",
        422,
        "invalid_reference_price"
      );
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: effectiveTimeframe,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      leverage: payload.leverage,
      marketType: payload.marketType,
      exchangeAccountId: payload.exchangeAccountId,
      exchange: account.exchange,
      thresholdResolution
    });

    const quality = await getPredictionQualityContext(
      userId,
      canonicalSymbol,
      effectiveTimeframe,
      payload.marketType
    );
    const newsBlackout = await evaluateNewsRiskForSymbol({
      db,
      symbol: canonicalSymbol,
      now: new Date()
    });

    inferred.featureSnapshot.autoScheduleEnabled = true;
    inferred.featureSnapshot.autoSchedulePaused = false;
    inferred.featureSnapshot.directionPreference = effectiveDirectionPreference;
    inferred.featureSnapshot.confidenceTargetPct = effectiveConfidenceTargetPct;
    inferred.featureSnapshot.promptTimeframe =
      selectedPromptSettings?.runTimeframe
      ?? selectedPromptSettings?.timeframe
      ?? null;
    inferred.featureSnapshot.promptTimeframes = effectivePromptTimeframes;
    inferred.featureSnapshot.promptSlTpSource = selectedPromptSettings?.slTpSource ?? "local";
    inferred.featureSnapshot.promptRunTimeframe = allowPromptTimeframeOverride
      ? effectiveTimeframe
      : null;
    inferred.featureSnapshot.requestedTimeframe = requestedTimeframe;
    inferred.featureSnapshot.requestedLeverage = payload.leverage ?? null;
    inferred.featureSnapshot.prefillExchangeAccountId = payload.exchangeAccountId;
    inferred.featureSnapshot.prefillExchange = account.exchange;
    inferred.featureSnapshot.qualityWinRatePct = quality.winRatePct;
    inferred.featureSnapshot.qualitySampleSize = quality.sampleSize;
    inferred.featureSnapshot.qualityAvgOutcomePnlPct = quality.avgOutcomePnlPct;
    inferred.featureSnapshot.qualityTpCount = quality.tpCount;
    inferred.featureSnapshot.qualitySlCount = quality.slCount;
    inferred.featureSnapshot.qualityExpiredCount = quality.expiredCount;
    inferred.featureSnapshot.advancedIndicators = advancedIndicators;
    inferred.featureSnapshot.ohlcvSeries = buildOhlcvSeriesFeature(
      alignedCandles,
      effectiveTimeframe
    );
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: inferred.featureSnapshot,
      candles: alignedCandles,
      timeframe: effectiveTimeframe,
      indicators,
      advancedIndicators,
      exchange: account.exchange,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    if (allowPromptTimeframeOverride && effectivePromptTimeframes.length > 0) {
      inferred.featureSnapshot.mtf = await buildMtfFramesForPrediction({
        marketDataClient: perpClient,
        exchange: account.exchange,
        accountId: payload.exchangeAccountId,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframes: effectivePromptTimeframes,
        runTimeframe: effectiveTimeframe,
        runFrame: {
          candles: alignedCandles,
          indicators,
          advancedIndicators
        }
      });
    } else {
      delete inferred.featureSnapshot.mtf;
    }
    inferred.featureSnapshot.aiPromptTemplateRequestedId = requestedPromptTemplateId;
    inferred.featureSnapshot.aiPromptTemplateId =
      selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId;
    inferred.featureSnapshot.aiPromptTemplateName =
      selectedPromptSettings?.activePromptName ?? null;
    inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled =
      selectedStrategyRef?.kind === "ai"
        ? Boolean(selectedPromptSettings?.marketAnalysisUpdateEnabled)
        : false;
    inferred.featureSnapshot.localStrategyId = selectedLocalStrategy?.id ?? null;
    inferred.featureSnapshot.localStrategyName = selectedLocalStrategy?.name ?? null;
    inferred.featureSnapshot.aiPromptLicenseMode = promptLicenseDecision.mode;
    inferred.featureSnapshot.aiPromptLicenseWouldBlock = promptLicenseDecision.wouldBlock;
    inferred.featureSnapshot.compositeStrategyId = requestedCompositeStrategyId ?? null;
    inferred.featureSnapshot.compositeStrategyName = selectedCompositeStrategy?.name ?? null;
    inferred.featureSnapshot.strategyRef = selectedStrategyRef
      ? { kind: selectedStrategyRef.kind, id: selectedStrategyRef.id, name: selectedStrategyRef.name }
      : null;
    const strategyRefForInitialSnapshot: PredictionStrategyRef | null =
      selectedStrategyRef?.kind === "ai"
        ? {
            kind: "ai",
            id: selectedPromptSettings?.activePromptId ?? selectedStrategyRef.id,
            name: selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name
          }
        : selectedStrategyRef;
    inferred.featureSnapshot = withStrategyRunSnapshot(
      inferred.featureSnapshot,
      {
        strategyRef: strategyRefForInitialSnapshot,
        status: "skipped",
        signal: inferred.prediction.signal,
        expectedMovePct: inferred.prediction.expectedMovePct,
        confidence: inferred.prediction.confidence,
        source: resolvePreferredSignalSourceForMode(
          signalMode,
          PREDICTION_PRIMARY_SIGNAL_SOURCE
        ),
        aiCalled: false,
        explanation: "Initial prediction created; strategy runner will apply on refresh cycle.",
        tags: normalizeTagList(inferred.featureSnapshot.tags),
        keyDrivers: [],
        ts: new Date().toISOString()
      },
      {
        phase: "initial_generate",
        strategyRef: strategyRefForInitialSnapshot
      }
    );
    inferred.featureSnapshot.meta = {
      ...(asRecord(inferred.featureSnapshot.meta) ?? {}),
      indicatorSettingsHash: indicatorSettingsResolution.hash
    };
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(inferred.featureSnapshot.riskFlags) ?? {};
      inferred.featureSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    inferred.featureSnapshot = applyNewsRiskToFeatureSnapshot(
      inferred.featureSnapshot,
      newsBlackout
    );
    const globalNewsRiskBlockEnabled = await readGlobalNewsRiskEnforcement();
    const strategyNewsRiskMode = resolveStrategyNewsRiskMode({
      strategyRef: strategyRefForInitialSnapshot,
      promptSettings: selectedPromptSettings,
      localStrategy: selectedLocalStrategy,
      compositeStrategy: selectedCompositeStrategy
    });
    const newsRiskBlocked = shouldBlockByNewsRisk({
      featureSnapshot: inferred.featureSnapshot,
      globalEnabled: globalNewsRiskBlockEnabled,
      strategyMode: strategyNewsRiskMode
    });
    if (newsRiskBlocked) {
      inferred.featureSnapshot = withStrategyRunSnapshot(
        inferred.featureSnapshot,
        {
          strategyRef: strategyRefForInitialSnapshot,
          status: "fallback",
          signal: "neutral",
          expectedMovePct: 0,
          confidence: 0,
          source: resolvePreferredSignalSourceForMode(
            signalMode,
            PREDICTION_PRIMARY_SIGNAL_SOURCE
          ),
          aiCalled: false,
          explanation: "News blackout active; setup suspended.",
          tags: ["news_risk"],
          keyDrivers: [
            { name: "featureSnapshot.newsRisk", value: true },
            { name: "policy.reasonCode", value: "news_risk_blocked" }
          ],
          ts: new Date().toISOString()
        },
        {
          phase: "initial_generate",
          strategyRef: strategyRefForInitialSnapshot,
          reasonCode: "news_risk_blocked",
          strategyNewsRiskMode
        }
      );
    }

    const tsCreated = new Date().toISOString();
    const selectedSignalSource = resolvePreferredSignalSourceForMode(
      signalMode,
      PREDICTION_PRIMARY_SIGNAL_SOURCE
    );
    const created = await generateAndPersistPrediction({
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      tsCreated,
      prediction: inferred.prediction,
      featureSnapshot: inferred.featureSnapshot,
      signalMode,
      preferredSignalSource: selectedSignalSource,
      tracking: inferred.tracking,
      userId,
      botId: null,
      modelVersionBase: payload.modelVersionBase ?? "baseline-v1:auto-market-v1",
      promptSettings: selectedPromptSettings ?? undefined,
      promptScopeContext,
      newsRiskBlocked: newsRiskBlocked
        ? {
            reasonCode: "news_risk_blocked",
            strategyMode: strategyNewsRiskMode
          }
        : null
    });
    const featureSnapshotForState = created.featureSnapshot;

    const stateTags = enforceNewsRiskTag(
      created.explanation.tags.length > 0
        ? created.explanation.tags
        : featureSnapshotForState.tags,
      featureSnapshotForState
    );
    const stateKeyDrivers = normalizeKeyDriverList(created.explanation.keyDrivers);
    const stateTs = new Date(tsCreated);
    const stateHash = buildPredictionChangeHash({
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      tags: stateTags,
      keyDrivers: stateKeyDrivers,
      featureSnapshot: featureSnapshotForState
    });

    const stateData = {
      ...toPredictionStateStrategyScope(strategyRefForInitialSnapshot),
      exchange: account.exchange,
      accountId: payload.exchangeAccountId,
      userId,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signalMode,
      tsUpdated: stateTs,
      tsPredictedFor: new Date(stateTs.getTime() + timeframeToIntervalMs(effectiveTimeframe)),
      signal: created.prediction.signal,
      expectedMovePct: Number.isFinite(Number(created.prediction.expectedMovePct))
        ? Number(created.prediction.expectedMovePct)
        : null,
      confidence: Number.isFinite(Number(created.prediction.confidence))
        ? Number(created.prediction.confidence)
        : 0,
      tags: stateTags,
      explanation: created.explanation.explanation,
      keyDrivers: stateKeyDrivers,
      featuresSnapshot: featureSnapshotForState,
      modelVersion: created.modelVersion,
      lastAiExplainedAt: signalMode === "local_only" ? null : stateTs,
      lastChangeHash: stateHash,
      lastChangeReason: "manual",
      autoScheduleEnabled: true,
      autoSchedulePaused: false,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      leverage: payload.leverage ?? null
    };

    const stateRow = await persistPredictionState({
      existingStateId,
      stateData,
      scope: {
        userId,
        exchange: account.exchange,
        accountId: payload.exchangeAccountId,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signalMode
      }
    });

    await db.predictionEvent.create({
      data: {
        stateId: stateRow.id,
        changeType: "manual",
        prevSnapshot: null,
        newSnapshot: {
          signal: created.prediction.signal,
          confidence: created.prediction.confidence,
          expectedMovePct: created.prediction.expectedMovePct,
          tags: stateTags
        },
        delta: {
          reason: "manual_create"
        },
        horizonEvalRef: created.rowId,
        modelVersion: created.modelVersion,
        reason: "manual_create"
      }
    });

    await dispatchTradablePredictionNotification({
      userId,
      exchange: account.exchange,
      exchangeAccountLabel: account.label,
      symbol: canonicalSymbol,
      marketType: payload.marketType,
      timeframe: effectiveTimeframe,
      signal: created.prediction.signal,
      confidence: created.prediction.confidence,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      expectedMovePct: created.prediction.expectedMovePct,
      predictionId: created.rowId,
      explanation: created.explanation.explanation,
      source: "auto",
      signalSource: created.signalSource,
      tags: stateTags,
      aiPromptTemplateName: resolveNotificationStrategyName({
        signalSource: created.signalSource,
        snapshot: featureSnapshotForState,
        strategyRef: strategyRefForInitialSnapshot,
        aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null
      })
    });
    if (readAiPromptMarketAnalysisUpdateEnabled(featureSnapshotForState)) {
      await dispatchMarketAnalysisUpdateNotification({
        userId,
        exchange: account.exchange,
        exchangeAccountLabel: account.label,
        symbol: canonicalSymbol,
        marketType: payload.marketType,
        timeframe: effectiveTimeframe,
        signal: created.prediction.signal,
        confidence: created.prediction.confidence,
        expectedMovePct: created.prediction.expectedMovePct,
        predictionId: created.rowId,
        explanation: created.explanation.explanation,
        source: "auto",
        signalSource: created.signalSource,
        tags: stateTags,
        aiPromptTemplateName: resolveNotificationStrategyName({
          signalSource: created.signalSource,
          snapshot: featureSnapshotForState,
          strategyRef: strategyRefForInitialSnapshot,
          aiPromptTemplateName: selectedPromptSettings?.activePromptName ?? null
        })
      });
    }

    return {
      persisted: created.persisted,
      prediction: created.prediction,
      timeframe: effectiveTimeframe,
      directionPreference: effectiveDirectionPreference,
      confidenceTargetPct: effectiveConfidenceTargetPct,
      explanation: created.explanation,
      modelVersion: created.modelVersion,
      predictionId: created.rowId,
      tsCreated,
      signalSource: created.signalSource,
      signalMode,
      aiPromptTemplateId:
        selectedPromptSettings?.activePromptId ?? requestedPromptTemplateId,
      aiPromptTemplateName:
        selectedPromptSettings?.activePromptName ?? null,
      localStrategyId: selectedLocalStrategy?.id ?? null,
      localStrategyName: selectedLocalStrategy?.name ?? null,
      compositeStrategyId: selectedCompositeStrategy?.id ?? null,
      compositeStrategyName: selectedCompositeStrategy?.name ?? null,
      strategyRef: selectedStrategyRef
        ? {
            kind: selectedStrategyRef.kind,
            id: selectedStrategyRef.id,
            name:
              selectedStrategyRef.kind === "ai"
                ? (selectedPromptSettings?.activePromptName ?? selectedStrategyRef.name)
                : selectedStrategyRef.name
          }
        : null
    };
  } finally {
    await perpClient.close();
  }
}

function resolveLastSyncAt(runtime: {
  lastHeartbeatAt?: Date | null;
  lastTickAt?: Date | null;
  updatedAt?: Date | null;
} | null | undefined): Date | null {
  if (!runtime) return null;
  const values = [runtime.lastHeartbeatAt, runtime.lastTickAt, runtime.updatedAt]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime());
  return values[0] ?? null;
}

function computeConnectionStatus(
  lastSyncAt: Date | null,
  hasBotActivity: boolean
): DashboardConnectionStatus {
  if (!lastSyncAt) return hasBotActivity ? "disconnected" : "degraded";
  const ageMs = Date.now() - lastSyncAt.getTime();
  if (ageMs <= DASHBOARD_CONNECTED_WINDOW_MS) return "connected";
  // Passive accounts (no running/error bot activity) should not be shown as disconnected
  // only because the last sync is old.
  if (!hasBotActivity) return "degraded";
  if (ageMs <= DASHBOARD_DEGRADED_WINDOW_MS) return "degraded";
  return "disconnected";
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeRiskProfileWithDefaults(profile: any): RiskLimitValues {
  const asValue = (value: unknown, fallback: number): number => {
    const parsed = toFiniteNumber(value);
    if (parsed === null) return fallback;
    return parsed >= 0 ? parsed : fallback;
  };

  return {
    dailyLossWarnPct: asValue(profile?.dailyLossWarnPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossWarnPct),
    dailyLossWarnUsd: asValue(profile?.dailyLossWarnUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossWarnUsd),
    dailyLossCriticalPct: asValue(profile?.dailyLossCriticalPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossCriticalPct),
    dailyLossCriticalUsd: asValue(profile?.dailyLossCriticalUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.dailyLossCriticalUsd),
    marginWarnPct: asValue(profile?.marginWarnPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginWarnPct),
    marginWarnUsd: asValue(profile?.marginWarnUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginWarnUsd),
    marginCriticalPct: asValue(profile?.marginCriticalPct, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginCriticalPct),
    marginCriticalUsd: asValue(profile?.marginCriticalUsd, DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS.marginCriticalUsd)
  };
}

function validateRiskLimitValues(limits: RiskLimitValues): string[] {
  const issues: string[] = [];
  if (limits.dailyLossCriticalPct < limits.dailyLossWarnPct) {
    issues.push("dailyLossCriticalPct must be greater than or equal to dailyLossWarnPct");
  }
  if (limits.dailyLossCriticalUsd < limits.dailyLossWarnUsd) {
    issues.push("dailyLossCriticalUsd must be greater than or equal to dailyLossWarnUsd");
  }
  if (limits.marginCriticalPct > limits.marginWarnPct) {
    issues.push("marginCriticalPct must be less than or equal to marginWarnPct");
  }
  if (limits.marginCriticalUsd > limits.marginWarnUsd) {
    issues.push("marginCriticalUsd must be less than or equal to marginWarnUsd");
  }
  return issues;
}

function riskSeverityRank(value: RiskSeverity): number {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}

function computeAccountRiskAssessment(
  account: {
    pnlTodayUsd?: unknown;
    futuresBudgetEquity?: unknown;
    futuresBudgetAvailableMargin?: unknown;
  },
  limits: RiskLimitValues
): AccountRiskAssessment {
  const equity = toFiniteNumber(account.futuresBudgetEquity);
  const availableMargin = toFiniteNumber(account.futuresBudgetAvailableMargin);
  const pnlToday = toFiniteNumber(account.pnlTodayUsd);
  const safePnlToday = pnlToday ?? 0;
  const lossUsd = safePnlToday < 0 ? Number(Math.abs(safePnlToday).toFixed(6)) : 0;
  const lossPct = equity !== null && equity > 0
    ? Number(((lossUsd / equity) * 100).toFixed(4))
    : null;
  const marginPct = equity !== null && equity > 0 && availableMargin !== null
    ? Number(((availableMargin / equity) * 100).toFixed(4))
    : null;

  const dailyWarn =
    (lossPct !== null && lossPct >= limits.dailyLossWarnPct) ||
    lossUsd >= limits.dailyLossWarnUsd;
  const dailyCritical =
    (lossPct !== null && lossPct >= limits.dailyLossCriticalPct) ||
    lossUsd >= limits.dailyLossCriticalUsd;
  const marginWarn =
    (marginPct !== null && marginPct <= limits.marginWarnPct) ||
    (availableMargin !== null && availableMargin <= limits.marginWarnUsd);
  const marginCritical =
    (marginPct !== null && marginPct <= limits.marginCriticalPct) ||
    (availableMargin !== null && availableMargin <= limits.marginCriticalUsd);

  const insufficientData =
    equity === null || equity <= 0 || availableMargin === null;
  const severity: RiskSeverity =
    dailyCritical || marginCritical
      ? "critical"
      : dailyWarn || marginWarn || insufficientData
        ? "warning"
        : "ok";

  const triggers: RiskTrigger[] = [];
  if (dailyWarn || dailyCritical) triggers.push("dailyLoss");
  if (marginWarn || marginCritical) triggers.push("margin");
  if (insufficientData) triggers.push("insufficientData");

  let riskScore = 0;
  if (dailyWarn) riskScore += 28;
  if (dailyCritical) riskScore += 72;
  if (marginWarn) riskScore += 28;
  if (marginCritical) riskScore += 72;
  if (insufficientData) riskScore += 25;
  if (lossPct !== null) {
    riskScore += Math.max(0, lossPct - limits.dailyLossWarnPct) * 2;
  }
  if (lossUsd > 0) {
    riskScore += (Math.max(0, lossUsd - limits.dailyLossWarnUsd) / Math.max(1, limits.dailyLossWarnUsd)) * 24;
  }
  if (marginPct !== null) {
    riskScore += Math.max(0, limits.marginWarnPct - marginPct) * 2;
  }
  if (availableMargin !== null) {
    riskScore += (Math.max(0, limits.marginWarnUsd - availableMargin) / Math.max(1, limits.marginWarnUsd)) * 20;
  }

  return {
    severity,
    triggers,
    riskScore: Number(riskScore.toFixed(4)),
    insufficientData,
    lossUsd,
    lossPct,
    marginPct,
    availableMarginUsd: availableMargin,
    pnlTodayUsd: pnlToday
  };
}

function toSettingsRiskItem(account: any, limits: RiskLimitValues) {
  const assessment = computeAccountRiskAssessment(account, limits);
  return {
    exchangeAccountId: String(account.id),
    exchange: String(account.exchange ?? ""),
    label: String(account.label ?? ""),
    lastSyncAt: toIso(account.lastUsedAt),
    limits: {
      ...limits
    },
    preview: {
      lossUsd: assessment.lossUsd,
      lossPct: assessment.lossPct,
      marginPct: assessment.marginPct,
      availableMarginUsd: assessment.availableMarginUsd,
      pnlTodayUsd: assessment.pnlTodayUsd,
      severity: assessment.severity,
      triggers: assessment.triggers
    }
  };
}

function createDashboardAlertId(parts: Array<string | null | undefined>): string {
  const seed = parts.filter(Boolean).join("|");
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function alertSeverityRank(value: DashboardAlertSeverity): number {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}

function toSafeUser(user: { id: string; email: string; walletAddress?: string | null }) {
  return {
    id: user.id,
    email: user.email,
    walletAddress: user.walletAddress ?? null
  };
}

function toAuthMePayload(
  user: { id: string; email: string; walletAddress?: string | null },
  ctx: {
    workspaceId: string;
    permissions: Record<string, unknown>;
    isSuperadmin: boolean;
    hasAdminBackendAccess: boolean;
  },
  options?: {
    maintenance?: {
      enabled: boolean;
      activeForUser: boolean;
    };
  }
) {
  const safeUser = toSafeUser(user);
  return {
    user: safeUser,
    id: safeUser.id,
    email: safeUser.email,
    walletAddress: safeUser.walletAddress,
    workspaceId: ctx.workspaceId,
    permissions: ctx.permissions,
    isSuperadmin: ctx.isSuperadmin,
    hasAdminBackendAccess: ctx.hasAdminBackendAccess,
    maintenance: options?.maintenance ?? {
      enabled: false,
      activeForUser: false
    }
  };
}

function normalizeCopierTimeframe(value: unknown): "5m" | "15m" | "1h" | "4h" | null {
  const raw = String(value ?? "").trim();
  if (raw === "5m" || raw === "15m" || raw === "1h" || raw === "4h") return raw;
  return null;
}

function readPredictionCopierRootConfig(paramsJson: unknown): { root: Record<string, unknown>; nested: boolean } {
  const params = asRecord(paramsJson);
  const nested = asRecord(params.predictionCopier);
  if (Object.keys(nested).length > 0) {
    return { root: nested, nested: true };
  }
  return { root: params, nested: false };
}

function writePredictionCopierRootConfig(paramsJson: unknown, root: Record<string, unknown>, forceNested = true): Record<string, unknown> {
  const params = asRecord(paramsJson);
  if (forceNested || Object.prototype.hasOwnProperty.call(params, "predictionCopier")) {
    return {
      ...params,
      predictionCopier: root
    };
  }
  return {
    ...params,
    ...root
  };
}

function readPredictionCopierSettingsFromParams(paramsJson: unknown): z.infer<typeof predictionCopierSettingsSchema> | null {
  const { root } = readPredictionCopierRootConfig(paramsJson);
  const parsed = predictionCopierSettingsSchema.safeParse(root);
  return parsed.success ? parsed.data : null;
}

function readExecutionSettingsFromParams(paramsJson: unknown): {
  mode: "simple" | "dca" | "grid" | "dip_reversion";
  common: {
    maxDailyExecutions: number;
    cooldownSecAfterExecution: number;
    maxNotionalPerSymbolUsd: number | null;
    maxTotalNotionalUsd: number | null;
    maxOpenPositions: number;
    enforceReduceOnlyOnClose: boolean;
  };
  simple: {
    orderType: "market" | "limit";
    limitOffsetBps: number;
  };
  dca: {
    maxEntries: number;
    stepPct: number;
    sizeScale: number;
    entryOrderType: "market" | "limit";
    takeProfitPct: number | null;
    stopLossPct: number | null;
    cancelPendingOnFlip: boolean;
  };
  grid: {
    levelsPerSide: number;
    gridSpacingPct: number;
    baseOrderUsd: number;
    tpPctPerLevel: number;
    maxActiveOrders: number;
    rebalanceThresholdPct: number;
  };
  dipReversion: {
    dipTriggerPct: number;
    recoveryTakeProfitPct: number;
    maxHoldMinutes: number;
    maxReentriesPerDay: number;
    entryScaleUsd: number;
  };
} {
  const params = asRecord(paramsJson);
  const execution = asRecord(params.execution);
  const parsed = executionSettingsSchema.safeParse(execution);

  const mode = parsed.success && parsed.data.mode
    ? parsed.data.mode
    : (() => {
        const legacy = String(params.executionMode ?? "").trim().toLowerCase();
        if (legacy === "dca" || legacy === "grid" || legacy === "dip_reversion") return legacy;
        return "simple";
      })();

  const common = parsed.success && parsed.data.common ? parsed.data.common : {};
  const simple = parsed.success && parsed.data.simple ? parsed.data.simple : {};
  const dca = parsed.success && parsed.data.dca ? parsed.data.dca : {};
  const grid = parsed.success && parsed.data.grid ? parsed.data.grid : {};
  const dipReversion = parsed.success && parsed.data.dipReversion ? parsed.data.dipReversion : {};

  const maxNotionalPerSymbolUsd = common.maxNotionalPerSymbolUsd ?? null;
  let maxTotalNotionalUsd = common.maxTotalNotionalUsd ?? null;
  if (
    maxNotionalPerSymbolUsd !== null
    && maxTotalNotionalUsd !== null
    && maxTotalNotionalUsd < maxNotionalPerSymbolUsd
  ) {
    maxTotalNotionalUsd = maxNotionalPerSymbolUsd;
  }

  return {
    mode,
    common: {
      maxDailyExecutions: common.maxDailyExecutions ?? 200,
      cooldownSecAfterExecution: common.cooldownSecAfterExecution ?? 0,
      maxNotionalPerSymbolUsd,
      maxTotalNotionalUsd,
      maxOpenPositions: common.maxOpenPositions ?? 1,
      enforceReduceOnlyOnClose: common.enforceReduceOnlyOnClose ?? true
    },
    simple: {
      orderType: simple.orderType ?? "market",
      limitOffsetBps: simple.limitOffsetBps ?? 2
    },
    dca: {
      maxEntries: dca.maxEntries ?? 3,
      stepPct: dca.stepPct ?? 1.5,
      sizeScale: dca.sizeScale ?? 1.25,
      entryOrderType: dca.entryOrderType ?? "limit",
      takeProfitPct: dca.takeProfitPct ?? 2,
      stopLossPct: dca.stopLossPct ?? null,
      cancelPendingOnFlip: dca.cancelPendingOnFlip ?? true
    },
    grid: {
      levelsPerSide: grid.levelsPerSide ?? 4,
      gridSpacingPct: grid.gridSpacingPct ?? 0.5,
      baseOrderUsd: grid.baseOrderUsd ?? 100,
      tpPctPerLevel: grid.tpPctPerLevel ?? 0.4,
      maxActiveOrders: grid.maxActiveOrders ?? 10,
      rebalanceThresholdPct: grid.rebalanceThresholdPct ?? 1.5
    },
    dipReversion: {
      dipTriggerPct: dipReversion.dipTriggerPct ?? 3,
      recoveryTakeProfitPct: dipReversion.recoveryTakeProfitPct ?? 1.5,
      maxHoldMinutes: dipReversion.maxHoldMinutes ?? 720,
      maxReentriesPerDay: dipReversion.maxReentriesPerDay ?? 2,
      entryScaleUsd: dipReversion.entryScaleUsd ?? 100
    }
  };
}

function executionCapabilityForMode(
  mode: "simple" | "dca" | "grid" | "dip_reversion"
): "execution.mode.simple" | "execution.mode.dca" | "execution.mode.grid" | "execution.mode.dip_reversion" {
  if (mode === "dca") return "execution.mode.dca";
  if (mode === "grid") return "execution.mode.grid";
  if (mode === "dip_reversion") return "execution.mode.dip_reversion";
  return "execution.mode.simple";
}

function strategyCapabilityForKey(
  strategyKey: string
): "strategy.kind.prediction_copier" | "strategy.kind.futures_grid" | null {
  const normalized = String(strategyKey ?? "").trim().toLowerCase();
  if (normalized === "prediction_copier") return "strategy.kind.prediction_copier";
  if (normalized === "futures_grid") return "strategy.kind.futures_grid";
  return null;
}

function readPredictionSourceSnapshotFromState(state: any): Record<string, unknown> {
  const snapshot = asRecord(state?.featuresSnapshot);
  const signalMode = readStateSignalMode(state?.signalMode, snapshot);
  const timeframe = normalizeCopierTimeframe(state?.timeframe);
  const snapshotStrategyRef = readPredictionStrategyRef(snapshot);
  const rowKind = normalizePredictionStrategyKind(state?.strategyKind);
  const rowStrategyId = typeof state?.strategyId === "string" && state.strategyId.trim()
    ? state.strategyId.trim()
    : null;
  const strategyRef = snapshotStrategyRef ?? (rowKind && rowStrategyId
    ? { kind: rowKind, id: rowStrategyId, name: null }
    : null);

  return {
    stateId: String(state?.id ?? ""),
    accountId: String(state?.accountId ?? ""),
    symbol: normalizeSymbolInput(String(state?.symbol ?? "")),
    ...(timeframe ? { timeframe } : {}),
    signalMode,
    strategyRef: strategyRef ? `${strategyRef.kind}:${strategyRef.id}` : null,
    strategyKind: strategyRef?.kind ?? null,
    strategyId: strategyRef?.id ?? null,
    strategyName: strategyRef?.name ?? null
  };
}

async function findPredictionSourceStateForCopier(params: {
  userId: string;
  exchangeAccountId: string;
  sourceStateId: string;
  requireActive?: boolean;
}) {
  return db.predictionState.findFirst({
    where: {
      id: params.sourceStateId,
      userId: params.userId,
      accountId: params.exchangeAccountId,
      ...(params.requireActive
        ? {
            autoScheduleEnabled: true,
            autoSchedulePaused: false
          }
        : {})
    },
    select: {
      id: true,
      accountId: true,
      symbol: true,
      timeframe: true,
      signalMode: true,
      strategyKind: true,
      strategyId: true,
      featuresSnapshot: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      signal: true,
      confidence: true,
      tsUpdated: true,
      lastChangeReason: true
    }
  });
}

async function findLegacyPredictionSourceForCopier(params: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  timeframe: "5m" | "15m" | "1h" | "4h";
}) {
  return db.predictionState.findFirst({
    where: {
      userId: params.userId,
      accountId: params.exchangeAccountId,
      marketType: "perp",
      symbol: normalizeSymbolInput(params.symbol),
      timeframe: params.timeframe,
      autoScheduleEnabled: true,
      autoSchedulePaused: false
    },
    orderBy: [{ tsUpdated: "desc" }],
    select: {
      id: true,
      accountId: true,
      symbol: true,
      timeframe: true,
      signalMode: true,
      strategyKind: true,
      strategyId: true,
      featuresSnapshot: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      signal: true,
      confidence: true,
      tsUpdated: true,
      lastChangeReason: true
    }
  });
}

function toSafeBot(bot: any) {
  const predictionCopier = bot?.futuresConfig?.strategyKey === "prediction_copier"
    ? readPredictionCopierSettingsFromParams(bot?.futuresConfig?.paramsJson)
    : null;
  const execution = bot?.futuresConfig?.strategyKey === "prediction_copier"
    ? null
    : readExecutionSettingsFromParams(bot?.futuresConfig?.paramsJson);
  return {
    id: bot.id,
    userId: bot.userId,
    exchangeAccountId: bot.exchangeAccountId ?? null,
    name: bot.name,
    exchange: bot.exchange,
    symbol: bot.symbol,
    status: bot.status,
    lastError: bot.lastError ?? null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    exchangeAccount: bot.exchangeAccount
      ? {
          id: bot.exchangeAccount.id,
          exchange: bot.exchangeAccount.exchange,
          label: bot.exchangeAccount.label
        }
      : null,
    futuresConfig: bot.futuresConfig
      ? {
          strategyKey: bot.futuresConfig.strategyKey,
          marginMode: bot.futuresConfig.marginMode,
          leverage: bot.futuresConfig.leverage,
          tickMs: bot.futuresConfig.tickMs,
          paramsJson: bot.futuresConfig.paramsJson,
          execution,
          predictionCopier
        }
      : null,
    botVault: bot.botVault
      ? {
          id: bot.botVault.id,
          botId: bot.botVault.botId ?? null,
          gridInstanceId: bot.botVault.gridInstanceId ?? null,
          status: bot.botVault.status,
          allocatedUsd: Number(bot.botVault.allocatedUsd ?? 0),
          availableUsd: Number(bot.botVault.availableUsd ?? 0),
          executionStatus: bot.botVault.executionStatus ?? null,
          vaultAddress: bot.botVault.vaultAddress ?? null,
          agentWallet: bot.botVault.agentWallet ?? null,
          updatedAt: bot.botVault.updatedAt ?? null
        }
      : null,
    runtime: bot.runtime
      ? {
          status: bot.runtime.status,
          reason: bot.runtime.reason,
          updatedAt: bot.runtime.updatedAt,
          workerId: bot.runtime.workerId ?? null,
          lastHeartbeatAt: bot.runtime.lastHeartbeatAt ?? null,
          lastTickAt: bot.runtime.lastTickAt ?? null,
          lastError: bot.runtime.lastError ?? null,
          consecutiveErrors: bot.runtime.consecutiveErrors ?? 0,
          errorWindowStartAt: bot.runtime.errorWindowStartAt ?? null,
          lastErrorAt: bot.runtime.lastErrorAt ?? null,
          lastErrorMessage: bot.runtime.lastErrorMessage ?? null
        }
      : null
  };
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

type ExchangeAccountSecrets = {
  id: string;
  userId: string;
  exchange: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
};

function normalizeSyncErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.slice(0, 500);
}

function bucketTimestampBySeconds(at: Date, bucketSeconds: number): Date {
  const bucketMs = Math.max(1, bucketSeconds) * 1000;
  return new Date(Math.floor(at.getTime() / bucketMs) * bucketMs);
}

type DashboardPerformanceTotals = {
  totalEquity: number;
  totalAvailableMargin: number;
  totalTodayPnl: number;
  includedAccounts: number;
};
type BotRealizedAccountSummary = {
  pnl: number;
  count: number;
};

async function aggregateDashboardPerformanceTotalsForUser(userId: string): Promise<DashboardPerformanceTotals> {
  const accounts = await db.exchangeAccount.findMany({
    where: { userId },
    select: {
      spotBudgetTotal: true,
      futuresBudgetEquity: true,
      futuresBudgetAvailableMargin: true,
      pnlTodayUsd: true
    }
  });

  const reduced = (Array.isArray(accounts) ? accounts : []).reduce(
    (acc: DashboardPerformanceTotals, row: any) => {
      const spotTotal = toFiniteNumber(row.spotBudgetTotal);
      const futuresEquity = toFiniteNumber(row.futuresBudgetEquity);
      const availableMargin = toFiniteNumber(row.futuresBudgetAvailableMargin);
      const pnlToday = toFiniteNumber(row.pnlTodayUsd);

      let contributes = false;

      if (spotTotal !== null) {
        acc.totalEquity += spotTotal;
        contributes = true;
      }
      if (futuresEquity !== null) {
        acc.totalEquity += futuresEquity;
        contributes = true;
      }
      if (availableMargin !== null) {
        acc.totalAvailableMargin += availableMargin;
        contributes = true;
      }
      if (pnlToday !== null) {
        acc.totalTodayPnl += pnlToday;
        contributes = true;
      }
      if (contributes) acc.includedAccounts += 1;
      return acc;
    },
    {
      totalEquity: 0,
      totalAvailableMargin: 0,
      totalTodayPnl: 0,
      includedAccounts: 0
    } satisfies DashboardPerformanceTotals
  );

  return {
    totalEquity: Number(reduced.totalEquity.toFixed(6)),
    totalAvailableMargin: Number(reduced.totalAvailableMargin.toFixed(6)),
    totalTodayPnl: Number(reduced.totalTodayPnl.toFixed(6)),
    includedAccounts: reduced.includedAccounts
  };
}

async function readBotRealizedPnlTodayByAccount(
  userId: string,
  accountIds: string[]
): Promise<Map<string, BotRealizedAccountSummary>> {
  if (!Array.isArray(accountIds) || accountIds.length === 0) return new Map();
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);
  const rows = await ignoreMissingTable(() => db.botTradeHistory.findMany({
    where: {
      userId,
      exchangeAccountId: { in: accountIds },
      status: "closed",
      exitTs: { gte: dayStartUtc }
    },
    select: {
      exchangeAccountId: true,
      realizedPnlUsd: true
    }
  }));

  const byAccount = new Map<string, BotRealizedAccountSummary>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const exchangeAccountId =
      typeof (row as any)?.exchangeAccountId === "string" ? String((row as any).exchangeAccountId) : "";
    if (!exchangeAccountId) continue;
    const pnl = toFiniteNumber((row as any)?.realizedPnlUsd);
    if (pnl === null) continue;
    const current = byAccount.get(exchangeAccountId) ?? { pnl: 0, count: 0 };
    current.pnl += pnl;
    current.count += 1;
    byAccount.set(exchangeAccountId, current);
  }
  return byAccount;
}

function resolveEffectivePnlTodayUsd(rawPnlTodayUsd: unknown, botRealizedToday: BotRealizedAccountSummary | null): number {
  const exchangePnlToday = toFiniteNumber(rawPnlTodayUsd);
  if (exchangePnlToday !== null) return exchangePnlToday;
  if (botRealizedToday && botRealizedToday.count > 0) {
    return Number(botRealizedToday.pnl.toFixed(6));
  }
  return 0;
}

async function captureDashboardPerformanceSnapshot(userId: string, at: Date): Promise<void> {
  const bucketTs = bucketTimestampBySeconds(at, DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS);
  const totals = await aggregateDashboardPerformanceTotalsForUser(userId);

  await db.dashboardPerformanceSnapshot.upsert({
    where: {
      userId_bucketTs: {
        userId,
        bucketTs
      }
    },
    create: {
      userId,
      bucketTs,
      totalEquity: totals.totalEquity,
      totalAvailableMargin: totals.totalAvailableMargin,
      totalTodayPnl: totals.totalTodayPnl,
      includedAccounts: totals.includedAccounts
    },
    update: {
      totalEquity: totals.totalEquity,
      totalAvailableMargin: totals.totalAvailableMargin,
      totalTodayPnl: totals.totalTodayPnl,
      includedAccounts: totals.includedAccounts
    }
  });
}

async function persistExchangeSyncSuccess(
  userId: string,
  accountId: string,
  synced: Awaited<ReturnType<typeof syncExchangeAccount>>
) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastUsedAt: synced.syncedAt,
      spotBudgetTotal: synced.spotBudget?.total ?? null,
      spotBudgetAvailable: synced.spotBudget?.available ?? null,
      futuresBudgetEquity: synced.futuresBudget.equity,
      futuresBudgetAvailableMargin: synced.futuresBudget.availableMargin,
      pnlTodayUsd: synced.pnlTodayUsd,
      lastSyncErrorAt: null,
      lastSyncErrorMessage: null
    }
  });

  try {
    await captureDashboardPerformanceSnapshot(userId, synced.syncedAt);
  } catch (error) {
    console.warn(
      `[dashboard-performance] snapshot capture failed for account ${accountId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function persistExchangeSyncFailure(accountId: string, errorMessage: string) {
  await db.exchangeAccount.update({
    where: { id: accountId },
    data: {
      lastSyncErrorAt: new Date(),
      lastSyncErrorMessage: normalizeSyncErrorMessage(errorMessage)
    }
  });
}

function decodeExchangeSecrets(account: ExchangeAccountSecrets): {
  apiKey: string;
  apiSecret: string;
  passphrase: string | null;
} {
  try {
    const apiKey = decryptSecret(account.apiKeyEnc);
    const apiSecret = decryptSecret(account.apiSecretEnc);
    const passphrase = account.passphraseEnc ? decryptSecret(account.passphraseEnc) : null;
    return { apiKey, apiSecret, passphrase };
  } catch {
    throw new ExchangeSyncError(
      "Failed to decrypt exchange credentials.",
      500,
      "exchange_secret_decrypt_failed"
    );
  }
}

async function executeExchangeSync(account: ExchangeAccountSecrets) {
  const secrets = decodeExchangeSecrets(account);
  return syncExchangeAccount({
    exchange: account.exchange,
    apiKey: secrets.apiKey,
    apiSecret: secrets.apiSecret,
    passphrase: secrets.passphrase
  });
}

let exchangeAutoSyncTimer: NodeJS.Timeout | null = null;
let exchangeAutoSyncRunning = false;

async function runExchangeAutoSyncCycle() {
  if (exchangeAutoSyncRunning) return;
  exchangeAutoSyncRunning = true;
  try {
    const accounts: ExchangeAccountSecrets[] = await db.exchangeAccount.findMany({
      where: {
        exchange: {
          in: ["bitget", "hyperliquid", "mexc", "binance"]
        }
      },
      select: {
        id: true,
        userId: true,
        exchange: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        passphraseEnc: true
      }
    });

    for (const account of accounts) {
      try {
        const synced = await executeExchangeSync(account);
        await persistExchangeSyncSuccess(account.userId, account.id, synced);
      } catch (error) {
        const message =
          error instanceof ExchangeSyncError
            ? error.message
            : "Auto sync failed due to unexpected error.";
        await persistExchangeSyncFailure(account.id, message);
      }
    }
  } finally {
    exchangeAutoSyncRunning = false;
  }
}

function startExchangeAutoSyncScheduler() {
  if (!EXCHANGE_AUTO_SYNC_ENABLED) return;
  exchangeAutoSyncTimer = setInterval(() => {
    void runExchangeAutoSyncCycle();
  }, EXCHANGE_AUTO_SYNC_INTERVAL_MS);
  void runExchangeAutoSyncCycle();
}

function stopExchangeAutoSyncScheduler() {
  if (!exchangeAutoSyncTimer) return;
  clearInterval(exchangeAutoSyncTimer);
  exchangeAutoSyncTimer = null;
}

let botQueueRecoveryTimer: NodeJS.Timeout | null = null;
let botQueueRecoveryRunning = false;

async function runBotQueueRecoveryCycle(reason: "startup" | "scheduled") {
  if (botQueueRecoveryRunning) return;
  botQueueRecoveryRunning = true;
  const startedAtMs = Date.now();
  try {
    const result = await recoverRunningBotJobs({ db });
    // eslint-disable-next-line no-console
    console.log("[bot-queue-recovery] bot_queue_recovery_cycle", {
      reason,
      scanned: result.scanned,
      enqueued: result.enqueued,
      alreadyQueued: result.alreadyQueued,
      failed: result.failed,
      durationMs: Date.now() - startedAtMs
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[bot-queue-recovery] bot_queue_recovery_failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAtMs
    });
  } finally {
    botQueueRecoveryRunning = false;
  }
}

function startBotQueueRecoveryScheduler() {
  if (getRuntimeOrchestrationMode() !== "queue") return;
  if (botQueueRecoveryTimer) return;
  botQueueRecoveryTimer = setInterval(() => {
    void runBotQueueRecoveryCycle("scheduled");
  }, BOT_QUEUE_RECOVERY_INTERVAL_MS);
  void runBotQueueRecoveryCycle("startup");
}

function stopBotQueueRecoveryScheduler() {
  if (!botQueueRecoveryTimer) return;
  clearInterval(botQueueRecoveryTimer);
  botQueueRecoveryTimer = null;
}

let featureThresholdCalibrationTimer: NodeJS.Timeout | null = null;
let featureThresholdCalibrationRunning = false;
const featureThresholdCalibrationBuckets = new Map<PredictionTimeframe, string>();

async function fetchHistoricalCandles(
  adapter: PerpExecutionAdapter,
  symbol: string,
  timeframe: PredictionTimeframe,
  windowFromMs: number,
  windowToMs: number,
  minBars: number
): Promise<CandleBar[]> {
  const targetBars = Math.max(minBars, 1200);
  const maxBars = Math.max(targetBars + 200, 5000);
  const byTs = new Map<number, CandleBar>();
  let cursorEnd = windowToMs;
  let rounds = 0;

  while (cursorEnd > windowFromMs && byTs.size < maxBars && rounds < 80) {
    const raw = await adapter.marketApi.getCandles({
      symbol,
      productType: adapter.productType,
      granularity: timeframeToBitgetGranularity(timeframe),
      startTime: windowFromMs,
      endTime: cursorEnd,
      limit: 200
    });
    const batch = parseBitgetCandles(raw);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (!Number.isFinite(row.ts) || row.ts === null) continue;
      const ts = Number(row.ts);
      if (ts < windowFromMs || ts > windowToMs) continue;
      byTs.set(ts, row);
    }

    const firstTs = batch[0]?.ts;
    if (!Number.isFinite(firstTs) || firstTs === null) break;
    if ((firstTs as number) <= windowFromMs) break;
    cursorEnd = (firstTs as number) - 1;
    rounds += 1;
  }

  return Array.from(byTs.values()).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

function extractMicrostructureSeries(
  rows: Array<{ featuresSnapshot: unknown }>,
  exchange: string
) {
  const spreadBpsSeries: number[] = [];
  const depth1pctUsdSeries: number[] = [];
  const normalizedExchange = normalizeExchangeValue(exchange);

  for (const row of rows) {
    const snapshot = asRecord(row.featuresSnapshot);
    const snapshotExchange = typeof snapshot.prefillExchange === "string"
      ? normalizeExchangeValue(snapshot.prefillExchange)
      : null;
    if (snapshotExchange && snapshotExchange !== normalizedExchange) continue;
    const spread = pickNumber(snapshot, ["spreadBps", "spread_bps"]);
    const depth = pickNumber(snapshot, ["depth1pctUsd", "depth_1pct_usd", "orderBookDepth1pctUsd"]);
    if (spread !== null) spreadBpsSeries.push(spread);
    if (depth !== null) depth1pctUsdSeries.push(depth);
  }

  return {
    spreadBpsSeries,
    depth1pctUsdSeries
  };
}

async function calibrateFeatureThresholdForSymbol(params: {
  adapter: PerpExecutionAdapter;
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  now: Date;
}) {
  const windowMs = calibrationWindowMsForTimeframe(params.timeframe as ThresholdTimeframe);
  const minBars = minimumBarsForTimeframe(params.timeframe as ThresholdTimeframe);
  const windowToMs = params.now.getTime();
  const windowFromMs = windowToMs - windowMs;

  const exchangeSymbol = await params.adapter.toExchangeSymbol(params.symbol);
  const candles = await fetchHistoricalCandles(
    params.adapter,
    exchangeSymbol,
    params.timeframe,
    windowFromMs,
    windowToMs,
    minBars
  );
  const nBars = candles.length;
  const gapRatio = computeGapRatio(params.timeframe, windowMs, nBars);

  const atrPctSeries = computeAtrPctSeries(candles);
  const absEmaSpreadPctSeries = computeAbsEmaSpreadSeries(candles);

  const predictionRows = await db.prediction.findMany({
    where: {
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      tsCreated: {
        gte: new Date(windowFromMs)
      }
    },
    orderBy: { tsCreated: "desc" },
    take: 1500,
    select: {
      featuresSnapshot: true
    }
  });
  const microstructure = extractMicrostructureSeries(predictionRows, params.exchange);
  const expectedBars = expectedBarsForWindow(params.timeframe as ThresholdTimeframe, windowMs);
  const dataGapDetected = gapRatio > FEATURE_THRESHOLDS_MAX_GAP_RATIO;
  const insufficientBars = nBars < minBars;
  if (dataGapDetected) {
    // eslint-disable-next-line no-console
    console.warn("[thresholds] data gap detected, storing fallback thresholds", {
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      nBars,
      gapRatio
    });
  }
  if (insufficientBars) {
    // eslint-disable-next-line no-console
    console.warn("[thresholds] insufficient bars, storing fallback thresholds", {
      exchange: params.exchange,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      nBars,
      minBars
    });
  }
  const built = buildFeatureThresholds({
    atrPctSeries: dataGapDetected || insufficientBars ? [] : atrPctSeries,
    absEmaSpreadPctSeries: dataGapDetected || insufficientBars ? [] : absEmaSpreadPctSeries,
    spreadBpsSeries: dataGapDetected || insufficientBars ? [] : microstructure.spreadBpsSeries,
    depth1pctUsdSeries: dataGapDetected || insufficientBars ? [] : microstructure.depth1pctUsdSeries,
    winsorizePct: FEATURE_THRESHOLDS_WINSORIZE_PCT,
    expectedBars,
    nBars,
    dataGap: dataGapDetected
  });

  const row = await db.featureThreshold.create({
    data: {
      exchange: params.exchange.trim().toLowerCase(),
      accountScope: "global",
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      windowFrom: new Date(windowFromMs),
      windowTo: new Date(windowToMs),
      nBars,
      thresholdsJson: built.thresholdsJson,
      computedAt: params.now,
      version: FEATURE_THRESHOLD_VERSION
    },
    select: {
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      windowFrom: true,
      windowTo: true,
      nBars: true,
      computedAt: true,
      version: true,
      thresholdsJson: true
    }
  });

  setFeatureThresholdCacheRow({
    exchange: row.exchange,
    symbol: row.symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    nBars: Number(row.nBars),
    computedAt: row.computedAt,
    version: String(row.version ?? FEATURE_THRESHOLD_VERSION),
    thresholdsJson: asRecord(row.thresholdsJson) as FeatureThresholdsJson
  });
}

function thresholdBucketForTimeframe(timeframe: PredictionTimeframe, now: Date): string | null {
  if (timeframe === "5m" || timeframe === "15m") {
    if (!isDailyCalibrationTime(now)) return null;
    return now.toISOString().slice(0, 10);
  }
  if (!isWeeklyCalibrationTime(now)) return null;
  return isoWeekBucket(now);
}

async function runFeatureThresholdCalibrationCycle(mode: "startup" | "scheduled") {
  if (!FEATURE_THRESHOLDS_CALIBRATION_ENABLED) return;
  if (featureThresholdCalibrationRunning) return;
  featureThresholdCalibrationRunning = true;

  try {
    const timeframes =
      FEATURE_THRESHOLDS_TIMEFRAMES.length > 0
        ? FEATURE_THRESHOLDS_TIMEFRAMES
        : (["5m", "15m", "1h", "4h", "1d"] as ThresholdTimeframe[]);
    const now = new Date();
    const dueTimeframes: PredictionTimeframe[] = [];

    for (const timeframe of timeframes) {
      const tf = normalizePredictionTimeframe(timeframe);
      if (mode === "startup") {
        dueTimeframes.push(tf);
        continue;
      }
      const bucket = thresholdBucketForTimeframe(tf, now);
      if (!bucket) continue;
      if (featureThresholdCalibrationBuckets.get(tf) === bucket) continue;
      dueTimeframes.push(tf);
      featureThresholdCalibrationBuckets.set(tf, bucket);
    }

    if (dueTimeframes.length === 0) return;

    const accounts = await db.exchangeAccount.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        exchange: true
      }
    });

    const byExchange = new Map<string, { id: string; userId: string; exchange: string }>();
    for (const account of accounts) {
      const exchange = normalizeExchangeValue(account.exchange);
      if (!byExchange.has(exchange)) {
        byExchange.set(exchange, {
          id: account.id,
          userId: account.userId,
          exchange
        });
      }
    }

    const symbols =
      FEATURE_THRESHOLDS_SYMBOLS.length > 0
        ? FEATURE_THRESHOLDS_SYMBOLS
        : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"];
    const marketTypes =
      FEATURE_THRESHOLDS_MARKET_TYPES.length > 0
        ? FEATURE_THRESHOLDS_MARKET_TYPES
        : (["perp"] as ThresholdMarketType[]);

    for (const [exchange, accountRef] of byExchange.entries()) {
      if (exchange !== "bitget" && exchange !== "hyperliquid" && exchange !== "mexc") continue;
      let adapter: PerpExecutionAdapter | null = null;
      try {
        const account = await resolveTradingAccount(accountRef.userId, accountRef.id);
        adapter = createPerpExecutionAdapter(account);
        await adapter.contractCache.warmup();

        for (const symbol of symbols) {
          for (const marketType of marketTypes) {
            const normalizedMarketType = normalizePredictionMarketType(marketType);
            for (const timeframe of dueTimeframes) {
              try {
                await calibrateFeatureThresholdForSymbol({
                  adapter,
                  exchange,
                  symbol,
                  marketType: normalizedMarketType,
                  timeframe,
                  now
                });
              } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("[thresholds] calibration failed", {
                  exchange,
                  symbol,
                  marketType: normalizedMarketType,
                  timeframe,
                  reason: String(error)
                });
              }
            }
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[thresholds] exchange calibration skipped", {
          exchange,
          reason: String(error)
        });
      } finally {
        if (adapter) {
          await adapter.close();
        }
      }
    }
  } finally {
    featureThresholdCalibrationRunning = false;
  }
}

function startFeatureThresholdCalibrationScheduler() {
  if (!FEATURE_THRESHOLDS_CALIBRATION_ENABLED) return;
  featureThresholdCalibrationTimer = setInterval(() => {
    void runFeatureThresholdCalibrationCycle("scheduled");
  }, FEATURE_THRESHOLDS_CALIBRATION_SCAN_MS);
  void runFeatureThresholdCalibrationCycle("startup");
}

function stopFeatureThresholdCalibrationScheduler() {
  if (!featureThresholdCalibrationTimer) return;
  clearInterval(featureThresholdCalibrationTimer);
  featureThresholdCalibrationTimer = null;
}

function isAutoScheduleEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return false;
}

function readConfidenceTarget(snapshot: Record<string, unknown>): number {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return 55;
  return clamp(parsed, 0, 100);
}

function readConfiguredConfidenceTarget(snapshot: Record<string, unknown>): number | null {
  const parsed = pickNumber(snapshot, ["confidenceTargetPct", "targetConfidencePct", "confidenceTarget"]);
  if (parsed === null) return null;
  return clamp(parsed, 0, 100);
}

function parseTelegramConfigValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTelegramChatId(value: unknown): string | null {
  return normalizeTelegramChatIdValue(value);
}

async function findTelegramChatIdConflict(params: {
  chatId: string | null;
  currentUserId?: string | null;
  includeGlobal?: boolean;
}): Promise<"user" | "global" | null> {
  return findTelegramChatIdConflictFromDeps({
    ...params,
    deps: {
      findUserByChatId: async (input) =>
        db.user.findFirst({
          where: {
            telegramChatId: input.chatId,
            ...(input.excludingUserId ? { id: { not: input.excludingUserId } } : {})
          },
          select: { id: true }
        }),
      getGlobalChatId: async () => {
        const config = await db.alertConfig.findUnique({
          where: { key: "default" },
          select: { telegramChatId: true }
        });
        return normalizeTelegramChatId(config?.telegramChatId);
      }
    }
  });
}

function buildTelegramChatIdConflictResponse(res: express.Response): express.Response {
  return res.status(409).json(TELEGRAM_CHAT_ID_IN_USE_ERROR);
}

function toDailyEconomicCalendarSettingsResponse(settings: DailyEconomicCalendarSettings): {
  enabled: boolean;
  currencies: string[];
  impacts: ("low" | "medium" | "high")[];
  sendTimeLocal: string;
  timezone: string;
} {
  return {
    enabled: settings.enabled,
    currencies: settings.currencies,
    impacts: settings.impacts,
    sendTimeLocal: settings.sendTimeLocal,
    timezone: settings.timezone
  };
}

function toNotificationDestinationsSettingsResponse(
  settings: NotificationDestinationsSettings
): NotificationDestinationsSettings {
  return {
    version: 1,
    webhook: {
      url: settings.webhook.url,
      headers: { ...settings.webhook.headers }
    }
  };
}

async function getDailyEconomicCalendarSettingsForUser(userId: string): Promise<DailyEconomicCalendarSettings> {
  const key = dailyEconomicCalendarSettingsKey(userId);
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  if (!row) return defaultDailyEconomicCalendarSettings();
  return parseStoredDailyEconomicCalendarSettings(row.value);
}

async function updateDailyEconomicCalendarSettingsForUser(params: {
  userId: string;
  patch: Record<string, unknown>;
}): Promise<DailyEconomicCalendarSettings> {
  const key = dailyEconomicCalendarSettingsKey(params.userId);
  const row = await db.globalSetting.findUnique({
    where: { key },
    select: { value: true }
  });
  const current = row
    ? parseStoredDailyEconomicCalendarSettings(row.value)
    : defaultDailyEconomicCalendarSettings();
  const next = mergeDailyEconomicCalendarSettings(current, params.patch);
  await db.globalSetting.upsert({
    where: { key },
    create: { key, value: next },
    update: { value: next }
  });
  return next;
}

function readRequestedLeverage(snapshot: Record<string, unknown>): number | undefined {
  const parsed = pickNumber(snapshot, ["requestedLeverage", "leverage"]);
  if (parsed === null) return undefined;
  if (!Number.isFinite(parsed)) return undefined;
  const bounded = Math.max(1, Math.min(125, Math.trunc(parsed)));
  return bounded;
}

function computeSignalPnlPct(
  signal: PredictionSignal,
  entryPrice: number,
  price: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(price) || price <= 0) {
    return 0;
  }
  if (signal === "down") {
    return ((entryPrice - price) / entryPrice) * 100;
  }
  return ((price - entryPrice) / entryPrice) * 100;
}

type PredictionOutcomeEvaluation = {
  data: Record<string, unknown>;
  terminal: boolean;
};

function preserveRealizedMeta(outcomeMeta: unknown): Record<string, unknown> {
  const meta = asRecord(outcomeMeta);
  const preserved: Record<string, unknown> = {};
  const keys = [
    "realizedReturnPct",
    "realizedEvaluatedAt",
    "realizedStartClose",
    "realizedEndClose",
    "realizedStartBucketMs",
    "realizedEndBucketMs",
    "predictedMovePct",
    "evaluatorVersion",
    "errorMetrics",
    "outcomeAlertSentAt",
    "outcomeAlertResult",
    "outcomeAlertSignalId"
  ];
  for (const key of keys) {
    if (key in meta) preserved[key] = meta[key];
  }
  return preserved;
}

function evaluatePredictionOutcomeFromCandles(params: {
  row: {
    signal: PredictionSignal;
    timeframe: PredictionTimeframe;
    tsCreated: Date;
    entryPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
    horizonMs: number | null;
    featuresSnapshot: unknown;
    outcomeMeta: unknown;
  };
  candles: CandleBar[];
  nowMs: number;
}): PredictionOutcomeEvaluation | null {
  const row = params.row;
  const signal = row.signal;
  const snapshot = asRecord(row.featuresSnapshot);
  const realizedMeta = preserveRealizedMeta(row.outcomeMeta);

  if (signal === "neutral") {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "skipped",
        outcomeReason: "neutral_signal",
        outcomePnlPct: 0,
        maxFavorablePct: 0,
        maxAdversePct: 0,
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          ...realizedMeta,
          evaluatedFrom: row.tsCreated.toISOString(),
          evaluatedTo: new Date(params.nowMs).toISOString(),
          barsScanned: 0
        }
      }
    };
  }

  const derived = derivePredictionTrackingFromSnapshot(snapshot, row.timeframe);
  const entryPrice = row.entryPrice ?? derived.entryPrice;
  const stopLossPrice = row.stopLossPrice ?? derived.stopLossPrice;
  const takeProfitPrice = row.takeProfitPrice ?? derived.takeProfitPrice;
  const horizonMs = row.horizonMs ?? derived.horizonMs ?? timeframeToIntervalMs(row.timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;

  if (!entryPrice || !stopLossPrice || !takeProfitPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      terminal: true,
      data: {
        outcomeStatus: "closed",
        outcomeResult: "invalid",
        outcomeReason: "missing_tracking_prices",
        outcomeEvaluatedAt: new Date(),
        outcomeMeta: {
          ...realizedMeta,
          hasEntryPrice: Boolean(entryPrice),
          hasStopLossPrice: Boolean(stopLossPrice),
          hasTakeProfitPrice: Boolean(takeProfitPrice)
        }
      }
    };
  }

  const expireAtMs = row.tsCreated.getTime() + Math.max(60_000, horizonMs);
  const evaluationEndMs = Math.min(params.nowMs, expireAtMs);

  const bars = params.candles
    .filter((bar) => bar.ts !== null)
    .filter((bar) => (bar.ts as number) >= row.tsCreated.getTime() && (bar.ts as number) <= evaluationEndMs);

  if (bars.length === 0) {
    if (params.nowMs >= expireAtMs) {
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: "expired",
          outcomeReason: "horizon_elapsed_no_data",
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            ...realizedMeta,
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: 0
          }
        }
      };
    }
    return null;
  }

  let maxFavorablePct = Number.NEGATIVE_INFINITY;
  let maxAdversePct = Number.POSITIVE_INFINITY;

  for (const bar of bars) {
    const favorable =
      signal === "down"
        ? ((entryPrice - bar.low) / entryPrice) * 100
        : ((bar.high - entryPrice) / entryPrice) * 100;
    const adverse =
      signal === "down"
        ? ((entryPrice - bar.high) / entryPrice) * 100
        : ((bar.low - entryPrice) / entryPrice) * 100;

    maxFavorablePct = Math.max(maxFavorablePct, favorable);
    maxAdversePct = Math.min(maxAdversePct, adverse);

    const tpHit = signal === "down" ? bar.low <= takeProfitPrice : bar.high >= takeProfitPrice;
    const slHit = signal === "down" ? bar.high >= stopLossPrice : bar.low <= stopLossPrice;

    if (tpHit || slHit) {
      const conservativeSlFirst = tpHit && slHit;
      const result = conservativeSlFirst ? "sl_hit" : tpHit ? "tp_hit" : "sl_hit";
      const settledPrice = result === "tp_hit" ? takeProfitPrice : stopLossPrice;
      const pnl = computeSignalPnlPct(signal, entryPrice, settledPrice);
      return {
        terminal: true,
        data: {
          outcomeStatus: "closed",
          outcomeResult: result,
          outcomeReason: conservativeSlFirst ? "both_hit_same_bar_conservative_sl" : "price_touched_level",
          outcomePnlPct: Number(pnl.toFixed(4)),
          maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
          maxAdversePct: Number(maxAdversePct.toFixed(4)),
          outcomeEvaluatedAt: new Date(),
          outcomeMeta: {
            ...realizedMeta,
            entryPrice,
            takeProfitPrice,
            stopLossPrice,
            evaluatedFrom: row.tsCreated.toISOString(),
            evaluatedTo: new Date(evaluationEndMs).toISOString(),
            barsScanned: bars.length
          }
        }
      };
    }
  }

  const pending = params.nowMs < expireAtMs;
  const lastClose = bars[bars.length - 1]?.close;
  const expiredPnl =
    Number.isFinite(lastClose) && lastClose > 0
      ? Number(computeSignalPnlPct(signal, entryPrice, lastClose).toFixed(4))
      : null;

  return {
    terminal: !pending,
    data: {
      outcomeStatus: pending ? "pending" : "closed",
      outcomeResult: pending ? null : "expired",
      outcomeReason: pending ? "awaiting_levels" : "horizon_elapsed",
      outcomePnlPct: pending ? null : expiredPnl,
      maxFavorablePct: Number(maxFavorablePct.toFixed(4)),
      maxAdversePct: Number(maxAdversePct.toFixed(4)),
      outcomeEvaluatedAt: new Date(),
      outcomeMeta: {
        ...realizedMeta,
        entryPrice,
        takeProfitPrice,
        stopLossPrice,
        evaluatedFrom: row.tsCreated.toISOString(),
        evaluatedTo: new Date(evaluationEndMs).toISOString(),
        barsScanned: bars.length,
        pending
      }
    }
  };
}

function readPrefillExchangeAccountId(snapshot: Record<string, unknown>): string | null {
  if (typeof snapshot.prefillExchangeAccountId !== "string") return null;
  const value = snapshot.prefillExchangeAccountId.trim();
  return value ? value : null;
}

function isAutoSchedulePaused(snapshot: Record<string, unknown>): boolean {
  const value = snapshot.autoSchedulePaused;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes", "paused"].includes(normalized);
  }
  return false;
}

function predictionTemplateKey(parts: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode?: PredictionSignalMode;
}): string {
  return `${parts.userId}:${parts.exchangeAccountId}:${parts.symbol}:${parts.marketType}:${parts.timeframe}:${parts.signalMode ?? "both"}`;
}

function withAutoScheduleFlag(
  featuresSnapshot: unknown,
  enabled: boolean
): Record<string, unknown> {
  const snapshot = asRecord(featuresSnapshot);
  return {
    ...snapshot,
    autoScheduleEnabled: enabled
  };
}

function normalizeTagList(value: unknown): string[] {
  return asStringArray(value)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function enforceNewsRiskTag(tags: unknown, featureSnapshot: unknown): string[] {
  const snapshot = asRecord(featureSnapshot);
  const hasNewsRisk = asBoolean(snapshot.newsRisk, false) || asBoolean(snapshot.news_risk, false);
  const normalized = normalizeTagList(tags).filter((tag) => tag !== "news_risk");
  if (hasNewsRisk) {
    normalized.unshift("news_risk");
  }
  return normalized.slice(0, 5);
}

type NewsRiskMode = "off" | "block";

function normalizeNewsRiskMode(value: unknown): NewsRiskMode {
  return value === "block" ? "block" : "off";
}

function readSnapshotNewsRiskFlag(featureSnapshot: unknown): boolean {
  const snapshot = asRecord(featureSnapshot);
  return asBoolean(snapshot.newsRisk, false) || asBoolean(snapshot.news_risk, false);
}

let cachedNewsRiskBlockGlobal: { value: boolean; expiresAt: number } | null = null;

async function readGlobalNewsRiskEnforcement(): Promise<boolean> {
  const now = Date.now();
  if (cachedNewsRiskBlockGlobal && now < cachedNewsRiskBlockGlobal.expiresAt) {
    return cachedNewsRiskBlockGlobal.value;
  }
  try {
    const config = await getEconomicCalendarConfig(db);
    const value = config.enforceNewsRiskBlock === true;
    cachedNewsRiskBlockGlobal = { value, expiresAt: now + 15_000 };
    return value;
  } catch {
    cachedNewsRiskBlockGlobal = { value: false, expiresAt: now + 5_000 };
    return false;
  }
}

function shouldBlockByNewsRisk(params: {
  featureSnapshot: unknown;
  globalEnabled: boolean;
  strategyMode: NewsRiskMode;
}): boolean {
  return Boolean(
    params.globalEnabled
    && params.strategyMode === "block"
    && readSnapshotNewsRiskFlag(params.featureSnapshot)
  );
}

function resolveStrategyNewsRiskMode(params: {
  strategyRef: PredictionStrategyRef | null;
  promptSettings?: { newsRiskMode?: unknown } | null;
  localStrategy?: { newsRiskMode?: unknown } | null;
  compositeStrategy?: { newsRiskMode?: unknown } | null;
}): NewsRiskMode {
  if (!params.strategyRef) return "off";
  if (params.strategyRef.kind === "ai") {
    return normalizeNewsRiskMode(params.promptSettings?.newsRiskMode);
  }
  if (params.strategyRef.kind === "local") {
    return normalizeNewsRiskMode(params.localStrategy?.newsRiskMode);
  }
  if (params.strategyRef.kind === "composite") {
    return normalizeNewsRiskMode(params.compositeStrategy?.newsRiskMode);
  }
  return "off";
}

function createNewsRiskBlockedExplanation(
  strategyMode: NewsRiskMode
): ExplainerOutput {
  return {
    explanation: "News blackout active; setup suspended.",
    tags: ["news_risk"],
    keyDrivers: [
      { name: "featureSnapshot.newsRisk", value: true },
      { name: "policy.newsRiskMode", value: strategyMode },
      { name: "policy.reasonCode", value: "news_risk_blocked" }
    ],
    aiPrediction: {
      signal: "neutral",
      expectedMovePct: 0,
      confidence: 0
    },
    disclaimer: "grounded_features_only"
  };
}

function normalizeKeyDriverList(
  value: unknown
): Array<{ name: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; value: unknown }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = String((item as Record<string, unknown>).name ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      value: (item as Record<string, unknown>).value
    });
    if (out.length >= 5) break;
  }
  return out;
}

function readPredictionStateLike(row: any): PredictionStateLike {
  return {
    id: String(row.id),
    signal: normalizePredictionSignal(row.signal),
    confidence: Number.isFinite(Number(row.confidence))
      ? Number(row.confidence)
      : 0,
    tags: normalizeTagList(row.tags),
    explanation: typeof row.explanation === "string" ? row.explanation : null,
    keyDrivers: normalizeKeyDriverList(row.keyDrivers),
    featureSnapshot: asRecord(row.featuresSnapshot),
    modelVersion:
      typeof row.modelVersion === "string" && row.modelVersion.trim()
        ? row.modelVersion
        : "baseline-v1",
    tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated : new Date(),
    lastAiExplainedAt:
      row.lastAiExplainedAt instanceof Date ? row.lastAiExplainedAt : null
  };
}

function readAiQualityGateState(row: any): AiQualityGateRollingState {
  const aiCallsLastHourRaw = Number(row?.aiGateCallsLastHour);
  const highPriorityCallsRaw = Number(row?.aiGateHighPriorityCallsLastHour);
  return {
    lastAiCallTs:
      row?.lastAiExplainedAt instanceof Date ? row.lastAiExplainedAt : null,
    lastExplainedPredictionHash:
      typeof row?.aiGateLastExplainedPredictionHash === "string"
      && row.aiGateLastExplainedPredictionHash.trim()
        ? row.aiGateLastExplainedPredictionHash
        : null,
    lastExplainedHistoryHash:
      typeof row?.aiGateLastExplainedHistoryHash === "string"
      && row.aiGateLastExplainedHistoryHash.trim()
        ? row.aiGateLastExplainedHistoryHash
        : null,
    lastAiDecisionHash:
      typeof row?.aiGateLastDecisionHash === "string"
      && row.aiGateLastDecisionHash.trim()
        ? row.aiGateLastDecisionHash
        : null,
    windowStartedAt:
      row?.aiGateWindowStartedAt instanceof Date ? row.aiGateWindowStartedAt : null,
    aiCallsLastHour: Number.isFinite(aiCallsLastHourRaw) ? Math.max(0, Math.trunc(aiCallsLastHourRaw)) : 0,
    highPriorityCallsLastHour:
      Number.isFinite(highPriorityCallsRaw) ? Math.max(0, Math.trunc(highPriorityCallsRaw)) : 0
  };
}

function readAiQualityGateConfig(config: IndicatorSettingsConfig): {
  enabled: boolean;
  minConfidenceForExplain: number;
  minConfidenceForNeutralExplain: number;
  confidenceJumpThreshold: number;
  keyLevelNearPct: number;
  recentEventBars: Record<PredictionTimeframe, number>;
  highImportanceMin: number;
  aiCooldownSec: Record<PredictionTimeframe, number>;
  maxHighPriorityPerHour: number;
} {
  const gate = config.aiGating;
  return {
    enabled: Boolean(gate.enabled),
    minConfidenceForExplain: Number(gate.minConfidenceForExplain),
    minConfidenceForNeutralExplain: Number(gate.minConfidenceForNeutralExplain),
    confidenceJumpThreshold: Number(gate.confidenceJumpThreshold),
    keyLevelNearPct: Number(gate.keyLevelNearPct),
    recentEventBars: {
      "5m": Number(gate.recentEventBars["5m"]),
      "15m": Number(gate.recentEventBars["15m"]),
      "1h": Number(gate.recentEventBars["1h"]),
      "4h": Number(gate.recentEventBars["4h"]),
      "1d": Number(gate.recentEventBars["1d"])
    },
    highImportanceMin: Number(gate.highImportanceMin),
    aiCooldownSec: {
      "5m": Number(gate.aiCooldownSec["5m"]),
      "15m": Number(gate.aiCooldownSec["15m"]),
      "1h": Number(gate.aiCooldownSec["1h"]),
      "4h": Number(gate.aiCooldownSec["4h"]),
      "1d": Number(gate.aiCooldownSec["1d"])
    },
    maxHighPriorityPerHour: Number(gate.maxHighPriorityPerHour)
  };
}

function predictionStateTemplateKey(parts: {
  userId: string;
  exchangeAccountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
}): string {
  return `${parts.userId}:${parts.exchangeAccountId}:${parts.symbol}:${parts.marketType}:${parts.timeframe}`;
}

async function resolvePredictionTemplateScope(userId: string, predictionId: string): Promise<{
  rowId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
  signalMode: PredictionSignalMode;
  strategyRef: PredictionStrategyRef | null;
} | null> {
  const row = await db.prediction.findFirst({
    where: {
      id: predictionId,
      userId
    },
    select: {
      id: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      featuresSnapshot: true
    }
  });
  if (!row) return null;

  const snapshot = asRecord(row.featuresSnapshot);
  const symbol = normalizeSymbolInput(row.symbol);
  if (!symbol) return null;
  return {
    rowId: row.id,
    symbol,
    marketType: normalizePredictionMarketType(row.marketType),
    timeframe: normalizePredictionTimeframe(row.timeframe),
    exchangeAccountId: readPrefillExchangeAccountId(snapshot),
    signalMode: readSignalMode(snapshot),
    strategyRef: readPredictionStrategyRef(snapshot)
  };
}

async function findPredictionTemplateRowIds(userId: string, scope: {
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  exchangeAccountId: string | null;
  signalMode?: PredictionSignalMode | null;
  strategyRef?: PredictionStrategyRef | null;
}): Promise<string[]> {
  const rows = await db.prediction.findMany({
    where: {
      userId,
      symbol: scope.symbol,
      marketType: scope.marketType,
      timeframe: scope.timeframe
    },
    select: {
      id: true,
      featuresSnapshot: true
    }
  });

  return rows
    .filter((row: any) => {
      const snapshot = asRecord(row.featuresSnapshot);
      if (readPrefillExchangeAccountId(snapshot) !== scope.exchangeAccountId) return false;
      if (scope.signalMode && readSignalMode(snapshot) !== scope.signalMode) return false;
      if (scope.strategyRef !== undefined) {
        const rowStrategyRef = readPredictionStrategyRef(snapshot);
        const expected = scope.strategyRef;
        const mismatch = !expected
          ? Boolean(rowStrategyRef)
          : !rowStrategyRef
            || rowStrategyRef.kind !== expected.kind
            || rowStrategyRef.id !== expected.id;
        if (mismatch) return false;
      }
      return true;
    })
    .map((row: any) => row.id);
}

function setFeatureSnapshotStrategyRef(
  snapshot: Record<string, unknown>,
  strategyRef: PredictionStrategyRef | null
): Record<string, unknown> {
  if (!strategyRef) {
    return {
      ...snapshot,
      strategyRef: null,
      localStrategyId: null,
      localStrategyName: null,
      compositeStrategyId: null,
      compositeStrategyName: null
    };
  }
  return {
    ...snapshot,
    strategyRef: {
      kind: strategyRef.kind,
      id: strategyRef.id,
      name: strategyRef.name
    },
    localStrategyId: strategyRef.kind === "local" ? strategyRef.id : null,
    localStrategyName: strategyRef.kind === "local" ? strategyRef.name : null,
    compositeStrategyId: strategyRef.kind === "composite" ? strategyRef.id : null,
    compositeStrategyName: strategyRef.kind === "composite" ? strategyRef.name : null,
    aiPromptTemplateId: strategyRef.kind === "ai" ? strategyRef.id : readAiPromptTemplateId(snapshot),
    aiPromptTemplateName: strategyRef.kind === "ai" ? strategyRef.name : readAiPromptTemplateName(snapshot)
  };
}

async function findPredictionStateIdByScope(params: {
  userId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
  strategyRef?: PredictionStrategyRef | null;
}): Promise<string | null> {
  const strategyScope = toPredictionStateStrategyScope(params.strategyRef ?? null);
  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      exchange: params.exchange,
      accountId: params.accountId,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      signalMode: params.signalMode,
      strategyKind: strategyScope.strategyKind,
      strategyId: strategyScope.strategyId
    },
    select: {
      id: true
    }
  });
  return row ? String(row.id) : null;
}

async function findPredictionStateIdByLegacyScope(params: {
  userId: string;
  exchange: string;
  accountId: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
}): Promise<string | null> {
  const row = await db.predictionState.findFirst({
    where: {
      userId: params.userId,
      exchange: params.exchange,
      accountId: params.accountId,
      symbol: params.symbol,
      marketType: params.marketType,
      timeframe: params.timeframe,
      signalMode: params.signalMode
    },
    select: { id: true }
  });
  return row ? String(row.id) : null;
}

async function persistPredictionState(params: {
  existingStateId: string | null;
  stateData: Record<string, unknown>;
  scope: {
    userId: string;
    exchange: string;
    accountId: string;
    symbol: string;
    marketType: PredictionMarketType;
    timeframe: PredictionTimeframe;
    signalMode: PredictionSignalMode;
  };
}): Promise<{ id: string }> {
  if (params.existingStateId) {
    try {
      return await db.predictionState.update({
        where: { id: params.existingStateId },
        data: params.stateData,
        select: { id: true }
      });
    } catch (error) {
      if ((error as any)?.code !== "P2025") {
        throw error;
      }
    }
  }

  try {
    return await db.predictionState.create({
      data: params.stateData,
      select: { id: true }
    });
  } catch (error) {
    if ((error as any)?.code !== "P2002") {
      throw error;
    }

    const legacyStateId = await findPredictionStateIdByLegacyScope(params.scope);
    if (!legacyStateId) {
      throw error;
    }
    return await db.predictionState.update({
      where: { id: legacyStateId },
      data: params.stateData,
      select: { id: true }
    });
  }
}

let predictionAutoTimer: NodeJS.Timeout | null = null;
let predictionAutoRunning = false;
const predictionTriggerDebounceState = new Map<string, TriggerDebounceState>();
let predictionRefreshRuntimeSettings: PredictionRefreshSettingsPublic =
  toEffectivePredictionRefreshSettings(null);
let predictionOutcomeEvalTimer: NodeJS.Timeout | null = null;
let predictionOutcomeEvalRunning = false;
let predictionPerformanceEvalTimer: NodeJS.Timeout | null = null;
let predictionPerformanceEvalRunning = false;

async function runPredictionOutcomeEvalCycle() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  if (predictionOutcomeEvalRunning) return;
  predictionOutcomeEvalRunning = true;

  try {
    const rows = await db.prediction.findMany({
      where: {
        userId: { not: null },
        outcomeStatus: "pending"
      },
      orderBy: [{ tsCreated: "asc" }],
      take: PREDICTION_OUTCOME_EVAL_BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        symbol: true,
        marketType: true,
        timeframe: true,
        signal: true,
        tsCreated: true,
        entryPrice: true,
        stopLossPrice: true,
        takeProfitPrice: true,
        horizonMs: true,
        tags: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomeResult: true
      }
    });

    if (rows.length === 0) return;

    const defaultAccountByUser = new Map<string, string | null>();
    const grouped = new Map<string, Array<any>>();

    for (const row of rows) {
      const userId = typeof row.userId === "string" ? row.userId : null;
      if (!userId) continue;

      const snapshot = asRecord(row.featuresSnapshot);
      let exchangeAccountId = readPrefillExchangeAccountId(snapshot);

      if (!exchangeAccountId) {
        if (!defaultAccountByUser.has(userId)) {
          const defaultAccount = await db.exchangeAccount.findFirst({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
          });
          defaultAccountByUser.set(userId, defaultAccount?.id ?? null);
        }
        exchangeAccountId = defaultAccountByUser.get(userId) ?? null;
      }

      if (!exchangeAccountId) {
        await db.prediction.update({
          where: { id: row.id },
          data: {
            outcomeStatus: "closed",
            outcomeResult: "invalid",
            outcomeReason: "missing_exchange_account",
            outcomeEvaluatedAt: new Date()
          }
        });
        continue;
      }

      const key = `${userId}:${exchangeAccountId}`;
      const list = grouped.get(key) ?? [];
      list.push({
        ...row,
        userId,
        exchangeAccountId
      });
      grouped.set(key, list);
    }

    const nowMs = Date.now();
    for (const [key, groupRows] of grouped.entries()) {
      const [userId, exchangeAccountId] = key.split(":");
      let perpClient: PerpMarketDataClient | null = null;
      try {
        const runtime = await createResolvedPollingPerpMarketDataRuntime(
          userId,
          exchangeAccountId,
          "predictions/outcome-eval"
        );
        const accountLabel = runtime.context.selectedAccount.label;
        perpClient = runtime.client;

        for (const row of groupRows) {
          const timeframe = normalizePredictionTimeframe(row.timeframe);
          const signal = normalizePredictionSignal(row.signal);
          const symbol = normalizeSymbolInput(row.symbol);
          if (!symbol) continue;

          const horizonMs = row.horizonMs ?? timeframeToIntervalMs(timeframe) * PREDICTION_OUTCOME_HORIZON_BARS;
          const endTime = Math.min(nowMs, row.tsCreated.getTime() + Math.max(60_000, horizonMs));
          const candlesRaw = await perpClient.getCandles({
            symbol,
            timeframe,
            granularity: timeframeToBitgetGranularity(timeframe),
            startTime: row.tsCreated.getTime(),
            endTime,
            limit: 500
          });
          const candles = parseBitgetCandles(candlesRaw);

          const evaluation = evaluatePredictionOutcomeFromCandles({
            row: {
              signal,
              timeframe,
              tsCreated: row.tsCreated,
              entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
              stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
              takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
              horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
              featuresSnapshot: row.featuresSnapshot,
              outcomeMeta: row.outcomeMeta
            },
            candles,
            nowMs
          });

          if (!evaluation) continue;
          const nextOutcomeResultRaw = evaluation.data.outcomeResult;
          const nextOutcomeResult =
            nextOutcomeResultRaw === "tp_hit" || nextOutcomeResultRaw === "sl_hit"
              ? nextOutcomeResultRaw
              : null;
          const previousOutcomeMeta = asRecord(row.outcomeMeta);
          const alreadySentResult = typeof previousOutcomeMeta.outcomeAlertResult === "string"
            ? previousOutcomeMeta.outcomeAlertResult
            : null;
          const alreadySentAt = typeof previousOutcomeMeta.outcomeAlertSentAt === "string"
            ? previousOutcomeMeta.outcomeAlertSentAt
            : null;
          const shouldNotifyOutcome =
            nextOutcomeResult !== null &&
            !(alreadySentAt && alreadySentResult === nextOutcomeResult) &&
            row.outcomeResult !== nextOutcomeResult;
          await db.prediction.update({
            where: { id: row.id },
            data: evaluation.data
          });

          if (shouldNotifyOutcome && PREDICTION_OUTCOME_TELEGRAM_ENABLED) {
            const outcomePnlRaw = evaluation.data.outcomePnlPct;
            const outcomePnlPct = Number.isFinite(Number(outcomePnlRaw))
              ? Number(outcomePnlRaw)
              : null;
            const sent = await dispatchPredictionOutcomeNotification({
              userId,
              exchangeAccountLabel: accountLabel,
              symbol,
              marketType: row.marketType === "spot" ? "spot" : "perp",
              timeframe,
              signal,
              predictionId: row.id,
              outcomeResult: nextOutcomeResult,
              outcomePnlPct,
              tags: normalizeTagList(row.tags)
            });
            if (sent) {
              const nextMeta = asRecord(evaluation.data.outcomeMeta);
              await db.prediction.update({
                where: { id: row.id },
                data: {
                  outcomeMeta: {
                    ...nextMeta,
                    outcomeAlertSentAt: new Date().toISOString(),
                    outcomeAlertResult: nextOutcomeResult,
                    outcomeAlertSignalId: row.id
                  }
                }
              });
            }
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:outcome] cycle group failed", { key, reason: String(error) });
      } finally {
        if (perpClient) {
          await perpClient.close();
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:outcome] scheduler cycle failed", String(error));
  } finally {
    predictionOutcomeEvalRunning = false;
  }
}

async function runPredictionPerformanceEvalCycle() {
  if (!PREDICTION_EVALUATOR_ENABLED) return;
  if (predictionPerformanceEvalRunning) return;
  predictionPerformanceEvalRunning = true;

  try {
    const nowMs = Date.now();
    const cutoffMs = nowMs - PREDICTION_EVALUATOR_SAFETY_LAG_MS;
    const rawRows = await db.prediction.findMany({
      where: {
        userId: { not: null },
        tsCreated: { lte: new Date(cutoffMs) }
      },
      orderBy: [{ tsCreated: "asc" }],
      take: Math.max(PREDICTION_EVALUATOR_BATCH_SIZE * 4, PREDICTION_EVALUATOR_BATCH_SIZE),
      select: {
        id: true,
        userId: true,
        symbol: true,
        timeframe: true,
        signal: true,
        expectedMovePct: true,
        confidence: true,
        tsCreated: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomeEvaluatedAt: true
      }
    });
    if (rawRows.length === 0) return;

    const candidates = rawRows
      .filter((row: any) => typeof row.userId === "string" && row.userId.trim())
      .filter((row: any) => {
        const realized = readRealizedPayloadFromOutcomeMeta(row.outcomeMeta);
        if (realized.evaluatedAt) return false;
        const timeframe = normalizePredictionTimeframe(row.timeframe);
        const horizonEndMs = row.tsCreated.getTime() + timeframeToIntervalMs(timeframe);
        return horizonEndMs <= cutoffMs;
      })
      .slice(0, PREDICTION_EVALUATOR_BATCH_SIZE);
    if (candidates.length === 0) return;

    const defaultAccountByUser = new Map<string, string | null>();
    const grouped = new Map<string, Array<any>>();
    for (const row of candidates) {
      const userId = row.userId as string;
      const snapshot = asRecord(row.featuresSnapshot);
      let exchangeAccountId = readPrefillExchangeAccountId(snapshot);

      if (!exchangeAccountId) {
        if (!defaultAccountByUser.has(userId)) {
          const defaultAccount = await db.exchangeAccount.findFirst({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
          });
          defaultAccountByUser.set(userId, defaultAccount?.id ?? null);
        }
        exchangeAccountId = defaultAccountByUser.get(userId) ?? null;
      }

      if (!exchangeAccountId) {
        const existingMeta = asRecord(row.outcomeMeta);
        await db.prediction.update({
          where: { id: row.id },
          data: {
            outcomeMeta: {
              ...existingMeta,
              realizedEvaluatedAt: new Date(nowMs).toISOString(),
              evaluatorVersion: "close_to_close_v1",
              errorMetrics: {
                ...asRecord(existingMeta.errorMetrics),
                hit: null,
                absError: null,
                sqError: null,
                reason: "missing_exchange_account"
              }
            }
          }
        });
        continue;
      }

      const key = `${userId}:${exchangeAccountId}`;
      const list = grouped.get(key) ?? [];
      list.push({
        ...row,
        userId,
        exchangeAccountId
      });
      grouped.set(key, list);
    }

    let evaluatedCount = 0;
    for (const [key, groupRows] of grouped.entries()) {
      const [userId, exchangeAccountId] = key.split(":");
      let perpClient: PerpMarketDataClient | null = null;

      try {
        const runtime = await createResolvedPollingPerpMarketDataRuntime(
          userId,
          exchangeAccountId,
          "predictions/performance-eval"
        );
        perpClient = runtime.client;

        for (const row of groupRows) {
          const timeframe = normalizePredictionTimeframe(row.timeframe);
          const signal = normalizePredictionSignal(row.signal);
          const symbol = normalizeSymbolInput(row.symbol);
          if (!symbol) continue;

          const tfMs = timeframeToIntervalMs(timeframe);
          const startTsMs = row.tsCreated.getTime();
          const horizonEndMs = startTsMs + tfMs;
          const startBucketMs = toBucketStart(startTsMs, timeframe);
          const endBucketMs = toBucketStart(horizonEndMs, timeframe);

          const candlesRaw = await perpClient.getCandles({
            symbol,
            timeframe,
            granularity: timeframeToBitgetGranularity(timeframe),
            startTime: Math.max(0, startBucketMs - tfMs),
            endTime: endBucketMs + tfMs * 2,
            limit: 500
          });
          const candles = bucketCandles(parseBitgetCandles(candlesRaw), timeframe) as CandleBar[];
          if (candles.length === 0) continue;

          const startCandle =
            candles.find((bar) => (bar.ts ?? 0) >= startBucketMs) ?? candles[candles.length - 1];
          const endCandleFromPast = [...candles]
            .reverse()
            .find((bar) => (bar.ts ?? 0) <= endBucketMs);
          const endCandle =
            endCandleFromPast ??
            candles.find((bar) => (bar.ts ?? 0) >= endBucketMs) ??
            candles[candles.length - 1];

          const startClose = Number(startCandle?.close);
          const endClose = Number(endCandle?.close);
          if (!Number.isFinite(startClose) || startClose <= 0) continue;
          if (!Number.isFinite(endClose) || endClose <= 0) continue;

          const realizedReturnPct = computeDirectionalRealizedReturnPct(signal, startClose, endClose);
          const err = computePredictionErrorMetrics({
            signal,
            expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
              ? Number(row.expectedMovePct)
              : null,
            realizedReturnPct
          });

          const existingMeta = asRecord(row.outcomeMeta);
          const evaluatedAt = new Date();
          await db.prediction.update({
            where: { id: row.id },
            data: {
              outcomeEvaluatedAt: row.outcomeEvaluatedAt ?? evaluatedAt,
              outcomeMeta: {
                ...existingMeta,
                realizedReturnPct: Number(realizedReturnPct.toFixed(4)),
                realizedEvaluatedAt: evaluatedAt.toISOString(),
                realizedStartClose: Number(startClose.toFixed(6)),
                realizedEndClose: Number(endClose.toFixed(6)),
                realizedStartBucketMs: startBucketMs,
                realizedEndBucketMs: endBucketMs,
                predictedMovePct:
                  typeof err.predictedMovePct === "number"
                    ? Number(err.predictedMovePct.toFixed(4))
                    : null,
                evaluatorVersion: "close_to_close_v1",
                errorMetrics: {
                  ...asRecord(existingMeta.errorMetrics),
                  hit: err.hit,
                  absError:
                    typeof err.absError === "number" ? Number(err.absError.toFixed(4)) : null,
                  sqError: typeof err.sqError === "number" ? Number(err.sqError.toFixed(4)) : null
                }
              }
            }
          });
          evaluatedCount += 1;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:evaluator] cycle group failed", { key, reason: String(error) });
      } finally {
        if (perpClient) await perpClient.close();
      }
    }

    if (evaluatedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[predictions:evaluator] evaluated ${evaluatedCount} prediction(s)`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:evaluator] scheduler cycle failed", String(error));
  } finally {
    predictionPerformanceEvalRunning = false;
  }
}

type PredictionRefreshTemplate = {
  stateId: string;
  userId: string;
  exchangeAccountId: string;
  exchange: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signalMode: PredictionSignalMode;
  directionPreference: DirectionPreference;
  confidenceTargetPct: number;
  leverage: number | null;
  autoScheduleEnabled: boolean;
  autoSchedulePaused: boolean;
  tsUpdated: Date;
  featureSnapshot: Record<string, unknown>;
  aiPromptTemplateId: string | null;
  aiPromptTemplateName: string | null;
  localStrategyId: string | null;
  localStrategyName: string | null;
  compositeStrategyId: string | null;
  compositeStrategyName: string | null;
  strategyRef: PredictionStrategyRef | null;
  modelVersionBase: string;
};

type StrategyRunSummary = {
  strategyRef: PredictionStrategyRef | null;
  status: "ok" | "fallback" | "error" | "skipped";
  signal: PredictionSignal;
  expectedMovePct: number;
  confidence: number;
  source: PredictionSignalSource;
  aiCalled: boolean;
  explanation: string;
  tags: string[];
  keyDrivers: Array<{ name: string; value: unknown }>;
  ts: string;
};

let predictionStateBootstrapped = false;

function resolveRequestedStrategyRefForTemplate(
  template: PredictionRefreshTemplate
): PredictionStrategyRef | null {
  if (template.strategyRef) {
    return {
      kind: template.strategyRef.kind,
      id: template.strategyRef.id,
      name: template.strategyRef.name ?? null
    };
  }
  if (template.compositeStrategyId) {
    return {
      kind: "composite",
      id: template.compositeStrategyId,
      name: template.compositeStrategyName ?? null
    };
  }
  if (template.localStrategyId) {
    return {
      kind: "local",
      id: template.localStrategyId,
      name: template.localStrategyName ?? null
    };
  }
  if (template.aiPromptTemplateId) {
    return {
      kind: "ai",
      id: template.aiPromptTemplateId,
      name: template.aiPromptTemplateName ?? null
    };
  }
  return null;
}

function withStrategyRunSnapshot(
  snapshot: Record<string, unknown>,
  summary: StrategyRunSummary,
  debug: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...setFeatureSnapshotStrategyRef(snapshot, summary.strategyRef),
    strategyRunOutput: {
      strategyRef: summary.strategyRef,
      status: summary.status,
      signal: summary.signal,
      expectedMovePct: Number(clamp(summary.expectedMovePct, 0, 25).toFixed(2)),
      confidence: Number(clamp(summary.confidence, 0, 1).toFixed(4)),
      source: summary.source,
      aiCalled: summary.aiCalled,
      explanation: typeof summary.explanation === "string" ? summary.explanation : "",
      tags: normalizeTagList(summary.tags),
      keyDrivers: normalizeKeyDriverList(summary.keyDrivers),
      ts: summary.ts
    },
    strategyRunDebug: debug ?? null
  };
}

async function bootstrapPredictionStateFromHistory() {
  if (predictionStateBootstrapped) return;

  const rows = await db.prediction.findMany({
    where: {
      userId: { not: null }
    },
    orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
    take: Math.max(200, PREDICTION_REFRESH_SCAN_LIMIT * 2),
    select: {
      id: true,
      userId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      tsCreated: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      explanation: true,
      tags: true,
      featuresSnapshot: true,
      modelVersion: true
    }
  });

  const nowMs = Date.now();
  let staleTemplatesDisabled = 0;

  for (const row of rows) {
    const userId = typeof row.userId === "string" ? row.userId : null;
    if (!userId) continue;

    const featureSnapshot = asRecord(row.featuresSnapshot);
    const autoEnabled = isAutoScheduleEnabled(featureSnapshot.autoScheduleEnabled);
    if (!autoEnabled) continue;
    const autoPaused = isAutoSchedulePaused(featureSnapshot);
    const exchangeAccountId = readPrefillExchangeAccountId(featureSnapshot);
    if (!exchangeAccountId) continue;

    const symbol = normalizeSymbolInput(row.symbol);
    if (!symbol) continue;

    const marketType = normalizePredictionMarketType(row.marketType);
    const timeframe = normalizePredictionTimeframe(row.timeframe);
    const staleBootstrapThresholdMs = Math.max(
      refreshIntervalMsForTimeframe(timeframe) * 2,
      15 * 60 * 1000
    );
    const ageMs = nowMs - row.tsCreated.getTime();
    if (Number.isFinite(ageMs) && ageMs > staleBootstrapThresholdMs) {
      await db.prediction.update({
        where: { id: row.id },
        data: {
          featuresSnapshot: {
            ...featureSnapshot,
            autoScheduleEnabled: false,
            autoSchedulePaused: false,
            autoScheduleDeleted: true,
            autoScheduleDeletedReason: "stale_bootstrap_orphan",
            autoScheduleDeletedAt: new Date().toISOString()
          }
        }
      });
      staleTemplatesDisabled += 1;
      continue;
    }
    const exchange =
      typeof featureSnapshot.prefillExchange === "string"
        ? normalizeExchangeValue(featureSnapshot.prefillExchange)
        : "bitget";
    const signalMode = readSignalMode(featureSnapshot);
    const strategyRef = readPredictionStrategyRef(featureSnapshot);
    const existingId = await findPredictionStateIdByScope({
      userId,
      exchange,
      accountId: exchangeAccountId,
      symbol,
      marketType,
      timeframe,
      signalMode,
      strategyRef
    });
    const existing = existingId ? { id: existingId } : null;
    if (existing) continue;

    const tags = normalizeTagList(row.tags);
    const keyDrivers = normalizeKeyDriverList(featureSnapshot.keyDrivers);
    const changeHash = buildPredictionChangeHash({
      signal: normalizePredictionSignal(row.signal),
      confidence: Number(row.confidence),
      tags,
      keyDrivers,
      featureSnapshot
    });

    await persistPredictionState({
      existingStateId: existingId,
      stateData: {
        ...toPredictionStateStrategyScope(strategyRef),
        exchange,
        accountId: exchangeAccountId,
        userId,
        symbol,
        marketType,
        timeframe,
        signalMode,
        tsUpdated: row.tsCreated,
        tsPredictedFor: new Date(row.tsCreated.getTime() + timeframeToIntervalMs(timeframe)),
        signal: normalizePredictionSignal(row.signal),
        expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
          ? Number(row.expectedMovePct)
          : null,
        confidence: Number.isFinite(Number(row.confidence))
          ? Number(row.confidence)
          : 0,
        tags,
        explanation: typeof row.explanation === "string" ? row.explanation : null,
        keyDrivers,
        featuresSnapshot: featureSnapshot,
        modelVersion:
          typeof row.modelVersion === "string" && row.modelVersion.trim()
            ? row.modelVersion
            : "baseline-v1",
        lastAiExplainedAt: row.tsCreated,
        lastChangeHash: changeHash,
        lastChangeReason: "bootstrap",
        autoScheduleEnabled: autoEnabled,
        autoSchedulePaused: autoPaused,
        directionPreference: parseDirectionPreference(featureSnapshot.directionPreference),
        confidenceTargetPct: readConfidenceTarget(featureSnapshot),
        leverage: readRequestedLeverage(featureSnapshot)
      },
      scope: {
        userId,
        exchange,
        accountId: exchangeAccountId,
        symbol,
        marketType,
        timeframe,
        signalMode
      }
    });
  }

  if (staleTemplatesDisabled > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[predictions:bootstrap] disabled ${staleTemplatesDisabled} stale orphan auto-template row(s)`
    );
  }

  predictionStateBootstrapped = true;
}

async function listPredictionRefreshTemplates(): Promise<PredictionRefreshTemplate[]> {
  const rows = await db.predictionState.findMany({
    orderBy: [{ tsUpdated: "asc" }, { updatedAt: "asc" }],
    take: PREDICTION_REFRESH_SCAN_LIMIT,
    select: {
      id: true,
      userId: true,
      accountId: true,
      exchange: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signalMode: true,
      directionPreference: true,
      confidenceTargetPct: true,
      leverage: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      tsUpdated: true,
      featuresSnapshot: true,
      modelVersion: true
    }
  });

  return rows
    .map((row: any): PredictionRefreshTemplate | null => {
      const userId = typeof row.userId === "string" ? row.userId : null;
      const exchangeAccountId =
        typeof row.accountId === "string" && row.accountId.trim()
          ? row.accountId.trim()
          : null;
      const symbol = normalizeSymbolInput(row.symbol);
      if (!userId || !exchangeAccountId || !symbol) return null;
      const marketType = normalizePredictionMarketType(row.marketType);
      const timeframe = normalizePredictionTimeframe(row.timeframe);
      const snapshot = asRecord(row.featuresSnapshot);
      const signalMode = readStateSignalMode(row.signalMode, snapshot);

      return {
        stateId: String(row.id),
        userId,
        exchangeAccountId,
        exchange:
          typeof row.exchange === "string" && row.exchange.trim()
            ? normalizeExchangeValue(row.exchange)
            : "bitget",
        symbol,
        marketType,
        timeframe,
        signalMode,
        directionPreference: parseDirectionPreference(
          row.directionPreference ?? snapshot.directionPreference
        ),
        confidenceTargetPct: Number.isFinite(Number(row.confidenceTargetPct))
          && row.confidenceTargetPct !== null
          && row.confidenceTargetPct !== undefined
          ? Number(row.confidenceTargetPct)
          : readConfidenceTarget(snapshot),
        leverage:
          Number.isFinite(Number(row.leverage))
          && row.leverage !== null
          && row.leverage !== undefined
            ? Math.max(1, Math.trunc(Number(row.leverage)))
            : (readRequestedLeverage(snapshot) ?? null),
        autoScheduleEnabled: Boolean(row.autoScheduleEnabled),
        autoSchedulePaused: Boolean(row.autoSchedulePaused),
        tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated : new Date(),
        featureSnapshot: {
          ...snapshot,
          signalMode
        },
        aiPromptTemplateId: readAiPromptTemplateId(snapshot),
        aiPromptTemplateName: readAiPromptTemplateName(snapshot),
        localStrategyId: readLocalStrategyId(snapshot),
        localStrategyName: readLocalStrategyName(snapshot),
        compositeStrategyId: readCompositeStrategyId(snapshot),
        compositeStrategyName: readCompositeStrategyName(snapshot),
        strategyRef: readPredictionStrategyRef(snapshot),
        modelVersionBase:
          typeof row.modelVersion === "string" && row.modelVersion.trim()
            ? row.modelVersion
            : "baseline-v1:auto-market-v1"
      };
    })
    .filter((item: PredictionRefreshTemplate | null): item is PredictionRefreshTemplate => Boolean(item));
}

async function refreshPredictionRefreshRuntimeSettingsFromDb() {
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_PREDICTION_REFRESH_KEY },
    select: { value: true }
  });
  const stored = parseStoredPredictionRefreshSettings(row?.value);
  predictionRefreshRuntimeSettings = toEffectivePredictionRefreshSettings(stored);
}

async function resolveGlobalPredictionRefreshIntervalsMs(): Promise<PredictionRefreshIntervalsMs> {
  const fallbackIntervalsMs = refreshIntervalsMsFromSec();
  try {
    const indicatorSettingsResolution = await resolveIndicatorSettings({ db });
    const globalBreakdown = indicatorSettingsResolution.breakdown.find(
      (item) => item.scopeType === "global"
    );
    if (!globalBreakdown || !db?.indicatorSetting || typeof db.indicatorSetting.findUnique !== "function") {
      return fallbackIntervalsMs;
    }
    const globalRow = await db.indicatorSetting.findUnique({
      where: { id: globalBreakdown.id },
      select: { configJson: true }
    });
    const refreshIntervalPatch = asRecord(
      asRecord(asRecord(globalRow?.configJson).aiGating).refreshIntervalSec
    );
    if (Object.keys(refreshIntervalPatch).length === 0) {
      return fallbackIntervalsMs;
    }
    return refreshIntervalsMsFromSec(refreshIntervalPatch);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[predictions:refresh] failed to resolve global refresh intervals, using env defaults", {
      reason: String(error)
    });
    return fallbackIntervalsMs;
  }
}

function resolveTemplateAutoCadenceGate(
  template: Pick<PredictionRefreshTemplate, "timeframe" | "featureSnapshot" | "tsUpdated">,
  refreshIntervalsMs: PredictionRefreshIntervalsMs,
  nowMs: number
): {
  isMarketAnalysis: boolean;
  runTimeframe: PredictionTimeframe;
  elapsedMs: number;
  requiredMs: number;
  blocked: boolean;
} {
  const isMarketAnalysis = isMarketAnalysisSnapshot(template.featureSnapshot);
  const runTimeframe = resolveRunTimeframeForCadence(
    template.timeframe,
    template.featureSnapshot
  );
  const requiredMs = resolveEffectiveAutoRefreshIntervalMs({
    timeframe: template.timeframe,
    runTimeframe,
    isMarketAnalysis,
    configuredIntervalsMs: refreshIntervalsMs
  });
  const elapsedMs = Math.max(0, nowMs - template.tsUpdated.getTime());
  return {
    isMarketAnalysis,
    runTimeframe,
    elapsedMs,
    requiredMs,
    blocked: isMarketAnalysis && elapsedMs < requiredMs
  };
}

function logAnalysisCadenceBlock(params: {
  stage: "scheduler_probe_filter" | "trigger_probe_guard" | "refresh_guard";
  stateId: string;
  symbol: string;
  timeframe: PredictionTimeframe;
  runTimeframe: PredictionTimeframe;
  elapsedMs: number;
  requiredMs: number;
}) {
  // eslint-disable-next-line no-console
  console.info("[predictions:refresh] analysis cadence blocked", {
    reason: "analysis_min_interval_blocked",
    stage: params.stage,
    stateId: params.stateId,
    symbol: params.symbol,
    timeframe: params.timeframe,
    runTimeframe: params.runTimeframe,
    elapsedMs: params.elapsedMs,
    requiredMs: params.requiredMs
  });
}

async function probePredictionRefreshTrigger(
  template: PredictionRefreshTemplate,
  refreshIntervalsMs: PredictionRefreshIntervalsMs
): Promise<{ refresh: boolean; reasons: string[] }> {
  let perpClient: PerpMarketDataClient | null = null;
  try {
    const cadence = resolveTemplateAutoCadenceGate(template, refreshIntervalsMs, Date.now());
    if (cadence.blocked) {
      logAnalysisCadenceBlock({
        stage: "trigger_probe_guard",
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        runTimeframe: cadence.runTimeframe,
        elapsedMs: cadence.elapsedMs,
        requiredMs: cadence.requiredMs
      });
      return { refresh: false, reasons: [] };
    }

    const runtime = await createResolvedPollingPerpMarketDataRuntime(
      template.userId,
      template.exchangeAccountId,
      "predictions/probe-refresh-trigger"
    );
    perpClient = runtime.client;
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: template.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);

    const lookback = resolvePredictionCandleLookback({
      timeframe: template.timeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 80
    });
    const candlesRaw = await perpClient.getCandles({
      symbol: template.symbol,
      timeframe: template.timeframe,
      granularity: timeframeToBitgetGranularity(template.timeframe),
      limit: lookback
    });
    const candles = bucketCandles(parseBitgetCandles(candlesRaw), template.timeframe);
    if (candles.length < 40) {
      return { refresh: false, reasons: [] };
    }

    const closes = candles.map((row) => row.close);
    const highs = candles.map((row) => row.high);
    const lows = candles.map((row) => row.low);
    const indicators = computeIndicators(candles, template.timeframe, {
      exchange: template.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      logVwapMetrics: false,
      settings: indicatorComputeSettings
    });
    const tickerRaw = await perpClient.getTicker(template.symbol);
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice)) {
      return { refresh: false, reasons: [] };
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: template.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: template.timeframe,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? undefined,
      marketType: template.marketType,
      exchangeAccountId: template.exchangeAccountId,
      exchange: template.exchange,
      thresholdResolution
    });

    const trigger = shouldRefreshTF({
      timeframe: template.timeframe,
      nowMs: Date.now(),
      lastUpdatedMs: template.tsUpdated.getTime(),
      refreshIntervalMs: cadence.requiredMs,
      previousFeatureSnapshot: template.featureSnapshot,
      currentFeatureSnapshot: inferred.featureSnapshot,
      previousTriggerState: predictionTriggerDebounceState.get(template.stateId) ?? null,
      triggerDebounceSec: predictionRefreshRuntimeSettings.triggerDebounceSec,
      hysteresisRatio: predictionRefreshRuntimeSettings.hysteresisRatio
    });
    predictionTriggerDebounceState.set(template.stateId, trigger.triggerState);
    return {
      refresh: trigger.refresh,
      reasons: trigger.reasons
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[predictions:refresh] trigger probe failed", {
      stateId: template.stateId,
      reason: String(error)
    });
    predictionTriggerDebounceState.delete(template.stateId);
    return { refresh: false, reasons: [] };
  } finally {
    if (perpClient) await perpClient.close();
  }
}

async function refreshPredictionStateForTemplate(params: {
  template: PredictionRefreshTemplate;
  reason: string;
  refreshIntervalsMs: PredictionRefreshIntervalsMs;
}): Promise<{ refreshed: boolean; significant: boolean; aiCalled: boolean }> {
  const { template } = params;
  let perpClient: PerpMarketDataClient | null = null;
  try {
    // Guard against pause/resume races while a scheduler cycle is already in progress.
    const liveState = await db.predictionState.findUnique({
      where: { id: template.stateId },
      select: {
        autoScheduleEnabled: true,
        autoSchedulePaused: true
      }
    });
    if (!liveState || !Boolean(liveState.autoScheduleEnabled) || Boolean(liveState.autoSchedulePaused)) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    if (params.reason !== "manual_create") {
      const cadence = resolveTemplateAutoCadenceGate(template, params.refreshIntervalsMs, Date.now());
      if (cadence.blocked) {
        logAnalysisCadenceBlock({
          stage: "refresh_guard",
          stateId: template.stateId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          runTimeframe: cadence.runTimeframe,
          elapsedMs: cadence.elapsedMs,
          requiredMs: cadence.requiredMs
        });
        return { refreshed: false, significant: false, aiCalled: false };
      }
    }

    const runtime = await createResolvedPollingPerpMarketDataRuntime(
      template.userId,
      template.exchangeAccountId,
      "predictions/refresh-state"
    );
    const account = runtime.context.selectedAccount;
    perpClient = runtime.client;
    const indicatorSettingsResolution = await resolveIndicatorSettings({
      db,
      exchange: account.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    });
    const indicatorComputeSettings = toIndicatorComputeSettings(indicatorSettingsResolution.config);
    const advancedIndicatorSettings = toAdvancedIndicatorComputeSettings(indicatorSettingsResolution.config);

    const candleLookback = resolvePredictionCandleLookback({
      timeframe: template.timeframe,
      indicatorSettings: indicatorComputeSettings,
      baseMinBars: 160
    });
    const [tickerRaw, candlesRaw] = await Promise.all([
      perpClient.getTicker(template.symbol),
      perpClient.getCandles({
        symbol: template.symbol,
        timeframe: template.timeframe,
        granularity: timeframeToBitgetGranularity(template.timeframe),
        limit: candleLookback
      })
    ]);

    const candles = bucketCandles(parseBitgetCandles(candlesRaw), template.timeframe);
    if (candles.length < 20) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    const closes = candles.map((row) => row.close);
    const highs = candles.map((row) => row.high);
    const lows = candles.map((row) => row.low);
    const indicators = computeIndicators(candles, template.timeframe, {
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      logVwapMetrics: true,
      settings: indicatorComputeSettings
    });
    const advancedIndicators = computeAdvancedIndicators(
      candles,
      template.timeframe,
      advancedIndicatorSettings
    );
    const ticker = normalizeTickerPayload(coerceFirstItem(tickerRaw));
    const referencePrice = ticker.mark ?? ticker.last ?? closes[closes.length - 1];
    if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return { refreshed: false, significant: false, aiCalled: false };
    }

    const thresholdResolution = await resolveFeatureThresholds({
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe
    });

    const inferred = inferPredictionFromMarket({
      closes,
      highs,
      lows,
      indicators,
      referencePrice,
      timeframe: template.timeframe,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? undefined,
      marketType: template.marketType,
      exchangeAccountId: template.exchangeAccountId,
      exchange: account.exchange,
      thresholdResolution
    });

    const quality = await getPredictionQualityContext(
      template.userId,
      template.symbol,
      template.timeframe,
      template.marketType
    );
    const newsBlackout = await evaluateNewsRiskForSymbol({
      db,
      symbol: template.symbol,
      now: new Date()
    });

    inferred.featureSnapshot.autoScheduleEnabled = template.autoScheduleEnabled;
    inferred.featureSnapshot.autoSchedulePaused = template.autoSchedulePaused;
    inferred.featureSnapshot.directionPreference = template.directionPreference;
    inferred.featureSnapshot.confidenceTargetPct = template.confidenceTargetPct;
    inferred.featureSnapshot.requestedLeverage = template.leverage ?? null;
    inferred.featureSnapshot.prefillExchangeAccountId = template.exchangeAccountId;
    inferred.featureSnapshot.prefillExchange = account.exchange;
    inferred.featureSnapshot.qualityWinRatePct = quality.winRatePct;
    inferred.featureSnapshot.qualitySampleSize = quality.sampleSize;
    inferred.featureSnapshot.qualityAvgOutcomePnlPct = quality.avgOutcomePnlPct;
    inferred.featureSnapshot.qualityTpCount = quality.tpCount;
    inferred.featureSnapshot.qualitySlCount = quality.slCount;
    inferred.featureSnapshot.qualityExpiredCount = quality.expiredCount;
    inferred.featureSnapshot.advancedIndicators = advancedIndicators;
    inferred.featureSnapshot.ohlcvSeries = buildOhlcvSeriesFeature(
      candles,
      template.timeframe
    );
    await buildAndAttachHistoryContext({
      db,
      featureSnapshot: inferred.featureSnapshot,
      candles,
      timeframe: template.timeframe,
      indicators,
      advancedIndicators,
      exchange: account.exchange,
      symbol: template.symbol,
      marketType: template.marketType,
      options: AI_HISTORY_CONTEXT_OPTIONS
    });
    inferred.featureSnapshot.meta = {
      ...(asRecord(inferred.featureSnapshot.meta) ?? {}),
      indicatorSettingsHash: indicatorSettingsResolution.hash
    };
    if (advancedIndicators.dataGap) {
      const riskFlags = asRecord(inferred.featureSnapshot.riskFlags) ?? {};
      inferred.featureSnapshot.riskFlags = { ...riskFlags, dataGap: true };
    }
    inferred.featureSnapshot = applyNewsRiskToFeatureSnapshot(
      inferred.featureSnapshot,
      newsBlackout
    );

    const prevStateRow = await db.predictionState.findUnique({
      where: { id: template.stateId }
    });
    const prevState = prevStateRow ? readPredictionStateLike(prevStateRow) : null;
    const signalMode = template.signalMode;
    const requestedStrategyRef = resolveRequestedStrategyRefForTemplate(template);
    const requestedLocalStrategyId = requestedStrategyRef?.kind === "local"
      ? requestedStrategyRef.id
      : (template.localStrategyId ?? readLocalStrategyId(template.featureSnapshot));
    const requestedCompositeStrategyId = requestedStrategyRef?.kind === "composite"
      ? requestedStrategyRef.id
      : (template.compositeStrategyId ?? readCompositeStrategyId(template.featureSnapshot));
    const selectedLocalStrategy = requestedLocalStrategyId
      ? await getEnabledLocalStrategyById(requestedLocalStrategyId)
      : null;
    const selectedCompositeStrategy = requestedCompositeStrategyId
      ? await getEnabledCompositeStrategyById(requestedCompositeStrategyId)
      : null;
    const requestedStrategyRefEffective: PredictionStrategyRef | null =
      requestedStrategyRef
      ?? (requestedCompositeStrategyId
        ? {
            kind: "composite",
            id: requestedCompositeStrategyId,
            name: template.compositeStrategyName ?? null
          }
        : requestedLocalStrategyId
          ? {
              kind: "local",
              id: requestedLocalStrategyId,
            name: template.localStrategyName ?? null
          }
          : null);
    const workspaceId = await resolveWorkspaceIdForUserId(template.userId);
    const strategyEntitlements = await resolveStrategyEntitlementsForWorkspace({
      workspaceId: workspaceId ?? "unknown"
    });
    const promptScopeContext = {
      exchange: template.exchange,
      accountId: template.exchangeAccountId,
      symbol: template.symbol,
      timeframe: template.timeframe
    };
    const requestedPromptTemplateId =
      requestedStrategyRefEffective?.kind === "ai"
        ? requestedStrategyRefEffective.id
        : (readAiPromptTemplateId(template.featureSnapshot) ?? template.aiPromptTemplateId);
    const requestedPromptSelection = requestedPromptTemplateId
      ? await resolveAiPromptRuntimeForUserSelection({
          userId: template.userId,
          templateId: requestedPromptTemplateId,
          context: promptScopeContext
        })
      : null;
    const selectedPromptIsOwn = Boolean(requestedPromptSelection?.isOwnTemplate);
    if (selectedPromptIsOwn) {
      const owner = await db.user.findUnique({
        where: { id: template.userId },
        select: { id: true, email: true }
      });
      const strategyFeatureEnabled = owner
        ? await isStrategyFeatureEnabledForUser(owner)
        : false;
      if (!strategyFeatureEnabled) {
        // eslint-disable-next-line no-console
        console.info("[predictions:refresh] own strategy blocked by access settings", {
          stateId: template.stateId,
          userId: template.userId,
          requestedPromptTemplateId
        });
        return {
          refreshed: false,
          significant: false,
          aiCalled: false
        };
      }
    }
    const requestedStrategyKindForAccess: "ai" | "local" | "composite" =
      requestedStrategyRefEffective?.kind ?? "ai";
    const requestedStrategyIdForAccess =
      requestedStrategyRefEffective?.id
      ?? (
        requestedStrategyKindForAccess === "ai"
          ? (selectedPromptIsOwn
            ? null
            : (
              requestedPromptTemplateId
              ?? template.aiPromptTemplateId
              ?? readAiPromptTemplateId(template.featureSnapshot)
              ?? "default"
            ))
          : null
      );
    const strategyAccess = evaluateStrategySelectionAccess({
      entitlements: strategyEntitlements,
      kind: requestedStrategyKindForAccess,
      strategyId: requestedStrategyIdForAccess,
      aiModel: requestedStrategyKindForAccess === "ai" ? await getAiModelAsync() : null,
      compositeNodes:
        requestedStrategyKindForAccess === "composite"
          ? countCompositeStrategyNodes(selectedCompositeStrategy)
          : null
    });
    const strategyNewsRiskMode = resolveStrategyNewsRiskMode({
      strategyRef: requestedStrategyRefEffective,
      promptSettings: requestedPromptSelection?.runtimeSettings ?? null,
      localStrategy: selectedLocalStrategy,
      compositeStrategy: selectedCompositeStrategy
    });
    const globalNewsRiskBlockEnabled = await readGlobalNewsRiskEnforcement();
    const newsRiskBlocked = shouldBlockByNewsRisk({
      featureSnapshot: inferred.featureSnapshot,
      globalEnabled: globalNewsRiskBlockEnabled,
      strategyMode: strategyNewsRiskMode
    });

    const baselineTags = enforceNewsRiskTag(
      inferred.featureSnapshot.tags,
      inferred.featureSnapshot
    );
    const nowMs = Date.now();
    const gateState = prevStateRow
      ? readAiQualityGateState(prevStateRow)
      : {
        lastAiCallTs: null,
        lastExplainedPredictionHash: null,
        lastExplainedHistoryHash: null,
        lastAiDecisionHash: null,
        windowStartedAt: null,
        aiCallsLastHour: 0,
        highPriorityCallsLastHour: 0
      };
    const budgetSnapshot = getAiPayloadBudgetAlertSnapshot();
    const aiGateDecision = shouldInvokeAiExplain({
      timeframe: template.timeframe,
      nowMs,
      prediction: {
        signal: inferred.prediction.signal,
        confidence: inferred.prediction.confidence,
        expectedMovePct: inferred.prediction.expectedMovePct,
        tsUpdated: new Date(nowMs)
      },
      featureSnapshot: inferred.featureSnapshot,
      prevState: prevState
        ? {
          signal: prevState.signal,
          confidence: prevState.confidence,
          featureSnapshot: prevState.featureSnapshot
        }
        : null,
      gateState,
      config: readAiQualityGateConfig(indicatorSettingsResolution.config),
      budgetPressureConsecutive: budgetSnapshot.highWaterConsecutive
    });
    const aiDecision = {
      shouldCallAi: aiGateDecision.allow,
      reason: aiGateDecision.reasonCodes.join(","),
      cooldownActive: aiGateDecision.reasonCodes.includes("cooldown_active")
    };
    let useLegacySignalFlow =
      requestedStrategyRefEffective?.kind !== "local"
      && requestedStrategyRefEffective?.kind !== "composite";
    if (!strategyAccess.allowed) {
      useLegacySignalFlow = true;
    }
    let aiGateStateForPersist = aiGateDecision.state;
    if (useLegacySignalFlow && !aiDecision.shouldCallAi && !newsRiskBlocked) {
      console.info("[ai_quality_gate_blocked_refresh]", {
        gate_allow: false,
        gate_reasons: aiGateDecision.reasonCodes,
        gate_priority: aiGateDecision.priority,
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        ai_calls_saved: 1
      });
    }

    if (
      useLegacySignalFlow
      && signalMode === "ai_only"
      && requestedStrategyRefEffective?.kind !== "local"
      && requestedStrategyRefEffective?.kind !== "composite"
      && !aiDecision.shouldCallAi
      && !newsRiskBlocked
    ) {
      return {
        refreshed: false,
        significant: false,
        aiCalled: false
      };
    }
    if (
      signalMode === "ai_only"
      && requestedStrategyKindForAccess === "ai"
      && !strategyAccess.allowed
      && !newsRiskBlocked
    ) {
      return {
        refreshed: false,
        significant: false,
        aiCalled: false
      };
    }

    const tsCreated = new Date().toISOString();
    let aiCalled = false;
    let strategyRunStatus: StrategyRunSummary["status"] = "ok";
    let strategyRunDebug: Record<string, unknown> | null = null;
    if (!strategyAccess.allowed) {
      strategyRunStatus = "fallback";
      strategyRunDebug = {
        strategyAccess,
        requestedStrategyRef: requestedStrategyRefEffective
      };
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] strategy blocked by license entitlements", {
        stateId: template.stateId,
        userId: template.userId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        requestedStrategyKind: requestedStrategyKindForAccess,
        requestedStrategyId: requestedStrategyIdForAccess,
        reason: strategyAccess.reason
      });
    }
    const requestedPromptTemplateName =
      requestedStrategyRefEffective?.kind === "ai"
        ? (requestedPromptSelection?.templateName ?? requestedStrategyRefEffective.name ?? null)
        : (readAiPromptTemplateName(template.featureSnapshot) ?? template.aiPromptTemplateName);
    const promptLicenseDecision = selectedPromptIsOwn
      ? {
          allowed: true,
          reason: "ok" as const,
          mode: "off" as const,
          wouldBlock: false
        }
      : evaluateAiPromptAccess({
          userId: template.userId,
          selectedPromptId: requestedPromptTemplateId
        });
    const runtimePromptTemplateId =
      promptLicenseDecision.allowed
        ? (requestedPromptSelection?.templateId ?? requestedPromptTemplateId)
        : null;
    if (promptLicenseDecision.wouldBlock) {
      // eslint-disable-next-line no-console
      console.warn("[license] ai prompt selection would be blocked in enforce mode", {
        userId: template.userId,
        selectedPromptId: requestedPromptTemplateId,
        mode: promptLicenseDecision.mode,
        stateId: template.stateId
      });
    }
    let runtimePromptSettings: Awaited<
      ReturnType<typeof getAiPromptRuntimeSettingsByTemplateId>
    > | null = requestedPromptSelection?.runtimeSettings ?? null;
    let localPrediction =
      normalizeSnapshotPrediction(asRecord(inferred.prediction)) ??
      {
        signal: inferred.prediction.signal,
        expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
        confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
      };
    let aiPrediction: AiPredictionSnapshot | null =
      signalMode === "local_only" ? null : localPrediction;
    let selectedPrediction: {
      signal: PredictionSignal;
      expectedMovePct: number;
      confidence: number;
      source: PredictionSignalSource;
    } = {
      signal: localPrediction.signal,
      expectedMovePct: localPrediction.expectedMovePct,
      confidence: localPrediction.confidence,
      source: "local"
    };
    let explainer: ExplainerOutput = {
      explanation: "No major state change; awaiting clearer signal.",
      tags: [],
      keyDrivers: [],
      aiPrediction: localPrediction,
      disclaimer: "grounded_features_only"
    };
    if (newsRiskBlocked) {
      useLegacySignalFlow = false;
      strategyRunStatus = "fallback";
      strategyRunDebug = {
        requestedStrategyRef: requestedStrategyRefEffective,
        reasonCode: "news_risk_blocked",
        strategyNewsRiskMode
      };
      const blockedSource = resolvePreferredSignalSourceForMode(
        signalMode,
        PREDICTION_PRIMARY_SIGNAL_SOURCE
      );
      selectedPrediction = {
        signal: "neutral",
        expectedMovePct: 0,
        confidence: 0,
        source: blockedSource
      };
      aiPrediction =
        signalMode === "local_only"
          ? null
          : {
              signal: "neutral",
              expectedMovePct: 0,
              confidence: 0
            };
      explainer = createNewsRiskBlockedExplanation(strategyNewsRiskMode);
    }

    if (requestedCompositeStrategyId && !selectedCompositeStrategy) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] composite strategy unavailable, fallback to legacy flow", {
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        compositeStrategyId: requestedCompositeStrategyId
      });
      strategyRunStatus = "fallback";
      useLegacySignalFlow = true;
    }

    if (!newsRiskBlocked && requestedLocalStrategyId && !selectedLocalStrategy) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] local strategy unavailable, fallback to legacy flow", {
        stateId: template.stateId,
        symbol: template.symbol,
        timeframe: template.timeframe,
        localStrategyId: requestedLocalStrategyId
      });
      strategyRunStatus = "fallback";
      useLegacySignalFlow = true;
    }

    if (
      !newsRiskBlocked
      && strategyAccess.allowed
      && requestedStrategyRefEffective?.kind === "local"
      && selectedLocalStrategy
    ) {
      try {
        const localRun = await runLocalStrategy(
          selectedLocalStrategy.id,
          inferred.featureSnapshot,
          {
            signal: localPrediction.signal,
            exchange: template.exchange,
            accountId: template.exchangeAccountId,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe
          }
        );
        useLegacySignalFlow = false;
        const localScoreConfidence = Number(clamp(localRun.score / 100, 0, 1).toFixed(4));
        const blockedSignal: PredictionSignal = "neutral";
        const blockedMove = Number((localPrediction.expectedMovePct * 0.35).toFixed(2));
        selectedPrediction = {
          signal: localRun.allow ? localPrediction.signal : blockedSignal,
          expectedMovePct: localRun.allow
            ? localPrediction.expectedMovePct
            : Number(clamp(blockedMove, 0, localPrediction.expectedMovePct).toFixed(2)),
          confidence: localRun.allow
            ? Number(clamp(Math.max(localPrediction.confidence, localScoreConfidence), 0, 1).toFixed(4))
            : Number(clamp(Math.min(localPrediction.confidence, localScoreConfidence), 0, 1).toFixed(4)),
          source: "local"
        };
        aiPrediction = null;
        explainer = {
          explanation: localRun.explanation,
          tags: normalizeTagList(localRun.tags),
          keyDrivers: [
            { name: "localStrategy.id", value: localRun.strategyId },
            { name: "localStrategy.type", value: localRun.strategyType },
            { name: "localStrategy.allow", value: localRun.allow },
            { name: "localStrategy.score", value: localRun.score },
            { name: "localStrategy.reasonCodes", value: localRun.reasonCodes }
          ],
          aiPrediction: localPrediction,
          disclaimer: "grounded_features_only"
        };
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          localStrategy: localRun
        };
      } catch (error) {
        strategyRunStatus = "error";
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          error: String(error)
        };
        // eslint-disable-next-line no-console
        console.warn("[predictions:refresh] local strategy execution failed, fallback to legacy flow", {
          stateId: template.stateId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          localStrategyId: selectedLocalStrategy.id,
          reason: String(error)
        });
        useLegacySignalFlow = true;
      }
    }

    if (
      !newsRiskBlocked
      && strategyAccess.allowed
      && requestedStrategyRefEffective?.kind === "composite"
      && selectedCompositeStrategy
    ) {
      try {
        const compositeRun = await runCompositeStrategy({
          compositeId: selectedCompositeStrategy.id,
          nodesJson: selectedCompositeStrategy.nodesJson,
          edgesJson: selectedCompositeStrategy.edgesJson,
          combineMode: selectedCompositeStrategy.combineMode,
          outputPolicy: selectedCompositeStrategy.outputPolicy,
          featureSnapshot: inferred.featureSnapshot,
          basePrediction: {
            signal: localPrediction.signal,
            confidence: localPrediction.confidence * 100,
            expectedMovePct: localPrediction.expectedMovePct,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated
          },
          context: {
            exchange: template.exchange,
            accountId: template.exchangeAccountId,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            aiQualityGateConfig: readAiQualityGateConfig(indicatorSettingsResolution.config),
            gateState
          }
        }, {
          resolveLocalStrategyRef: async (id) => {
            if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") {
              return false;
            }
            const found = await db.localStrategyDefinition.findUnique({
              where: { id },
              select: { id: true }
            });
            return Boolean(found);
          },
          resolveAiPromptRef: async (id) => {
            const found = await getAiPromptTemplateById(id);
            return Boolean(found);
          }
        });
        useLegacySignalFlow = false;
        aiCalled = compositeRun.aiCallsUsed > 0;
        if (aiCalled) {
          aiGateStateForPersist = applyAiQualityGateCallToState(
            aiGateStateForPersist,
            aiGateDecision.priority
          );
        }

        const lastExecutedAiNode = [...compositeRun.nodes]
          .reverse()
          .find((node) => node.kind === "ai" && node.executed);
        const aiPredictionFromComposite = normalizeSnapshotPrediction(
          asRecord(asRecord(lastExecutedAiNode?.meta).aiPrediction)
        );
        const selectedSignalSource: PredictionSignalSource =
          compositeRun.outputPolicy === "local_signal_ai_explain"
            ? "local"
            : aiPredictionFromComposite
              ? "ai"
              : "local";
        const compositeConfidenceRaw = Number(compositeRun.confidence);
        const compositeConfidence = Number(
          clamp(
            compositeConfidenceRaw > 1
              ? compositeConfidenceRaw / 100
              : compositeConfidenceRaw,
            0,
            1
          ).toFixed(4)
        );

        aiPrediction = aiPredictionFromComposite ?? aiPrediction;
        selectedPrediction = {
          signal: compositeRun.signal,
          expectedMovePct:
            selectedSignalSource === "ai" && aiPredictionFromComposite
              ? aiPredictionFromComposite.expectedMovePct
              : localPrediction.expectedMovePct,
          confidence: compositeConfidence,
          source: selectedSignalSource
        };

        explainer = {
          explanation:
            typeof compositeRun.explanation === "string" && compositeRun.explanation.trim()
              ? compositeRun.explanation.trim()
              : "Composite strategy evaluated.",
          tags: Array.isArray(compositeRun.tags) ? compositeRun.tags.slice(0, 10) : [],
          keyDrivers: Array.isArray(compositeRun.keyDrivers)
            ? compositeRun.keyDrivers.slice(0, 10)
            : [],
          aiPrediction: aiPrediction ?? localPrediction,
          disclaimer: "grounded_features_only"
        };
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          compositeRun
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[predictions:refresh] composite execution failed, fallback to legacy flow", {
          stateId: template.stateId,
          symbol: template.symbol,
          timeframe: template.timeframe,
          compositeStrategyId: selectedCompositeStrategy.id,
          reason: String(error)
        });
        strategyRunStatus = "error";
        strategyRunDebug = {
          requestedStrategyRef: requestedStrategyRefEffective,
          error: String(error)
        };
        useLegacySignalFlow = true;
      }
    }

    if (!newsRiskBlocked && useLegacySignalFlow) {
      const aiAllowedByStrategyEntitlements =
        strategyAccess.allowed || requestedStrategyKindForAccess !== "ai";
      if (signalMode !== "local_only" && aiDecision.shouldCallAi && aiAllowedByStrategyEntitlements) {
        try {
          const resolvedRuntime = await resolveAiPromptRuntimeForUserSelection({
            userId: template.userId,
            templateId: runtimePromptTemplateId,
            context: promptScopeContext
          });
          runtimePromptSettings =
            resolvedRuntime?.runtimeSettings
            ?? await getAiPromptRuntimeSettings(promptScopeContext);
          explainer = await generatePredictionExplanation({
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated,
            prediction: inferred.prediction,
            featureSnapshot: inferred.featureSnapshot
          }, {
            promptScopeContext,
            promptSettings: runtimePromptSettings,
            traceUserId: template.userId ?? null,
            requireSuccessfulAi: signalMode === "ai_only"
          });
          aiCalled = true;
          aiGateStateForPersist = applyAiQualityGateCallToState(
            aiGateStateForPersist,
            aiGateDecision.priority
          );
        } catch (error) {
          if (signalMode === "ai_only") {
            // eslint-disable-next-line no-console
            console.warn("[predictions:refresh] ai_only skip due to missing AI response", {
              stateId: template.stateId,
              symbol: template.symbol,
              timeframe: template.timeframe,
              reason: String(error)
            });
            return {
              refreshed: false,
              significant: false,
              aiCalled: false
            };
          }
          explainer = fallbackExplain({
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated,
            prediction: inferred.prediction,
            featureSnapshot: inferred.featureSnapshot
          });
        }
      } else if (signalMode === "local_only") {
        explainer = fallbackExplain({
          symbol: template.symbol,
          marketType: template.marketType,
          timeframe: template.timeframe,
          tsCreated,
          prediction: inferred.prediction,
          featureSnapshot: inferred.featureSnapshot
        });
      } else if (signalMode === "ai_only") {
        return {
          refreshed: false,
          significant: false,
          aiCalled: false
        };
      } else if (
        prevState &&
        typeof prevState.explanation === "string" &&
        prevState.explanation.trim()
      ) {
        explainer = {
          explanation: prevState.explanation,
          tags: prevState.tags,
          keyDrivers: prevState.keyDrivers,
          aiPrediction:
            readAiPredictionSnapshot(prevState.featureSnapshot) ?? {
              signal: inferred.prediction.signal,
              expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
              confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
            },
          disclaimer: "grounded_features_only"
        };
      } else {
        explainer = {
          explanation: "No major state change; awaiting clearer signal.",
          tags: [],
          keyDrivers: [],
          aiPrediction: {
            signal: inferred.prediction.signal,
            expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
            confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
          },
          disclaimer: "grounded_features_only"
        };
      }

      localPrediction =
        normalizeSnapshotPrediction(asRecord(inferred.prediction)) ??
        {
          signal: inferred.prediction.signal,
          expectedMovePct: Number(clamp(Math.abs(inferred.prediction.expectedMovePct), 0, 25).toFixed(2)),
          confidence: Number(clamp(inferred.prediction.confidence, 0, 1).toFixed(4))
        };
      aiPrediction =
        signalMode === "local_only"
          ? null
          : (normalizeSnapshotPrediction(asRecord(explainer.aiPrediction)) ?? localPrediction);
      selectedPrediction =
        signalMode === "local_only"
          ? {
              signal: localPrediction.signal,
              expectedMovePct: localPrediction.expectedMovePct,
              confidence: localPrediction.confidence,
              source: "local"
            }
          : signalMode === "ai_only"
            ? {
                signal: (aiPrediction ?? localPrediction).signal,
                expectedMovePct: (aiPrediction ?? localPrediction).expectedMovePct,
                confidence: (aiPrediction ?? localPrediction).confidence,
                source: "ai"
              }
            : selectPredictionBySource({
                localPrediction,
                aiPrediction: aiPrediction ?? localPrediction,
                source: PREDICTION_PRIMARY_SIGNAL_SOURCE
              });
      strategyRunDebug = {
        requestedStrategyRef: requestedStrategyRefEffective,
        signalMode,
        aiGateDecision: {
          allow: aiGateDecision.allow,
          priority: aiGateDecision.priority,
          reasonCodes: aiGateDecision.reasonCodes
        },
        aiDecision,
        runtimePromptTemplateId,
        runtimePromptSettings: runtimePromptSettings
          ? {
              source: runtimePromptSettings.source,
              activePromptId: runtimePromptSettings.activePromptId,
              activePromptName: runtimePromptSettings.activePromptName,
              marketAnalysisUpdateEnabled:
                runtimePromptSettings.marketAnalysisUpdateEnabled,
              selectedFrom: runtimePromptSettings.selectedFrom,
              matchedScopeType: runtimePromptSettings.matchedScopeType,
              matchedOverrideId: runtimePromptSettings.matchedOverrideId
            }
          : null
      };
      if (
        requestedStrategyRefEffective?.kind === "ai"
        && requestedPromptTemplateId
        && !runtimePromptSettings
      ) {
        strategyRunStatus = "fallback";
      }
    }
    const shouldAttachPromptMtf =
      !requestedStrategyRefEffective || requestedStrategyRefEffective.kind === "ai";
    if (shouldAttachPromptMtf && runtimePromptTemplateId && !runtimePromptSettings) {
      try {
        const resolvedRuntime = await resolveAiPromptRuntimeForUserSelection({
          userId: template.userId,
          templateId: runtimePromptTemplateId,
          context: promptScopeContext
        });
        runtimePromptSettings =
          resolvedRuntime?.runtimeSettings
          ?? await getAiPromptRuntimeSettings(promptScopeContext);
      } catch {
        runtimePromptSettings = null;
      }
    }
    const promptMtfConfig = normalizePromptTimeframeSetForRuntime(
      runtimePromptSettings ?? {
        timeframes: template.featureSnapshot.promptTimeframes,
        runTimeframe: template.featureSnapshot.promptRunTimeframe,
        timeframe: template.featureSnapshot.promptTimeframe ?? template.timeframe
      },
      template.timeframe
    );
    if (shouldAttachPromptMtf && promptMtfConfig.timeframes.length > 0) {
      inferred.featureSnapshot.mtf = await buildMtfFramesForPrediction({
        marketDataClient: perpClient,
        exchange: account.exchange,
        accountId: template.exchangeAccountId,
        symbol: template.symbol,
        marketType: template.marketType,
        timeframes: promptMtfConfig.timeframes,
        runTimeframe: template.timeframe,
        runFrame: {
          candles,
          indicators,
          advancedIndicators
        }
      });
    } else {
      delete inferred.featureSnapshot.mtf;
    }
    inferred.featureSnapshot.promptTimeframe = template.timeframe;
    inferred.featureSnapshot.promptTimeframes = promptMtfConfig.timeframes;
    inferred.featureSnapshot.promptSlTpSource = runtimePromptSettings?.slTpSource ?? "local";
    inferred.featureSnapshot.promptRunTimeframe = promptMtfConfig.runTimeframe;
    inferred.featureSnapshot.aiPromptTemplateRequestedId = requestedPromptTemplateId;
    if (runtimePromptSettings) {
      inferred.featureSnapshot.aiPromptTemplateId = runtimePromptSettings.activePromptId;
      inferred.featureSnapshot.aiPromptTemplateName = runtimePromptSettings.activePromptName;
      inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled = Boolean(
        runtimePromptSettings.marketAnalysisUpdateEnabled
      );
    } else {
      inferred.featureSnapshot.aiPromptTemplateId = runtimePromptTemplateId;
      inferred.featureSnapshot.aiPromptTemplateName =
        runtimePromptTemplateId ? requestedPromptTemplateName : null;
      inferred.featureSnapshot.aiPromptMarketAnalysisUpdateEnabled =
        requestedStrategyRefEffective?.kind === "ai"
          ? readAiPromptMarketAnalysisUpdateEnabled(template.featureSnapshot)
          : false;
    }
    inferred.featureSnapshot.aiPromptLicenseMode = promptLicenseDecision.mode;
    inferred.featureSnapshot.aiPromptLicenseWouldBlock = promptLicenseDecision.wouldBlock;
    inferred.featureSnapshot.signalMode = signalMode;
    inferred.featureSnapshot = withPredictionSnapshots({
      snapshot: inferred.featureSnapshot,
      localPrediction,
      aiPrediction,
      selectedSignalSource: selectedPrediction.source,
      signalMode
    });
    const effectiveStrategyRef: PredictionStrategyRef | null =
      requestedStrategyRefEffective?.kind === "composite" && selectedCompositeStrategy
        ? {
            kind: "composite",
            id: selectedCompositeStrategy.id,
            name: selectedCompositeStrategy.name
          }
        : requestedStrategyRefEffective?.kind === "local" && selectedLocalStrategy
          ? {
              kind: "local",
              id: selectedLocalStrategy.id,
              name: selectedLocalStrategy.name
            }
          : requestedPromptTemplateId
            ? {
                kind: "ai",
                id: runtimePromptTemplateId ?? requestedPromptTemplateId,
                name:
                  runtimePromptSettings?.activePromptName
                  ?? requestedPromptTemplateName
                  ?? requestedStrategyRefEffective?.name
                  ?? null
              }
            : null;
    inferred.featureSnapshot = withStrategyRunSnapshot(
      inferred.featureSnapshot,
      {
        strategyRef: effectiveStrategyRef,
        status: strategyRunStatus,
        signal: selectedPrediction.signal,
        expectedMovePct: selectedPrediction.expectedMovePct,
        confidence: selectedPrediction.confidence,
        source: selectedPrediction.source,
        aiCalled,
        explanation: explainer.explanation,
        tags: explainer.tags,
        keyDrivers: explainer.keyDrivers,
        ts: tsCreated
      },
      strategyRunDebug
    );

    const tags = enforceNewsRiskTag(
      explainer.tags.length > 0 ? explainer.tags : baselineTags,
      inferred.featureSnapshot
    );
    const keyDrivers = normalizeKeyDriverList(explainer.keyDrivers);
    const significant = evaluateSignificantChange({
      prev: prevState,
      next: {
        signal: selectedPrediction.signal,
        confidence: selectedPrediction.confidence,
        tags,
        featureSnapshot: inferred.featureSnapshot
      }
    });
    const changeReasons = significant.reasons.length > 0 ? [...significant.reasons] : [params.reason];
    if (significant.significant && significant.changeType === "signal_flip") {
      const recentFlips = await db.predictionEvent.findMany({
        where: {
          stateId: template.stateId,
          changeType: "signal_flip",
          tsCreated: {
            gte: new Date(
              Date.now() - predictionRefreshRuntimeSettings.unstableFlipWindowSeconds * 1000
            )
          }
        },
        orderBy: [{ tsCreated: "desc" }],
        take: predictionRefreshRuntimeSettings.unstableFlipLimit + 1,
        select: { tsCreated: true }
      });
      const markUnstable = shouldMarkUnstableFlips({
        recentFlipCount: recentFlips.length,
        unstableFlipLimit: predictionRefreshRuntimeSettings.unstableFlipLimit,
        unstableWindowMs: predictionRefreshRuntimeSettings.unstableFlipWindowSeconds * 1000,
        lastFlipAtMs: recentFlips[0]?.tsCreated?.getTime() ?? null,
        nowMs: Date.now()
      });
      if (markUnstable) {
        if (!tags.includes("range_bound")) {
          tags.push("range_bound");
          while (tags.length > 5) tags.pop();
        }
        if (!changeReasons.includes("unstable_flip_window")) {
          changeReasons.push("unstable_flip_window");
        }
      }
    }
    const explainVersion =
      selectedCompositeStrategy
        ? "composite-strategy-v1"
        : selectedLocalStrategy
          ? "local-strategy-v1"
        : signalMode === "local_only"
          ? "local-explain-v1"
          : aiCalled
            ? "openai-explain-v1"
            : "openai-explain-skip-v1";
    const resolvedTracking = resolvePredictionTracking({
      signal: selectedPrediction.signal,
      slTpSource: runtimePromptSettings?.slTpSource ?? "local",
      localTracking: {
        entryPrice: inferred.tracking.entryPrice,
        stopLossPrice: inferred.tracking.stopLossPrice,
        takeProfitPrice: inferred.tracking.takeProfitPrice,
        horizonMs: inferred.tracking.horizonMs
      },
      aiLevels: explainer.levels
    });
    inferred.featureSnapshot = {
      ...inferred.featureSnapshot,
      ...(resolvedTracking.entryPrice !== null
        ? { suggestedEntryPrice: resolvedTracking.entryPrice }
        : {}),
      ...(resolvedTracking.stopLossPrice !== null
        ? { suggestedStopLoss: resolvedTracking.stopLossPrice }
        : {}),
      ...(resolvedTracking.takeProfitPrice !== null
        ? { suggestedTakeProfit: resolvedTracking.takeProfitPrice }
        : {}),
      trackingConfig: {
        slTpSourceRequested: resolvedTracking.requestedSource,
        slTpSourceResolved: resolvedTracking.resolvedSource,
        aiLevelsUsed: resolvedTracking.aiLevelsUsed
      }
    };
    const modelVersion = `${template.modelVersionBase || "baseline-v1:auto-market-v1"} + ${explainVersion}`;
    const tsUpdated = new Date(tsCreated);
    const tsPredictedFor = new Date(tsUpdated.getTime() + timeframeToIntervalMs(template.timeframe));
    const changeHash = buildPredictionChangeHash({
      signal: selectedPrediction.signal,
      confidence: selectedPrediction.confidence,
      tags,
      keyDrivers,
      featureSnapshot: inferred.featureSnapshot
    });

    const stateData = {
      ...toPredictionStateStrategyScope(effectiveStrategyRef),
      exchange: account.exchange,
      accountId: template.exchangeAccountId,
      userId: template.userId,
      symbol: template.symbol,
      marketType: template.marketType,
      timeframe: template.timeframe,
      signalMode,
      tsUpdated,
      tsPredictedFor,
      signal: selectedPrediction.signal,
      expectedMovePct: Number.isFinite(Number(selectedPrediction.expectedMovePct))
        ? Number(selectedPrediction.expectedMovePct)
        : null,
      confidence: Number.isFinite(Number(selectedPrediction.confidence))
        ? Number(selectedPrediction.confidence)
        : 0,
      tags,
      explanation: explainer.explanation,
      keyDrivers,
      featuresSnapshot: inferred.featureSnapshot,
      modelVersion,
      lastAiExplainedAt: aiCalled ? tsUpdated : prevState?.lastAiExplainedAt ?? null,
      aiGateLastDecisionHash: aiGateDecision.decisionHash,
      aiGateLastReasonCodes: aiGateDecision.reasonCodes,
      aiGateLastPriority: aiGateDecision.priority,
      aiGateWindowStartedAt: aiGateStateForPersist.windowStartedAt,
      aiGateCallsLastHour: aiGateStateForPersist.aiCallsLastHour,
      aiGateHighPriorityCallsLastHour: aiGateStateForPersist.highPriorityCallsLastHour,
      aiGateLastExplainedPredictionHash: aiCalled
        ? aiGateDecision.predictionHash
        : gateState.lastExplainedPredictionHash,
      aiGateLastExplainedHistoryHash: aiCalled
        ? aiGateDecision.historyHash
        : gateState.lastExplainedHistoryHash,
      lastChangeHash: changeHash,
      lastChangeReason:
        significant.significant && changeReasons.length > 0
          ? changeReasons.join(",")
          : params.reason,
      autoScheduleEnabled: template.autoScheduleEnabled,
      autoSchedulePaused: template.autoSchedulePaused,
      directionPreference: template.directionPreference,
      confidenceTargetPct: template.confidenceTargetPct,
      leverage: template.leverage ?? null
    };

    const stateRow = await persistPredictionState({
      existingStateId: prevStateRow ? template.stateId : null,
      stateData,
      scope: {
        userId: template.userId,
        exchange: account.exchange,
        accountId: template.exchangeAccountId,
        symbol: template.symbol,
        marketType: template.marketType,
        timeframe: template.timeframe,
        signalMode
      }
    });
    const stateId = stateRow.id;

    if (significant.significant) {
      const prevMinimal = prevState
        ? {
            signal: prevState.signal,
            confidence: prevState.confidence,
            tags: prevState.tags,
            tsUpdated: prevState.tsUpdated.toISOString()
          }
        : null;
      const nextMinimal = {
        signal: selectedPrediction.signal,
        confidence: selectedPrediction.confidence,
        expectedMovePct: selectedPrediction.expectedMovePct,
        tags
      };
      const delta = buildEventDelta({
        prev: prevState,
        next: {
          signal: selectedPrediction.signal,
          confidence: selectedPrediction.confidence,
          tags,
          expectedMovePct: selectedPrediction.expectedMovePct
        },
        reasons: changeReasons
      });
      const recentSameEvent = await db.predictionEvent.findFirst({
        where: {
          stateId,
          changeType: significant.changeType,
          tsCreated: {
            gte: new Date(Date.now() - predictionRefreshRuntimeSettings.eventThrottleSec * 1000)
          }
        },
        orderBy: [{ tsCreated: "desc" }],
        select: { tsCreated: true }
      });
      const throttled = shouldThrottleRepeatedEvent({
        nowMs: Date.now(),
        recentSameEventAtMs: recentSameEvent?.tsCreated?.getTime() ?? null,
        eventThrottleMs: predictionRefreshRuntimeSettings.eventThrottleSec * 1000
      });
      if (!throttled) {
        const historyTs = new Date(tsCreated);
        const historyRow = await db.prediction.create({
          data: {
            userId: template.userId,
            botId: null,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            tsCreated: historyTs,
            signal: selectedPrediction.signal,
            expectedMovePct: selectedPrediction.expectedMovePct,
            confidence: selectedPrediction.confidence,
            explanation: explainer.explanation,
            tags,
            featuresSnapshot: inferred.featureSnapshot,
            entryPrice: resolvedTracking.entryPrice,
            stopLossPrice: resolvedTracking.stopLossPrice,
            takeProfitPrice: resolvedTracking.takeProfitPrice,
            horizonMs: resolvedTracking.horizonMs,
            modelVersion
          },
          select: { id: true }
        });

        await db.predictionEvent.create({
          data: {
            stateId,
            changeType: significant.changeType,
            prevSnapshot: prevMinimal,
            newSnapshot: nextMinimal,
            delta,
            horizonEvalRef: historyRow.id,
            modelVersion,
            reason: params.reason
          }
        });

        await dispatchTradablePredictionNotification({
          userId: template.userId,
          exchange: account.exchange,
          exchangeAccountLabel: account.label,
          symbol: template.symbol,
          marketType: template.marketType,
          timeframe: template.timeframe,
          signal: selectedPrediction.signal,
          confidence: selectedPrediction.confidence,
          confidenceTargetPct: template.confidenceTargetPct,
          expectedMovePct: selectedPrediction.expectedMovePct,
          predictionId: historyRow.id,
          explanation: explainer.explanation,
          source: "auto",
          signalSource: selectedPrediction.source,
          tags,
          aiPromptTemplateName: resolveNotificationStrategyName({
            signalSource: selectedPrediction.source,
            snapshot: inferred.featureSnapshot,
            strategyRef: effectiveStrategyRef
          })
        });
        if (readAiPromptMarketAnalysisUpdateEnabled(inferred.featureSnapshot)) {
          await dispatchMarketAnalysisUpdateNotification({
            userId: template.userId,
            exchange: account.exchange,
            exchangeAccountLabel: account.label,
            symbol: template.symbol,
            marketType: template.marketType,
            timeframe: template.timeframe,
            signal: selectedPrediction.signal,
            confidence: selectedPrediction.confidence,
            expectedMovePct: selectedPrediction.expectedMovePct,
            predictionId: historyRow.id,
            explanation: explainer.explanation,
            source: "auto",
            signalSource: selectedPrediction.source,
            tags,
            aiPromptTemplateName: resolveNotificationStrategyName({
              signalSource: selectedPrediction.source,
              snapshot: inferred.featureSnapshot,
              strategyRef: effectiveStrategyRef
            })
          });
        }
      }
    }

    return {
      refreshed: true,
      significant: significant.significant,
      aiCalled
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[predictions:refresh] state refresh failed", {
      stateId: template.stateId,
      symbol: template.symbol,
      timeframe: template.timeframe,
      reason: String(error)
    });
    return {
      refreshed: false,
      significant: false,
      aiCalled: false
    };
  } finally {
    if (perpClient) {
      await perpClient.close();
    }
  }
}

async function runPredictionAutoCycle() {
  if (!PREDICTION_AUTO_ENABLED || !PREDICTION_REFRESH_ENABLED) return;
  if (predictionAutoRunning) return;

  let refreshed = 0;
  let significantCount = 0;
  let aiCallCount = 0;

  predictionAutoRunning = true;
  try {
    try {
      await refreshPredictionRefreshRuntimeSettingsFromDb();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[predictions:refresh] failed to load runtime settings, using last known defaults", {
        reason: String(error)
      });
    }
    await bootstrapPredictionStateFromHistory();
    const refreshIntervalsMs = await resolveGlobalPredictionRefreshIntervalsMs();
    const templates = await listPredictionRefreshTemplates();
    const active = templates.filter(
      (row) => row.autoScheduleEnabled && !row.autoSchedulePaused
    );

    const now = Date.now();

    const dueTemplates = active.filter((template) => {
      const cadence = resolveTemplateAutoCadenceGate(template, refreshIntervalsMs, now);
      return cadence.elapsedMs >= cadence.requiredMs;
    });

    for (const template of dueTemplates) {
      if (refreshed >= PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) break;
      const result = await refreshPredictionStateForTemplate({
        template,
        reason: "scheduled_due",
        refreshIntervalsMs
      });
      if (!result.refreshed) continue;
      predictionTriggerDebounceState.delete(template.stateId);
      refreshed += 1;
      if (result.significant) significantCount += 1;
      if (result.aiCalled) aiCallCount += 1;
    }

    if (refreshed < PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) {
      const remaining = active
        .filter((template) => !dueTemplates.some((item) => item.stateId === template.stateId))
        .filter((template) => now - template.tsUpdated.getTime() >= PREDICTION_REFRESH_TRIGGER_MIN_AGE_MS)
        .filter((template) => {
          const cadence = resolveTemplateAutoCadenceGate(template, refreshIntervalsMs, now);
          if (!cadence.blocked) return true;
          logAnalysisCadenceBlock({
            stage: "scheduler_probe_filter",
            stateId: template.stateId,
            symbol: template.symbol,
            timeframe: template.timeframe,
            runTimeframe: cadence.runTimeframe,
            elapsedMs: cadence.elapsedMs,
            requiredMs: cadence.requiredMs
          });
          return false;
        })
        .slice(0, PREDICTION_REFRESH_TRIGGER_PROBE_LIMIT);

      for (const template of remaining) {
        if (refreshed >= PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE) break;
        const triggerProbe = await probePredictionRefreshTrigger(template, refreshIntervalsMs);
        if (!triggerProbe.refresh) continue;
        const result = await refreshPredictionStateForTemplate({
          template,
          reason: triggerProbe.reasons.join(",") || "triggered",
          refreshIntervalsMs
        });
        if (!result.refreshed) continue;
        predictionTriggerDebounceState.delete(template.stateId);
        refreshed += 1;
        if (result.significant) significantCount += 1;
        if (result.aiCalled) aiCallCount += 1;
      }
    }

    if (refreshed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[predictions:refresh] updated ${refreshed} state row(s), ` +
          `significant=${significantCount}, ai_called=${aiCallCount}`
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[predictions:refresh] scheduler cycle failed", String(error));
  } finally {
    predictionAutoRunning = false;
  }
}

function startPredictionAutoScheduler() {
  if (!PREDICTION_AUTO_ENABLED) return;
  predictionAutoTimer = setInterval(() => {
    void runPredictionAutoCycle();
  }, PREDICTION_AUTO_POLL_MS);
  void runPredictionAutoCycle();
}

function stopPredictionAutoScheduler() {
  if (!predictionAutoTimer) return;
  clearInterval(predictionAutoTimer);
  predictionAutoTimer = null;
}

function startPredictionOutcomeEvalScheduler() {
  if (!PREDICTION_OUTCOME_EVAL_ENABLED) return;
  predictionOutcomeEvalTimer = setInterval(() => {
    void runPredictionOutcomeEvalCycle();
  }, PREDICTION_OUTCOME_EVAL_POLL_MS);
  void runPredictionOutcomeEvalCycle();
}

function stopPredictionOutcomeEvalScheduler() {
  if (!predictionOutcomeEvalTimer) return;
  clearInterval(predictionOutcomeEvalTimer);
  predictionOutcomeEvalTimer = null;
}

function startPredictionPerformanceEvalScheduler() {
  if (!PREDICTION_EVALUATOR_ENABLED) return;
  predictionPerformanceEvalTimer = setInterval(() => {
    void runPredictionPerformanceEvalCycle();
  }, PREDICTION_EVALUATOR_POLL_MS);
  void runPredictionPerformanceEvalCycle();
}

function stopPredictionPerformanceEvalScheduler() {
  if (!predictionPerformanceEvalTimer) return;
  clearInterval(predictionPerformanceEvalTimer);
  predictionPerformanceEvalTimer = null;
}

type WsAuthUser = {
  id: string;
  email: string;
};

type MarketWsContext = {
  adapter: PerpExecutionAdapter;
  selectedAccount: Awaited<ReturnType<typeof resolveTradingAccount>>;
  marketDataAccount: Awaited<ReturnType<typeof resolveTradingAccount>>;
  stop: () => Promise<void>;
};

function readCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const entries = header.split(";");
  for (const entry of entries) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function authenticateWsUser(req: http.IncomingMessage): Promise<WsAuthUser | null> {
  const token = readCookieValue(req.headers.cookie, "mm_session");
  if (!token) return null;

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() }
  });

  return {
    id: session.user.id,
    email: session.user.email
  };
}

function wsReject(socket: any, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function createMarketWsContext(
  userId: string,
  exchangeAccountId?: string | null
): Promise<{ accountId: string; ctx: MarketWsContext }> {
  const resolved = await resolvePerpTradingContext(userId, exchangeAccountId);
  return createMarketWsContextFromResolved(resolved);
}

async function createMarketWsContextFromResolved(
  resolved: ResolvedPerpTradingContext
): Promise<{ accountId: string; ctx: MarketWsContext }> {
  const adapter = await createStreamingPerpExecutionAdapter(resolved);

  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await adapter.close();
  };

  return {
    accountId: resolved.selectedAccount.id,
    ctx: {
      adapter,
      selectedAccount: resolved.selectedAccount,
      marketDataAccount: resolved.marketDataAccount,
      stop
    }
  };
}

function pickWsSymbol(
  preferred: string | null | undefined,
  contracts: Array<{ canonicalSymbol: string; apiAllowed: boolean }>
): string | null {
  const normalizedPreferred = normalizeSymbolInput(preferred);
  if (normalizedPreferred && contracts.some((row) => row.canonicalSymbol === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return contracts.find((row) => row.apiAllowed)?.canonicalSymbol ?? contracts[0]?.canonicalSymbol ?? null;
}

function sendManualTradingError(res: express.Response, error: unknown) {
  const result = buildManualTradingErrorResponse(error);
  const message =
    typeof result.payload.message === "string"
      ? result.payload.message
      : "Unexpected manual trading failure.";
  const code = typeof result.payload.code === "string" ? result.payload.code : "manual_trading_unexpected_error";
  const exchange =
    typeof result.payload.exchange === "string" && result.payload.exchange.trim()
      ? result.payload.exchange.trim()
      : null;
  const userId =
    typeof (res.locals as { user?: { id?: unknown } })?.user?.id === "string"
      ? String((res.locals as { user?: { id?: string } }).user?.id ?? "").trim()
      : "";
  // eslint-disable-next-line no-console
  console.error("[manual-trading]", message, { status: result.status, code });
  if (userId) {
    void dispatchManualTradingErrorNotification({
      userId,
      code,
      message,
      status: result.status,
      exchange,
      requestId: typeof res.getHeader("x-request-id") === "string" ? String(res.getHeader("x-request-id")) : null
    });
  }
  return res.status(result.status).json(result.payload);
}

function isDatabaseConnectivityError(error: unknown): boolean {
  const unknown = error as { code?: unknown; message?: unknown };
  const code =
    typeof unknown?.code === "string" && unknown.code.trim()
      ? unknown.code.trim().toUpperCase()
      : "";
  if (code === "P1001" || code === "P1002" || code === "P2024") {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof unknown?.message === "string"
        ? unknown.message
        : "";
  const normalized = message.toLowerCase();

  return normalized.includes("can't reach database server")
    || normalized.includes("database")
      && (
        normalized.includes("connection")
        || normalized.includes("timeout")
        || normalized.includes("timed out")
      )
    || normalized.includes("econnrefused")
    || normalized.includes("econnreset");
}

function sendPredictionScheduleError(
  res: express.Response,
  error: unknown,
  action: "pause" | "stop" | "delete-schedule"
) {
  const message = error instanceof Error ? error.message : String(error);
  if (isDatabaseConnectivityError(error)) {
    // eslint-disable-next-line no-console
    console.error(`[predictions:schedule:${action}] database unavailable`, message);
    return res.status(503).json({
      error: "temporary_db_unavailable",
      message: "Database temporarily unavailable. Please retry."
    });
  }

  // eslint-disable-next-line no-console
  console.error(`[predictions:schedule:${action}] unexpected failure`, message);
  return res.status(500).json({
    error: "prediction_schedule_update_failed",
    message: "Prediction schedule update failed."
  });
}

registerSystemRoutes(app, {
  db,
  getVaultExecutionModeSettings,
  getVaultSafetyControlsSettings,
  parseVaultSafetyControls,
  getRuntimeOrchestrationMode,
  isBillingEnabled,
  isLicenseEnforcementEnabled,
  isBillingWebhookEnabled,
  verifyCcpayWebhook,
  recordWebhookEvent,
  applyPaidOrder,
  markOrderFailed,
  getQueueMetrics,
  resolvePlanCapabilitiesForUserId,
  listPluginCatalogForCapabilities,
  vaultAccountingJob,
  botVaultRiskJob,
  botVaultTradingReconciliationJob,
  vaultOnchainIndexerJob,
  vaultOnchainReconciliationJob
});

registerAuthRoutes(app, {
  db,
  registerSchema,
  loginSchema,
  changePasswordSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  toSafeUser,
  ensureWorkspaceMembership,
  setUserToFreePlan,
  resolveEffectivePlanForUser,
  syncPrimaryWorkspaceEntitlementsForUser,
  resolveUserContext,
  getAccessSectionSettings,
  DEFAULT_ACCESS_SECTION_SETTINGS,
  toAuthMePayload,
  generateNumericCode,
  hashOneTimeCode,
  PASSWORD_RESET_PURPOSE,
  PASSWORD_RESET_OTP_TTL_MIN,
  sendReauthOtpEmail
});

function normalizeAiPromptSettingsPayload(
  payload: AdminAiPromptsPayload,
  nowIso: string
): {
  settings: AiPromptSettingsStored;
  invalidKeys: string[];
  duplicatePromptIds: string[];
} {
  const invalidKeys = new Set<string>();
  const duplicatePromptIds = new Set<string>();

  const normalizeIndicatorKeyList = (values: string[]): AiPromptIndicatorKey[] => {
    const deduped: AiPromptIndicatorKey[] = [];
    const seen = new Set<AiPromptIndicatorKey>();
    for (const raw of values) {
      const key = raw.trim();
      if (!isAiPromptIndicatorKey(key)) {
        if (key) invalidKeys.add(key);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(key);
    }
    return deduped;
  };

  const parseIso = (value: string | undefined): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  };

  const normalizePromptTimeframe = (value: unknown): PredictionTimeframe | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim() as PredictionTimeframe;
    return PREDICTION_TIMEFRAMES.has(trimmed) ? trimmed : null;
  };

  const normalizePromptTimeframeSet = (
    values: unknown,
    legacyFallback: PredictionTimeframe | null
  ): PredictionTimeframe[] => {
    const out: PredictionTimeframe[] = [];
    const seen = new Set<PredictionTimeframe>();
    if (Array.isArray(values)) {
      for (const value of values) {
        const normalized = normalizePromptTimeframe(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
        if (out.length >= 4) break;
      }
    }
    if (out.length === 0 && legacyFallback) {
      out.push(legacyFallback);
    }
    return out;
  };

  const normalizePromptRunTimeframe = (
    value: unknown,
    timeframes: readonly PredictionTimeframe[],
    fallback: PredictionTimeframe | null
  ): PredictionTimeframe | null => {
    const direct = normalizePromptTimeframe(value);
    if (direct && timeframes.includes(direct)) return direct;
    if (fallback && timeframes.includes(fallback)) return fallback;
    if (timeframes.length > 0) return timeframes[0];
    return null;
  };

  const seenIds = new Set<string>();
  const prompts: AiPromptTemplate[] = [];
  for (const row of payload.prompts) {
    const id = row.id.trim();
    if (!id) continue;
    if (seenIds.has(id)) {
      duplicatePromptIds.add(id);
      continue;
    }
    seenIds.add(id);

    const createdAt = parseIso(row.createdAt) ?? nowIso;
    const updatedAt = nowIso;
    const legacyTimeframe = normalizePromptTimeframe(row.timeframe);
    const timeframes = normalizePromptTimeframeSet(
      (row as { timeframes?: unknown }).timeframes,
      legacyTimeframe
    );
    const runTimeframe = normalizePromptRunTimeframe(
      (row as { runTimeframe?: unknown }).runTimeframe,
      timeframes,
      legacyTimeframe
    );
    const normalizedByMode = normalizePromptFieldsByMode({
      promptMode: resolvePromptModeFromFlags({
        promptMode: (row as { promptMode?: unknown }).promptMode,
        marketAnalysisUpdateEnabled: row.marketAnalysisUpdateEnabled
      }),
      directionPreference: row.directionPreference,
      confidenceTargetPct: row.confidenceTargetPct,
      slTpSource: row.slTpSource ?? "local",
      newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
      marketAnalysisUpdateEnabled: Boolean(row.marketAnalysisUpdateEnabled)
    });
    prompts.push({
      id,
      name: row.name.trim(),
      promptText: row.promptText.trim(),
      indicatorKeys: normalizeIndicatorKeyList(row.indicatorKeys),
      ohlcvBars: row.ohlcvBars,
      timeframes,
      runTimeframe,
      timeframe: runTimeframe,
      directionPreference: normalizedByMode.directionPreference,
      confidenceTargetPct: normalizedByMode.confidenceTargetPct,
      slTpSource: normalizedByMode.slTpSource,
      newsRiskMode: normalizedByMode.newsRiskMode,
      promptMode: normalizedByMode.promptMode,
      marketAnalysisUpdateEnabled: normalizedByMode.marketAnalysisUpdateEnabled,
      isPublic: Boolean(row.isPublic),
      createdAt,
      updatedAt
    });
  }

  const activePromptIdRaw =
    typeof payload.activePromptId === "string" && payload.activePromptId.trim()
      ? payload.activePromptId.trim()
      : null;
  const activePromptId =
    activePromptIdRaw && prompts.some((item) => item.id === activePromptIdRaw)
      ? activePromptIdRaw
      : (prompts[0]?.id ?? null);

  return {
    settings: {
      activePromptId,
      prompts
    },
    invalidKeys: [...invalidKeys],
    duplicatePromptIds: [...duplicatePromptIds]
  };
}

function readAiPromptLicensePolicyPublic() {
  const mode = getAiPromptLicenseMode();
  return {
    mode,
    allowedPublicPromptIds: getAiPromptAllowedPublicIds(),
    enforcementActive: mode === "enforce"
  } as const;
}

type StrategyEntitlementsPublic = {
  plan: "free" | "pro" | "enterprise";
  allowedStrategyKinds: Array<"local" | "ai" | "composite">;
  allowedStrategyIds: string[] | null;
  maxCompositeNodes: number;
  aiAllowedModels: string[] | null;
  aiMonthlyBudgetUsd: number | null;
  source: "db" | "plan_default";
};

async function resolveStrategyEntitlementsPublicForUser(
  user: { id: string; email: string }
): Promise<StrategyEntitlementsPublic> {
  const ctx = await resolveUserContext(user);
  const entitlements = await resolveStrategyEntitlementsForWorkspace({
    workspaceId: ctx.workspaceId
  });
  return {
    plan: entitlements.plan,
    allowedStrategyKinds: entitlements.allowedStrategyKinds,
    allowedStrategyIds: entitlements.allowedStrategyIds,
    maxCompositeNodes: entitlements.maxCompositeNodes,
    aiAllowedModels: entitlements.aiAllowedModels,
    aiMonthlyBudgetUsd: entitlements.aiMonthlyBudgetUsd,
    source: entitlements.source
  };
}

function canUseStrategyKindByEntitlements(
  entitlements: StrategyEntitlementsPublic,
  kind: "local" | "ai" | "composite"
): boolean {
  return isStrategyKindAllowed(entitlements, kind);
}

function canUseStrategyIdByEntitlements(
  entitlements: StrategyEntitlementsPublic,
  kind: "local" | "ai" | "composite",
  id: string
): boolean {
  return isStrategyIdAllowed(entitlements, kind, id);
}

function evaluateStrategySelectionAccess(params: {
  entitlements: StrategyEntitlementsPublic;
  kind: "local" | "ai" | "composite";
  strategyId?: string | null;
  aiModel?: string | null;
  compositeNodes?: number | null;
}) {
  return evaluateStrategyAccess({
    entitlements: params.entitlements,
    kind: params.kind,
    strategyId: params.strategyId,
    aiModel: params.aiModel,
    compositeNodes: params.compositeNodes
  });
}

function localStrategiesStoreReady(): boolean {
  return Boolean(
    db.localStrategyDefinition
    && typeof db.localStrategyDefinition.findMany === "function"
    && typeof db.localStrategyDefinition.findUnique === "function"
    && typeof db.localStrategyDefinition.create === "function"
    && typeof db.localStrategyDefinition.update === "function"
    && typeof db.localStrategyDefinition.delete === "function"
  );
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function listLocalStrategyRegistryPublic() {
  return listRegisteredLocalStrategies().map((entry) => ({
    type: entry.type,
    defaultConfig: entry.defaultConfig,
    uiSchema: entry.uiSchema
  }));
}

function listLocalFallbackStrategyTypes(): string[] {
  return listRegisteredLocalStrategies().map((entry) => entry.type);
}

function resolvePythonFallbackStrategyType(params: {
  requestedFallbackStrategyType: string | null | undefined;
  strategyType: string;
  remoteStrategyType: string;
  availableTypes: string[];
}): { value: string | null; invalidValue: string | null } {
  const defaultType =
    params.availableTypes.includes("signal_filter")
      ? "signal_filter"
      : (params.availableTypes[0] ?? null);
  const strategyTypeFallback = params.availableTypes.includes(params.strategyType)
    ? params.strategyType
    : defaultType;

  if (params.requestedFallbackStrategyType === null) {
    return { value: null, invalidValue: null };
  }

  if (params.requestedFallbackStrategyType === undefined) {
    return { value: strategyTypeFallback, invalidValue: null };
  }

  const requested = params.requestedFallbackStrategyType.trim();
  if (!requested) {
    return { value: strategyTypeFallback, invalidValue: null };
  }
  if (params.availableTypes.includes(requested)) {
    return { value: requested, invalidValue: null };
  }
  if (requested === params.remoteStrategyType || requested === params.strategyType) {
    return { value: defaultType, invalidValue: null };
  }
  return { value: null, invalidValue: requested };
}

function mapLocalStrategyDefinitionPublic(row: any) {
  const registration =
    typeof row?.strategyType === "string"
      ? getRegisteredLocalStrategy(row.strategyType)
      : null;
  return {
    id: row.id,
    strategyType: row.strategyType,
    engine: row.engine === "python" ? "python" : "ts",
    shadowMode: row.shadowMode === true,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
    remoteStrategyType:
      typeof row.remoteStrategyType === "string" && row.remoteStrategyType.trim()
        ? row.remoteStrategyType.trim()
        : null,
    fallbackStrategyType:
      typeof row.fallbackStrategyType === "string" && row.fallbackStrategyType.trim()
        ? row.fallbackStrategyType.trim()
        : null,
    timeoutMs:
      Number.isFinite(Number(row.timeoutMs))
        ? Math.max(200, Math.min(10000, Math.trunc(Number(row.timeoutMs))))
        : null,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    inputSchema:
      row.inputSchema && typeof row.inputSchema === "object" && !Array.isArray(row.inputSchema)
        ? row.inputSchema
        : null,
    configJson: toJsonRecord(row.configJson),
    isEnabled: Boolean(row.isEnabled),
    registry: registration
      ? {
        registered: true,
        defaultConfig: registration.defaultConfig,
        uiSchema: registration.uiSchema
      }
      : { registered: false },
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

function compositeStrategiesStoreReady(): boolean {
  return Boolean(
    db.compositeStrategy
    && typeof db.compositeStrategy.findMany === "function"
    && typeof db.compositeStrategy.findUnique === "function"
    && typeof db.compositeStrategy.create === "function"
    && typeof db.compositeStrategy.update === "function"
    && typeof db.compositeStrategy.delete === "function"
  );
}

async function resolveCompositeNodeRef(node: { kind: "local" | "ai"; refId: string }): Promise<boolean> {
  if (node.kind === "local") {
    if (!db.localStrategyDefinition || typeof db.localStrategyDefinition.findUnique !== "function") return false;
    const found = await db.localStrategyDefinition.findUnique({
      where: { id: node.refId },
      select: { id: true }
    });
    return Boolean(found);
  }
  const template = await getAiPromptTemplateById(node.refId);
  return Boolean(template);
}

async function validateCompositeStrategyPayload(payload: {
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
  maxCompositeNodes?: number | null;
}) {
  const graph = normalizeCompositeGraph(payload);
  const validation = await validateCompositeGraph(graph, {
    resolveRef: async (node) => resolveCompositeNodeRef(node)
  });
  const maxCompositeNodes =
    Number.isFinite(Number(payload.maxCompositeNodes))
      ? Math.max(0, Math.trunc(Number(payload.maxCompositeNodes)))
      : null;
  if (maxCompositeNodes !== null && graph.nodes.length > maxCompositeNodes) {
    validation.valid = false;
    validation.errors.push(
      `composite_nodes_exceeded:max=${maxCompositeNodes}:actual=${graph.nodes.length}`
    );
  }
  return {
    graph,
    validation
  };
}

function mapCompositeStrategyPublic(row: any) {
  const graph = normalizeCompositeGraph({
    nodesJson: row.nodesJson,
    edgesJson: row.edgesJson,
    combineMode: row.combineMode,
    outputPolicy: row.outputPolicy
  });
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off",
    nodesJson: graph.nodes,
    edgesJson: graph.edges,
    combineMode: graph.combineMode,
    outputPolicy: graph.outputPolicy,
    isEnabled: Boolean(row.isEnabled),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
  };
}

async function getEnabledCompositeStrategyById(id: string | null): Promise<{
  id: string;
  name: string;
  nodesJson: unknown;
  edgesJson: unknown;
  combineMode: unknown;
  outputPolicy: unknown;
  newsRiskMode: "off" | "block";
} | null> {
  if (!id || !compositeStrategiesStoreReady()) return null;
  const row = await db.compositeStrategy.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      nodesJson: true,
      edgesJson: true,
      combineMode: true,
      outputPolicy: true,
      newsRiskMode: true,
      isEnabled: true
    }
  });
  if (!row || !Boolean(row.isEnabled)) return null;
  return {
    id: row.id,
    name: row.name,
    nodesJson: row.nodesJson,
    edgesJson: row.edgesJson,
    combineMode: row.combineMode,
    outputPolicy: row.outputPolicy,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off"
  };
}

function countCompositeStrategyNodes(strategy: {
  nodesJson: unknown;
  edgesJson?: unknown;
  combineMode?: unknown;
  outputPolicy?: unknown;
} | null | undefined): number {
  if (!strategy) return 0;
  try {
    const graph = normalizeCompositeGraph({
      nodesJson: strategy.nodesJson,
      edgesJson: strategy.edgesJson,
      combineMode: strategy.combineMode,
      outputPolicy: strategy.outputPolicy
    });
    return graph.nodes.length;
  } catch {
    return 0;
  }
}

async function getEnabledLocalStrategyById(id: string | null): Promise<{
  id: string;
  name: string;
  strategyType: string;
  version: string;
  newsRiskMode: "off" | "block";
} | null> {
  if (!id || !localStrategiesStoreReady()) return null;
  const row = await db.localStrategyDefinition.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      strategyType: true,
      version: true,
      newsRiskMode: true,
      isEnabled: true
    }
  });
  if (!row || !Boolean(row.isEnabled)) return null;
  return {
    id: row.id,
    name: row.name,
    strategyType: row.strategyType,
    version: row.version,
    newsRiskMode: row.newsRiskMode === "block" ? "block" : "off"
  };
}

function resolveSelectedAiPromptIndicators(indicatorKeys: readonly string[]): {
  selectedIndicators: Array<{
    key: AiPromptIndicatorKey;
    label: string;
    description: string;
  }>;
  invalidKeys: string[];
} {
  const availableIndicators = getAiPromptIndicatorOptionsPublic();
  const indicatorByKey = new Map(availableIndicators.map((item) => [item.key, item] as const));
  const selectedIndicators: Array<{
    key: AiPromptIndicatorKey;
    label: string;
    description: string;
  }> = [];
  const invalidKeys = new Set<string>();

  for (const rawKey of indicatorKeys) {
    const key = rawKey.trim();
    if (!key) continue;
    const found = indicatorByKey.get(key as AiPromptIndicatorKey);
    if (!found) {
      invalidKeys.add(key);
      continue;
    }
    if (selectedIndicators.some((item) => item.key === found.key)) continue;
    selectedIndicators.push({
      key: found.key,
      label: found.label,
      description: found.description
    });
  }

  return {
    selectedIndicators,
    invalidKeys: [...invalidKeys]
  };
}

registerAdminIndicatorSettingsRoutes(app, {
  db,
  requireSuperadmin,
  adminIndicatorSettingsResolvedQuerySchema,
  indicatorSettingsUpsertSchema,
  normalizeIndicatorSettingsPatch,
  mergeIndicatorSettings,
  DEFAULT_INDICATOR_SETTINGS,
  normalizeIndicatorSettingExchange,
  normalizeIndicatorSettingAccountId,
  normalizeIndicatorSettingSymbol,
  normalizeIndicatorSettingTimeframe,
  resolveIndicatorSettings,
  clearIndicatorSettingsCache
});

registerSettingsTradingRoutes(app, {
  getPredictionDefaultsSettings,
  getTradingSettings,
  saveTradingSettings,
  tradingSettingsSchema
});

registerPredictionGenerateRoutes(app, {
  db,
  isSuperadminEmail,
  normalizePredictionSignalMode,
  asRecord,
  normalizeExchangeValue,
  normalizeSymbolInput,
  normalizePredictionStrategyKind,
  getEnabledLocalStrategyById,
  getEnabledCompositeStrategyById,
  resolveStrategyBoundSignalMode,
  resolvePredictionLimitBucketFromStrategy,
  resolveUserContext,
  resolveStrategyEntitlementsForWorkspace,
  resolveAiPromptRuntimeForUserSelection,
  isStrategyFeatureEnabledForUser,
  evaluateStrategySelectionAccess,
  getAiModelAsync,
  countCompositeStrategyNodes,
  evaluateAiPromptAccess,
  getAiPromptRuntimeSettings,
  normalizePromptTimeframeSetForRuntime,
  readPrefillExchangeAccountId,
  findPredictionStateIdByScope,
  isAutoScheduleEnabled,
  canCreatePredictionForUser,
  withStrategyRunSnapshot,
  resolvePreferredSignalSourceForMode,
  PREDICTION_PRIMARY_SIGNAL_SOURCE,
  normalizeTagList,
  resolveStrategyNewsRiskMode,
  readGlobalNewsRiskEnforcement,
  shouldBlockByNewsRisk,
  derivePredictionTrackingFromSnapshot,
  generateAndPersistPrediction,
  enforceNewsRiskTag,
  normalizeKeyDriverList,
  buildPredictionChangeHash,
  readPredictionStrategyRef,
  toPredictionStateStrategyScope,
  timeframeToIntervalMs,
  isAutoSchedulePaused,
  parseDirectionPreference,
  readConfidenceTarget,
  readRequestedLeverage,
  persistPredictionState,
  dispatchTradablePredictionNotification,
  resolveNotificationStrategyName,
  readAiPromptMarketAnalysisUpdateEnabled,
  dispatchMarketAnalysisUpdateNotification,
  readAiPromptTemplateId,
  readAiPromptTemplateName,
  readLocalStrategyId,
  readLocalStrategyName,
  readCompositeStrategyId,
  readCompositeStrategyName,
  generateAutoPredictionForUser,
  sendManualTradingError
});

registerPredictionReadRoutes(app, {
  db,
  normalizePredictionMarketType,
  normalizePredictionTimeframe,
  normalizePredictionSignal,
  normalizeSymbolInput,
  normalizeTagList,
  asRecord,
  asStringArray,
  timeframeToIntervalMs,
  PREDICTION_OUTCOME_HORIZON_BARS,
  readLocalPredictionSnapshot,
  readAiPredictionSnapshot,
  readAiPromptTemplateId,
  readAiPromptTemplateName,
  readLocalStrategyId,
  readLocalStrategyName,
  readCompositeStrategyId,
  readCompositeStrategyName,
  readPredictionStrategyRef,
  readStateSignalMode,
  readSignalMode,
  isAutoScheduleEnabled,
  readConfiguredConfidenceTarget,
  readSelectedSignalSource,
  readRealizedPayloadFromOutcomeMeta,
  normalizeSnapshotPrediction,
  getPredictionPerformanceResetAt,
  setPredictionPerformanceResetAt,
  computePredictionErrorMetrics,
  computeDirectionalRealizedReturnPct,
  normalizeConfidencePct,
  buildPredictionMetricsSummary,
  resolveFeatureThresholds,
  normalizeExchangeValue,
  resolveGlobalPredictionRefreshIntervalsMs,
  refreshIntervalMsForTimeframe,
  parseDirectionPreference,
  readConfidenceTarget,
  readRequestedLeverage,
  PREDICTION_REFRESH_SCAN_LIMIT
});

registerPredictionLifecycleRoutes(app, {
  db,
  getAccessSectionSettings,
  evaluateAccessSectionBypassForUser,
  readPredictionStrategyRef,
  readStateSignalMode,
  resolvePredictionLimitBucketFromStrategy,
  predictionQuotaKindFromBucket,
  canEnablePredictionSchedule,
  asRecord,
  findPredictionTemplateRowIds,
  normalizeSymbolInput,
  normalizePredictionMarketType,
  normalizePredictionTimeframe,
  sendPredictionScheduleError,
  resolvePredictionTemplateScope,
  withAutoScheduleFlag,
  predictionTriggerDebounceState
});

registerPredictionStateRoutes(app, {
  db,
  normalizeExchangeValue,
  normalizeSymbolInput,
  normalizePredictionMarketType,
  normalizePredictionTimeframe,
  normalizePredictionSignalMode,
  normalizePredictionSignal,
  normalizeTagList,
  normalizeKeyDriverList,
  asRecord,
  readStateSignalMode,
  readAiPromptTemplateId,
  readAiPromptTemplateName,
  readLocalStrategyId,
  readLocalStrategyName,
  readCompositeStrategyId,
  readCompositeStrategyName,
  readPredictionStrategyRef
});

const resolveGridVenueContext = createGridVenueContextResolver({
  db,
  resolveMarketDataTradingAccount,
  normalizeExchangeValue,
  createPerpMarketDataClient: createManualPerpMarketDataClient,
  readGridVenueConstraintCache,
  upsertGridVenueConstraintCache,
  logger
});

registerPredictionDetailRoute(app, db);
registerEconomicCalendarRoutes(app, {
  db,
  requireSuperadmin,
  refreshJob: economicCalendarRefreshJob
});
registerGridRoutes(app, {
  db,
  requireSuperadmin,
  enqueueBotRun: async (botId: string) => {
    await enqueueBotRun(botId);
  },
  cancelBotRun: async (botId: string) => {
    await cancelBotRun(botId);
  },
  vaultService,
  executionOrchestrator,
  resolveVenueContext: async (params) => resolveGridVenueContext(params)
});
registerVaultRoutes(app, {
  vaultService,
  onchainActionService
});
registerNewsRoutes(app, { db });
registerSiweAuthRoutes(app, { db, siweService, vaultService });
registerManualTradingMarketDataRoutes(app, {
  getTradingSettings,
  resolveMarketDataTradingAccount,
  sendManualTradingError,
  normalizeSpotSymbol,
  normalizeSymbolInput,
  marketTimeframeToBitgetSpotGranularity,
  marketTimeframeToBitgetGranularity,
  parseBitgetCandles,
  createPerpExecutionAdapter,
  isPaperTradingAccount,
  getPaperAccountState,
  getPaperSpotAccountState,
  listPaperPositions,
  listPaperSpotPositions,
  listPaperOpenOrders,
  listPaperSpotOpenOrders,
  listPositions,
  listOpenOrders,
  loadGridDeskVisibilityMask,
  filterGridBotPositionsForDesk,
  filterGridBotOrdersForDesk,
  countVisibleDeskPositions,
  splitCanonicalSymbol
});

registerManualTradingExecutionRoutes(app, {
  getTradingSettings,
  resolveMarketDataTradingAccount,
  resolveTradingAccount,
  sendManualTradingError,
  normalizeSpotSymbol,
  normalizeSymbolInput,
  createPerpExecutionAdapter,
  isPaperTradingAccount,
  placePaperOrder,
  placePaperSpotOrder,
  editPaperOrder,
  editPaperSpotOrder,
  cancelPaperOrder,
  cancelPaperSpotOrder,
  cancelAllPaperOrders,
  cancelAllPaperSpotOrders,
  setPaperPositionTpSl,
  setPositionTpSl,
  editOpenOrder,
  cancelAllOrders,
  closePositionsMarket,
  closePaperPosition,
  closePaperSpotPosition,
  listPaperPositions,
  listPaperSpotPositions,
  listPositions,
  db,
  ignoreMissingTable
});

registerExchangeAccountRoutes(app, {
  db,
  decryptSecret,
  encryptSecret,
  maskSecret,
  normalizeExchangeValue,
  isMexcEnabledAtRuntime,
  isBinanceEnabledAtRuntime,
  getAllowedExchangeValues,
  listPaperMarketDataAccountIds,
  setPaperMarketDataAccountId,
  clearPaperMarketDataAccountId,
  clearPaperState,
  resolveMarketDataTradingAccount,
  getPaperAccountState,
  getPaperSpotAccountState,
  persistExchangeSyncSuccess,
  persistExchangeSyncFailure,
  executeExchangeSync,
  ExchangeSyncError,
  sendManualTradingError
});

registerDashboardRoutes(app, {
  db,
  PREDICTION_REFRESH_SCAN_LIMIT,
  DASHBOARD_PERFORMANCE_RANGE_MS,
  DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS,
  DASHBOARD_ALERT_STALE_SYNC_MS,
  DASHBOARD_MARGIN_WARN_RATIO,
  ignoreMissingTable,
  shouldIncludeBotInStandardOverview,
  listPaperMarketDataAccountIds,
  resolveMarketDataTradingAccount,
  normalizeExchangeValue,
  createManualSpotClient,
  createManualPerpMarketDataClient,
  getPaperSpotAccountState,
  resolveLastSyncAt,
  computeConnectionStatus,
  toFiniteNumber,
  toIso,
  readBotRealizedPnlTodayByAccount,
  resolveEffectivePnlTodayUsd,
  mergeRiskProfileWithDefaults,
  computeAccountRiskAssessment,
  riskSeverityRank,
  loadGridDeskVisibilityMask,
  filterGridBotPositionsForDesk,
  createPerpExecutionAdapter,
  listPositions,
  listPaperPositions,
  isPaperTradingAccount,
  createDashboardAlertId,
  alertSeverityRank,
  getAiPayloadBudgetAlertSnapshot
});

registerSettingsCoreRoutes(app, {
  db,
  isSuperadminEmail,
  resolveUserContext,
  getSecurityGlobalSettings,
  setSecurityGlobalSettings,
  getSecurityUserReauthOverride,
  setSecurityUserReauthOverride,
  getAllowedExchangeValues,
  getExchangeOptionsResponse,
  getServerInfoSettings,
  getDailyEconomicCalendarSettingsForUser,
  updateDailyEconomicCalendarSettingsForUser,
  getNotificationPluginSettingsForUser,
  updateNotificationPluginSettingsForUser,
  getNotificationDestinationsSettingsForUser,
  updateNotificationDestinationsSettingsForUser,
  toNotificationDestinationsSettingsResponse,
  toDailyEconomicCalendarSettingsResponse,
  requireSuperadmin,
  GLOBAL_SETTING_ACCESS_SECTION_KEY,
  GLOBAL_SETTING_SERVER_INFO_KEY,
  parseStoredAccessSectionSettings,
  toEffectiveAccessSectionSettings,
  DEFAULT_ACCESS_SECTION_SETTINGS,
  setGlobalSettingValue,
  normalizeServerIpAddress,
  getAccessSectionSettings,
  getAccessSectionUsageForUser,
  evaluateAccessSectionBypassForUser,
  computeRemaining
});

registerBillingRoutes(app, {
  db,
  requireSuperadmin,
  getBillingFeatureFlagsSettings,
  updateBillingFeatureFlags,
  listBillingPackages,
  upsertBillingPackage,
  deleteBillingPackage,
  getSubscriptionSummary,
  adjustAiTokenBalanceByAdmin,
  isBillingEnabled,
  listSubscriptionOrders,
  createBillingCheckout
});

registerSettingsRiskRoutes(app, {
  db,
  DEFAULT_EXCHANGE_ACCOUNT_RISK_LIMITS,
  readBotRealizedPnlTodayByAccount,
  resolveEffectivePnlTodayUsd,
  toSettingsRiskItem,
  mergeRiskProfileWithDefaults,
  validateRiskLimitValues
});

registerStrategyReadRoutes(app, {
  db,
  requireSuperadmin,
  readUserFromLocals,
  isStrategyFeatureEnabledForUser,
  getAiPromptIndicatorOptionsPublic,
  listUserAiPromptTemplates,
  resolveStrategyEntitlementsPublicForUser,
  parseStoredAiPromptSettings,
  GLOBAL_SETTING_AI_PROMPTS_KEY,
  isSuperadminEmail,
  getPublicAiPromptTemplates,
  canUseStrategyKindByEntitlements,
  canUseStrategyIdByEntitlements,
  readAiPromptLicensePolicyPublic,
  listPythonStrategyRegistry,
  listLocalStrategyRegistryPublic,
  getBuiltinLocalStrategyTemplates,
  localStrategiesStoreReady,
  mapLocalStrategyDefinitionPublic,
  compositeStrategiesStoreReady,
  mapCompositeStrategyPublic,
  GLOBAL_SETTING_AI_TRACE_KEY,
  parseStoredAiTraceSettings,
  DEFAULT_AI_TRACE_SETTINGS,
  getAiPayloadBudgetTelemetrySnapshot,
  getAiQualityGateTelemetrySnapshot
});

registerStrategyWriteRoutes(app, {
  db,
  requireSuperadmin,
  readUserFromLocals,
  isStrategyFeatureEnabledForUser,
  getAiPromptIndicatorOptionsPublic,
  readAiPromptLicensePolicyPublic,
  parseStoredAiPromptSettings,
  GLOBAL_SETTING_AI_PROMPTS_KEY,
  DEFAULT_AI_PROMPT_SETTINGS,
  invalidateAiPromptSettingsCache,
  setGlobalSettingValue,
  normalizeAiPromptSettingsPayload,
  resolveAiPromptRuntimeSettingsForContext,
  buildPredictionExplainerPromptPreview,
  resolveSelectedAiPromptIndicators,
  generateHybridPromptText,
  getAiModel,
  createGeneratedPromptDraft,
  createUserAiPromptTemplate,
  deleteUserAiPromptTemplateById,
  adminAiPromptsSchema,
  adminAiPromptsPreviewSchema,
  adminAiPromptsGeneratePreviewSchema,
  adminAiPromptsGenerateSaveSchema,
  userAiPromptsGeneratePreviewSchema,
  userAiPromptsGenerateSaveSchema,
  localStrategyDefinitionSchema,
  localStrategyDefinitionUpdateSchema,
  localStrategyRunSchema,
  compositeStrategyCreateSchema,
  compositeStrategyUpdateSchema,
  compositeStrategyDryRunSchema,
  adminAiTraceSettingsSchema,
  adminAiTraceLogsQuerySchema,
  adminAiTraceCleanupSchema,
  getRegisteredLocalStrategy,
  listRegisteredLocalStrategies,
  listLocalFallbackStrategyTypes,
  resolvePythonFallbackStrategyType,
  getBuiltinLocalStrategyTemplates,
  mapLocalStrategyDefinitionPublic,
  localStrategiesStoreReady,
  resolveStrategyEntitlementsPublicForUser,
  evaluateStrategySelectionAccess,
  runLocalStrategy,
  compositeStrategiesStoreReady,
  validateCompositeStrategyPayload,
  mapCompositeStrategyPublic,
  countCompositeStrategyNodes,
  toJsonRecord,
  PREDICTION_TIMEFRAMES,
  PREDICTION_MARKET_TYPES,
  runCompositeStrategy,
  getAiPromptTemplateById,
  GLOBAL_SETTING_AI_TRACE_KEY,
  parseStoredAiTraceSettings,
  DEFAULT_AI_TRACE_SETTINGS,
  invalidateAiTraceSettingsCache,
  getAiTraceSettingsCached,
  getAiPayloadBudgetTelemetrySnapshot,
  getAiQualityGateTelemetrySnapshot
});

registerAdminOperationsRoutes(app, {
  db,
  requireSuperadmin,
  getAdminBackendAccessUserIdSet,
  isSuperadminEmail,
  hashPassword,
  generateTempPassword,
  ensureWorkspaceMembership,
  ignoreMissingTable,
  getGlobalSettingValue,
  setGlobalSettingValue,
  GLOBAL_SETTING_ADMIN_BACKEND_ACCESS_KEY,
  parseStoredAdminBackendAccess,
  parseTelegramConfigValue,
  normalizeTelegramChatId,
  findTelegramChatIdConflict,
  buildTelegramChatIdConflictResponse,
  maskSecret,
  resolveTelegramConfig: async () => {
    const config = await resolveTelegramConfig();
    if (!config) return null;
    return {
      telegramBotToken: config.botToken,
      telegramChatId: config.chatId
    };
  },
  sendTelegramMessage: async ({ telegramBotToken, telegramChatId, text }) =>
    sendTelegramMessage({
      botToken: telegramBotToken,
      chatId: telegramChatId,
      text
    }),
  getAllowedExchangeValues,
  normalizeExchangeValue,
  EXCHANGE_OPTION_VALUES,
  getRuntimeEnabledExchangeValues,
  GLOBAL_SETTING_EXCHANGES_KEY,
  getExchangeOptionsResponse,
  GLOBAL_SETTING_SMTP_KEY,
  parseStoredSmtpSettings: (value) => {
    const settings = parseStoredSmtpSettings(value);
    return {
      host: settings.host,
      port: settings.port,
      user: settings.user,
      from: settings.from,
      secure: settings.secure ?? true,
      passEnc: settings.passEnc
    };
  },
  toPublicSmtpSettings,
  encryptSecret,
  sendSmtpTestEmail
});

registerAdminApiKeyRoutes(app, {
  db,
  requireSuperadmin,
  GLOBAL_SETTING_API_KEYS_KEY,
  getGlobalSettingValue,
  setGlobalSettingValue,
  parseStoredApiKeysSettings,
  toPublicApiKeysSettings,
  resolveEffectiveAiProvider,
  resolveEffectiveAiBaseUrl,
  resolveEffectiveAiModel,
  resolveEffectiveAiApiKey,
  resolveOllamaProfileAiApiKey,
  resolveEffectiveFmpApiKey,
  normalizeProviderForProfile,
  emptySaladRuntimeSettings,
  encryptSecret,
  resolveCcpayConfig,
  invalidateCcpayConfigCache,
  invalidateAiApiKeyCache,
  invalidateAiModelCache,
  fetchFmpEconomicEvents,
  getSaladRuntimeStatus,
  resolveSaladRuntimeConfig,
  startSaladContainer,
  stopSaladContainer,
  OPENAI_ADMIN_MODEL_OPTIONS,
  AI_PROVIDER_OPTIONS
});

registerAdminPredictionSettingsRoutes(app, {
  db,
  requireSuperadmin,
  GLOBAL_SETTING_PREDICTION_REFRESH_KEY,
  GLOBAL_SETTING_PREDICTION_DEFAULTS_KEY,
  setGlobalSettingValue,
  parseStoredPredictionRefreshSettings,
  toEffectivePredictionRefreshSettings,
  applyPredictionRefreshRuntimeSettings: (value) => {
    predictionRefreshRuntimeSettings = toEffectivePredictionRefreshSettings(
      parseStoredPredictionRefreshSettings(value)
    );
    return predictionRefreshRuntimeSettings;
  },
  clearPredictionTriggerDebounceState: () => predictionTriggerDebounceState.clear(),
  parseStoredPredictionDefaultsSettings,
  toEffectivePredictionDefaultsSettings,
  normalizePredictionSignalMode
});

registerAdminVaultOperationsRoutes(app, {
  db,
  requireSuperadmin,
  getVaultExecutionModeSettings,
  setVaultExecutionModeSettings,
  getVaultExecutionProviderSettings,
  setVaultExecutionProviderSettings,
  getGridHyperliquidPilotSettings,
  setGridHyperliquidPilotSettings,
  GLOBAL_SETTING_VAULT_EXECUTION_MODE_KEY,
  getVaultProfitShareTreasurySettings,
  setVaultProfitShareTreasurySettings,
  normalizeTreasuryWalletAddress,
  onchainActionService,
  ONCHAIN_TREASURY_PAYOUT_MODEL,
  parseJsonObject,
  ignoreMissingTable,
  getVaultSafetyControlsSettings,
  setVaultSafetyControlsSettings,
  vaultService,
  vaultAccountingJob,
  botVaultRiskJob,
  botVaultTradingReconciliationJob,
  vaultOnchainIndexerJob,
  vaultOnchainReconciliationJob
});

registerBotRoutes(app, {
  db,
  toSafeBot,
  normalizeSymbolInput,
  asRecord,
  readStateSignalMode,
  readPredictionStrategyRef,
  normalizePredictionStrategyKind,
  ignoreMissingTable,
  readBotPrimaryTradeState,
  sumRealizedPnlUsdFromTradeEvents,
  shouldIncludeBotInStandardOverview,
  computeRuntimeMarkPrice,
  computeOpenPnlUsd,
  deriveStoppedWhy,
  computeCoreMetricsFromClosedTrades,
  extractLastDecisionConfidence,
  decodeTradeHistoryCursor,
  encodeTradeHistoryCursor,
  computeRealizedPnlPct,
  classifyOutcomeFromClose,
  resolvePlanCapabilitiesForUserId,
  isCapabilityAllowed,
  sendCapabilityDenied,
  resolveMarketDataTradingAccount,
  ensureManualPerpEligibility,
  createManualPerpMarketDataClient,
  normalizeExchangeValue,
  DEFAULT_BACKTEST_ASSUMPTIONS,
  buildBacktestSnapshotFromMarketData,
  hashStable,
  resolveBacktestEngineHash,
  createBacktestRunRecord,
  updateBacktestRunRecord,
  getRuntimeOrchestrationMode,
  enqueueBacktestRun,
  listBacktestRunsForBot,
  getBacktestRunRecord,
  loadBacktestReport,
  markBacktestRunCancelRequested,
  cancelBacktestRun,
  toFiniteNumber,
  isPaperTradingAccount,
  listPaperPositions,
  listPositions,
  createPerpExecutionAdapter,
  botCreateSchema,
  botUpdateSchema,
  botStopSchema,
  botPredictionSourcesQuerySchema,
  botRiskEventsQuerySchema,
  botOverviewListQuerySchema,
  botOverviewDetailQuerySchema,
  botTradeHistoryQuerySchema,
  backtestCreateSchema,
  backtestListQuerySchema,
  backtestCompareQuerySchema,
  readPredictionCopierRootConfig,
  predictionCopierSettingsSchema,
  findPredictionSourceStateForCopier,
  readPredictionSourceSnapshotFromState,
  normalizeCopierTimeframe,
  writePredictionCopierRootConfig,
  buildPluginPolicySnapshot,
  attachPluginPolicySnapshot,
  evaluateAccessSectionBypassForUser,
  canCreateBotForUser,
  strategyCapabilityForKey,
  executionCapabilityForMode,
  readExecutionSettingsFromParams,
  findLegacyPredictionSourceForCopier,
  enqueueBotRun,
  cancelBotRun,
  getAccessSectionSettings,
  enforceBotStartLicense,
  MEXC_PERP_ENABLED,
  ManualTradingError,
  sendManualTradingError,
  closePaperPosition,
  closePositionsMarket
});

function wsSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as any).code ?? "") : "";
  const message = "message" in error ? String((error as any).message ?? "") : String(error);
  if (code === "P2021") return true;
  return /table .* does not exist/i.test(message) || /relation .* does not exist/i.test(message);
}

async function ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

function coerceFirstItem(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (payload && typeof payload === "object") {
    const list = (payload as Record<string, unknown>).list;
    if (Array.isArray(list)) return list[0] ?? null;
  }
  return payload;
}

async function handleMarketWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");
  const requestedSymbol = url.searchParams.get("symbol");
  const requestedMarketType = url.searchParams.get("marketType");

  let context: MarketWsContext | null = null;
  let spotClient: SpotClient | null = null;
  let perpClient: PerpMarketDataClient | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let cleaned = false;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (pollTimer) clearInterval(pollTimer);
    if (context) await context.stop();
    if (perpClient) await perpClient.close();
    spotClient = null;
    perpClient = null;
    pollTimer = null;
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const marketType = resolveManualMarketType({
      requested: requestedMarketType,
      settings
    });
    if (marketType === "spot") {
      const resolved = await resolveMarketDataTradingAccount(
        user.id,
        exchangeAccountId ?? settings.exchangeAccountId
      );
      ensureManualSpotEligibility(resolved);
      spotClient = createManualSpotClient(resolved.marketDataAccount, "/ws/market");
      const symbols = await spotClient.listSymbols();
      const normalizedPreferred = normalizeSpotSymbol(requestedSymbol ?? settings.symbol);
      const symbol =
        (normalizedPreferred && symbols.some((row) => row.symbol === normalizedPreferred)
          ? normalizedPreferred
          : null) ??
        symbols.find((row) => row.tradable)?.symbol ??
        symbols[0]?.symbol ??
        null;

      if (!symbol) {
        throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
      }

      await saveTradingSettings(user.id, {
        exchangeAccountId: resolved.selectedAccount.id,
        symbol,
        marketType
      });

      const sendSpotSnapshot = async () => {
        if (!spotClient) return;
        const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
          spotClient.getTicker(symbol),
          spotClient.getDepth(symbol, 50),
          spotClient.getTrades(symbol, 60)
        ]);
        if (tickerSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:ticker",
            symbol,
            data: {
              ...tickerSnapshot.value,
              symbol
            }
          });
        }
        if (depthSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:orderbook",
            symbol,
            data: normalizeOrderBookPayload(depthSnapshot.value)
          });
        }
        if (tradesSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:trades",
            symbol,
            data: normalizeTradesPayload(tradesSnapshot.value)
          });
        }
      };

      await sendSpotSnapshot();
      pollTimer = setInterval(() => {
        if (!spotClient) return;
        void Promise.allSettled([
          spotClient.getTicker(symbol).then((ticker) => {
            wsSend(socket, {
              type: "ticker",
              symbol,
              data: {
                ...ticker,
                symbol
              }
            });
          }),
          spotClient.getDepth(symbol, 50).then((depth) => {
            wsSend(socket, {
              type: "orderbook",
              symbol,
              data: normalizeOrderBookPayload(depth)
            });
          }),
          spotClient.getTrades(symbol, 60).then((trades) => {
            wsSend(socket, {
              type: "trades",
              symbol,
              data: normalizeTradesPayload(trades)
            });
          })
        ]);
      }, 2500);

      wsSend(socket, {
        type: "ready",
        exchangeAccountId: resolved.selectedAccount.id,
        symbol,
        marketType
      });
    } else {
      const resolvedPerpContext = await resolvePerpTradingContext(
        user.id,
        exchangeAccountId ?? settings.exchangeAccountId
      );
      const preResolved = {
        selectedAccount: resolvedPerpContext.selectedAccount,
        marketDataAccount: resolvedPerpContext.marketDataAccount
      };
      if (resolvePerpMarketStreamingMode(resolvedPerpContext) === "market_data_poll") {
        ensureManualPerpEligibility(preResolved);
        perpClient = createPollingPerpMarketDataClient(resolvedPerpContext, "/ws/market");
        const items = await perpClient.listSymbols();
        const symbol = pickWsSymbol(
          requestedSymbol ?? settings.symbol,
          items.map((row) => ({
            canonicalSymbol: row.symbol,
            apiAllowed: row.tradable
          }))
        );
        if (!symbol) {
          throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
        }

        await saveTradingSettings(user.id, {
          exchangeAccountId: preResolved.selectedAccount.id,
          symbol,
          marketType
        });

        const sendPerpSnapshot = async () => {
          if (!perpClient) return;
          const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
            perpClient.getTicker(symbol),
            perpClient.getDepth(symbol, 50),
            perpClient.getTrades(symbol, 60)
          ]);
          if (tickerSnapshot.status === "fulfilled") {
            wsSend(socket, {
              type: "snapshot:ticker",
              symbol,
              data: {
                ...tickerSnapshot.value,
                symbol
              }
            });
          }
          if (depthSnapshot.status === "fulfilled") {
            wsSend(socket, {
              type: "snapshot:orderbook",
              symbol,
              data: normalizeOrderBookPayload({
                bids: depthSnapshot.value.bids,
                asks: depthSnapshot.value.asks,
                ts: depthSnapshot.value.ts
              })
            });
          }
          if (tradesSnapshot.status === "fulfilled") {
            wsSend(socket, {
              type: "snapshot:trades",
              symbol,
              data: normalizeTradesPayload(tradesSnapshot.value)
            });
          }
        };

        await sendPerpSnapshot();
        pollTimer = setInterval(() => {
          if (!perpClient) return;
          void Promise.allSettled([
            perpClient.getTicker(symbol).then((ticker) => {
              wsSend(socket, {
                type: "ticker",
                symbol,
                data: {
                  ...ticker,
                  symbol
                }
              });
            }),
            perpClient.getDepth(symbol, 50).then((depth) => {
              wsSend(socket, {
                type: "orderbook",
                symbol,
                data: normalizeOrderBookPayload({
                  bids: depth.bids,
                  asks: depth.asks,
                  ts: depth.ts
                })
              });
            }),
            perpClient.getTrades(symbol, 60).then((trades) => {
              wsSend(socket, {
                type: "trades",
                symbol,
                data: normalizeTradesPayload(trades)
              });
            })
          ]);
        }, 2500);

        wsSend(socket, {
          type: "ready",
          exchangeAccountId: preResolved.selectedAccount.id,
          symbol,
          marketType
        });
      } else {
        const resolved = await createMarketWsContextFromResolved(resolvedPerpContext);
        context = resolved.ctx;

        const contracts = context.adapter.contractCache.snapshot();
        const symbol = pickWsSymbol(
          requestedSymbol ?? settings.symbol,
          contracts.map((row) => ({
            canonicalSymbol: row.canonicalSymbol,
            apiAllowed: row.apiAllowed
          }))
        );
        if (!symbol) {
          throw new ManualTradingError("no_symbols_available", 404, "no_symbols_available");
        }

        await saveTradingSettings(user.id, {
          exchangeAccountId: resolved.accountId,
          symbol,
          marketType
        });

        unsubs.push(
          context.adapter.onTicker((payload) => {
            const row = coerceFirstItem(extractWsDataArray(payload));
            const normalized = normalizeTickerPayload(row);
            wsSend(socket, {
              type: "ticker",
              symbol,
              data: {
                ...normalized,
                symbol
              }
            });
          })
        );
        unsubs.push(
          context.adapter.onDepth((payload) => {
            const row = coerceFirstItem(extractWsDataArray(payload));
            const normalized = normalizeOrderBookPayload(row);
            wsSend(socket, {
              type: "orderbook",
              symbol,
              data: normalized
            });
          })
        );
        unsubs.push(
          (context.adapter as any).onTrades((payload: unknown) => {
            const rows = extractWsDataArray(payload);
            const normalized = normalizeTradesPayload(rows).map((trade) => ({
              ...trade,
              symbol: symbol
            }));
            wsSend(socket, {
              type: "trades",
              symbol,
              data: normalized
            });
          })
        );

        await Promise.all([
          context.adapter.subscribeTicker(symbol),
          context.adapter.subscribeDepth(symbol),
          (context.adapter as any).subscribeTrades(symbol)
        ]);

        const exchangeSymbol = await context.adapter.toExchangeSymbol(symbol);

        const marketApi = context.adapter.marketApi as any;
        const [tickerSnapshot, depthSnapshot, tradesSnapshot] = await Promise.allSettled([
          marketApi.getTicker(exchangeSymbol, context.adapter.productType),
          marketApi.getDepth(exchangeSymbol, 50, context.adapter.productType),
          marketApi.getTrades(exchangeSymbol, 60, context.adapter.productType)
        ]);

        if (tickerSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:ticker",
            symbol,
            data: {
              ...normalizeTickerPayload(coerceFirstItem(tickerSnapshot.value)),
              symbol
            }
          });
        }

        if (depthSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:orderbook",
            symbol,
            data: normalizeOrderBookPayload(depthSnapshot.value)
          });
        }

        if (tradesSnapshot.status === "fulfilled") {
          wsSend(socket, {
            type: "snapshot:trades",
            symbol,
            data: normalizeTradesPayload(tradesSnapshot.value).map((trade) => ({
              ...trade,
              symbol
            }))
          });
        }

        wsSend(socket, {
          type: "ready",
          exchangeAccountId: resolved.accountId,
          symbol,
          marketType
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "market_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });

  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

async function handleUserWsConnection(
  socket: WebSocket,
  user: WsAuthUser,
  url: URL
) {
  const exchangeAccountId = url.searchParams.get("exchangeAccountId");
  const requestedMarketType = url.searchParams.get("marketType");

  let context: MarketWsContext | null = null;
  let spotClient: SpotClient | null = null;
  let perpClient: PerpMarketDataClient | null = null;
  let cleaned = false;
  let balanceTimer: NodeJS.Timeout | null = null;
  const unsubs: Array<() => void> = [];

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const unsub of unsubs) unsub();
    if (balanceTimer) clearInterval(balanceTimer);
    if (context) await context.stop();
    if (perpClient) await perpClient.close();
    spotClient = null;
    perpClient = null;
    balanceTimer = null;
    context = null;
  };

  try {
    const settings = await getTradingSettings(user.id);
    const marketType = resolveManualMarketType({
      requested: requestedMarketType,
      settings
    });
    if (marketType === "spot") {
      const resolved = await resolveMarketDataTradingAccount(
        user.id,
        exchangeAccountId ?? settings.exchangeAccountId
      );
      ensureManualSpotEligibility(resolved);
      spotClient = createManualSpotClient(resolved.marketDataAccount, "/ws/user");
      const paperMode = isPaperTradingAccount(resolved.selectedAccount);

      await saveTradingSettings(user.id, {
        exchangeAccountId: resolved.selectedAccount.id,
        marketType
      });

      const sendSummary = async () => {
        if (!spotClient) return;
        if (paperMode) {
          const [accountSummary, positions, openOrders] = await Promise.all([
            getPaperSpotAccountState(resolved.selectedAccount, spotClient),
            listPaperSpotPositions(resolved.selectedAccount, spotClient),
            listPaperSpotOpenOrders(resolved.selectedAccount, spotClient)
          ]);
          wsSend(socket, {
            type: "account",
            data: {
              exchangeAccountId: resolved.selectedAccount.id,
              marketType,
              equity: accountSummary.equity ?? null,
              availableMargin: accountSummary.availableMargin ?? null,
              positions,
              openOrders
            }
          });
          return;
        }

        const [summary, openOrders, positions] = await Promise.all([
          spotClient.getSummary(),
          spotClient.getOpenOrders(),
          listBitgetSpotPositions({
            client: spotClient,
            preferredQuoteAsset: "USDT"
          })
        ]);
        wsSend(socket, {
          type: "account",
          data: {
            exchangeAccountId: resolved.selectedAccount.id,
            marketType,
            equity: summary.equity ?? null,
            availableMargin: summary.available ?? null,
            positions,
            openOrders
          }
        });
      };

      await sendSummary();
      balanceTimer = setInterval(() => {
        void sendSummary().catch(() => {
          // ignore timer errors
        });
      }, 10_000);

      wsSend(socket, {
        type: "ready",
        exchangeAccountId: resolved.selectedAccount.id,
        marketType
      });
    } else {
      const resolvedPerpContext = await resolvePerpTradingContext(
        user.id,
        exchangeAccountId ?? settings.exchangeAccountId
      );
      const preResolved = {
        selectedAccount: resolvedPerpContext.selectedAccount,
        marketDataAccount: resolvedPerpContext.marketDataAccount
      };
      if (resolvePerpMarketStreamingMode(resolvedPerpContext) === "market_data_poll") {
        ensureManualPerpEligibility(preResolved);
        perpClient = createPollingPerpMarketDataClient(resolvedPerpContext, "/ws/user");

        await saveTradingSettings(user.id, {
          exchangeAccountId: preResolved.selectedAccount.id,
          marketType
        });

      const sendSummary = async () => {
          if (!perpClient) return;
          const visibilityMask = await loadGridDeskVisibilityMask(user.id, [
            String(preResolved.selectedAccount.id)
          ]);
          const [accountSummary, positions, openOrders] = await Promise.all([
            getPaperAccountState(preResolved.selectedAccount, perpClient),
            listPaperPositions(preResolved.selectedAccount, perpClient),
            listPaperOpenOrders(preResolved.selectedAccount, perpClient)
          ]);
          wsSend(socket, {
            type: "account",
            data: {
              exchangeAccountId: preResolved.selectedAccount.id,
              marketType,
              equity: accountSummary.equity ?? null,
              availableMargin: accountSummary.availableMargin ?? null,
              positions: filterGridBotPositionsForDesk(
                positions,
                visibilityMask,
                preResolved.selectedAccount.id
              ),
              openOrders: filterGridBotOrdersForDesk(
                openOrders,
                visibilityMask,
                preResolved.selectedAccount.id
              )
            }
          });
        };

        await sendSummary();
        balanceTimer = setInterval(() => {
          void sendSummary().catch(() => {
            // ignore timer errors
          });
        }, 10_000);

        wsSend(socket, {
          type: "ready",
          exchangeAccountId: preResolved.selectedAccount.id,
          marketType
        });
      } else {
        const resolved = await createMarketWsContextFromResolved(resolvedPerpContext);
        context = resolved.ctx;
        const paperMode = isPaperTradingAccount(context.selectedAccount);

        await saveTradingSettings(user.id, {
          exchangeAccountId: resolved.accountId,
          marketType
        });

        if (!paperMode) {
          unsubs.push(
            context.adapter.onFill((event) => {
              wsSend(socket, {
                type: "fill",
                data: event
              });
            })
          );
          unsubs.push(
            context.adapter.onOrderUpdate((event) => {
              wsSend(socket, {
                type: "order",
                data: event
              });
            })
          );
          unsubs.push(
            context.adapter.onPositionUpdate((event) => {
              wsSend(socket, {
                type: "position",
                data: event
              });
            })
          );
        }

        const sendSummary = async () => {
          if (!context) return;
          const visibilityMask = await loadGridDeskVisibilityMask(user.id, [
            String(context.selectedAccount.id)
          ]);
          const [accountSummary, positions, openOrders] = paperMode
            ? await Promise.all([
                getPaperAccountState(context.selectedAccount, context.adapter),
                listPaperPositions(context.selectedAccount, context.adapter),
                listPaperOpenOrders(context.selectedAccount, context.adapter)
              ])
            : await Promise.all([
                context.adapter.getAccountState(),
                listPositions(context.adapter),
                listOpenOrders(context.adapter)
              ]);
          wsSend(socket, {
            type: "account",
            data: {
              exchangeAccountId: resolved.accountId,
              marketType,
              equity: accountSummary.equity ?? null,
              availableMargin: accountSummary.availableMargin ?? null,
              positions: filterGridBotPositionsForDesk(
                positions,
                visibilityMask,
                context.selectedAccount.id
              ),
              openOrders: filterGridBotOrdersForDesk(
                openOrders,
                visibilityMask,
                context.selectedAccount.id
              )
            }
          });
        };

        await sendSummary();
        balanceTimer = setInterval(() => {
          void sendSummary().catch(() => {
            // ignore timer errors
          });
        }, 10_000);

        wsSend(socket, {
          type: "ready",
          exchangeAccountId: resolved.accountId,
          marketType
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "user_ws_failed";
    wsSend(socket, {
      type: "error",
      message
    });
    await cleanup();
    socket.close();
    return;
  }

  socket.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text) as { type?: string };
      if (parsed.type === "ping") {
        wsSend(socket, { type: "pong" });
      }
    } catch {
      // ignore malformed payloads
    }
  });
  socket.on("close", () => {
    void cleanup();
  });
  socket.on("error", () => {
    void cleanup();
  });
}

const marketWss = new WebSocketServer({ noServer: true });
const userWss = new WebSocketServer({ noServer: true });

let billingDowngradeTimer: NodeJS.Timeout | null = null;

function startBillingDowngradeScheduler() {
  if (billingDowngradeTimer) return;
  const intervalMs = Math.max(
    60_000,
    Number(process.env.BILLING_DOWNGRADE_SYNC_INTERVAL_MS ?? String(60 * 60 * 1000))
  );
  billingDowngradeTimer = setInterval(() => {
    void downgradeExpiredSubscriptions().catch(() => {
      // ignore scheduler errors
    });
  }, intervalMs);
}

function stopBillingDowngradeScheduler() {
  if (!billingDowngradeTimer) return;
  clearInterval(billingDowngradeTimer);
  billingDowngradeTimer = null;
}

const port = Number(process.env.API_PORT ?? "4000");
const listenHost = process.env.API_HOST?.trim() || "::";
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname !== "/ws/market" && url.pathname !== "/ws/user") {
    wsReject(socket, 404, "Not Found");
    return;
  }

  void (async () => {
    const user = await authenticateWsUser(req);
    if (!user) {
      wsReject(socket, 401, "Unauthorized");
      return;
    }

    if (url.pathname === "/ws/market") {
      marketWss.handleUpgrade(req, socket, head, (ws) => {
        void handleMarketWsConnection(ws, user, url);
      });
      return;
    }

    userWss.handleUpgrade(req, socket, head, (ws) => {
      void handleUserWsConnection(ws, user, url);
    });
  })().catch(() => {
    wsReject(socket, 500, "Internal Server Error");
  });
});

async function startApiServer() {
  try {
    await ensureAdminUserSeed();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[admin] seed failed", String(error));
  }

  try {
    await ensureBillingDefaults();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[billing] default package seed failed", String(error));
  }

  server.listen(
    {
      port,
      host: listenHost,
      ipv6Only: false
    },
    () => {
    // eslint-disable-next-line no-console
      console.log(`[api] listening on ${listenHost}:${port}`);
    startExchangeAutoSyncScheduler();
    startFeatureThresholdCalibrationScheduler();
    startPredictionAutoScheduler();
    startPredictionOutcomeEvalScheduler();
    startPredictionPerformanceEvalScheduler();
    startBotQueueRecoveryScheduler();
    startBillingDowngradeScheduler();
    economicCalendarRefreshJob.start();
    economicCalendarDailyTelegramJob.start();
    vaultAccountingJob.start();
    botVaultRiskJob.start();
    botVaultTradingReconciliationJob.start();
    vaultOnchainIndexerJob.start();
    vaultOnchainReconciliationJob.start();
    }
  );
}

void startApiServer();

process.on("SIGTERM", () => {
  stopExchangeAutoSyncScheduler();
  stopFeatureThresholdCalibrationScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  stopPredictionPerformanceEvalScheduler();
  stopBotQueueRecoveryScheduler();
  stopBillingDowngradeScheduler();
  economicCalendarRefreshJob.stop();
  economicCalendarDailyTelegramJob.stop();
  vaultAccountingJob.stop();
  botVaultRiskJob.stop();
  botVaultTradingReconciliationJob.stop();
  vaultOnchainIndexerJob.stop();
  vaultOnchainReconciliationJob.stop();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});

process.on("SIGINT", () => {
  stopExchangeAutoSyncScheduler();
  stopFeatureThresholdCalibrationScheduler();
  stopPredictionAutoScheduler();
  stopPredictionOutcomeEvalScheduler();
  stopPredictionPerformanceEvalScheduler();
  stopBotQueueRecoveryScheduler();
  stopBillingDowngradeScheduler();
  economicCalendarRefreshJob.stop();
  economicCalendarDailyTelegramJob.stop();
  vaultAccountingJob.stop();
  botVaultRiskJob.stop();
  botVaultTradingReconciliationJob.stop();
  vaultOnchainIndexerJob.stop();
  vaultOnchainReconciliationJob.stop();
  marketWss.close();
  userWss.close();
  server.close();
  void closeOrchestration();
});
