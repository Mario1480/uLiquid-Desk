import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  FuturesSymbol,
  MarginMode,
  OrderSide,
  OrderType
} from "@mm/futures-core";
import type { ExchangeError, ExchangeId } from "./core/exchange-error.types.js";
import type {
  ClosePositionParams,
  EditOrderParams,
  NormalizedOrder,
  NormalizedOrderIntent,
  NormalizedPosition,
  OrderIntent,
  PositionTpSlParams
} from "./core/order-normalization.types.js";

export type PlaceOrderRequest = {
  symbol: FuturesSymbol;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  reduceOnly?: boolean;
  marginMode?: MarginMode;
};

export interface FuturesExchange {
  exchangeId?: ExchangeId;
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<FuturesPosition[]>;
  setLeverage(symbol: FuturesSymbol, leverage: number, marginMode: MarginMode): Promise<void>;
  placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }>;
  cancelOrder(orderId: string): Promise<void>;

  normalizeOrderIntent?(intent: OrderIntent): Promise<NormalizedOrderIntent>;
  validateOrderIntent?(intent: NormalizedOrderIntent): Promise<void>;
  placeNormalizedOrder?(intent: NormalizedOrderIntent): Promise<{ orderId: string }>;
  mapError?(error: unknown): ExchangeError;
  cancelOrderByParams?(params: { orderId: string; symbol?: string }): Promise<void>;
  editOrder?(params: EditOrderParams): Promise<{ orderId: string }>;
  setPositionTpSl?(params: PositionTpSlParams): Promise<{ ok: true }>;
  closePosition?(params: ClosePositionParams): Promise<{ orderIds: string[] }>;
  listOpenOrders?(params?: { symbol?: string }): Promise<NormalizedOrder[]>;
  listPositions?(params?: { symbol?: string }): Promise<NormalizedPosition[]>;
  addPositionMargin?(params: {
    symbol: FuturesSymbol;
    amountUsd: number;
    marginMode?: MarginMode;
  }): Promise<{ ok: true }>;

  getContractInfo?(symbol: FuturesSymbol): Promise<ContractInfo | null>;
  toExchangeSymbol?(symbol: FuturesSymbol): Promise<string> | string;
  toCanonicalSymbol?(symbol: string): string | null;
}
