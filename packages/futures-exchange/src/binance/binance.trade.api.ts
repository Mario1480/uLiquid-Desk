import type {
  BinanceModifyOrderRequest,
  BinanceOrderRequest,
  BinanceOrderResponse
} from "./binance.types.js";
import type { BinanceRestClient } from "./binance.rest.js";

export class BinanceTradeApi {
  constructor(private readonly rest: BinanceRestClient) {}

  placeOrder(params: BinanceOrderRequest): Promise<BinanceOrderResponse> {
    return this.rest.requestPrivate<BinanceOrderResponse>({
      method: "POST",
      endpoint: "/fapi/v1/order",
      query: params as unknown as Record<string, unknown>
    });
  }

  modifyOrder(params: BinanceModifyOrderRequest): Promise<BinanceOrderResponse> {
    return this.rest.requestPrivate<BinanceOrderResponse>({
      method: "PUT",
      endpoint: "/fapi/v1/order",
      query: params as unknown as Record<string, unknown>
    });
  }

  cancelOrder(params: { symbol: string; orderId?: string; origClientOrderId?: string }): Promise<BinanceOrderResponse> {
    return this.rest.requestPrivate<BinanceOrderResponse>({
      method: "DELETE",
      endpoint: "/fapi/v1/order",
      query: params
    });
  }

  cancelAllOpenOrders(symbol: string): Promise<unknown> {
    return this.rest.requestPrivate({
      method: "DELETE",
      endpoint: "/fapi/v1/allOpenOrders",
      query: { symbol }
    });
  }

  getOpenOrders(symbol?: string): Promise<BinanceOrderResponse[]> {
    return this.rest.requestPrivate<BinanceOrderResponse[]>({
      method: "GET",
      endpoint: "/fapi/v1/openOrders",
      query: symbol ? { symbol } : undefined
    });
  }

  getOrder(params: { symbol: string; orderId?: string; origClientOrderId?: string }): Promise<BinanceOrderResponse> {
    return this.rest.requestPrivate<BinanceOrderResponse>({
      method: "GET",
      endpoint: "/fapi/v1/order",
      query: params
    });
  }

  getUserTrades(params: { symbol: string; startTime?: number; limit?: number }): Promise<unknown[]> {
    return this.rest.requestPrivate<unknown[]>({
      method: "GET",
      endpoint: "/fapi/v1/userTrades",
      query: params
    });
  }
}

