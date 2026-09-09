import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { CROSS_MARKET_VENUES, type CrossMarketVenue } from "./core.js";
import {
  CrossMarketInsufficientDataError,
  runCrossMarketScan,
  type CrossMarketBookReader
} from "./service.js";

const venueSchema = z.enum(CROSS_MARKET_VENUES);
const feeProfileSchema = z.object({
  makerBps: z.number().finite().min(-10).max(100),
  takerBps: z.number().finite().min(0).max(100)
}).strict();
const inventorySchema = z.object({
  quoteUsd: z.number().finite().nonnegative().optional(),
  baseUnits: z.number().finite().nonnegative().optional()
}).strict();
const scanSchema = z.object({
  kind: z.enum(["arbitrage", "xemm"]),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,24}USDT$/),
  venues: z.array(venueSchema).min(2).max(CROSS_MARKET_VENUES.length),
  targetNotionalUsd: z.number().finite().min(25).max(1_000_000),
  bookLimit: z.number().int().min(5).max(100).default(25),
  safetyBufferBps: z.number().finite().min(0).max(200).default(3),
  minNetEdgeBps: z.number().finite().min(0).max(1_000).default(5),
  maxBookAgeMs: z.number().int().min(1_000).max(120_000).default(30_000),
  maxObservationSkewMs: z.number().int().min(100).max(30_000).default(2_000),
  feeProfiles: z.record(venueSchema, feeProfileSchema).default({}),
  inventory: z.record(venueSchema, inventorySchema).optional()
}).strict().superRefine((value, ctx) => {
  const seen = new Set<CrossMarketVenue>();
  value.venues.forEach((venue, index) => {
    if (seen.has(venue)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["venues", index], message: "duplicate_venue" });
    seen.add(venue);
  });
});

export function registerCrossMarketRoutes(app: Express, deps: { readBook?: CrossMarketBookReader } = {}) {
  app.post("/cross-market/scan", requireAuth, async (req, res) => {
    const parsed = scanSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const feeProfiles = Object.fromEntries(Object.entries(parsed.data.feeProfiles).map(([venue, profile]) => [
      venue,
      { ...profile, source: "request_override" as const }
    ]));
    try {
      return res.json(await runCrossMarketScan({
        ...parsed.data,
        feeProfiles
      }, deps.readBook));
    } catch (error) {
      if (error instanceof CrossMarketInsufficientDataError) {
        return res.status(503).json({
          error: "cross_market_insufficient_data",
          failures: error.failures
        });
      }
      return res.status(503).json({ error: "cross_market_scan_unavailable" });
    }
  });
}
