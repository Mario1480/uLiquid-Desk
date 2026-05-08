import type express from "express";
import type { Express } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import { computeCoreMetricsFromClosedTrades } from "../bots/tradeHistory.js";
import {
  evaluateNewsRiskForSymbol,
  getEconomicCalendarNextSummary,
  listEconomicEventsPage
} from "../services/economicCalendar/index.js";
import { symbolToMacroCurrency } from "../services/economicCalendar/symbolCurrency.js";
import { listNews as defaultListNews } from "../services/news/index.js";

type GridDeskVisibilityMask = {
  symbolsByAccount: Map<string, Set<string>>;
  orderIdsByAccount: Map<string, Set<string>>;
};

type MobileMonitoringRoutesDeps = {
  db: any;
  authMiddleware?: express.RequestHandler;
  ignoreMissingTable<T>(read: () => Promise<T>): Promise<T | null>;
  normalizeExchangeValue(value: string): string;
  toFiniteNumber(value: unknown): number | null;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId: string): Promise<any>;
  createManualPerpMarketDataClient(account: any, source: string): any;
  createPerpExecutionAdapter(account: any): any;
  listPaperPositions(account: any, reader: any, symbol?: string): Promise<any[]>;
  listPositions(adapter: any, symbol?: string): Promise<any[]>;
  isPaperTradingAccount(account: any): boolean;
  loadGridDeskVisibilityMask(userId: string, exchangeAccountIds: string[]): Promise<GridDeskVisibilityMask>;
  filterGridBotPositionsForDesk<T extends { symbol?: string | null }>(
    rows: T[],
    visibilityMask: GridDeskVisibilityMask,
    exchangeAccountId: string
  ): T[];
  listNews?: typeof defaultListNews;
};

const WATCHLIST_LIMIT = 40;
const ALERT_LIMIT = 40;
const BOT_STALE_MS = 10 * 60 * 1000;
const NO_TRADE_WARN_MS = 24 * 60 * 60 * 1000;
const POSITION_PNL_MOVE_WARN_PCT = 2;
const POSITION_PNL_MOVE_WARN_USD = 100;
const MARGIN_WARNING_RATIO = 0.15;
const MARGIN_CRITICAL_RATIO = 0.08;

const watchlistUpsertSchema = z.object({
  symbol: z.string().trim().min(1).max(40),
  marketType: z.enum(["spot", "perp"]).default("perp"),
  exchange: z.string().trim().max(40).nullable().optional()
});

const performanceRangeSchema = z.enum(["today", "7d", "30d"]).default("7d");
const performanceQuerySchema = z.object({
  range: performanceRangeSchema,
  exchangeAccountId: z.string().trim().min(1).optional(),
  botId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional()
});

const predictionHistoryQuerySchema = z.object({
  symbol: z.string().trim().min(1).optional(),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const newsIntelligenceQuerySchema = z.object({
  mode: z.enum(["all", "crypto", "general"]).default("all"),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function toReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (raw.trim() || "unknown_error").slice(0, 220);
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function normalizeSymbolInput(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9:_/-]/g, "")
    .slice(0, 40);
}

function normalizePositionMarginMode(value: unknown): "isolated" | "cross" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("isolated") || raw === "1") return "isolated";
  if (raw.includes("cross") || raw === "2") return "cross";
  return null;
}

function normalizeExchangeInput(value: unknown, normalizeExchangeValue: (value: string) => string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "any";
  return normalizeExchangeValue(raw) || raw.toLowerCase();
}

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

function toWatchlistDto(row: any) {
  return {
    id: String(row.id),
    symbol: String(row.symbol ?? ""),
    marketType: String(row.marketType ?? "perp"),
    exchange: row.exchange && row.exchange !== "any" ? String(row.exchange) : null,
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

async function readWatchlistRows(deps: MobileMonitoringRoutesDeps, userId: string): Promise<any[]> {
  const rows = await deps.ignoreMissingTable(() =>
    deps.db.mobileWatchlistItem.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: WATCHLIST_LIMIT
    })
  );
  return Array.isArray(rows) ? rows : [];
}

function watchlistSymbols(rows: any[]): string[] {
  return rows
    .map((row) => normalizeSymbolInput(row.symbol))
    .filter(Boolean)
    .filter((symbol, index, list) => list.indexOf(symbol) === index);
}

function latestDate(...values: unknown[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}

function msSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return now.getTime() - date.getTime();
}

function alertSeverityRank(severity: string): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function makeAlert(input: {
  id: string;
  severity: "info" | "warning" | "critical";
  type: string;
  title: string;
  message: string;
  ts: string | null;
  routeTab: string;
  routeId?: string | null;
  symbol?: string | null;
  botId?: string | null;
  exchangeAccountId?: string | null;
}) {
  return {
    id: input.id,
    severity: input.severity,
    type: input.type,
    title: input.title,
    message: input.message,
    ts: input.ts ?? new Date().toISOString(),
    route: {
      tab: input.routeTab,
      id: input.routeId ?? null
    },
    symbol: input.symbol ?? null,
    botId: input.botId ?? null,
    exchangeAccountId: input.exchangeAccountId ?? null
  };
}

async function readBotHealth(deps: MobileMonitoringRoutesDeps, userId: string) {
  const now = new Date();
  const bots = await deps.db.bot.findMany({
    where: createVisibleMobileBotWhere(userId),
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
    include: {
      futuresConfig: { select: { strategyKey: true, leverage: true } },
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
      tradeStates: {
        select: {
          lastSignal: true,
          lastSignalTs: true,
          lastTradeTs: true,
          dailyTradeCount: true,
          openSide: true,
          openQty: true,
          openEntryPrice: true,
          openTs: true
        },
        take: 3,
        orderBy: { updatedAt: "desc" }
      },
      botVault: { select: { allocatedUsd: true, availableUsd: true, status: true } }
    }
  });
  const symbols = bots.map((bot: any) => normalizeSymbolInput(bot.symbol)).filter(Boolean);
  const accountIds = bots
    .map((bot: any) => (typeof bot.exchangeAccountId === "string" ? bot.exchangeAccountId : null))
    .filter(Boolean);
  const predictions = symbols.length
    ? await deps.db.predictionState.findMany({
        where: {
          userId,
          symbol: { in: symbols }
        },
        orderBy: [{ tsUpdated: "desc" }],
        take: Math.min(symbols.length * 4, 160),
        select: {
          id: true,
          accountId: true,
          symbol: true,
          timeframe: true,
          signal: true,
          confidence: true,
          expectedMovePct: true,
          tsUpdated: true,
          refreshStatus: true,
          lastRefreshError: true
        }
      })
    : [];

  const predictionByAccountSymbol = new Map<string, any>();
  const predictionBySymbol = new Map<string, any>();
  for (const prediction of predictions as any[]) {
    const symbol = normalizeSymbolInput(prediction.symbol);
    if (!predictionBySymbol.has(symbol)) predictionBySymbol.set(symbol, prediction);
    const key = `${String(prediction.accountId ?? "")}:${symbol}`;
    if (!predictionByAccountSymbol.has(key)) predictionByAccountSymbol.set(key, prediction);
  }

  const accountRows = accountIds.length
    ? await deps.db.exchangeAccount.findMany({
        where: { userId, id: { in: accountIds } },
        select: {
          id: true,
          futuresBudgetEquity: true,
          futuresBudgetAvailableMargin: true,
          pnlTodayUsd: true,
          lastSyncErrorAt: true,
          lastSyncErrorMessage: true
        }
      })
    : [];
  const accountById = new Map((accountRows as any[]).map((row) => [String(row.id), row] as const));

  const summary = {
    total: 0,
    running: 0,
    error: 0,
    stopped: 0,
    stale: 0,
    warning: 0
  };

  const items = bots.map((bot: any) => {
    const status = String(bot.status ?? "stopped");
    const symbol = normalizeSymbolInput(bot.symbol);
    const accountId = typeof bot.exchangeAccountId === "string" ? bot.exchangeAccountId : null;
    const runtimeAt = latestDate(bot.runtime?.lastTickAt, bot.runtime?.lastHeartbeatAt, bot.runtime?.updatedAt);
    const runtimeAgeMs = msSince(runtimeAt, now);
    const stale = status === "running" && (runtimeAgeMs === null || runtimeAgeMs > BOT_STALE_MS);
    const primaryTrade = Array.isArray(bot.tradeStates) ? bot.tradeStates[0] ?? null : null;
    const lastTradeAt = latestDate(primaryTrade?.lastTradeTs);
    const noRecentTrade =
      status === "running" &&
      (!lastTradeAt || now.getTime() - lastTradeAt.getTime() > NO_TRADE_WARN_MS);
    const prediction =
      (accountId ? predictionByAccountSymbol.get(`${accountId}:${symbol}`) : null) ??
      predictionBySymbol.get(symbol) ??
      null;
    const account = accountId ? accountById.get(accountId) : null;
    const warnings: string[] = [];
    if (status === "error") warnings.push("bot_error");
    if (stale) warnings.push("runtime_stale");
    if (noRecentTrade) warnings.push("no_trade_24h");
    if (account?.lastSyncErrorMessage) warnings.push("account_sync_error");
    if (prediction?.lastRefreshError || String(prediction?.refreshStatus ?? "ok") !== "ok") warnings.push("prediction_degraded");

    summary.total += 1;
    if (status === "running") summary.running += 1;
    else if (status === "error") summary.error += 1;
    else summary.stopped += 1;
    if (stale) summary.stale += 1;
    if (warnings.length > 0) summary.warning += 1;

    return {
      id: String(bot.id),
      name: String(bot.name ?? ""),
      symbol,
      exchange: String(bot.exchange ?? ""),
      status,
      strategyKey: bot.futuresConfig?.strategyKey ?? null,
      exchangeAccountId: accountId,
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
        ageSeconds: runtimeAgeMs === null ? null : Math.max(0, Math.round(runtimeAgeMs / 1000)),
        stale
      },
      account: account
        ? {
            equity: deps.toFiniteNumber(account.futuresBudgetEquity),
            availableMargin: deps.toFiniteNumber(account.futuresBudgetAvailableMargin),
            pnlTodayUsd: deps.toFiniteNumber(account.pnlTodayUsd),
            lastSyncError: account.lastSyncErrorMessage
              ? {
                  at: toIso(account.lastSyncErrorAt),
                  message: String(account.lastSyncErrorMessage)
                }
              : null
          }
        : null,
      trade: {
        lastTradeAt: toIso(primaryTrade?.lastTradeTs),
        dailyTradeCount: Number(primaryTrade?.dailyTradeCount ?? 0),
        lastSignal: primaryTrade?.lastSignal ?? null,
        lastSignalAt: toIso(primaryTrade?.lastSignalTs),
        openSide: primaryTrade?.openSide ?? null,
        openQty: deps.toFiniteNumber(primaryTrade?.openQty),
        openEntryPrice: deps.toFiniteNumber(primaryTrade?.openEntryPrice),
        openAt: toIso(primaryTrade?.openTs)
      },
      prediction: prediction
        ? {
            id: String(prediction.id),
            timeframe: String(prediction.timeframe ?? ""),
            signal: String(prediction.signal ?? "neutral"),
            confidence: deps.toFiniteNumber(prediction.confidence),
            expectedMovePct: deps.toFiniteNumber(prediction.expectedMovePct),
            updatedAt: toIso(prediction.tsUpdated),
            refreshStatus: String(prediction.refreshStatus ?? "ok"),
            error: prediction.lastRefreshError ?? null
          }
        : null,
      vault: bot.botVault
        ? {
            allocatedUsd: deps.toFiniteNumber(bot.botVault.allocatedUsd),
            availableUsd: deps.toFiniteNumber(bot.botVault.availableUsd),
            status: bot.botVault.status ?? null
          }
        : null,
      warnings
    };
  });

  return {
    fetchedAt: now.toISOString(),
    degraded: false,
    error: null,
    summary,
    items
  };
}

async function listPositionRiskItems(deps: MobileMonitoringRoutesDeps, userId: string) {
  const accounts = await deps.db.exchangeAccount.findMany({
    where: { userId },
    orderBy: [{ exchange: "asc" }, { label: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      exchange: true,
      label: true
    }
  });
  const accountIds = accounts.map((account: any) => String(account.id));
  const visibilityMask = await deps.loadGridDeskVisibilityMask(userId, accountIds);
  const leverageRows = accountIds.length
    ? await deps.db.bot.findMany({
        where: createVisibleMobileBotWhere(userId, {
          exchangeAccountId: { in: accountIds }
        }),
        select: {
          exchangeAccountId: true,
          symbol: true,
          futuresConfig: {
            select: {
              leverage: true
            }
          }
        }
      })
    : [];
  const leverageByAccountSymbol = new Map<string, number>();
  for (const row of leverageRows as any[]) {
    const leverage = deps.toFiniteNumber(row.futuresConfig?.leverage);
    if (leverage === null || leverage <= 0) continue;
    leverageByAccountSymbol.set(`${String(row.exchangeAccountId ?? "")}:${normalizeSymbolInput(row.symbol)}`, leverage);
  }

  const items: any[] = [];
  const failedExchangeAccountIds: string[] = [];
  let fulfilled = 0;

  const results = await Promise.allSettled(
    accounts.map(async (account: any) => {
      const exchangeAccountId = String(account.id);
      const exchange = String(account.exchange ?? "");
      const exchangeLabel = String(account.label ?? "").trim() || exchange.toUpperCase();
      const resolved = await deps.resolveMarketDataTradingAccount(userId, exchangeAccountId);
      const rows = deps.isPaperTradingAccount(resolved.selectedAccount)
        ? await (async () => {
            const perpClient = deps.createManualPerpMarketDataClient(resolved.marketDataAccount, "mobile/position-risk");
            try {
              return await deps.listPaperPositions(resolved.selectedAccount, perpClient);
            } finally {
              await perpClient.close?.();
            }
          })()
        : await (async () => {
            const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
            try {
              return await deps.listPositions(adapter);
            } finally {
              await adapter.close?.();
            }
          })();

      return deps.filterGridBotPositionsForDesk(rows, visibilityMask, exchangeAccountId).map((row: any) => {
        const symbol = normalizeSymbolInput(row.symbol);
        const size = deps.toFiniteNumber(row.size) ?? 0;
        const entryPrice = deps.toFiniteNumber(row.entryPrice);
        const markPrice = deps.toFiniteNumber(row.markPrice) ?? entryPrice;
        const notionalUsd = deps.toFiniteNumber(row.notionalUsd) ?? (markPrice !== null ? Math.abs(size * markPrice) : null);
        const leverage = deps.toFiniteNumber(row.leverage) ?? leverageByAccountSymbol.get(`${exchangeAccountId}:${symbol}`) ?? null;
        const marginUsd = deps.toFiniteNumber(row.marginUsd) ?? (
          notionalUsd !== null && leverage !== null && leverage > 0 ? notionalUsd / leverage : null
        );
        const unrealizedPnl = deps.toFiniteNumber(row.unrealizedPnl);
        const roePct = deps.toFiniteNumber(row.roePct) ?? (unrealizedPnl !== null && marginUsd !== null && marginUsd > 0
          ? round((unrealizedPnl / marginUsd) * 100, 4)
          : null);
        const pnlPct = deps.toFiniteNumber(row.pnlPct) ?? (notionalUsd !== null && notionalUsd > 0 && unrealizedPnl !== null
          ? round((unrealizedPnl / notionalUsd) * 100, 4)
          : null);
        const side = String(row.side ?? "long").toLowerCase() === "short" ? "short" : "long";
        const liquidationPrice = deps.toFiniteNumber(row.liquidationPrice ?? row.liqPrice);
        const liquidationDistancePct = deps.toFiniteNumber(row.liquidationDistancePct) ?? (
          liquidationPrice !== null && markPrice !== null && markPrice > 0
            ? round(side === "short"
              ? ((liquidationPrice - markPrice) / markPrice) * 100
              : ((markPrice - liquidationPrice) / markPrice) * 100, 4)
            : null
        );
        const riskLevel =
          roePct !== null && roePct <= -35
            ? "critical"
            : roePct !== null && roePct <= -15
              ? "warning"
              : "ok";
        return {
          id: `${exchangeAccountId}:${symbol}:${String(row.side ?? "long")}`,
          exchangeAccountId,
          exchange,
          exchangeLabel,
          symbol,
          side,
          size,
          entryPrice,
          markPrice,
          liquidationPrice,
          stopLossPrice: deps.toFiniteNumber(row.stopLossPrice),
          takeProfitPrice: deps.toFiniteNumber(row.takeProfitPrice),
          unrealizedPnl,
          notionalUsd,
          marginUsd,
          leverage,
          marginMode: normalizePositionMarginMode(row.marginMode),
          roePct,
          pnlPct,
          liquidationDistancePct,
          riskLevel
        };
      });
    })
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const account = accounts[index];
    if (result.status === "fulfilled") {
      fulfilled += 1;
      for (const item of result.value) {
        if (item.symbol && item.size > 0) items.push(item);
      }
    } else if (account?.id) {
      failedExchangeAccountIds.push(String(account.id));
    }
  }

  items.sort((a, b) => {
    const accountDiff = a.exchangeLabel.localeCompare(b.exchangeLabel);
    if (accountDiff !== 0) return accountDiff;
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    fetchedAt: new Date().toISOString(),
    degraded: accountIds.length > 0 && (fulfilled === 0 || failedExchangeAccountIds.length > 0),
    error: failedExchangeAccountIds.length > 0 ? "position_risk_partial_read_failed" : null,
    failedExchangeAccountIds,
    items
  };
}

async function readAlerts(deps: MobileMonitoringRoutesDeps, userId: string) {
  const now = new Date();
  const [accounts, bots, tradeStates, circuitEvents] = await Promise.all([
    deps.db.exchangeAccount.findMany({
      where: { userId },
      select: {
        id: true,
        exchange: true,
        label: true,
        futuresBudgetEquity: true,
        futuresBudgetAvailableMargin: true,
        pnlTodayUsd: true,
        lastSyncErrorAt: true,
        lastSyncErrorMessage: true
      }
    }),
    deps.db.bot.findMany({
      where: createVisibleMobileBotWhere(userId),
      select: {
        id: true,
        name: true,
        symbol: true,
        status: true,
        lastError: true,
        exchangeAccountId: true,
        runtime: {
          select: {
            updatedAt: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            lastError: true,
            lastErrorAt: true,
            mid: true,
            bid: true,
            ask: true
          }
        }
      }
    }),
    deps.ignoreMissingTable(() =>
      deps.db.botTradeState.findMany({
        where: { bot: { userId } },
        select: {
          botId: true,
          symbol: true,
          openSide: true,
          openQty: true,
          openEntryPrice: true,
          openTs: true,
          lastTradeTs: true
        }
      })
    ),
    deps.ignoreMissingTable(() =>
      deps.db.riskEvent.findMany({
        where: {
          type: "CIRCUIT_BREAKER_TRIPPED",
          bot: { userId }
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          botId: true,
          createdAt: true,
          message: true,
          bot: {
            select: {
              id: true,
              name: true,
              symbol: true,
              exchangeAccountId: true
            }
          }
        }
      })
    )
  ]);

  const tradeStateByBot = new Map((Array.isArray(tradeStates) ? tradeStates : []).map((row: any) => [String(row.botId), row] as const));
  const alerts: any[] = [];

  for (const account of accounts as any[]) {
    const accountId = String(account.id);
    const label = String(account.label ?? "").trim() || String(account.exchange ?? "").toUpperCase();
    if (account.lastSyncErrorMessage) {
      alerts.push(makeAlert({
        id: `sync:${accountId}:${String(account.lastSyncErrorAt ?? "")}:${String(account.lastSyncErrorMessage).slice(0, 40)}`,
        severity: "warning",
        type: "sync.error",
        title: `${label} Sync-Fehler`,
        message: String(account.lastSyncErrorMessage).slice(0, 220),
        ts: toIso(account.lastSyncErrorAt),
        routeTab: "dashboard",
        routeId: accountId,
        exchangeAccountId: accountId
      }));
    }

    const equity = deps.toFiniteNumber(account.futuresBudgetEquity);
    const available = deps.toFiniteNumber(account.futuresBudgetAvailableMargin);
    if (equity !== null && equity > 0 && available !== null && available >= 0) {
      const ratio = available / equity;
      if (ratio <= MARGIN_WARNING_RATIO) {
        const critical = ratio <= MARGIN_CRITICAL_RATIO;
        alerts.push(makeAlert({
          id: `margin:${accountId}:${Math.round(ratio * 1000)}`,
          severity: critical ? "critical" : "warning",
          type: "account.margin_warning",
          title: critical ? `${label} Margin kritisch` : `${label} Margin niedrig`,
          message: `Verfügbare Margin liegt bei ${Math.round(ratio * 100)}% der Equity.`,
          ts: now.toISOString(),
          routeTab: "dashboard",
          routeId: accountId,
          exchangeAccountId: accountId
        }));
      }
    }
  }

  for (const bot of bots as any[]) {
    const botId = String(bot.id);
    const symbol = normalizeSymbolInput(bot.symbol);
    const runtimeAt = latestDate(bot.runtime?.lastTickAt, bot.runtime?.lastHeartbeatAt, bot.runtime?.updatedAt);
    const stale = String(bot.status) === "running" && (msSince(runtimeAt, now) ?? Number.POSITIVE_INFINITY) > BOT_STALE_MS;
    if (String(bot.status) === "error") {
      alerts.push(makeAlert({
        id: `bot-error:${botId}:${String(bot.runtime?.lastErrorAt ?? bot.runtime?.updatedAt ?? "")}`,
        severity: "warning",
        type: "bot.error",
        title: `Bot-Fehler · ${bot.name}`,
        message: String(bot.runtime?.lastError ?? bot.lastError ?? "Bot meldet einen Fehler.").slice(0, 220),
        ts: toIso(bot.runtime?.lastErrorAt ?? bot.runtime?.updatedAt),
        routeTab: "bots",
        routeId: botId,
        symbol,
        botId,
        exchangeAccountId: bot.exchangeAccountId ?? null
      }));
    } else if (stale) {
      alerts.push(makeAlert({
        id: `bot-stale:${botId}:${runtimeAt?.toISOString() ?? "missing"}`,
        severity: "warning",
        type: "bot.runtime_stale",
        title: `Bot stale · ${bot.name}`,
        message: "Der Bot läuft, aber Heartbeat/Tick sind nicht aktuell.",
        ts: runtimeAt?.toISOString() ?? now.toISOString(),
        routeTab: "bots",
        routeId: botId,
        symbol,
        botId,
        exchangeAccountId: bot.exchangeAccountId ?? null
      }));
    }

    const trade = tradeStateByBot.get(botId);
    const openQty = deps.toFiniteNumber(trade?.openQty);
    const entryPrice = deps.toFiniteNumber(trade?.openEntryPrice);
    const mark = deps.toFiniteNumber(bot.runtime?.mid) ??
      (deps.toFiniteNumber(bot.runtime?.bid) !== null && deps.toFiniteNumber(bot.runtime?.ask) !== null
        ? ((deps.toFiniteNumber(bot.runtime?.bid) ?? 0) + (deps.toFiniteNumber(bot.runtime?.ask) ?? 0)) / 2
        : null);
    if (openQty !== null && openQty > 0 && entryPrice !== null && entryPrice > 0 && mark !== null) {
      const side = String(trade?.openSide ?? "long").toLowerCase() === "short" ? "short" : "long";
      const pnlUsd = side === "short" ? (entryPrice - mark) * openQty : (mark - entryPrice) * openQty;
      const notional = Math.abs(openQty * mark);
      const pnlPct = notional > 0 ? (pnlUsd / notional) * 100 : 0;
      if (Math.abs(pnlUsd) >= POSITION_PNL_MOVE_WARN_USD || Math.abs(pnlPct) >= POSITION_PNL_MOVE_WARN_PCT) {
        alerts.push(makeAlert({
          id: `position-pnl:${botId}:${Math.round(pnlUsd * 100)}`,
          severity: pnlUsd < 0 ? "warning" : "info",
          type: "position.pnl_move",
          title: `${symbol} PnL-Bewegung`,
          message: `Offene Position liegt bei ${round(pnlUsd, 2)} USD (${round(pnlPct, 2)}%).`,
          ts: now.toISOString(),
          routeTab: "positions",
          routeId: `${bot.exchangeAccountId ?? ""}:${symbol}:${side}`,
          symbol,
          botId,
          exchangeAccountId: bot.exchangeAccountId ?? null
        }));
      }
    }
  }

  for (const event of (Array.isArray(circuitEvents) ? circuitEvents : []) as any[]) {
    alerts.push(makeAlert({
      id: `circuit:${String(event.id)}`,
      severity: "critical",
      type: "bot.circuit_breaker",
      title: `Circuit Breaker · ${event.bot?.name ?? event.botId}`,
      message: String(event.message ?? "Circuit Breaker wurde ausgelöst.").slice(0, 220),
      ts: toIso(event.createdAt),
      routeTab: "bots",
      routeId: event.botId,
      symbol: event.bot?.symbol ?? null,
      botId: event.botId,
      exchangeAccountId: event.bot?.exchangeAccountId ?? null
    }));
  }

  const deduped = Array.from(new Map(alerts.map((alert) => [alert.id, alert] as const)).values());
  deduped.sort((a, b) => {
    const severityDiff = alertSeverityRank(b.severity) - alertSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.ts).getTime() - new Date(a.ts).getTime();
  });

  return {
    fetchedAt: now.toISOString(),
    degraded: false,
    error: null,
    items: deduped.slice(0, ALERT_LIMIT),
    summary: {
      total: deduped.length,
      critical: deduped.filter((alert) => alert.severity === "critical").length,
      warning: deduped.filter((alert) => alert.severity === "warning").length,
      info: deduped.filter((alert) => alert.severity === "info").length
    }
  };
}

function performanceRangeStart(range: z.infer<typeof performanceRangeSchema>, now: Date): Date {
  if (range === "today") {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
  const days = range === "30d" ? 30 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function readPerformance(deps: MobileMonitoringRoutesDeps, userId: string, query: z.infer<typeof performanceQuerySchema>) {
  const now = new Date();
  const from = performanceRangeStart(query.range, now);
  const snapshotModel = query.exchangeAccountId
    ? deps.db.dashboardPerformanceAccountSnapshot
    : deps.db.dashboardPerformanceSnapshot;
  const snapshotWhere: Record<string, unknown> = {
    userId,
    bucketTs: {
      gte: from,
      lte: now
    }
  };
  if (query.exchangeAccountId) snapshotWhere.exchangeAccountId = query.exchangeAccountId;
  const pointsRaw = await deps.ignoreMissingTable(() =>
    snapshotModel.findMany({
      where: snapshotWhere,
      orderBy: { bucketTs: "asc" },
      select: {
        bucketTs: true,
        totalEquity: true,
        totalAvailableMargin: true,
        totalTodayPnl: true,
        includedAccounts: true
      }
    })
  );
  const points = (Array.isArray(pointsRaw) ? pointsRaw : []).map((row: any) => ({
    ts: toIso(row.bucketTs) ?? now.toISOString(),
    totalEquity: deps.toFiniteNumber(row.totalEquity) ?? 0,
    totalAvailableMargin: deps.toFiniteNumber(row.totalAvailableMargin) ?? 0,
    totalTodayPnl: deps.toFiniteNumber(row.totalTodayPnl) ?? 0,
    includedAccounts: Number(row.includedAccounts ?? 0)
  }));

  const tradeWhere: Record<string, unknown> = {
    userId,
    status: "closed",
    exitTs: {
      gte: from,
      lte: now
    }
  };
  if (query.exchangeAccountId) tradeWhere.exchangeAccountId = query.exchangeAccountId;
  if (query.botId) tradeWhere.botId = query.botId;
  if (query.symbol) tradeWhere.symbol = normalizeSymbolInput(query.symbol);

  const tradesRaw = await deps.ignoreMissingTable(() =>
    deps.db.botTradeHistory.findMany({
      where: tradeWhere,
      orderBy: [{ exitTs: "asc" }],
      take: 1000,
      select: {
        id: true,
        side: true,
        entryTs: true,
        exitTs: true,
        entryPrice: true,
        exitPrice: true,
        realizedPnlUsd: true
      }
    })
  );
  const trades = (Array.isArray(tradesRaw) ? tradesRaw : []).map((row: any) => ({
    id: String(row.id),
    side: row.side ?? null,
    entryTs: row.entryTs instanceof Date ? row.entryTs : row.entryTs ? new Date(row.entryTs) : null,
    exitTs: row.exitTs instanceof Date ? row.exitTs : row.exitTs ? new Date(row.exitTs) : null,
    entryPrice: deps.toFiniteNumber(row.entryPrice),
    exitPrice: deps.toFiniteNumber(row.exitPrice),
    realizedPnlUsd: deps.toFiniteNumber(row.realizedPnlUsd)
  }));
  const metrics = computeCoreMetricsFromClosedTrades(trades);
  const filterRows = await Promise.all([
    deps.db.exchangeAccount.findMany({
      where: { userId },
      select: { id: true, exchange: true, label: true }
    }),
    deps.db.bot.findMany({
      where: createVisibleMobileBotWhere(userId),
      select: { id: true, name: true, symbol: true, exchangeAccountId: true }
    })
  ]);
  const symbols = Array.from(new Set((filterRows[1] as any[]).map((bot) => normalizeSymbolInput(bot.symbol)).filter(Boolean))).sort();

  return {
    fetchedAt: now.toISOString(),
    degraded: false,
    error: null,
    range: query.range,
    filters: {
      exchangeAccountId: query.exchangeAccountId ?? null,
      botId: query.botId ?? null,
      symbol: query.symbol ? normalizeSymbolInput(query.symbol) : null
    },
    points,
    summary: {
      trades: metrics.trades,
      wins: metrics.wins,
      losses: metrics.losses,
      winRatePct: metrics.winRatePct,
      profitFactor: metrics.profitFactor,
      netPnlUsd: metrics.netPnlUsd,
      maxDrawdownUsd: metrics.maxDrawdownUsd,
      avgWinUsd: metrics.avgWinUsd,
      avgLossUsd: metrics.avgLossUsd,
      avgHoldMinutes: metrics.avgHoldMinutes
    },
    options: {
      accounts: (filterRows[0] as any[]).map((account) => ({
        id: String(account.id),
        exchange: String(account.exchange ?? ""),
        label: String(account.label ?? "").trim() || String(account.exchange ?? "").toUpperCase()
      })),
      bots: (filterRows[1] as any[]).map((bot) => ({
        id: String(bot.id),
        name: String(bot.name ?? ""),
        symbol: normalizeSymbolInput(bot.symbol),
        exchangeAccountId: bot.exchangeAccountId ?? null
      })),
      symbols
    }
  };
}

async function readPredictionHistory(deps: MobileMonitoringRoutesDeps, userId: string, query: z.infer<typeof predictionHistoryQuerySchema>) {
  const stateWhere: Record<string, unknown> = { userId };
  if (query.symbol) stateWhere.symbol = normalizeSymbolInput(query.symbol);
  if (query.timeframe) stateWhere.timeframe = query.timeframe;
  const events = await deps.db.predictionEvent.findMany({
    where: {
      state: stateWhere
    },
    orderBy: { tsCreated: "desc" },
    take: query.limit,
    include: {
      state: {
        select: {
          id: true,
          symbol: true,
          exchange: true,
          accountId: true,
          marketType: true,
          timeframe: true,
          signal: true,
          expectedMovePct: true,
          confidence: true,
          tsUpdated: true
        }
      }
    }
  });
  const stateIds = Array.from(new Set((events as any[]).map((event) => String(event.stateId))));
  const tradesRaw = stateIds.length
    ? await deps.ignoreMissingTable(() =>
        deps.db.botTradeHistory.findMany({
          where: {
            userId,
            predictionStateId: { in: stateIds },
            status: "closed"
          },
          select: {
            id: true,
            predictionStateId: true,
            realizedPnlUsd: true,
            realizedPnlPct: true,
            outcome: true,
            exitTs: true
          }
        })
      )
    : [];
  const tradesByState = new Map<string, any[]>();
  for (const trade of (Array.isArray(tradesRaw) ? tradesRaw : []) as any[]) {
    const key = String(trade.predictionStateId ?? "");
    tradesByState.set(key, [...(tradesByState.get(key) ?? []), trade]);
  }

  let wins = 0;
  let losses = 0;
  let linkedTradeCount = 0;
  const signalCounts = { up: 0, down: 0, neutral: 0 };
  const items = (events as any[]).map((event) => {
    const snapshot = event.newSnapshot && typeof event.newSnapshot === "object" ? event.newSnapshot as any : {};
    const prev = event.prevSnapshot && typeof event.prevSnapshot === "object" ? event.prevSnapshot as any : {};
    const signal = String(snapshot.signal ?? event.state?.signal ?? "neutral").toLowerCase();
    if (signal === "up" || signal === "down") signalCounts[signal] += 1;
    else signalCounts.neutral += 1;
    const linkedTrades = tradesByState.get(String(event.stateId)) ?? [];
    for (const trade of linkedTrades) {
      linkedTradeCount += 1;
      const pnl = deps.toFiniteNumber(trade.realizedPnlUsd) ?? 0;
      if (pnl > 0) wins += 1;
      if (pnl < 0) losses += 1;
    }
    return {
      id: String(event.id),
      stateId: String(event.stateId),
      tsCreated: toIso(event.tsCreated),
      changeType: String(event.changeType ?? ""),
      reason: event.reason ?? null,
      symbol: normalizeSymbolInput(event.state?.symbol ?? snapshot.symbol),
      exchange: String(event.state?.exchange ?? snapshot.exchange ?? ""),
      accountId: String(event.state?.accountId ?? snapshot.accountId ?? ""),
      marketType: String(event.state?.marketType ?? snapshot.marketType ?? "perp"),
      timeframe: String(event.state?.timeframe ?? snapshot.timeframe ?? ""),
      signal,
      previousSignal: prev.signal ? String(prev.signal) : null,
      expectedMovePct: deps.toFiniteNumber(snapshot.expectedMovePct ?? event.state?.expectedMovePct),
      confidence: deps.toFiniteNumber(snapshot.confidence ?? event.state?.confidence),
      modelVersion: String(event.modelVersion ?? ""),
      linkedTrades: linkedTrades.slice(0, 5).map((trade) => ({
        id: String(trade.id),
        realizedPnlUsd: deps.toFiniteNumber(trade.realizedPnlUsd),
        realizedPnlPct: deps.toFiniteNumber(trade.realizedPnlPct),
        outcome: trade.outcome ?? null,
        exitTs: toIso(trade.exitTs)
      }))
    };
  });

  const totalOutcomes = wins + losses;
  return {
    fetchedAt: new Date().toISOString(),
    degraded: false,
    error: null,
    summary: {
      total: items.length,
      up: signalCounts.up,
      down: signalCounts.down,
      neutral: signalCounts.neutral,
      linkedTrades: linkedTradeCount,
      wins,
      losses,
      hitRatePct: totalOutcomes > 0 ? round((wins / totalOutcomes) * 100, 2) : null
    },
    items
  };
}

async function readCalendarRisk(deps: MobileMonitoringRoutesDeps, userId: string) {
  const watchlist = await readWatchlistRows(deps, userId);
  const symbols = watchlistSymbols(watchlist);
  const currencies = Array.from(new Set(["USD", ...symbols.map(symbolToMacroCurrency)])).filter(Boolean).slice(0, 8);
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [next, eventsPage, symbolRisks] = await Promise.all([
    getEconomicCalendarNextSummary({ db: deps.db, currency: "USD", impact: "high" }),
    listEconomicEventsPage({
      db: deps.db,
      from: now.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      currencies,
      impacts: ["high", "medium"],
      limit: 100
    }),
    Promise.all(symbols.map(async (symbol) => ({
      symbol,
      ...(await evaluateNewsRiskForSymbol({ db: deps.db, symbol, now }))
    })))
  ]);

  const highImpactSoon = eventsPage.events.filter((event: any) => {
    const ts = new Date(event.ts ?? event.date ?? event.time ?? "");
    return String(event.impact ?? "").toLowerCase() === "high" && !Number.isNaN(ts.getTime()) && ts.getTime() <= now.getTime() + 48 * 60 * 60 * 1000;
  });

  return {
    fetchedAt: now.toISOString(),
    degraded: next.degraded === true,
    error: next.degradedReason ?? null,
    watchlist: symbols,
    currencies,
    blackoutActive: next.blackoutActive,
    activeWindow: next.activeWindow ?? null,
    nextEvent: next.nextEvent ?? null,
    highImpactSoon,
    symbolRisks,
    events: eventsPage.events
  };
}

function itemMatchesSymbol(item: any, symbol: string): boolean {
  const compactSymbol = symbol.replace(/[^A-Z0-9]/g, "");
  const haystack = [
    item.symbol,
    item.title,
    item.text,
    item.site,
    item.source
  ].map((value) => String(value ?? "").toUpperCase()).join(" ");
  return haystack.includes(symbol) || (compactSymbol.length >= 3 && haystack.includes(compactSymbol));
}

async function readNewsIntelligence(deps: MobileMonitoringRoutesDeps, userId: string, query: z.infer<typeof newsIntelligenceQuerySchema>) {
  const listNews = deps.listNews ?? defaultListNews;
  const watchlist = await readWatchlistRows(deps, userId);
  const symbols = watchlistSymbols(watchlist);
  const page = await listNews({
    db: deps.db,
    mode: query.mode,
    limit: query.limit,
    page: 1,
    q: query.q ?? null,
    symbols
  });
  const groups = symbols.map((symbol) => {
    const items = page.items.filter((item: any) => itemMatchesSymbol(item, symbol));
    return {
      symbol,
      relevance: items.length > 0 ? "watchlist_match" : "quiet",
      whyRelevant: items.length > 0
        ? `${items.length} aktuelle Meldung(en) zur Watchlist.`
        : "Keine direkte Watchlist-Meldung im aktuellen News-Fenster.",
      items
    };
  });
  const ungrouped = page.items.filter((item: any) => !symbols.some((symbol) => itemMatchesSymbol(item, symbol)));
  if (ungrouped.length > 0) {
    groups.push({
      symbol: "MARKET",
      relevance: "market_context",
      whyRelevant: "Allgemeiner Marktkontext außerhalb der Watchlist.",
      items: ungrouped
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    degraded: page.meta?.partial === true,
    error: null,
    mode: query.mode,
    query: query.q ?? null,
    watchlist: symbols,
    groups,
    meta: page.meta
  };
}

export function registerMobileMonitoringRoutes(app: Express, deps: MobileMonitoringRoutesDeps) {
  const auth = deps.authMiddleware ?? requireAuth;

  app.get("/mobile/watchlist", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const rows = await readWatchlistRows(deps, user.id);
    return res.json({
      fetchedAt: new Date().toISOString(),
      degraded: false,
      error: null,
      items: rows.map(toWatchlistDto)
    });
  });

  app.post("/mobile/watchlist", auth, async (req, res) => {
    const parsed = watchlistUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const user = getUserFromLocals(res);
    const symbol = normalizeSymbolInput(parsed.data.symbol);
    if (!symbol) return res.status(400).json({ error: "invalid_symbol" });
    const exchange = normalizeExchangeInput(parsed.data.exchange, deps.normalizeExchangeValue);
    const existingCount = await deps.db.mobileWatchlistItem.count({ where: { userId: user.id } });
    const saved = await deps.db.mobileWatchlistItem.upsert({
      where: {
        userId_symbol_marketType_exchange: {
          userId: user.id,
          symbol,
          marketType: parsed.data.marketType,
          exchange
        }
      },
      create: {
        userId: user.id,
        symbol,
        marketType: parsed.data.marketType,
        exchange,
        sortOrder: existingCount
      },
      update: {
        updatedAt: new Date()
      }
    });
    return res.status(existingCount >= WATCHLIST_LIMIT ? 200 : 201).json({
      item: toWatchlistDto(saved)
    });
  });

  app.delete("/mobile/watchlist/:symbol", auth, async (req, res) => {
    const user = getUserFromLocals(res);
    const symbol = normalizeSymbolInput(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "invalid_symbol" });
    const result = await deps.db.mobileWatchlistItem.deleteMany({
      where: {
        userId: user.id,
        symbol
      }
    });
    return res.json({ deleted: Number(result.count ?? 0) });
  });

  app.get("/mobile/bot-health", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      return res.json(await readBotHealth(deps, user.id));
    } catch (error) {
      return res.status(500).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        summary: { total: 0, running: 0, error: 0, stopped: 0, stale: 0, warning: 0 },
        items: []
      });
    }
  });

  app.get("/mobile/alerts", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      return res.json(await readAlerts(deps, user.id));
    } catch (error) {
      return res.status(500).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        items: [],
        summary: { total: 0, critical: 0, warning: 0, info: 0 }
      });
    }
  });

  app.get("/mobile/position-risk", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      return res.json(await listPositionRiskItems(deps, user.id));
    } catch (error) {
      return res.status(503).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        failedExchangeAccountIds: [],
        items: []
      });
    }
  });

  app.get("/mobile/performance", auth, async (req, res) => {
    const parsed = performanceQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      return res.json(await readPerformance(deps, user.id, parsed.data));
    } catch (error) {
      return res.status(500).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        range: parsed.data.range,
        filters: {},
        points: [],
        summary: {},
        options: { accounts: [], bots: [], symbols: [] }
      });
    }
  });

  app.get("/mobile/predictions/history", auth, async (req, res) => {
    const parsed = predictionHistoryQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      return res.json(await readPredictionHistory(deps, user.id, parsed.data));
    } catch (error) {
      return res.status(500).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        summary: { total: 0, up: 0, down: 0, neutral: 0, linkedTrades: 0, wins: 0, losses: 0, hitRatePct: null },
        items: []
      });
    }
  });

  app.get("/mobile/calendar-risk", auth, async (_req, res) => {
    const user = getUserFromLocals(res);
    try {
      return res.json(await readCalendarRisk(deps, user.id));
    } catch (error) {
      return res.status(500).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        watchlist: [],
        currencies: ["USD"],
        blackoutActive: false,
        activeWindow: null,
        nextEvent: null,
        highImpactSoon: [],
        symbolRisks: [],
        events: []
      });
    }
  });

  app.get("/mobile/news-intelligence", auth, async (req, res) => {
    const parsed = newsIntelligenceQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const user = getUserFromLocals(res);
    try {
      return res.json(await readNewsIntelligence(deps, user.id, parsed.data));
    } catch (error) {
      return res.status(503).json({
        fetchedAt: new Date().toISOString(),
        degraded: true,
        error: toReason(error),
        mode: parsed.data.mode,
        query: parsed.data.q ?? null,
        watchlist: [],
        groups: [],
        meta: null
      });
    }
  });
}
