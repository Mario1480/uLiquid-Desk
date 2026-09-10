export const GLOBAL_SETTING_ULIQ_PRESALE_ROUND_SCHEDULE_KEY = "admin.uliqPresaleRoundSchedule.v1";

export const ULIQ_PRESALE_ROUND_PARAMETERS = [
  {
    id: "round-1",
    number: 1,
    allocationUliq: "50000000",
    priceUsdcPerUliq: "0.002",
    hardCapUsdc: "100000",
    minPurchaseUsdc: "500",
    maxPurchaseUsdc: "10000",
    initialUnlockBps: 500,
    cliffMonths: 3,
    vestingMonths: 18,
    predecessorRoundId: null
  },
  {
    id: "round-2",
    number: 2,
    allocationUliq: "100000000",
    priceUsdcPerUliq: "0.0035",
    hardCapUsdc: "350000",
    minPurchaseUsdc: "100",
    maxPurchaseUsdc: "5000",
    initialUnlockBps: 2500,
    cliffMonths: 0,
    vestingMonths: 9,
    predecessorRoundId: "round-1"
  }
] as const;

export type UliqPresaleRoundId = (typeof ULIQ_PRESALE_ROUND_PARAMETERS)[number]["id"];

export type UliqPresaleRoundScheduleInput = {
  id: UliqPresaleRoundId;
  saleStart: string;
  saleEnd: string;
};

type StoredSchedule = {
  version: number;
  rounds: UliqPresaleRoundScheduleInput[];
  reason: string;
  updatedByUserId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizedIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseStoredSchedule(value: unknown): StoredSchedule | null {
  const record = asRecord(value);
  const version = Number(record.version);
  const rounds = Array.isArray(record.rounds) ? record.rounds : [];
  if (!Number.isSafeInteger(version) || version < 1 || rounds.length < 1 || rounds.length > 2) return null;

  const seen = new Set<UliqPresaleRoundId>();
  const parsedRounds = rounds.map((value) => {
    const round = asRecord(value);
    const parameters = ULIQ_PRESALE_ROUND_PARAMETERS.find((entry) => entry.id === round.id);
    if (!parameters || seen.has(parameters.id)) return null;
    const saleStart = normalizedIso(round.saleStart);
    const saleEnd = normalizedIso(round.saleEnd);
    if (!saleStart || !saleEnd || saleStart >= saleEnd) return null;
    seen.add(parameters.id);
    return { id: parameters.id, saleStart, saleEnd };
  }).sort((left, right) => {
    if (!left || !right) return 0;
    return left.id === "round-1" ? -1 : right.id === "round-1" ? 1 : 0;
  });
  if (parsedRounds.some((round) => round === null)) return null;

  return {
    version,
    rounds: parsedRounds as UliqPresaleRoundScheduleInput[],
    reason: typeof record.reason === "string" ? record.reason : "",
    updatedByUserId: typeof record.updatedByUserId === "string" ? record.updatedByUserId : ""
  };
}

function response(
  stored: StoredSchedule | null,
  updatedAt: Date | string | null,
  invalidStoredValue = false
) {
  const scheduleById = new Map(stored?.rounds.map((round) => [round.id, round]) ?? []);
  return {
    version: stored?.version ?? 0,
    status: invalidStoredValue
      ? "INVALID"
      : stored?.rounds.length === ULIQ_PRESALE_ROUND_PARAMETERS.length
        ? "DRAFT_CONFIGURED"
        : stored
          ? "PARTIALLY_CONFIGURED"
          : "NOT_CONFIGURED",
    onchainStatus: "NOT_BOUND",
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    rounds: ULIQ_PRESALE_ROUND_PARAMETERS.map((parameters) => ({
      ...parameters,
      saleStart: scheduleById.get(parameters.id)?.saleStart ?? null,
      saleEnd: scheduleById.get(parameters.id)?.saleEnd ?? null
    }))
  };
}

export async function getUliqPresaleRoundSchedule(db: any) {
  if (typeof db?.globalSetting?.findUnique !== "function") return response(null, null);
  const row = await db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ULIQ_PRESALE_ROUND_SCHEDULE_KEY },
    select: { value: true, updatedAt: true }
  });
  if (!row) return response(null, null);
  const parsed = parseStoredSchedule(row.value);
  return response(parsed, row.updatedAt, !parsed);
}

export async function saveUliqPresaleRoundSchedule(params: {
  db: any;
  rounds: UliqPresaleRoundScheduleInput[];
  reason: string;
  actorUserId: string;
}) {
  const current = await params.db.globalSetting.findUnique({
    where: { key: GLOBAL_SETTING_ULIQ_PRESALE_ROUND_SCHEDULE_KEY },
    select: { value: true }
  });
  const currentSchedule = parseStoredSchedule(current?.value);
  const mergedRounds = new Map<UliqPresaleRoundId, UliqPresaleRoundScheduleInput>(
    currentSchedule?.rounds.map((round) => [round.id, round]) ?? []
  );
  for (const round of params.rounds) {
    mergedRounds.set(round.id, {
      id: round.id,
      saleStart: new Date(round.saleStart).toISOString(),
      saleEnd: new Date(round.saleEnd).toISOString()
    });
  }
  const value: StoredSchedule = {
    version: (currentSchedule?.version ?? 0) + 1,
    rounds: ULIQ_PRESALE_ROUND_PARAMETERS.flatMap((parameters) => {
      const round = mergedRounds.get(parameters.id);
      return round ? [round] : [];
    }),
    reason: params.reason,
    updatedByUserId: params.actorUserId
  };
  const saved = await params.db.globalSetting.upsert({
    where: { key: GLOBAL_SETTING_ULIQ_PRESALE_ROUND_SCHEDULE_KEY },
    create: { key: GLOBAL_SETTING_ULIQ_PRESALE_ROUND_SCHEDULE_KEY, value },
    update: { value },
    select: { value: true, updatedAt: true }
  });
  return response(parseStoredSchedule(saved.value), saved.updatedAt);
}
