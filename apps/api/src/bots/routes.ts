import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

export type RegisterBotRoutesDeps = {
  db: any;
  toSafeBot(bot: any): any;
  normalizeSymbolInput(value: string | null | undefined): string | null;
  asRecord(value: unknown): Record<string, unknown>;
  readStateSignalMode(stateSignalMode: unknown, snapshot: Record<string, any>): "local_only" | "ai_only" | "both";
  readPredictionStrategyRef(snapshot: Record<string, any>): { kind: string; id: string; name: string | null } | null;
  normalizePredictionStrategyKind(value: unknown): "local" | "ai" | "composite" | null;
  ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null>;
  readBotPrimaryTradeState(rows: any[], botId: string, symbol: string): any;
  sumRealizedPnlUsdFromTradeEvents(events: Array<{ message: string | null; meta: unknown }>): number;
  shouldIncludeBotInStandardOverview(strategyKey: string | null): boolean;
  computeRuntimeMarkPrice(input: { mid?: number | null; bid?: number | null; ask?: number | null }): number | null;
  computeOpenPnlUsd(input: { side: string | null; qty: number | null; entryPrice: number | null; markPrice: number | null }): number | null;
  deriveStoppedWhy(input: { botStatus: string; runtimeReason?: string | null; runtimeLastError?: string | null; botLastError?: string | null }): string | null;
  computeCoreMetricsFromClosedTrades(rows: any[]): any;
  extractLastDecisionConfidence(events: Array<{ type: string; meta: unknown }>): number | null;
  decodeTradeHistoryCursor(value?: string | null): { entryTs: Date; id: string } | null;
  encodeTradeHistoryCursor(entryTs: Date, id: string): string;
  computeRealizedPnlPct(input: { side: string; entryPrice: number | null; exitPrice: number | null }): number | null;
  classifyOutcomeFromClose(input: { exitReason: string | null | undefined }): string;
  resolvePlanCapabilitiesForUserId(params: { userId: string }): Promise<{ plan: "free" | "pro" | "enterprise"; capabilities: Record<string, boolean>; capabilitySnapshot: unknown }>;
  isCapabilityAllowed(capabilities: Record<string, boolean>, capability: string): boolean;
  sendCapabilityDenied(res: express.Response, params: { capability: string; currentPlan: string; legacyCode?: string }): express.Response;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId: string): Promise<any>;
  ensureManualPerpEligibility(resolved: any): void;
  createManualPerpMarketDataClient(account: any, source: string): any;
  normalizeExchangeValue(value: string): string;
  DEFAULT_BACKTEST_ASSUMPTIONS: { fillModel: "next_bar_open"; feeBps: number; slippageBps: number; timezone: "UTC" };
  buildBacktestSnapshotFromMarketData(params: any): Promise<{ dataHash: string; candleCount: number }>;
  hashStable(value: unknown): string;
  resolveBacktestEngineHash(): string;
  createBacktestRunRecord(payload: any): Promise<void>;
  updateBacktestRunRecord(runId: string, patch: any): Promise<any>;
  getRuntimeOrchestrationMode(): "queue" | "poll";
  enqueueBacktestRun(runId: string): Promise<{ jobId: string; queued: boolean }>;
  listBacktestRunsForBot(params: { userId: string; botId: string; limit: number }): Promise<any[]>;
  getBacktestRunRecord(runId: string): Promise<any | null>;
  loadBacktestReport(runId: string, chunkCount: number): Promise<any | null>;
  markBacktestRunCancelRequested(runId: string): Promise<any>;
  cancelBacktestRun(runId: string): Promise<{ jobId: string; removed: boolean } | null>;
  toFiniteNumber(value: unknown): number | null;
  isPaperTradingAccount(account: any): boolean;
  listPaperPositions(account: any, client: any, symbol?: string): Promise<any[]>;
  listPositions(adapter: any, symbol?: string): Promise<any[]>;
  createPerpExecutionAdapter(account: any): any;
  botCreateSchema: z.ZodTypeAny;
  botUpdateSchema: z.ZodTypeAny;
  botStopSchema: z.ZodTypeAny;
  botPredictionSourcesQuerySchema: z.ZodTypeAny;
  botRiskEventsQuerySchema: z.ZodTypeAny;
  botOverviewListQuerySchema: z.ZodTypeAny;
  botOverviewDetailQuerySchema: z.ZodTypeAny;
  botTradeHistoryQuerySchema: z.ZodTypeAny;
  backtestCreateSchema: z.ZodTypeAny;
  backtestListQuerySchema: z.ZodTypeAny;
  backtestCompareQuerySchema: z.ZodTypeAny;
  readPredictionCopierRootConfig(paramsJson: unknown): { root: Record<string, unknown>; nested: boolean };
  predictionCopierSettingsSchema: z.ZodTypeAny;
  findPredictionSourceStateForCopier(params: any): Promise<any | null>;
  readPredictionSourceSnapshotFromState(sourceState: any): Record<string, unknown> | null;
  normalizeCopierTimeframe(value: unknown): string | null;
  writePredictionCopierRootConfig(paramsJson: unknown, root: Record<string, unknown>, forceNested?: boolean): Record<string, unknown>;
  buildPluginPolicySnapshot(plan: "free" | "pro" | "enterprise", capabilitySnapshot?: unknown): Record<string, unknown>;
  attachPluginPolicySnapshot(paramsJson: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown>;
  evaluateAccessSectionBypassForUser(user: { id: string }): Promise<boolean>;
  canCreateBotForUser(params: { userId: string; bypass: boolean }): Promise<{ allowed: boolean; limit: number | null; usage: number; remaining: number | null }>;
  strategyCapabilityForKey(strategyKey: string): string | null;
  executionCapabilityForMode(mode: string): string;
  readExecutionSettingsFromParams(paramsJson: unknown): { mode: string };
  findLegacyPredictionSourceForCopier(params: any): Promise<any | null>;
  enqueueBotRun(botId: string): Promise<any>;
  cancelBotRun(botId: string): Promise<any>;
  getAccessSectionSettings(): Promise<any>;
  enforceBotStartLicense(params: any): Promise<{ allowed: boolean; reason?: string }>;
  MEXC_PERP_ENABLED: boolean;
  ManualTradingError: new (message: string, status?: number, code?: string) => Error;
  sendManualTradingError(res: express.Response, error: unknown): express.Response;
  closePaperPosition(account: any, client: any, symbol: string): Promise<string[]>;
  closePositionsMarket(adapter: any, symbol: string): Promise<string[]>;
};

async function deleteBotForUser(
  userId: string,
  botId: string,
  deps: RegisterBotRoutesDeps
): Promise<{ deletedBotId: string }> {
  const bot = await deps.db.bot.findFirst({
    where: { id: botId, userId },
    select: { id: true }
  });
  if (!bot) {
    throw new deps.ManualTradingError("bot_not_found", 404, "bot_not_found");
  }

  try {
    await deps.cancelBotRun(bot.id);
  } catch {
    // best-effort only
  }

  await deps.ignoreMissingTable(() => deps.db.botMetric.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botAlert.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.riskEvent.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botRuntime.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botTradeState.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botTradeHistory.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.futuresBotConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.marketMakingConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.volumeConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.riskConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botNotificationConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botPriceSupportConfig.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botFillCursor.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botFillSeen.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.botOrderMap.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.manualTradeLog.deleteMany({ where: { botId: bot.id } }));
  await deps.ignoreMissingTable(() => deps.db.prediction.updateMany({ where: { botId: bot.id }, data: { botId: null } }));
  await deps.ignoreMissingTable(() => deps.db.bot.delete({ where: { id: bot.id } }));

  return { deletedBotId: bot.id };
}

export function registerBotRoutes(app: express.Express, deps: RegisterBotRoutesDeps) {
  app.get("/bots", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const bots = await deps.db.bot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        futuresConfig: true,
        exchangeAccount: { select: { id: true, exchange: true, label: true } },
        runtime: {
          select: {
            status: true, reason: true, updatedAt: true, workerId: true,
            lastHeartbeatAt: true, lastTickAt: true, lastError: true,
            consecutiveErrors: true, errorWindowStartAt: true,
            lastErrorAt: true, lastErrorMessage: true
          }
        }
      }
    });
    return res.json(bots.map(deps.toSafeBot));
  });

  app.get("/bots/prediction-sources", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.botPredictionSourcesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const account = await deps.db.exchangeAccount.findFirst({
      where: { id: parsed.data.exchangeAccountId, userId: user.id },
      select: { id: true }
    });
    if (!account) return res.status(400).json({ error: "exchange_account_not_found" });

    const symbolFilter = parsed.data.symbol ? deps.normalizeSymbolInput(parsed.data.symbol) : null;
    const rows = await deps.db.predictionState.findMany({
      where: {
        userId: user.id,
        accountId: parsed.data.exchangeAccountId,
        autoScheduleEnabled: true,
        autoSchedulePaused: false,
        ...(symbolFilter ? { symbol: symbolFilter } : {}),
        ...(parsed.data.strategyKind ? { strategyKind: parsed.data.strategyKind } : {})
      },
      orderBy: [{ tsUpdated: "desc" }],
      select: {
        id: true, symbol: true, timeframe: true, signalMode: true, strategyKind: true,
        strategyId: true, signal: true, confidence: true, tsUpdated: true,
        lastChangeReason: true, featuresSnapshot: true
      }
    });

    const items = rows.map((row: any) => {
      const snapshot = deps.asRecord(row.featuresSnapshot);
      const signalMode = deps.readStateSignalMode(row.signalMode, snapshot as any);
      if (parsed.data.signalMode && signalMode !== parsed.data.signalMode) return null;
      const snapshotStrategyRef = deps.readPredictionStrategyRef(snapshot as any);
      const rowKind = deps.normalizePredictionStrategyKind(row.strategyKind);
      const rowStrategyId = typeof row.strategyId === "string" && row.strategyId.trim() ? row.strategyId.trim() : null;
      const strategyRef = snapshotStrategyRef ?? (rowKind && rowStrategyId ? { kind: rowKind, id: rowStrategyId, name: null } : null);
      return {
        stateId: row.id,
        symbol: deps.normalizeSymbolInput(String(row.symbol ?? "")),
        timeframe: String(row.timeframe ?? ""),
        signalMode,
        strategyRef: strategyRef ? `${strategyRef.kind}:${strategyRef.id}` : null,
        strategyKind: strategyRef?.kind ?? null,
        strategyName: strategyRef?.name ?? null,
        lastSignal: String(row.signal ?? "neutral"),
        confidence: Number(row.confidence ?? 0),
        tsUpdated: row.tsUpdated,
        lastChangeReason: row.lastChangeReason ?? null
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));

    return res.json({ items });
  });

  app.get("/bots/overview", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.botOverviewListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const bots = await deps.db.bot.findMany({
      where: {
        userId: user.id,
        OR: [{ futuresConfig: { is: null } }, { futuresConfig: { is: { strategyKey: { not: "futures_grid" } } } }],
        ...(parsed.data.exchangeAccountId ? { exchangeAccountId: parsed.data.exchangeAccountId } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {})
      },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        futuresConfig: { select: { strategyKey: true } },
        exchangeAccount: { select: { id: true, exchange: true, label: true } },
        runtime: { select: { status: true, reason: true, updatedAt: true, lastError: true, lastErrorAt: true, mid: true, bid: true, ask: true } }
      }
    });

    const botIds = bots.map((bot: any) => bot.id);
    const dayStartUtc = new Date();
    dayStartUtc.setUTCHours(0, 0, 0, 0);
    const tradeRowsRaw = botIds.length ? await deps.ignoreMissingTable(() => deps.db.botTradeState.findMany({
      where: { botId: { in: botIds } },
      select: { botId: true, symbol: true, lastSignal: true, lastSignalTs: true, lastTradeTs: true, dailyTradeCount: true, openSide: true, openQty: true, openEntryPrice: true, openTs: true }
    })) : null;
    const tradeRows = Array.isArray(tradeRowsRaw) ? tradeRowsRaw : [];
    const historyRowsRaw = botIds.length ? await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({
      where: { botId: { in: botIds } },
      select: { botId: true, status: true, realizedPnlUsd: true }
    })) : null;
    const historyRows = Array.isArray(historyRowsRaw) ? historyRowsRaw : [];
    const historyByBot = new Map<string, { realizedPnlTotalUsd: number; openTradesCount: number }>();
    for (const row of historyRows as any[]) {
      const current = historyByBot.get(row.botId) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
      const status = String(row.status ?? "").trim().toLowerCase();
      if (status === "open") current.openTradesCount += 1;
      else if (status === "closed") {
        const realized = Number(row.realizedPnlUsd ?? 0);
        if (Number.isFinite(realized)) current.realizedPnlTotalUsd = Number((current.realizedPnlTotalUsd + realized).toFixed(4));
      }
      historyByBot.set(row.botId, current);
    }
    const realizedEventsRaw = botIds.length ? await deps.ignoreMissingTable(() => deps.db.riskEvent.findMany({
      where: { botId: { in: botIds }, type: "PREDICTION_COPIER_TRADE", createdAt: { gte: dayStartUtc } },
      select: { botId: true, message: true, meta: true }
    })) : null;
    const realizedByBot = new Map<string, number>();
    for (const event of (Array.isArray(realizedEventsRaw) ? realizedEventsRaw : []) as any[]) {
      const next = deps.sumRealizedPnlUsdFromTradeEvents([{ message: event.message, meta: event.meta }]);
      if (!next) continue;
      realizedByBot.set(event.botId, Number(((realizedByBot.get(event.botId) ?? 0) + next).toFixed(4)));
    }

    const items = bots.filter((bot: any) => deps.shouldIncludeBotInStandardOverview(bot.futuresConfig?.strategyKey ?? null)).map((bot: any) => {
      const trade = deps.readBotPrimaryTradeState(tradeRows as any[], bot.id, bot.symbol);
      const markPrice = deps.computeRuntimeMarkPrice({ mid: bot.runtime?.mid ?? null, bid: bot.runtime?.bid ?? null, ask: bot.runtime?.ask ?? null });
      const openPnlUsd = deps.computeOpenPnlUsd({ side: trade?.openSide ?? null, qty: trade?.openQty ?? null, entryPrice: trade?.openEntryPrice ?? null, markPrice });
      const historyAggregate = historyByBot.get(bot.id) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
      const realizedPnlTodayUsd = realizedByBot.get(bot.id) ?? 0;
      const stoppedWhy = deps.deriveStoppedWhy({ botStatus: bot.status, runtimeReason: bot.runtime?.reason, runtimeLastError: bot.runtime?.lastError, botLastError: bot.lastError });
      return {
        id: bot.id,
        name: bot.name,
        symbol: bot.symbol,
        exchange: bot.exchange,
        exchangeAccountId: bot.exchangeAccountId ?? null,
        status: bot.status,
        exchangeAccount: bot.exchangeAccount ? { id: bot.exchangeAccount.id, exchange: bot.exchangeAccount.exchange, label: bot.exchangeAccount.label } : null,
        runtime: { status: bot.runtime?.status ?? null, reason: bot.runtime?.reason ?? null, updatedAt: bot.runtime?.updatedAt ?? null, lastError: bot.runtime?.lastError ?? bot.lastError ?? null, lastErrorAt: bot.runtime?.lastErrorAt ?? null, mid: bot.runtime?.mid ?? null, bid: bot.runtime?.bid ?? null, ask: bot.runtime?.ask ?? null },
        trade: {
          openSide: trade?.openSide ?? null, openQty: trade?.openQty ?? null, openEntryPrice: trade?.openEntryPrice ?? null, openPnlUsd,
          realizedPnlTodayUsd, realizedPnlTotalUsd: historyAggregate.realizedPnlTotalUsd, openTradesCount: historyAggregate.openTradesCount,
          openTs: trade?.openTs ?? null, dailyTradeCount: trade?.dailyTradeCount ?? 0, lastTradeTs: trade?.lastTradeTs ?? null,
          lastSignal: trade?.lastSignal ?? null, lastSignalTs: trade?.lastSignalTs ?? null
        },
        stoppedWhy
      };
    });

    return res.json(items);
  });

  app.get("/bots/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const bot = await deps.db.bot.findFirst({
      where: { id: req.params.id, userId: user.id },
      include: {
        futuresConfig: true,
        exchangeAccount: { select: { id: true, exchange: true, label: true } },
        runtime: { select: { status: true, reason: true, updatedAt: true, workerId: true, lastHeartbeatAt: true, lastTickAt: true, lastError: true, consecutiveErrors: true, errorWindowStartAt: true, lastErrorAt: true, lastErrorMessage: true } }
      }
    });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    return res.json(deps.toSafeBot(bot));
  });

  app.get("/bots/:id/overview", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const queryParsed = deps.botOverviewDetailQuerySchema.safeParse(req.query ?? {});
    if (!queryParsed.success) return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });

    const bot = await deps.db.bot.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: {
        id: true, name: true, symbol: true, exchange: true, exchangeAccountId: true, status: true, lastError: true,
        exchangeAccount: { select: { id: true, exchange: true, label: true } },
        runtime: { select: { status: true, reason: true, updatedAt: true, lastError: true, lastErrorAt: true, mid: true, bid: true, ask: true } }
      }
    });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });

    const tradeRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeState.findMany({
      where: { botId: bot.id },
      select: { botId: true, symbol: true, lastSignal: true, lastSignalTs: true, lastTradeTs: true, dailyTradeCount: true, openSide: true, openQty: true, openEntryPrice: true, openTs: true }
    }));
    const tradeRows = Array.isArray(tradeRowsRaw) ? tradeRowsRaw : [];
    const trade = deps.readBotPrimaryTradeState(tradeRows as any[], bot.id, bot.symbol);
    const historyRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({
      where: { botId: bot.id },
      select: { id: true, side: true, entryTs: true, exitTs: true, entryPrice: true, exitPrice: true, realizedPnlUsd: true, status: true }
    }));
    const historyRows = Array.isArray(historyRowsRaw) ? historyRowsRaw : [];
    const closedHistoryRows = (historyRows as any[]).filter((row) => String(row.status ?? "").toLowerCase() === "closed");
    const openTradesCount = (historyRows as any[]).filter((row) => String(row.status ?? "").toLowerCase() === "open").length;
    const realizedPnlTotalUsd = Number(closedHistoryRows.reduce((acc: number, row: any) => {
      const realized = Number(row.realizedPnlUsd ?? 0);
      return Number.isFinite(realized) ? acc + realized : acc;
    }, 0).toFixed(4));
    const coreMetrics = deps.computeCoreMetricsFromClosedTrades(closedHistoryRows.map((row: any) => ({
      id: String(row.id), side: typeof row.side === "string" ? row.side : null, entryTs: row.entryTs instanceof Date ? row.entryTs : null,
      exitTs: row.exitTs instanceof Date ? row.exitTs : null, entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
      exitPrice: Number.isFinite(Number(row.exitPrice)) ? Number(row.exitPrice) : null, realizedPnlUsd: Number.isFinite(Number(row.realizedPnlUsd)) ? Number(row.realizedPnlUsd) : null
    })));
    const recentEventsRaw = await deps.ignoreMissingTable(() => deps.db.riskEvent.findMany({ where: { botId: bot.id }, orderBy: { createdAt: "desc" }, take: queryParsed.data.limit }));
    const recentEvents = Array.isArray(recentEventsRaw) ? recentEventsRaw : [];
    const lastPredictionConfidence = deps.extractLastDecisionConfidence((recentEvents as any[]).map((event) => ({ type: event.type, meta: event.meta })));
    const dayStartUtc = new Date();
    dayStartUtc.setUTCHours(0, 0, 0, 0);
    const realizedEventsRaw = await deps.ignoreMissingTable(() => deps.db.riskEvent.findMany({
      where: { botId: bot.id, type: "PREDICTION_COPIER_TRADE", createdAt: { gte: dayStartUtc } },
      select: { message: true, meta: true }
    }));
    const realizedPnlTodayUsd = deps.sumRealizedPnlUsdFromTradeEvents((Array.isArray(realizedEventsRaw) ? realizedEventsRaw : []).map((event: any) => ({ message: event.message, meta: event.meta })));
    const markPrice = deps.computeRuntimeMarkPrice({ mid: bot.runtime?.mid ?? null, bid: bot.runtime?.bid ?? null, ask: bot.runtime?.ask ?? null });
    const openPnlUsd = deps.computeOpenPnlUsd({ side: trade?.openSide ?? null, qty: trade?.openQty ?? null, entryPrice: trade?.openEntryPrice ?? null, markPrice });
    const hasOpenQty = Number.isFinite(Number(trade?.openQty ?? NaN)) && Number(trade?.openQty ?? 0) > 0;
    const hasEntryPrice = Number.isFinite(Number(trade?.openEntryPrice ?? NaN)) && Number(trade?.openEntryPrice ?? 0) > 0;
    const openNotionalApprox = hasOpenQty && hasEntryPrice ? Number((Number(trade?.openQty) * Number(trade?.openEntryPrice)).toFixed(4)) : null;
    const stoppedWhy = deps.deriveStoppedWhy({ botStatus: bot.status, runtimeReason: bot.runtime?.reason, runtimeLastError: bot.runtime?.lastError, botLastError: bot.lastError });

    return res.json({
      id: bot.id,
      name: bot.name,
      symbol: bot.symbol,
      exchange: bot.exchange,
      exchangeAccountId: bot.exchangeAccountId ?? null,
      status: bot.status,
      exchangeAccount: bot.exchangeAccount ? { id: bot.exchangeAccount.id, exchange: bot.exchangeAccount.exchange, label: bot.exchangeAccount.label } : null,
      runtime: { status: bot.runtime?.status ?? null, reason: bot.runtime?.reason ?? null, updatedAt: bot.runtime?.updatedAt ?? null, lastError: bot.runtime?.lastError ?? bot.lastError ?? null, lastErrorAt: bot.runtime?.lastErrorAt ?? null, mid: bot.runtime?.mid ?? null, bid: bot.runtime?.bid ?? null, ask: bot.runtime?.ask ?? null },
      trade: {
        openSide: trade?.openSide ?? null, openQty: trade?.openQty ?? null, openEntryPrice: trade?.openEntryPrice ?? null, openPnlUsd,
        realizedPnlTodayUsd, realizedPnlTotalUsd, openTradesCount, openTs: trade?.openTs ?? null,
        dailyTradeCount: trade?.dailyTradeCount ?? 0, lastTradeTs: trade?.lastTradeTs ?? null,
        lastSignal: trade?.lastSignal ?? null, lastSignalTs: trade?.lastSignalTs ?? null
      },
      stoppedWhy,
      opsMetrics: {
        isOpen: Boolean(trade?.openSide && hasOpenQty), openNotionalApprox, openPnlUsd, realizedPnlTodayUsd, realizedPnlTotalUsd,
        openTradesCount, dailyTradeCount: trade?.dailyTradeCount ?? 0, lastTradeTs: trade?.lastTradeTs ?? null,
        lastSignal: trade?.lastSignal ?? null, lastSignalTs: trade?.lastSignalTs ?? null, lastPredictionConfidence,
        winRatePct: coreMetrics.winRatePct, avgWinUsd: coreMetrics.avgWinUsd, avgLossUsd: coreMetrics.avgLossUsd,
        profitFactor: coreMetrics.profitFactor, netPnlUsd: coreMetrics.netPnlUsd, maxDrawdownUsd: coreMetrics.maxDrawdownUsd,
        avgHoldMinutes: coreMetrics.avgHoldMinutes, closedTrades: coreMetrics.trades, wins: coreMetrics.wins, losses: coreMetrics.losses
      },
      recentEvents: (recentEvents as any[]).map((event) => ({ id: event.id, type: event.type, message: event.message ?? null, createdAt: event.createdAt, meta: event.meta ?? null }))
    });
  });

  app.get("/bots/:id/trade-history", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const queryParsed = deps.botTradeHistoryQuerySchema.safeParse(req.query ?? {});
    if (!queryParsed.success) return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });

    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, select: { id: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });

    const cursor = deps.decodeTradeHistoryCursor(queryParsed.data.cursor);
    if (queryParsed.data.cursor && !cursor) return res.status(400).json({ error: "invalid_cursor" });
    const fromDate = queryParsed.data.from ? new Date(queryParsed.data.from) : null;
    const toDate = queryParsed.data.to ? new Date(queryParsed.data.to) : null;
    const baseWhere: Record<string, unknown> = {
      botId: bot.id,
      status: "closed",
      ...(queryParsed.data.outcome ? { outcome: queryParsed.data.outcome } : {}),
      ...((fromDate || toDate) ? { entryTs: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {})
    };
    const whereWithCursor = cursor ? { ...baseWhere, OR: [{ entryTs: { lt: cursor.entryTs } }, { entryTs: cursor.entryTs, id: { lt: cursor.id } }] } : baseWhere;
    const rowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({ where: whereWithCursor, orderBy: [{ entryTs: "desc" }, { id: "desc" }], take: queryParsed.data.limit + 1 }));
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    const hasMore = rows.length > queryParsed.data.limit;
    const selected = hasMore ? rows.slice(0, queryParsed.data.limit) : rows;
    const nextCursor = hasMore ? deps.encodeTradeHistoryCursor(selected[selected.length - 1].entryTs, selected[selected.length - 1].id) : null;
    const summaryRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({ where: baseWhere, select: { realizedPnlUsd: true, status: true } }));
    let wins = 0, losses = 0, netPnlUsd = 0, count = 0;
    for (const row of (Array.isArray(summaryRowsRaw) ? summaryRowsRaw : []) as any[]) {
      const status = String(row.status ?? "").trim().toLowerCase();
      if (status !== "closed") continue;
      count += 1;
      const realized = Number(row.realizedPnlUsd ?? 0);
      if (!Number.isFinite(realized)) continue;
      netPnlUsd += realized;
      if (realized > 0) wins += 1;
      if (realized < 0) losses += 1;
    }

    return res.json({
      items: selected.map((row: any) => ({
        id: row.id, botId: row.botId, userId: row.userId, exchangeAccountId: row.exchangeAccountId, symbol: row.symbol,
        marketType: row.marketType, side: row.side, status: row.status, entryTs: row.entryTs, entryPrice: row.entryPrice,
        entryQty: row.entryQty, entryNotionalUsd: row.entryNotionalUsd, tpPrice: row.tpPrice, slPrice: row.slPrice,
        exitTs: row.exitTs, exitPrice: row.exitPrice, exitNotionalUsd: row.exitNotionalUsd, realizedPnlUsd: row.realizedPnlUsd,
        realizedPnlPct: Number.isFinite(Number(row.realizedPnlPct)) ? Number(row.realizedPnlPct) : deps.computeRealizedPnlPct({ side: row.side, entryPrice: row.entryPrice, exitPrice: row.exitPrice }),
        outcome: (typeof row.outcome === "string" && row.outcome.trim() ? row.outcome : deps.classifyOutcomeFromClose({ exitReason: row.exitReason })),
        exitReason: row.exitReason, entryOrderId: row.entryOrderId, exitOrderId: row.exitOrderId,
        predictionStateId: row.predictionStateId, predictionHash: row.predictionHash, predictionSignal: row.predictionSignal,
        predictionConfidence: row.predictionConfidence, predictionTags: Array.isArray(row.predictionTagsJson) ? row.predictionTagsJson : [],
        createdAt: row.createdAt, updatedAt: row.updatedAt
      })),
      nextCursor,
      summary: { count, wins, losses, netPnlUsd: Number(netPnlUsd.toFixed(4)) }
    });
  });

  app.post("/bots/:id/backtests", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.run")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.run", currentPlan: capabilityContext.plan, legacyCode: "backtest_not_available" });
    }
    const parsed = deps.backtestCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

    const bot = await deps.db.bot.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: { id: true, userId: true, symbol: true, exchange: true, exchangeAccountId: true, futuresConfig: { select: { strategyKey: true, marginMode: true, leverage: true, tickMs: true, paramsJson: true } } }
    });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });
    if (bot.futuresConfig.strategyKey === "prediction_copier") return res.status(400).json({ error: "backtest_prediction_copier_not_supported_yet" });
    if (bot.futuresConfig.strategyKey === "futures_grid") return res.status(400).json({ error: "backtest_futures_grid_not_supported_yet" });
    if (!bot.exchangeAccountId) return res.status(400).json({ error: "bot_exchange_account_missing" });

    const fromTs = new Date(parsed.data.from).getTime();
    const toTs = new Date(parsed.data.to).getTime();
    const timeframe = parsed.data.timeframe as any;
    const normalizedSymbol = deps.normalizeSymbolInput(bot.symbol);
    if (!normalizedSymbol) return res.status(400).json({ error: "invalid_symbol" });

    try {
      const resolved = await deps.resolveMarketDataTradingAccount(user.id, bot.exchangeAccountId);
      deps.ensureManualPerpEligibility(resolved);
      const perpClient = deps.createManualPerpMarketDataClient(resolved.marketDataAccount, "/bots/:id/backtests");
      let dataHash: string; let candleCount: number;
      try {
        const snapshot = await deps.buildBacktestSnapshotFromMarketData({
          client: perpClient,
          exchange: deps.normalizeExchangeValue(resolved.marketDataAccount.exchange),
          symbol: normalizedSymbol,
          timeframe,
          fromTs,
          toTs,
          source: `perp_market_data:${deps.normalizeExchangeValue(resolved.marketDataAccount.exchange)}`
        });
        dataHash = snapshot.dataHash;
        candleCount = snapshot.candleCount;
      } finally {
        await perpClient.close();
      }
      if (!Number.isFinite(candleCount) || candleCount < 20) return res.status(400).json({ error: "backtest_not_enough_candles", candleCount });
      const assumptions = { ...deps.DEFAULT_BACKTEST_ASSUMPTIONS, ...(parsed.data.assumptions ?? {}) };
      const paramsOverride = parsed.data.paramsOverride && typeof parsed.data.paramsOverride === "object" && !Array.isArray(parsed.data.paramsOverride) ? parsed.data.paramsOverride : null;
      const paramsHash = deps.hashStable({ strategyKey: bot.futuresConfig.strategyKey, marginMode: bot.futuresConfig.marginMode, leverage: bot.futuresConfig.leverage, tickMs: bot.futuresConfig.tickMs, paramsJson: bot.futuresConfig.paramsJson ?? {}, paramsOverride, assumptions, period: { from: parsed.data.from, to: parsed.data.to, timeframe } });
      const engineHash = deps.resolveBacktestEngineHash();
      const runFingerprint = deps.hashStable({ dataHash, paramsHash, engineHash });
      const runId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      await deps.createBacktestRunRecord({ runId, botId: bot.id, userId: user.id, status: "queued", period: { from: parsed.data.from, to: parsed.data.to, timeframe }, market: { exchange: deps.normalizeExchangeValue(bot.exchange), symbol: normalizedSymbol }, assumptions, paramsOverride, fingerprints: { dataHash, paramsHash, engineHash, runFingerprint }, requestedAt: nowIso, error: null, reportChunkCount: 0, reportVersion: 1, kpi: null, experimentId: parsed.data.experimentId ?? null, groupId: parsed.data.groupId ?? null, cancelRequested: false });
      const mode = deps.getRuntimeOrchestrationMode();
      let queue: { jobId: string; queued: boolean } | null = null;
      if (mode === "queue") {
        try {
          queue = await deps.enqueueBacktestRun(runId);
        } catch (enqueueError) {
          await deps.updateBacktestRunRecord(runId, { status: "failed", error: `queue_enqueue_failed:${String(enqueueError)}`, finishedAt: new Date().toISOString() });
          return res.status(500).json({ error: "queue_enqueue_failed", message: String(enqueueError) });
        }
      }
      return res.status(202).json({ ok: true, runId, status: "queued", queueMode: mode, queue, candleCount, fingerprints: { dataHash, paramsHash, engineHash, runFingerprint } });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.get("/bots/:id/backtests", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.run")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.run", currentPlan: capabilityContext.plan, legacyCode: "backtest_not_available" });
    }
    const parsed = deps.backtestListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, select: { id: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    const items = await deps.listBacktestRunsForBot({ userId: user.id, botId: bot.id, limit: parsed.data.limit });
    return res.json({ items });
  });

  app.get("/bots/:id/backtests/compare", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.compare")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.compare", currentPlan: capabilityContext.plan, legacyCode: "backtest_compare_not_available" });
    }
    const parsed = deps.backtestCompareQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, select: { id: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    const allRuns = await deps.listBacktestRunsForBot({ userId: user.id, botId: bot.id, limit: Math.max(parsed.data.limit * 2, parsed.data.limit) });
    const completed = allRuns.filter((row: any) => row.status === "completed" && row.kpi).filter((row: any) => !parsed.data.experimentId || row.experimentId === parsed.data.experimentId).sort((a: any, b: any) => String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? ""))).slice(0, parsed.data.limit);
    const baseline = completed[0] ?? null;
    return res.json({
      baselineRunId: baseline?.runId ?? null,
      items: completed.map((row: any) => {
        const base = baseline?.kpi ?? null;
        const current = row.kpi ?? null;
        const delta = base && current ? {
          pnlUsd: Number((current.pnlUsd - base.pnlUsd).toFixed(4)),
          maxDrawdownPct: Number((current.maxDrawdownPct - base.maxDrawdownPct).toFixed(4)),
          winratePct: Number((current.winratePct - base.winratePct).toFixed(4)),
          tradeCount: Number((current.tradeCount - base.tradeCount).toFixed(0))
        } : null;
        return { run: row, deltaToBaseline: delta };
      })
    });
  });

  app.get("/backtests/:runId", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.run")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.run", currentPlan: capabilityContext.plan, legacyCode: "backtest_not_available" });
    }
    const run = await deps.getBacktestRunRecord(req.params.runId);
    if (!run || run.userId !== user.id) return res.status(404).json({ error: "backtest_run_not_found" });
    return res.json(run);
  });

  app.get("/backtests/:runId/report", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.run")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.run", currentPlan: capabilityContext.plan, legacyCode: "backtest_not_available" });
    }
    const run = await deps.getBacktestRunRecord(req.params.runId);
    if (!run || run.userId !== user.id) return res.status(404).json({ error: "backtest_run_not_found" });
    const report = await deps.loadBacktestReport(run.runId, Number(run.reportChunkCount ?? 0));
    if (!report) return res.status(404).json({ error: "backtest_report_not_found" });
    return res.json(report);
  });

  app.post("/backtests/:runId/cancel", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const capabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    if (!deps.isCapabilityAllowed(capabilityContext.capabilities, "backtesting.run")) {
      return deps.sendCapabilityDenied(res, { capability: "backtesting.run", currentPlan: capabilityContext.plan, legacyCode: "backtest_not_available" });
    }
    const run = await deps.getBacktestRunRecord(req.params.runId);
    if (!run || run.userId !== user.id) return res.status(404).json({ error: "backtest_run_not_found" });
    await deps.markBacktestRunCancelRequested(run.runId);
    if (run.status === "queued") {
      await deps.updateBacktestRunRecord(run.runId, { status: "cancelled", finishedAt: new Date().toISOString() });
    }
    let queueResult: { jobId: string; removed: boolean } | null = null;
    if (deps.getRuntimeOrchestrationMode() === "queue") queueResult = await deps.cancelBacktestRun(run.runId);
    return res.json({ ok: true, runId: run.runId, cancelRequested: true, queue: queueResult });
  });

  app.get("/bots/:id/open-trades", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const bot = await deps.db.bot.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: { id: true, symbol: true, exchangeAccountId: true, runtime: { select: { mid: true, bid: true, ask: true } } }
    });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });

    const tradeRowsRaw = await deps.ignoreMissingTable(() => deps.db.botTradeState.findMany({
      where: { botId: bot.id },
      select: { botId: true, symbol: true, lastSignal: true, lastSignalTs: true, lastTradeTs: true, dailyTradeCount: true, openSide: true, openQty: true, openEntryPrice: true, openTs: true }
    }));
    const tradeRows = Array.isArray(tradeRowsRaw) ? tradeRowsRaw : [];
    const trade = deps.readBotPrimaryTradeState(tradeRows as any[], bot.id, bot.symbol);
    const historyOpenRaw = await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findFirst({ where: { botId: bot.id, symbol: deps.normalizeSymbolInput(bot.symbol), status: "open" }, orderBy: [{ entryTs: "desc" }, { createdAt: "desc" }] }));
    const historyOpen = historyOpenRaw && typeof historyOpenRaw === "object" ? historyOpenRaw as any : null;
    const hasStateOpen = !!trade?.openSide && Number.isFinite(Number(trade?.openQty ?? NaN)) && Number(trade?.openQty ?? 0) > 0;
    const botPosition = hasStateOpen || historyOpen ? {
      side: hasStateOpen ? trade?.openSide ?? null : historyOpen?.side ?? null,
      qty: hasStateOpen ? Number(trade?.openQty ?? 0) : Number(historyOpen?.entryQty ?? 0),
      entryPrice: hasStateOpen ? (Number.isFinite(Number(trade?.openEntryPrice)) ? Number(trade?.openEntryPrice) : null) : (Number.isFinite(Number(historyOpen?.entryPrice)) ? Number(historyOpen?.entryPrice) : null),
      openTs: hasStateOpen ? trade?.openTs ?? null : historyOpen?.entryTs ?? null,
      tpPrice: historyOpen?.tpPrice ?? null,
      slPrice: historyOpen?.slPrice ?? null,
      historyId: historyOpen?.id ?? null
    } : null;
    let exchangePosition: Record<string, unknown> | null = null;
    let exchangeError: string | null = null;
    if (bot.exchangeAccountId) {
      try {
        const resolved = await deps.resolveMarketDataTradingAccount(user.id, bot.exchangeAccountId);
        const selectedExchange = deps.normalizeExchangeValue(resolved.selectedAccount.exchange);
        if (selectedExchange === "binance") {
          exchangePosition = null;
        } else if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const perpClient = deps.createManualPerpMarketDataClient(resolved.marketDataAccount, "bots/detail-position");
          try {
            const liveRows = await deps.listPaperPositions(resolved.selectedAccount, perpClient, bot.symbol);
            const normalizedSymbol = deps.normalizeSymbolInput(bot.symbol);
            const live = liveRows.find((row: any) => deps.normalizeSymbolInput(row.symbol) === normalizedSymbol) ?? liveRows[0] ?? null;
            if (live) exchangePosition = { symbol: live.symbol, side: live.side, qty: live.size, entryPrice: live.entryPrice, markPrice: live.markPrice, unrealizedPnl: live.unrealizedPnl, tpPrice: live.takeProfitPrice, slPrice: live.stopLossPrice };
          } finally {
            await perpClient.close();
          }
        } else {
          const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
          try {
            const liveRows = await deps.listPositions(adapter, bot.symbol);
            const normalizedSymbol = deps.normalizeSymbolInput(bot.symbol);
            const live = liveRows.find((row: any) => deps.normalizeSymbolInput(row.symbol) === normalizedSymbol) ?? liveRows[0] ?? null;
            if (live) exchangePosition = { symbol: live.symbol, side: live.side, qty: live.size, entryPrice: live.entryPrice, markPrice: live.markPrice, unrealizedPnl: live.unrealizedPnl, tpPrice: live.takeProfitPrice, slPrice: live.stopLossPrice };
          } finally {
            await adapter.close();
          }
        }
      } catch (error) {
        exchangeError = error instanceof Error ? error.message : String(error);
      }
    }

    const markPrice = deps.computeRuntimeMarkPrice({ mid: bot.runtime?.mid ?? null, bid: bot.runtime?.bid ?? null, ask: bot.runtime?.ask ?? null });
    const mergedSide = String(botPosition?.side ?? exchangePosition?.side ?? "").toLowerCase();
    const mergedQty = [botPosition?.qty, exchangePosition?.qty].map(deps.toFiniteNumber).find((value): value is number => value !== null && value > 0) ?? null;
    const mergedEntry = [botPosition?.entryPrice, exchangePosition?.entryPrice].map(deps.toFiniteNumber).find((value): value is number => value !== null && value > 0) ?? null;
    const mergedMark = [exchangePosition?.markPrice, markPrice].map(deps.toFiniteNumber).find((value): value is number => value !== null && value > 0) ?? null;
    const exchangeUnrealizedPnl = deps.toFiniteNumber(exchangePosition?.unrealizedPnl);
    const mergedOpenPnl = deps.computeOpenPnlUsd({ side: mergedSide, qty: mergedQty, entryPrice: mergedEntry, markPrice: mergedMark });
    const mergedUnrealizedPnlUsd = exchangeUnrealizedPnl ?? mergedOpenPnl ?? null;
    let consistency: "matched" | "mismatch" | "missing_live" | "live_only" | "none" = "none";
    if (botPosition && exchangePosition) {
      const sideMatches = String(botPosition.side ?? "").toLowerCase() === String(exchangePosition.side ?? "").toLowerCase();
      const qtyDiff = Math.abs(Number(botPosition.qty ?? 0) - Number(exchangePosition.qty ?? 0));
      consistency = sideMatches && qtyDiff <= 1e-10 ? "matched" : "mismatch";
    } else if (botPosition && !exchangePosition) consistency = "missing_live";
    else if (!botPosition && exchangePosition) consistency = "live_only";

    return res.json({
      botPosition,
      exchangePosition,
      mergedView: mergedQty && mergedEntry ? {
        symbol: deps.normalizeSymbolInput(bot.symbol), side: mergedSide || null, qty: mergedQty, entryPrice: mergedEntry,
        markPrice: mergedMark, tpPrice: (exchangePosition as any)?.tpPrice ?? botPosition?.tpPrice ?? null,
        slPrice: (exchangePosition as any)?.slPrice ?? botPosition?.slPrice ?? null, unrealizedPnlUsd: mergedUnrealizedPnlUsd,
        openTs: botPosition?.openTs ?? null
      } : null,
      consistency,
      exchangeError,
      updatedAt: new Date().toISOString()
    });
  });

  app.put("/bots/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.botUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const bot = await deps.db.bot.findFirst({
      where: { id: req.params.id, userId: user.id },
      include: {
        futuresConfig: true,
        exchangeAccount: { select: { id: true, exchange: true, label: true } },
        runtime: { select: { status: true, reason: true, updatedAt: true, workerId: true, lastHeartbeatAt: true, lastTickAt: true, lastError: true, consecutiveErrors: true, errorWindowStartAt: true, lastErrorAt: true, lastErrorMessage: true } }
      }
    });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });
    if (deps.normalizeExchangeValue(bot.exchange) === "mexc" && !deps.MEXC_PERP_ENABLED) return res.status(400).json({ error: "mexc_perp_disabled", code: "mexc_perp_disabled", message: "MEXC Perp is disabled by runtime flag." });
    if (deps.normalizeExchangeValue(bot.exchange) === "binance") return res.status(400).json({ error: "binance_market_data_only", code: "binance_market_data_only", message: "Binance is market-data-only for paper execution in v1." });
    const nextStrategyKey = parsed.data.strategyKey ?? bot.futuresConfig.strategyKey;
    const nextParamsJson = parsed.data.paramsJson ?? (bot.futuresConfig.paramsJson as Record<string, unknown> ?? {});
    let nextSymbol = deps.normalizeSymbolInput(parsed.data.symbol ?? bot.symbol);
    let finalParamsJson = deps.asRecord(nextParamsJson);
    const pluginCapabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    const nextStrategyCapability = deps.strategyCapabilityForKey(nextStrategyKey);
    if (nextStrategyCapability && !deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, nextStrategyCapability as any)) {
      return deps.sendCapabilityDenied(res, { capability: nextStrategyCapability as any, currentPlan: pluginCapabilityContext.plan, legacyCode: "strategy_license_blocked" });
    }
    if (nextStrategyKey !== "prediction_copier" && nextStrategyKey !== "futures_grid") {
      const requestedExecutionMode = deps.readExecutionSettingsFromParams(nextParamsJson).mode;
      const executionCapability = deps.executionCapabilityForMode(requestedExecutionMode);
      if (!deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, executionCapability)) {
        return deps.sendCapabilityDenied(res, { capability: executionCapability, currentPlan: pluginCapabilityContext.plan, legacyCode: "execution_mode_not_available" });
      }
    }
    if (nextStrategyKey === "prediction_copier") {
      const { root, nested } = deps.readPredictionCopierRootConfig(nextParamsJson);
      const copierParsed = deps.predictionCopierSettingsSchema.safeParse(root);
      if (!copierParsed.success) return res.status(400).json({ error: "invalid_payload", details: copierParsed.error.flatten() });
      const copierConfig = { ...copierParsed.data };
      const sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
      if (sourceStateId) {
        const sourceState = await deps.findPredictionSourceStateForCopier({ userId: user.id, exchangeAccountId: bot.exchangeAccountId ?? "", sourceStateId, requireActive: true });
        if (!sourceState) return res.status(400).json({ error: "prediction_source_not_found" });
        if (String(sourceState.accountId) !== String(bot.exchangeAccountId ?? "")) return res.status(400).json({ error: "prediction_source_account_mismatch" });
        nextSymbol = deps.normalizeSymbolInput(String(sourceState.symbol ?? nextSymbol));
        copierConfig.sourceSnapshot = deps.readPredictionSourceSnapshotFromState(sourceState);
        copierConfig.timeframe = deps.normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;
      }
      finalParamsJson = deps.writePredictionCopierRootConfig(nextParamsJson, copierConfig, nested);
    }
    const pluginPolicySnapshot = deps.buildPluginPolicySnapshot(pluginCapabilityContext.plan, pluginCapabilityContext.capabilitySnapshot);
    finalParamsJson = deps.attachPluginPolicySnapshot(finalParamsJson, pluginPolicySnapshot);
    const updated = await deps.db.bot.update({
      where: { id: bot.id },
      data: { name: parsed.data.name ?? bot.name, symbol: nextSymbol, futuresConfig: { update: { strategyKey: nextStrategyKey, marginMode: parsed.data.marginMode ?? bot.futuresConfig.marginMode, leverage: parsed.data.leverage ?? bot.futuresConfig.leverage, tickMs: parsed.data.tickMs ?? bot.futuresConfig.tickMs, paramsJson: finalParamsJson } } },
      include: { futuresConfig: true, exchangeAccount: { select: { id: true, exchange: true, label: true } }, runtime: { select: { status: true, reason: true, updatedAt: true, workerId: true, lastHeartbeatAt: true, lastTickAt: true, lastError: true, consecutiveErrors: true, errorWindowStartAt: true, lastErrorAt: true, lastErrorMessage: true } } }
    });
    const safe = deps.toSafeBot(updated);
    return res.json({ ...safe, restartRequired: bot.status === "running" });
  });

  app.get("/bots/:id/runtime", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, select: { id: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    const runtime = await deps.db.botRuntime.findUnique({ where: { botId: req.params.id }, select: { botId: true, status: true, reason: true, updatedAt: true, workerId: true, lastHeartbeatAt: true, lastTickAt: true, lastError: true, consecutiveErrors: true, errorWindowStartAt: true, lastErrorAt: true, lastErrorMessage: true } });
    if (!runtime) return res.status(404).json({ error: "runtime_not_found" });
    return res.json(runtime);
  });

  app.get("/bots/:id/risk-events", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const queryParsed = deps.botRiskEventsQuerySchema.safeParse(req.query ?? {});
    if (!queryParsed.success) return res.status(400).json({ error: "invalid_query", details: queryParsed.error.flatten() });
    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, select: { id: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    const items = await deps.db.riskEvent.findMany({ where: { botId: bot.id }, orderBy: { createdAt: "desc" }, take: queryParsed.data.limit });
    return res.json({ items });
  });

  app.post("/bots", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = deps.botCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    const account = await deps.db.exchangeAccount.findFirst({ where: { id: parsed.data.exchangeAccountId, userId: user.id } });
    if (!account) return res.status(400).json({ error: "exchange_account_not_found" });
    if (deps.normalizeExchangeValue(account.exchange) === "mexc" && !deps.MEXC_PERP_ENABLED) return res.status(400).json({ error: "mexc_perp_disabled", code: "mexc_perp_disabled", message: "MEXC Perp is disabled by runtime flag." });
    if (deps.normalizeExchangeValue(account.exchange) === "binance") return res.status(400).json({ error: "binance_market_data_only", code: "binance_market_data_only", message: "Binance is market-data-only for paper execution in v1." });
    let symbolForCreate = deps.normalizeSymbolInput(parsed.data.symbol);
    let paramsJsonForCreate = deps.asRecord(parsed.data.paramsJson);
    const pluginCapabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    const createStrategyCapability = deps.strategyCapabilityForKey(parsed.data.strategyKey);
    if (createStrategyCapability && !deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, createStrategyCapability as any)) {
      return deps.sendCapabilityDenied(res, { capability: createStrategyCapability as any, currentPlan: pluginCapabilityContext.plan, legacyCode: "strategy_license_blocked" });
    }
    if (parsed.data.strategyKey !== "prediction_copier" && parsed.data.strategyKey !== "futures_grid") {
      const requestedExecutionMode = deps.readExecutionSettingsFromParams(parsed.data.paramsJson).mode;
      const executionCapability = deps.executionCapabilityForMode(requestedExecutionMode);
      if (!deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, executionCapability)) {
        return deps.sendCapabilityDenied(res, { capability: executionCapability, currentPlan: pluginCapabilityContext.plan, legacyCode: "execution_mode_not_available" });
      }
    }
    if (parsed.data.strategyKey === "prediction_copier") {
      const { root, nested } = deps.readPredictionCopierRootConfig(parsed.data.paramsJson);
      const copierParsed = deps.predictionCopierSettingsSchema.safeParse(root);
      if (!copierParsed.success) return res.status(400).json({ error: "invalid_payload", details: copierParsed.error.flatten() });
      const copierConfig = { ...copierParsed.data };
      const sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
      if (sourceStateId) {
        const sourceState = await deps.findPredictionSourceStateForCopier({ userId: user.id, exchangeAccountId: account.id, sourceStateId, requireActive: true });
        if (!sourceState) return res.status(400).json({ error: "prediction_source_not_found" });
        symbolForCreate = deps.normalizeSymbolInput(String(sourceState.symbol ?? symbolForCreate));
        copierConfig.sourceSnapshot = deps.readPredictionSourceSnapshotFromState(sourceState);
        copierConfig.timeframe = deps.normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;
      }
      paramsJsonForCreate = deps.writePredictionCopierRootConfig(parsed.data.paramsJson, copierConfig, nested);
    }
    const pluginPolicySnapshot = deps.buildPluginPolicySnapshot(pluginCapabilityContext.plan, pluginCapabilityContext.capabilitySnapshot);
    paramsJsonForCreate = deps.attachPluginPolicySnapshot(paramsJsonForCreate, pluginPolicySnapshot);
    const bypass = await deps.evaluateAccessSectionBypassForUser(user);
    const botCreateAccess = await deps.canCreateBotForUser({ userId: user.id, bypass });
    if (!botCreateAccess.allowed) {
      return res.status(403).json({ error: "bot_create_limit_exceeded", code: "bot_create_limit_exceeded", message: "bot_create_limit_exceeded", details: { limit: botCreateAccess.limit, usage: botCreateAccess.usage, remaining: botCreateAccess.remaining } });
    }
    const created = await deps.db.bot.create({
      data: {
        userId: user.id,
        exchangeAccountId: account.id,
        name: parsed.data.name,
        symbol: symbolForCreate,
        exchange: account.exchange,
        status: "stopped",
        lastError: null,
        futuresConfig: { create: { strategyKey: parsed.data.strategyKey, marginMode: parsed.data.marginMode, leverage: parsed.data.leverage, tickMs: parsed.data.tickMs, paramsJson: paramsJsonForCreate } }
      },
      include: { futuresConfig: true, exchangeAccount: { select: { id: true, exchange: true, label: true } } }
    });
    return res.status(201).json(deps.toSafeBot(created));
  });

  app.post("/bots/:id/start", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const pluginCapabilityContext = await deps.resolvePlanCapabilitiesForUserId({ userId: user.id });
    let bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id }, include: { futuresConfig: true } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    if (!bot.futuresConfig) return res.status(409).json({ error: "futures_config_missing" });
    if (!bot.exchangeAccountId) return res.status(409).json({ error: "exchange_account_missing" });
    if (deps.normalizeExchangeValue(bot.exchange) === "mexc" && !deps.MEXC_PERP_ENABLED) return res.status(400).json({ error: "mexc_perp_disabled", code: "mexc_perp_disabled", message: "MEXC Perp is disabled by runtime flag." });
    if (deps.normalizeExchangeValue(bot.exchange) === "binance") return res.status(400).json({ error: "binance_market_data_only", code: "binance_market_data_only", message: "Binance is market-data-only for paper execution in v1." });
    const startStrategyCapability = deps.strategyCapabilityForKey(bot.futuresConfig.strategyKey);
    if (startStrategyCapability && !deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, startStrategyCapability as any)) {
      return deps.sendCapabilityDenied(res, { capability: startStrategyCapability as any, currentPlan: pluginCapabilityContext.plan, legacyCode: "strategy_license_blocked" });
    }
    if (bot.futuresConfig.strategyKey !== "prediction_copier" && bot.futuresConfig.strategyKey !== "futures_grid") {
      const requestedExecutionMode = deps.readExecutionSettingsFromParams(bot.futuresConfig.paramsJson).mode;
      const executionCapability = deps.executionCapabilityForMode(requestedExecutionMode);
      if (!deps.isCapabilityAllowed(pluginCapabilityContext.capabilities, executionCapability)) {
        return deps.sendCapabilityDenied(res, { capability: executionCapability, currentPlan: pluginCapabilityContext.plan, legacyCode: "execution_mode_not_available" });
      }
    }
    if (bot.futuresConfig.strategyKey === "prediction_copier") {
      const { root, nested } = deps.readPredictionCopierRootConfig(bot.futuresConfig.paramsJson);
      const copierParsed = deps.predictionCopierSettingsSchema.safeParse(root);
      if (!copierParsed.success) return res.status(409).json({ error: "prediction_copier_config_invalid" });
      const copierConfig = { ...copierParsed.data };
      let sourceStateId = typeof copierConfig.sourceStateId === "string" ? copierConfig.sourceStateId.trim() : "";
      let sourceState: any | null = null;
      let usedLegacyFallback = false;
      if (sourceStateId) {
        sourceState = await deps.findPredictionSourceStateForCopier({ userId: user.id, exchangeAccountId: bot.exchangeAccountId, sourceStateId, requireActive: true });
      } else {
        const timeframe = deps.normalizeCopierTimeframe(copierConfig.timeframe) ?? "15m";
        sourceState = await deps.findLegacyPredictionSourceForCopier({ userId: user.id, exchangeAccountId: bot.exchangeAccountId, symbol: bot.symbol, timeframe });
        if (sourceState) {
          sourceStateId = sourceState.id;
          usedLegacyFallback = true;
        }
      }
      if (!sourceState || !sourceStateId) return res.status(409).json({ error: "prediction_source_required" });
      const sourceSymbol = deps.normalizeSymbolInput(String(sourceState.symbol ?? bot.symbol));
      const snapshot = deps.readPredictionSourceSnapshotFromState(sourceState);
      copierConfig.sourceStateId = sourceStateId;
      copierConfig.sourceSnapshot = snapshot;
      copierConfig.timeframe = deps.normalizeCopierTimeframe(sourceState.timeframe) ?? copierConfig.timeframe;
      const paramsJson = deps.writePredictionCopierRootConfig(bot.futuresConfig.paramsJson, copierConfig, nested);
      const needsBotUpdate = bot.symbol !== sourceSymbol || JSON.stringify(paramsJson) !== JSON.stringify(bot.futuresConfig.paramsJson);
      if (needsBotUpdate) {
        bot = await deps.db.bot.update({ where: { id: bot.id }, data: { symbol: sourceSymbol, futuresConfig: { update: { paramsJson } } }, include: { futuresConfig: true } });
      }
      if (usedLegacyFallback) {
        await deps.ignoreMissingTable(() => deps.db.riskEvent.create({ data: { botId: bot.id, type: "legacy_source_fallback", message: "sourceStateId auto-migrated on bot start", meta: { sourceStateId, symbol: sourceSymbol } } }));
      }
    }
    const pluginPolicySnapshot = deps.buildPluginPolicySnapshot(pluginCapabilityContext.plan, pluginCapabilityContext.capabilitySnapshot);
    const paramsJsonWithPluginPolicy = deps.attachPluginPolicySnapshot(bot.futuresConfig.paramsJson, pluginPolicySnapshot);
    if (JSON.stringify(paramsJsonWithPluginPolicy) !== JSON.stringify(bot.futuresConfig.paramsJson)) {
      bot = await deps.db.bot.update({ where: { id: bot.id }, data: { futuresConfig: { update: { paramsJson: paramsJsonWithPluginPolicy } } }, include: { futuresConfig: true } });
    }
    const [totalBots, runningBots] = await Promise.all([
      deps.db.bot.count({ where: { userId: user.id } }),
      deps.db.bot.count({ where: { userId: user.id, status: "running" } })
    ]);
    const bypass = await deps.evaluateAccessSectionBypassForUser(user);
    const accessSettings = bypass ? null : await deps.getAccessSectionSettings();
    const botHardCap = accessSettings?.limits.bots ?? null;
    const decision = await deps.enforceBotStartLicense({ userId: user.id, exchange: bot.exchange, totalBots, runningBots, isAlreadyRunning: bot.status === "running", quotaCaps: { bots: { maxRunning: botHardCap, maxTotal: botHardCap } } });
    if (!decision.allowed) return res.status(403).json({ error: "license_blocked", reason: decision.reason });
    const updated = await deps.db.bot.update({ where: { id: bot.id }, data: { status: "running", lastError: null } });
    await deps.db.botRuntime.upsert({ where: { botId: bot.id }, update: { status: "running", reason: "start_requested", lastError: null, lastHeartbeatAt: new Date() }, create: { botId: bot.id, status: "running", reason: "start_requested", lastError: null, lastHeartbeatAt: new Date() } });
    try {
      await deps.enqueueBotRun(bot.id);
    } catch (error) {
      const reason = `queue_enqueue_failed:${String(error)}`;
      await Promise.allSettled([
        deps.db.bot.update({ where: { id: bot.id }, data: { status: "error", lastError: reason } }),
        deps.db.botRuntime.upsert({ where: { botId: bot.id }, update: { status: "error", reason, lastError: reason, lastHeartbeatAt: new Date() }, create: { botId: bot.id, status: "error", reason, lastError: reason, lastHeartbeatAt: new Date() } })
      ]);
      return res.status(503).json({ error: "queue_enqueue_failed", reason: String(error) });
    }
    return res.json({ id: updated.id, status: updated.status });
  });

  app.post("/bots/:id/stop", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsedBody = deps.botStopSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return res.status(400).json({ error: "invalid_payload", details: parsedBody.error.flatten() });
    const bot = await deps.db.bot.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!bot) return res.status(404).json({ error: "bot_not_found" });
    const updated = await deps.db.bot.update({ where: { id: bot.id }, data: { status: "stopped" } });
    await deps.db.botRuntime.upsert({ where: { botId: bot.id }, update: { status: "stopped", reason: "stopped_by_user", lastHeartbeatAt: new Date() }, create: { botId: bot.id, status: "stopped", reason: "stopped_by_user", lastHeartbeatAt: new Date() } });
    try { await deps.cancelBotRun(bot.id); } catch {}
    const closeRequested = parsedBody.data.closeOpenPosition === true;
    let closeResult: { requested: boolean; closedCount: number; orderIds: string[]; error?: string } | null = null;
    if (closeRequested) {
      closeResult = { requested: true, closedCount: 0, orderIds: [] };
      try {
        if (!bot.exchangeAccountId) throw new Error("bot_exchange_account_missing");
        const symbol = deps.normalizeSymbolInput(bot.symbol);
        if (!symbol) throw new Error("bot_symbol_invalid");
        const resolved = await deps.resolveMarketDataTradingAccount(user.id, bot.exchangeAccountId);
        const selectedExchange = deps.normalizeExchangeValue(resolved.selectedAccount.exchange);
        if (selectedExchange === "binance") throw new deps.ManualTradingError("binance_market_data_only", 400, "binance_market_data_only");
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const perpClient = deps.createManualPerpMarketDataClient(resolved.marketDataAccount, "bots/close-position");
          try {
            const orderIds = await deps.closePaperPosition(resolved.selectedAccount, perpClient, symbol);
            closeResult.closedCount = orderIds.length;
            closeResult.orderIds = orderIds;
          } finally { await perpClient.close(); }
        } else {
          const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
          try {
            const orderIds = await deps.closePositionsMarket(adapter, symbol);
            closeResult.closedCount = orderIds.length;
            closeResult.orderIds = orderIds;
          } finally { await adapter.close(); }
        }
      } catch (error) {
        closeResult.error = error instanceof Error ? error.message : String(error);
      }
    }
    return res.json({ id: updated.id, status: updated.status, ...(closeResult ? { positionClose: closeResult } : {}) });
  });

  app.post("/bots/:id/delete", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const out = await deleteBotForUser(user.id, req.params.id, deps);
      return res.json({ ok: true, ...out });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });

  app.delete("/bots/:id", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    try {
      const out = await deleteBotForUser(user.id, req.params.id, deps);
      return res.json({ ok: true, ...out });
    } catch (error) {
      return deps.sendManualTradingError(res, error);
    }
  });
}
