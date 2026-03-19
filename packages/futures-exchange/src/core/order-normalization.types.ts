import type { MarginMode, OrderSide, OrderType } from "@mm/futures-core";

export type OrderIntent = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price?: number;
  clientOrderId?: string;
  reduceOnly?: boolean;
  marginMode?: MarginMode;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  context: {
    source: "runner" | "manual_api";
    reason?: string;
  };
};

export type NormalizedOrderIntent = OrderIntent & {
  exchangeSymbol: string;
  normalizedQty: number;
  normalizedPrice?: number;
  metadata: Record<string, unknown>;
};

export type EditOrderParams = {
  symbol: string;
  orderId: string;
  price?: number;
  qty?: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
};

export type PositionTpSlParams = {
  symbol: string;
  side?: "long" | "short";
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
};

export type ClosePositionParams = {
  symbol: string;
  side?: "long" | "short";
};

export type NormalizedOrder = {
  orderId: string;
  symbol: string;
  side: string | null;
  type: string | null;
  status: string | null;
  price: number | null;
  qty: number | null;
  triggerPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean | null;
  createdAt: string | null;
  raw: unknown;
};

export type NormalizedPosition = {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};
