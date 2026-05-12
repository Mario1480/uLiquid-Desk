import type {
  BingxOrderRequest,
  BingxOrderResponse
} from "./bingx.types.js";
import type { BingxRestClient } from "./bingx.rest.js";

type BingxOrderReferenceParams = {
  symbol: string;
  orderId?: string;
  clientOrderId?: string;
  clientOrderID?: string;
};

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

function normalizeOrderReferenceParams(params: BingxOrderReferenceParams): Record<string, unknown> {
  const { clientOrderId, clientOrderID, ...rest } = params;
  return {
    ...rest,
    clientOrderID: clientOrderID ?? clientOrderId
  };
}

export class BingxTradeApi {
  constructor(private readonly rest: BingxRestClient) {}

  placeOrder(params: BingxOrderRequest): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "POST",
      endpoint: "/openApi/swap/v2/trade/order",
      query: params as unknown as Record<string, unknown>,
      bodyFormat: "json"
    });
  }

  cancelOrder(params: BingxOrderReferenceParams): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "DELETE",
      endpoint: "/openApi/swap/v2/trade/order",
      query: normalizeOrderReferenceParams(params)
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

  getOrder(params: BingxOrderReferenceParams): Promise<BingxOrderResponse> {
    return this.rest.requestPrivate<BingxOrderResponse>({
      method: "GET",
      endpoint: "/openApi/swap/v2/trade/order",
      query: normalizeOrderReferenceParams(params)
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
