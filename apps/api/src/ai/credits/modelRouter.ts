export type AiModelClass = "utility" | "standard" | "analysis" | "deep";
export type AiRoutingProfile = "market_analyst" | "position_copilot" | "trading_assistant" | "prediction_builder";

export type AiRoutingInput = {
  scope: string;
  profile: AiRoutingProfile;
  requestedSymbols: number;
  requestedAccounts: number;
  enabledSkills: string[];
  createsTradingDraft: boolean;
  expectedInputTokens?: number;
  allowDeep?: boolean;
};

export type AiRoutingDecision = {
  modelClass: AiModelClass;
  model: "gpt-5-nano" | "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  maxOutputTokens: number;
  maxToolRounds: number;
  reasonCode: string;
};

const UTILITY_SCOPES = new Set([
  "chat_title",
  "tagging",
  "symbol_extraction",
  "timeframe_extraction",
  "notification_copy"
]);

const ANALYSIS_SKILLS = new Set([
  "calendar.get_events",
  "news.get_market_news",
  "market.get_open_interest",
  "portfolio.get_positions",
  "risk.analyze_portfolio"
]);

export function routeOpenAiModel(input: AiRoutingInput): AiRoutingDecision {
  if (UTILITY_SCOPES.has(input.scope)) {
    return { modelClass: "utility", model: "gpt-5-nano", reasoningEffort: "minimal", maxOutputTokens: 1_000, maxToolRounds: 0, reasonCode: "utility_scope" };
  }

  const deepRequested = input.createsTradingDraft
    || (input.profile === "prediction_builder" && /create|generate|revise|strategy/i.test(input.scope));
  if (deepRequested && input.allowDeep) {
    return { modelClass: "deep", model: "gpt-5.6-sol", reasoningEffort: "high", maxOutputTokens: 16_000, maxToolRounds: 10, reasonCode: input.createsTradingDraft ? "confirmed_trade_draft" : "prediction_deep_workflow" };
  }

  const complexSkillCount = input.enabledSkills.filter((skill) => ANALYSIS_SKILLS.has(skill)).length;
  const analysisRequested = deepRequested
    || input.requestedSymbols > 1
    || input.requestedAccounts > 1
    || input.enabledSkills.length > 4
    || complexSkillCount >= 2
    || (input.expectedInputTokens ?? 0) > 100_000;
  if (analysisRequested) {
    return { modelClass: "analysis", model: "gpt-5.6-terra", reasoningEffort: "medium", maxOutputTokens: 10_000, maxToolRounds: 8, reasonCode: deepRequested ? "deep_not_enabled" : "multi_source_analysis" };
  }

  return { modelClass: "standard", model: "gpt-5.6-luna", reasoningEffort: "low", maxOutputTokens: 6_000, maxToolRounds: 5, reasonCode: "standard_agent" };
}
