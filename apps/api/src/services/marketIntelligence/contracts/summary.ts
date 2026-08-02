import { z } from "zod";

export type SummaryCitation = {
  id: string;
  newsItemId?: string;
  economicEventId?: string;
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
};

export const marketSummarySchema = z.object({
  title: z.string().min(1).max(160),
  generatedAt: z.string().datetime(),
  horizon: z.enum(["intraday", "24h", "7d"]),
  overallRisk: z.enum(["low", "moderate", "high", "unknown"]),
  sentiment: z.enum(["bearish", "neutral", "bullish", "mixed"]),
  highlights: z.array(z.object({
    type: z.enum(["macro", "crypto", "regulation", "security", "market"]),
    importance: z.enum(["low", "medium", "high"]),
    headline: z.string().min(1).max(240),
    explanation: z.string().min(1).max(800),
    sourceIds: z.array(z.string().min(1)).min(1),
    inference: z.boolean().default(false)
  })).max(5),
  upcomingRisks: z.array(z.object({
    label: z.string().min(1).max(240),
    scheduledAt: z.string().datetime().optional(),
    sourceIds: z.array(z.string().min(1)).min(1)
  })).max(8),
  uncertainties: z.array(z.string().min(1).max(300)).max(10)
});

export type MarketSummary = z.infer<typeof marketSummarySchema>;

export const groundedMarketSummarySchema = z.object({
  summary: marketSummarySchema,
  citations: z.array(z.object({
    id: z.string().min(1),
    newsItemId: z.string().optional(),
    economicEventId: z.string().optional(),
    sourceName: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    publishedAt: z.string().datetime().optional()
  })),
  meta: z.object({
    promptVersion: z.string().min(1),
    model: z.string().min(1),
    sourceClusterHash: z.string().min(1),
    cached: z.boolean(),
    degraded: z.boolean(),
    warnings: z.array(z.string())
  })
});

export type GroundedMarketSummary = {
  summary: MarketSummary;
  citations: SummaryCitation[];
  meta: {
    promptVersion: string;
    model: string;
    sourceClusterHash: string;
    cached: boolean;
    degraded: boolean;
    warnings: string[];
  };
};
