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

export function isUliqPresaleScheduleValid(
  rounds: UliqPresaleScheduleDraft[],
  nowMs = Date.now()
): boolean {
  if (rounds.length !== 2) return false;
  const windowsValid = rounds.every((round) => {
    const start = new Date(round.saleStart).getTime();
    const end = new Date(round.saleEnd).getTime();
    return Boolean(
      round.saleStart
      && round.saleEnd
      && Number.isFinite(start)
      && Number.isFinite(end)
      && start < end
      && end > nowMs
    );
  });
  if (!windowsValid) return false;
  const roundOne = rounds.find((round) => round.id === "round-1");
  const roundTwo = rounds.find((round) => round.id === "round-2");
  if (!roundOne || !roundTwo) return false;
  return new Date(roundTwo.saleStart).getTime() >= new Date(roundOne.saleEnd).getTime();
}
