"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";

type Document<T> = { value: T; revision: string | null };
type Checklist = {
  text: string;
  checklist: { id: string; text: string; done: boolean }[];
};
type Alert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  target: number;
  enabled: boolean;
  triggeredAt: string | null;
};
type AlertData = Document<{ items: Alert[] }> & {
  quotes: { symbol: string; price: number }[];
  degraded: boolean;
  fetchedAt: string;
};
type Trade = {
  id: string;
  source?: "bot" | "manual";
  symbol: string;
  side: string;
  entryAt: string;
  exitAt: string;
  pnl: number | null;
  fees: number | null;
  note: string;
};
type JournalDocument = { manual: Trade[]; notes: Record<string, string> };
type Summary = {
  trades: number;
  pnl: number | null;
  fees: number | null;
  net: number | null;
  winRate: number | null;
};
type Journal = {
  items: Trade[];
  summaries: Record<"all" | "bot" | "manual", { day: Summary; week: Summary }>;
  truncated: boolean;
  fetchedAt: string;
  document: Document<JournalDocument>;
};
const symbols = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "SUIUSDT",
  "LTCUSDT",
  "DOTUSDT"
];

export function WorkbenchFrame({
  title,
  children,
  actions
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card dashboardInsightCard dashboardWorkbenchCard dashboardWidgetCardFill">
      <div className="dashboardCompactWidgetHead">
        <div className="dashboardCompactWidgetTitle">{title}</div>
        {actions}
      </div>
      <div className="dashboardWidgetScrollArea dashboardWorkbenchBody">
        {children}
      </div>
    </div>
  );
}

function useLabels() {
  const t = useTranslations("dashboard.workbench");
  const locale = useLocale();
  const money = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? "—"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2
        }).format(value);
  const date = (value: string) =>
    new Date(value).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  const price = (value: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(value)} USDT`;
  return { t, money, date, price };
}

function useJournal(autoRefresh = false) {
  const [data, setData] = useState<Journal | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await apiGet<Journal>("/dashboard/trade-journal");
      if (alive.current) {
        setData(next);
        setError(false);
      }
    } catch {
      if (alive.current) setError(true);
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = autoRefresh ? window.setInterval(refresh, 60000) : null;
    if (autoRefresh)
      window.addEventListener("dashboard:journal-updated", refresh);
    return () => {
      alive.current = false;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("dashboard:journal-updated", refresh);
    };
  }, [load, autoRefresh]);
  return { data, error, loading, load };
}

export function NotesWidget() {
  const { t } = useLabels();
  const [doc, setDoc] = useState<Document<Checklist> | null>(null);
  const [draft, setDraft] = useState<Checklist>({ text: "", checklist: [] });
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    apiGet<Document<Checklist>>("/dashboard/workbench/notes")
      .then((value) => {
        if (active) {
          setDoc(value);
          setDraft(value.value);
        }
      })
      .catch(() => {
        if (active) setError("loadError");
      });
    return () => {
      active = false;
    };
  }, []);
  function edit(value: Checklist) {
    setDraft(value);
    setSaved(false);
  }
  async function save() {
    if (!doc) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await apiPut<Document<Checklist>>(
        "/dashboard/workbench/notes",
        { value: draft, revision: doc.revision }
      );
      setDoc(next);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? "conflict" : "saveError"
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshRevision() {
    setBusy(true);
    try {
      const next = await apiGet<Document<Checklist>>(
        "/dashboard/workbench/notes"
      );
      setDoc(next);
      setDraft(next.value);
      setSaved(false);
      setError("");
    } catch {
      setError("loadError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkbenchFrame
      title={t("notes.title")}
      actions={
        <button
          className="btn btnPrimary"
          disabled={busy || !doc}
          onClick={() => void save()}
        >
          <AppIcon name="save" />
          {t("save")}
        </button>
      }
    >
      <textarea
        className="input dashboardWorkbenchTextarea"
        aria-label={t("notes.text")}
        placeholder={t("notes.text")}
        value={draft.text}
        maxLength={10000}
        disabled={busy || !doc}
        onChange={(e) => edit({ ...draft, text: e.target.value })}
      />
      {draft.checklist.map((item) => (
        <div className="dashboardWorkbenchRow" key={item.id}>
          <label className="dashboardWorkbenchCheck">
            <input
              type="checkbox"
              checked={item.done}
              disabled={busy}
              onChange={() =>
                edit({
                  ...draft,
                  checklist: draft.checklist.map((row) =>
                    row.id === item.id ? { ...row, done: !row.done } : row
                  )
                })
              }
            />
            <span>{item.text}</span>
          </label>
          <button
            className="btn"
            disabled={busy}
            aria-label={t("remove")}
            onClick={() =>
              edit({
                ...draft,
                checklist: draft.checklist.filter((row) => row.id !== item.id)
              })
            }
          >
            <AppIcon name="remove" />
          </button>
        </div>
      ))}
      <form
        className="dashboardWorkbenchRow"
        onSubmit={(e) => {
          e.preventDefault();
          if (!line.trim() || draft.checklist.length >= 30) return;
          edit({
            ...draft,
            checklist: [
              ...draft.checklist,
              { id: crypto.randomUUID(), text: line.trim(), done: false }
            ]
          });
          setLine("");
        }}
      >
        <input
          className="input"
          value={line}
          maxLength={300}
          aria-label={t("notes.item")}
          placeholder={t("notes.item")}
          disabled={busy || !doc}
          onChange={(e) => setLine(e.target.value)}
        />
        <button
          className="btn"
          disabled={
            busy || !doc || !line.trim() || draft.checklist.length >= 30
          }
        >
          <AppIcon name="add" />
          {t("add")}
        </button>
      </form>
      {saved ? <span role="status">{t("saved")}</span> : null}
      {error ? (
        <div role="alert" className="dashboardWidgetInlineError">
          {t(error)}{" "}
          <button
            className="btn"
            disabled={busy}
            onClick={() => void refreshRevision()}
          >
            <AppIcon name="refresh" />
            {t("reloadRevision")}
          </button>
        </div>
      ) : null}
    </WorkbenchFrame>
  );
}

export function PriceAlertsWidget() {
  const { t, price: formatPrice, date } = useLabels();
  const [data, setData] = useState<AlertData | null>(null);
  const [symbol, setSymbol] = useState(symbols[0]);
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const next = await apiPost<AlertData>("/dashboard/price-alerts/check");
      if (alive.current) {
        setData(next);
        setError("");
      }
    } catch {
      if (alive.current) setError("loadError");
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void check();
    const timer = window.setInterval(() => {
      if (!document.hidden) void check();
    }, 15000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [check]);
  async function persist(items: Alert[]) {
    if (!data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const doc = await apiPut<Document<{ items: Alert[] }>>(
        "/dashboard/workbench/price-alerts",
        { value: { items }, revision: data.revision }
      );
      setData({ ...data, ...doc });
      setTarget("");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? "conflict" : "saveError"
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkbenchFrame
      title={t("priceAlerts.title")}
      actions={
        <button className="btn" disabled={busy} onClick={() => void check()}>
          <AppIcon name="refresh" />
          {t("refresh")}
        </button>
      }
    >
      <form
        className="dashboardWorkbenchForm"
        onSubmit={(e) => {
          e.preventDefault();
          if (Number(target) > 0)
            void persist([
              ...(data?.value.items ?? []),
              {
                id: crypto.randomUUID(),
                symbol,
                direction,
                target: Number(target),
                enabled: true,
                triggeredAt: null
              }
            ]);
        }}
      >
        <select
          className="input"
          aria-label={t("symbol")}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        >
          {symbols.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="input"
          aria-label={t("priceAlerts.direction")}
          value={direction}
          onChange={(e) => setDirection(e.target.value as "above" | "below")}
        >
          <option value="above">{t("priceAlerts.above")}</option>
          <option value="below">{t("priceAlerts.below")}</option>
        </select>
        <input
          className="input"
          type="number"
          step="any"
          min="0.00000001"
          max="1000000000000"
          required
          aria-label={t("priceAlerts.target")}
          placeholder={t("priceAlerts.target")}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button
          className="btn btnPrimary"
          disabled={!data || busy || (data?.value.items.length ?? 0) >= 20}
        >
          <AppIcon name="add" />
          {t("add")}
        </button>
      </form>
      <div className="dashboardCompactWidgetSubtitle">
        {t("priceAlerts.scope")}
      </div>
      <div aria-live="polite">
        {data?.value.items.map((item) => {
          const price = data.quotes.find(
            (quote) => quote.symbol === item.symbol
          )?.price;
          const distance =
            price && !data.degraded
              ? (Math.abs(item.target - price) / price) * 100
              : null;
          return (
            <div className="dashboardWorkbenchRow" key={item.id}>
              <div>
                <strong>{item.symbol}</strong>
                <div>
                  {item.direction === "above" ? "≥" : "≤"}{" "}
                  {formatPrice(item.target)}{" "}
                  <small>
                    {distance === null ? "—" : `${distance.toFixed(2)}%`}
                  </small>
                </div>
                <small>
                  {item.triggeredAt
                    ? `${t("priceAlerts.triggered")} · ${date(item.triggeredAt)}`
                    : t(
                        item.enabled
                          ? "priceAlerts.armed"
                          : "priceAlerts.paused"
                      )}
                </small>
              </div>
              <div className="dashboardWorkbenchActions">
                <button
                  className="btn"
                  disabled={busy}
                  aria-label={t(
                    item.triggeredAt
                      ? "priceAlerts.rearm"
                      : item.enabled
                        ? "priceAlerts.pause"
                        : "priceAlerts.enable"
                  )}
                  onClick={() =>
                    void persist(
                      data.value.items.map((row) =>
                        row.id === item.id
                          ? {
                              ...row,
                              enabled: row.triggeredAt ? true : !row.enabled,
                              triggeredAt: null
                            }
                          : row
                      )
                    )
                  }
                >
                  <AppIcon
                    name={
                      item.triggeredAt
                        ? "refresh"
                        : item.enabled
                          ? "pause"
                          : "play"
                    }
                  />
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  aria-label={t("remove")}
                  onClick={() =>
                    void persist(
                      data.value.items.filter((row) => row.id !== item.id)
                    )
                  }
                >
                  <AppIcon name="remove" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {data?.value.items.length === 0 ? (
        <div>{t("priceAlerts.empty")}</div>
      ) : null}
      {!data && !error ? <div>{t("loading")}</div> : null}
      {data?.degraded ? (
        <div role="status" className="dashboardWidgetInlineError">
          {t("delayed")}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="dashboardWidgetInlineError">
          {t(error)}
        </div>
      ) : null}
    </WorkbenchFrame>
  );
}

export function TradingSummaryWidget() {
  const { t, money, date } = useLabels();
  const { data, error, loading, load } = useJournal(true);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [source, setSource] = useState<"all" | "bot" | "manual">("all");
  const summary = data?.summaries[source][period];
  return (
    <WorkbenchFrame
      title={t("tradingSummary.title")}
      actions={
        <button className="btn" disabled={loading} onClick={() => void load()}>
          <AppIcon name="refresh" />
          {t("refresh")}
        </button>
      }
    >
      <div className="dashboardWorkbenchRow">
        <select
          className="input"
          aria-label={t("period")}
          value={period}
          onChange={(e) => setPeriod(e.target.value as "day" | "week")}
        >
          <option value="day">{t("day")}</option>
          <option value="week">{t("week")}</option>
        </select>
        <select
          className="input"
          aria-label={t("source")}
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          {["all", "bot", "manual"].map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </div>
      {summary ? (
        <div className="dashboardWorkbenchMetrics">
          {(["pnl", "fees", "net", "trades", "winRate"] as const).map((key) => (
            <div className="uiMetricTile" key={key}>
              <span>{t(`tradingSummary.${key}`)}</span>
              <strong>
                {key === "trades"
                  ? summary[key]
                  : key === "winRate"
                    ? summary[key] === null
                      ? "—"
                      : `${summary[key]!.toFixed(1)}%`
                    : money(summary[key])}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <div>{t(loading ? "loading" : "loadError")}</div>
      )}
      <small>{t("journal.coverage")}</small>
      {summary?.fees === null ? (
        <small>{t("tradingSummary.unknownFees")}</small>
      ) : null}
      {data?.truncated ? (
        <div className="dashboardWidgetInlineError">{t("truncated")}</div>
      ) : null}
      {error ? (
        <div className="dashboardWidgetInlineError">{t("loadError")}</div>
      ) : null}
      {data ? (
        <small>{t("updated", { time: date(data.fetchedAt) })}</small>
      ) : null}
    </WorkbenchFrame>
  );
}

export function TradeJournalWidget() {
  const { t, money, date } = useLabels();
  const { data, error, loading, load } = useJournal();
  const [source, setSource] = useState("all");
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  async function persist(value: JournalDocument) {
    if (!data) return;
    setBusy(true);
    setSaveError("");
    try {
      await apiPut("/dashboard/workbench/journal", {
        value,
        revision: data.document.revision
      });
      setEditor(false);
      setNote(null);
      window.dispatchEvent(new Event("dashboard:journal-updated"));
      await load();
    } catch (e) {
      setSaveError(
        e instanceof ApiError && e.status === 409 ? "conflict" : "saveError"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkbenchFrame
      title={t("tradeJournal.title")}
      actions={
        <div className="dashboardWorkbenchActions">
          <button
            className="btn"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            <AppIcon name="refresh" />
            {t("refresh")}
          </button>
          <button
            className="btn"
            disabled={!data || busy}
            onClick={() => setEditor(!editor)}
          >
            <AppIcon name="add" />
            {t("manual")}
          </button>
        </div>
      }
    >
      <select
        className="input"
        aria-label={t("source")}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      >
        {["all", "bot", "manual"].map((s) => (
          <option key={s} value={s}>
            {t(s)}
          </option>
        ))}
      </select>
      <small>{t("journal.coverage")}</small>
      {editor ? (
        <form
          className="dashboardWorkbenchForm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!data) return;
            const fields = new FormData(e.currentTarget);
            const entryAt = new Date(
              String(fields.get("entryAt"))
            ).toISOString();
            const exitAt = new Date(String(fields.get("exitAt"))).toISOString();
            if (entryAt > exitAt || Date.parse(exitAt) > Date.now()) {
              setSaveError("journal.invalidDates");
              return;
            }
            const row: Trade = {
              id: crypto.randomUUID(),
              symbol: String(fields.get("symbol")).toUpperCase(),
              side: String(fields.get("side")),
              entryAt,
              exitAt,
              pnl: Number(fields.get("pnl")),
              fees:
                fields.get("fees") === "" ? null : Number(fields.get("fees")),
              note: String(fields.get("note"))
            };
            void persist({
              ...data.document.value,
              manual: [...data.document.value.manual, row]
            });
          }}
        >
          <label>
            {t("symbol")}
            <input className="input" name="symbol" maxLength={32} required />
          </label>
          <label>
            {t("side")}
            <select className="input" name="side">
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label>
            {t("journal.entry")}
            <input
              className="input"
              name="entryAt"
              type="datetime-local"
              required
            />
          </label>
          <label>
            {t("journal.exit")}
            <input
              className="input"
              name="exitAt"
              type="datetime-local"
              required
            />
          </label>
          <label>
            {t("journal.grossPnl")}
            <input
              className="input"
              name="pnl"
              type="number"
              step="any"
              required
            />
          </label>
          <label>
            {t("tradingSummary.fees")}
            <input
              className="input"
              name="fees"
              type="number"
              step="any"
              min="0"
            />
          </label>
          <label>
            {t("journal.note")}
            <input className="input" name="note" maxLength={2000} />
          </label>
          <button
            className="btn btnPrimary"
            disabled={busy || (data?.document.value.manual.length ?? 0) >= 200}
          >
            <AppIcon name="save" />
            {t("save")}
          </button>
        </form>
      ) : null}
      {data?.items
        .filter((row) => source === "all" || row.source === source)
        .map((row) => (
          <div
            key={`${row.source}:${row.id}`}
            className="dashboardWorkbenchTrade"
          >
            <div className="dashboardWorkbenchRow">
              <strong>
                {row.symbol} · {row.side}
              </strong>
              <strong
                className={
                  row.pnl != null && row.pnl < 0 ? "dashboardValueNegative" : ""
                }
              >
                {money(row.pnl)}
              </strong>
            </div>
            <div className="dashboardWorkbenchRow">
              <small>
                {t(row.source ?? "manual")} · {date(row.exitAt)} ·{" "}
                {Math.max(
                  0,
                  Math.round(
                    (Date.parse(row.exitAt) - Date.parse(row.entryAt)) / 60000
                  )
                )}{" "}
                min
              </small>
              <div className="dashboardWorkbenchActions">
                <button
                  className="btn"
                  disabled={busy}
                  aria-label={t("journal.note")}
                  onClick={() => setNote({ id: row.id, text: row.note })}
                >
                  <AppIcon name="edit" />
                </button>
                {row.source === "manual" ? (
                  <button
                    className="btn"
                    disabled={busy}
                    aria-label={t("remove")}
                    onClick={() => {
                      if (data)
                        void persist({
                          ...data.document.value,
                          manual: data.document.value.manual.filter(
                            (item) => item.id !== row.id
                          )
                        });
                    }}
                  >
                    <AppIcon name="remove" />
                  </button>
                ) : null}
              </div>
            </div>
            {note?.id === row.id ? (
              <form
                className="dashboardWorkbenchRow"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!data) return;
                  const value = data.document.value;
                  void persist(
                    row.source === "manual"
                      ? {
                          ...value,
                          manual: value.manual.map((item) =>
                            item.id === row.id
                              ? { ...item, note: note.text }
                              : item
                          )
                        }
                      : {
                          ...value,
                          notes: { ...value.notes, [row.id]: note.text }
                        }
                  );
                }}
              >
                <input
                  className="input"
                  aria-label={t("journal.note")}
                  maxLength={2000}
                  value={note.text}
                  onChange={(e) => setNote({ ...note, text: e.target.value })}
                />
                <button className="btn" disabled={busy}>
                  <AppIcon name="save" />
                  {t("save")}
                </button>
              </form>
            ) : row.note ? (
              <p>{row.note}</p>
            ) : null}
          </div>
        ))}
      {data &&
      !data.items.some((row) => source === "all" || row.source === source) ? (
        <div>{t("journal.empty")}</div>
      ) : null}
      {loading && !data ? <div>{t("loading")}</div> : null}
      {error || saveError ? (
        <div role="alert" className="dashboardWidgetInlineError">
          {t(saveError || "loadError")}
        </div>
      ) : null}
      {data?.truncated ? (
        <div className="dashboardWidgetInlineError">{t("truncated")}</div>
      ) : null}
    </WorkbenchFrame>
  );
}
