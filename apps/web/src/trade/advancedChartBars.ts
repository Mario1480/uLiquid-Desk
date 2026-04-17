export type AdvancedChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function toSafeVolume(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function reconcilePolledBarWithLiveBar(params: {
  currentBar: AdvancedChartBar | null;
  fetchedBar: AdvancedChartBar | null;
}): AdvancedChartBar | null {
  const { currentBar, fetchedBar } = params;
  if (!fetchedBar) return currentBar;
  if (!currentBar) return fetchedBar;

  if (fetchedBar.time > currentBar.time) {
    return fetchedBar;
  }

  if (fetchedBar.time < currentBar.time) {
    return currentBar;
  }

  const mergedVolume = Math.max(
    toSafeVolume(currentBar.volume),
    toSafeVolume(fetchedBar.volume)
  );

  return {
    time: currentBar.time,
    open: Number.isFinite(fetchedBar.open) ? fetchedBar.open : currentBar.open,
    high: Math.max(currentBar.high, fetchedBar.high),
    low: Math.min(currentBar.low, fetchedBar.low),
    close: currentBar.close,
    volume: mergedVolume > 0 ? mergedVolume : undefined
  };
}
