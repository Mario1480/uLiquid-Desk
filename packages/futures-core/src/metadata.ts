import { SymbolUnknownError } from "./errors.js";

export type ContractInfo = {
  canonicalSymbol: string;
  exchangeSymbol?: string;
  mexcSymbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  apiAllowed: boolean;
  priceScale: number | null;
  volScale: number | null;
  priceUnit: number | null;
  volUnit: number | null;
  tickSize: number | null;
  stepSize: number | null;
  minVol: number | null;
  maxVol: number | null;
  minLeverage: number | null;
  maxLeverage: number | null;
  contractSize: number | null;
  makerFeeRate: number | null;
  takerFeeRate: number | null;
  updatedAt: string;
};

export type SymbolMapping = {
  canonicalSymbol: string;
  exchangeSymbol?: string;
  mexcSymbol: string;
  baseAsset?: string;
  quoteAsset?: string;
};

function normalizeCanonicalSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function normalizeMexcSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeExchangeSymbol(symbol: string): string {
  return normalizeMexcSymbol(symbol);
}

function looseNormalize(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function parsePairFromExchangeSymbol(exchangeSymbol: string): { baseAsset?: string; quoteAsset?: string } {
  const parts = exchangeSymbol.split("_");
  if (parts.length !== 2) return {};
  const [baseAsset, quoteAsset] = parts;
  return {
    baseAsset,
    quoteAsset
  };
}

export class SymbolRegistry {
  private readonly byCanonical = new Map<string, SymbolMapping>();
  private readonly byExchange = new Map<string, SymbolMapping>();
  private readonly byMexc = new Map<string, SymbolMapping>();
  private readonly aliasToCanonical = new Map<string, string>();

  constructor(entries: SymbolMapping[]) {
    for (const entry of entries) {
      const canonicalSymbol = normalizeCanonicalSymbol(entry.canonicalSymbol);
      const exchangeSymbol = normalizeExchangeSymbol(entry.exchangeSymbol ?? entry.mexcSymbol);
      const mexcSymbol = normalizeMexcSymbol(entry.mexcSymbol || exchangeSymbol);
      const parsed = parsePairFromExchangeSymbol(exchangeSymbol);
      const normalized: SymbolMapping = {
        canonicalSymbol,
        exchangeSymbol,
        mexcSymbol,
        baseAsset: entry.baseAsset ?? parsed.baseAsset,
        quoteAsset: entry.quoteAsset ?? parsed.quoteAsset
      };

      this.byCanonical.set(canonicalSymbol, normalized);
      this.byExchange.set(exchangeSymbol, normalized);
      this.byMexc.set(mexcSymbol, normalized);
      this.aliasToCanonical.set(looseNormalize(canonicalSymbol), canonicalSymbol);
      this.aliasToCanonical.set(looseNormalize(exchangeSymbol), canonicalSymbol);
      this.aliasToCanonical.set(looseNormalize(mexcSymbol), canonicalSymbol);
      if (normalized.baseAsset && normalized.quoteAsset) {
        this.aliasToCanonical.set(
          looseNormalize(`${normalized.baseAsset}${normalized.quoteAsset}`),
          canonicalSymbol
        );
      }
    }
  }

  list(): SymbolMapping[] {
    return [...this.byCanonical.values()];
  }

  getByCanonical(symbol: string): SymbolMapping | null {
    const canonical = this.resolveCanonical(symbol);
    if (!canonical) return null;
    return this.byCanonical.get(canonical) ?? null;
  }

  getByMexc(symbol: string): SymbolMapping | null {
    return this.getByExchange(symbol);
  }

  getByExchange(symbol: string): SymbolMapping | null {
    const exchange = normalizeExchangeSymbol(symbol);
    const byExchange = this.byExchange.get(exchange) ?? null;
    if (byExchange) return byExchange;
    const mexc = normalizeMexcSymbol(symbol);
    return this.byMexc.get(mexc) ?? null;
  }

  resolveCanonical(symbol: string): string | null {
    const canonical = normalizeCanonicalSymbol(symbol);
    if (this.byCanonical.has(canonical)) return canonical;

    const alias = this.aliasToCanonical.get(looseNormalize(symbol));
    return alias ?? null;
  }

  toMexcSymbol(symbol: string): string | null {
    const canonical = this.resolveCanonical(symbol);
    if (!canonical) return null;
    return this.byCanonical.get(canonical)?.mexcSymbol ?? null;
  }

  toExchangeSymbol(symbol: string): string | null {
    const canonical = this.resolveCanonical(symbol);
    if (!canonical) return null;
    const mapping = this.byCanonical.get(canonical);
    return mapping?.exchangeSymbol ?? mapping?.mexcSymbol ?? null;
  }

  toCanonicalSymbol(symbol: string): string | null {
    return this.resolveCanonical(symbol);
  }
}

export function toMexcSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toMexcSymbol(symbol);
}

export function toExchangeSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toExchangeSymbol(symbol);
}

export function fromMexcSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toCanonicalSymbol(symbol);
}

export function fromExchangeSymbol(symbol: string, registry: SymbolRegistry): string | null {
  return registry.toCanonicalSymbol(symbol);
}

export type ContractCacheLoader = () => Promise<ContractInfo[]>;

export type ContractCacheOptions = {
  ttlSeconds?: number;
  loader: ContractCacheLoader;
  now?: () => number;
};

export class ContractCache {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly loader: ContractCacheLoader;

  private lastRefreshAtMs = 0;
  private refreshPromise: Promise<void> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  private readonly byCanonical = new Map<string, ContractInfo>();
  private readonly byExchange = new Map<string, ContractInfo>();
  private readonly byMexc = new Map<string, ContractInfo>();
  private registry = new SymbolRegistry([]);

  constructor(options: ContractCacheOptions) {
    this.ttlMs = Math.max(1_000, Number(options.ttlSeconds ?? Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300")) * 1000);
    this.loader = options.loader;
    this.now = options.now ?? (() => Date.now());
  }

  isStale(): boolean {
    if (this.byCanonical.size === 0) return true;
    return this.now() - this.lastRefreshAtMs > this.ttlMs;
  }

  snapshot(): ContractInfo[] {
    return [...this.byCanonical.values()];
  }

  getSymbolRegistry(): SymbolRegistry {
    return this.registry;
  }

  async warmup(): Promise<void> {
    await this.refresh(true);
  }

  startBackgroundRefresh(): void {
    if (this.refreshTimer) return;
    const intervalMs = Math.max(1_000, Math.floor(this.ttlMs / 2));
    this.refreshTimer = setInterval(() => {
      void this.refresh(false);
    }, intervalMs);
  }

  stopBackgroundRefresh(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async refresh(force = false): Promise<void> {
    if (!force && !this.isStale()) return;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.doRefresh()
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  async getByCanonical(symbol: string): Promise<ContractInfo | null> {
    const canonical = this.registry.toCanonicalSymbol(symbol) ?? normalizeCanonicalSymbol(symbol);
    const cached = this.byCanonical.get(canonical);

    if (cached) {
      if (this.isStale()) void this.refresh(false);
      return cached;
    }

    await this.refresh(true);
    const resolvedCanonical = this.registry.toCanonicalSymbol(symbol) ?? canonical;
    return this.byCanonical.get(resolvedCanonical) ?? null;
  }

  async getByMexc(symbol: string): Promise<ContractInfo | null> {
    return this.getByExchange(symbol);
  }

  async getByExchange(symbol: string): Promise<ContractInfo | null> {
    const exchange = normalizeExchangeSymbol(symbol);
    const fromExchange = this.byExchange.get(exchange) ?? null;
    if (fromExchange) {
      if (this.isStale()) void this.refresh(false);
      return fromExchange;
    }
    const mexc = normalizeMexcSymbol(symbol);
    const cached = this.byMexc.get(mexc);

    if (cached) {
      if (this.isStale()) void this.refresh(false);
      return cached;
    }

    await this.refresh(true);
    return this.byExchange.get(exchange) ?? this.byMexc.get(mexc) ?? null;
  }

  async requireByCanonical(symbol: string): Promise<ContractInfo> {
    const contract = await this.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);
    return contract;
  }

  private async doRefresh(): Promise<void> {
    const rows = await this.loader();

    this.byCanonical.clear();
    this.byExchange.clear();
    this.byMexc.clear();

    const mappings: SymbolMapping[] = [];
    for (const contract of rows) {
      const canonicalSymbol = normalizeCanonicalSymbol(contract.canonicalSymbol);
      const exchangeSymbol = normalizeExchangeSymbol(contract.exchangeSymbol ?? contract.mexcSymbol);
      const mexcSymbol = normalizeMexcSymbol(contract.mexcSymbol || exchangeSymbol);
      const normalized: ContractInfo = {
        ...contract,
        canonicalSymbol,
        exchangeSymbol,
        mexcSymbol
      };

      this.byCanonical.set(canonicalSymbol, normalized);
      this.byExchange.set(exchangeSymbol, normalized);
      this.byExchange.set(mexcSymbol, normalized);
      this.byMexc.set(mexcSymbol, normalized);
      mappings.push({
        canonicalSymbol,
        exchangeSymbol,
        mexcSymbol,
        baseAsset: normalized.baseAsset,
        quoteAsset: normalized.quoteAsset
      });
    }

    this.registry = new SymbolRegistry(mappings);
    this.lastRefreshAtMs = this.now();
  }
}
