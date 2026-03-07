import type { PerpMarketDataClient } from "../perp/perp-market-data.client.js";
import { parseBacktestCandles, storeBacktestSnapshot } from "./snapshotCache.js";
import type { BacktestTimeframe } from "./types.js";

function timeframeToGranularity(timeframe: BacktestTimeframe): string {
  if (timeframe === "1h") return "1H";
  if (timeframe === "4h") return "4H";
  if (timeframe === "1d") return "1D";
  return timeframe;
}

export async function buildBacktestSnapshotFromMarketData(params: {
  client: PerpMarketDataClient;
  exchange: string;
  symbol: string;
  timeframe: BacktestTimeframe;
  fromTs: number;
  toTs: number;
  source: string;
}): Promise<{ dataHash: string; candleCount: number }> {
  const byTs = new Map<number, ReturnType<typeof parseBacktestCandles>[number]>();
  let cursorEnd = params.toTs;
  let rounds = 0;

  while (cursorEnd > params.fromTs && rounds < 120) {
    const raw = await params.client.getCandles({
      symbol: params.symbol,
      timeframe: params.timeframe,
      granularity: timeframeToGranularity(params.timeframe),
      startTime: params.fromTs,
      endTime: cursorEnd,
      limit: 200
    });
    const rows = parseBacktestCandles(raw);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.ts < params.fromTs || row.ts > params.toTs) continue;
      byTs.set(row.ts, row);
    }

    const firstTs = rows[0]?.ts ?? null;
    if (!Number.isFinite(firstTs) || firstTs === null) break;
    if (firstTs <= params.fromTs) break;
    cursorEnd = firstTs - 1;
    rounds += 1;
  }

  const candles = Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  return storeBacktestSnapshot({
    exchange: params.exchange,
    symbol: params.symbol,
    timeframe: params.timeframe,
    fromTs: params.fromTs,
    toTs: params.toTs,
    source: params.source,
    candles
  });
}

