export const ACTIVE_BOT_CAPACITY_STATUSES = ["running"] as const;

export type ActiveBotCapacityStatus = (typeof ACTIVE_BOT_CAPACITY_STATUSES)[number];

export function isActiveBotCapacityStatus(value: unknown): value is ActiveBotCapacityStatus {
  return value === "running";
}

export function buildActiveBotCapacityWhere(userId: string) {
  return {
    userId,
    status: { in: [...ACTIVE_BOT_CAPACITY_STATUSES] }
  };
}

export function buildRealExchangeAccountCapacityWhere(userId: string) {
  return {
    userId,
    exchange: {
      not: "paper",
      mode: "insensitive"
    }
  };
}

function isRetryableAdmissionError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").toUpperCase();
  const message = String((error as any)?.message ?? error).toLowerCase();
  return code === "P2034"
    || code === "P2035"
    || code === "40001"
    || code === "40P01"
    || message.includes("serialization")
    || message.includes("deadlock detected")
    || message.includes("write conflict");
}

export async function runQuotaAdmissionTransaction<T>(params: {
  database: any;
  userId: string;
  bucket: "bot" | "prediction_ai" | "prediction_composite" | "prediction_local" | "exchange_account";
  work: (tx: any) => Promise<T>;
}): Promise<T> {
  const lockKey = `quota-admission:${params.bucket}:${params.userId}`;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await params.database.$transaction(async (tx: any) => {
        if (typeof tx.$queryRaw !== "function") {
          throw new Error("quota_admission_lock_unavailable");
        }
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS lock_result`;
        return params.work(tx);
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!isRetryableAdmissionError(error) || attempt === 3) throw error;
    }
  }

  throw lastError;
}

export type BotStartAdmissionDecision = {
  allowed: boolean;
  reason: string;
};

export type BotStartAdmissionResult<T = unknown> =
  | { outcome: "allowed"; value: T; runningBots: number; alreadyRunning: boolean }
  | { outcome: "denied"; reason: string; runningBots: number; alreadyRunning: boolean }
  | { outcome: "not_found" };

export type BotStartAdmissionHandler = <T>(params: {
  userId: string;
  botId: string;
  bypass: boolean;
  transition: (tx: any, bot: any) => Promise<T>;
}) => Promise<BotStartAdmissionResult<T>>;

export async function admitBotStart<T>(params: {
  database: any;
  userId: string;
  botId: string;
  bypass: boolean;
  check: (input: {
    bot: any;
    runningBots: number;
    alreadyRunning: boolean;
  }) => Promise<BotStartAdmissionDecision>;
  transition: (tx: any, bot: any) => Promise<T>;
}): Promise<BotStartAdmissionResult<T>> {
  return runQuotaAdmissionTransaction({
    database: params.database,
    userId: params.userId,
    bucket: "bot",
    work: async (tx) => {
      const bot = await tx.bot.findFirst({
        where: { id: params.botId, userId: params.userId }
      });
      if (!bot) return { outcome: "not_found" as const };

      const alreadyRunning = isActiveBotCapacityStatus(bot.status);
      const runningBots = await tx.bot.count({
        where: buildActiveBotCapacityWhere(params.userId)
      });
      const decision = params.bypass
        ? { allowed: true, reason: "bypass" }
        : await params.check({ bot, runningBots, alreadyRunning });
      if (!decision.allowed) {
        return {
          outcome: "denied" as const,
          reason: decision.reason,
          runningBots,
          alreadyRunning
        };
      }

      const value = await params.transition(tx, bot);
      return {
        outcome: "allowed" as const,
        value,
        runningBots,
        alreadyRunning
      };
    }
  });
}

export type ExchangeAccountAdmissionResult<T = unknown> =
  | { outcome: "allowed"; value: T; limit: number | null; usage: number; counted: boolean }
  | { outcome: "denied"; reason: "max_exchange_accounts_exceeded"; limit: number; usage: number; counted: true };

export async function createExchangeAccountWithQuota<T>(params: {
  database: any;
  userId: string;
  exchange: string;
  resolveLimit: () => Promise<number | null>;
  create: (tx: any) => Promise<T>;
}): Promise<ExchangeAccountAdmissionResult<T>> {
  return runQuotaAdmissionTransaction({
    database: params.database,
    userId: params.userId,
    bucket: "exchange_account",
    work: async (tx) => {
      const [limit, usage] = await Promise.all([
        params.resolveLimit(),
        tx.exchangeAccount.count({
          where: buildRealExchangeAccountCapacityWhere(params.userId)
        })
      ]);
      const counted = params.exchange.trim().toLowerCase() !== "paper";
      if (counted && limit !== null && usage >= limit) {
        return {
          outcome: "denied" as const,
          reason: "max_exchange_accounts_exceeded" as const,
          limit,
          usage,
          counted: true as const
        };
      }
      const value = await params.create(tx);
      return {
        outcome: "allowed" as const,
        value,
        limit,
        usage,
        counted
      };
    }
  });
}

export type PredictionScheduleAdmissionResult<T = unknown, TCheck = unknown> =
  | { outcome: "allowed"; value: T; check: TCheck | null }
  | { outcome: "denied"; check: TCheck };

export async function mutatePredictionScheduleWithQuota<T, TCheck extends { allowed: boolean }>(params: {
  database: any;
  userId: string;
  kind: "local" | "ai" | "composite";
  targetStateId: string | null;
  bypass: boolean;
  enforceLimit: boolean;
  check: (input: {
    currentlyEnabled: boolean;
    currentlyPaused: boolean;
  }) => Promise<TCheck>;
  mutate: (tx: any) => Promise<T>;
}): Promise<PredictionScheduleAdmissionResult<T, TCheck>> {
  return runQuotaAdmissionTransaction({
    database: params.database,
    userId: params.userId,
    bucket: `prediction_${params.kind}`,
    work: async (tx) => {
      let check: TCheck | null = null;
      if (!params.bypass && params.enforceLimit) {
        const current = params.targetStateId
          ? await tx.predictionState.findFirst({
              where: { id: params.targetStateId, userId: params.userId },
              select: {
                autoScheduleEnabled: true,
                autoSchedulePaused: true
              }
            })
          : null;
        check = await params.check({
          currentlyEnabled: Boolean(current?.autoScheduleEnabled),
          currentlyPaused: Boolean(current?.autoSchedulePaused)
        });
        if (!check.allowed) {
          return { outcome: "denied" as const, check };
        }
      }

      const value = await params.mutate(tx);
      return { outcome: "allowed" as const, value, check };
    }
  });
}
