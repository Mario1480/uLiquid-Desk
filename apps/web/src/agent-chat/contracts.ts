export type AgentVenue = "auto" | "binance" | "bitget" | "hyperliquid" | "mexc" | "bingx";
export type AgentMarketType = "spot" | "perp";
export type AgentProfileKey = "market_analyst" | "position_copilot";

export type AgentProfile = {
  id: string;
  key: string;
  name: string;
  description: string;
  baseProfileKey: AgentProfileKey;
  version: number;
  enabledSkillIds: string[];
  allowedExchangeAccountIds: string[];
  preferredVenue: AgentVenue;
  preferredMarketType: AgentMarketType | null;
  actionLevel: "public_data" | "account_read";
  builtin: boolean;
};

export type AgentSkill = {
  id: string;
  title: string;
  description: string;
  category: "market" | "intelligence" | "prediction" | "portfolio" | "risk" | "draft";
  accessLevel: "public_data" | "account_read" | "draft_actions";
  sideEffect: false;
  supportedMarketTypes: AgentMarketType[];
};

export type AgentAccount = { id: string; exchange: string; label: string; updatedAt: string };

export type AgentProfilesResponse = {
  featureAccess: { chat: boolean; accountReads: boolean; customProfiles: boolean; tradeDrafts: boolean };
  plan: string;
  profiles: AgentProfile[];
  skills: AgentSkill[];
  accounts: AgentAccount[];
};

export type AgentConversation = {
  id: string;
  profileId: string | null;
  profileKey: AgentProfileKey;
  title: string;
  status: "active" | "archived";
  selectedVenue: AgentVenue;
  selectedExchangeAccountId: string | null;
  marketType: AgentMarketType | null;
  symbol: string | null;
  lastMessageAt: string;
  createdAt: string;
  messages?: AgentMessage[];
};

export type AgentSourceRef = { id: string; title: string; provider: string; url?: string; observedAt?: string; stale: boolean; degraded: boolean };

export type AgentUiBlock =
  | { type: "summary"; title?: string; text: string }
  | { type: "key_metrics"; title?: string; items: Array<{ label: string; value: string; tone?: "neutral" | "positive" | "warning" | "critical" }> }
  | { type: "risk_findings"; title?: string; riskLevel: "low" | "medium" | "high" | "critical"; items: Array<{ title: string; detail: string }> }
  | { type: "scenario_table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "prediction_comparison"; title?: string; prediction: string; position: string; divergence: string }
  | { type: "source_list"; title?: string; sources: AgentSourceRef[] };

export type AgentMessage = { id: string; role: "user" | "assistant"; content: string; blocks?: AgentUiBlock[] | null; sourceRefs?: AgentSourceRef[] | null; createdAt: string };

export type AgentChatResponse = {
  messageId: string;
  content: string;
  blocks: AgentUiBlock[];
  citations: AgentSourceRef[];
  run: { id: string; modelClass: string; toolIterations: number; toolCalls: number; latencyMs: number; degraded: boolean; chargedCredits: string; remainingCredits: string | null; skillCategories: AgentSkill["category"][] };
};

export type AgentActivity = {
  id: string;
  status: string;
  latencyMs: number | null;
  toolCalls: Array<{ id: string; toolName: string; status: "loading" | "success" | "degraded" | "failed" | "blocked"; venue: string | null; durationMs: number | null; resultSummary?: { observedAt?: string; stale?: boolean; degraded?: boolean; fallbackUsed?: boolean } | null }>;
};

export type AgentContextDraft = {
  profileId: string;
  profileKey: AgentProfileKey;
  selectedVenue: AgentVenue;
  selectedExchangeAccountId: string | null;
  marketType: AgentMarketType;
  symbol: string | null;
};
