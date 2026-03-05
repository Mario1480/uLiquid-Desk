import type { PlanTier, PluginManifest } from "@mm/plugin-sdk";
import type {
  MarketAnalysisUpdateNotificationParams,
  PredictionOutcomeNotificationParams,
  TradablePredictionNotificationParams
} from "../../telegram/notifications.js";

export type ApiNotificationEvent =
  | {
    type: "prediction_tradable";
    payload: TradablePredictionNotificationParams;
  }
  | {
    type: "market_analysis_update";
    payload: MarketAnalysisUpdateNotificationParams;
  }
  | {
    type: "prediction_outcome";
    payload: PredictionOutcomeNotificationParams;
  };

export type ApiNotificationDispatchContext = {
  userId: string;
  plan: PlanTier;
  now: Date;
};

export type ApiNotificationDispatchResult = {
  handled: boolean;
  success: boolean;
  pluginId: string;
  outcomeSent?: boolean;
};

export interface ApiNotificationPlugin {
  manifest: PluginManifest & { kind: "notification" };
  notify(event: ApiNotificationEvent, ctx: ApiNotificationDispatchContext): Promise<ApiNotificationDispatchResult>;
}
