import type { ChatToolDefinition } from "../provider.js";

export type AgentChatMode = "market" | "position" | "trade_planning";
export type AgentAccessLevel = "public_data" | "account_read" | "draft_actions";
export type AgentConversationStatus = "active" | "archived";
export type AgentMarketType = "spot" | "perp";
export type AgentVenue = "auto" | "binance" | "bitget" | "hyperliquid" | "mexc" | "bingx";
export type AgentProfileKey = "market_analyst" | "position_copilot";

export type AgentConversationContext = {
  profileId: string;
  profileKey: AgentProfileKey;
  selectedVenue: AgentVenue;
  selectedExchangeAccountId: string | null;
  marketType: AgentMarketType | null;
  symbol: string | null;
  locale: "de" | "en";
};

export type AgentSourceRef = {
  id: string;
  title: string;
  provider: string;
  url?: string;
  observedAt?: string;
  stale: boolean;
  degraded: boolean;
};

export type AgentUiBlock =
  | { type: "summary"; title?: string; text: string }
  | { type: "key_metrics"; title?: string; items: Array<{ label: string; value: string; tone?: "neutral" | "positive" | "warning" | "critical" }> }
  | { type: "risk_findings"; title?: string; riskLevel: "low" | "medium" | "high" | "critical"; items: Array<{ title: string; detail: string }> }
  | { type: "scenario_table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "prediction_comparison"; title?: string; prediction: string; position: string; divergence: string }
  | { type: "source_list"; title?: string; sources: AgentSourceRef[] };

export type AgentRunBudget = {
  maxToolIterations: number;
  maxToolCalls: number;
  maxCallsPerSkill: number;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type ResolvedAgentProfile = {
  id: string;
  key: AgentProfileKey | string;
  name: string;
  description: string;
  baseProfileKey: AgentProfileKey;
  version: number;
  enabledSkillIds: string[];
  allowedExchangeAccountIds: string[];
  preferredVenue: AgentVenue;
  preferredMarketType: AgentMarketType | null;
  actionLevel: AgentAccessLevel;
  builtin: boolean;
};

export type AgentToolResult<T = unknown> = {
  ok: boolean;
  data: T | null;
  meta: {
    toolId: string;
    sourceVenue?: string;
    sourceProvider?: string;
    observedAt?: string;
    fetchedAt: string;
    stale: boolean;
    degraded: boolean;
    fallbackUsed: boolean;
    cacheHit: boolean;
    warnings: string[];
  };
  error?: { code: string; message: string; retryable: boolean };
};

export type AgentSkillExecutionContext = {
  db: any;
  userId: string;
  runId: string;
  conversationId: string;
  locale: "de" | "en";
  selectedVenue: AgentVenue;
  selectedExchangeAccountId: string | null;
  marketType: AgentMarketType;
  symbol: string | null;
  profile: ResolvedAgentProfile;
  budget: AgentRunBudget;
  signal: AbortSignal;
  positionRefs: Map<string, unknown>;
};

export type AgentSkillDescriptor = {
  id: string;
  version: number;
  title: string;
  description: string;
  category: "market" | "intelligence" | "prediction" | "portfolio" | "risk" | "draft";
  accessLevel: AgentAccessLevel;
  sideEffect: false;
  maxCallsPerRun: number;
  timeoutMs: number;
  cacheTtlMs: number;
  supportedMarketTypes: readonly AgentMarketType[];
  inputSchema: import("zod").ZodTypeAny;
  outputSchema: import("zod").ZodTypeAny;
  toolDefinition: ChatToolDefinition;
  execute(context: AgentSkillExecutionContext, input: unknown): Promise<AgentToolResult>;
};

export type AgentChatResponse = {
  messageId: string;
  content: string;
  blocks: AgentUiBlock[];
  citations: AgentSourceRef[];
  run: {
    id: string;
    provider: string | null;
    model: string | null;
    toolIterations: number;
    toolCalls: number;
    latencyMs: number;
    degraded: boolean;
  };
};
