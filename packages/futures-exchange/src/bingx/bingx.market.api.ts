import type { BingxContractDetail, BingxOrderBookSnapshot, BingxTicker } from "./bingx.types.js";
import type { BingxRestClient } from "./bingx.rest.js";

export type BingxKlineParams = {
  symbol: string;
  interval?: string;
  granularity?: string;
  productType?: unknown;
  startTime?: number;
  endTime?: number;
  limit?: number;
};

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["rows", "list", "data"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

function normalizeInterval(value: string | undefined): string {
  const normalized = String(value ?? "1m").trim();
  if (normalized === "1H") return "1h";
  if (normalized === "4H") return "4h";
  if (normalized === "1D") return "1d";
  return normalized || "1m";
}

export class BingxMarketApi {
  constructor(private readonly rest: BingxRestClient) {}

  async getContracts(symbol?: string): Promise<BingxContractDetail[]> {
    const data = await this.rest.requestPublic<unknown>("GET", "/openApi/swap/v2/quote/contracts", symbol ? { symbol } : undefined);
    return rows<BingxContractDetail>(data);
  }

  async getTicker(symbol?: string, _productType?: unknown): Promise<BingxTicker | BingxTicker[]> {
    const data = await this.rest.requestPublic<unknown>(
      "GET",
      "/openApi/swap/v2/quote/bookTicker",
      symbol ? { symbol } : undefined
    );
    if (Array.isArray(data)) return data as BingxTicker[];
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return (record.book_ticker ?? record.bookTicker ?? data) as BingxTicker;
  }

  getCandles(params: BingxKlineParams): Promise<unknown[]> {
    return this.rest.requestPublic<unknown[]>("GET", "/openApi/swap/v3/quote/klines", {
      symbol: params.symbol,
      interval: normalizeInterval(params.interval ?? params.granularity),
      startTime: params.startTime,
      endTime: params.endTime,
      limit: params.limit
    });
  }

  getDepth(symbol: string, limit = 50, _productType?: unknown): Promise<BingxOrderBookSnapshot> {
    return this.rest.requestPublic<BingxOrderBookSnapshot>("GET", "/openApi/swap/v2/quote/depth", {
      symbol,
      limit
    });
  }

  getTrades(symbol: string, limit = 60, _productType?: unknown): Promise<unknown[]> {
    return this.rest.requestPublic<unknown[]>("GET", "/openApi/swap/v2/quote/trades", {
      symbol,
      limit
    });
  }
}
