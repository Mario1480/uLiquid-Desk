import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

const predictionStateQuerySchema = z.object({
  exchange: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  signalMode: z.enum(["local_only", "ai_only", "both"]).optional()
});

const predictionEventsQuerySchema = z.object({
  stateId: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export type RegisterPredictionStateRoutesDeps = {
  db: any;
  normalizeExchangeValue(value: string): string;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  normalizePredictionMarketType(value: unknown): "spot" | "perp";
  normalizePredictionTimeframe(value: unknown): "5m" | "15m" | "1h" | "4h" | "1d";
  normalizePredictionSignalMode(value: unknown): "local_only" | "ai_only" | "both";
  normalizePredictionSignal(value: unknown): "up" | "down" | "neutral";
  normalizeTagList(value: unknown): string[];
  normalizeKeyDriverList(value: unknown): Array<Record<string, unknown>>;
  asRecord(value: unknown): Record<string, any>;
  readStateSignalMode(
    stateSignalMode: unknown,
    snapshot: Record<string, any>
  ): "local_only" | "ai_only" | "both";
  readAiPromptTemplateId(snapshot: Record<string, any>): string | null;
  readAiPromptTemplateName(snapshot: Record<string, any>): string | null;
  readLocalStrategyId(snapshot: Record<string, any>): string | null;
  readLocalStrategyName(snapshot: Record<string, any>): string | null;
  readCompositeStrategyId(snapshot: Record<string, any>): string | null;
  readCompositeStrategyName(snapshot: Record<string, any>): string | null;
  readPredictionStrategyRef(snapshot: Record<string, any>): Record<string, any> | null;
};

export function registerPredictionStateRoutes(
  app: express.Express,
  deps: RegisterPredictionStateRoutesDeps
) {
  app.get("/api/predictions/state", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionStateQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const symbol = deps.normalizeSymbolInput(parsed.data.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "invalid_symbol" });
    }

    const row = await deps.db.predictionState.findFirst({
      where: {
        userId: user.id,
        exchange: deps.normalizeExchangeValue(parsed.data.exchange),
        accountId: parsed.data.accountId,
        symbol,
        marketType: parsed.data.marketType,
        timeframe: parsed.data.timeframe,
        signalMode: parsed.data.signalMode
          ? deps.normalizePredictionSignalMode(parsed.data.signalMode)
          : undefined
      },
      orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }]
    });

    if (!row) {
      return res.status(404).json({ error: "prediction_state_not_found" });
    }

    const snapshot = deps.asRecord(row.featuresSnapshot);
    return res.json({
      signalMode: deps.readStateSignalMode(row.signalMode, snapshot),
      id: row.id,
      exchange: row.exchange,
      accountId: row.accountId,
      symbol: row.symbol,
      marketType: deps.normalizePredictionMarketType(row.marketType),
      timeframe: deps.normalizePredictionTimeframe(row.timeframe),
      tsUpdated: row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : null,
      tsPredictedFor: row.tsPredictedFor instanceof Date ? row.tsPredictedFor.toISOString() : null,
      signal: deps.normalizePredictionSignal(row.signal),
      expectedMovePct: Number.isFinite(Number(row.expectedMovePct)) ? Number(row.expectedMovePct) : null,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
      tags: deps.normalizeTagList(row.tags),
      explanation: typeof row.explanation === "string" ? row.explanation : null,
      keyDrivers: deps.normalizeKeyDriverList(row.keyDrivers),
      featureSnapshot: snapshot,
      aiPromptTemplateId: deps.readAiPromptTemplateId(snapshot),
      aiPromptTemplateName: deps.readAiPromptTemplateName(snapshot),
      localStrategyId: deps.readLocalStrategyId(snapshot),
      localStrategyName: deps.readLocalStrategyName(snapshot),
      compositeStrategyId: deps.readCompositeStrategyId(snapshot),
      compositeStrategyName: deps.readCompositeStrategyName(snapshot),
      strategyRef: deps.readPredictionStrategyRef(snapshot),
      modelVersion: row.modelVersion,
      autoScheduleEnabled: Boolean(row.autoScheduleEnabled),
      autoSchedulePaused: Boolean(row.autoSchedulePaused),
      lastChangeReason: typeof row.lastChangeReason === "string" ? row.lastChangeReason : null
    });
  });

  app.get("/api/predictions/events", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionEventsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const state = await deps.db.predictionState.findFirst({
      where: {
        id: parsed.data.stateId,
        userId: user.id
      },
      select: { id: true }
    });
    if (!state) {
      return res.status(404).json({ error: "prediction_state_not_found" });
    }

    const rows = await deps.db.predictionEvent.findMany({
      where: {
        stateId: state.id
      },
      orderBy: [{ tsCreated: "desc" }],
      take: parsed.data.limit
    });

    return res.json({
      items: rows.map((row: any) => ({
        id: row.id,
        stateId: row.stateId,
        tsCreated: row.tsCreated instanceof Date ? row.tsCreated.toISOString() : null,
        changeType: row.changeType,
        reason: typeof row.reason === "string" ? row.reason : null,
        delta: deps.asRecord(row.delta),
        prevSnapshot: row.prevSnapshot ?? null,
        newSnapshot: row.newSnapshot ?? null,
        modelVersion: row.modelVersion
      }))
    });
  });
}
