import { z } from "zod";

export const DASHBOARD_MARKET_SESSION_IDS = [
  "newYork",
  "london",
  "frankfurt",
  "tokyo",
  "hongKong"
] as const;

export type DashboardMarketSessionId = (typeof DASHBOARD_MARKET_SESSION_IDS)[number];

export const DASHBOARD_WATCHLIST_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "SUIUSDT",
  "LTCUSDT",
  "DOTUSDT"
] as const;

export type DashboardWatchlistSymbol = (typeof DASHBOARD_WATCHLIST_SYMBOLS)[number];
export const DASHBOARD_TOP_MOVERS_MARKET_TYPES = ["spot", "perp"] as const;
export type DashboardTopMoversMarketType = (typeof DASHBOARD_TOP_MOVERS_MARKET_TYPES)[number];

export const DEFAULT_DASHBOARD_MARKET_SESSIONS: DashboardMarketSessionId[] = [
  "newYork",
  "london",
  "frankfurt",
  "tokyo"
];

export const DEFAULT_DASHBOARD_WATCHLIST: DashboardWatchlistSymbol[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT"
];
export const DEFAULT_DASHBOARD_FUNDING_SYMBOLS: DashboardWatchlistSymbol[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT"
];
export const DEFAULT_DASHBOARD_TOP_MOVERS_MARKET_TYPE: DashboardTopMoversMarketType = "spot";

export const dashboardMarketSessionsUpdateSchema = z.object({
  selected: z.array(z.enum(DASHBOARD_MARKET_SESSION_IDS)).min(1).max(DASHBOARD_MARKET_SESSION_IDS.length)
}).superRefine((value, ctx) => {
  if (new Set(value.selected).size !== value.selected.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_market_session", path: ["selected"] });
  }
});

export const dashboardWatchlistUpdateSchema = z.object({
  symbols: z.array(z.enum(DASHBOARD_WATCHLIST_SYMBOLS)).min(1).max(10)
}).superRefine((value, ctx) => {
  if (new Set(value.symbols).size !== value.symbols.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_watchlist_symbol", path: ["symbols"] });
  }
});

export const dashboardFundingRatesUpdateSchema = z.object({
  symbols: z.array(z.enum(DASHBOARD_WATCHLIST_SYMBOLS)).min(1).max(6)
}).superRefine((value, ctx) => {
  if (new Set(value.symbols).size !== value.symbols.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_funding_symbol", path: ["symbols"] });
  }
});

export const dashboardTopMoversUpdateSchema = z.object({
  marketType: z.enum(DASHBOARD_TOP_MOVERS_MARKET_TYPES)
});

export function dashboardMarketSessionsKey(userId: string): string {
  return `dashboard_market_sessions:${userId}`;
}

export function dashboardWatchlistKey(userId: string): string {
  return `dashboard_watchlist:${userId}`;
}

export function dashboardFundingRatesKey(userId: string): string {
  return `dashboard_funding_rates:${userId}`;
}

export function dashboardTopMoversKey(userId: string): string {
  return `dashboard_top_movers:${userId}`;
}

export function normalizeDashboardMarketSessions(value: unknown): DashboardMarketSessionId[] {
  const parsed = dashboardMarketSessionsUpdateSchema.safeParse(value);
  return parsed.success ? [...parsed.data.selected] : [...DEFAULT_DASHBOARD_MARKET_SESSIONS];
}

export function normalizeDashboardWatchlist(value: unknown): DashboardWatchlistSymbol[] {
  const parsed = dashboardWatchlistUpdateSchema.safeParse(value);
  return parsed.success ? [...parsed.data.symbols] : [...DEFAULT_DASHBOARD_WATCHLIST];
}

export function normalizeDashboardFundingRates(value: unknown): DashboardWatchlistSymbol[] {
  const parsed = dashboardFundingRatesUpdateSchema.safeParse(value);
  return parsed.success ? [...parsed.data.symbols] : [...DEFAULT_DASHBOARD_FUNDING_SYMBOLS];
}

export function normalizeDashboardTopMovers(value: unknown): DashboardTopMoversMarketType {
  const parsed = dashboardTopMoversUpdateSchema.safeParse(value);
  return parsed.success ? parsed.data.marketType : DEFAULT_DASHBOARD_TOP_MOVERS_MARKET_TYPE;
}

export type DashboardWatchlistQuote = {
  symbol: DashboardWatchlistSymbol;
  price: number;
  changePct24h: number;
  high24h: number | null;
  low24h: number | null;
};

type CachedQuotes = {
  expiresAt: number;
  fetchedAt: string;
  items: DashboardWatchlistQuote[];
};

const quoteCache = new Map<string, CachedQuotes>();
const WATCHLIST_CACHE_TTL_MS = 15_000;
const MARKET_WIDGET_CACHE_TTL_MS = 30_000;

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function loadDashboardWatchlistQuotes(
  symbols: DashboardWatchlistSymbol[],
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<{ items: DashboardWatchlistQuote[]; fetchedAt: string; degraded: boolean }> {
  const cacheKey = [...symbols].sort().join(",");
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { items: cached.items.map((item) => ({ ...item })), fetchedAt: cached.fetchedAt, degraded: false };
  }

  try {
    const baseUrl = (process.env.BINANCE_SPOT_BASE_URL ?? "https://api.binance.com").replace(/\/+$/, "");
    const query = new URLSearchParams({ symbols: JSON.stringify(symbols) });
    const response = await fetchImpl(`${baseUrl}/api/v3/ticker/24hr?${query.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) {
      throw new Error(`binance_watchlist_http_${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : [];
    const bySymbol = new Map(rows.map((row) => [String(row?.symbol ?? ""), row] as const));
    const items = symbols.flatMap((symbol) => {
      const row = bySymbol.get(symbol);
      const price = finiteNumber(row?.lastPrice);
      const changePct24h = finiteNumber(row?.priceChangePercent);
      if (price === null || changePct24h === null) return [];
      return [{
        symbol,
        price,
        changePct24h,
        high24h: finiteNumber(row?.highPrice),
        low24h: finiteNumber(row?.lowPrice)
      } satisfies DashboardWatchlistQuote];
    });
    const fetchedAt = new Date(now).toISOString();
    quoteCache.set(cacheKey, { expiresAt: now + WATCHLIST_CACHE_TTL_MS, fetchedAt, items });
    return { items: items.map((item) => ({ ...item })), fetchedAt, degraded: items.length !== symbols.length };
  } catch {
    if (cached) {
      return { items: cached.items.map((item) => ({ ...item })), fetchedAt: cached.fetchedAt, degraded: true };
    }
    return { items: [], fetchedAt: new Date(now).toISOString(), degraded: true };
  }
}

export type DashboardFundingRate = {
  symbol: DashboardWatchlistSymbol;
  fundingRatePct: number;
  nextFundingTime: string;
  markPrice: number | null;
  elevated: boolean;
};

let fundingRatesCache: { expiresAt: number; fetchedAt: string; items: DashboardFundingRate[] } | null = null;

export async function loadDashboardFundingRates(
  symbols: DashboardWatchlistSymbol[],
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<{ items: DashboardFundingRate[]; fetchedAt: string; degraded: boolean }> {
  let allItems = fundingRatesCache?.items ?? [];
  let fetchedAt = fundingRatesCache?.fetchedAt ?? new Date(now).toISOString();
  let degraded = false;

  if (!fundingRatesCache || fundingRatesCache.expiresAt <= now) {
    try {
      const baseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
      const response = await fetchImpl(`${baseUrl}/fapi/v1/premiumIndex`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`binance_funding_http_${response.status}`);
      const payload = await response.json();
      const allowed = new Set<string>(DASHBOARD_WATCHLIST_SYMBOLS);
      allItems = (Array.isArray(payload) ? payload : []).flatMap((row) => {
        const symbol = String(row?.symbol ?? "");
        const rate = finiteNumber(row?.lastFundingRate);
        const nextFundingTime = finiteNumber(row?.nextFundingTime);
        if (!allowed.has(symbol) || rate === null || nextFundingTime === null) return [];
        return [{
          symbol: symbol as DashboardWatchlistSymbol,
          fundingRatePct: rate * 100,
          nextFundingTime: new Date(nextFundingTime).toISOString(),
          markPrice: finiteNumber(row?.markPrice),
          elevated: Math.abs(rate) >= 0.0005
        } satisfies DashboardFundingRate];
      });
      fetchedAt = new Date(now).toISOString();
      fundingRatesCache = { items: allItems, fetchedAt, expiresAt: now + MARKET_WIDGET_CACHE_TTL_MS };
    } catch {
      degraded = true;
    }
  }

  const bySymbol = new Map(allItems.map((item) => [item.symbol, item] as const));
  const items = symbols.flatMap((symbol) => {
    const item = bySymbol.get(symbol);
    return item ? [{ ...item }] : [];
  });
  return { items, fetchedAt, degraded: degraded || items.length !== symbols.length };
}

export type DashboardTopMover = {
  symbol: string;
  price: number;
  changePct24h: number;
  quoteVolume24h: number;
};

type MoversCache = {
  expiresAt: number;
  fetchedAt: string;
  items: DashboardTopMover[];
};

const moversCache = new Map<DashboardTopMoversMarketType, MoversCache>();
const STABLE_BASES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "AEUR", "EUR"]);

function isEligibleMover(symbol: string, quoteVolume24h: number): boolean {
  if (!symbol.endsWith("USDT") || quoteVolume24h < 10_000_000) return false;
  const base = symbol.slice(0, -4);
  if (STABLE_BASES.has(base)) return false;
  return !/(UP|DOWN|BULL|BEAR)$/.test(base);
}

export async function loadDashboardTopMovers(
  marketType: DashboardTopMoversMarketType,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<{ gainers: DashboardTopMover[]; losers: DashboardTopMover[]; fetchedAt: string; degraded: boolean }> {
  const cached = moversCache.get(marketType);
  let items = cached?.items ?? [];
  let fetchedAt = cached?.fetchedAt ?? new Date(now).toISOString();
  let degraded = false;

  if (!cached || cached.expiresAt <= now) {
    try {
      const spotBaseUrl = (process.env.BINANCE_SPOT_BASE_URL ?? "https://api.binance.com").replace(/\/+$/, "");
      const perpBaseUrl = (process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "");
      const url = marketType === "spot"
        ? `${spotBaseUrl}/api/v3/ticker/24hr`
        : `${perpBaseUrl}/fapi/v1/ticker/24hr`;
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) throw new Error(`binance_movers_http_${response.status}`);
      const payload = await response.json();
      items = (Array.isArray(payload) ? payload : []).flatMap((row) => {
        const symbol = String(row?.symbol ?? "");
        const price = finiteNumber(row?.lastPrice);
        const changePct24h = finiteNumber(row?.priceChangePercent);
        const quoteVolume24h = finiteNumber(row?.quoteVolume);
        if (price === null || changePct24h === null || quoteVolume24h === null || !isEligibleMover(symbol, quoteVolume24h)) return [];
        return [{ symbol, price, changePct24h, quoteVolume24h } satisfies DashboardTopMover];
      });
      fetchedAt = new Date(now).toISOString();
      moversCache.set(marketType, { items, fetchedAt, expiresAt: now + MARKET_WIDGET_CACHE_TTL_MS });
    } catch {
      degraded = true;
    }
  }

  return {
    gainers: items.filter((item) => item.changePct24h > 0).sort((a, b) => b.changePct24h - a.changePct24h).slice(0, 5),
    losers: items.filter((item) => item.changePct24h < 0).sort((a, b) => a.changePct24h - b.changePct24h).slice(0, 5),
    fetchedAt,
    degraded: degraded || items.length === 0
  };
}

export type DashboardServiceStatus = "operational" | "degraded" | "unavailable";

export type DashboardNetworkStatusItem = {
  id: "hyperliquid" | "hyperEvm" | "arbitrum" | "binanceSpot" | "binancePerp";
  status: DashboardServiceStatus;
  latencyMs: number | null;
  blockNumber: number | null;
};

let networkStatusCache: {
  expiresAt: number;
  checkedAt: string;
  items: DashboardNetworkStatusItem[];
} | null = null;
const NETWORK_STATUS_CACHE_TTL_MS = 30_000;

function serviceStatusFromLatency(latencyMs: number): DashboardServiceStatus {
  return latencyMs > 2_000 ? "degraded" : "operational";
}

async function probeHttpService(
  id: DashboardNetworkStatusItem["id"],
  url: string,
  fetchImpl: typeof fetch
): Promise<DashboardNetworkStatusItem> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(4_000)
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      id,
      status: response.ok ? serviceStatusFromLatency(latencyMs) : "unavailable",
      latencyMs,
      blockNumber: null
    };
  } catch {
    return { id, status: "unavailable", latencyMs: null, blockNumber: null };
  }
}

async function probeRpcService(
  id: DashboardNetworkStatusItem["id"],
  url: string,
  fetchImpl: typeof fetch
): Promise<DashboardNetworkStatusItem> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(4_000)
    });
    const payload: unknown = response.ok ? await response.json() : null;
    const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const rawBlock = typeof payloadRecord?.result === "string" ? payloadRecord.result : "";
    const blockNumber = /^0x[0-9a-f]+$/i.test(rawBlock) ? Number.parseInt(rawBlock.slice(2), 16) : null;
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      id,
      status: response.ok && blockNumber !== null ? serviceStatusFromLatency(latencyMs) : "unavailable",
      latencyMs,
      blockNumber
    };
  } catch {
    return { id, status: "unavailable", latencyMs: null, blockNumber: null };
  }
}

async function probeHyperliquidService(
  url: string,
  fetchImpl: typeof fetch
): Promise<DashboardNetworkStatusItem> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
      signal: AbortSignal.timeout(4_000)
    });
    const payload = response.ok ? await response.json() : null;
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      id: "hyperliquid",
      status: response.ok && payload && typeof payload === "object"
        ? serviceStatusFromLatency(latencyMs)
        : "unavailable",
      latencyMs,
      blockNumber: null
    };
  } catch {
    return { id: "hyperliquid", status: "unavailable", latencyMs: null, blockNumber: null };
  }
}

export async function loadDashboardNetworkStatus(
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<{ items: DashboardNetworkStatusItem[]; checkedAt: string; degraded: boolean }> {
  if (networkStatusCache && networkStatusCache.expiresAt > now) {
    const items = networkStatusCache.items.map((item) => ({ ...item }));
    return {
      items,
      checkedAt: networkStatusCache.checkedAt,
      degraded: items.some((item) => item.status !== "operational")
    };
  }

  const hyperEvmRpcUrl = (
    process.env.HYPEREVM_RPC_URL
    ?? process.env.VAULT_ONCHAIN_RPC_URL
    ?? "https://rpc.hyperliquid.xyz/evm"
  ).trim();
  const arbitrumRpcUrl = (
    process.env.ARBITRUM_RPC_URL
    ?? process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL
    ?? "https://arb1.arbitrum.io/rpc"
  ).trim();
  const binanceSpotUrl = `${(process.env.BINANCE_SPOT_BASE_URL ?? "https://api.binance.com").replace(/\/+$/, "")}/api/v3/ping`;
  const binancePerpUrl = `${(process.env.BINANCE_PERP_BASE_URL ?? "https://fapi.binance.com").replace(/\/+$/, "")}/fapi/v1/ping`;
  const hyperliquidInfoUrl = `${(
    process.env.HYPERLIQUID_REST_BASE_URL
    ?? process.env.HYPERLIQUID_EXCHANGE_URL
    ?? "https://api.hyperliquid.xyz"
  ).replace(/\/+$/, "")}/info`;

  const items = await Promise.all([
    probeHyperliquidService(hyperliquidInfoUrl, fetchImpl),
    probeRpcService("hyperEvm", hyperEvmRpcUrl, fetchImpl),
    probeRpcService("arbitrum", arbitrumRpcUrl, fetchImpl),
    probeHttpService("binanceSpot", binanceSpotUrl, fetchImpl),
    probeHttpService("binancePerp", binancePerpUrl, fetchImpl)
  ]);
  const checkedAt = new Date(now).toISOString();
  networkStatusCache = {
    expiresAt: now + NETWORK_STATUS_CACHE_TTL_MS,
    checkedAt,
    items: items.map((item) => ({ ...item }))
  };
  return { items, checkedAt, degraded: items.some((item) => item.status !== "operational") };
}
