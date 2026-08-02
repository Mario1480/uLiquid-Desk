export const POSITION_COPILOT_MANUAL_REVIEW_HREF = "/agent-chat" as const;
export const POSITION_COPILOT_AGENT_CHAT_PREFILL_KEY = "uliquid.agentChat.positionPrefill.v1" as const;

export function buildPositionCopilotAgentChatPrefill(input: {
  exchangeAccountId: string;
  symbol: string;
  marketType: "spot" | "perp";
}) {
  return {
    profileId: "builtin:position_copilot",
    profileKey: "position_copilot",
    selectedVenue: "auto",
    selectedExchangeAccountId: input.exchangeAccountId,
    marketType: input.marketType,
    symbol: input.symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 32)
  } as const;
}

export const POSITION_COPILOT_ALLOWED_CLIENT_REQUESTS = [
  "GET /api/position-copilot/settings",
  "PUT /api/position-copilot/settings",
  "POST /api/position-copilot/analyze"
] as const;

export function isReadOnlyPositionCopilotNavigation(href: string): boolean {
  return href === POSITION_COPILOT_MANUAL_REVIEW_HREF;
}
