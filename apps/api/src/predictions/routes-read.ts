import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { resolvePredictionPerformanceMetrics } from "./performanceMetrics.js";

const predictionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  mode: z.enum(["state", "history"]).default("state")
});

const predictionMetricsQuerySchema = z.object({
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  symbol: z.string().trim().min(1).optional(),
  signalSource: z.enum(["local", "ai"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  bins: z.coerce.number().int().min(2).max(20).default(10)
});

const predictionQualityQuerySchema = z.object({
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  symbol: z.string().trim().min(1).optional(),
  signalSource: z.enum(["local", "ai"]).optional()
});

const thresholdsLatestQuerySchema = z.object({
  exchange: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  marketType: z.enum(["spot", "perp"]).default("perp"),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  tf: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional()
});

export type RegisterPredictionReadRoutesDeps = {
  db: any;
  normalizePredictionMarketType(value: unknown): "spot" | "perp";
  normalizePredictionTimeframe(value: unknown): "5m" | "15m" | "1h" | "4h" | "1d";
  normalizePredictionSignal(value: unknown): "up" | "down" | "neutral";
  normalizeSymbolInput(value: string | null | undefined): string | null;
  normalizeTagList(value: unknown): string[];
  asRecord(value: unknown): Record<string, any>;
  asStringArray(value: unknown): string[];
  timeframeToIntervalMs(timeframe: "5m" | "15m" | "1h" | "4h" | "1d"): number;
  PREDICTION_OUTCOME_HORIZON_BARS: number;
  readLocalPredictionSnapshot(snapshot: Record<string, any>): Record<string, any> | null;
  readAiPredictionSnapshot(snapshot: Record<string, any>): Record<string, any> | null;
  readAiPromptTemplateId(snapshot: Record<string, any>): string | null;
  readAiPromptTemplateName(snapshot: Record<string, any>): string | null;
  readLocalStrategyId(snapshot: Record<string, any>): string | null;
  readLocalStrategyName(snapshot: Record<string, any>): string | null;
  readCompositeStrategyId(snapshot: Record<string, any>): string | null;
  readCompositeStrategyName(snapshot: Record<string, any>): string | null;
  readPredictionStrategyRef(snapshot: Record<string, any>): Record<string, any> | null;
  readStateSignalMode(
    stateSignalMode: unknown,
    snapshot: Record<string, any>
  ): "local_only" | "ai_only" | "both";
  readSignalMode(snapshot: Record<string, any>): "local_only" | "ai_only" | "both";
  isAutoScheduleEnabled(value: unknown): boolean;
  readConfiguredConfidenceTarget(snapshot: Record<string, any>): number | null;
  readSelectedSignalSource(snapshot: Record<string, any>): "local" | "ai" | null;
  readRealizedPayloadFromOutcomeMeta(outcomeMeta: unknown): Record<string, any>;
  normalizeSnapshotPrediction(snapshot: Record<string, any>): Record<string, any> | null;
  getPredictionPerformanceResetAt(userId: string): Promise<Date | null>;
  setPredictionPerformanceResetAt(userId: string, isoTimestamp: string): Promise<string>;
  computePredictionErrorMetrics(input: {
    signal: "up" | "down" | "neutral";
    expectedMovePct: number | null;
    realizedReturnPct: number | null;
  }): Record<string, any>;
  computeDirectionalRealizedReturnPct(
    signal: "up" | "down" | "neutral",
    startClose: number,
    endClose: number
  ): number | null;
  normalizeConfidencePct(value: number): number | null;
  buildPredictionMetricsSummary(
    samples: Array<Record<string, unknown>>,
    bins: number
  ): Record<string, unknown>;
  resolveFeatureThresholds(input: {
    exchange: string;
    symbol: string;
    marketType: "spot" | "perp";
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d";
  }): Promise<Record<string, any>>;
  normalizeExchangeValue(value: string): string;
  resolveGlobalPredictionRefreshIntervalsMs(): Promise<Record<"5m" | "15m" | "1h" | "4h" | "1d", number>>;
  refreshIntervalMsForTimeframe(
    timeframe: "5m" | "15m" | "1h" | "4h" | "1d",
    intervals: Record<"5m" | "15m" | "1h" | "4h" | "1d", number>
  ): number;
  parseDirectionPreference(value: unknown): "long" | "short" | "either";
  readConfidenceTarget(snapshot: Record<string, any>): number;
  readRequestedLeverage(snapshot: Record<string, any>): number | undefined;
  PREDICTION_REFRESH_SCAN_LIMIT: number;
};

export function registerPredictionReadRoutes(
  app: express.Express,
  deps: RegisterPredictionReadRoutesDeps
) {
  app.get("/api/predictions", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    if (parsed.data.mode === "state") {
      const rows = await deps.db.predictionState.findMany({
        where: { userId: user.id },
        orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
        take: parsed.data.limit,
        select: {
          id: true,
          symbol: true,
          marketType: true,
          timeframe: true,
          tsUpdated: true,
          signal: true,
          expectedMovePct: true,
          confidence: true,
          explanation: true,
          tags: true,
          featuresSnapshot: true,
          signalMode: true,
          autoScheduleEnabled: true,
          autoSchedulePaused: true,
          confidenceTargetPct: true,
          exchange: true,
          accountId: true,
          lastChangeReason: true
        }
      });

      const items = rows.map((row: any) => {
        const snapshot = deps.asRecord(row.featuresSnapshot);
        const signalMode = deps.readStateSignalMode(row.signalMode, snapshot);
        return {
          id: row.id,
          symbol: row.symbol,
          marketType: deps.normalizePredictionMarketType(row.marketType),
          timeframe: deps.normalizePredictionTimeframe(row.timeframe),
          tsCreated:
            row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : new Date().toISOString(),
          signal: deps.normalizePredictionSignal(row.signal),
          expectedMovePct: Number.isFinite(Number(row.expectedMovePct))
            ? Number(row.expectedMovePct)
            : 0,
          confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
          explanation: typeof row.explanation === "string" ? row.explanation : "",
          tags: deps.normalizeTagList(row.tags),
          entryPrice: null,
          stopLossPrice: null,
          takeProfitPrice: null,
          horizonMs:
            deps.timeframeToIntervalMs(deps.normalizePredictionTimeframe(row.timeframe)) *
            deps.PREDICTION_OUTCOME_HORIZON_BARS,
          outcomeStatus: "pending",
          outcomeResult: null,
          outcomePnlPct: null,
          maxFavorablePct: null,
          maxAdversePct: null,
          outcomeEvaluatedAt: null,
          localPrediction: deps.readLocalPredictionSnapshot(snapshot),
          aiPrediction: deps.readAiPredictionSnapshot(snapshot),
          aiPromptTemplateId: deps.readAiPromptTemplateId(snapshot),
          aiPromptTemplateName: deps.readAiPromptTemplateName(snapshot),
          localStrategyId: deps.readLocalStrategyId(snapshot),
          localStrategyName: deps.readLocalStrategyName(snapshot),
          compositeStrategyId: deps.readCompositeStrategyId(snapshot),
          compositeStrategyName: deps.readCompositeStrategyName(snapshot),
          strategyRef: deps.readPredictionStrategyRef(snapshot),
          signalMode,
          autoScheduleEnabled: Boolean(row.autoScheduleEnabled) && !Boolean(row.autoSchedulePaused),
          confidenceTargetPct:
            Number.isFinite(Number(row.confidenceTargetPct))
            && row.confidenceTargetPct !== null
            && row.confidenceTargetPct !== undefined
              ? Number(row.confidenceTargetPct)
              : 55,
          exchange:
            typeof row.exchange === "string" && row.exchange.trim()
              ? row.exchange
              : "bitget",
          accountId: typeof row.accountId === "string" ? row.accountId : null,
          lastUpdatedAt:
            row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : null,
          lastChangeReason:
            typeof row.lastChangeReason === "string" ? row.lastChangeReason : null
        };
      });

      return res.json({ items });
    }

    const rows = await deps.db.prediction.findMany({
      where: { userId: user.id },
      orderBy: [{ tsCreated: "desc" }, { createdAt: "desc" }],
      take: parsed.data.limit
    });

    const botIds = rows
      .map((row: any) => (typeof row.botId === "string" && row.botId.trim() ? row.botId : null))
      .filter((value: string | null): value is string => Boolean(value));

    const [bots, exchangeAccounts] = await Promise.all([
      botIds.length > 0
        ? deps.db.bot.findMany({
            where: {
              id: { in: botIds },
              userId: user.id
            },
            select: {
              id: true,
              exchange: true,
              exchangeAccountId: true
            }
          })
        : Promise.resolve([]),
      deps.db.exchangeAccount.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          exchange: true
        }
      })
    ]);

    const botMap = new Map<string, { exchange: string; exchangeAccountId: string | null }>();
    for (const bot of bots) {
      botMap.set(bot.id, {
        exchange: bot.exchange,
        exchangeAccountId: bot.exchangeAccountId ?? null
      });
    }

    const defaultAccount = exchangeAccounts[0] ?? null;
    const accountMap = new Map<string, { exchange: string }>();
    for (const account of exchangeAccounts) {
      accountMap.set(account.id, { exchange: account.exchange });
    }

    const items = rows.map((row: any) => {
      const linkedBot = typeof row.botId === "string" ? botMap.get(row.botId) : undefined;
      const snapshot = deps.asRecord(row.featuresSnapshot);
      const requestedPrefillAccountId =
        typeof snapshot.prefillExchangeAccountId === "string"
          ? snapshot.prefillExchangeAccountId
          : null;
      const requestedPrefillExchange =
        typeof snapshot.prefillExchange === "string"
          ? snapshot.prefillExchange
          : null;

      const prefillAccountId =
        requestedPrefillAccountId && accountMap.has(requestedPrefillAccountId)
          ? requestedPrefillAccountId
          : null;

      const fallbackAccountId =
        prefillAccountId ??
        linkedBot?.exchangeAccountId ??
        defaultAccount?.id ??
        null;

      const accountExchange = fallbackAccountId ? accountMap.get(fallbackAccountId)?.exchange : null;
      const fallbackExchange =
        requestedPrefillExchange ??
        accountExchange ??
        linkedBot?.exchange ??
        defaultAccount?.exchange ??
        "bitget";
      const signal = deps.normalizePredictionSignal(row.signal);
      const realizedMetrics = resolvePredictionPerformanceMetrics({
        signal,
        expectedMovePct: row.expectedMovePct,
        outcomeMeta: row.outcomeMeta,
        outcomePnlPct: row.outcomePnlPct,
        asRecord: deps.asRecord,
        readRealizedPayloadFromOutcomeMeta: deps.readRealizedPayloadFromOutcomeMeta,
        computePredictionErrorMetrics: deps.computePredictionErrorMetrics
      });

      return {
        id: row.id,
        symbol: row.symbol,
        marketType: deps.normalizePredictionMarketType(row.marketType),
        timeframe: deps.normalizePredictionTimeframe(row.timeframe),
        tsCreated: row.tsCreated.toISOString(),
        signal,
        expectedMovePct: row.expectedMovePct,
        confidence: row.confidence,
        explanation: typeof row.explanation === "string" ? row.explanation : "",
        tags: deps.asStringArray(row.tags).slice(0, 10),
        entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
        stopLossPrice: Number.isFinite(Number(row.stopLossPrice)) ? Number(row.stopLossPrice) : null,
        takeProfitPrice: Number.isFinite(Number(row.takeProfitPrice)) ? Number(row.takeProfitPrice) : null,
        horizonMs: Number.isFinite(Number(row.horizonMs)) ? Number(row.horizonMs) : null,
        outcomeStatus: typeof row.outcomeStatus === "string" ? row.outcomeStatus : "pending",
        outcomeResult: typeof row.outcomeResult === "string" ? row.outcomeResult : null,
        outcomePnlPct: Number.isFinite(Number(row.outcomePnlPct)) ? Number(row.outcomePnlPct) : null,
        maxFavorablePct: Number.isFinite(Number(row.maxFavorablePct)) ? Number(row.maxFavorablePct) : null,
        maxAdversePct: Number.isFinite(Number(row.maxAdversePct)) ? Number(row.maxAdversePct) : null,
        outcomeEvaluatedAt:
          row.outcomeEvaluatedAt instanceof Date ? row.outcomeEvaluatedAt.toISOString() : null,
        realizedReturnPct: realizedMetrics.realizedReturnPct,
        realizedEvaluatedAt:
          deps.readRealizedPayloadFromOutcomeMeta(row.outcomeMeta).evaluatedAt ?? null,
        realizedHit: realizedMetrics.hit,
        realizedAbsError: realizedMetrics.absError,
        realizedSqError: realizedMetrics.sqError,
        localPrediction:
          deps.readLocalPredictionSnapshot(snapshot) ??
          deps.normalizeSnapshotPrediction(deps.asRecord({
            signal: row.signal,
            expectedMovePct: row.expectedMovePct,
            confidence: row.confidence
          })),
        aiPrediction: deps.readAiPredictionSnapshot(snapshot),
        aiPromptTemplateId: deps.readAiPromptTemplateId(snapshot),
        aiPromptTemplateName: deps.readAiPromptTemplateName(snapshot),
        localStrategyId: deps.readLocalStrategyId(snapshot),
        localStrategyName: deps.readLocalStrategyName(snapshot),
        compositeStrategyId: deps.readCompositeStrategyId(snapshot),
        compositeStrategyName: deps.readCompositeStrategyName(snapshot),
        strategyRef: deps.readPredictionStrategyRef(snapshot),
        signalMode: deps.readSignalMode(snapshot),
        autoScheduleEnabled: deps.isAutoScheduleEnabled(snapshot.autoScheduleEnabled),
        confidenceTargetPct: deps.readConfiguredConfidenceTarget(snapshot),
        exchange: fallbackExchange,
        accountId: fallbackAccountId
      };
    });

    return res.json({
      items
    });
  });

  app.post("/api/predictions/performance/reset", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const resetAt = await deps.setPredictionPerformanceResetAt(user.id, new Date().toISOString());
    return res.json({
      ok: true,
      resetAt
    });
  });

  app.get("/api/predictions/quality", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionQualityQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const timeframeInput = parsed.data.timeframe ?? parsed.data.tf;
    const timeframe = timeframeInput ? deps.normalizePredictionTimeframe(timeframeInput) : null;
    const symbol = parsed.data.symbol ? deps.normalizeSymbolInput(parsed.data.symbol) : null;
    const signalSource = parsed.data.signalSource;
    if (parsed.data.symbol !== undefined && !symbol) {
      return res.status(400).json({ error: "invalid_symbol" });
    }

    const resetAt = await deps.getPredictionPerformanceResetAt(user.id);
    const where: Record<string, unknown> = {
      userId: user.id,
      outcomeStatus: "closed"
    };
    if (timeframe) where.timeframe = timeframe;
    if (symbol) where.symbol = symbol;
    if (resetAt) {
      where.tsCreated = { gte: resetAt };
    }

    const rowsRaw = await deps.db.prediction.findMany({
      where,
      orderBy: { tsCreated: "desc" },
      take: 2000,
      select: {
        tsCreated: true,
        signal: true,
        expectedMovePct: true,
        confidence: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomeResult: true,
        outcomePnlPct: true
      }
    });
    const rows = signalSource
      ? rowsRaw.filter((row: any) => {
          const snapshot = deps.asRecord(row.featuresSnapshot);
          return deps.readSelectedSignalSource(snapshot) === signalSource;
        })
      : rowsRaw;

    let tp = 0;
    let sl = 0;
    let expired = 0;
    let skipped = 0;
    let invalid = 0;
    let pnlSum = 0;
    let pnlCount = 0;
    let compare24hSampleSize = 0;
    let compare24hLocalHits = 0;
    let compare24hAiHits = 0;
    const compare24hWindowStartMs = Date.now() - 24 * 60 * 60 * 1000;

    for (const row of rows) {
      const result = typeof row.outcomeResult === "string" ? row.outcomeResult : "";
      if (result === "tp_hit") tp += 1;
      else if (result === "sl_hit") sl += 1;
      else if (result === "expired") expired += 1;
      else if (result === "skipped") skipped += 1;
      else if (result === "invalid") invalid += 1;

      const pnl = Number(row.outcomePnlPct);
      if (Number.isFinite(pnl)) {
        pnlSum += pnl;
        pnlCount += 1;
      }

      if (!(row.tsCreated instanceof Date) || row.tsCreated.getTime() < compare24hWindowStartMs) {
        continue;
      }
      const outcomeMeta = deps.asRecord(row.outcomeMeta);
      const startClose = Number(outcomeMeta.realizedStartClose);
      const endClose = Number(outcomeMeta.realizedEndClose);
      if (!Number.isFinite(startClose) || startClose <= 0 || !Number.isFinite(endClose) || endClose <= 0) {
        continue;
      }

      const snapshot = deps.asRecord(row.featuresSnapshot);
      const localPrediction =
        deps.readLocalPredictionSnapshot(snapshot) ??
        deps.normalizeSnapshotPrediction(deps.asRecord({
          signal: row.signal,
          expectedMovePct: row.expectedMovePct,
          confidence: row.confidence
        }));
      const aiPrediction = deps.readAiPredictionSnapshot(snapshot);
      if (!localPrediction || !aiPrediction) {
        continue;
      }

      const localMetrics = deps.computePredictionErrorMetrics({
        signal: localPrediction.signal,
        expectedMovePct: localPrediction.expectedMovePct,
        realizedReturnPct: deps.computeDirectionalRealizedReturnPct(
          localPrediction.signal,
          startClose,
          endClose
        )
      });
      const aiMetrics = deps.computePredictionErrorMetrics({
        signal: aiPrediction.signal,
        expectedMovePct: aiPrediction.expectedMovePct,
        realizedReturnPct: deps.computeDirectionalRealizedReturnPct(aiPrediction.signal, startClose, endClose)
      });
      if (typeof localMetrics.hit !== "boolean" || typeof aiMetrics.hit !== "boolean") {
        continue;
      }

      compare24hSampleSize += 1;
      if (localMetrics.hit) compare24hLocalHits += 1;
      if (aiMetrics.hit) compare24hAiHits += 1;
    }

    const sampleSize = rows.length;
    const winRatePct = sampleSize > 0 ? Number(((tp / sampleSize) * 100).toFixed(2)) : null;
    const avgOutcomePnlPct = pnlCount > 0 ? Number((pnlSum / pnlCount).toFixed(4)) : null;
    const localHitRate24hPct = compare24hSampleSize > 0
      ? Number(((compare24hLocalHits / compare24hSampleSize) * 100).toFixed(2))
      : null;
    const aiHitRate24hPct = compare24hSampleSize > 0
      ? Number(((compare24hAiHits / compare24hSampleSize) * 100).toFixed(2))
      : null;
    const deltaAiVsLocal24hPct =
      localHitRate24hPct !== null && aiHitRate24hPct !== null
        ? Number((aiHitRate24hPct - localHitRate24hPct).toFixed(2))
        : null;

    return res.json({
      resetAt: resetAt ? resetAt.toISOString() : null,
      sampleSize,
      tp,
      sl,
      expired,
      skipped,
      invalid,
      winRatePct,
      avgOutcomePnlPct,
      comparison24h: {
        sampleSize: compare24hSampleSize,
        localHits: compare24hLocalHits,
        aiHits: compare24hAiHits,
        localHitRatePct: localHitRate24hPct,
        aiHitRatePct: aiHitRate24hPct,
        deltaAiVsLocalPct: deltaAiVsLocal24hPct
      }
    });
  });

  app.get("/api/predictions/metrics", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = predictionMetricsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const timeframeInput = parsed.data.timeframe ?? parsed.data.tf;
    const timeframe = timeframeInput ? deps.normalizePredictionTimeframe(timeframeInput) : null;
    const symbol = parsed.data.symbol ? deps.normalizeSymbolInput(parsed.data.symbol) : null;
    const signalSource = parsed.data.signalSource;
    const from = parsed.data.from ? new Date(parsed.data.from) : null;
    const to = parsed.data.to ? new Date(parsed.data.to) : null;
    if (symbol !== null && !symbol) {
      return res.status(400).json({ error: "invalid_symbol" });
    }
    const resetAt = await deps.getPredictionPerformanceResetAt(user.id);
    const effectiveFrom =
      from && resetAt
        ? from.getTime() > resetAt.getTime()
          ? from
          : resetAt
        : from ?? resetAt;

    const where: Record<string, unknown> = { userId: user.id };
    if (timeframe) where.timeframe = timeframe;
    if (symbol) where.symbol = symbol;
    if (effectiveFrom || to) {
      where.tsCreated = {
        ...(effectiveFrom ? { gte: effectiveFrom } : {}),
        ...(to ? { lte: to } : {})
      };
    }

    const rows = await deps.db.prediction.findMany({
      where,
      orderBy: [{ tsCreated: "desc" }],
      take: 5000,
      select: {
        id: true,
        signal: true,
        confidence: true,
        expectedMovePct: true,
        featuresSnapshot: true,
        outcomeMeta: true,
        outcomePnlPct: true
      }
    });

    const samples: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      if (signalSource) {
        const snapshot = deps.asRecord(row.featuresSnapshot);
        if (deps.readSelectedSignalSource(snapshot) !== signalSource) continue;
      }
      const signal = deps.normalizePredictionSignal(row.signal);
      const realizedMetrics = resolvePredictionPerformanceMetrics({
        signal,
        expectedMovePct: row.expectedMovePct,
        outcomeMeta: row.outcomeMeta,
        outcomePnlPct: row.outcomePnlPct,
        asRecord: deps.asRecord,
        readRealizedPayloadFromOutcomeMeta: deps.readRealizedPayloadFromOutcomeMeta,
        computePredictionErrorMetrics: deps.computePredictionErrorMetrics
      });
      if (realizedMetrics.realizedReturnPct === null) continue;

      const normalizedConfidence = deps.normalizeConfidencePct(Number(row.confidence));
      if (normalizedConfidence === null) continue;

      samples.push({
        confidence: normalizedConfidence,
        signal,
        expectedMovePct: Number.isFinite(Number(row.expectedMovePct)) ? Number(row.expectedMovePct) : null,
        realizedReturnPct: realizedMetrics.realizedReturnPct,
        hit: realizedMetrics.hit,
        absError: realizedMetrics.absError,
        sqError: realizedMetrics.sqError
      });
    }

    const summary = deps.buildPredictionMetricsSummary(samples, parsed.data.bins);
    return res.json({
      resetAt: resetAt ? resetAt.toISOString() : null,
      timeframe,
      symbol,
      from: effectiveFrom ? effectiveFrom.toISOString() : null,
      to: to ? to.toISOString() : null,
      signalSource: signalSource ?? null,
      bins: parsed.data.bins,
      ...summary
    });
  });

  app.get("/api/thresholds/latest", requireAuth, async (req, res) => {
    const parsed = thresholdsLatestQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const timeframe = deps.normalizePredictionTimeframe(parsed.data.timeframe ?? parsed.data.tf ?? "15m");
    const marketType = deps.normalizePredictionMarketType(parsed.data.marketType);
    const exchange = deps.normalizeExchangeValue(parsed.data.exchange);
    const symbol = deps.normalizeSymbolInput(parsed.data.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "invalid_symbol" });
    }

    const resolved = await deps.resolveFeatureThresholds({
      exchange,
      symbol,
      marketType,
      timeframe
    });

    return res.json({
      exchange,
      symbol,
      marketType,
      timeframe,
      source: resolved.source,
      computedAt: resolved.computedAt,
      windowFrom: resolved.windowFrom,
      windowTo: resolved.windowTo,
      nBars: resolved.nBars,
      version: resolved.version,
      thresholds: resolved.thresholds
    });
  });

  app.get("/api/predictions/running", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const refreshIntervalsMs = await deps.resolveGlobalPredictionRefreshIntervalsMs();

    const [rows, exchangeAccounts] = await Promise.all([
      deps.db.predictionState.findMany({
        where: { userId: user.id },
        orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
        take: Math.max(200, deps.PREDICTION_REFRESH_SCAN_LIMIT),
        select: {
          id: true,
          symbol: true,
          marketType: true,
          timeframe: true,
          signalMode: true,
          tsUpdated: true,
          tsPredictedFor: true,
          exchange: true,
          accountId: true,
          directionPreference: true,
          confidenceTargetPct: true,
          leverage: true,
          autoScheduleEnabled: true,
          autoSchedulePaused: true,
          featuresSnapshot: true
        }
      }),
      deps.db.exchangeAccount.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          exchange: true,
          label: true
        }
      })
    ]);

    const accountMap = new Map<string, { exchange: string; label: string }>();
    for (const account of exchangeAccounts) {
      accountMap.set(account.id, {
        exchange: account.exchange,
        label: account.label
      });
    }

    const items: Array<Record<string, unknown>> = [];

    const now = Date.now();
    for (const row of rows) {
      const snapshot = deps.asRecord(row.featuresSnapshot);
      const exchangeAccountId =
        typeof row.accountId === "string" && row.accountId.trim()
          ? row.accountId.trim()
          : (typeof snapshot.prefillExchangeAccountId === "string" ? snapshot.prefillExchangeAccountId : null);
      if (!exchangeAccountId) continue;

      const symbol = deps.normalizeSymbolInput(row.symbol);
      if (!symbol) continue;

      const timeframe = deps.normalizePredictionTimeframe(row.timeframe);
      const marketType = deps.normalizePredictionMarketType(row.marketType);
      const signalMode = deps.readStateSignalMode(row.signalMode, snapshot);
      if (!Boolean(row.autoScheduleEnabled)) continue;

      const paused = Boolean(row.autoSchedulePaused);
      const dueAt = row.tsPredictedFor instanceof Date
        ? row.tsPredictedFor.getTime()
        : row.tsUpdated.getTime() + deps.refreshIntervalMsForTimeframe(timeframe, refreshIntervalsMs);
      const dueInSec = Math.max(0, Math.floor((dueAt - now) / 1000));
      const account = accountMap.get(exchangeAccountId);

      items.push({
        id: row.id,
        symbol,
        marketType,
        timeframe,
        exchangeAccountId,
        exchange:
          (typeof row.exchange === "string" && row.exchange.trim()) ||
          account?.exchange ||
          "bitget",
        label: account?.label ?? exchangeAccountId,
        directionPreference: deps.parseDirectionPreference(
          row.directionPreference ?? snapshot.directionPreference
        ),
        confidenceTargetPct:
          Number.isFinite(Number(row.confidenceTargetPct))
            && row.confidenceTargetPct !== null
            && row.confidenceTargetPct !== undefined
            ? Number(row.confidenceTargetPct)
            : deps.readConfidenceTarget(snapshot),
        leverage:
          Number.isFinite(Number(row.leverage))
            && row.leverage !== null
            && row.leverage !== undefined
            ? Math.max(1, Math.trunc(Number(row.leverage)))
            : deps.readRequestedLeverage(snapshot) ?? null,
        signalMode,
        aiPromptTemplateId: deps.readAiPromptTemplateId(snapshot),
        aiPromptTemplateName: deps.readAiPromptTemplateName(snapshot),
        localStrategyId: deps.readLocalStrategyId(snapshot),
        localStrategyName: deps.readLocalStrategyName(snapshot),
        compositeStrategyId: deps.readCompositeStrategyId(snapshot),
        compositeStrategyName: deps.readCompositeStrategyName(snapshot),
        strategyRef: deps.readPredictionStrategyRef(snapshot),
        paused,
        tsCreated:
          row.tsUpdated instanceof Date ? row.tsUpdated.toISOString() : new Date().toISOString(),
        nextRunAt: new Date(dueAt).toISOString(),
        dueInSec
      });
    }

    items.sort((a, b) => Number(a.dueInSec ?? 0) - Number(b.dueInSec ?? 0));

    return res.json({ items });
  });

}
