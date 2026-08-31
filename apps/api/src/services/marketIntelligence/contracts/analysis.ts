import { z } from "zod";
import { groundedMarketSummarySchema } from "./summary.js";

export const marketIntelligenceAnalysisPayloadSchema = z.object({
  report: groundedMarketSummarySchema,
  context: z.object({
    dataAgeSeconds: z.number().int().nonnegative().nullable(),
    providerStates: z.array(z.object({
      providerId: z.string().min(1),
      providerType: z.string().min(1),
      state: z.enum(["healthy", "degraded", "unavailable", "disabled"]),
      checkedAt: z.string().datetime(),
      message: z.string().optional(),
      staleDataAgeSeconds: z.number().int().nonnegative().optional()
    }))
  })
});

export type MarketIntelligenceAnalysisPayload = z.infer<typeof marketIntelligenceAnalysisPayloadSchema>;

export type MarketIntelligenceAnalysisRecord = {
  id: string;
  horizon: "intraday" | "24h" | "7d";
  responseLanguage: "de" | "en";
  title: string;
  overallRisk: "low" | "moderate" | "high" | "unknown";
  sentiment: "bearish" | "neutral" | "bullish" | "mixed";
  degraded: boolean;
  generatedAt: string;
  createdAt: string;
  payload: MarketIntelligenceAnalysisPayload;
};
