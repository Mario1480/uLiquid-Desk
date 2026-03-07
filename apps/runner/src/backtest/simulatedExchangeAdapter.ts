import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode,
  OrderSide
} from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "@mm/futures-exchange";
import type { BacktestTrade } from "./types.js";

type SimulatedPosition = {
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  openedTs: number;
  accruedEntryFees: number;
};

function round(value: number, digits = 8): number {
  return Number(value.toFixed(digits));
}

function normalizeSymbol(value: string): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function sideFromOrder(orderSide: OrderSide): "long" | "short" {
  return orderSide === "buy" ? "long" : "short";
}

function oppositeSide(side: "long" | "short"): "long" | "short" {
  return side === "long" ? "short" : "long";
}

function computeRealizedPnl(params: {
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  qty: number;
}): number {
  if (params.side === "long") {
    return (params.exitPrice - params.entryPrice) * params.qty;
  }
  return (params.entryPrice - params.exitPrice) * params.qty;
}

export class SimulatedBacktestExchangeAdapter implements FuturesExchange {
  private readonly canonicalSymbol: string;
  private readonly exchangeSymbol: string;
  private readonly contract: ContractInfo;
  private readonly feeBps: number;
  private readonly slippageBps: number;

  private position: SimulatedPosition | null = null;
  private realizedPnlUsd = 0;
  private feePaidUsd = 0;
  private markPrice: number;
  private fillPrice: number;
  private fillTs: number;
  private fillReason: string | null = null;
  private orderSeq = 0;
  private pendingClosedTrades: BacktestTrade[] = [];

  constructor(params: {
    symbol: string;
    initialMarkPrice: number;
    feeBps: number;
    slippageBps: number;
  }) {
    this.canonicalSymbol = normalizeSymbol(params.symbol);
    this.exchangeSymbol = this.canonicalSymbol;
    this.feeBps = Math.max(0, Number(params.feeBps));
    this.slippageBps = Math.max(0, Number(params.slippageBps));
    this.markPrice = Number(params.initialMarkPrice);
    this.fillPrice = Number(params.initialMarkPrice);
    this.fillTs = Date.now();
    this.contract = {
      canonicalSymbol: this.canonicalSymbol,
      exchangeSymbol: this.exchangeSymbol,
      apiAllowed: true,
      priceScale: null,
      volScale: null,
      priceUnit: null,
      volUnit: null,
      tickSize: 0.01,
      stepSize: 0.000001,
      minVol: 0.000001,
      maxVol: 1_000_000,
      minLeverage: 1,
      maxLeverage: 200,
      contractSize: 1,
      makerFeeRate: null,
      takerFeeRate: null,
      updatedAt: new Date().toISOString()
    };
  }

  setFillContext(params: {
    markPrice: number;
    fillPrice: number;
    ts: number;
    reason?: string | null;
  }): void {
    this.markPrice = Number(params.markPrice);
    this.fillPrice = Number(params.fillPrice);
    this.fillTs = Math.trunc(params.ts);
    this.fillReason = params.reason ?? null;
  }

  private applySlippage(price: number, side: OrderSide): number {
    const factor = this.slippageBps / 10_000;
    if (side === "buy") return price * (1 + factor);
    return price * (1 - factor);
  }

  private computeFee(notionalUsd: number): number {
    return (Math.abs(notionalUsd) * this.feeBps) / 10_000;
  }

  private appendClosedTrade(params: {
    side: "long" | "short";
    qty: number;
    entryPrice: number;
    exitPrice: number;
    entryTs: number;
    exitTs: number;
    entryFeeUsd: number;
    exitFeeUsd: number;
    reason: string | null;
  }) {
    const gross = computeRealizedPnl({
      side: params.side,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
      qty: params.qty
    });
    const pnlUsd = round(gross - params.entryFeeUsd - params.exitFeeUsd, 8);
    this.pendingClosedTrades.push({
      id: `${this.canonicalSymbol}_${this.orderSeq}_${this.pendingClosedTrades.length + 1}`,
      side: params.side,
      entryTs: params.entryTs,
      exitTs: params.exitTs,
      entryPrice: round(params.entryPrice, 8),
      exitPrice: round(params.exitPrice, 8),
      qty: round(params.qty, 8),
      feeUsd: round(params.entryFeeUsd + params.exitFeeUsd, 8),
      slippageUsd: round(Math.abs(params.exitPrice - this.markPrice) * params.qty, 8),
      pnlUsd,
      reason: params.reason ?? undefined
    });
  }

  drainClosedTrades(): BacktestTrade[] {
    const out = [...this.pendingClosedTrades];
    this.pendingClosedTrades = [];
    return out;
  }

  async getAccountState(): Promise<AccountState> {
    const unrealized = this.position
      ? computeRealizedPnl({
          side: this.position.side,
          entryPrice: this.position.entryPrice,
          exitPrice: this.markPrice,
          qty: this.position.qty
        })
      : 0;
    return {
      equity: 10_000 + this.realizedPnlUsd + unrealized - this.feePaidUsd,
      availableMargin: undefined,
      marginMode: "cross"
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    if (!this.position) return [];
    const unrealized = computeRealizedPnl({
      side: this.position.side,
      entryPrice: this.position.entryPrice,
      exitPrice: this.markPrice,
      qty: this.position.qty
    });
    return [
      {
        symbol: this.exchangeSymbol,
        side: this.position.side,
        size: this.position.qty,
        entryPrice: this.position.entryPrice,
        markPrice: this.markPrice,
        unrealizedPnl: unrealized
      }
    ];
  }

  async setLeverage(_symbol: string, _leverage: number, _marginMode: MarginMode): Promise<void> {
    return;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }> {
    this.orderSeq += 1;
    const orderId = `bt_order_${this.orderSeq}`;
    const normalizedQty = Math.max(0, Number(req.qty ?? 0));
    if (normalizedQty <= 0) return { orderId };

    const slipPrice = this.applySlippage(this.fillPrice, req.side);
    const side = sideFromOrder(req.side);
    const notional = normalizedQty * slipPrice;
    const feeUsd = this.computeFee(notional);
    this.feePaidUsd += feeUsd;

    const current = this.position;
    if (!current) {
      this.position = {
        side,
        qty: normalizedQty,
        entryPrice: slipPrice,
        openedTs: this.fillTs,
        accruedEntryFees: feeUsd
      };
      return { orderId };
    }

    if (current.side === side) {
      const nextQty = current.qty + normalizedQty;
      const weightedEntry = ((current.entryPrice * current.qty) + (slipPrice * normalizedQty)) / nextQty;
      current.qty = round(nextQty, 8);
      current.entryPrice = round(weightedEntry, 8);
      current.accruedEntryFees = round(current.accruedEntryFees + feeUsd, 8);
      this.position = current;
      return { orderId };
    }

    const closeQty = Math.min(current.qty, normalizedQty);
    const remainingQty = normalizedQty - closeQty;
    const entryFeePortion = current.accruedEntryFees * (closeQty / Math.max(current.qty, 1e-8));
    const closeGross = computeRealizedPnl({
      side: current.side,
      entryPrice: current.entryPrice,
      exitPrice: slipPrice,
      qty: closeQty
    });
    this.realizedPnlUsd = round(this.realizedPnlUsd + closeGross, 8);

    this.appendClosedTrade({
      side: current.side,
      qty: closeQty,
      entryPrice: current.entryPrice,
      exitPrice: slipPrice,
      entryTs: current.openedTs,
      exitTs: this.fillTs,
      entryFeeUsd: entryFeePortion,
      exitFeeUsd: feeUsd * (closeQty / normalizedQty),
      reason: this.fillReason
    });

    if (closeQty >= current.qty && remainingQty <= 1e-12) {
      this.position = null;
      return { orderId };
    }

    if (closeQty < current.qty) {
      current.qty = round(current.qty - closeQty, 8);
      current.accruedEntryFees = round(current.accruedEntryFees - entryFeePortion, 8);
      this.position = current;
      return { orderId };
    }

    this.position = {
      side: oppositeSide(current.side),
      qty: round(remainingQty, 8),
      entryPrice: round(slipPrice, 8),
      openedTs: this.fillTs,
      accruedEntryFees: round(feeUsd * (remainingQty / normalizedQty), 8)
    };
    return { orderId };
  }

  async cancelOrder(_orderId: string): Promise<void> {
    return;
  }

  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    const normalized = normalizeSymbol(symbol);
    if (normalized !== this.canonicalSymbol) return null;
    return this.contract;
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    const normalized = normalizeSymbol(symbol);
    if (normalized !== this.canonicalSymbol) return this.canonicalSymbol;
    return this.exchangeSymbol;
  }

  toCanonicalSymbol(symbol: string): string | null {
    return normalizeSymbol(symbol);
  }
}

