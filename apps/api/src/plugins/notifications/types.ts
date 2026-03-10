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

export type ApiNotificationType =
  | "prediction.tradable"
  | "prediction.market_analysis_update"
  | "prediction.outcome"
  | "manual_trading.error";

export type ApiNotificationPayloadMap = {
  "prediction.tradable": PredictionTradableNotificationPayload;
  "prediction.market_analysis_update": MarketAnalysisUpdateNotificationPayload;
  "prediction.outcome": PredictionOutcomeNotificationPayload;
  "manual_trading.error": {
    userId: string;
    code: string;
    message: string;
    status: number;
    exchange?: string | null;
    symbol?: string | null;
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
      type: "manual_trading.error";
      payload: ApiNotificationPayloadMap["manual_trading.error"];
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
