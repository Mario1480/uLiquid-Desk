import type { CapabilityKey, PlanCapabilities } from "@mm/core";
import { AgentChatError } from "./errors.js";
import type { ResolvedAgentProfile } from "./contracts.js";

function readFlag(name: string, developmentDefault: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return process.env.NODE_ENV !== "production" && developmentDefault;
  return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

export type AgentChatFeatureAccess = {
  chat: boolean;
  accountReads: boolean;
  customProfiles: boolean;
  tradeDrafts: boolean;
};

export function resolveAgentChatFeatureAccess(params: {
  capabilities: PlanCapabilities;
  isAdmin: boolean;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
}): AgentChatFeatureAccess {
  const masterEnabled = readFlag("AI_AGENT_CHAT_ENABLED", true);
  const capability = (key: CapabilityKey) => params.isCapabilityAllowed(params.capabilities, key);
  return {
    chat: masterEnabled && (params.isAdmin || capability("product.ai_agent_chat")),
    accountReads: masterEnabled
      && readFlag("AI_AGENT_ACCOUNT_READS_ENABLED", true)
      && (params.isAdmin || capability("product.ai_agent_account_reads")),
    customProfiles: masterEnabled
      && readFlag("AI_AGENT_CUSTOM_PROFILES_ENABLED", true)
      && (params.isAdmin || capability("product.ai_agent_custom_profiles")),
    tradeDrafts: masterEnabled
      && readFlag("AI_AGENT_TRADE_DRAFTS_ENABLED", false)
      && capability("product.ai_agent_trade_drafts")
  };
}

export function assertAgentChatAccess(access: AgentChatFeatureAccess): void {
  if (!access.chat) throw new AgentChatError("agent_chat_feature_disabled", 403);
}

export function assertProfileAccess(profile: ResolvedAgentProfile, access: AgentChatFeatureAccess): void {
  assertAgentChatAccess(access);
  if (profile.actionLevel === "account_read" && !access.accountReads) {
    throw new AgentChatError("agent_chat_feature_disabled", 403, "Agent account reads are disabled.");
  }
  if (profile.actionLevel === "draft_actions") {
    throw new AgentChatError("agent_chat_skill_not_allowed", 403, "Trade drafts are outside the read-only MVP.");
  }
}
