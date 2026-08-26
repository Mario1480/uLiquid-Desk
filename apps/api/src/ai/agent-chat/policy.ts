import type { CapabilityKey, PlanCapabilities } from "@mm/core";
import { AgentChatError } from "./errors.js";
import type { ResolvedAgentProfile } from "./contracts.js";
import {
  isAgentAccountReadsRuntimeEnabled,
  isAgentChatRuntimeEnabled,
  isAgentCustomProfilesRuntimeEnabled,
  isAgentTradeDraftsRuntimeEnabled,
  isMultiExchangeAnalysisRuntimeEnabled,
  isPositionCopilotRuntimeEnabled
} from "../featureFlags.js";

export type AgentChatFeatureAccess = {
  chat: boolean;
  accountReads: boolean;
  customProfiles: boolean;
  positionCopilot: boolean;
  multiExchangeAnalysis: boolean;
  tradeDrafts: boolean;
};

export function resolveAgentChatFeatureAccess(params: {
  capabilities: PlanCapabilities;
  isAdmin: boolean;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
}): AgentChatFeatureAccess {
  const agentEnabled = isAgentChatRuntimeEnabled();
  const capability = (key: CapabilityKey) => params.isCapabilityAllowed(params.capabilities, key);
  const accountReads = agentEnabled
    && isAgentAccountReadsRuntimeEnabled()
    && (params.isAdmin || capability("product.ai_agent_account_reads"));
  return {
    chat: agentEnabled && (params.isAdmin || capability("product.ai_agent_chat")),
    accountReads,
    customProfiles: agentEnabled
      && isAgentCustomProfilesRuntimeEnabled()
      && (params.isAdmin || capability("product.ai_agent_custom_profiles")),
    positionCopilot: accountReads
      && isPositionCopilotRuntimeEnabled()
      && (params.isAdmin || capability("product.ai_position_copilot")),
    multiExchangeAnalysis: accountReads
      && isMultiExchangeAnalysisRuntimeEnabled()
      && (params.isAdmin || capability("product.ai_multi_exchange_analysis")),
    tradeDrafts: agentEnabled
      && isAgentTradeDraftsRuntimeEnabled()
      && capability("product.ai_agent_trade_drafts")
  };
}

export function assertAgentChatAccess(access: AgentChatFeatureAccess): void {
  if (!access.chat) throw new AgentChatError("agent_chat_feature_disabled", 403);
}

export function canAccessAgentProfile(
  profile: ResolvedAgentProfile,
  access: AgentChatFeatureAccess
): boolean {
  if (!access.chat) return false;
  if (profile.baseProfileKey === "position_copilot" && !access.positionCopilot) return false;
  if (profile.actionLevel === "account_read" && !access.accountReads) return false;
  if (profile.actionLevel === "draft_actions") return false;
  return true;
}

export function assertProfileAccess(profile: ResolvedAgentProfile, access: AgentChatFeatureAccess): void {
  assertAgentChatAccess(access);
  if (profile.baseProfileKey === "position_copilot" && !access.positionCopilot) {
    throw new AgentChatError("agent_chat_feature_disabled", 403, "Position Copilot is disabled.");
  }
  if (profile.actionLevel === "account_read" && !access.accountReads) {
    throw new AgentChatError("agent_chat_feature_disabled", 403, "Agent account reads are disabled.");
  }
  if (profile.actionLevel === "draft_actions") {
    throw new AgentChatError("agent_chat_skill_not_allowed", 403, "Trade drafts are outside the read-only MVP.");
  }
}
