import type { AccountState, ContractInfo, FuturesPosition } from "@mm/futures-core";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type BingxAdapterConfig = {
  apiKey?: string;
  apiSecret?: string;
  productType?: string;
  marginCoin?: string;
  restBaseUrl?: string;
  recvWindowMs?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  writeEnabled?: boolean;
  log?: (entry: BingxLogEntry) => void;
};

export type BingxLogEntry = {
  at: string;
  endpoint: string;
  method: HttpMethod;
  durationMs: number;
  status?: number;
  bingxCode?: number;
  ok: boolean;
  message?: string;
  requestId?: string;
};

export type BingxContractDetail = {
  symbol?: string;
  asset?: string;
  currency?: string;
  status?: number | string;
  apiStateOpen?: string | boolean;
  apiStateClose?: string | boolean;
  size?: string | number;
  quantityPrecision?: number | string;
  pricePrecision?: number | string;
  tradeMinLimit?: string | number;
  tradeMinQuantity?: string | number;
  tradeMinUSDT?: string | number;
  minLeverage?: string | number;
  maxLeverage?: string | number;
  makerFeeRate?: string | number;
  takerFeeRate?: string | number;
  feeRate?: string | number;
  [key: string]: unknown;
};

export type BingxTicker = {
  symbol?: string;
  bidPrice?: string;
  bid_price?: string;
  bidQty?: string;
  bid_qty?: string;
  askPrice?: string;
  ask_price?: string;
  askQty?: string;
  ask_qty?: string;
  time?: number;
  [key: string]: unknown;
};

export type BingxOrderBookSnapshot = {
  lastUpdateId?: number;
  time?: number;
  asks?: Array<[string | number, string | number]>;
  bids?: Array<[string | number, string | number]>;
};

export type BingxBalance = {
  asset?: string;
  currency?: string;
  balance?: string;
  equity?: string;
  availableBalance?: string;
  availableMargin?: string;
  unrealizedProfit?: string;
  walletBalance?: string;
  [key: string]: unknown;
};

export type BingxAccountInfo = BingxBalance | {
  balance?: BingxBalance | BingxBalance[];
  balances?: BingxBalance[];
  assets?: BingxBalance[];
  [key: string]: unknown;
};

export type BingxPositionRisk = {
  symbol?: string;
  positionSide?: "BOTH" | "LONG" | "SHORT" | string;
  positionAmt?: string;
  positionAmount?: string;
  availableAmt?: string;
  volume?: string;
  positionVolume?: string;
  entryPrice?: string;
  avgPrice?: string;
  averagePrice?: string;
  openAvgPrice?: string;
  markPrice?: string;
  unrealizedProfit?: string;
  unRealizedProfit?: string;
  pnl?: string;
  notional?: string;
  positionValue?: string;
  isolatedMargin?: string;
  margin?: string;
  leverage?: string;
  marginType?: string;
  isolated?: boolean | string;
  liquidationPrice?: string;
  updateTime?: number;
  [key: string]: unknown;
};

export type BingxPositionMode = {
  dualSidePosition?: boolean | string;
  dualSidePositionMode?: boolean | string;
  positionSide?: string;
  [key: string]: unknown;
};

export type BingxOrderRequest = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET" | "STOP" | "TAKE_PROFIT";
  quantity?: number | string;
  price?: number | string;
  stopPrice?: number | string;
  timeInForce?: "GTC" | "IOC" | "FOK" | "PostOnly";
  reduceOnly?: "true" | "false";
  positionSide?: "BOTH" | "LONG" | "SHORT";
  workingType?: "MARK_PRICE" | "CONTRACT_PRICE";
  clientOrderID?: string;
  takeProfit?: string;
  stopLoss?: string;
};

export type BingxOrderResponse = {
  orderId?: number | string;
  clientOrderId?: string;
  clientOrderID?: string;
  symbol?: string;
  side?: string;
  type?: string;
  origType?: string;
  status?: string;
  price?: string;
  avgPrice?: string;
  origQty?: string;
  quantity?: string;
  executedQty?: string;
  cumQty?: string;
  stopPrice?: string;
  reduceOnly?: boolean | string;
  closePosition?: boolean | string;
  positionSide?: string;
  updateTime?: number;
  time?: number;
  [key: string]: unknown;
};

export type BingxNormalizedAccountState = AccountState & {
  raw: unknown;
};

export type BingxNormalizedPosition = FuturesPosition & {
  raw: unknown;
};

export type BingxContractInfo = ContractInfo & {
  minNotional?: number | null;
  raw: BingxContractDetail;
};
