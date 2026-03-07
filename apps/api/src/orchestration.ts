import {
  RUN_BACKTEST_JOB_NAME,
  RUN_BOT_JOB_NAME,
  type RedisConnection,
  getBacktestJobAttempts,
  getBacktestJobBackoffDelayMs,
  createRedisConnection,
  getBotJobAttempts,
  getBotJobBackoffDelayMs,
  getOrchestrationMode,
  getQueue,
  getQueueRuntimeConfigFromEnv,
  toBacktestJobId,
  toBotJobId
} from "@mm/orchestrator";

let queueConnection: RedisConnection | null = null;
let botQueue: ReturnType<typeof getQueue> | null = null;
let backtestQueue: ReturnType<typeof getQueue> | null = null;

type QueueJobLike = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

type QueueLikeForEnqueue = {
  add: (
    name: string,
    data: Record<string, string>,
    opts: {
      jobId: string;
      attempts: number;
      backoff: {
        type: "exponential";
        delay: number;
      };
    }
  ) => Promise<unknown>;
  getJob: (jobId: string) => Promise<QueueJobLike | null>;
};

function isQueueMode(): boolean {
  return getOrchestrationMode() === "queue";
}

async function ensureBotQueue(): Promise<ReturnType<typeof getQueue> | null> {
  if (!isQueueMode()) return null;
  if (botQueue) return botQueue;

  const cfg = getQueueRuntimeConfigFromEnv();
  queueConnection = createRedisConnection(cfg.redisUrl);

  botQueue = getQueue(queueConnection, cfg.queuePrefix, cfg.botQueueName, {
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  await botQueue.waitUntilReady();
  return botQueue;
}

async function ensureBacktestQueue(): Promise<ReturnType<typeof getQueue> | null> {
  if (!isQueueMode()) return null;
  if (backtestQueue) return backtestQueue;
  if (!queueConnection) {
    const cfg = getQueueRuntimeConfigFromEnv();
    queueConnection = createRedisConnection(cfg.redisUrl);
  }

  const cfg = getQueueRuntimeConfigFromEnv();
  backtestQueue = getQueue(queueConnection, cfg.queuePrefix, cfg.backtestQueueName, {
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  await backtestQueue.waitUntilReady();
  return backtestQueue;
}

export function getRuntimeOrchestrationMode(): "queue" | "poll" {
  return getOrchestrationMode();
}

function isTerminalJobState(state: string): boolean {
  const normalized = String(state ?? "").trim().toLowerCase();
  return normalized === "completed" || normalized === "failed";
}

function isDuplicateJobAddError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "").trim().toLowerCase();
  if (code === "ejobidexists") return true;
  const message = String((error as { message?: unknown })?.message ?? error ?? "").trim().toLowerCase();
  return (
    message.includes("jobid") && message.includes("exists")
  ) || message.includes("job is already waiting");
}

export async function enqueueBotRunInQueue(
  queue: QueueLikeForEnqueue,
  botId: string
): Promise<{ jobId: string; queued: boolean }> {
  const jobId = toBotJobId(botId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    try {
      const existingState = await existing.getState();
      if (!isTerminalJobState(existingState)) {
        return { jobId, queued: false };
      }
      await existing.remove();
    } catch {
      // Best-effort cleanup of terminal jobs; duplicate add protection below remains in place.
    }
  }

  try {
    await queue.add(
      RUN_BOT_JOB_NAME,
      { botId },
      {
        jobId,
        attempts: getBotJobAttempts(),
        backoff: {
          type: "exponential",
          delay: getBotJobBackoffDelayMs()
        }
      }
    );
    return { jobId, queued: true };
  } catch (error) {
    if (isDuplicateJobAddError(error)) {
      return { jobId, queued: false };
    }
    throw error;
  }
}

export async function enqueueBacktestRunInQueue(
  queue: QueueLikeForEnqueue,
  runId: string
): Promise<{ jobId: string; queued: boolean }> {
  const jobId = toBacktestJobId(runId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    try {
      const existingState = await existing.getState();
      if (!isTerminalJobState(existingState)) {
        return { jobId, queued: false };
      }
      await existing.remove();
    } catch {
      // Best-effort cleanup of terminal jobs; duplicate add protection below remains in place.
    }
  }

  try {
    await queue.add(
      RUN_BACKTEST_JOB_NAME,
      { runId },
      {
        jobId,
        attempts: getBacktestJobAttempts(),
        backoff: {
          type: "exponential",
          delay: getBacktestJobBackoffDelayMs()
        }
      }
    );
    return { jobId, queued: true };
  } catch (error) {
    if (isDuplicateJobAddError(error)) {
      return { jobId, queued: false };
    }
    throw error;
  }
}

export async function enqueueBotRun(botId: string): Promise<{ jobId: string; queued: boolean }> {
  if (!isQueueMode()) return { jobId: toBotJobId(botId), queued: false };

  const queue = await ensureBotQueue();
  if (!queue) throw new Error("queue_not_initialized");

  return enqueueBotRunInQueue(queue as unknown as QueueLikeForEnqueue, botId);
}

export async function enqueueBacktestRun(runId: string): Promise<{ jobId: string; queued: boolean }> {
  if (!isQueueMode()) return { jobId: toBacktestJobId(runId), queued: false };

  const queue = await ensureBacktestQueue();
  if (!queue) throw new Error("queue_not_initialized");

  return enqueueBacktestRunInQueue(queue as unknown as QueueLikeForEnqueue, runId);
}

export async function cancelBotRun(botId: string): Promise<{ jobId: string; removed: boolean }> {
  const jobId = toBotJobId(botId);
  if (!isQueueMode()) return { jobId, removed: false };

  const queue = await ensureBotQueue();
  if (!queue) return { jobId, removed: false };

  const job = await queue.getJob(jobId);
  if (!job) return { jobId, removed: false };

  try {
    await job.remove();
    return { jobId, removed: true };
  } catch {
    // Active jobs cannot always be removed; worker exits via DB status check.
    return { jobId, removed: false };
  }
}

export async function cancelBacktestRun(runId: string): Promise<{ jobId: string; removed: boolean }> {
  const jobId = toBacktestJobId(runId);
  if (!isQueueMode()) return { jobId, removed: false };

  const queue = await ensureBacktestQueue();
  if (!queue) return { jobId, removed: false };

  const job = await queue.getJob(jobId);
  if (!job) return { jobId, removed: false };

  try {
    await job.remove();
    return { jobId, removed: true };
  } catch {
    return { jobId, removed: false };
  }
}

export async function getQueueMetrics(): Promise<Record<string, unknown>> {
  if (!isQueueMode()) {
    return {
      mode: "poll",
      queueEnabled: false
    };
  }

  const queue = await ensureBotQueue();
  const btQueue = await ensureBacktestQueue();
  if (!queue || !btQueue) {
    return {
      mode: "queue",
      queueEnabled: false
    };
  }

  const [botCounts, backtestCounts] = await Promise.all([
    queue.getJobCounts(
      "active",
      "waiting",
      "delayed",
      "failed",
      "completed",
      "paused"
    ),
    btQueue.getJobCounts(
      "active",
      "waiting",
      "delayed",
      "failed",
      "completed",
      "paused"
    )
  ]);

  return {
    mode: "queue",
    queueEnabled: true,
    botQueue: botCounts,
    backtestQueue: backtestCounts
  };
}

export async function closeOrchestration(): Promise<void> {
  await Promise.allSettled([botQueue?.close(), backtestQueue?.close()]);
  botQueue = null;
  backtestQueue = null;
  queueConnection = null;
}
