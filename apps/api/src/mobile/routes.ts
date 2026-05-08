import type express from "express";
import type { Express } from "express";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { getEconomicCalendarNextSummary as defaultGetEconomicCalendarNextSummary } from "../services/economicCalendar/index.js";
import { listNews as defaultListNews } from "../services/news/index.js";

type GridDeskVisibilityMask = {
  symbolsByAccount: Map<string, Set<string>>;
  orderIdsByAccount: Map<string, Set<string>>;
};

type SectionState = {
  degraded: boolean;
  error: string | null;
  retryable: boolean;
};

type MobileDashboardRoutesDeps = {
  db: any;
  authMiddleware?: express.RequestHandler;
  ignoreMissingTable<T>(read: () => Promise<T>): Promise<T | null>;
  readBotPrimaryTradeState(rows: any[], botId: string, symbol: string): any;
  computeRuntimeMarkPrice(input: { mid?: number | null; bid?: number | null; ask?: number | null }): number | null;
  computeOpenPnlUsd(input: {
    side?: string | null;
    qty?: number | null;
    entryPrice?: number | null;
    markPrice?: number | null;
  }): number | null;
  deriveStoppedWhy(input: {
    botStatus?: string | null;
    runtimeReason?: string | null;
    runtimeLastError?: string | null;
    botLastError?: string | null;
  }): string | null;
  sumRealizedPnlUsdFromTradeEvents(events: Array<{ message?: string | null; meta?: unknown }>): number;
  normalizeExchangeValue(value: string): string;
  toFiniteNumber(value: unknown): number | null;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId: string): Promise<any>;
  createManualPerpMarketDataClient(account: any, source: string): any;
  createPerpExecutionAdapter(account: any): any;
  listPaperPositions(account: any, reader: any): Promise<any[]>;
  listPositions(adapter: any): Promise<any[]>;
  isPaperTradingAccount(account: any): boolean;
  loadGridDeskVisibilityMask(userId: string, exchangeAccountIds: string[]): Promise<GridDeskVisibilityMask>;
  filterGridBotPositionsForDesk<T extends { symbol?: string | null }>(
    rows: T[],
    visibilityMask: GridDeskVisibilityMask,
    exchangeAccountId: string
  ): T[];
  listNews?: typeof defaultListNews;
  getEconomicCalendarNextSummary?: typeof defaultGetEconomicCalendarNextSummary;
};

type SectionResult<T> = {
  value: T;
  state: SectionState;
};

const EMPTY_SECTION: SectionState = {
  degraded: false,
  error: null,
  retryable: false
};

const MOBILE_NEWS_LIMIT = 8;
const MOBILE_BOT_LIMIT = 60;
const MOBILE_PREDICTION_LIMIT = 40;
const MOBILE_ACTIVE_BOT_STATUSES = ["running", "error"];

function createVisibleMobileBotWhere(userId: string, extra: Record<string, unknown> = {}) {
  return {
    userId,
    ...extra,
    OR: [
      { gridInstance: { is: null } },
      {
        gridInstance: {
          is: {
            archivedAt: null,
            state: { not: "archived" }
          }
        }
      }
    ]
  };
}

function createActiveVisibleMobileBotWhere(userId: string, extra: Record<string, unknown> = {}) {
  return createVisibleMobileBotWhere(userId, {
    ...extra,
    status: { in: MOBILE_ACTIVE_BOT_STATUSES }
  });
}

function toErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return (trimmed || "unknown_error").slice(0, 220);
}

async function readSection<T>(
  fallback: T,
  read: () => Promise<T>
): Promise<SectionResult<T>> {
  try {
    return {
      value: await read(),
      state: { ...EMPTY_SECTION }
    };
  } catch (error) {
    return {
      value: fallback,
      state: {
        degraded: true,
        error: toErrorReason(error),
        retryable: true
      }
    };
  }
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}

function toPositionMarginMode(value: unknown): "isolated" | "cross" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("isolated") || normalized === "1") return "isolated";
  if (normalized.includes("cross") || normalized === "2") return "cross";
  return null;
}

function hasSyncedAccountData(account: any, lastRuntimeAt: Date | null): boolean {
  if (lastRuntimeAt) return true;
  if (account.lastUsedAt instanceof Date) return true;
  return [
    account.spotBudgetTotal,
    account.spotBudgetAvailable,
    account.futuresBudgetEquity,
    account.futuresBudgetAvailableMargin,
    account.pnlTodayUsd
  ].some((value) => value !== null && value !== undefined);
}

function createEmptyTotals() {
  return {
    totalEquity: 0,
    totalAvailableMargin: 0,
    totalTodayPnl: 0,
    currency: "USDT",
    includedAccounts: 0
  };
}

function createEmptyBots() {
  return {
    items: [] as any[],
    summary: {
      total: 0,
      running: 0,
      stopped: 0,
      error: 0
    }
  };
}

function createEmptyPositions() {
  return {
    items: [] as any[],
    exchanges: [] as any[],
    meta: {
      fetchedAt: new Date().toISOString(),
      degraded: false,
      partialErrors: 0,
      failedExchangeAccountIds: [] as string[]
    }
  };
}

function createEmptyPredictions() {
  return {
    items: [] as any[],
    summary: {
      total: 0,
      up: 0,
      down: 0,
      neutral: 0,
      active: 0,
      paused: 0,
      degraded: 0
    }
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
}

function toPredictionSignal(value: unknown): "up" | "down" | "neutral" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "up" || normalized === "down") return normalized;
  return "neutral";
}

async function readAccountsAndTotals(deps: MobileDashboardRoutesDeps, userId: string) {
  const [accounts, bots] = await Promise.all([
    deps.db.exchangeAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exchange: true,
        label: true,
        lastUsedAt: true,
        spotBudgetTotal: true,
        spotBudgetAvailable: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    deps.db.bot.findMany({
      where: createActiveVisibleMobileBotWhere(userId, {
        exchangeAccountId: { not: null }
      }),
      select: {
        id: true,
        exchangeAccountId: true,
        status: true,
        lastError: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            freeUsdt: true
          }
        }
      }
    })
  ]);

  const aggregate = new Map<string, { running: number; stopped: number; error: number; lastRuntimeAt: Date | null; freeUsdt: number | null; lastErrorMessage: string | null }>();
  for (const account of accounts) {
    aggregate.set(String(account.id), {
      running: 0,
      stopped: 0,
      error: 0,
      lastRuntimeAt: null,
      freeUsdt: null,
      lastErrorMessage: null
    });
  }

  for (const bot of bots) {
    const accountId = bot.exchangeAccountId ? String(bot.exchangeAccountId) : null;
    if (!accountId) continue;
    const row = aggregate.get(accountId);
    if (!row) continue;
    if (bot.status === "running") row.running += 1;
    else if (bot.status === "error") row.error += 1;
    else row.stopped += 1;
    if (!row.lastErrorMessage) row.lastErrorMessage = bot.lastError ?? bot.runtime?.lastError ?? null;
    const runtimeAt = bot.runtime?.updatedAt instanceof Date ? bot.runtime.updatedAt : null;
    if (runtimeAt && (!row.lastRuntimeAt || runtimeAt.getTime() > row.lastRuntimeAt.getTime())) {
      row.lastRuntimeAt = runtimeAt;
      row.freeUsdt = deps.toFiniteNumber(bot.runtime?.freeUsdt);
    }
  }

  const accountItems = accounts.map((account: any) => {
    const row = aggregate.get(String(account.id));
    const exchange = String(account.exchange ?? "");
    const isPaper = deps.normalizeExchangeValue(exchange) === "paper";
    const futuresEquity = deps.toFiniteNumber(account.futuresBudgetEquity);
    const availableMargin =
      row?.freeUsdt !== null && row?.freeUsdt !== undefined
        ? row.freeUsdt
        : deps.toFiniteNumber(account.futuresBudgetAvailableMargin);
    const spotTotal = deps.toFiniteNumber(account.spotBudgetTotal);
    const spotAvailable = deps.toFiniteNumber(account.spotBudgetAvailable);
    const pnlTodayUsd = deps.toFiniteNumber(account.pnlTodayUsd) ?? 0;
    const hasSyncError = Boolean(account.lastSyncErrorAt || account.lastSyncErrorMessage);
    const hasSyncedData = hasSyncedAccountData(account, row?.lastRuntimeAt ?? null);

    return {
      exchangeAccountId: String(account.id),
      exchange,
      label: String(account.label ?? "").trim() || exchange.toUpperCase(),
      status: hasSyncError ? "error" : (isPaper || hasSyncedData ? "connected" : "unknown"),
      lastSyncAt: toIso(row?.lastRuntimeAt ?? account.lastUsedAt),
      spotBudget:
        spotTotal !== null || spotAvailable !== null
          ? {
              total: spotTotal,
              available: spotAvailable
            }
          : null,
      futuresBudget:
        futuresEquity !== null || availableMargin !== null
          ? {
              equity: futuresEquity,
              availableMargin
            }
          : null,
      pnlTodayUsd,
      lastSyncError:
        account.lastSyncErrorAt || account.lastSyncErrorMessage
          ? {
              at: toIso(account.lastSyncErrorAt),
              message: account.lastSyncErrorMessage ?? null
            }
          : null,
      bots: {
        running: row?.running ?? 0,
        stopped: row?.stopped ?? 0,
        error: row?.error ?? 0
      },
      alerts: {
        hasErrors: (row?.error ?? 0) > 0,
        message: row?.lastErrorMessage ?? null
      }
    };
  });

  const totals = accountItems.reduce((acc, account) => {
    const spotTotal = deps.toFiniteNumber(account.spotBudget?.total);
    const futuresEquity = deps.toFiniteNumber(account.futuresBudget?.equity);
    const availableMargin = deps.toFiniteNumber(account.futuresBudget?.availableMargin);
    const pnlToday = deps.toFiniteNumber(account.pnlTodayUsd);
    let contributes = false;

    if (spotTotal !== null) {
      acc.totalEquity += spotTotal;
      contributes = true;
    }
    if (futuresEquity !== null) {
      acc.totalEquity += futuresEquity;
      contributes = true;
    }
    if (availableMargin !== null) {
      acc.totalAvailableMargin += availableMargin;
      contributes = true;
    }
    if (pnlToday !== null) {
      acc.totalTodayPnl += pnlToday;
      contributes = true;
    }
    if (contributes) acc.includedAccounts += 1;
    return acc;
  }, createEmptyTotals());

  return {
    accounts: accountItems,
    totals: {
      ...totals,
      totalEquity: roundNumber(totals.totalEquity),
      totalAvailableMargin: roundNumber(totals.totalAvailableMargin),
      totalTodayPnl: roundNumber(totals.totalTodayPnl)
    }
  };
}

async function readBots(deps: MobileDashboardRoutesDeps, userId: string) {
  const bots = await deps.db.bot.findMany({
    where: createActiveVisibleMobileBotWhere(userId),
    orderBy: [{ updatedAt: "desc" }],
    take: MOBILE_BOT_LIMIT,
    include: {
      futuresConfig: { select: { strategyKey: true, marginMode: true, leverage: true } },
      exchangeAccount: { select: { id: true, exchange: true, label: true } },
      runtime: {
        select: {
          status: true,
          reason: true,
          updatedAt: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          lastError: true,
          lastErrorAt: true,
          mid: true,
          bid: true,
          ask: true
        }
      },
      botVault: { select: { allocatedUsd: true, availableUsd: true, status: true } }
    }
  });

  const botIds = bots.map((bot: any) => String(bot.id));
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);

  const tradeRowsRaw = botIds.length
    ? await deps.ignoreMissingTable(() =>
        deps.db.botTradeState.findMany({
          where: { botId: { in: botIds } },
          select: {
            botId: true,
            symbol: true,
            lastSignal: true,
            lastSignalTs: true,
            lastTradeTs: true,
            dailyTradeCount: true,
            openSide: true,
            openQty: true,
            openEntryPrice: true,
            openTs: true
          }
        })
      )
    : [];
  const tradeRows = Array.isArray(tradeRowsRaw) ? tradeRowsRaw : [];
  const historyRowsRaw = botIds.length
    ? await deps.ignoreMissingTable(() =>
        deps.db.botTradeHistory.findMany({
          where: { botId: { in: botIds } },
          select: { botId: true, status: true, realizedPnlUsd: true }
        })
      )
    : [];
  const historyRows = Array.isArray(historyRowsRaw) ? historyRowsRaw : [];
  const realizedEventsRaw = botIds.length
    ? await deps.ignoreMissingTable(() =>
        deps.db.riskEvent.findMany({
          where: { botId: { in: botIds }, type: "PREDICTION_COPIER_TRADE", createdAt: { gte: dayStartUtc } },
          select: { botId: true, message: true, meta: true }
        })
      )
    : [];

  const historyByBot = new Map<string, { realizedPnlTotalUsd: number; openTradesCount: number }>();
  for (const row of historyRows as any[]) {
    const current = historyByBot.get(String(row.botId)) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
    const status = String(row.status ?? "").trim().toLowerCase();
    if (status === "open") current.openTradesCount += 1;
    else if (status === "closed") {
      const realized = deps.toFiniteNumber(row.realizedPnlUsd);
      if (realized !== null) current.realizedPnlTotalUsd = roundNumber(current.realizedPnlTotalUsd + realized);
    }
    historyByBot.set(String(row.botId), current);
  }

  const realizedByBot = new Map<string, number>();
  for (const event of (Array.isArray(realizedEventsRaw) ? realizedEventsRaw : []) as any[]) {
    const next = deps.sumRealizedPnlUsdFromTradeEvents([{ message: event.message, meta: event.meta }]);
    if (!next) continue;
    const botId = String(event.botId);
    realizedByBot.set(botId, roundNumber((realizedByBot.get(botId) ?? 0) + next));
  }

  const summary = {
    total: bots.length,
    running: 0,
    stopped: 0,
    error: 0
  };

  const items = bots.map((bot: any) => {
    if (bot.status === "running") summary.running += 1;
    else if (bot.status === "error") summary.error += 1;
    else summary.stopped += 1;

    const trade = deps.readBotPrimaryTradeState(tradeRows as any[], String(bot.id), String(bot.symbol));
    const markPrice = deps.computeRuntimeMarkPrice({
      mid: bot.runtime?.mid ?? null,
      bid: bot.runtime?.bid ?? null,
      ask: bot.runtime?.ask ?? null
    });
    const openPnlUsd = deps.computeOpenPnlUsd({
      side: trade?.openSide ?? null,
      qty: trade?.openQty ?? null,
      entryPrice: trade?.openEntryPrice ?? null,
      markPrice
    });
    const historyAggregate = historyByBot.get(String(bot.id)) ?? { realizedPnlTotalUsd: 0, openTradesCount: 0 };
    const stoppedWhy = deps.deriveStoppedWhy({
      botStatus: bot.status,
      runtimeReason: bot.runtime?.reason,
      runtimeLastError: bot.runtime?.lastError,
      botLastError: bot.lastError
    });

    return {
      id: String(bot.id),
      name: String(bot.name ?? ""),
      symbol: String(bot.symbol ?? ""),
      exchange: String(bot.exchange ?? ""),
      exchangeAccountId: bot.exchangeAccountId ?? null,
      status: String(bot.status ?? "stopped"),
      strategyKey: bot.futuresConfig?.strategyKey ?? null,
      exchangeAccount: bot.exchangeAccount
        ? {
            id: String(bot.exchangeAccount.id),
            exchange: String(bot.exchangeAccount.exchange ?? ""),
            label: String(bot.exchangeAccount.label ?? "")
          }
        : null,
      runtime: {
        status: bot.runtime?.status ?? null,
        reason: bot.runtime?.reason ?? null,
        updatedAt: toIso(bot.runtime?.updatedAt),
        lastHeartbeatAt: toIso(bot.runtime?.lastHeartbeatAt),
        lastTickAt: toIso(bot.runtime?.lastTickAt),
        lastError: bot.runtime?.lastError ?? bot.lastError ?? null,
        lastErrorAt: toIso(bot.runtime?.lastErrorAt),
        mid: deps.toFiniteNumber(bot.runtime?.mid),
        bid: deps.toFiniteNumber(bot.runtime?.bid),
        ask: deps.toFiniteNumber(bot.runtime?.ask)
      },
      botVault: bot.botVault
        ? {
            allocatedUsd: deps.toFiniteNumber(bot.botVault.allocatedUsd) ?? 0,
            availableUsd: deps.toFiniteNumber(bot.botVault.availableUsd) ?? 0,
            status: bot.botVault.status ?? null
          }
        : null,
      trade: {
        openSide: trade?.openSide ?? null,
        openQty: deps.toFiniteNumber(trade?.openQty),
        openEntryPrice: deps.toFiniteNumber(trade?.openEntryPrice),
        openPnlUsd,
        realizedPnlTodayUsd: realizedByBot.get(String(bot.id)) ?? 0,
        realizedPnlTotalUsd: historyAggregate.realizedPnlTotalUsd,
        openTradesCount: historyAggregate.openTradesCount,
        openTs: toIso(trade?.openTs),
        dailyTradeCount: Number(trade?.dailyTradeCount ?? 0),
        lastTradeTs: toIso(trade?.lastTradeTs),
        lastSignal: trade?.lastSignal ?? null,
        lastSignalTs: toIso(trade?.lastSignalTs)
      },
      stoppedWhy
    };
  });

  return { items, summary };
}

async function readPositions(deps: MobileDashboardRoutesDeps, userId: string) {
  const accounts = await deps.db.exchangeAccount.findMany({
    where: { userId },
    orderBy: [
      { exchange: "asc" },
      { label: "asc" },
      { createdAt: "asc" }
    ],
    select: {
      id: true,
      exchange: true,
      label: true
    }
  });
  const accountIds = accounts.map((account: any) => String(account.id));
  const visibilityMask = await deps.loadGridDeskVisibilityMask(userId, accountIds);

  const items: any[] = [];
  const failedExchangeAccountIds: string[] = [];
  let fulfilledReadCount = 0;

  const results = await Promise.allSettled(
    accounts.map(async (account: any) => {
      const exchangeAccountId = String(account.id);
      const exchange = String(account.exchange ?? "");
      const exchangeLabel = String(account.label ?? "").trim() || exchange.toUpperCase();
      const resolved = await deps.resolveMarketDataTradingAccount(userId, exchangeAccountId);
      if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
        const perpClient = deps.createManualPerpMarketDataClient(resolved.marketDataAccount, "mobile/dashboard");
        try {
          const rows = await deps.listPaperPositions(resolved.selectedAccount, perpClient);
          return deps.filterGridBotPositionsForDesk(rows, visibilityMask, exchangeAccountId).map((row: any) => ({
            exchangeAccountId,
            exchange,
            exchangeLabel,
            symbol: String(row.symbol ?? ""),
            side: row.side === "short" ? "short" : "long",
            size: Number(row.size ?? 0),
            entryPrice: deps.toFiniteNumber(row.entryPrice),
            markPrice: deps.toFiniteNumber(row.markPrice),
            leverage: deps.toFiniteNumber(row.leverage),
            marginMode: toPositionMarginMode(row.marginMode),
            marginUsd: deps.toFiniteNumber(row.marginUsd),
            notionalUsd: deps.toFiniteNumber(row.notionalUsd),
            liquidationPrice: deps.toFiniteNumber(row.liquidationPrice),
            liquidationDistancePct: deps.toFiniteNumber(row.liquidationDistancePct),
            roePct: deps.toFiniteNumber(row.roePct),
            pnlPct: deps.toFiniteNumber(row.pnlPct),
            stopLossPrice: deps.toFiniteNumber(row.stopLossPrice),
            takeProfitPrice: deps.toFiniteNumber(row.takeProfitPrice),
            unrealizedPnl: deps.toFiniteNumber(row.unrealizedPnl)
          }));
        } finally {
          await perpClient.close?.();
        }
      }

      const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
      try {
        const rows = await deps.listPositions(adapter);
        return deps.filterGridBotPositionsForDesk(rows, visibilityMask, exchangeAccountId).map((row: any) => ({
          exchangeAccountId,
          exchange,
          exchangeLabel,
          symbol: String(row.symbol ?? ""),
          side: row.side === "short" ? "short" : "long",
          size: Number(row.size ?? 0),
          entryPrice: deps.toFiniteNumber(row.entryPrice),
          markPrice: deps.toFiniteNumber(row.markPrice),
          leverage: deps.toFiniteNumber(row.leverage),
          marginMode: toPositionMarginMode(row.marginMode),
          marginUsd: deps.toFiniteNumber(row.marginUsd),
          notionalUsd: deps.toFiniteNumber(row.notionalUsd),
          liquidationPrice: deps.toFiniteNumber(row.liquidationPrice),
          liquidationDistancePct: deps.toFiniteNumber(row.liquidationDistancePct),
          roePct: deps.toFiniteNumber(row.roePct),
          pnlPct: deps.toFiniteNumber(row.pnlPct),
          stopLossPrice: deps.toFiniteNumber(row.stopLossPrice),
          takeProfitPrice: deps.toFiniteNumber(row.takeProfitPrice),
          unrealizedPnl: deps.toFiniteNumber(row.unrealizedPnl)
        }));
      } finally {
        await adapter.close?.();
      }
    })
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const account = accounts[index];
    if (result.status === "fulfilled") {
      fulfilledReadCount += 1;
      for (const item of result.value) {
        if (!(item.symbol.length > 0 && Number.isFinite(item.size) && item.size > 0)) continue;
        items.push(item);
      }
      continue;
    }
    if (account?.id) failedExchangeAccountIds.push(String(account.id));
  }

  items.sort((a, b) => {
    const exchangeDiff = a.exchange.localeCompare(b.exchange);
    if (exchangeDiff !== 0) return exchangeDiff;
    const labelDiff = a.exchangeLabel.localeCompare(b.exchangeLabel);
    if (labelDiff !== 0) return labelDiff;
    const symbolDiff = a.symbol.localeCompare(b.symbol);
    if (symbolDiff !== 0) return symbolDiff;
    return a.side.localeCompare(b.side);
  });

  return {
    items,
    exchanges: accounts.map((account: any) => ({
      exchangeAccountId: String(account.id),
      exchange: String(account.exchange ?? ""),
      label: String(account.label ?? "").trim() || String(account.exchange ?? "").toUpperCase()
    })),
    meta: {
      fetchedAt: new Date().toISOString(),
      degraded: accountIds.length > 0 && (fulfilledReadCount === 0 || failedExchangeAccountIds.length > 0),
      partialErrors: failedExchangeAccountIds.length,
      failedExchangeAccountIds
    }
  };
}

async function readPredictions(deps: MobileDashboardRoutesDeps, userId: string) {
  const rows = await deps.db.predictionState.findMany({
    where: { userId },
    orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
    take: MOBILE_PREDICTION_LIMIT,
    select: {
      id: true,
      exchange: true,
      accountId: true,
      symbol: true,
      marketType: true,
      timeframe: true,
      signalMode: true,
      signal: true,
      expectedMovePct: true,
      confidence: true,
      explanation: true,
      tags: true,
      keyDrivers: true,
      modelVersion: true,
      lastAiExplainedAt: true,
      lastChangeReason: true,
      autoScheduleEnabled: true,
      autoSchedulePaused: true,
      tsUpdated: true,
      tsPredictedFor: true,
      refreshStatus: true,
      lastRefreshErrorAt: true,
      lastRefreshError: true
    }
  });

  const summary = createEmptyPredictions().summary;
  const items = rows.map((row: any) => {
    const signal = toPredictionSignal(row.signal);
    summary.total += 1;
    summary[signal] += 1;
    if (row.autoSchedulePaused) summary.paused += 1;
    else if (row.autoScheduleEnabled) summary.active += 1;
    if (String(row.refreshStatus ?? "ok") !== "ok" || row.lastRefreshError) summary.degraded += 1;

    return {
      id: String(row.id),
      exchange: String(row.exchange ?? ""),
      accountId: String(row.accountId ?? ""),
      symbol: String(row.symbol ?? ""),
      marketType: String(row.marketType ?? ""),
      timeframe: String(row.timeframe ?? ""),
      signalMode: String(row.signalMode ?? "both"),
      signal,
      expectedMovePct: deps.toFiniteNumber(row.expectedMovePct),
      confidence: deps.toFiniteNumber(row.confidence) ?? 0,
      explanation: typeof row.explanation === "string" && row.explanation.trim() ? row.explanation.trim() : null,
      tags: toStringArray(row.tags),
      keyDrivers: toStringArray(row.keyDrivers),
      modelVersion: String(row.modelVersion ?? ""),
      lastAiExplainedAt: toIso(row.lastAiExplainedAt),
      lastChangeReason:
        typeof row.lastChangeReason === "string" && row.lastChangeReason.trim()
          ? row.lastChangeReason.trim()
          : null,
      autoScheduleEnabled: Boolean(row.autoScheduleEnabled),
      autoSchedulePaused: Boolean(row.autoSchedulePaused),
      updatedAt: toIso(row.tsUpdated),
      predictedFor: toIso(row.tsPredictedFor),
      refreshStatus: String(row.refreshStatus ?? "ok"),
      lastRefreshErrorAt: toIso(row.lastRefreshErrorAt),
      lastRefreshError:
        typeof row.lastRefreshError === "string" && row.lastRefreshError.trim()
          ? row.lastRefreshError.trim()
          : null
    };
  });

  return { items, summary };
}

export function registerMobileDashboardRoutes(app: Express, deps: MobileDashboardRoutesDeps) {
  const auth = deps.authMiddleware ?? requireAuth;

  app.get("/mobile/dashboard", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const listNews = deps.listNews ?? defaultListNews;
    const getEconomicCalendarNextSummary =
      deps.getEconomicCalendarNextSummary ?? defaultGetEconomicCalendarNextSummary;

    const [accountsResult, botsResult, positionsResult, predictionsResult, newsResult, calendarResult] = await Promise.all([
      readSection({ accounts: [] as any[], totals: createEmptyTotals() }, () =>
        readAccountsAndTotals(deps, user.id)
      ),
      readSection(createEmptyBots(), () => readBots(deps, user.id)),
      readSection(createEmptyPositions(), () => readPositions(deps, user.id)),
      readSection(createEmptyPredictions(), () => readPredictions(deps, user.id)),
      readSection(
        {
          items: [] as any[],
          meta: {
            mode: "all",
            page: 1,
            limit: MOBILE_NEWS_LIMIT,
            cache: "miss",
            fetchedAt: new Date().toISOString()
          }
        },
        () =>
          listNews({
            db: deps.db,
            mode: "all",
            limit: MOBILE_NEWS_LIMIT,
            page: 1
          })
      ),
      readSection(null as any, () =>
        getEconomicCalendarNextSummary({
          db: deps.db,
          currency: "USD",
          impact: "high"
        })
      )
    ]);

    const positionsSection = positionsResult.value.meta.degraded
      ? {
          degraded: true,
          error:
            positionsResult.value.meta.failedExchangeAccountIds.length > 0
              ? "positions_partial_read_failed"
              : "positions_read_failed",
          retryable: true
        }
      : positionsResult.state;

    return res.json({
      fetchedAt: new Date().toISOString(),
      totals: accountsResult.value.totals,
      accounts: accountsResult.value.accounts,
      bots: botsResult.value,
      positions: positionsResult.value,
      predictions: predictionsResult.value,
      news: newsResult.value,
      calendarNext: calendarResult.value,
      sections: {
        accounts: accountsResult.state,
        bots: botsResult.state,
        positions: positionsSection,
        predictions: predictionsResult.state,
        news: newsResult.state,
        calendarNext: calendarResult.state
      }
    });
  });
}
