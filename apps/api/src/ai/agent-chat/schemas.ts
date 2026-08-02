import { z } from "zod";

export const agentVenueSchema = z.enum(["auto", "binance", "bitget", "hyperliquid", "mexc", "bingx"]);
export const agentMarketTypeSchema = z.enum(["spot", "perp"]);
export const agentProfileKeySchema = z.enum(["market_analyst", "position_copilot"]);

export const conversationContextSchema = z.object({
  profileId: z.string().trim().min(1).max(191).optional(),
  profileKey: agentProfileKeySchema.default("market_analyst"),
  selectedVenue: agentVenueSchema.default("auto"),
  selectedExchangeAccountId: z.string().trim().min(1).max(191).nullable().default(null),
  marketType: agentMarketTypeSchema.nullable().default("perp"),
  symbol: z.string().trim().min(2).max(32).nullable().default("BTCUSDT")
}).strict();

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  context: conversationContextSchema
}).strict();

export const patchConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
  context: conversationContextSchema.partial().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "empty_update" });

export const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(8_000),
  locale: z.enum(["de", "en"]).default("en")
}).strict();

export const profileMutationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional().default(""),
  baseProfileKey: agentProfileKeySchema,
  enabledSkillIds: z.array(z.string().trim().min(1).max(100)).min(1).max(32),
  allowedExchangeAccountIds: z.array(z.string().trim().min(1).max(191)).max(20).default([]),
  preferredVenue: agentVenueSchema.default("auto"),
  preferredMarketType: agentMarketTypeSchema.nullable().default(null),
  actionLevel: z.enum(["public_data", "account_read"]).default("public_data")
}).strict();

export const agentSourceRefSchema = z.object({
  id: z.string().trim().min(1).max(191),
  title: z.string().trim().min(1).max(240),
  provider: z.string().trim().min(1).max(100),
  url: z.string().url().max(1000).optional(),
  observedAt: z.string().datetime().optional(),
  stale: z.boolean(),
  degraded: z.boolean()
}).strict();

export const agentUiBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("summary"), title: z.string().max(120).optional(), text: z.string().max(4_000) }).strict(),
  z.object({ type: z.literal("key_metrics"), title: z.string().max(120).optional(), items: z.array(z.object({ label: z.string().max(100), value: z.string().max(160), tone: z.enum(["neutral", "positive", "warning", "critical"]).optional() }).strict()).max(12) }).strict(),
  z.object({ type: z.literal("risk_findings"), title: z.string().max(120).optional(), riskLevel: z.enum(["low", "medium", "high", "critical"]), items: z.array(z.object({ title: z.string().max(140), detail: z.string().max(600) }).strict()).max(12) }).strict(),
  z.object({ type: z.literal("scenario_table"), title: z.string().max(120).optional(), columns: z.array(z.string().max(80)).max(8), rows: z.array(z.array(z.string().max(200)).max(8)).max(20) }).strict(),
  z.object({ type: z.literal("prediction_comparison"), title: z.string().max(120).optional(), prediction: z.string().max(1_000), position: z.string().max(1_000), divergence: z.string().max(1_000) }).strict(),
  z.object({ type: z.literal("source_list"), title: z.string().max(120).optional(), sources: z.array(agentSourceRefSchema).max(20) }).strict()
]);

export const agentAnswerEnvelopeSchema = z.object({
  content: z.string().trim().min(1).max(12_000),
  blocks: z.array(agentUiBlockSchema).max(12).default([]),
  citations: z.array(agentSourceRefSchema).max(20).default([])
}).strict();
