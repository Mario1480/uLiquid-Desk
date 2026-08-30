export type AdvancedChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AdvancedHistoryPeriod = {
  from: number;
  to: number;
  countBack?: number;
  firstDataRequest?: boolean;
};

const ADVANCED_REALTIME_TRADE_CACHE_TTL_MS = 5 * 60_000;
const ADVANCED_REALTIME_TRADE_CACHE_MAX_ENTRIES = 512;

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

export function toAdvancedChartPrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isSaneAdvancedChartBar(bar: AdvancedChartBar | null | undefined): bar is AdvancedChartBar {
  if (!bar) return false;
  const open = toAdvancedChartPrice(bar.open);
  const high = toAdvancedChartPrice(bar.high);
  const low = toAdvancedChartPrice(bar.low);
  const close = toAdvancedChartPrice(bar.close);
  if (open === null || high === null || low === null || close === null) return false;
  if (high < Math.max(open, close, low)) return false;
  if (low > Math.min(open, close, high)) return false;
  return Number.isFinite(bar.time) && bar.time > 0;
}

export function selectAdvancedHistoryBars<T extends { time: number }>(
  bars: T[],
  period: AdvancedHistoryPeriod
): T[] {
  const fromMs = Number(period.from) * 1000;
  const toMs = Number(period.to) * 1000;
  const ranged = bars.filter((bar) => bar.time >= fromMs && bar.time < toMs);
  if (ranged.length > 0) return ranged;

  // TradingView requests progressively older windows after the initial load.
  // Returning the latest bars for those windows makes it request the same
  // history repeatedly and can block Firefox for several seconds.
  if (period.firstDataRequest === false) return [];

  const countBack = Number(period.countBack);
  const fallbackCount = Number.isFinite(countBack) && countBack > 0
    ? Math.ceil(countBack)
    : bars.length;
  return bars.slice(-Math.max(1, fallbackCount));
}

export function buildAdvancedRealtimeTradeKey(params: {
  ts: number | null | undefined;
  price: number | null | undefined;
  qty: number | null | undefined;
  side?: string | null | undefined;
}): string | null {
  const normalizedTs = normalizeAdvancedChartTimestampMs(params.ts);
  const price = toAdvancedChartPrice(params.price);
  const qty = params.qty === null || params.qty === undefined ? null : Number(params.qty);
  if (!Number.isFinite(normalizedTs) || price === null || !Number.isFinite(qty)) return null;
  const side = typeof params.side === "string" ? params.side.trim().toLowerCase() : "";
  return `${normalizedTs}:${price}:${qty}:${side}`;
}

export function rememberAdvancedRealtimeTrade(
  cache: Map<string, number>,
  params: {
    ts: number | null | undefined;
    price: number | null | undefined;
    qty: number | null | undefined;
    side?: string | null | undefined;
  }
): boolean {
  const key = buildAdvancedRealtimeTradeKey(params);
  if (!key) return true;

  const ts = normalizeAdvancedChartTimestampMs(params.ts) ?? Date.now();
  const minTs = ts - ADVANCED_REALTIME_TRADE_CACHE_TTL_MS;
  for (const [existingKey, existingTs] of cache) {
    if (existingTs >= minTs) continue;
    cache.delete(existingKey);
  }

  if (cache.has(key)) {
    cache.set(key, ts);
    return false;
  }

  cache.set(key, ts);
  while (cache.size > ADVANCED_REALTIME_TRADE_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  return true;
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
