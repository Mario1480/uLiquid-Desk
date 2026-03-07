import { prisma } from "@mm/db";
import { loadBotForExecution } from "../db.js";
import type { ActiveFuturesBot } from "../db.js";
import type { BacktestCandle, BacktestReportV1, BacktestRunRecordV1 } from "./types.js";

const db = prisma as any;

const RUN_KEY_PREFIX = "backtest.run.v1:";
const REPORT_KEY_PREFIX = "backtest.report.v1:";
const SNAPSHOT_META_KEY_PREFIX = "backtest.snapshot.meta.v1:";
const SNAPSHOT_CHUNK_KEY_PREFIX = "backtest.snapshot.v1:";
const REPORT_CHUNK_SIZE = 400_000;

type SnapshotMetaV1 = {
  dataHash: string;
  chunkCount: number;
};

type SnapshotChunkV1 = {
  index: number;
  candles: BacktestCandle[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCandle(value: unknown): BacktestCandle | null {
  const row = asRecord(value);
  if (!row) return null;
  const ts = toNumber(row.ts);
  const open = toNumber(row.open);
  const high = toNumber(row.high);
  const low = toNumber(row.low);
  const close = toNumber(row.close);
  const volume = row.volume === null ? null : toNumber(row.volume);
  if (ts === null || open === null || high === null || low === null || close === null) return null;
  return {
    ts: Math.trunc(ts),
    open,
    high,
    low,
    close,
    volume
  };
}

function runKey(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId}`;
}

function reportKey(runId: string, index: number): string {
  return `${REPORT_KEY_PREFIX}${runId}:${index}`;
}

function snapshotMetaKey(dataHash: string): string {
  return `${SNAPSHOT_META_KEY_PREFIX}${dataHash}`;
}

function snapshotChunkKey(dataHash: string, index: number): string {
  return `${SNAPSHOT_CHUNK_KEY_PREFIX}${dataHash}:${index}`;
}

export async function loadBacktestRunRecord(runId: string): Promise<BacktestRunRecordV1 | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: runKey(runId) },
    select: { value: true }
  });
  const record = asRecord(row?.value);
  if (!record) return null;
  if (typeof record.runId !== "string" || !record.runId.trim()) return null;
  return record as unknown as BacktestRunRecordV1;
}

export async function saveBacktestRunRecord(record: BacktestRunRecordV1): Promise<void> {
  await db.globalSetting.upsert({
    where: { key: runKey(record.runId) },
    update: { value: record },
    create: { key: runKey(record.runId), value: record }
  });
}

export async function updateBacktestRunRecord(
  runId: string,
  patch: Partial<BacktestRunRecordV1>
): Promise<BacktestRunRecordV1 | null> {
  const current = await loadBacktestRunRecord(runId);
  if (!current) return null;
  const next: BacktestRunRecordV1 = {
    ...current,
    ...patch
  };
  await saveBacktestRunRecord(next);
  return next;
}

export async function tryClaimBacktestRun(runId: string): Promise<BacktestRunRecordV1 | null> {
  const run = await loadBacktestRunRecord(runId);
  if (!run) return null;
  if (run.cancelRequested) {
    await updateBacktestRunRecord(runId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      error: null
    });
    return null;
  }
  if (run.status !== "queued") {
    return null;
  }
  return updateBacktestRunRecord(runId, {
    status: "running",
    startedAt: new Date().toISOString(),
    error: null
  });
}

export async function loadBacktestBot(run: BacktestRunRecordV1): Promise<ActiveFuturesBot | null> {
  const bot = await loadBotForExecution(run.botId);
  if (!bot) return null;
  if (bot.userId !== run.userId) return null;
  return bot;
}

export async function loadBacktestSnapshotCandles(dataHash: string): Promise<BacktestCandle[] | null> {
  const metaRow = await db.globalSetting.findUnique({
    where: { key: snapshotMetaKey(dataHash) },
    select: { value: true }
  });
  const meta = asRecord(metaRow?.value) as unknown as SnapshotMetaV1 | null;
  if (!meta || typeof meta.dataHash !== "string" || !Number.isFinite(Number(meta.chunkCount))) {
    return null;
  }

  const candles: BacktestCandle[] = [];
  for (let i = 0; i < Number(meta.chunkCount); i += 1) {
    const chunkRow = await db.globalSetting.findUnique({
      where: { key: snapshotChunkKey(dataHash, i) },
      select: { value: true }
    });
    const chunk = asRecord(chunkRow?.value) as unknown as SnapshotChunkV1 | null;
    if (!chunk || !Array.isArray(chunk.candles)) continue;
    for (const row of chunk.candles) {
      const normalized = normalizeCandle(row);
      if (normalized) candles.push(normalized);
    }
  }
  return candles.sort((a, b) => a.ts - b.ts);
}

export async function saveBacktestReport(report: BacktestReportV1): Promise<number> {
  const serialized = JSON.stringify(report);
  const chunkCount = Math.max(1, Math.ceil(serialized.length / REPORT_CHUNK_SIZE));
  for (let i = 0; i < chunkCount; i += 1) {
    const payload = serialized.slice(i * REPORT_CHUNK_SIZE, (i + 1) * REPORT_CHUNK_SIZE);
    await db.globalSetting.upsert({
      where: { key: reportKey(report.runId, i) },
      update: { value: payload },
      create: { key: reportKey(report.runId, i), value: payload }
    });
  }
  return chunkCount;
}

export async function listQueuedBacktestRunIds(limit = 5): Promise<string[]> {
  const rows = await db.globalSetting.findMany({
    where: {
      key: {
        startsWith: RUN_KEY_PREFIX
      }
    },
    select: {
      value: true
    },
    take: Math.max(1, Math.min(limit * 4, 1000))
  });

  const queued: Array<{ runId: string; requestedAt: string }> = [];
  for (const row of rows) {
    const run = asRecord(row.value) as unknown as BacktestRunRecordV1 | null;
    if (!run || typeof run.runId !== "string" || typeof run.status !== "string") continue;
    if (run.status !== "queued") continue;
    queued.push({
      runId: run.runId,
      requestedAt: typeof run.requestedAt === "string" ? run.requestedAt : ""
    });
  }
  queued.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return queued.slice(0, Math.max(1, Math.min(limit, 20))).map((row) => row.runId);
}
