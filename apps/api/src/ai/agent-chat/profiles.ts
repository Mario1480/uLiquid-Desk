import { AgentChatError } from "./errors.js";
import type { AgentAccessLevel, AgentProfileKey, ResolvedAgentProfile } from "./contracts.js";

const MARKET_SKILLS = [
  "market.get_ohlcv",
  "market.get_indicators",
  "market.get_ticker",
  "market.get_orderbook",
  "market.get_funding_rate",
  "market.get_open_interest",
  "market.get_contract_info",
  "intelligence.get_news",
  "intelligence.get_economic_events",
  "predictions.get_recent",
  "predictions.get_performance_summary"
] as const;

const POSITION_SKILLS = [
  ...MARKET_SKILLS,
  "portfolio.get_positions",
  "portfolio.get_balance_summary",
  "portfolio.get_open_orders",
  "risk.analyze_portfolio",
  "risk.analyze_position_snapshot"
] as const;

export const BUILTIN_AGENT_PROFILES: Record<AgentProfileKey, ResolvedAgentProfile> = {
  market_analyst: {
    id: "builtin:market_analyst",
    key: "market_analyst",
    name: "Market Analyst",
    description: "Cross-venue market, intelligence and prediction analysis using public data.",
    baseProfileKey: "market_analyst",
    version: 5,
    enabledSkillIds: [...MARKET_SKILLS],
    allowedExchangeAccountIds: [],
    preferredVenue: "auto",
    preferredMarketType: "perp",
    actionLevel: "public_data",
    builtin: true
  },
  position_copilot: {
    id: "builtin:position_copilot",
    key: "position_copilot",
    name: "Position Copilot",
    description: "Read-only account and deterministic position risk analysis.",
    baseProfileKey: "position_copilot",
    version: 5,
    enabledSkillIds: [...POSITION_SKILLS],
    allowedExchangeAccountIds: [],
    preferredVenue: "auto",
    preferredMarketType: "perp",
    actionLevel: "account_read",
    builtin: true
  }
};

export function allowedSkillsForBaseProfile(key: AgentProfileKey): readonly string[] {
  return BUILTIN_AGENT_PROFILES[key].enabledSkillIds;
}

export function resolveBuiltinAgentProfile(key: string): ResolvedAgentProfile {
  const profile = BUILTIN_AGENT_PROFILES[key as AgentProfileKey];
  if (!profile) throw new AgentChatError("agent_chat_profile_not_found", 404);
  return { ...profile, enabledSkillIds: [...profile.enabledSkillIds] };
}

export function assertProfileSkillsAllowed(params: {
  baseProfileKey: AgentProfileKey;
  enabledSkillIds: string[];
  actionLevel: AgentAccessLevel;
}): void {
  const allowed = new Set(allowedSkillsForBaseProfile(params.baseProfileKey));
  if (params.enabledSkillIds.some((id) => !allowed.has(id))) {
    throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  }
  if (params.baseProfileKey === "market_analyst" && params.actionLevel !== "public_data") {
    throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  }
  if (params.actionLevel === "draft_actions") {
    throw new AgentChatError("agent_chat_skill_not_allowed", 403);
  }
}
