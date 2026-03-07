import { prisma } from "@mm/db";
import type { BacktestReportV1, BacktestRunRecordV1, BacktestRunStatus } from "./types.js";

const db = prisma as any;

const RUN_KEY_PREFIX = "backtest.run.v1:";
const REPORT_KEY_PREFIX = "backtest.report.v1:";
const USER_INDEX_KEY_PREFIX = "backtest.index.user.v1:";
const BOT_INDEX_KEY_PREFIX = "backtest.index.bot.v1:";
const REPORT_CHUNK_SIZE = 400_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRunRecord(value: unknown): BacktestRunRecordV1 | null {
  const record = asRecord(value);
  if (!record) return null;
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const botId = typeof record.botId === "string" ? record.botId.trim() : "";
  const userId = typeof record.userId === "string" ? record.userId.trim() : "";
  if (!runId || !botId || !userId) return null;
  return record as unknown as BacktestRunRecordV1;
}

function runKey(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId}`;
}

function reportKey(runId: string, chunkIndex: number): string {
  return `${REPORT_KEY_PREFIX}${runId}:${chunkIndex}`;
}

function userIndexKey(userId: string): string {
  return `${USER_INDEX_KEY_PREFIX}${userId}`;
}

function botIndexKey(botId: string): string {
  return `${BOT_INDEX_KEY_PREFIX}${botId}`;
}

async function appendRunToIndex(indexKeyValue: string, runId: string) {
  const existing = await db.globalSetting.findUnique({
    where: { key: indexKeyValue },
    select: { value: true }
  });
  const ids = Array.isArray(existing?.value) ? existing.value.filter((row: unknown): row is string => typeof row === "string") : [];
  const next = [runId, ...ids.filter((row) => row !== runId)].slice(0, 200);
  await db.globalSetting.upsert({
    where: { key: indexKeyValue },
    update: { value: next },
    create: { key: indexKeyValue, value: next }
  });
}

export async function createBacktestRunRecord(record: BacktestRunRecordV1): Promise<void> {
  await db.globalSetting.upsert({
    where: { key: runKey(record.runId) },
    update: { value: record },
    create: { key: runKey(record.runId), value: record }
  });
  await Promise.all([
    appendRunToIndex(userIndexKey(record.userId), record.runId),
    appendRunToIndex(botIndexKey(record.botId), record.runId)
  ]);
}

export async function getBacktestRunRecord(runId: string): Promise<BacktestRunRecordV1 | null> {
  const row = await db.globalSetting.findUnique({
    where: { key: runKey(runId) },
    select: { value: true }
  });
  return asRunRecord(row?.value);
}

export async function updateBacktestRunRecord(
  runId: string,
  patch: Partial<BacktestRunRecordV1>
): Promise<BacktestRunRecordV1 | null> {
  const current = await getBacktestRunRecord(runId);
  if (!current) return null;
  const next: BacktestRunRecordV1 = {
    ...current,
    ...patch
  };
  await db.globalSetting.upsert({
    where: { key: runKey(runId) },
    update: { value: next },
    create: { key: runKey(runId), value: next }
  });
  return next;
}

export async function markBacktestRunStatus(
  runId: string,
  status: BacktestRunStatus,
  patch: Partial<BacktestRunRecordV1> = {}
): Promise<BacktestRunRecordV1 | null> {
  return updateBacktestRunRecord(runId, {
    status,
    ...patch
  });
}

export async function markBacktestRunCancelRequested(runId: string): Promise<BacktestRunRecordV1 | null> {
  return updateBacktestRunRecord(runId, {
    cancelRequested: true
  });
}

export async function listBacktestRunsForBot(params: {
  userId: string;
  botId: string;
  limit: number;
}): Promise<BacktestRunRecordV1[]> {
  const row = await db.globalSetting.findUnique({
    where: { key: botIndexKey(params.botId) },
    select: { value: true }
  });
  const ids = Array.isArray(row?.value) ? row.value.filter((item: unknown): item is string => typeof item === "string") : [];
  const out: BacktestRunRecordV1[] = [];
  for (const runId of ids.slice(0, Math.max(1, Math.min(params.limit, 200)))) {
    const run = await getBacktestRunRecord(runId);
    if (!run) continue;
    if (run.userId !== params.userId) continue;
    out.push(run);
  }
  return out;
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

export async function loadBacktestReport(runId: string, chunkCount: number): Promise<BacktestReportV1 | null> {
  if (!Number.isFinite(chunkCount) || chunkCount <= 0) return null;
  let payload = "";
  for (let i = 0; i < chunkCount; i += 1) {
    const row = await db.globalSetting.findUnique({
      where: { key: reportKey(runId, i) },
      select: { value: true }
    });
    if (typeof row?.value !== "string") return null;
    payload += row.value;
  }
  try {
    return JSON.parse(payload) as BacktestReportV1;
  } catch {
    return null;
  }
}

