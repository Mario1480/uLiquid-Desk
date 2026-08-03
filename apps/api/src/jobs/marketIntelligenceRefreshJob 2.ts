import { logger } from "../logger.js";
import { getMarketIntelligenceService } from "../services/marketIntelligence/service.js";

type RefreshScope = "all" | "news" | "economic_calendar";

export type MarketIntelligenceRefreshStatus = {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastNewsRefreshAt: string | null;
  lastCalendarRefreshAt: string | null;
  lastNewsCount: number;
  lastEventCount: number;
  calendarReleaseDayMode: boolean;
  lastDegraded: boolean;
  lastWarnings: string[];
};

export function createMarketIntelligenceRefreshJob(db: any) {
  const service = getMarketIntelligenceService(db);
  const enabled = !["0", "false", "off", "no"].includes(
    String(process.env.MARKET_INTELLIGENCE_ENABLED ?? "true").trim().toLowerCase()
  );
  const pollMs = Math.max(30, Number(process.env.MARKET_INTELLIGENCE_POLL_SECONDS ?? "60")) * 1000;
  const newsIntervalMs = Math.max(5, Number(process.env.RSS_NEWS_REFRESH_MINUTES ?? "10")) * 60 * 1000;
  const calendarIntervalMs = Math.max(15, Number(process.env.OFFICIAL_CALENDAR_REFRESH_MINUTES ?? "360")) * 60 * 1000;
  const calendarReleaseDayIntervalMs = Math.max(
    5,
    Number(process.env.OFFICIAL_CALENDAR_RELEASE_DAY_REFRESH_MINUTES ?? "15")
  ) * 60 * 1000;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let lastStartedAt: Date | null = null;
  let lastFinishedAt: Date | null = null;
  let lastError: string | null = null;
  let lastErrorAt: Date | null = null;
  let lastNewsRefreshAt: Date | null = null;
  let lastCalendarRefreshAt: Date | null = null;
  let lastNewsCount = 0;
  let lastEventCount = 0;
  let calendarReleaseDayMode = false;
  let lastDegraded = false;
  let lastWarnings: string[] = [];

  async function runCycle(
    reason: "startup" | "scheduled" | "manual" = "scheduled",
    scope: RefreshScope = "all"
  ) {
    if (!enabled || running) return;
    running = true;
    lastStartedAt = new Date();
    try {
      const now = Date.now();
      const refreshNews = scope === "news" || scope === "all" && (
        reason !== "scheduled" || !lastNewsRefreshAt || now - lastNewsRefreshAt.getTime() >= newsIntervalMs
      );
      const refreshCalendar = scope === "economic_calendar" || scope === "all" && (
        reason !== "scheduled"
        || !lastCalendarRefreshAt
        || now - lastCalendarRefreshAt.getTime() >= (
          calendarReleaseDayMode ? calendarReleaseDayIntervalMs : calendarIntervalMs
        )
      );
      const [news, calendar] = await Promise.all([
        refreshNews ? service.refreshNews() : Promise.resolve(null),
        refreshCalendar ? service.refreshEconomicEvents() : Promise.resolve(null)
      ]);
      if (news) {
        lastNewsRefreshAt = new Date();
        lastNewsCount = news.fetchedCount;
      }
      if (calendar) {
        lastCalendarRefreshAt = new Date();
        lastEventCount = calendar.fetchedCount;
        try {
          const releaseWindow = await service.getEconomicEvents({
            from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            importance: ["high"],
            limit: 1
          });
          calendarReleaseDayMode = releaseWindow.data.length > 0;
        } catch {
          // Keep the previous cadence decision if the local calendar read fails.
        }
      }
      lastDegraded = Boolean(news?.degraded || calendar?.degraded);
      lastWarnings = [...new Set([...(news?.warnings ?? []), ...(calendar?.warnings ?? [])])].slice(0, 20);
      lastError = null;
      lastErrorAt = null;
      logger.info("market_intelligence_refresh_cycle", {
        reason,
        scope,
        news_count: news?.fetchedCount ?? null,
        event_count: calendar?.fetchedCount ?? null,
        degraded: lastDegraded,
        warning_count: lastWarnings.length
      });
    } catch (error) {
      lastError = String(error);
      lastErrorAt = new Date();
      logger.warn("market_intelligence_refresh_failed", { reason, scope, error: lastError });
    } finally {
      lastFinishedAt = new Date();
      running = false;
    }
  }

  function start() {
    if (!enabled || timer) return;
    timer = setInterval(() => void runCycle("scheduled", "all"), pollMs);
    void runCycle("startup", "all");
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus(): MarketIntelligenceRefreshStatus {
    return {
      enabled,
      running,
      pollMs,
      lastStartedAt: lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: lastFinishedAt?.toISOString() ?? null,
      lastError,
      lastErrorAt: lastErrorAt?.toISOString() ?? null,
      lastNewsRefreshAt: lastNewsRefreshAt?.toISOString() ?? null,
      lastCalendarRefreshAt: lastCalendarRefreshAt?.toISOString() ?? null,
      lastNewsCount,
      lastEventCount,
      calendarReleaseDayMode,
      lastDegraded,
      lastWarnings
    };
  }

  return { runCycle, start, stop, getStatus };
}
