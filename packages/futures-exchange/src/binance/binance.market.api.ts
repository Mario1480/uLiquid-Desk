import type { BinanceExchangeInfo, BinanceOrderBookSnapshot, BinanceTicker } from "./binance.types.js";
import type { BinanceRestClient } from "./binance.rest.js";

export type BinanceKlineParams = {
  symbol: string;
  interval?: string;
  granularity?: string;
  productType?: unknown;
  startTime?: number;
  endTime?: number;
  limit?: number;
};

export class BinanceMarketApi {
  constructor(private readonly rest: BinanceRestClient) {}

  getExchangeInfo(): Promise<BinanceExchangeInfo> {
    return this.rest.requestPublic<BinanceExchangeInfo>("GET", "/fapi/v1/exchangeInfo");
  }

  async getTicker(symbol?: string, _productType?: unknown): Promise<BinanceTicker | BinanceTicker[]> {
    return this.rest.requestPublic<BinanceTicker | BinanceTicker[]>(
      "GET",
      "/fapi/v1/ticker/bookTicker",
      symbol ? { symbol } : undefined
    );
  }

  getCandles(params: BinanceKlineParams): Promise<unknown[]> {
    return this.rest.requestPublic<unknown[]>("GET", "/fapi/v1/klines", {
      symbol: params.symbol,
      interval: params.interval ?? params.granularity ?? "1m",
      startTime: params.startTime,
      endTime: params.endTime,
      limit: params.limit
    });
  }

  getDepth(symbol: string, limit = 50, _productType?: unknown): Promise<BinanceOrderBookSnapshot> {
    return this.rest.requestPublic<BinanceOrderBookSnapshot>("GET", "/fapi/v1/depth", {
      symbol,
      limit
    });
  }

  getTrades(symbol: string, limit = 60, _productType?: unknown): Promise<unknown[]> {
    return this.rest.requestPublic<unknown[]>("GET", "/fapi/v1/trades", {
      symbol,
      limit
    });
  }
}
