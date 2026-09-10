export type UliqPresaleScheduleDraft = {
  id: "round-1" | "round-2";
  saleStart: string;
  saleEnd: string;
};

export function presaleScheduleIsoToLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function presaleScheduleLocalValueToIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid_presale_schedule");
  return parsed.toISOString();
}

export function isUliqPresaleRoundScheduleValid(
  round: UliqPresaleScheduleDraft | undefined,
  nowMs = Date.now()
): boolean {
  if (!round?.saleStart || !round.saleEnd) return false;
  const start = new Date(round.saleStart).getTime();
  const end = new Date(round.saleEnd).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start < end && end > nowMs;
}

export function isUliqPresaleScheduleValid(
  rounds: UliqPresaleScheduleDraft[],
  nowMs = Date.now()
): boolean {
  if (rounds.length !== 2) return false;
  return rounds.every((round) => isUliqPresaleRoundScheduleValid(round, nowMs));
}
