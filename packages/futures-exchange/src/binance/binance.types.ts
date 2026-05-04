import type { AccountState, ContractInfo, FuturesPosition } from "@mm/futures-core";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type BinanceAdapterConfig = {
  apiKey?: string;
  apiSecret?: string;
  productType?: string;
  marginCoin?: string;
  restBaseUrl?: string;
  wsUrl?: string;
  recvWindowMs?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  writeEnabled?: boolean;
  log?: (entry: BinanceLogEntry) => void;
};

export type BinanceLogEntry = {
  at: string;
  endpoint: string;
  method: HttpMethod;
  durationMs: number;
  status?: number;
  binanceCode?: number;
  ok: boolean;
  message?: string;
  requestId?: string;
};

export type BinanceExchangeInfo = {
  serverTime?: number;
  symbols?: BinanceExchangeInfoSymbol[];
};

export type BinanceExchangeInfoSymbol = {
  symbol: string;
  pair?: string;
  contractType?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  marginAsset?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  filters?: Array<Record<string, unknown>>;
};

export type BinanceTicker = {
  symbol?: string;
  price?: string;
  bidPrice?: string;
  bidQty?: string;
  askPrice?: string;
  askQty?: string;
  time?: number;
};

export type BinanceOrderBookSnapshot = {
  lastUpdateId?: number;
  E?: number;
  T?: number;
  asks?: Array<[string | number, string | number]>;
  bids?: Array<[string | number, string | number]>;
};

export type BinanceAccountInfo = {
  totalWalletBalance?: string;
  totalMarginBalance?: string;
  availableBalance?: string;
  assets?: BinanceAccountAsset[];
  positions?: BinancePositionRisk[];
};

export type BinanceBalance = {
  asset?: string;
  balance?: string;
  crossWalletBalance?: string;
  crossUnPnl?: string;
  availableBalance?: string;
  maxWithdrawAmount?: string;
  marginAvailable?: boolean;
  updateTime?: number;
};

export type BinanceAccountAsset = {
  asset?: string;
  walletBalance?: string;
  unrealizedProfit?: string;
  marginBalance?: string;
  crossWalletBalance?: string;
  availableBalance?: string;
  maxWithdrawAmount?: string;
  updateTime?: number;
};

export type BinancePositionRisk = {
  symbol?: string;
  positionSide?: "BOTH" | "LONG" | "SHORT" | string;
  positionAmt?: string;
  entryPrice?: string;
  breakEvenPrice?: string;
  markPrice?: string;
  unRealizedProfit?: string;
  unrealizedProfit?: string;
  notional?: string;
  marginAsset?: string;
  isolatedMargin?: string;
  isolatedWallet?: string;
  updateTime?: number;
};

export type BinancePositionMode = {
  dualSidePosition?: boolean | string;
};

export type BinanceOrderRequest = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET" | "STOP" | "TAKE_PROFIT";
  quantity?: number | string;
  price?: number | string;
  stopPrice?: number | string;
  timeInForce?: "GTC" | "IOC" | "FOK" | "GTX";
  reduceOnly?: "true" | "false";
  closePosition?: "true" | "false";
  positionSide?: "BOTH" | "LONG" | "SHORT";
  workingType?: "CONTRACT_PRICE" | "MARK_PRICE";
  newClientOrderId?: string;
  newOrderRespType?: "ACK" | "RESULT";
};

export type BinanceModifyOrderRequest = {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number | string;
  price: number | string;
  orderId?: string;
  origClientOrderId?: string;
};

export type BinanceOrderResponse = {
  orderId?: number | string;
  clientOrderId?: string;
  symbol?: string;
  side?: string;
  type?: string;
  origType?: string;
  status?: string;
  price?: string;
  avgPrice?: string;
  origQty?: string;
  executedQty?: string;
  cumQty?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  closePosition?: boolean;
  positionSide?: string;
  updateTime?: number;
  time?: number;
};

export type BinanceNormalizedAccountState = AccountState & {
  raw: unknown;
};

export type BinanceNormalizedPosition = FuturesPosition & {
  raw: unknown;
};

export type BinanceContractInfo = ContractInfo & {
  minNotional?: number | null;
  raw: BinanceExchangeInfoSymbol;
};

export type BinanceWsPayload = {
  e?: string;
  s?: string;
  symbol?: string;
  data?: unknown;
  [key: string]: unknown;
};

export type BinanceFillEvent = {
  orderId: string;
  symbol: string;
  side?: string;
  price?: number;
  qty?: number;
  raw: unknown;
};

export type BinancePositionEvent = {
  symbol: string;
  size?: number;
  side?: string;
  raw: unknown;
};

export type BinanceOrderEvent = {
  orderId: string;
  symbol?: string;
  status?: string;
  raw: unknown;
};
