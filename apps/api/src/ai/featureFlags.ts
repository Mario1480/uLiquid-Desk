export function readAiFeatureFlag(name: string, developmentDefault: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return process.env.NODE_ENV !== "production" && developmentDefault;
  }
  return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

export function isAgentChatRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_AGENT_CHAT_ENABLED", true)
    && readAiFeatureFlag("AI_MODEL_ROUTER_V1", true)
    && readAiFeatureFlag("AI_RESPONSES_API_AGENT", true);
}

export function isAgentAccountReadsRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_AGENT_ACCOUNT_READS_ENABLED", true);
}

export function isAgentCustomProfilesRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_AGENT_CUSTOM_PROFILES_ENABLED", true);
}

export function isAgentTradeDraftsRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_AGENT_TRADE_DRAFTS_ENABLED", false);
}

export function isPositionCopilotRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_POSITION_COPILOT_ENABLED", true);
}

export function isPositionMonitoringRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_POSITION_MONITORING_ENABLED", true);
}

export function isMultiExchangeAnalysisRuntimeEnabled(): boolean {
  return readAiFeatureFlag("AI_AGENT_MULTI_EXCHANGE_ANALYSIS_ENABLED", true);
}
