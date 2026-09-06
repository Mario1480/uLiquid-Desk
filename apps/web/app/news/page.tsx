"use client";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiGet } from "../../lib/api";
import { AppIcon } from "../components/AppIcon";
import { PageHeader } from "../components/ui";

type NewsMode = "all" | "crypto" | "general";
type NewsFeed = "crypto" | "general";

type NewsItem = {
  id: string;
  source: string;
  feed: NewsFeed;
  title: string;
  url: string;
  site: string | null;
  publishedAt: string;
  imageUrl: string | null;
  symbol: string | null;
  text: string | null;
};

type NewsResponse = {
  items: NewsItem[];
  meta: {
    mode: NewsMode;
    page: number;
    limit: number;
    cache: "hit" | "miss";
    fetchedAt: string;
    partial?: boolean;
    searchQuery?: string;
    searchApplied?: boolean;
    searchFallback?: boolean;
    degraded?: boolean;
    stale?: boolean;
    warnings?: string[];
    providerStates?: Array<{ providerId: string; state: string; message?: string }>;
  };
};

function errMsg(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (HTTP ${error.status})`;
  if (error && typeof error === "object" && "message" in error) return String((error as any).message);
  return String(error);
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function toLocalDayBoundaryIso(dateInput: string, boundary: "start" | "end"): string | null {
  if (!dateInput) return null;
  const [yearRaw, monthRaw, dayRaw] = dateInput.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const localDate =
    boundary === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate.toISOString();
}

export default function NewsPage() {
  const t = useTranslations("system.news");
  const locale = useLocale();
  void locale;
  const [mode, setMode] = useState<NewsMode>("all");
  const [limit, setLimit] = useState(20);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(() => toDateInput(addDays(new Date(), -7)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [items, setItems] = useState<NewsItem[]>([]);
  const [meta, setMeta] = useState<NewsResponse["meta"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("limit", String(limit));
    params.set("page", String(page));
    const queryRaw = search.trim();
    if (queryRaw) params.set("q", queryRaw);
    const fromTs = toLocalDayBoundaryIso(from, "start");
    const toTs = toLocalDayBoundaryIso(to, "end");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (fromTs) params.set("fromTs", fromTs);
    if (toTs) params.set("toTs", toTs);
    return params.toString();
  }, [mode, limit, page, search, from, to]);

  function formatLocalDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<NewsResponse>(`/news?${query}`);
      const nextItems = Array.isArray(response.items) ? response.items : [];
      if (page > 1 && nextItems.length === 0) {
        setPage(1);
      }
      setItems(nextItems);
      setMeta(response.meta ?? null);
    } catch (e) {
      setError(errMsg(e));
      setItems([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="newsPage newsProPage">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <DeskSurface><div className="card newsFilterCard newsProControls">
        <div className="newsProTabRow">
          <DeskButton
            type="button"
            className={`newsProTab ${mode === "all" ? "newsProTabActive" : ""}`}
            onClick={() => {
              setMode("all");
              setPage(1);
            }}
            aria-pressed={mode === "all"}
          >
            {t("tabs.all")}
          </DeskButton>
          <DeskButton
            type="button"
            className={`newsProTab ${mode === "crypto" ? "newsProTabActive" : ""}`}
            onClick={() => {
              setMode("crypto");
              setPage(1);
            }}
            aria-pressed={mode === "crypto"}
          >
            {t("tabs.crypto")}
          </DeskButton>
          <DeskButton
            type="button"
            className={`newsProTab ${mode === "general" ? "newsProTabActive" : ""}`}
            onClick={() => {
              setMode("general");
              setPage(1);
            }}
            aria-pressed={mode === "general"}
          >
            {t("tabs.general")}
          </DeskButton>
          <DeskButton
            type="button"
            className="btn newsProTabRefresh"
            onClick={() => void load()}
          >
            <AppIcon name="refresh" />
            {t("actions.refresh")}
          </DeskButton>
        </div>

        <div className="newsFilterGrid newsProFilterGrid">
          <label className="newsFilterField">
            <div className="newsProFilterLabel">{t("filters.limit")}</div>
            <DeskSelect
              className="input"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </DeskSelect>
          </label>

          <label className="newsFilterField">
            <div className="newsProFilterLabel">{t("filters.page")}</div>
            <DeskSelect className="input" value={page} onChange={(event) => setPage(Number(event.target.value))}>
              {Array.from({ length: 6 }).map((_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </DeskSelect>
          </label>

          <label className="newsFilterField">
            <div className="newsProFilterLabel">{t("filters.search")}</div>
            <DeskInput
              className="input"
              placeholder={t("filters.searchPlaceholder")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="newsFilterField">
            <div className="newsProFilterLabel">{t("filters.from")}</div>
            <DeskInput
              className="input"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="newsFilterField">
            <div className="newsProFilterLabel">{t("filters.to")}</div>
            <DeskInput
              className="input"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
      </div></DeskSurface>

      {meta ? (
        <DeskSurface><div className="card newsMetaCard newsProStatusStrip">
          <div className="newsProStatusTitle">{t("meta.mode")}: {meta.mode}</div>
          <div className="newsProStatusMeta">
            <span className="newsProStatusTag">{t("meta.cache")}: {meta.cache}</span>
            {meta.searchApplied && meta.searchQuery ? (
              <span className="newsProStatusTag">{t("meta.search")}: {meta.searchQuery}</span>
            ) : null}
            {meta.searchFallback ? (
              <span className="newsProStatusTag">{t("meta.searchFallback")}</span>
            ) : null}
            <span className="newsProStatusTag">
              {t("meta.fetchedAt")}: {formatLocalDateTime(meta.fetchedAt)}
            </span>
            {meta.partial ? (
              <span className="newsProStatusTag">{t("meta.partial")}</span>
            ) : null}
          </div>
        </div></DeskSurface>
      ) : null}

      {error ? (
        <DeskSurface><div className="card newsErrorCard newsProErrorCard">{t("loadError")}: {error}</div></DeskSurface>
      ) : null}

      <DeskSurface><div className="card newsListCard newsProListCard">
        {loading ? (
          <div className="newsProStateText">{t("loading")}</div>
        ) : items.length === 0 ? (
          <div className="newsProStateText">{t("empty")}</div>
        ) : (
          <div className="newsList newsProList">
            {items.map((item) => (
              <DeskSurface><article className="card newsItemCard newsProItemCard" key={item.id}>
                <div className="newsItemContent">
                  <div className="newsItemHeader newsProItemHeader">
                    <span className={`badge ${item.feed === "crypto" ? "newsBadgeCrypto" : "newsBadgeGeneral"}`}>
                      {item.feed === "crypto" ? t("feed.crypto") : t("feed.general")}
                    </span>
                    {item.symbol ? <span className="badge">{item.symbol}</span> : null}
                    <span className="newsItemTime newsProItemTime">
                      {formatLocalDateTime(item.publishedAt)}
                    </span>
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer" className="newsItemTitle newsProItemTitle">
                    {item.title}
                  </a>
                  {item.site ? <div className="newsItemSite">{item.site}</div> : null}
                  {item.text ? <p className="newsItemText newsProItemText">{item.text}</p> : null}
                </div>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} className="newsItemImage" loading="lazy" />
                ) : null}
              </article></DeskSurface>
            ))}
          </div>
        )}
      </div></DeskSurface>
    </div>
  );
}
