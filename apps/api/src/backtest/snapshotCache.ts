import { prisma } from "@mm/db";
import { hashStable } from "./hashing.js";
import type { BacktestCandle, BacktestTimeframe } from "./types.js";

const db = prisma as any;

const SNAPSHOT_META_KEY_PREFIX = "backtest.snapshot.meta.v1:";
const SNAPSHOT_CHUNK_KEY_PREFIX = "backtest.snapshot.v1:";
const SNAPSHOT_CHUNK_SIZE = 1000;

type SnapshotMetaV1 = {
  dataHash: string;
  exchange: string;
  symbol: string;
  timeframe: BacktestTimeframe;
  fromTs: number;
  toTs: number;
  candleCount: number;
  chunkCount: number;
  source: string;
  createdAt: string;
};

type SnapshotChunkV1 = {
  index: number;
  candles: BacktestCandle[];
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTsMs(raw: unknown): number | null {
  const ts = toNumber(raw);
  if (ts === null) return null;
  if (ts < 1_000_000_000_000) return Math.trunc(ts * 1000);
  return Math.trunc(ts);
}

function normalizeCandleRow(row: unknown): BacktestCandle | null {
  if (Array.isArray(row)) {
    const ts = normalizeTsMs(row[0]);
    const open = toNumber(row[1]);
    const high = toNumber(row[2]);
    const low = toNumber(row[3]);
    const close = toNumber(row[4]);
    const volume = toNumber(row[5]);
    if (ts === null || open === null || high === null || low === null || close === null) return null;
    return { ts, open, high, low, close, volume };
  }

  const record = toRecord(row);
  if (!record) return null;
  const ts = normalizeTsMs(record.ts ?? record.t ?? record.time ?? record.timestamp ?? record.T);
  const open = toNumber(record.open ?? record.o);
  const high = toNumber(record.high ?? record.h);
  const low = toNumber(record.low ?? record.l);
  const close = toNumber(record.close ?? record.c);
  const volume = toNumber(record.volume ?? record.v ?? record.baseVolume);
  if (ts === null || open === null || high === null || low === null || close === null) return null;
  return { ts, open, high, low, close, volume };
}

export function parseBacktestCandles(raw: unknown): BacktestCandle[] {
  if (!Array.isArray(raw)) {
    const packed = toRecord(raw);
    if (!packed) return [];
    const time = Array.isArray(packed.time) ? packed.time : [];
    const open = Array.isArray(packed.open) ? packed.open : [];
    const high = Array.isArray(packed.high) ? packed.high : [];
    const low = Array.isArray(packed.low) ? packed.low : [];
    const close = Array.isArray(packed.close) ? packed.close : [];
    const vol = Array.isArray(packed.vol) ? packed.vol : [];
    const size = Math.min(time.length, open.length, high.length, low.length, close.length);
    const out: BacktestCandle[] = [];
    for (let i = 0; i < size; i += 1) {
      const row = normalizeCandleRow([time[i], open[i], high[i], low[i], close[i], vol[i]]);
      if (row) out.push(row);
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  const out: BacktestCandle[] = [];
  for (const row of raw) {
    const normalized = normalizeCandleRow(row);
    if (normalized) out.push(normalized);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function canonicalizeBacktestCandles(params: {
  candles: BacktestCandle[];
  fromTs: number;
  toTs: number;
}): BacktestCandle[] {
  const byTs = new Map<number, BacktestCandle>();
  for (const candle of params.candles) {
    if (!Number.isFinite(candle.ts)) continue;
    if (candle.ts < params.fromTs || candle.ts > params.toTs) continue;
    byTs.set(candle.ts, {
      ts: Math.trunc(candle.ts),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: candle.volume === null ? null : Number(candle.volume)
    });
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

function buildSnapshotMetaKey(dataHash: string): string {
  return `${SNAPSHOT_META_KEY_PREFIX}${dataHash}`;
}

function buildSnapshotChunkKey(dataHash: string, index: number): string {
  return `${SNAPSHOT_CHUNK_KEY_PREFIX}${dataHash}:${index}`;
}

export function buildBacktestSnapshotHash(params: {
  exchange: string;
  symbol: string;
  timeframe: BacktestTimeframe;
  fromTs: number;
  toTs: number;
  source: string;
  candles: BacktestCandle[];
}): string {
  return hashStable({
    exchange: params.exchange,
    symbol: params.symbol,
    timeframe: params.timeframe,
    fromTs: params.fromTs,
    toTs: params.toTs,
    source: params.source,
    candles: params.candles
  });
}

export async function loadBacktestSnapshot(dataHash: string): Promise<{
  meta: SnapshotMetaV1;
  candles: BacktestCandle[];
} | null> {
  const metaRow = await db.globalSetting.findUnique({
    where: { key: buildSnapshotMetaKey(dataHash) },
    select: { value: true }
  });
  const meta = toRecord(metaRow?.value) as unknown as SnapshotMetaV1 | null;
  if (!meta || typeof meta.dataHash !== "string") return null;

  const candles: BacktestCandle[] = [];
  for (let i = 0; i < Number(meta.chunkCount ?? 0); i += 1) {
    const chunkRow = await db.globalSetting.findUnique({
      where: { key: buildSnapshotChunkKey(dataHash, i) },
      select: { value: true }
    });
    const chunk = toRecord(chunkRow?.value) as unknown as SnapshotChunkV1 | null;
    if (!chunk || !Array.isArray(chunk.candles)) continue;
    for (const candle of chunk.candles) {
      const normalized = normalizeCandleRow(candle);
      if (normalized) candles.push(normalized);
    }
  }

  return {
    meta,
    candles: candles.sort((a, b) => a.ts - b.ts)
  };
}

export async function storeBacktestSnapshot(params: {
  exchange: string;
  symbol: string;
  timeframe: BacktestTimeframe;
  fromTs: number;
  toTs: number;
  source: string;
  candles: BacktestCandle[];
}): Promise<{ dataHash: string; candleCount: number }> {
  const candles = canonicalizeBacktestCandles({
    candles: params.candles,
    fromTs: params.fromTs,
    toTs: params.toTs
  });
  const dataHash = buildBacktestSnapshotHash({
    ...params,
    candles
  });

  const existing = await db.globalSetting.findUnique({
    where: { key: buildSnapshotMetaKey(dataHash) },
    select: { key: true }
  });
  if (existing) {
    return {
      dataHash,
      candleCount: candles.length
    };
  }

  const chunkCount = Math.max(1, Math.ceil(candles.length / SNAPSHOT_CHUNK_SIZE));
  const createdAt = new Date().toISOString();
  const meta: SnapshotMetaV1 = {
    dataHash,
    exchange: params.exchange,
    symbol: params.symbol,
    timeframe: params.timeframe,
    fromTs: params.fromTs,
    toTs: params.toTs,
    candleCount: candles.length,
    chunkCount,
    source: params.source,
    createdAt
  };

  await db.globalSetting.upsert({
    where: { key: buildSnapshotMetaKey(dataHash) },
    update: { value: meta },
    create: { key: buildSnapshotMetaKey(dataHash), value: meta }
  });

  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * SNAPSHOT_CHUNK_SIZE;
    const end = start + SNAPSHOT_CHUNK_SIZE;
    const chunk: SnapshotChunkV1 = {
      index: i,
      candles: candles.slice(start, end)
    };
    await db.globalSetting.upsert({
      where: { key: buildSnapshotChunkKey(dataHash, i) },
      update: { value: chunk },
      create: { key: buildSnapshotChunkKey(dataHash, i), value: chunk }
    });
  }

  return {
    dataHash,
    candleCount: candles.length
  };
}

