import type {
  BingxOrderRequest,
  BingxOrderResponse
} from "./bingx.types.js";
import type { BingxRestClient } from "./bingx.rest.js";

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["rows", "list", "orders", "data"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

export class BingxTradeApi {
  constructor(private readonly rest: BingxRestClient) {}

  placeOrder(params: BingxOrderRequest): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "POST",
      endpoint: "/openApi/swap/v2/trade/order",
      query: params as unknown as Record<string, unknown>
    });
  }

  cancelOrder(params: { symbol: string; orderId?: string; clientOrderId?: string }): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "DELETE",
      endpoint: "/openApi/swap/v2/trade/order",
      query: params
    });
  }

  cancelAllOpenOrders(symbol?: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "DELETE",
      endpoint: "/openApi/swap/v2/trade/allOpenOrders",
      query: symbol ? { symbol } : undefined
    });
  }

  async getOpenOrders(symbol?: string): Promise<BingxOrderResponse[]> {
    const data = await this.rest.requestPrivate<unknown>({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/openOrders",
      query: symbol ? { symbol } : undefined
    });
    return rows<BingxOrderResponse>(data);
  }

  getOrder(params: { symbol: string; orderId?: string; clientOrderId?: string }): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/order",
      query: params
    });
  }

  async getUserTrades(params: { symbol: string; startTime?: number; limit?: number }): Promise<unknown[]> {
    const data = await this.rest.requestPrivate<unknown>({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/allFillOrders",
      query: params
    });
    return rows<unknown>(data);
  }
}
