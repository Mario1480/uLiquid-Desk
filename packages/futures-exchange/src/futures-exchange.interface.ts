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
  clientOrderId?: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  reduceOnly?: boolean;
  marginMode?: MarginMode;
};

export type FuturesActionStatus =
  | "confirmed"
  | "failed"
  | "pending_timeout";

export type FuturesActionConfirmationSource =
  | "receipt"
  | "venue_ack"
  | "none";

export type FuturesActionReceiptStatus =
  | "success"
  | "reverted"
  | "unknown";

export type FuturesActionResult = {
  status: FuturesActionStatus;
  submitted: boolean;
  confirmationSource: FuturesActionConfirmationSource;
  receiptStatus: FuturesActionReceiptStatus;
  txHash?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type PlaceOrderResult = FuturesActionResult & {
  orderId?: string;
  candidateOrderId?: string;
  clientOrderId?: string;
};

export type CancelOrderResult = FuturesActionResult & {
  orderId?: string;
  clientOrderId?: string;
};

export type FundsTransferResult = FuturesActionResult & {
  amountUsd?: number;
};

export function isConfirmedFuturesActionResult(
  result: FuturesActionResult | null | undefined
): result is FuturesActionResult & { status: "confirmed" } {
  return result?.status === "confirmed";
}

export function isConfirmedPlaceOrderResult(
  result: PlaceOrderResult | null | undefined
): result is PlaceOrderResult & { status: "confirmed"; orderId: string } {
  return result?.status === "confirmed" && typeof result.orderId === "string" && result.orderId.trim().length > 0;
}

export interface FuturesExchange {
  exchangeId?: ExchangeId;
  getAccountState(): Promise<AccountState>;
  getPositions(): Promise<FuturesPosition[]>;
  setLeverage(symbol: FuturesSymbol, leverage: number, marginMode: MarginMode): Promise<void>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;

  normalizeOrderIntent?(intent: OrderIntent): Promise<NormalizedOrderIntent>;
  validateOrderIntent?(intent: NormalizedOrderIntent): Promise<void>;
  placeNormalizedOrder?(intent: NormalizedOrderIntent): Promise<PlaceOrderResult>;
  mapError?(error: unknown): ExchangeError;
  cancelOrderByParams?(params: { orderId: string; symbol?: string }): Promise<CancelOrderResult>;
  editOrder?(params: EditOrderParams): Promise<PlaceOrderResult>;
  setPositionTpSl?(params: PositionTpSlParams): Promise<{ ok: true }>;
  closePosition?(params: ClosePositionParams): Promise<{ orderIds: string[] }>;
  listOpenOrders?(params?: { symbol?: string }): Promise<NormalizedOrder[]>;
  listPositions?(params?: { symbol?: string }): Promise<NormalizedPosition[]>;
  addPositionMargin?(params: {
    symbol: FuturesSymbol;
    amountUsd: number;
    marginMode?: MarginMode;
  }): Promise<{ ok: true }>;
  transferUsdClass?(params: {
    amountUsd: number;
    toPerp: boolean;
  }): Promise<FundsTransferResult>;
  transferUsdcSpotToEvm?(params: {
    amountUsd: number;
  }): Promise<FundsTransferResult>;

  getContractInfo?(symbol: FuturesSymbol): Promise<ContractInfo | null>;
  toExchangeSymbol?(symbol: FuturesSymbol): Promise<string> | string;
  toCanonicalSymbol?(symbol: string): string | null;
}
