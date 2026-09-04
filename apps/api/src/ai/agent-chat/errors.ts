export type AgentChatErrorCode =
  | "agent_chat_feature_disabled"
  | "agent_chat_profile_not_found"
  | "agent_chat_skill_not_allowed"
  | "agent_chat_account_access_denied"
  | "agent_chat_venue_unsupported"
  | "agent_chat_market_data_degraded"
  | "agent_chat_tool_budget_exceeded"
  | "agent_chat_tool_result_invalid"
  | "agent_chat_provider_unavailable"
  | "agent_chat_conversation_not_found"
  | "agent_chat_message_invalid"
  | "agent_chat_run_in_progress"
  | "ai_credit_balance_exhausted"
  | "ai_credit_reservation_failed"
  | "ai_daily_limit_exceeded"
  | "ai_monthly_limit_exceeded"
  | "ai_run_limit_exceeded"
  | "ai_pricing_unavailable"
  | "ai_usage_settlement_failed";

export class AgentChatError extends Error {
  constructor(
    readonly code: AgentChatErrorCode,
    readonly status: number,
    message: string = code
  ) {
    super(message);
    this.name = "AgentChatError";
  }
}

export function toAgentChatError(error: unknown): AgentChatError {
  if (error instanceof AgentChatError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AgentChatError(
      "agent_chat_provider_unavailable",
      503,
      "The AI provider timed out. Please try again."
    );
  }
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  const creditCodes = new Set<AgentChatErrorCode>([
    "ai_credit_balance_exhausted",
    "ai_credit_reservation_failed",
    "ai_daily_limit_exceeded",
    "ai_monthly_limit_exceeded",
    "ai_run_limit_exceeded",
    "ai_pricing_unavailable",
    "ai_usage_settlement_failed"
  ]);
  if (creditCodes.has(message as AgentChatErrorCode)) {
    const status = Number((error as { status?: unknown })?.status);
    return new AgentChatError(message as AgentChatErrorCode, Number.isInteger(status) ? status : 409);
  }
  if (message.includes("budget")) return new AgentChatError("agent_chat_tool_budget_exceeded", 429);
  if (message.includes("ai_empty_response")) {
    return new AgentChatError(
      "agent_chat_provider_unavailable",
      503,
      "The AI provider returned no usable answer. Please try again."
    );
  }
  if (message.includes("provider") || message.includes("ai_api_key") || message.includes("ai_model")) {
    return new AgentChatError("agent_chat_provider_unavailable", 503);
  }
  return new AgentChatError("agent_chat_provider_unavailable", 503, message);
}
