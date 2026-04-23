export type AdvancedChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function normalizeAdvancedChartTimestampMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 1_000_000_000_000 ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function toSafeVolume(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function createAdvancedRealtimeBar(params: {
  bucketStartMs: number;
  price: number;
  qty?: number | null;
  previousBar: AdvancedChartBar | null;
}): AdvancedChartBar {
  const open = Number.isFinite(Number(params.previousBar?.close))
    ? Number(params.previousBar?.close)
    : params.price;
  const volume = toSafeVolume(params.qty);

  return {
    time: params.bucketStartMs,
    open,
    high: Math.max(open, params.price),
    low: Math.min(open, params.price),
    close: params.price,
    volume: volume > 0 ? volume : undefined
  };
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
  const currentVolume = toSafeVolume(currentBar.volume);
  const fetchedVolume = toSafeVolume(fetchedBar.volume);
  const shouldUseFetchedClose =
    fetchedVolume > 0 &&
    (currentVolume <= 0 || fetchedVolume >= currentVolume);

  return {
    time: currentBar.time,
    open: Number.isFinite(currentBar.open)
      ? currentBar.open
      : fetchedBar.open,
    high: Math.max(currentBar.high, fetchedBar.high),
    low: Math.min(currentBar.low, fetchedBar.low),
    close: shouldUseFetchedClose && Number.isFinite(fetchedBar.close)
      ? fetchedBar.close
      : currentBar.close,
    volume: mergedVolume > 0 ? mergedVolume : undefined
  };
}
