export type AgentChatErrorCode =
  | "agent_chat_feature_disabled"
  | "agent_chat_profile_not_found"
  | "agent_chat_skill_not_allowed"
  | "agent_chat_account_access_denied"
  | "agent_chat_venue_unsupported"
  | "agent_chat_market_data_degraded"
  | "agent_chat_tool_budget_exceeded"
  | "agent_chat_provider_unavailable"
  | "agent_chat_conversation_not_found"
  | "agent_chat_message_invalid"
  | "agent_chat_run_in_progress";

export class AgentChatError extends Error {
  constructor(
    readonly code: AgentChatErrorCode,
    readonly status: number,
    message = code
  ) {
    super(message);
    this.name = "AgentChatError";
  }
}

export function toAgentChatError(error: unknown): AgentChatError {
  if (error instanceof AgentChatError) return error;
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  if (message.includes("budget")) return new AgentChatError("agent_chat_tool_budget_exceeded", 429);
  if (message.includes("provider") || message.includes("ai_api_key") || message.includes("ai_model")) {
    return new AgentChatError("agent_chat_provider_unavailable", 503);
  }
  return new AgentChatError("agent_chat_provider_unavailable", 503, message);
}
