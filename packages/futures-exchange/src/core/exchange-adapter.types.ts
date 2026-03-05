import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  FuturesSymbol,
  MarginMode,
  OrderSide,
  OrderType
} from "@mm/futures-core";
import type { ExchangeError, ExchangeId } from "./exchange-error.types.js";
import type {
  ClosePositionParams,
  EditOrderParams,
  NormalizedOrder,
  NormalizedOrderIntent,
  NormalizedPosition,
  OrderIntent,
  PositionTpSlParams
} from "./order-normalization.types.js";

export type PlaceOrderRequestV1 = {
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

export interface ExchangeAdapterV2 {
  readonly exchangeId: ExchangeId;
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<FuturesPosition[]>;
  setLeverage(symbol: FuturesSymbol, leverage: number, marginMode: MarginMode): Promise<void>;

  normalizeOrderIntent(intent: OrderIntent): Promise<NormalizedOrderIntent>;
  validateOrderIntent(intent: NormalizedOrderIntent): Promise<void>;
  placeNormalizedOrder(intent: NormalizedOrderIntent): Promise<{ orderId: string }>;
  mapError(error: unknown): ExchangeError;

  cancelOrder(params: { orderId: string; symbol?: string }): Promise<void>;
  placeOrder(req: PlaceOrderRequestV1): Promise<{ orderId: string }>;
  cancelOrderV1?(orderId: string): Promise<void>;

  editOrder?(params: EditOrderParams): Promise<{ orderId: string }>;
  setPositionTpSl?(params: PositionTpSlParams): Promise<{ ok: true }>;
  closePosition?(params: ClosePositionParams): Promise<{ orderIds: string[] }>;
  listOpenOrders?(params?: { symbol?: string }): Promise<NormalizedOrder[]>;
  listPositions?(params?: { symbol?: string }): Promise<NormalizedPosition[]>;

  getContractInfo?(symbol: FuturesSymbol): Promise<ContractInfo | null>;
  toExchangeSymbol?(symbol: FuturesSymbol): Promise<string> | string;
  toCanonicalSymbol?(symbol: string): string | null;
  close(): Promise<void>;
}

