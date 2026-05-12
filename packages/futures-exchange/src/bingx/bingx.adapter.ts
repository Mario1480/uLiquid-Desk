import type {
  AccountState,
  ContractCacheOptions,
  ContractInfo,
  FuturesPosition,
  MarginMode,
  OrderSide,
  OrderType,
  SymbolRegistry
} from "@mm/futures-core";
import {
  ContractCache,
  InvalidStepError,
  InvalidTickError,
  SymbolUnknownError,
  TradingNotAllowedError,
  clampQty,
  deriveStepSize,
  deriveTickSize,
  enforceLeverageBounds,
  roundPriceToTick,
  roundQtyToStep,
  validatePrice,
  validateQty
} from "@mm/futures-core";
import type {
  CancelOrderResult,
  FuturesExchange,
  PlaceOrderRequest,
  PlaceOrderResult
} from "../futures-exchange.interface.js";
import type {
  ClosePositionParams,
  EditOrderParams,
  NormalizedOrder,
  NormalizedOrderIntent,
  NormalizedPosition,
  OrderIntent,
  PositionTpSlParams
} from "../core/order-normalization.types.js";
import {
  buildPositionRiskMetrics,
  normalizePositionMarginMode,
  pickFiniteNumber
} from "../core/position-metrics.js";
import { mapBingxError } from "./bingx-error.mapper.js";
import { BingxAccountApi } from "./bingx.account.api.js";
import {
  BINGX_USDM_DEFAULT_MARGIN_COIN,
  BINGX_USDM_DEFAULT_PRODUCT_TYPE
} from "./bingx.constants.js";
import { BingxInvalidParamsError } from "./bingx.errors.js";
import { BingxMarketApi } from "./bingx.market.api.js";
import { BingxRestClient } from "./bingx.rest.js";
import { BingxTradeApi } from "./bingx.trade.api.js";
import type {
  BingxAdapterConfig,
  BingxBalance,
  BingxContractDetail,
  BingxContractInfo,
  BingxOrderRequest,
  BingxOrderResponse,
  BingxPositionRisk
} from "./bingx.types.js";

type PositionMode = "one-way" | "hedge";

const CLIENT_ID_LIMIT = 40;
const TPSL_CLIENT_ID_PREFIX = "uliq_tpsl";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCanonicalFallbackSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function countScale(step: number | null): number | null {
  if (!step || !Number.isFinite(step) || step <= 0) return null;
  const text = String(step).toLowerCase();
  if (text.includes("e-")) {
    const [, exp] = text.split("e-");
    const parsed = Number(exp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const dot = text.indexOf(".");
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function scaleToStep(value: unknown): number | null {
  const precision = toNumber(value);
  if (precision === null || precision < 0) return null;
  return 1 / Math.pow(10, precision);
}

function toIsoFromMs(value: unknown): string | null {
  const ms = toNumber(value);
  if (ms === null || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function boolish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return null;
}

function toPositionSide(raw: BingxPositionRisk): "long" | "short" {
  const positionSide = String(raw.positionSide ?? "").toUpperCase();
  if (positionSide === "LONG") return "long";
  if (positionSide === "SHORT") return "short";
  const amt =
    toNumber(raw.positionAmt)
    ?? toNumber(raw.positionAmount)
    ?? toNumber(raw.volume)
    ?? toNumber(raw.positionVolume)
    ?? 0;
  return amt < 0 ? "short" : "long";
}

function toPositionSize(raw: BingxPositionRisk): number {
  const candidates = [
    raw.positionAmt,
    raw.positionAmount,
    raw.availableAmt,
    raw.volume,
    raw.positionVolume
  ];
  for (const candidate of candidates) {
    const value = toNumber(candidate);
    if (value !== null && value !== 0) return Math.abs(value);
  }
  return 0;
}

function mapPosition(raw: BingxPositionRisk): FuturesPosition {
  const side = toPositionSide(raw);
  const size = toPositionSize(raw);
  const entryPrice =
    toNumber(raw.entryPrice)
    ?? toNumber(raw.avgPrice)
    ?? toNumber(raw.averagePrice)
    ?? toNumber(raw.openAvgPrice)
    ?? 0;
  const markPrice = toNumber(raw.markPrice) ?? undefined;
  const unrealizedPnl =
    toNumber(raw.unrealizedProfit)
    ?? toNumber(raw.unRealizedProfit)
    ?? toNumber(raw.pnl)
    ?? undefined;
  const marginMode =
    normalizePositionMarginMode(raw.marginType)
    ?? (boolish(raw.isolated) === true ? "isolated" : null);
  const notionalUsd = Math.abs(pickFiniteNumber(raw.notional, raw.positionValue) ?? 0) || null;
  const riskMetrics = buildPositionRiskMetrics({
    side,
    size,
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage: pickFiniteNumber(raw.leverage),
    marginMode,
    marginUsd: pickFiniteNumber(raw.isolatedMargin, raw.margin),
    notionalUsd,
    liquidationPrice: pickFiniteNumber(raw.liquidationPrice)
  });
  return {
    symbol: toCanonicalFallbackSymbol(String(raw.symbol ?? "")),
    side,
    size,
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage: riskMetrics.leverage ?? undefined,
    marginMode: riskMetrics.marginMode ?? undefined,
    marginUsd: riskMetrics.marginUsd ?? undefined,
    notionalUsd: riskMetrics.notionalUsd ?? undefined,
    liquidationPrice: riskMetrics.liquidationPrice ?? undefined,
    liquidationDistancePct: riskMetrics.liquidationDistancePct ?? undefined,
    roePct: riskMetrics.roePct ?? undefined,
    pnlPct: riskMetrics.pnlPct ?? undefined
  };
}

function toBingxOrderSide(side: OrderSide): "BUY" | "SELL" {
  return side === "buy" ? "BUY" : "SELL";
}

function toBingxOrderType(type: OrderType): "MARKET" | "LIMIT" {
  return type === "market" ? "MARKET" : "LIMIT";
}

function toCanonicalClientOrderId(value: string | undefined, fallbackPrefix: string): string {
  const raw = String(value ?? "").trim() || `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  return raw.replace(/[^.A-Za-z0-9_:/-]/g, "_").slice(0, CLIENT_ID_LIMIT);
}

function toManagedClientOrderId(kind: "tp" | "sl", symbol: string, side: "long" | "short"): string {
  return toCanonicalClientOrderId(`${TPSL_CLIENT_ID_PREFIX}_${kind}_${side}_${symbol}_${Date.now()}`, "uliq");
}

function isManagedTpSlOrder(row: BingxOrderResponse, symbol?: string, side?: "long" | "short"): boolean {
  const clientOrderId = String(row.clientOrderId ?? row.clientOrderID ?? "");
  if (!clientOrderId.startsWith(TPSL_CLIENT_ID_PREFIX)) return false;
  if (symbol && String(row.symbol ?? "").toUpperCase() !== symbol.toUpperCase()) return false;
  if (side) {
    const positionSide = String(row.positionSide ?? "").toUpperCase();
    if (side === "long" && positionSide === "SHORT") return false;
    if (side === "short" && positionSide === "LONG") return false;
  }
  return true;
}

function mapOrderStatus(status: unknown): string | null {
  const text = String(status ?? "").trim().toLowerCase();
  return text || null;
}

function mapOrderQty(row: BingxOrderResponse): number | null {
  const orig = toNumber(row.origQty) ?? toNumber(row.quantity);
  const executed = toNumber(row.executedQty) ?? toNumber(row.cumQty) ?? 0;
  if (orig === null) return null;
  return Number(Math.max(0, orig - executed).toFixed(12));
}

function parseEmbeddedStopPrice(value: unknown): number | null {
  if (!value) return null;
  const record = typeof value === "string"
    ? (() => {
        try {
          const parsed = JSON.parse(value) as unknown;
          return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
        } catch {
          return null;
        }
      })()
    : value && typeof value === "object"
      ? value as Record<string, unknown>
      : null;
  if (!record) return null;
  return toNumber(record.stopPrice ?? record.triggerPrice ?? record.price);
}

function getOrderTakeProfitPrice(row: BingxOrderResponse): number | null {
  const type = String(row.type ?? row.origType ?? "").toUpperCase();
  if (type.includes("TAKE_PROFIT")) return toNumber(row.stopPrice);
  return parseEmbeddedStopPrice(row.takeProfit) ?? toNumber(row.takeProfitPrice);
}

function getOrderStopLossPrice(row: BingxOrderResponse): number | null {
  const type = String(row.type ?? row.origType ?? "").toUpperCase();
  if (type.includes("STOP")) return toNumber(row.stopPrice);
  return parseEmbeddedStopPrice(row.stopLoss) ?? toNumber(row.stopLossPrice);
}

function pickOrderId(response: BingxOrderResponse): string | null {
  const candidates = [response.orderId, response.clientOrderId, response.clientOrderID];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }
  return null;
}

function toMarginType(mode: MarginMode): "CROSSED" | "ISOLATED" {
  return mode === "isolated" ? "ISOLATED" : "CROSSED";
}

function isContractTradable(detail: BingxContractDetail): boolean {
  const status = String(detail.status ?? "").trim();
  const statusOk = status === "1" || status.toUpperCase() === "TRADING";
  const openOk = boolish(detail.apiStateOpen) !== false;
  const closeOk = boolish(detail.apiStateClose) !== false;
  return statusOk && openOk && closeOk;
}

export function toBingxContractInfo(detail: BingxContractDetail): BingxContractInfo {
  const exchangeSymbol = String(detail.symbol ?? "").trim().toUpperCase();
  const canonicalSymbol = toCanonicalFallbackSymbol(exchangeSymbol);
  const tickSize = scaleToStep(detail.pricePrecision);
  const stepSize =
    toNumber(detail.size)
    ?? scaleToStep(detail.quantityPrecision)
    ?? toNumber(detail.tradeMinQuantity);

  return {
    canonicalSymbol,
    exchangeSymbol,
    baseAsset: detail.asset ? String(detail.asset).toUpperCase() : undefined,
    quoteAsset: detail.currency ? String(detail.currency).toUpperCase() : undefined,
    minVol: toNumber(detail.tradeMinQuantity),
    maxVol: null,
    tickSize,
    stepSize,
    priceScale: countScale(tickSize),
    volScale: countScale(stepSize),
    priceUnit: tickSize,
    volUnit: stepSize,
    contractSize: 1,
    minLeverage: toNumber(detail.minLeverage) ?? 1,
    maxLeverage: toNumber(detail.maxLeverage) ?? 125,
    apiAllowed: isContractTradable(detail),
    makerFeeRate: toNumber(detail.makerFeeRate),
    takerFeeRate: toNumber(detail.takerFeeRate) ?? toNumber(detail.feeRate),
    minNotional: toNumber(detail.tradeMinUSDT) ?? toNumber(detail.tradeMinLimit),
    updatedAt: new Date().toISOString(),
    raw: detail
  };
}

export class BingxFuturesAdapter implements FuturesExchange {
  readonly exchangeId = "bingx" as const;
  readonly productType: string;
  readonly marginCoin: string;
  readonly writeEnabled: boolean;

  readonly rest: BingxRestClient;
  readonly marketApi: BingxMarketApi;
  readonly accountApi: BingxAccountApi;
  readonly tradingApi: BingxTradeApi;
  readonly tradeApi: BingxTradeApi;
  readonly contractCache: ContractCache;
  readonly positionApi: {
    getAllPositions: (params?: { symbol?: string }) => Promise<Array<Record<string, unknown>>>;
  };

  private positionModeCache: { mode: PositionMode; ts: number } | null = null;

  constructor(private readonly config: BingxAdapterConfig = {}) {
    this.productType = config.productType ?? process.env.BINGX_PRODUCT_TYPE ?? BINGX_USDM_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? process.env.BINGX_MARGIN_COIN ?? BINGX_USDM_DEFAULT_MARGIN_COIN;
    this.writeEnabled = config.writeEnabled ?? !["0", "false", "off", "no"].includes(
      String(process.env.BINGX_PERP_WRITE_ENABLED ?? "1").trim().toLowerCase()
    );

    this.rest = new BingxRestClient(config);
    this.marketApi = new BingxMarketApi(this.rest);
    this.accountApi = new BingxAccountApi(this.rest);
    this.tradingApi = new BingxTradeApi(this.rest);
    this.tradeApi = this.tradingApi;
    this.positionApi = {
      getAllPositions: async (params) => {
        const rows = await this.accountApi.getPositionRisk(params?.symbol);
        return rows as Array<Record<string, unknown>>;
      }
    };

    const cacheOptions: ContractCacheOptions = {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300"),
      loader: async () => {
        const details = await this.marketApi.getContracts();
        return details
          .filter((row) => Boolean(row?.symbol))
          .map((row) => toBingxContractInfo(row));
      }
    };

    this.contractCache = new ContractCache(cacheOptions);
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/openApi/swap/v2/quote/contracts",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `contract cache warmup failed: ${String(error)}`
      });
    });
  }

  async getAccountState(): Promise<AccountState> {
    const balances = await this.accountApi.getBalance();
    const preferred =
      balances.find((row) => String(row.asset ?? row.currency ?? "").toUpperCase() === this.marginCoin.toUpperCase())
      ?? balances[0];
    const equity =
      pickBalanceNumber(preferred, "equity", "balance", "walletBalance")
      ?? balances.reduce((sum, asset) => sum + (pickBalanceNumber(asset, "equity", "balance", "walletBalance") ?? 0), 0);
    const available =
      pickBalanceNumber(preferred, "availableMargin", "availableBalance")
      ?? balances.reduce((sum, asset) => sum + (pickBalanceNumber(asset, "availableMargin", "availableBalance") ?? 0), 0);
    return {
      equity: equity ?? 0,
      availableMargin: available ?? undefined
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    await this.contractCache.refresh(false);
    const rows = await this.accountApi.getPositionRisk();
    return rows
      .map(mapPosition)
      .filter((position) => position.symbol.length > 0 && position.size > 0);
  }

  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    return this.contractCache.getByCanonical(symbol);
  }

  async listContractInfo(): Promise<ContractInfo[]> {
    await this.contractCache.refresh(false);
    return this.contractCache.snapshot();
  }

  getSymbolRegistry(): SymbolRegistry {
    return this.contractCache.getSymbolRegistry();
  }

  toCanonicalSymbol(symbol: string): string | null {
    return this.contractCache.getSymbolRegistry().toCanonicalSymbol(symbol) ?? toCanonicalFallbackSymbol(symbol);
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = this.contractCache.getSymbolRegistry().toExchangeSymbol(symbol);
    if (!exchangeSymbol) throw new SymbolUnknownError(symbol);
    return exchangeSymbol;
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    this.assertWriteEnabled();
    const contract = await this.requireTradeableContract(symbol);
    enforceLeverageBounds(leverage, contract);
    await this.accountApi.setMarginType(contract.exchangeSymbol, toMarginType(marginMode));
    const positionMode = await this.resolvePositionMode();
    if (positionMode === "hedge") {
      await Promise.all([
        this.accountApi.setLeverage(contract.exchangeSymbol, leverage, "LONG"),
        this.accountApi.setLeverage(contract.exchangeSymbol, leverage, "SHORT")
      ]);
    } else {
      await this.accountApi.setLeverage(contract.exchangeSymbol, leverage, "BOTH");
    }
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const normalized = await this.normalizeOrderIntent({
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      qty: req.qty,
      price: req.price,
      clientOrderId: req.clientOrderId,
      reduceOnly: req.reduceOnly,
      marginMode: req.marginMode,
      takeProfitPrice: req.takeProfitPrice,
      stopLossPrice: req.stopLossPrice,
      context: { source: "manual_api" }
    });
    await this.validateOrderIntent(normalized);
    return this.placeNormalizedOrder(normalized);
  }

  async normalizeOrderIntent(intent: OrderIntent): Promise<NormalizedOrderIntent> {
    const contract = await this.requireTradeableContract(intent.symbol);
    const stepSize = deriveStepSize(contract);
    if (!stepSize) throw new InvalidStepError(contract.canonicalSymbol, `Missing step size for ${contract.canonicalSymbol}`);

    let qty = roundQtyToStep(intent.qty, stepSize, "down");
    qty = clampQty(qty, contract.minVol, contract.maxVol);

    let normalizedPrice: number | undefined;
    if (intent.type === "limit") {
      if (!Number.isFinite(intent.price) || (intent.price ?? 0) <= 0) {
        throw new BingxInvalidParamsError("Limit order requires a positive price", {
          endpoint: "/openApi/swap/v2/trade/order",
          method: "POST"
        });
      }
      const tickSize = deriveTickSize(contract);
      if (!tickSize) throw new InvalidTickError(contract.canonicalSymbol, `Missing tick size for ${contract.canonicalSymbol}`);
      normalizedPrice = roundPriceToTick(intent.price as number, tickSize, "nearest");
    }

    return {
      ...intent,
      symbol: contract.canonicalSymbol,
      exchangeSymbol: contract.exchangeSymbol,
      normalizedQty: qty,
      normalizedPrice,
      metadata: {
        contract,
        minNotional: (contract as BingxContractInfo).minNotional ?? null
      }
    };
  }

  async validateOrderIntent(intent: NormalizedOrderIntent): Promise<void> {
    const contract = intent.metadata.contract as ContractInfo | undefined;
    if (!contract) throw new SymbolUnknownError(intent.symbol);
    const stepSize = deriveStepSize(contract);
    if (!stepSize) throw new InvalidStepError(contract.canonicalSymbol);
    const qtyValidation = validateQty(intent.normalizedQty, stepSize, contract.minVol, contract.maxVol, contract.canonicalSymbol);
    if (!qtyValidation.ok) throw qtyValidation.error;

    if (intent.type === "limit") {
      const tickSize = deriveTickSize(contract);
      if (!tickSize) throw new InvalidTickError(contract.canonicalSymbol);
      const priceValidation = validatePrice(intent.normalizedPrice ?? 0, tickSize, contract.canonicalSymbol);
      if (!priceValidation.ok) throw priceValidation.error;
    }

    const minNotional = (contract as BingxContractInfo).minNotional ?? null;
    const price = intent.normalizedPrice ?? intent.price;
    if (minNotional !== null && Number.isFinite(minNotional) && minNotional > 0 && Number.isFinite(price) && (price ?? 0) > 0) {
      const notional = intent.normalizedQty * (price ?? 0);
      if (notional < minNotional) {
        throw new BingxInvalidParamsError(`Order notional ${notional} below minNotional ${minNotional}`, {
          endpoint: "/openApi/swap/v2/trade/order",
          method: "POST"
        });
      }
    }
  }

  async placeNormalizedOrder(intent: NormalizedOrderIntent): Promise<PlaceOrderResult> {
    this.assertWriteEnabled();
    const positionMode = await this.resolvePositionMode();
    const payload = this.buildOrderRequest(intent, positionMode);
    const result = await this.tradeApi.placeOrder(payload);
    const orderId = pickOrderId(result);
    if (!orderId) {
      throw new BingxInvalidParamsError("BingX did not return order id", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId,
      clientOrderId: payload.clientOrderId
    };
  }

  async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    this.assertWriteEnabled();
    const open = await this.listOpenOrders();
    const found = open.find((row) => row.orderId === orderId);
    if (!found) {
      throw new BingxInvalidParamsError("symbol_required_for_order_cancel", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "DELETE"
      });
    }
    return this.cancelOrderByParams({ orderId, symbol: found.symbol });
  }

  async cancelOrderByParams(params: { orderId: string; symbol?: string }): Promise<CancelOrderResult> {
    this.assertWriteEnabled();
    const exchangeSymbol = params.symbol ? await this.toExchangeSymbol(params.symbol) : null;
    if (!exchangeSymbol) {
      throw new BingxInvalidParamsError("symbol_required_for_order_cancel", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "DELETE"
      });
    }
    await this.tradeApi.cancelOrder({ symbol: exchangeSymbol, orderId: params.orderId });
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId: params.orderId
    };
  }

  async editOrder(params: EditOrderParams): Promise<PlaceOrderResult> {
    this.assertWriteEnabled();
    const contract = await this.requireTradeableContract(params.symbol);
    const current = await this.tradeApi.getOrder({
      symbol: contract.exchangeSymbol,
      orderId: params.orderId
    });
    if (String(current.type ?? current.origType ?? "").toUpperCase() !== "LIMIT") {
      throw new BingxInvalidParamsError("Only LIMIT orders can be edited on BingX USD-M", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }

    const side: OrderSide = String(current.side ?? "BUY").toUpperCase() === "SELL" ? "sell" : "buy";
    const price = params.price ?? toNumber(current.price) ?? 0;
    const qty = params.qty ?? mapOrderQty(current) ?? 0;
    const takeProfitPrice = params.takeProfitPrice === undefined
      ? getOrderTakeProfitPrice(current) ?? undefined
      : params.takeProfitPrice ?? undefined;
    const stopLossPrice = params.stopLossPrice === undefined
      ? getOrderStopLossPrice(current) ?? undefined
      : params.stopLossPrice ?? undefined;

    const normalized = await this.normalizeOrderIntent({
      symbol: contract.canonicalSymbol,
      side,
      type: "limit",
      qty,
      price,
      reduceOnly: boolish(current.reduceOnly) ?? undefined,
      takeProfitPrice,
      stopLossPrice,
      context: {
        source: "manual_api",
        reason: "edit_order"
      }
    });
    await this.validateOrderIntent(normalized);
    const positionMode = await this.resolvePositionMode();
    const payload = this.buildOrderRequest(normalized, positionMode);

    await this.tradeApi.cancelOrder({
      symbol: contract.exchangeSymbol,
      orderId: params.orderId
    });
    const result = await this.tradeApi.placeOrder(payload);
    const orderId = pickOrderId(result);
    if (!orderId) {
      throw new BingxInvalidParamsError("BingX edit replacement did not return order id", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId,
      clientOrderId: payload.clientOrderId
    };
  }

  async setPositionTpSl(params: PositionTpSlParams): Promise<{ ok: true }> {
    this.assertWriteEnabled();
    const contract = await this.requireTradeableContract(params.symbol);
    const positions = await this.listPositions({ symbol: contract.canonicalSymbol });
    const target = positions.find((row) => (params.side ? row.side === params.side : true));
    if (!target || target.size <= 0) {
      throw new BingxInvalidParamsError("position_side_required", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }
    if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null && params.takeProfitPrice <= 0) {
      throw new BingxInvalidParamsError("invalid_take_profit", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }
    if (params.stopLossPrice !== undefined && params.stopLossPrice !== null && params.stopLossPrice <= 0) {
      throw new BingxInvalidParamsError("invalid_stop_loss", {
        endpoint: "/openApi/swap/v2/trade/order",
        method: "POST"
      });
    }

    const positionMode = await this.resolvePositionMode();
    await this.cancelManagedTpSlOrders(contract.exchangeSymbol, target.side);
    if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null) {
      await this.placeConditionalCloseOrder({
        contract,
        side: target.side,
        closeQty: target.size,
        triggerPrice: params.takeProfitPrice,
        kind: "tp",
        positionMode
      });
    }
    if (params.stopLossPrice !== undefined && params.stopLossPrice !== null) {
      await this.placeConditionalCloseOrder({
        contract,
        side: target.side,
        closeQty: target.size,
        triggerPrice: params.stopLossPrice,
        kind: "sl",
        positionMode
      });
    }
    return { ok: true };
  }

  async closePosition(params: ClosePositionParams): Promise<{ orderIds: string[] }> {
    this.assertWriteEnabled();
    const targetSymbol = toCanonicalFallbackSymbol(params.symbol);
    const positions = await this.getPositions();
    const targets = positions
      .filter((row) => row.symbol === targetSymbol)
      .filter((row) => row.size > 0)
      .filter((row) => (params.side ? row.side === params.side : true));

    const orderIds: string[] = [];
    for (const position of targets) {
      const placed = await this.placeOrder({
        symbol: position.symbol,
        side: position.side === "long" ? "sell" : "buy",
        type: "market",
        qty: position.size,
        reduceOnly: true
      });
      if (placed.orderId) orderIds.push(placed.orderId);
    }
    return { orderIds };
  }

  async listOpenOrders(params?: { symbol?: string }): Promise<NormalizedOrder[]> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = params?.symbol ? await this.toExchangeSymbol(params.symbol) : undefined;
    const rows = await this.tradeApi.getOpenOrders(exchangeSymbol);
    return rows
      .map((row) => {
        const rawSymbol = String(row.symbol ?? "");
        const symbol = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
        const type = String(row.type ?? row.origType ?? "").toUpperCase();
        return {
          orderId: String(row.orderId ?? row.clientOrderId ?? row.clientOrderID ?? ""),
          symbol,
          side: row.side ? String(row.side).toLowerCase() : null,
          type: type ? type.toLowerCase() : null,
          status: mapOrderStatus(row.status),
          price: toNumber(row.price),
          qty: mapOrderQty(row),
          triggerPrice: toNumber(row.stopPrice),
          takeProfitPrice: getOrderTakeProfitPrice(row),
          stopLossPrice: getOrderStopLossPrice(row),
          reduceOnly: boolish(row.reduceOnly),
          createdAt: toIsoFromMs(row.time ?? row.updateTime),
          raw: row
        } satisfies NormalizedOrder;
      })
      .filter((row) => row.orderId.length > 0);
  }

  async listPositions(params?: { symbol?: string }): Promise<NormalizedPosition[]> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = params?.symbol ? await this.toExchangeSymbol(params.symbol) : undefined;
    const [positionsRaw, openOrdersRaw] = await Promise.all([
      this.accountApi.getPositionRisk(exchangeSymbol),
      this.tradeApi.getOpenOrders(exchangeSymbol).catch(() => [])
    ]);
    const stopOrders = openOrdersRaw.filter((row) => {
      const type = String(row.type ?? row.origType ?? "").toUpperCase();
      return type.includes("STOP") || type.includes("TAKE_PROFIT");
    });
    return positionsRaw
      .map((row) => {
        const mapped = mapPosition(row);
        const side = mapped.side;
        const matchingStops = stopOrders.filter((order) => {
          if (String(order.symbol ?? "").toUpperCase() !== String(row.symbol ?? "").toUpperCase()) return false;
          const positionSide = String(order.positionSide ?? "").toUpperCase();
          if (positionSide === "LONG" && side !== "long") return false;
          if (positionSide === "SHORT" && side !== "short") return false;
          return true;
        });
        const tp = matchingStops.find((order) => String(order.type ?? order.origType ?? "").toUpperCase().includes("TAKE_PROFIT"));
        const sl = matchingStops.find((order) => String(order.type ?? order.origType ?? "").toUpperCase().includes("STOP"));
        return {
          symbol: mapped.symbol,
          side,
          size: mapped.size,
          entryPrice: mapped.entryPrice,
          markPrice: mapped.markPrice ?? null,
          unrealizedPnl: mapped.unrealizedPnl ?? null,
          leverage: mapped.leverage ?? null,
          marginMode: mapped.marginMode ?? null,
          marginUsd: mapped.marginUsd ?? null,
          notionalUsd: mapped.notionalUsd ?? null,
          liquidationPrice: mapped.liquidationPrice ?? null,
          liquidationDistancePct: mapped.liquidationDistancePct ?? null,
          roePct: mapped.roePct ?? null,
          pnlPct: mapped.pnlPct ?? null,
          takeProfitPrice: toNumber(tp?.stopPrice),
          stopLossPrice: toNumber(sl?.stopPrice)
        } satisfies NormalizedPosition;
      })
      .filter((row) => row.symbol.length > 0 && row.size > 0);
  }

  mapError(error: unknown) {
    return mapBingxError(error);
  }

  async subscribeTicker(_symbol: string): Promise<void> {
    // REST-only v1: market snapshots are fetched on demand by callers.
  }

  async subscribeDepth(_symbol: string): Promise<void> {
    // REST-only v1: market snapshots are fetched on demand by callers.
  }

  async subscribeTrades(_symbol: string): Promise<void> {
    // REST-only v1: market snapshots are fetched on demand by callers.
  }

  onTicker(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  onDepth(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  onTrades(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  onFill(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  onPositionUpdate(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  onOrderUpdate(_callback: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
  }

  private async requireContract(symbol: string): Promise<ContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);
    return contract;
  }

  private async requireTradeableContract(symbol: string): Promise<ContractInfo> {
    const contract = await this.requireContract(symbol);
    if (!contract.apiAllowed) {
      throw new TradingNotAllowedError(
        contract.canonicalSymbol,
        `Trading disabled by exchange for ${contract.exchangeSymbol}`
      );
    }
    return contract;
  }

  private assertWriteEnabled() {
    if (this.writeEnabled) return;
    throw new BingxInvalidParamsError("bingx_perp_write_disabled", {
      endpoint: "/openApi/swap/v2/trade/order",
      method: "POST"
    });
  }

  private async resolvePositionMode(): Promise<PositionMode> {
    if (this.positionModeCache && Date.now() - this.positionModeCache.ts < 30_000) {
      return this.positionModeCache.mode;
    }
    const raw: Record<string, unknown> = await this.accountApi.getPositionMode()
      .then((value) => value as Record<string, unknown>)
      .catch(() => ({}));
    const dual =
      raw.dualSidePosition === true
      || raw.dualSidePositionMode === true
      || String(raw.dualSidePosition ?? raw.dualSidePositionMode ?? "").trim().toLowerCase() === "true";
    const mode: PositionMode = dual ? "hedge" : "one-way";
    this.positionModeCache = { mode, ts: Date.now() };
    return mode;
  }

  private buildOrderRequest(intent: NormalizedOrderIntent, positionMode: PositionMode): BingxOrderRequest {
    const payload: BingxOrderRequest = {
      symbol: intent.exchangeSymbol,
      side: toBingxOrderSide(intent.side),
      type: toBingxOrderType(intent.type),
      quantity: intent.normalizedQty,
      clientOrderId: toCanonicalClientOrderId(intent.clientOrderId, "uliq")
    };
    if (intent.type === "limit") {
      payload.price = intent.normalizedPrice;
      payload.timeInForce = "GTC";
    }

    payload.positionSide =
      positionMode === "hedge"
        ? this.resolveOrderPositionSide(intent.side, Boolean(intent.reduceOnly))
        : "BOTH";
    if (intent.reduceOnly) payload.reduceOnly = "true";
    if (!intent.reduceOnly) {
      this.attachEntryTpSl(payload, intent);
    }
    return payload;
  }

  private resolveOrderPositionSide(side: OrderSide, reduceOnly: boolean): "LONG" | "SHORT" {
    if (side === "buy") return reduceOnly ? "SHORT" : "LONG";
    return reduceOnly ? "LONG" : "SHORT";
  }

  private attachEntryTpSl(payload: BingxOrderRequest, intent: NormalizedOrderIntent): void {
    const contract = intent.metadata.contract as ContractInfo | undefined;
    if (!contract) return;
    const tickSize = deriveTickSize(contract);
    if (!tickSize) return;
    if (intent.takeProfitPrice) {
      const trigger = roundPriceToTick(intent.takeProfitPrice, tickSize, "nearest");
      payload.takeProfit = JSON.stringify({
        type: "TAKE_PROFIT_MARKET",
        stopPrice: trigger,
        workingType: "MARK_PRICE"
      });
    }
    if (intent.stopLossPrice) {
      const trigger = roundPriceToTick(intent.stopLossPrice, tickSize, "nearest");
      payload.stopLoss = JSON.stringify({
        type: "STOP_MARKET",
        stopPrice: trigger,
        workingType: "MARK_PRICE"
      });
    }
  }

  private async placeConditionalCloseOrder(params: {
    contract: ContractInfo;
    side: "long" | "short";
    closeQty: number;
    triggerPrice: number;
    kind: "tp" | "sl";
    positionMode: PositionMode;
  }): Promise<void> {
    const tickSize = deriveTickSize(params.contract);
    if (!tickSize) throw new InvalidTickError(params.contract.canonicalSymbol);
    const stepSize = deriveStepSize(params.contract);
    if (!stepSize) throw new InvalidStepError(params.contract.canonicalSymbol);
    const stopPrice = roundPriceToTick(params.triggerPrice, tickSize, "nearest");
    const quantity = roundQtyToStep(params.closeQty, stepSize, "down");
    const closeSide: OrderSide = params.side === "long" ? "sell" : "buy";
    const payload: BingxOrderRequest = {
      symbol: params.contract.exchangeSymbol,
      side: toBingxOrderSide(closeSide),
      type: params.kind === "tp" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET",
      quantity,
      stopPrice,
      workingType: "MARK_PRICE",
      closePosition: "true",
      clientOrderId: toManagedClientOrderId(params.kind, params.contract.canonicalSymbol, params.side)
    };
    payload.positionSide = params.positionMode === "hedge"
      ? params.side === "long" ? "LONG" : "SHORT"
      : "BOTH";
    if (params.positionMode === "one-way") payload.reduceOnly = "true";
    await this.tradeApi.placeOrder(payload);
  }

  private async cancelManagedTpSlOrders(exchangeSymbol: string, side?: "long" | "short"): Promise<void> {
    const openOrders = await this.tradeApi.getOpenOrders(exchangeSymbol).catch(() => []);
    for (const order of openOrders) {
      if (!isManagedTpSlOrder(order, exchangeSymbol, side)) continue;
      const orderId = String(order.orderId ?? "");
      if (!orderId) continue;
      await this.tradeApi.cancelOrder({ symbol: exchangeSymbol, orderId }).catch(() => undefined);
    }
  }
}

function pickBalanceNumber(balance: BingxBalance | undefined, ...keys: Array<keyof BingxBalance>): number | null {
  if (!balance) return null;
  for (const key of keys) {
    const parsed = toNumber(balance[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}
