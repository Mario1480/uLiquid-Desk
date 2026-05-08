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
import WebSocket from "ws";
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
import { mapBinanceError } from "./binance-error.mapper.js";
import { BinanceAccountApi } from "./binance.account.api.js";
import {
  BINANCE_USDM_DEFAULT_WS_URL,
  BINANCE_USDM_DEFAULT_MARGIN_COIN,
  BINANCE_USDM_DEFAULT_PRODUCT_TYPE
} from "./binance.constants.js";
import { BinanceInvalidParamsError } from "./binance.errors.js";
import { BinanceMarketApi } from "./binance.market.api.js";
import { BinanceRestClient } from "./binance.rest.js";
import { BinanceTradeApi } from "./binance.trade.api.js";
import type {
  BinanceAdapterConfig,
  BinanceContractInfo,
  BinanceExchangeInfoSymbol,
  BinanceFillEvent,
  BinanceOrderEvent,
  BinanceOrderRequest,
  BinanceOrderResponse,
  BinancePositionEvent,
  BinancePositionRisk,
  BinanceWsPayload
} from "./binance.types.js";

type PositionMode = "one-way" | "hedge";

const CLIENT_ID_LIMIT = 36;
const TPSL_CLIENT_ID_PREFIX = "uliq_tpsl";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCanonicalFallbackSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function pickFilter(symbol: { filters?: Array<Record<string, unknown>> }, filterType: string): Record<string, unknown> {
  return symbol.filters?.find((filter) => String(filter.filterType ?? "").toUpperCase() === filterType) ?? {};
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

function toIsoFromMs(value: unknown): string | null {
  const ms = toNumber(value);
  if (ms === null || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function toPositionSide(raw: BinancePositionRisk): "long" | "short" {
  const positionSide = String(raw.positionSide ?? "").toUpperCase();
  if (positionSide === "LONG") return "long";
  if (positionSide === "SHORT") return "short";
  const amt = toNumber(raw.positionAmt) ?? 0;
  return amt < 0 ? "short" : "long";
}

function mapPosition(raw: BinancePositionRisk): FuturesPosition {
  const amt = toNumber(raw.positionAmt) ?? 0;
  const side = toPositionSide(raw);
  const entryPrice = toNumber(raw.entryPrice) ?? 0;
  const markPrice = toNumber(raw.markPrice) ?? undefined;
  const unrealizedPnl = (toNumber(raw.unRealizedProfit) ?? toNumber(raw.unrealizedProfit)) ?? undefined;
  const isolatedMargin = pickFiniteNumber(raw.isolatedMargin, raw.isolatedWallet);
  const notionalUsd = Math.abs(pickFiniteNumber(raw.notional) ?? 0) || null;
  const marginMode =
    normalizePositionMarginMode(raw.marginType) ??
    (String(raw.isIsolated ?? "").trim().toLowerCase() === "true" ? "isolated" : null);
  const riskMetrics = buildPositionRiskMetrics({
    side,
    size: Math.abs(amt),
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage: pickFiniteNumber(raw.leverage),
    marginMode,
    marginUsd: isolatedMargin,
    notionalUsd,
    liquidationPrice: pickFiniteNumber(raw.liquidationPrice)
  });
  return {
    symbol: toCanonicalFallbackSymbol(String(raw.symbol ?? "")),
    side,
    size: Math.abs(amt),
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

function toBinanceOrderSide(side: OrderSide): "BUY" | "SELL" {
  return side === "buy" ? "BUY" : "SELL";
}

function toBinanceOrderType(type: OrderType): "MARKET" | "LIMIT" {
  return type === "market" ? "MARKET" : "LIMIT";
}

function toCanonicalClientOrderId(value: string | undefined, fallbackPrefix: string): string {
  const raw = String(value ?? "").trim() || `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  return raw.replace(/[^.A-Za-z0-9_:/-]/g, "_").slice(0, CLIENT_ID_LIMIT);
}

function toManagedClientOrderId(kind: "tp" | "sl", symbol: string, side: "long" | "short"): string {
  return toCanonicalClientOrderId(`${TPSL_CLIENT_ID_PREFIX}_${kind}_${side}_${symbol}_${Date.now()}`, "uliq");
}

function isManagedTpSlOrder(row: BinanceOrderResponse, symbol?: string, side?: "long" | "short"): boolean {
  const clientOrderId = String(row.clientOrderId ?? "");
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

function mapOrderQty(row: BinanceOrderResponse): number | null {
  const orig = toNumber(row.origQty);
  const executed = toNumber(row.executedQty) ?? 0;
  if (orig === null) return null;
  return Number(Math.max(0, orig - executed).toFixed(12));
}

function pickOrderId(response: BinanceOrderResponse): string | null {
  const candidates = [response.orderId, response.clientOrderId];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }
  return null;
}

function toMarginType(mode: MarginMode): "CROSSED" | "ISOLATED" {
  return mode === "isolated" ? "ISOLATED" : "CROSSED";
}

function toMarginModeFromPosition(row: BinancePositionRisk): MarginMode | undefined {
  const isolatedMargin = toNumber(row.isolatedMargin);
  const isolatedWallet = toNumber(row.isolatedWallet);
  if ((isolatedMargin !== null && isolatedMargin > 0) || (isolatedWallet !== null && isolatedWallet > 0)) {
    return "isolated";
  }
  return undefined;
}

export function toBinanceContractInfo(detail: BinanceExchangeInfoSymbol): BinanceContractInfo {
  const exchangeSymbol = String((detail as { symbol?: unknown }).symbol ?? "").trim().toUpperCase();
  const canonicalSymbol = toCanonicalFallbackSymbol(exchangeSymbol);
  const priceFilter = pickFilter(detail, "PRICE_FILTER");
  const lotSize = pickFilter(detail, "LOT_SIZE");
  const marketLotSize = pickFilter(detail, "MARKET_LOT_SIZE");
  const notionalFilter = pickFilter(detail, "MIN_NOTIONAL");
  const tickSize = toNumber(priceFilter.tickSize);
  const stepSize = toNumber(lotSize.stepSize);
  const minQty = toNumber(lotSize.minQty) ?? toNumber(marketLotSize.minQty);
  const maxQty = toNumber(lotSize.maxQty) ?? toNumber(marketLotSize.maxQty);

  return {
    canonicalSymbol,
    exchangeSymbol,
    baseAsset: String((detail as { baseAsset?: unknown }).baseAsset ?? "") || undefined,
    quoteAsset: String((detail as { quoteAsset?: unknown }).quoteAsset ?? "") || undefined,
    minVol: minQty,
    maxVol: maxQty,
    tickSize,
    stepSize,
    priceScale: countScale(tickSize),
    volScale: countScale(stepSize),
    priceUnit: tickSize,
    volUnit: stepSize,
    contractSize: 1,
    minLeverage: 1,
    maxLeverage: 125,
    apiAllowed:
      String((detail as { status?: unknown }).status ?? "").toUpperCase() === "TRADING"
      && String((detail as { contractType?: unknown }).contractType ?? "").toUpperCase() === "PERPETUAL",
    makerFeeRate: null,
    takerFeeRate: null,
    minNotional: toNumber(notionalFilter.notional) ?? toNumber(notionalFilter.minNotional),
    updatedAt: new Date().toISOString(),
    raw: detail as any
  };
}

export class BinanceFuturesAdapter implements FuturesExchange {
  readonly exchangeId = "binance" as const;
  readonly productType: string;
  readonly marginCoin: string;
  readonly writeEnabled: boolean;

  readonly rest: BinanceRestClient;
  readonly marketApi: BinanceMarketApi;
  readonly accountApi: BinanceAccountApi;
  readonly tradingApi: BinanceTradeApi;
  readonly tradeApi: BinanceTradeApi;
  readonly contractCache: ContractCache;
  readonly positionApi: {
    getAllPositions: (params?: { symbol?: string }) => Promise<Array<Record<string, unknown>>>;
  };

  private positionModeCache: { mode: PositionMode; ts: number } | null = null;
  private publicWs: WebSocket | null = null;
  private publicWsReady: Promise<void> | null = null;
  private privateWs: WebSocket | null = null;
  private privateWsReady: Promise<void> | null = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private readonly publicSubscriptions = new Set<string>();
  private readonly tickerHandlers = new Set<(payload: BinanceWsPayload) => void>();
  private readonly depthHandlers = new Set<(payload: BinanceWsPayload) => void>();
  private readonly klineHandlers = new Set<(payload: BinanceWsPayload) => void>();
  private readonly tradeHandlers = new Set<(payload: BinanceWsPayload) => void>();
  private readonly fillHandlers = new Set<(payload: BinanceFillEvent) => void>();
  private readonly positionHandlers = new Set<(payload: BinancePositionEvent) => void>();
  private readonly orderHandlers = new Set<(payload: BinanceOrderEvent) => void>();

  constructor(private readonly config: BinanceAdapterConfig = {}) {
    this.productType = config.productType ?? process.env.BINANCE_PRODUCT_TYPE ?? BINANCE_USDM_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? process.env.BINANCE_MARGIN_COIN ?? BINANCE_USDM_DEFAULT_MARGIN_COIN;
    this.writeEnabled = config.writeEnabled ?? !["0", "false", "off", "no"].includes(
      String(process.env.BINANCE_PERP_WRITE_ENABLED ?? "0").trim().toLowerCase()
    );

    this.rest = new BinanceRestClient(config);
    this.marketApi = new BinanceMarketApi(this.rest);
    this.accountApi = new BinanceAccountApi(this.rest);
    this.tradingApi = new BinanceTradeApi(this.rest);
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
        const raw = await this.marketApi.getExchangeInfo();
        const details = Array.isArray(raw.symbols) ? raw.symbols : [];
        return details
          .filter((row) => Boolean(row?.symbol))
          .map((row) => toBinanceContractInfo(row));
      }
    };

    this.contractCache = new ContractCache(cacheOptions);
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/fapi/v1/exchangeInfo",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `contract cache warmup failed: ${String(error)}`
      });
    });
  }

  async getAccountState(): Promise<AccountState> {
    const account = await this.accountApi.getAccount();
    const equity =
      toNumber(account.totalMarginBalance)
      ?? toNumber(account.totalWalletBalance)
      ?? (account.assets ?? []).reduce((sum, asset) => sum + (toNumber(asset.marginBalance) ?? toNumber(asset.walletBalance) ?? 0), 0);
    const available =
      toNumber(account.availableBalance)
      ?? (account.assets ?? []).reduce((sum, asset) => sum + (toNumber(asset.availableBalance) ?? 0), 0);
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
    await this.accountApi.setLeverage(contract.exchangeSymbol, leverage);
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
      context: {
        source: "manual_api"
      }
    });
    await this.validateOrderIntent(normalized);
    return this.placeNormalizedOrder(normalized);
  }

  async normalizeOrderIntent(intent: OrderIntent): Promise<NormalizedOrderIntent> {
    const contract = await this.requireTradeableContract(intent.symbol);
    const stepSize = deriveStepSize(contract);
    if (!stepSize) {
      throw new InvalidStepError(contract.canonicalSymbol, `Missing step size for ${contract.canonicalSymbol}`);
    }

    let qty = roundQtyToStep(intent.qty, stepSize, "down");
    qty = clampQty(qty, contract.minVol, contract.maxVol);

    let normalizedPrice: number | undefined;
    if (intent.type === "limit") {
      if (!Number.isFinite(intent.price) || (intent.price ?? 0) <= 0) {
        throw new BinanceInvalidParamsError("Limit order requires a positive price", {
          endpoint: "/fapi/v1/order",
          method: "POST"
        });
      }
      const tickSize = deriveTickSize(contract);
      if (!tickSize) {
        throw new InvalidTickError(contract.canonicalSymbol, `Missing tick size for ${contract.canonicalSymbol}`);
      }
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
        minNotional: (contract as BinanceContractInfo).minNotional ?? null
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

    const minNotional = (contract as BinanceContractInfo).minNotional ?? null;
    const price = intent.normalizedPrice ?? intent.price;
    if (minNotional !== null && Number.isFinite(minNotional) && minNotional > 0 && Number.isFinite(price) && (price ?? 0) > 0) {
      const notional = intent.normalizedQty * (price ?? 0);
      if (notional < minNotional) {
        throw new BinanceInvalidParamsError(`Order notional ${notional} below minNotional ${minNotional}`, {
          endpoint: "/fapi/v1/order",
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
      throw new BinanceInvalidParamsError("Binance did not return order id", {
        endpoint: "/fapi/v1/order",
        method: "POST"
      });
    }

    if (!intent.reduceOnly && (intent.takeProfitPrice || intent.stopLossPrice)) {
      await this.placeEntryTpSlOrders(intent, positionMode).catch((error) => {
        this.config.log?.({
          at: new Date().toISOString(),
          endpoint: "/fapi/v1/order",
          method: "POST",
          durationMs: 0,
          ok: false,
          message: `entry TP/SL placement failed: ${String(error)}`
        });
      });
    }

    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId,
      clientOrderId: payload.newClientOrderId
    };
  }

  async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    this.assertWriteEnabled();
    const open = await this.listOpenOrders();
    const found = open.find((row) => row.orderId === orderId);
    if (!found) {
      throw new BinanceInvalidParamsError("symbol_required_for_order_cancel", {
        endpoint: "/fapi/v1/order",
        method: "DELETE"
      });
    }
    return this.cancelOrderByParams({ orderId, symbol: found.symbol });
  }

  async cancelOrderByParams(params: { orderId: string; symbol?: string }): Promise<CancelOrderResult> {
    this.assertWriteEnabled();
    const exchangeSymbol = params.symbol ? await this.toExchangeSymbol(params.symbol) : null;
    if (!exchangeSymbol) {
      throw new BinanceInvalidParamsError("symbol_required_for_order_cancel", {
        endpoint: "/fapi/v1/order",
        method: "DELETE"
      });
    }
    await this.tradeApi.cancelOrder({
      symbol: exchangeSymbol,
      orderId: params.orderId
    });
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
    if (String(current.type ?? "").toUpperCase() !== "LIMIT") {
      throw new BinanceInvalidParamsError("Only LIMIT orders can be edited on Binance USD-M", {
        endpoint: "/fapi/v1/order",
        method: "PUT"
      });
    }
    const side = String(current.side ?? "BUY").toUpperCase() === "SELL" ? "sell" : "buy";
    const price = params.price ?? toNumber(current.price) ?? 0;
    const qty = params.qty ?? toNumber(current.origQty) ?? 0;
    const normalized = await this.normalizeOrderIntent({
      symbol: contract.canonicalSymbol,
      side,
      type: "limit",
      qty,
      price,
      context: {
        source: "manual_api",
        reason: "edit_order"
      }
    });
    await this.validateOrderIntent(normalized);
    const result = await this.tradeApi.modifyOrder({
      symbol: contract.exchangeSymbol,
      orderId: params.orderId,
      side: toBinanceOrderSide(side),
      quantity: normalized.normalizedQty,
      price: normalized.normalizedPrice ?? price
    });
    return {
      status: "confirmed",
      submitted: true,
      confirmationSource: "venue_ack",
      receiptStatus: "unknown",
      orderId: String(result.orderId ?? params.orderId),
      clientOrderId: result.clientOrderId
    };
  }

  async setPositionTpSl(params: PositionTpSlParams): Promise<{ ok: true }> {
    this.assertWriteEnabled();
    const contract = await this.requireTradeableContract(params.symbol);
    const positions = await this.listPositions({ symbol: contract.canonicalSymbol });
    const target = positions.find((row) => (params.side ? row.side === params.side : true));
    if (!target || target.size <= 0) {
      throw new BinanceInvalidParamsError("position_side_required", {
        endpoint: "/fapi/v1/order",
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
        return {
          orderId: String(row.orderId ?? row.clientOrderId ?? ""),
          symbol,
          side: row.side ? String(row.side).toLowerCase() : null,
          type: row.type ? String(row.type).toLowerCase() : row.origType ? String(row.origType).toLowerCase() : null,
          status: mapOrderStatus(row.status),
          price: toNumber(row.price),
          qty: mapOrderQty(row),
          triggerPrice: toNumber(row.stopPrice),
          takeProfitPrice: String(row.type ?? row.origType ?? "").includes("TAKE_PROFIT") ? toNumber(row.stopPrice) : null,
          stopLossPrice: String(row.type ?? row.origType ?? "").includes("STOP") ? toNumber(row.stopPrice) : null,
          reduceOnly: typeof row.reduceOnly === "boolean" ? row.reduceOnly : null,
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
    const stopOrders = openOrdersRaw.filter((row) => String(row.type ?? row.origType ?? "").includes("STOP") || String(row.type ?? row.origType ?? "").includes("TAKE_PROFIT"));
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
        const tp = matchingStops.find((order) => String(order.type ?? order.origType ?? "").includes("TAKE_PROFIT"));
        const sl = matchingStops.find((order) => String(order.type ?? order.origType ?? "").includes("STOP"));
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
    return mapBinanceError(error);
  }

  async subscribeTicker(symbol: string): Promise<void> {
    await this.subscribePublicStream(`${(await this.toExchangeSymbol(symbol)).toLowerCase()}@bookTicker`);
  }

  async subscribeDepth(symbol: string): Promise<void> {
    await this.subscribePublicStream(`${(await this.toExchangeSymbol(symbol)).toLowerCase()}@depth20@100ms`);
  }

  async subscribeKline(symbol: string, interval: string): Promise<void> {
    await this.subscribePublicStream(`${(await this.toExchangeSymbol(symbol)).toLowerCase()}@kline_${interval || "1m"}`);
  }

  async subscribeTrades(symbol: string): Promise<void> {
    await this.subscribePublicStream(`${(await this.toExchangeSymbol(symbol)).toLowerCase()}@trade`);
  }

  onTicker(callback: (payload: BinanceWsPayload) => void): () => void {
    this.tickerHandlers.add(callback);
    return () => { this.tickerHandlers.delete(callback); };
  }

  onDepth(callback: (payload: BinanceWsPayload) => void): () => void {
    this.depthHandlers.add(callback);
    return () => { this.depthHandlers.delete(callback); };
  }

  onKline(callback: (payload: BinanceWsPayload) => void): () => void {
    this.klineHandlers.add(callback);
    return () => { this.klineHandlers.delete(callback); };
  }

  onTrades(callback: (payload: BinanceWsPayload) => void): () => void {
    this.tradeHandlers.add(callback);
    return () => { this.tradeHandlers.delete(callback); };
  }
  onFill(callback: (event: BinanceFillEvent) => void): () => void {
    this.fillHandlers.add(callback);
    void this.ensurePrivateWs().catch(() => undefined);
    return () => { this.fillHandlers.delete(callback); };
  }

  onPositionUpdate(callback: (event: BinancePositionEvent) => void): () => void {
    this.positionHandlers.add(callback);
    void this.ensurePrivateWs().catch(() => undefined);
    return () => { this.positionHandlers.delete(callback); };
  }

  onOrderUpdate(callback: (event: BinanceOrderEvent) => void): () => void {
    this.orderHandlers.add(callback);
    void this.ensurePrivateWs().catch(() => undefined);
    return () => { this.orderHandlers.delete(callback); };
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    if (this.publicWs) {
      this.publicWs.close();
      this.publicWs = null;
      this.publicWsReady = null;
    }
    if (this.listenKeyKeepAlive) {
      clearInterval(this.listenKeyKeepAlive);
      this.listenKeyKeepAlive = null;
    }
    const listenKey = this.listenKey;
    this.listenKey = null;
    if (this.privateWs) {
      this.privateWs.close();
      this.privateWs = null;
      this.privateWsReady = null;
    }
    if (listenKey) {
      await this.accountApi.closeUserDataStream(listenKey).catch(() => undefined);
    }
  }

  private async ensurePublicWs(): Promise<WebSocket> {
    if (this.publicWs && this.publicWs.readyState === WebSocket.OPEN) return this.publicWs;
    if (this.publicWsReady) {
      await this.publicWsReady;
      if (this.publicWs) return this.publicWs;
    }

    const wsUrl = (this.config.wsUrl ?? process.env.BINANCE_PERP_WS_URL ?? BINANCE_USDM_DEFAULT_WS_URL).replace(/\/+$/, "");
    const ws = new WebSocket(wsUrl);
    this.publicWs = ws;
    this.publicWsReady = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
    }).finally(() => {
      this.publicWsReady = null;
    });

    ws.on("message", (data) => this.dispatchPublicWsMessage(data));
    ws.on("close", () => {
      if (this.publicWs === ws) this.publicWs = null;
    });

    await this.publicWsReady;
    if (this.publicSubscriptions.size > 0) {
      this.sendPublicSubscribe([...this.publicSubscriptions]);
    }
    return ws;
  }

  private async subscribePublicStream(stream: string): Promise<void> {
    this.publicSubscriptions.add(stream);
    const ws = await this.ensurePublicWs();
    if (ws.readyState === WebSocket.OPEN) {
      this.sendPublicSubscribe([stream]);
    }
  }

  private sendPublicSubscribe(params: string[]): void {
    if (!this.publicWs || this.publicWs.readyState !== WebSocket.OPEN || params.length === 0) return;
    this.publicWs.send(JSON.stringify({
      method: "SUBSCRIBE",
      params,
      id: Date.now()
    }));
  }

  private dispatchPublicWsMessage(data: WebSocket.RawData): void {
    let payload: BinanceWsPayload | null = null;
    try {
      const parsed = JSON.parse(data.toString());
      payload = this.normalizeWsPayloadSymbol((parsed?.data ?? parsed) as BinanceWsPayload);
    } catch {
      return;
    }
    if (!payload) return;
    const eventType = String(payload.e ?? payload.eventType ?? "").toLowerCase();
    if (eventType === "bookticker") {
      for (const callback of this.tickerHandlers) callback(payload);
      return;
    }
    if (eventType === "depthupdate") {
      for (const callback of this.depthHandlers) callback(payload);
      return;
    }
    if (eventType === "kline") {
      for (const callback of this.klineHandlers) callback(payload);
      return;
    }
    if (eventType === "trade" || eventType === "aggtrade") {
      for (const callback of this.tradeHandlers) callback(payload);
    }
  }

  private normalizeWsPayloadSymbol(payload: BinanceWsPayload): BinanceWsPayload {
    const rawSymbol = typeof payload.s === "string" ? payload.s : typeof payload.symbol === "string" ? payload.symbol : null;
    if (!rawSymbol) return payload;
    const canonical = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
    return {
      ...payload,
      symbol: canonical
    };
  }

  private async ensurePrivateWs(): Promise<WebSocket> {
    if (this.privateWs && this.privateWs.readyState === WebSocket.OPEN) return this.privateWs;
    if (this.privateWsReady) {
      await this.privateWsReady;
      if (this.privateWs) return this.privateWs;
    }
    const started = await this.accountApi.startUserDataStream();
    const listenKey = String(started.listenKey ?? "").trim();
    if (!listenKey) {
      throw new BinanceInvalidParamsError("listen_key_missing", {
        endpoint: "/fapi/v1/listenKey",
        method: "POST"
      });
    }
    this.listenKey = listenKey;
    if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);
    this.listenKeyKeepAlive = setInterval(() => {
      const current = this.listenKey;
      if (current) void this.accountApi.keepAliveUserDataStream(current).catch(() => undefined);
    }, 30 * 60_000);

    const wsUrl = `${(this.config.wsUrl ?? process.env.BINANCE_PERP_WS_URL ?? BINANCE_USDM_DEFAULT_WS_URL).replace(/\/+$/, "")}/${listenKey}`;
    const ws = new WebSocket(wsUrl);
    this.privateWs = ws;
    this.privateWsReady = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
    }).finally(() => {
      this.privateWsReady = null;
    });

    ws.on("message", (data) => this.dispatchPrivateWsMessage(data));
    ws.on("close", () => {
      if (this.privateWs === ws) this.privateWs = null;
    });

    await this.privateWsReady;
    return ws;
  }

  private dispatchPrivateWsMessage(data: WebSocket.RawData): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const eventType = String(payload.e ?? "").toUpperCase();
    if (eventType === "ORDER_TRADE_UPDATE") {
      const order = (payload.o && typeof payload.o === "object" ? payload.o : {}) as Record<string, unknown>;
      const rawSymbol = String(order.s ?? "");
      const symbol = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
      const orderId = String(order.i ?? order.c ?? "");
      if (orderId) {
        const orderEvent: BinanceOrderEvent = {
          orderId,
          symbol,
          status: String(order.X ?? order.x ?? ""),
          raw: payload
        };
        for (const callback of this.orderHandlers) callback(orderEvent);
      }
      const lastQty = toNumber(order.l) ?? 0;
      if (lastQty > 0) {
        const fillEvent: BinanceFillEvent = {
          orderId,
          symbol,
          side: order.S ? String(order.S).toLowerCase() : undefined,
          price: toNumber(order.L) ?? undefined,
          qty: lastQty,
          raw: payload
        };
        for (const callback of this.fillHandlers) callback(fillEvent);
      }
      return;
    }
    if (eventType === "ACCOUNT_UPDATE") {
      const account = (payload.a && typeof payload.a === "object" ? payload.a : {}) as Record<string, unknown>;
      const positions = Array.isArray(account.P) ? account.P : [];
      for (const row of positions) {
        if (!row || typeof row !== "object") continue;
        const position = row as Record<string, unknown>;
        const rawSymbol = String(position.s ?? "");
        const symbol = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
        const amt = toNumber(position.pa) ?? 0;
        const event: BinancePositionEvent = {
          symbol,
          side: amt < 0 ? "short" : "long",
          size: Math.abs(amt),
          raw: payload
        };
        for (const callback of this.positionHandlers) callback(event);
      }
    }
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
        `Trading disabled by exchange for ${contract.exchangeSymbol} (status not TRADING/PERPETUAL)`
      );
    }
    return contract;
  }

  private assertWriteEnabled() {
    if (this.writeEnabled) return;
    throw new BinanceInvalidParamsError("binance_perp_write_disabled", {
      endpoint: "/fapi/v1/order",
      method: "POST"
    });
  }

  private async resolvePositionMode(): Promise<PositionMode> {
    if (this.positionModeCache && Date.now() - this.positionModeCache.ts < 30_000) {
      return this.positionModeCache.mode;
    }
    const raw = await this.accountApi.getPositionMode();
    const dual =
      raw.dualSidePosition === true
      || String(raw.dualSidePosition ?? "").trim().toLowerCase() === "true";
    const mode: PositionMode = dual ? "hedge" : "one-way";
    this.positionModeCache = { mode, ts: Date.now() };
    return mode;
  }

  private buildOrderRequest(intent: NormalizedOrderIntent, positionMode: PositionMode): BinanceOrderRequest {
    const payload: BinanceOrderRequest = {
      symbol: intent.exchangeSymbol,
      side: toBinanceOrderSide(intent.side),
      type: toBinanceOrderType(intent.type),
      quantity: intent.normalizedQty,
      newClientOrderId: toCanonicalClientOrderId(intent.clientOrderId, "uliq"),
      newOrderRespType: "ACK"
    };
    if (intent.type === "limit") {
      payload.price = intent.normalizedPrice;
      payload.timeInForce = "GTC";
    }

    if (positionMode === "hedge") {
      payload.positionSide = this.resolveOrderPositionSide(intent.side, Boolean(intent.reduceOnly));
    } else if (intent.reduceOnly) {
      payload.reduceOnly = "true";
    }
    return payload;
  }

  private resolveOrderPositionSide(side: OrderSide, reduceOnly: boolean): "LONG" | "SHORT" {
    if (side === "buy") return reduceOnly ? "SHORT" : "LONG";
    return reduceOnly ? "LONG" : "SHORT";
  }

  private async placeEntryTpSlOrders(intent: NormalizedOrderIntent, positionMode: PositionMode): Promise<void> {
    const contract = intent.metadata.contract as ContractInfo | undefined;
    if (!contract) return;
    const positionSide = intent.side === "buy" ? "long" : "short";
    if (intent.takeProfitPrice) {
      await this.placeConditionalCloseOrder({
        contract,
        side: positionSide,
        closeQty: intent.normalizedQty,
        triggerPrice: intent.takeProfitPrice,
        kind: "tp",
        positionMode
      });
    }
    if (intent.stopLossPrice) {
      await this.placeConditionalCloseOrder({
        contract,
        side: positionSide,
        closeQty: intent.normalizedQty,
        triggerPrice: intent.stopLossPrice,
        kind: "sl",
        positionMode
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
    const payload: BinanceOrderRequest = {
      symbol: params.contract.exchangeSymbol,
      side: toBinanceOrderSide(closeSide),
      type: params.kind === "tp" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET",
      quantity,
      stopPrice,
      workingType: "MARK_PRICE",
      newClientOrderId: toManagedClientOrderId(params.kind, params.contract.canonicalSymbol, params.side)
    };
    if (params.positionMode === "hedge") {
      payload.positionSide = params.side === "long" ? "LONG" : "SHORT";
    } else {
      payload.reduceOnly = "true";
    }
    await this.tradeApi.placeOrder(payload);
  }

  private async cancelManagedTpSlOrders(exchangeSymbol: string, side?: "long" | "short"): Promise<void> {
    const openOrders = await this.tradeApi.getOpenOrders(exchangeSymbol).catch(() => []);
    for (const order of openOrders) {
      if (!isManagedTpSlOrder(order, exchangeSymbol, side)) continue;
      const orderId = String(order.orderId ?? "");
      if (!orderId) continue;
      await this.tradeApi.cancelOrder({
        symbol: exchangeSymbol,
        orderId
      }).catch(() => undefined);
    }
  }
}
