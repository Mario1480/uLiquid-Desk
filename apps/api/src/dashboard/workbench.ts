import type express from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";
import {
  DASHBOARD_WATCHLIST_SYMBOLS,
  loadDashboardWatchlistQuotes
} from "./widgets.js";

const id = z.string().uuid();
const text = z.string().trim().max(2000);
const alertSchema = z.object({
  id,
  symbol: z.enum(DASHBOARD_WATCHLIST_SYMBOLS),
  direction: z.enum(["above", "below"]),
  target: z.number().finite().positive().max(1e12),
  enabled: z.boolean(),
  triggeredAt: z.string().datetime().nullable().default(null)
});
const manualTradeSchema = z
  .object({
    id,
    symbol: z.string().trim().min(1).max(32),
    side: z.enum(["long", "short"]),
    entryAt: z.string().datetime(),
    exitAt: z.string().datetime(),
    pnl: z.number().finite(),
    fees: z.number().finite().nonnegative().nullable(),
    note: text
  })
  .refine(
    (trade) =>
      Date.parse(trade.exitAt) >= Date.parse(trade.entryAt) &&
      Date.parse(trade.exitAt) <= Date.now(),
    { message: "invalid_trade_dates" }
  );
const schemas = {
  notes: z.object({
    text: z.string().max(10000),
    checklist: z
      .array(
        z.object({
          id,
          text: z.string().trim().min(1).max(300),
          done: z.boolean()
        })
      )
      .max(30)
  }),
  "price-alerts": z.object({ items: z.array(alertSchema).max(20) }),
  journal: z.object({
    manual: z.array(manualTradeSchema).max(200),
    notes: z
      .record(z.string().max(128), text)
      .refine((rows) => Object.keys(rows).length <= 200)
  })
};
const defaults = {
  notes: { text: "", checklist: [] },
  "price-alerts": { items: [] },
  journal: { manual: [], notes: {} }
};
type Section = keyof typeof schemas;
const sectionSchema = z.enum(["notes", "price-alerts", "journal"]);
const keyFor = (userId: string, section: Section) =>
  `dashboard_workbench:${userId}:${section}`;
type Database = any;

async function readDocument(db: Database, userId: string, section: Section) {
  const row = await db.globalSetting.findUnique({
    where: { key: keyFor(userId, section) }
  });
  const parsed = schemas[section].safeParse(row?.value);
  return {
    value: parsed.success ? parsed.data : defaults[section],
    revision: row?.updatedAt?.toISOString() ?? null
  };
}

export function alertReached(
  direction: "above" | "below",
  target: number,
  price: number
) {
  return (
    Number.isFinite(price) &&
    price > 0 &&
    (direction === "above" ? price >= target : price <= target)
  );
}

export type JournalTrade = {
  id: string;
  source: "bot" | "manual";
  symbol: string;
  side: string;
  entryAt: string;
  exitAt: string;
  pnl: number | null;
  fees: number | null;
  note: string;
};

export function summarizeTrades(rows: JournalTrade[]) {
  const known = rows.filter((row) => row.pnl !== null);
  const pnl = known.reduce((sum, row) => sum + row.pnl!, 0);
  const complete = known.length === rows.length;
  const feesComplete = rows.every((row) => row.fees !== null);
  const fees = feesComplete
    ? rows.reduce((sum, row) => sum + row.fees!, 0)
    : null;
  return {
    trades: rows.length,
    pnl: complete ? pnl : null,
    fees,
    net: complete && fees !== null ? pnl - fees : null,
    winRate:
      known.length && complete
        ? (known.filter((row) => row.pnl! > 0).length / known.length) * 100
        : null
  };
}

export function registerDashboardWorkbenchRoutes(
  app: express.Express,
  db: Database,
  loadQuotes = loadDashboardWatchlistQuotes
) {
  app.get("/dashboard/workbench/:section", requireAuth, async (req, res) => {
    const section = sectionSchema.safeParse(req.params.section);
    if (!section.success) return res.status(404).json({ error: "not_found" });
    try {
      return res.json(
        await readDocument(db, getUserFromLocals(res).id, section.data)
      );
    } catch {
      return res.status(500).json({ error: "dashboard_document_unavailable" });
    }
  });

  app.put("/dashboard/workbench/:section", requireAuth, async (req, res) => {
    const section = sectionSchema.safeParse(req.params.section);
    if (!section.success) return res.status(404).json({ error: "not_found" });
    const envelope = z
      .object({
        value: z.unknown(),
        revision: z.string().datetime().nullable()
      })
      .safeParse(req.body);
    const parsed = schemas[section.data].safeParse(
      envelope.success ? envelope.data.value : null
    );
    if (!envelope.success || !parsed.success)
      return res.status(400).json({ error: "invalid_payload" });
    const value = parsed.data;
    const ids =
      "items" in value
        ? value.items.map((item) => item.id)
        : "checklist" in value
          ? value.checklist.map((item) => item.id)
          : value.manual.map((item) => item.id);
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: "duplicate_id" });
    const key = keyFor(getUserFromLocals(res).id, section.data);
    try {
      if (envelope.data.revision === null) {
        await db.globalSetting.create({ data: { key, value } });
      } else {
        const result = await db.globalSetting.updateMany({
          where: { key, updatedAt: new Date(envelope.data.revision) },
          data: {
            value,
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(envelope.data.revision) + 1)
            )
          }
        });
        if (!result.count)
          return res.status(409).json({ error: "dashboard_document_conflict" });
      }
      return res.json(
        await readDocument(db, getUserFromLocals(res).id, section.data)
      );
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        return res.status(409).json({ error: "dashboard_document_conflict" });
      return res.status(500).json({ error: "dashboard_document_save_failed" });
    }
  });

  app.post("/dashboard/price-alerts/check", requireAuth, async (_req, res) => {
    const userId = getUserFromLocals(res).id;
    try {
      const document = await readDocument(db, userId, "price-alerts");
      const { items } = schemas["price-alerts"].parse(document.value);
      const symbols = [
        ...new Set(
          items.filter((item) => item.enabled).map((item) => item.symbol)
        )
      ];
      const quotes = symbols.length
        ? await loadQuotes(symbols)
        : { items: [], fetchedAt: new Date().toISOString(), degraded: false };
      const fresh =
        !quotes.degraded && Date.now() - Date.parse(quotes.fetchedAt) < 60000;
      let changed = false;
      const checked = items.map((item) => {
        const price =
          quotes.items.find((quote) => quote.symbol === item.symbol)?.price ??
          null;
        if (
          item.enabled &&
          !item.triggeredAt &&
          fresh &&
          price !== null &&
          alertReached(item.direction, item.target, price)
        ) {
          changed = true;
          return { ...item, triggeredAt: new Date().toISOString() };
        }
        return item;
      });
      if (changed) {
        const saved = await db.globalSetting.updateMany({
          where: {
            key: keyFor(userId, "price-alerts"),
            updatedAt: new Date(document.revision!)
          },
          data: {
            value: { items: checked },
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(document.revision!) + 1)
            )
          }
        });
        if (!saved.count)
          return res.status(409).json({ error: "dashboard_document_conflict" });
      }
      return res.json({
        ...(await readDocument(db, userId, "price-alerts")),
        quotes: quotes.items,
        fetchedAt: quotes.fetchedAt,
        degraded: !fresh
      });
    } catch {
      return res
        .status(500)
        .json({ error: "dashboard_price_alerts_unavailable" });
    }
  });

  app.get("/dashboard/trade-journal", requireAuth, async (_req, res) => {
    const userId = getUserFromLocals(res).id;
    try {
      const now = new Date();
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      const week = new Date(now.getTime() - 7 * 86400000);
      const [document, botRows] = await Promise.all([
        readDocument(db, userId, "journal"),
        db.botTradeHistory.findMany({
          where: { userId, status: "closed", exitTs: { gte: week, lte: now } },
          orderBy: [{ exitTs: "desc" }, { id: "desc" }],
          take: 5001,
          select: {
            id: true,
            symbol: true,
            side: true,
            entryTs: true,
            exitTs: true,
            realizedPnlUsd: true
          }
        })
      ]);
      const value = schemas.journal.parse(document.value);
      const bot: JournalTrade[] = botRows.slice(0, 5000).map((row: any) => ({
        id: row.id,
        source: "bot",
        symbol: row.symbol,
        side: row.side,
        entryAt: row.entryTs.toISOString(),
        exitAt: row.exitTs.toISOString(),
        pnl: row.realizedPnlUsd,
        fees: null,
        note: value.notes[row.id] ?? ""
      }));
      const manual: JournalTrade[] = value.manual.map((row) => ({
        ...row,
        source: "manual"
      }));
      const items = [...bot, ...manual]
        .filter(
          (row) =>
            Date.parse(row.exitAt) >= week.getTime() &&
            Date.parse(row.exitAt) <= now.getTime()
        )
        .sort((a, b) => b.exitAt.localeCompare(a.exitAt));
      const summaries = Object.fromEntries(
        (["all", "bot", "manual"] as const).map((source) => {
          const selected = items.filter(
            (row) => source === "all" || row.source === source
          );
          return [
            source,
            {
              day: summarizeTrades(
                selected.filter((row) => row.exitAt >= today.toISOString())
              ),
              week: summarizeTrades(selected)
            }
          ];
        })
      );
      const visible = [
        ...items.filter((row) => row.source === "bot").slice(0, 100),
        ...items.filter((row) => row.source === "manual")
      ].sort((a, b) => b.exitAt.localeCompare(a.exitAt));
      return res.json({
        items: visible,
        summaries,
        truncated: botRows.length > 5000,
        fetchedAt: now.toISOString(),
        document
      });
    } catch {
      return res.status(500).json({ error: "dashboard_journal_unavailable" });
    }
  });
}
