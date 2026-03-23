import express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

type DashboardPerformanceRange = "24h" | "7d" | "30d";
type DashboardAlertSeverity = "info" | "warning" | "critical";
type GridDeskVisibilityMask = {
  symbolsByAccount: Map<string, Set<string>>;
  orderIdsByAccount: Map<string, Set<string>>;
};

const dashboardAlertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const dashboardPerformanceQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h"),
  exchangeAccountId: z.string().trim().min(1).optional()
});

const dashboardRiskAnalysisQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export type RegisterDashboardRoutesDeps = {
  db: any;
  PREDICTION_REFRESH_SCAN_LIMIT: number;
  DASHBOARD_PERFORMANCE_RANGE_MS: Record<DashboardPerformanceRange, number>;
  DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS: number;
  DASHBOARD_ALERT_STALE_SYNC_MS: number;
  DASHBOARD_MARGIN_WARN_RATIO: number;
  ignoreMissingTable<T>(operation: () => Promise<T>): Promise<T | null>;
  shouldIncludeBotInStandardOverview(strategyKey: unknown): boolean;
  listPaperMarketDataAccountIds(exchangeAccountIds: string[]): Promise<Record<string, string | null>>;
  resolveMarketDataTradingAccount(userId: string, exchangeAccountId?: string): Promise<any>;
  normalizeExchangeValue(value: string): string;
  createManualSpotClient(account: any, source: string): any;
  createManualPerpMarketDataClient(account: any, source: string): any;
  getPaperSpotAccountState(account: any, client: any): Promise<{ equity: number | null; availableMargin: number | null }>;
  resolveLastSyncAt(runtime: any): Date | null;
  computeConnectionStatus(lastSyncAt: Date | null, hasBotActivity: boolean): string;
  toFiniteNumber(value: unknown): number | null;
  toIso(value: Date | null | undefined): string | null;
  readBotRealizedPnlTodayByAccount(userId: string, accountIds: string[]): Promise<Map<string, any>>;
  resolveEffectivePnlTodayUsd(rawPnlTodayUsd: unknown, botRealizedToday: any): number;
  mergeRiskProfileWithDefaults(profile: any): any;
  computeAccountRiskAssessment(account: any, limits: any): any;
  riskSeverityRank(value: string): number;
  loadGridDeskVisibilityMask(userId: string, exchangeAccountIds: string[]): Promise<GridDeskVisibilityMask>;
  filterGridBotPositionsForDesk<T extends { symbol?: string | null }>(rows: T[], visibilityMask: GridDeskVisibilityMask, exchangeAccountId: string): T[];
  createPerpExecutionAdapter(account: any): any;
  listPositions(adapter: any): Promise<any[]>;
  listPaperPositions(account: any, reader: any): Promise<any[]>;
  isPaperTradingAccount(account: any): boolean;
  createDashboardAlertId(parts: Array<string | null | undefined>): string;
  alertSeverityRank(value: DashboardAlertSeverity): number;
  getAiPayloadBudgetAlertSnapshot(): {
    highWaterAlert: boolean;
    highWaterConsecutive: number;
    highWaterConsecutiveThreshold: number;
    lastHighWaterAt: string | null;
    trimAlert: boolean;
    trimCountLastHour: number;
    trimAlertThresholdPerHour: number;
  };
};

export function registerDashboardRoutes(app: express.Express, deps: RegisterDashboardRoutesDeps) {
  app.get("/dashboard/overview", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const dayStartUtc = new Date();
    dayStartUtc.setUTCHours(0, 0, 0, 0);

    const [accounts, bots, predictionStates] = await Promise.all([
      deps.db.exchangeAccount.findMany({
        where: { userId: user.id },
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
        where: {
          userId: user.id,
          exchangeAccountId: { not: null }
        },
        select: {
          id: true,
          exchangeAccountId: true,
          status: true,
          lastError: true,
          futuresConfig: {
            select: {
              strategyKey: true
            }
          },
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
      }),
      deps.db.predictionState.findMany({
        where: {
          userId: user.id,
          autoScheduleEnabled: true,
          autoSchedulePaused: false
        },
        orderBy: [{ tsUpdated: "desc" }, { updatedAt: "desc" }],
        take: Math.max(200, deps.PREDICTION_REFRESH_SCAN_LIMIT),
        select: {
          accountId: true
        }
      })
    ]);
    const accountIds = accounts
      .map((row: any) => (typeof row.id === "string" ? row.id : null))
      .filter((value): value is string => Boolean(value));
    const botRealizedRows = accountIds.length > 0
      ? await deps.ignoreMissingTable(() => deps.db.botTradeHistory.findMany({
          where: {
            userId: user.id,
            exchangeAccountId: { in: accountIds },
            status: "closed",
            exitTs: { gte: dayStartUtc }
          },
          select: {
            exchangeAccountId: true,
            realizedPnlUsd: true
          }
        }))
      : [];
    const botRealizedByAccount = new Map<string, { pnl: number; count: number }>();
    for (const row of Array.isArray(botRealizedRows) ? botRealizedRows : []) {
      const exchangeAccountId =
        typeof (row as any)?.exchangeAccountId === "string" ? String((row as any).exchangeAccountId) : "";
      if (!exchangeAccountId) continue;
      const pnl = deps.toFiniteNumber((row as any)?.realizedPnlUsd);
      if (pnl === null) continue;
      const current = botRealizedByAccount.get(exchangeAccountId) ?? { pnl: 0, count: 0 };
      current.pnl += pnl;
      current.count += 1;
      botRealizedByAccount.set(exchangeAccountId, current);
    }
    const paperIds = accounts
      .filter((row: any) => deps.normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
      .map((row: any) => String(row.id));
    const hyperliquidIds = accounts
      .filter((row: any) => deps.normalizeExchangeValue(String(row.exchange ?? "")) === "hyperliquid")
      .map((row: any) => String(row.id));
    const paperBindings = await deps.listPaperMarketDataAccountIds(paperIds);
    const accountById = new Map<string, any>(accounts.map((row: any) => [String(row.id), row]));
    const paperSpotBudgetByAccount = new Map<string, { total: number | null; available: number | null }>();
    const hyperliquidSpotBudgetByAccount = new Map<
      string,
      { total: number | null; available: number | null; currency: string | null }
    >();
    await Promise.all(
      paperIds.map(async (paperAccountId) => {
        try {
          const resolved = await deps.resolveMarketDataTradingAccount(user.id, paperAccountId);
          const marketDataExchange = deps.normalizeExchangeValue(resolved.marketDataAccount.exchange);
          if (marketDataExchange !== "bitget" && marketDataExchange !== "binance") return;
          const spotClient = deps.createManualSpotClient(resolved.marketDataAccount, "dashboard/exchange-overview");
          const spotSummary = await deps.getPaperSpotAccountState(resolved.selectedAccount, spotClient);
          paperSpotBudgetByAccount.set(paperAccountId, {
            total: spotSummary.equity ?? null,
            available: spotSummary.availableMargin ?? null
          });
        } catch {
          // Spot budget for paper is best-effort for dashboard display.
        }
      })
    );
    await Promise.all(
      hyperliquidIds.map(async (hyperliquidAccountId) => {
        try {
          const resolved = await deps.resolveMarketDataTradingAccount(user.id, hyperliquidAccountId);
          const marketDataExchange = deps.normalizeExchangeValue(resolved.marketDataAccount.exchange);
          if (marketDataExchange !== "hyperliquid") return;
          const spotClient = deps.createManualSpotClient(
            resolved.marketDataAccount,
            "dashboard/exchange-overview"
          );
          const spotSummary = await spotClient.getSummary("USDC");
          hyperliquidSpotBudgetByAccount.set(hyperliquidAccountId, {
            total: spotSummary.equity ?? null,
            available: spotSummary.available ?? null,
            currency: spotSummary.currency ?? "USDC"
          });
        } catch {
          // Hyperliquid spot budget is best-effort for dashboard display.
        }
      })
    );

    const aggregate = new Map<string, {
      running: number;
      runningStandard: number;
      runningGrid: number;
      stopped: number;
      error: number;
      latestSyncAt: Date | null;
      latestRuntimeAt: Date | null;
      latestRuntimeFreeUsdt: number | null;
      lastErrorMessage: string | null;
    }>();

    for (const account of accounts) {
      aggregate.set(account.id, {
        running: 0,
        runningStandard: 0,
        runningGrid: 0,
        stopped: 0,
        error: 0,
        latestSyncAt: null,
        latestRuntimeAt: null,
        latestRuntimeFreeUsdt: null,
        lastErrorMessage: null
      });
    }

    const runningPredictionCounts = new Map<string, number>();

    for (const row of predictionStates) {
      const exchangeAccountId =
        typeof row.accountId === "string" && row.accountId.trim()
          ? row.accountId.trim()
          : null;
      if (!exchangeAccountId) continue;
      runningPredictionCounts.set(
        exchangeAccountId,
        (runningPredictionCounts.get(exchangeAccountId) ?? 0) + 1
      );
    }

    for (const bot of bots) {
      const exchangeAccountId = bot.exchangeAccountId as string | null;
      if (!exchangeAccountId) continue;
      const current = aggregate.get(exchangeAccountId);
      if (!current) continue;
      const strategyKey = bot.futuresConfig?.strategyKey ?? null;
      const isStandardBot = deps.shouldIncludeBotInStandardOverview(strategyKey);
      const isGridBot = String(strategyKey ?? "").trim().toLowerCase() === "futures_grid";

      if (bot.status === "running") {
        current.running += 1;
        if (isGridBot) current.runningGrid += 1;
        else if (isStandardBot) current.runningStandard += 1;
      }
      else if (bot.status === "error") current.error += 1;
      else current.stopped += 1;

      if (!current.lastErrorMessage) {
        current.lastErrorMessage = bot.lastError ?? bot.runtime?.lastError ?? null;
      }

      const lastSyncAt = deps.resolveLastSyncAt(bot.runtime);
      if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
        current.latestSyncAt = lastSyncAt;
      }

      const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
      if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
        current.latestRuntimeAt = runtimeUpdatedAt;
        current.latestRuntimeFreeUsdt =
          typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
      }
    }

    const overview = accounts.map((account) => {
      const row = aggregate.get(account.id);
      const botRealizedToday = botRealizedByAccount.get(account.id) ?? null;
      const exchangePnlToday =
        account.pnlTodayUsd === null || account.pnlTodayUsd === undefined
          ? null
          : deps.toFiniteNumber(account.pnlTodayUsd);
      const pnlTodayUsd = exchangePnlToday !== null
        ? exchangePnlToday
        : botRealizedToday && botRealizedToday.count > 0
          ? Number(botRealizedToday.pnl.toFixed(6))
          : 0;
      const isPaper = deps.normalizeExchangeValue(String(account.exchange ?? "")) === "paper";
      const isHyperliquid = deps.normalizeExchangeValue(String(account.exchange ?? "")) === "hyperliquid";
      const linkedMarketDataId = isPaper ? (paperBindings[account.id] ?? null) : null;
      const linkedMarketDataAccount = linkedMarketDataId
        ? accountById.get(linkedMarketDataId) ?? null
        : null;
      const linkedMarketDataAggregate = linkedMarketDataId
        ? aggregate.get(linkedMarketDataId) ?? null
        : null;
      const lastSyncAt =
        row?.latestSyncAt
        ?? linkedMarketDataAggregate?.latestSyncAt
        ?? linkedMarketDataAccount?.lastUsedAt
        ?? account.lastUsedAt
        ?? null;
      const hasBotActivity =
        ((row?.running ?? 0) + (row?.error ?? 0)) > 0;
      const status = isPaper
        ? "connected"
        : deps.computeConnectionStatus(lastSyncAt, hasBotActivity);

      const persistedSpotBudget =
        account.spotBudgetTotal !== null || account.spotBudgetAvailable !== null
          ? {
              total: account.spotBudgetTotal,
              available: account.spotBudgetAvailable
            }
          : null;
      const livePaperSpotBudget = isPaper ? (paperSpotBudgetByAccount.get(account.id) ?? null) : null;
      const liveHyperliquidSpotBudget = isHyperliquid
        ? (hyperliquidSpotBudgetByAccount.get(account.id) ?? null)
        : null;

      return {
        exchangeAccountId: account.id,
        exchange: account.exchange,
        label: account.label,
        status,
        lastSyncAt: deps.toIso(lastSyncAt),
        spotBudget: isPaper
          ? (livePaperSpotBudget ?? persistedSpotBudget)
          : isHyperliquid
            ? (liveHyperliquidSpotBudget ?? persistedSpotBudget)
            : persistedSpotBudget,
        futuresBudget: (() => {
          const availableMargin =
            row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
              ? row.latestRuntimeFreeUsdt
              : account.futuresBudgetAvailableMargin;
          const equity = account.futuresBudgetEquity;
          if (equity === null && availableMargin === null) return null;
          return {
            equity,
            availableMargin
          };
        })(),
        pnlTodayUsd,
        lastSyncError:
          account.lastSyncErrorAt || account.lastSyncErrorMessage
            ? {
                at: deps.toIso(account.lastSyncErrorAt),
                message: account.lastSyncErrorMessage ?? null
              }
            : null,
        bots: {
          running: row?.running ?? 0,
          runningStandard: row?.runningStandard ?? 0,
          runningGrid: row?.runningGrid ?? 0,
          stopped: row?.stopped ?? 0,
          error: row?.error ?? 0
        },
        runningPredictions: runningPredictionCounts.get(account.id) ?? 0,
        alerts: {
          hasErrors: (row?.error ?? 0) > 0,
          message: row?.lastErrorMessage ?? null
        }
      };
    });

    const totals = overview.reduce(
      (acc, row) => {
        const spotTotal = deps.toFiniteNumber(row.spotBudget?.total);
        const futuresEquity = deps.toFiniteNumber(row.futuresBudget?.equity);
        const availableMargin = deps.toFiniteNumber(row.futuresBudget?.availableMargin);
        const pnlToday = deps.toFiniteNumber(row.pnlTodayUsd);

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
      },
      {
        totalEquity: 0,
        totalAvailableMargin: 0,
        totalTodayPnl: 0,
        currency: "USDT",
        includedAccounts: 0
      }
    );

    return res.json({
      accounts: overview,
      totals: {
        ...totals,
        totalEquity: Number(totals.totalEquity.toFixed(6)),
        totalAvailableMargin: Number(totals.totalAvailableMargin.toFixed(6)),
        totalTodayPnl: Number(totals.totalTodayPnl.toFixed(6))
      }
    });
  });

  app.get("/dashboard/performance", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = dashboardPerformanceQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const range = parsed.data.range;
    const exchangeAccountId = parsed.data.exchangeAccountId ?? null;
    const now = new Date();
    const from = new Date(now.getTime() - deps.DASHBOARD_PERFORMANCE_RANGE_MS[range]);

    if (exchangeAccountId) {
      const account = await deps.db.exchangeAccount.findFirst({
        where: {
          id: exchangeAccountId,
          userId: user.id
        }
      });
      if (!account) {
        return res.status(404).json({ error: "exchange_account_not_found" });
      }
      const rows = await deps.db.dashboardPerformanceAccountSnapshot.findMany({
        where: {
          userId: user.id,
          exchangeAccountId,
          bucketTs: {
            gte: from,
            lte: now
          }
        },
        orderBy: { bucketTs: "asc" },
        select: {
          bucketTs: true,
          totalEquity: true,
          totalAvailableMargin: true,
          totalTodayPnl: true,
          includedAccounts: true
        }
      });

      const points = rows.map((row: any) => ({
        ts: row.bucketTs.toISOString(),
        totalEquity: Number(Number(row.totalEquity ?? 0).toFixed(6)),
        totalAvailableMargin: Number(Number(row.totalAvailableMargin ?? 0).toFixed(6)),
        totalTodayPnl: Number(Number(row.totalTodayPnl ?? 0).toFixed(6)),
        includedAccounts: Math.max(0, Number(row.includedAccounts ?? 0) || 0)
      }));

      return res.json({
        range,
        exchangeAccountId,
        bucketSeconds: deps.DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS,
        points
      });
    }

    const rows = await deps.db.dashboardPerformanceSnapshot.findMany({
      where: {
        userId: user.id,
        bucketTs: {
          gte: from,
          lte: now
        }
      },
      orderBy: { bucketTs: "asc" },
      select: {
        bucketTs: true,
        totalEquity: true,
        totalAvailableMargin: true,
        totalTodayPnl: true,
        includedAccounts: true
      }
    });

    const points = rows.map((row: any) => ({
      ts: row.bucketTs.toISOString(),
      totalEquity: Number(Number(row.totalEquity ?? 0).toFixed(6)),
      totalAvailableMargin: Number(Number(row.totalAvailableMargin ?? 0).toFixed(6)),
      totalTodayPnl: Number(Number(row.totalTodayPnl ?? 0).toFixed(6)),
      includedAccounts: Math.max(0, Number(row.includedAccounts ?? 0) || 0)
    }));

    return res.json({
      range,
      exchangeAccountId: null,
      bucketSeconds: deps.DASHBOARD_PERFORMANCE_SNAPSHOT_BUCKET_SECONDS,
      points
    });
  });

  app.get("/dashboard/risk-analysis", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = dashboardRiskAnalysisQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const [accounts, bots] = await Promise.all([
      deps.db.exchangeAccount.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          exchange: true,
          label: true,
          lastUsedAt: true,
          futuresBudgetEquity: true,
          futuresBudgetAvailableMargin: true,
          pnlTodayUsd: true,
          riskProfile: {
            select: {
              dailyLossWarnPct: true,
              dailyLossWarnUsd: true,
              dailyLossCriticalPct: true,
              dailyLossCriticalUsd: true,
              marginWarnPct: true,
              marginWarnUsd: true,
              marginCriticalPct: true,
              marginCriticalUsd: true
            }
          }
        }
      }),
      deps.db.bot.findMany({
        where: {
          userId: user.id,
          exchangeAccountId: {
            not: null
          }
        },
        select: {
          exchangeAccountId: true,
          runtime: {
            select: {
              updatedAt: true
            }
          }
        }
      })
    ]);
    const accountIds = accounts
      .map((row: any) => (typeof row.id === "string" ? String(row.id) : ""))
      .filter(Boolean);
    const botRealizedByAccount = await deps.readBotRealizedPnlTodayByAccount(user.id, accountIds);

    const runtimeUpdatedByAccountId = new Map<string, Date>();
    for (const bot of bots) {
      const exchangeAccountId =
        typeof bot.exchangeAccountId === "string" && bot.exchangeAccountId.trim()
          ? bot.exchangeAccountId.trim()
          : null;
      if (!exchangeAccountId) continue;
      const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
      if (!runtimeUpdatedAt) continue;
      const current = runtimeUpdatedByAccountId.get(exchangeAccountId);
      if (!current || runtimeUpdatedAt.getTime() > current.getTime()) {
        runtimeUpdatedByAccountId.set(exchangeAccountId, runtimeUpdatedAt);
      }
    }

    const rankedItems = (Array.isArray(accounts) ? accounts : []).map((account: any) => {
      const botRealizedToday = botRealizedByAccount.get(String(account.id)) ?? null;
      const effectivePnlTodayUsd = deps.resolveEffectivePnlTodayUsd(account.pnlTodayUsd, botRealizedToday);
      const limits = deps.mergeRiskProfileWithDefaults(account.riskProfile);
      const assessment = deps.computeAccountRiskAssessment(
        {
          ...account,
          pnlTodayUsd: effectivePnlTodayUsd
        },
        limits
      );
      const runtimeUpdatedAt = runtimeUpdatedByAccountId.get(String(account.id)) ?? null;
      const recencyTs = Math.max(
        account.lastUsedAt instanceof Date ? account.lastUsedAt.getTime() : 0,
        runtimeUpdatedAt instanceof Date ? runtimeUpdatedAt.getTime() : 0
      );
      return {
        exchangeAccountId: String(account.id),
        exchange: String(account.exchange ?? ""),
        label: String(account.label ?? ""),
        severity: assessment.severity,
        triggers: assessment.triggers,
        riskScore: assessment.riskScore,
        insufficientData: assessment.insufficientData,
        lossUsd: assessment.lossUsd,
        lossPct: assessment.lossPct,
        marginPct: assessment.marginPct,
        availableMarginUsd: assessment.availableMarginUsd,
        pnlTodayUsd: assessment.pnlTodayUsd,
        lastSyncAt: deps.toIso(account.lastUsedAt),
        runtimeUpdatedAt: deps.toIso(runtimeUpdatedAt),
        _recencyTs: recencyTs
      };
    });

    const summary = rankedItems.reduce(
      (acc, item) => {
        if (item.severity === "critical") acc.critical += 1;
        else if (item.severity === "warning") acc.warning += 1;
        else acc.ok += 1;
        return acc;
      },
      {
        critical: 0,
        warning: 0,
        ok: 0
      }
    );

    rankedItems.sort((a, b) => {
      const severityDiff = deps.riskSeverityRank(b.severity) - deps.riskSeverityRank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return b._recencyTs - a._recencyTs;
    });

    return res.json({
      items: rankedItems.slice(0, parsed.data.limit).map((item) => {
        const { _recencyTs: _dropRecencyTs, ...publicItem } = item;
        return publicItem;
      }),
      summary,
      evaluatedAt: new Date().toISOString()
    });
  });

  app.get("/dashboard/open-positions", requireAuth, async (_req, res) => {
    const user = getUserFromLocals(res);
    const accounts = await deps.db.exchangeAccount.findMany({
      where: { userId: user.id },
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
    const visibilityMask = await deps.loadGridDeskVisibilityMask(user.id, accounts.map((account: any) => String(account.id)));

    const items: any[] = [];
    const failedExchangeAccountIds: string[] = [];

    const results = await Promise.allSettled(
      accounts.map(async (account: any) => {
        const exchangeAccountId = String(account.id);
        const exchange = String(account.exchange ?? "");
        const exchangeLabel = String(account.label ?? "").trim() || exchange.toUpperCase();
        const resolved = await deps.resolveMarketDataTradingAccount(user.id, exchangeAccountId);
        const selectedExchange = deps.normalizeExchangeValue(resolved.selectedAccount.exchange);
        if (selectedExchange === "binance") {
          return [];
        }
        if (deps.isPaperTradingAccount(resolved.selectedAccount)) {
          const perpClient = deps.createManualPerpMarketDataClient(
            resolved.marketDataAccount,
            "dashboard/open-positions"
          );
          try {
            const rows = await deps.listPaperPositions(resolved.selectedAccount, perpClient);
            return deps.filterGridBotPositionsForDesk(rows, visibilityMask, exchangeAccountId).map((row) => ({
              exchangeAccountId,
              exchange,
              exchangeLabel,
              symbol: String(row.symbol ?? ""),
              side: row.side === "short" ? "short" : "long",
              size: Number(row.size ?? 0),
              entryPrice: deps.toFiniteNumber(row.entryPrice),
              stopLossPrice: deps.toFiniteNumber(row.stopLossPrice),
              takeProfitPrice: deps.toFiniteNumber(row.takeProfitPrice),
              unrealizedPnl: deps.toFiniteNumber(row.unrealizedPnl)
            }));
          } finally {
            await perpClient.close();
          }
        }
        const adapter = deps.createPerpExecutionAdapter(resolved.marketDataAccount);
        try {
          const rows = await deps.listPositions(adapter);

          return deps.filterGridBotPositionsForDesk(rows, visibilityMask, exchangeAccountId).map((row) => ({
            exchangeAccountId,
            exchange,
            exchangeLabel,
            symbol: String(row.symbol ?? ""),
            side: row.side === "short" ? "short" : "long",
            size: Number(row.size ?? 0),
            entryPrice: deps.toFiniteNumber(row.entryPrice),
            stopLossPrice: deps.toFiniteNumber(row.stopLossPrice),
            takeProfitPrice: deps.toFiniteNumber(row.takeProfitPrice),
            unrealizedPnl: deps.toFiniteNumber(row.unrealizedPnl)
          }));
        } finally {
          await adapter.close();
        }
      })
    );

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const account = accounts[index];
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          if (!(item.symbol.length > 0 && Number.isFinite(item.size) && item.size > 0)) continue;
          items.push(item);
        }
        continue;
      }
      if (account?.id) {
        failedExchangeAccountIds.push(String(account.id));
      }
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

    const exchanges = accounts.map((account: any) => ({
      exchangeAccountId: String(account.id),
      exchange: String(account.exchange ?? ""),
      label: String(account.label ?? "").trim() || String(account.exchange ?? "").toUpperCase()
    }));

    return res.json({
      items,
      exchanges,
      meta: {
        fetchedAt: new Date().toISOString(),
        partialErrors: failedExchangeAccountIds.length,
        failedExchangeAccountIds
      }
    });
  });

  app.get("/dashboard/alerts", requireAuth, async (req, res) => {
    const user = getUserFromLocals(res);
    const parsed = dashboardAlertsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const limit = parsed.data.limit;
    const [accounts, bots, circuitEvents] = await Promise.all([
      deps.db.exchangeAccount.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          exchange: true,
          label: true,
          lastUsedAt: true,
          futuresBudgetEquity: true,
          futuresBudgetAvailableMargin: true,
          lastSyncErrorAt: true,
          lastSyncErrorMessage: true
        }
      }),
      deps.db.bot.findMany({
        where: {
          userId: user.id,
          exchangeAccountId: { not: null }
        },
        select: {
          id: true,
          name: true,
          status: true,
          lastError: true,
          updatedAt: true,
          exchangeAccountId: true,
          runtime: {
            select: {
              updatedAt: true,
              lastHeartbeatAt: true,
              lastTickAt: true,
              lastError: true,
              lastErrorAt: true,
              lastErrorMessage: true,
              reason: true,
              freeUsdt: true
            }
          }
        }
      }),
      deps.db.riskEvent.findMany({
        where: {
          type: "CIRCUIT_BREAKER_TRIPPED",
          bot: {
            userId: user.id
          }
        },
        orderBy: { createdAt: "desc" },
        take: Math.max(limit * 3, 30),
        select: {
          id: true,
          botId: true,
          createdAt: true,
          message: true,
          meta: true,
          bot: {
            select: {
              id: true,
              name: true,
              exchangeAccountId: true,
              exchangeAccount: {
                select: {
                  id: true,
                  exchange: true,
                  label: true
                }
              }
            }
          }
        }
      })
    ]);

    const accountById = new Map<string, any>(
      accounts.map((row: any) => [String(row.id), row] as const)
    );
    const paperIds = accounts
      .filter((row: any) => deps.normalizeExchangeValue(String(row.exchange ?? "")) === "paper")
      .map((row: any) => String(row.id));
    const paperBindings = await deps.listPaperMarketDataAccountIds(paperIds);
    const aggregate = new Map<string, {
      running: number;
      stopped: number;
      error: number;
      latestSyncAt: Date | null;
      latestRuntimeAt: Date | null;
      latestRuntimeFreeUsdt: number | null;
    }>();

    for (const account of accounts) {
      aggregate.set(account.id, {
        running: 0,
        stopped: 0,
        error: 0,
        latestSyncAt: null,
        latestRuntimeAt: null,
        latestRuntimeFreeUsdt: null
      });
    }

    for (const bot of bots) {
      const exchangeAccountId = bot.exchangeAccountId as string | null;
      if (!exchangeAccountId) continue;
      const current = aggregate.get(exchangeAccountId);
      if (!current) continue;

      if (bot.status === "running") current.running += 1;
      else if (bot.status === "error") current.error += 1;
      else current.stopped += 1;

      const lastSyncAt = deps.resolveLastSyncAt(bot.runtime);
      if (lastSyncAt && (!current.latestSyncAt || lastSyncAt.getTime() > current.latestSyncAt.getTime())) {
        current.latestSyncAt = lastSyncAt;
      }

      const runtimeUpdatedAt = bot.runtime?.updatedAt ?? null;
      if (runtimeUpdatedAt && (!current.latestRuntimeAt || runtimeUpdatedAt.getTime() > current.latestRuntimeAt.getTime())) {
        current.latestRuntimeAt = runtimeUpdatedAt;
        current.latestRuntimeFreeUsdt =
          typeof bot.runtime?.freeUsdt === "number" ? bot.runtime.freeUsdt : null;
      }
    }

    const now = Date.now();
    const alerts: any[] = [];

    for (const account of accounts) {
      const row = aggregate.get(account.id);
      const isPaper = deps.normalizeExchangeValue(String(account.exchange ?? "")) === "paper";
      const shouldEmitSyncHealthAlerts = !isPaper;
      const linkedMarketDataId = isPaper ? (paperBindings[account.id] ?? null) : null;
      const linkedMarketDataAccount = linkedMarketDataId
        ? accountById.get(linkedMarketDataId) ?? null
        : null;
      const linkedMarketDataAggregate = linkedMarketDataId
        ? aggregate.get(linkedMarketDataId) ?? null
        : null;
      const lastSyncAt =
        row?.latestSyncAt
        ?? linkedMarketDataAggregate?.latestSyncAt
        ?? linkedMarketDataAccount?.lastUsedAt
        ?? account.lastUsedAt
        ?? null;
      const hasBotActivity = ((row?.running ?? 0) + (row?.error ?? 0)) > 0;
      const status = isPaper
        ? "connected"
        : deps.computeConnectionStatus(lastSyncAt, hasBotActivity);

      if (shouldEmitSyncHealthAlerts && status === "disconnected") {
        const ts = lastSyncAt ?? new Date(now);
        alerts.push({
          id: deps.createDashboardAlertId(["API_DOWN", account.id, ts.toISOString()]),
          severity: "critical",
          type: "API_DOWN",
          title: `${account.exchange.toUpperCase()} · API disconnected`,
          message: `No healthy sync for account "${account.label}".`,
          exchange: account.exchange,
          exchangeAccountId: account.id,
          ts: ts.toISOString(),
          link: `/settings/exchange-accounts`
        });
      } else if (
        shouldEmitSyncHealthAlerts
        && hasBotActivity
        && lastSyncAt
        && now - lastSyncAt.getTime() > deps.DASHBOARD_ALERT_STALE_SYNC_MS
      ) {
        alerts.push({
          id: deps.createDashboardAlertId(["SYNC_FAIL", account.id, String(lastSyncAt.getTime())]),
          severity: "warning",
          type: "SYNC_FAIL",
          title: `${account.exchange.toUpperCase()} · Sync stale`,
          message: `Last successful sync is older than ${Math.round(deps.DASHBOARD_ALERT_STALE_SYNC_MS / 60000)} minutes.`,
          exchange: account.exchange,
          exchangeAccountId: account.id,
          ts: lastSyncAt.toISOString(),
          link: `/settings/exchange-accounts`
        });
      }

      if (account.lastSyncErrorMessage) {
        const ts = account.lastSyncErrorAt ?? lastSyncAt ?? new Date(now);
        alerts.push({
          id: deps.createDashboardAlertId(["SYNC_FAIL", account.id, account.lastSyncErrorMessage, ts.toISOString()]),
          severity: status === "disconnected" ? "critical" : "warning",
          type: "SYNC_FAIL",
          title: `${account.exchange.toUpperCase()} · Sync error`,
          message: account.lastSyncErrorMessage.slice(0, 220),
          exchange: account.exchange,
          exchangeAccountId: account.id,
          ts: ts.toISOString(),
          link: `/settings/exchange-accounts`
        });
      }

      const equity = deps.toFiniteNumber(account.futuresBudgetEquity);
      const availableMargin = deps.toFiniteNumber(
        row?.latestRuntimeFreeUsdt !== null && row?.latestRuntimeFreeUsdt !== undefined
          ? row.latestRuntimeFreeUsdt
          : account.futuresBudgetAvailableMargin
      );

      if (
        equity !== null &&
        equity > 0 &&
        availableMargin !== null &&
        availableMargin >= 0 &&
        availableMargin / equity < deps.DASHBOARD_MARGIN_WARN_RATIO
      ) {
        const ts = row?.latestRuntimeAt ?? lastSyncAt ?? new Date(now);
        const ratioPct = Math.max(0, Math.round((availableMargin / equity) * 100));
        alerts.push({
          id: deps.createDashboardAlertId(["MARGIN_WARN", account.id, String(ts.getTime()), String(ratioPct)]),
          severity: "warning",
          type: "MARGIN_WARN",
          title: `${account.exchange.toUpperCase()} · Low available margin`,
          message: `Available margin is at ${ratioPct}% of equity.`,
          exchange: account.exchange,
          exchangeAccountId: account.id,
          ts: ts.toISOString(),
          link: `/trade?exchangeAccountId=${encodeURIComponent(account.id)}`
        });
      }
    }

    for (const bot of bots) {
      if (bot.status !== "error") continue;
      const accountId = typeof bot.exchangeAccountId === "string" ? bot.exchangeAccountId : null;
      const account = accountId ? (accountById.get(accountId) as any) : null;
      const ts = bot.runtime?.lastErrorAt ?? bot.runtime?.updatedAt ?? bot.updatedAt ?? new Date(now);
      const message =
        bot.runtime?.lastErrorMessage ??
        bot.lastError ??
        bot.runtime?.lastError ??
        `Bot "${bot.name}" reported an execution error.`;
      alerts.push({
        id: deps.createDashboardAlertId(["BOT_ERROR", bot.id, ts.toISOString(), message]),
        severity: "warning",
        type: "BOT_ERROR",
        title: `Bot error · ${bot.name}`,
        message: String(message).slice(0, 220),
        exchange: account?.exchange,
        exchangeAccountId: accountId ?? undefined,
        botId: bot.id,
        ts: ts.toISOString(),
        link: accountId
          ? `/bots?exchangeAccountId=${encodeURIComponent(accountId)}&status=error`
          : `/bots?status=error`
      });
    }

    const circuitAlertByBot = new Map<string, any>();
    for (const event of circuitEvents) {
      if (circuitAlertByBot.has(event.botId)) continue;
      const account = event.bot?.exchangeAccount ?? null;
      const messageFromMeta =
        event.meta && typeof event.meta === "object" && "reason" in (event.meta as any)
          ? String((event.meta as any).reason ?? "")
          : "";
      const message =
        event.message ??
        (messageFromMeta || `Circuit breaker triggered for bot "${event.bot?.name ?? event.botId}".`);
      const alert = {
        id: deps.createDashboardAlertId(["CIRCUIT_BREAKER", event.botId, event.createdAt.toISOString()]),
        severity: "critical",
        type: "CIRCUIT_BREAKER",
        title: `Circuit breaker tripped · ${event.bot?.name ?? event.botId}`,
        message: message.slice(0, 220),
        exchange: account?.exchange ?? undefined,
        exchangeAccountId: account?.id ?? undefined,
        botId: event.botId,
        ts: event.createdAt.toISOString(),
        link: account?.id
          ? `/bots?exchangeAccountId=${encodeURIComponent(account.id)}&status=error`
          : `/bots?status=error`
      };
      circuitAlertByBot.set(event.botId, alert);
    }

    for (const alert of circuitAlertByBot.values()) {
      alerts.push(alert);
    }

    const aiPayloadAlert = deps.getAiPayloadBudgetAlertSnapshot();
    if (aiPayloadAlert.highWaterAlert) {
      alerts.push({
        id: deps.createDashboardAlertId([
          "AI_PAYLOAD_BUDGET",
          "high_water",
          String(aiPayloadAlert.highWaterConsecutive),
          String(aiPayloadAlert.lastHighWaterAt ?? "")
        ]),
        severity: "warning",
        type: "AI_PAYLOAD_BUDGET",
        title: "AI payload near budget limit",
        message:
          `AI prompt payload exceeded 90% budget for ${aiPayloadAlert.highWaterConsecutive}` +
          ` consecutive calls (threshold ${aiPayloadAlert.highWaterConsecutiveThreshold}).`,
        ts: aiPayloadAlert.lastHighWaterAt ?? new Date(now).toISOString(),
        link: "/settings/ai-trace"
      });
    }
    if (aiPayloadAlert.trimAlert) {
      alerts.push({
        id: deps.createDashboardAlertId([
          "AI_PAYLOAD_BUDGET",
          "trim_rate",
          String(aiPayloadAlert.trimCountLastHour),
          String(aiPayloadAlert.trimAlertThresholdPerHour)
        ]),
        severity: "critical",
        type: "AI_PAYLOAD_BUDGET",
        title: "AI payload trimming rate high",
        message:
          `Payload trimming happened ${aiPayloadAlert.trimCountLastHour} times in the last hour` +
          ` (threshold ${aiPayloadAlert.trimAlertThresholdPerHour}/h).`,
        ts: new Date(now).toISOString(),
        link: "/settings/ai-trace"
      });
    }

    alerts.sort((a, b) => {
      const severityDiff = deps.alertSeverityRank(b.severity) - deps.alertSeverityRank(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.ts).getTime() - new Date(a.ts).getTime();
    });

    return res.json({
      items: alerts.slice(0, limit)
    });
  });
}
