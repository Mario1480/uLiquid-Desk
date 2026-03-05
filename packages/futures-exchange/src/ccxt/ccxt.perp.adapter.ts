import type { AccountState, FuturesPosition, MarginMode } from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import type { ExchangeId } from "../core/exchange-error.types.js";

export type CcxtPerpAdapterConfig = {
  exchangeId: string;
};

function notReady(action: string): never {
  throw new Error(`ccxt_perp_not_enabled:${action}`);
}

// Skeleton only: futures/perp production path stays native for now.
export class CcxtPerpAdapter implements FuturesExchange {
  readonly exchangeId: ExchangeId;

  constructor(config: CcxtPerpAdapterConfig) {
    const exchangeId = String(config.exchangeId ?? "").trim().toLowerCase();
    if (!exchangeId) {
      throw new Error("ccxt_perp_exchange_id_required");
    }
    if (
      exchangeId !== "bitget" &&
      exchangeId !== "mexc" &&
      exchangeId !== "hyperliquid" &&
      exchangeId !== "paper" &&
      exchangeId !== "binance"
    ) {
      throw new Error(`ccxt_perp_exchange_not_supported:${exchangeId}`);
    }
    this.exchangeId = exchangeId;
  }

  async getAccountState(): Promise<AccountState> {
    return notReady("getAccountState");
  }

  async getPositions(): Promise<FuturesPosition[]> {
    return notReady("getPositions");
  }

  async setLeverage(_symbol: string, _leverage: number, _marginMode: MarginMode): Promise<void> {
    return notReady("setLeverage");
  }

  async placeOrder(_req: PlaceOrderRequest): Promise<{ orderId: string }> {
    return notReady("placeOrder");
  }

  async cancelOrder(_orderId: string): Promise<void> {
    return notReady("cancelOrder");
  }
}
