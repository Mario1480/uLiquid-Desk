import type {
  NotificationDispatchContext,
  NotificationDispatchResult,
  NotificationDeliveryResult,
  NotificationEventEnvelope,
  PluginManifest,
  PlanTier
} from "@mm/plugin-sdk";
import type { PredictionSignalSource } from "../../ai/predictionPipeline.js";

type PredictionTimeframe = "5m" | "15m" | "1h" | "4h" | "1d";
type PredictionMarketType = "spot" | "perp";
type PredictionSignal = "up" | "down" | "neutral";
type ResponseLanguage = "de" | "en";

export type PredictionTradableNotificationPayload = {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  confidenceTargetPct: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  responseLanguage?: ResponseLanguage;
  aiPromptTemplateName?: string | null;
  tags?: string[];
};

export type MarketAnalysisUpdateNotificationPayload = {
  userId: string;
  exchange: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  confidence: number;
  expectedMovePct: number;
  predictionId: string | null;
  explanation?: string | null;
  source: "manual" | "auto";
  signalSource: PredictionSignalSource;
  responseLanguage?: ResponseLanguage;
  aiPromptTemplateName?: string | null;
  tags?: string[];
};

export type PredictionOutcomeNotificationPayload = {
  userId: string;
  exchangeAccountLabel: string;
  symbol: string;
  marketType: PredictionMarketType;
  timeframe: PredictionTimeframe;
  signal: PredictionSignal;
  predictionId: string;
  outcomeResult: "tp_hit" | "sl_hit";
  outcomePnlPct: number | null;
  tags?: string[];
};

export type MobileMonitoringNotificationPayload = {
  userId: string;
  title: string;
  message: string;
  severity?: "info" | "warn" | "error" | "critical";
  botId?: string | null;
  exchange?: string | null;
  exchangeAccountId?: string | null;
  symbol?: string | null;
  routeTab?: "dashboard" | "bots" | "positions" | "predictions" | "performance" | "news";
  routeId?: string | null;
  requestId?: string | null;
  tags?: string[];
};

export type ApiNotificationType =
  | "prediction.tradable"
  | "prediction.market_analysis_update"
  | "prediction.outcome"
  | "bot.error"
  | "account.margin_warning"
  | "position.opened"
  | "position.pnl_move"
  | "calendar.high_impact"
  | "manual_trading.error"
  | "vault.agent_low_hype";

export type ApiNotificationPayloadMap = {
  "prediction.tradable": PredictionTradableNotificationPayload;
  "prediction.market_analysis_update": MarketAnalysisUpdateNotificationPayload;
  "prediction.outcome": PredictionOutcomeNotificationPayload;
  "bot.error": MobileMonitoringNotificationPayload;
  "account.margin_warning": MobileMonitoringNotificationPayload;
  "position.opened": MobileMonitoringNotificationPayload;
  "position.pnl_move": MobileMonitoringNotificationPayload;
  "calendar.high_impact": MobileMonitoringNotificationPayload;
  "manual_trading.error": {
    userId: string;
    code: string;
    message: string;
    status: number;
    exchange?: string | null;
    symbol?: string | null;
    requestId?: string | null;
  };
  "vault.agent_low_hype": {
    userId: string;
    masterVaultId: string;
    masterVaultAddress?: string | null;
    agentWalletAddress: string;
    hypeBalance: string | null;
    lowHypeThreshold: number;
    lowHypeState: "ok" | "low" | "unavailable";
    updatedAt?: string | null;
    requestId?: string | null;
  };
};

export type ApiNotificationEvent =
  | (NotificationEventEnvelope & {
      source: "api";
      type: "prediction.tradable";
      payload: ApiNotificationPayloadMap["prediction.tradable"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "prediction.market_analysis_update";
      payload: ApiNotificationPayloadMap["prediction.market_analysis_update"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "prediction.outcome";
      payload: ApiNotificationPayloadMap["prediction.outcome"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "bot.error";
      payload: ApiNotificationPayloadMap["bot.error"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "account.margin_warning";
      payload: ApiNotificationPayloadMap["account.margin_warning"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "position.opened";
      payload: ApiNotificationPayloadMap["position.opened"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "position.pnl_move";
      payload: ApiNotificationPayloadMap["position.pnl_move"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "calendar.high_impact";
      payload: ApiNotificationPayloadMap["calendar.high_impact"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "manual_trading.error";
      payload: ApiNotificationPayloadMap["manual_trading.error"];
    })
  | (NotificationEventEnvelope & {
      source: "api";
      type: "vault.agent_low_hype";
      payload: ApiNotificationPayloadMap["vault.agent_low_hype"];
    });

export type ApiNotificationEventByType<TType extends ApiNotificationType> = Extract<ApiNotificationEvent, { type: TType }>;

export type ApiTelegramDestinationConfig = {
  botToken: string | null;
  chatId: string | null;
};

export type ApiWebhookDestinationConfig = {
  url: string | null;
  headers: Record<string, string>;
};

export type ApiNotificationDestinationConfig = {
  telegram: ApiTelegramDestinationConfig;
  webhook: ApiWebhookDestinationConfig;
};

export type ApiNotificationDispatchContext = NotificationDispatchContext & {
  userId: string;
  planTier: PlanTier;
  destinationConfig: ApiNotificationDestinationConfig;
};

export type ApiNotificationProviderResult = NotificationDeliveryResult;

export type ApiNotificationDispatchResult = NotificationDispatchResult;

export type ApiNotificationPlugin = {
  manifest: PluginManifest & { kind: "notification" };
  canHandle?: (event: ApiNotificationEvent, ctx: ApiNotificationDispatchContext) => boolean;
  send: (
    event: ApiNotificationEvent,
    ctx: ApiNotificationDispatchContext
  ) => Promise<ApiNotificationProviderResult>;
};
