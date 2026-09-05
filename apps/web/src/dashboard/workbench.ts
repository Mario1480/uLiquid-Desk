export type RadarBot = {
  id: string;
  name: string;
  symbol: string;
  status: string;
  runtime?: {
    updatedAt?: string | null;
    reason?: string | null;
    lastError?: string | null;
  } | null;
  trade?: { openQty?: number | null } | null;
};
export function radarState(
  bot: RadarBot,
  now: number
): "error" | "stopped" | "stale" | "margin" | "waiting" | "running" {
  if (bot.status === "error" || bot.runtime?.lastError) return "error";
  if (bot.status !== "running") return "stopped";
  const updated = Date.parse(bot.runtime?.updatedAt ?? "");
  if (!Number.isFinite(updated) || now - updated > 5 * 60000) return "stale";
  if (/margin|balance|funds/i.test(bot.runtime?.reason ?? "")) return "margin";
  if (/signal|waiting|no_entry/i.test(bot.runtime?.reason ?? ""))
    return "waiting";
  return "running";
}

export type LiquidationPosition = {
  exchangeAccountId: string;
  exchangeLabel: string;
  symbol: string;
  side: "long" | "short";
  markPrice?: number | null;
  liquidationPrice?: number | null;
  leverage?: number | null;
  marginUsd?: number | null;
};
export function liquidationDistance(
  position: LiquidationPosition
): number | null {
  const { markPrice: mark, liquidationPrice: liquidation } = position;
  if (
    typeof mark !== "number" ||
    typeof liquidation !== "number" ||
    !Number.isFinite(mark) ||
    !Number.isFinite(liquidation) ||
    mark <= 0 ||
    liquidation <= 0
  )
    return null;
  return (
    ((position.side === "long" ? mark - liquidation : liquidation - mark) /
      mark) *
    100
  );
}
