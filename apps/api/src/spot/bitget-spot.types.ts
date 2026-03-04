export type BitgetSpotHttpMethod = "GET" | "POST" | "DELETE";

export type BitgetSpotApiEnvelope<T> = {
  code?: string;
  msg?: string;
  requestTime?: number;
  data?: T;
};

export type BitgetSpotSymbolRow = {
  symbol?: string;
  status?: string;
  baseCoin?: string;
  quoteCoin?: string;
  minTradeAmount?: string;
  maxTradeAmount?: string;
  quantityScale?: string;
  priceScale?: string;
  quantityStep?: string;
  priceStep?: string;
  minTradeUSDT?: string;
};

export type BitgetSpotTickerRow = {
  symbol?: string;
  lastPr?: string;
  bidPr?: string;
  askPr?: string;
  ts?: string;
};

export type BitgetSpotDepthRow = {
  asks?: Array<[string, string]>;
  bids?: Array<[string, string]>;
  ts?: string;
};

export type BitgetSpotTradeRow = {
  symbol?: string;
  price?: string;
  size?: string;
  side?: string;
  ts?: string;
};

export type BitgetSpotBalanceRow = {
  coin?: string;
  available?: string;
  frozen?: string;
  locked?: string;
  lock?: string;
};

export type BitgetSpotOpenOrderRow = {
  orderId?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  force?: string;
  status?: string;
  price?: string;
  size?: string;
  baseVolume?: string;
  filledAmount?: string;
  cTime?: string;
  uTime?: string;
};

export type BitgetSpotPlaceOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price?: number;
};

export type BitgetSpotPlaceOrderResult = {
  orderId: string;
};

export type BitgetSpotSummary = {
  equity: number | null;
  available: number | null;
  currency: string;
};
