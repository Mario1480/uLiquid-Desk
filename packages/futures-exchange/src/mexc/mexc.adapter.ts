import type {
  AccountState,
  ContractInfo,
  ContractCacheOptions,
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
  FuturesExchange,
  PlaceOrderRequest,
  PlaceOrderResult
} from "../futures-exchange.interface.js";
import type {
  ClosePositionParams,
  EditOrderParams,
  NormalizedOrder,
  NormalizedPosition,
  PositionTpSlParams
} from "../core/order-normalization.types.js";
import {
  buildPositionRiskMetrics,
  normalizePositionMarginMode,
  pickFiniteNumber
} from "../core/position-metrics.js";
import { MexcInvalidParamsError, MexcMaintenanceError } from "./mexc.errors.js";
import { MexcAccountApi } from "./mexc.account.api.js";
import { MEXC_DEFAULT_MARGIN_COIN, MEXC_DEFAULT_PRODUCT_TYPE } from "./mexc.constants.js";
import { MexcMarketApi } from "./mexc.market.api.js";
import { MexcRestClient } from "./mexc.rest.js";
import { createDefaultMexcCapabilities, MexcTradingApi } from "./mexc.trading.api.js";
import type {
  MexcAdapterConfig,
  MexcCapabilities,
  MexcContractDetail,
  MexcContractInfo,
  MexcFillEvent,
  MexcOrderEvent,
  MexcOrderResponse,
  MexcPlaceOrderRequest,
  MexcPositionEvent,
  MexcPositionRaw,
  MexcWsPayload
} from "./mexc.types.js";
import { MexcPrivateWsApi } from "./mexc.ws.private.js";
import { MexcPublicWsApi } from "./mexc.ws.public.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCanonicalFallbackSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function toPositionSide(raw: unknown): "long" | "short" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "long" || value.includes("long")) return "long";
  return "short";
}

function toMarginMode(raw: unknown): MarginMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "1" || value === "isolated") return "isolated";
  if (value === "2" || value === "cross") return "cross";
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function toOrderRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  const record = toRecord(value);
  const candidates = [record.entrustedList, record.orderList, record.list, record.rows, record.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function toIsoFromMs(value: unknown): string | null {
  const ms = toNumber(value);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

function toPositionId(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  return text.length > 0 ? text : null;
}

function toReduceOnly(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "yes") return true;
  if (text === "false" || text === "no") return false;
  return null;
}

function pickPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function mergeCapabilities(input?: Partial<MexcCapabilities>): MexcCapabilities {
  return {
    ...createDefaultMexcCapabilities(),
    ...(input ?? {})
  };
}

function toMexcOrderType(type: OrderType): number {
  return type === "market" ? 5 : 1;
}

function toMexcOrderSide(side: OrderSide, reduceOnly: boolean): number {
  if (side === "buy") {
    return reduceOnly ? 4 : 1;
  }
  return reduceOnly ? 2 : 3;
}

function toMexcOpenType(mode: MarginMode): number {
  return mode === "isolated" ? 1 : 2;
}

function fromMexcOrderSide(value: unknown): OrderSide | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1" || normalized === "4" || normalized === "buy") return "buy";
  if (normalized === "2" || normalized === "3" || normalized === "sell") return "sell";
  return null;
}

function isMexcCloseSide(value: unknown): boolean {
  const normalized = String(value ?? "").trim();
  return normalized === "2" || normalized === "4";
}

function isMexcLimitOrder(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "limit";
}

function mapPosition(raw: MexcPositionRaw): FuturesPosition {
  const size = toNumber(raw.holdVol) ?? toNumber(raw.positionVol) ?? 0;
  const side = toPositionSide(raw.positionType);
  const entryPrice = toNumber(raw.openAvgPrice) ?? toNumber(raw.holdAvgPrice) ?? toNumber(raw.avgPrice) ?? 0;
  const markPrice = toNumber(raw.fairPrice) ?? undefined;
  const unrealizedPnl = toNumber(raw.unrealizedPnl) ?? undefined;
  const marginMode = normalizePositionMarginMode(raw.openType ?? raw.marginMode) ?? undefined;
  const leverage = toNumber(raw.leverage) ?? undefined;

  return {
    symbol: toCanonicalFallbackSymbol(String(raw.symbol ?? "")),
    side,
    size,
    entryPrice,
    markPrice,
    unrealizedPnl,
    leverage,
    marginMode,
    marginUsd: pickFiniteNumber(raw.positionMargin, raw.marginUsd, raw.margin) ?? undefined,
    notionalUsd: pickFiniteNumber(raw.positionValue, raw.notionalValue, raw.notional) ?? undefined,
    liquidationPrice: pickFiniteNumber(raw.liquidatePrice, raw.liquidationPrice, raw.liqPrice) ?? undefined,
    roePct: pickFiniteNumber(raw.roe, raw.returnOnEquity) ?? undefined
  };
}

function pickOrderId(response: MexcOrderResponse): string | null {
  const candidates = [response.orderId, response.order_id, response.externalOid];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

export function toMexcContractInfo(detail: MexcContractDetail): MexcContractInfo {
  const exchangeSymbol = String(detail.symbol ?? "").trim().toUpperCase();
  const canonicalSymbol = toCanonicalFallbackSymbol(exchangeSymbol);

  return {
    canonicalSymbol,
    exchangeSymbol,
    baseAsset: detail.baseCoin,
    quoteAsset: detail.quoteCoin,
    minVol: toNumber(detail.minVol),
    maxVol: toNumber(detail.maxVol),
    tickSize: toNumber(detail.priceUnit),
    stepSize: toNumber(detail.volUnit),
    priceScale: toNumber(detail.priceScale),
    volScale: toNumber(detail.volScale),
    priceUnit: toNumber(detail.priceUnit),
    volUnit: toNumber(detail.volUnit),
    contractSize: toNumber(detail.contractSize),
    minLeverage: toNumber(detail.minLeverage),
    maxLeverage: toNumber(detail.maxLeverage),
    apiAllowed: detail.apiAllowed !== false,
    makerFeeRate: toNumber(detail.makerFeeRate),
    takerFeeRate: toNumber(detail.takerFeeRate),
    updatedAt: new Date().toISOString(),
    raw: detail
  };
}

export class MexcFuturesAdapter implements FuturesExchange {
  readonly exchangeId = "mexc" as const;
  readonly capabilities: MexcCapabilities;

  readonly productType: string;
  readonly marginCoin: string;

  readonly rest: MexcRestClient;
  readonly marketApi: MexcMarketApi;
  readonly accountApi: MexcAccountApi;
  readonly tradingApi: MexcTradingApi;
  readonly tradeApi: MexcTradingApi;
  readonly positionApi: {
    getAllPositions: (
      params?: { productType?: string; marginCoin?: string; symbol?: string }
    ) => Promise<Array<Record<string, unknown>>>;
  };

  private readonly publicWs: MexcPublicWsApi;
  private readonly privateWs: MexcPrivateWsApi | null;
  readonly contractCache: ContractCache;

  private resolveContractSize(symbol: string): number {
    const contract = this.contractCache.snapshot().find((row) => row.canonicalSymbol === symbol);
    const contractSize = Number(contract?.contractSize ?? 0);
    if (!Number.isFinite(contractSize) || contractSize <= 0) return 1;
    return contractSize;
  }

  constructor(private readonly config: MexcAdapterConfig = {}) {
    this.productType = config.productType ?? process.env.MEXC_PRODUCT_TYPE ?? MEXC_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? process.env.MEXC_MARGIN_COIN ?? MEXC_DEFAULT_MARGIN_COIN;
    this.capabilities = mergeCapabilities(config.capabilities);

    this.rest = new MexcRestClient(config);
    this.marketApi = new MexcMarketApi(this.rest);
    this.accountApi = new MexcAccountApi(this.rest);
    this.tradingApi = new MexcTradingApi(this.rest, this.capabilities);
    this.tradeApi = this.tradingApi;
    this.positionApi = {
      getAllPositions: async (params) => {
        const normalized = await this.listPositions({
          symbol: params?.symbol
            ? this.toCanonicalSymbol(params.symbol) ?? toCanonicalFallbackSymbol(params.symbol)
            : undefined
        });
        return normalized.map((row) => ({
          symbol: row.symbol,
          holdSide: row.side,
          total: row.side === "long" ? row.size : -row.size,
          available: row.side === "long" ? row.size : -row.size,
          avgOpenPrice: row.entryPrice,
          markPrice: row.markPrice,
          unrealizedPL: row.unrealizedPnl,
          leverage: row.leverage,
          marginMode: row.marginMode,
          marginUsd: row.marginUsd,
          notional: row.notionalUsd,
          liquidationPrice: row.liquidationPrice,
          roe: row.roePct,
          presetStopSurplusPrice: row.takeProfitPrice,
          presetStopLossPrice: row.stopLossPrice
        }));
      }
    };

    this.publicWs = new MexcPublicWsApi(config);
    this.privateWs = config.apiKey && config.apiSecret ? new MexcPrivateWsApi(config) : null;

    const cacheOptions: ContractCacheOptions = {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300"),
      loader: async () => {
        const raw = await this.marketApi.getContractDetail();
        const details = Array.isArray(raw) ? raw : [raw];
        return details.filter((row): row is MexcContractDetail => Boolean(row && row.symbol)).map(toMexcContractInfo);
      }
    };

    this.contractCache = new ContractCache(cacheOptions);
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/api/v1/contract/detail",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `contract cache warmup failed: ${String(error)}`
      });
    });
  }

  async getAccountState(): Promise<AccountState> {
    const [assets, positionModeRaw] = await Promise.all([
      this.accountApi.getAssets(),
      this.accountApi.getPositionMode().catch(() => ({ positionMode: undefined }))
    ]);

    const totalEquity = assets.reduce((sum, asset) => {
      const value = toNumber(asset.equity) ?? toNumber(asset.cashBalance) ?? 0;
      return sum + value;
    }, 0);

    const availableMargin = assets.reduce((sum, asset) => {
      const value = toNumber(asset.availableBalance) ?? 0;
      return sum + value;
    }, 0);

    return {
      equity: totalEquity,
      availableMargin,
      marginMode: toMarginMode(positionModeRaw.positionMode)
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    await this.contractCache.refresh(false);
    const rows = await this.accountApi.getOpenPositions();
    return rows
      .map((row) => {
        const position = mapPosition(row);
        const contractSize = this.resolveContractSize(position.symbol);
        const size = Number((position.size * contractSize).toFixed(8));
        const riskMetrics = buildPositionRiskMetrics({
          side: position.side,
          size,
          entryPrice: position.entryPrice,
          markPrice: position.markPrice ?? null,
          unrealizedPnl: position.unrealizedPnl ?? null,
          leverage: position.leverage ?? null,
          marginMode: position.marginMode ?? null,
          marginUsd: position.marginUsd ?? null,
          notionalUsd: position.notionalUsd ?? null,
          liquidationPrice: position.liquidationPrice ?? null,
          roePct: position.roePct ?? null
        });
        return {
          ...position,
          size,
          leverage: riskMetrics.leverage ?? undefined,
          marginMode: riskMetrics.marginMode ?? undefined,
          marginUsd: riskMetrics.marginUsd ?? undefined,
          notionalUsd: riskMetrics.notionalUsd ?? undefined,
          liquidationPrice: riskMetrics.liquidationPrice ?? undefined,
          liquidationDistancePct: riskMetrics.liquidationDistancePct ?? undefined,
          roePct: riskMetrics.roePct ?? undefined,
          pnlPct: riskMetrics.pnlPct ?? undefined
        };
      })
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
    return this.contractCache.getSymbolRegistry().toCanonicalSymbol(symbol);
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = this.contractCache.getSymbolRegistry().toExchangeSymbol(symbol);
    if (!exchangeSymbol) throw new SymbolUnknownError(symbol);
    return exchangeSymbol;
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    const contract = await this.requireContract(symbol);
    enforceLeverageBounds(leverage, contract);
    await this.accountApi.changeLeverage(
      contract.exchangeSymbol,
      leverage,
      toMexcOpenType(marginMode)
    );
  }

  private async preparePlaceOrder(req: PlaceOrderRequest): Promise<MexcPlaceOrderRequest> {
    const contract = await this.requireTradeableContract(req.symbol);
    const contractSize =
      Number.isFinite(Number(contract.contractSize)) && Number(contract.contractSize) > 0
        ? Number(contract.contractSize)
        : 1;

    const stepSize = deriveStepSize(contract);
    if (!stepSize) {
      throw new InvalidStepError(contract.canonicalSymbol, `Missing step size for ${contract.canonicalSymbol}`);
    }

    let qty = roundQtyToStep(req.qty / contractSize, stepSize, "down");
    qty = clampQty(qty, contract.minVol, contract.maxVol);

    const qtyValidation = validateQty(qty, stepSize, contract.minVol, contract.maxVol, contract.canonicalSymbol);
    if (!qtyValidation.ok) throw qtyValidation.error;

    let normalizedPrice: number | undefined;
    if (req.type === "limit") {
      if (!Number.isFinite(req.price) || (req.price ?? 0) <= 0) {
        throw new MexcInvalidParamsError("Limit order requires a positive price", {
          endpoint: "/api/v1/private/order/create",
          method: "POST"
        });
      }

      const tickSize = deriveTickSize(contract);
      if (!tickSize) {
        throw new InvalidTickError(contract.canonicalSymbol, `Missing tick size for ${contract.canonicalSymbol}`);
      }

      normalizedPrice = roundPriceToTick(req.price as number, tickSize, "nearest");
      const priceValidation = validatePrice(normalizedPrice, tickSize, contract.canonicalSymbol);
      if (!priceValidation.ok) throw priceValidation.error;
    }

    return {
      symbol: contract.exchangeSymbol,
      vol: qty,
      side: toMexcOrderSide(req.side, Boolean(req.reduceOnly)),
      type: toMexcOrderType(req.type),
      openType: toMexcOpenType(req.marginMode ?? "cross"),
      externalOid: String(req.clientOrderId ?? "").trim() || undefined,
      reduceOnly: req.reduceOnly,
      price: normalizedPrice,
      takeProfitPrice: req.takeProfitPrice,
      stopLossPrice: req.stopLossPrice,
      profitTrend: req.takeProfitPrice ? 1 : undefined,
      lossTrend: req.stopLossPrice ? 1 : undefined,
      stpMode: 0
    };
  }

  private async submitPreparedOrder(payload: MexcPlaceOrderRequest): Promise<PlaceOrderResult> {
    const result = await this.tradingApi.submitOrder(payload);
    const orderId = pickOrderId(result);
    if (!orderId) {
      throw new MexcInvalidParamsError("MEXC did not return order id", {
        endpoint: "/api/v1/private/order/create",
        method: "POST"
      });
    }

    return {
      status: "confirmed" as const,
      submitted: true,
      confirmationSource: "venue_ack" as const,
      receiptStatus: "unknown" as const,
      orderId,
      clientOrderId: payload.externalOid
    };
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const payload = await this.preparePlaceOrder(req);
    return this.submitPreparedOrder(payload);
  }

  async cancelOrder(orderId: string) {
    await this.tradingApi.cancelOrder(orderId);
    return {
      status: "confirmed" as const,
      submitted: true,
      confirmationSource: "venue_ack" as const,
      receiptStatus: "unknown" as const,
      orderId
    };
  }

  async editOrder(params: EditOrderParams): Promise<PlaceOrderResult> {
    const existingOrders = await this.listOpenOrders({ symbol: params.symbol });
    const current = existingOrders.find((order) => order.orderId === params.orderId);
    if (!current) {
      throw new MexcInvalidParamsError("order_not_found", {
        endpoint: "/api/v1/private/order/cancel",
        method: "POST"
      });
    }

    const raw = toRecord(current.raw);
    const rawOrderType = raw.orderType ?? raw.type ?? current.type;
    if (!isMexcLimitOrder(rawOrderType)) {
      throw new MexcInvalidParamsError("order_edit_requires_regular_limit_order", {
        endpoint: "/api/v1/private/order/create",
        method: "POST"
      });
    }

    const rawSide = raw.side ?? current.side;
    const side = fromMexcOrderSide(rawSide);
    if (!side) {
      throw new MexcInvalidParamsError("order_edit_side_unrecognized", {
        endpoint: "/api/v1/private/order/create",
        method: "POST"
      });
    }

    const qty = params.qty ?? current.qty ?? 0;
    const price = params.price ?? current.price ?? 0;
    const takeProfitPrice = params.takeProfitPrice === undefined
      ? current.takeProfitPrice ?? undefined
      : params.takeProfitPrice ?? undefined;
    const stopLossPrice = params.stopLossPrice === undefined
      ? current.stopLossPrice ?? undefined
      : params.stopLossPrice ?? undefined;
    const replacement = await this.preparePlaceOrder({
      symbol: current.symbol || params.symbol,
      side,
      type: "limit",
      qty,
      price,
      reduceOnly: current.reduceOnly ?? isMexcCloseSide(rawSide),
      marginMode: toMarginMode(raw.openType ?? raw.marginMode) ?? "cross",
      takeProfitPrice,
      stopLossPrice
    });

    await this.cancelOrder(params.orderId);
    try {
      return await this.submitPreparedOrder(replacement);
    } catch (error) {
      throw new MexcMaintenanceError(
        "MEXC order edit cancelled the original order but the replacement failed.",
        {
          endpoint: "/api/v1/private/order/create",
          method: "POST",
          responseBody: {
            orderId: params.orderId,
            cause: error instanceof Error ? error.message : String(error)
          }
        }
      );
    }
  }

  async setPositionTpSl(params: PositionTpSlParams): Promise<{ ok: true }> {
    const normalizedSymbol = this.toCanonicalSymbol(params.symbol) ?? toCanonicalFallbackSymbol(params.symbol);
    if (!normalizedSymbol) {
      throw new MexcInvalidParamsError("symbol_required", {
        endpoint: "/api/v1/private/stoporder/place",
        method: "POST"
      });
    }
    if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null && params.takeProfitPrice <= 0) {
      throw new MexcInvalidParamsError("invalid_take_profit", {
        endpoint: "/api/v1/private/stoporder/place",
        method: "POST"
      });
    }
    if (params.stopLossPrice !== undefined && params.stopLossPrice !== null && params.stopLossPrice <= 0) {
      throw new MexcInvalidParamsError("invalid_stop_loss", {
        endpoint: "/api/v1/private/stoporder/place",
        method: "POST"
      });
    }

    const exchangeSymbol = await this.toExchangeSymbol(normalizedSymbol);
    const positions = await this.accountApi.getOpenPositions(exchangeSymbol);
    const target = positions.find((row) => {
      const canonical =
        this.toCanonicalSymbol(String(row.symbol ?? "")) ?? toCanonicalFallbackSymbol(String(row.symbol ?? ""));
      if (canonical !== normalizedSymbol) return false;
      const side = toPositionSide(row.positionType);
      return params.side ? side === params.side : true;
    });
    if (!target) {
      throw new MexcInvalidParamsError("position_side_required", {
        endpoint: "/api/v1/private/stoporder/place",
        method: "POST"
      });
    }

    const positionId = toPositionId(target.positionId);
    const positionVol = toNumber(target.holdVol) ?? toNumber(target.positionVol);
    if (!positionId || positionVol === null || positionVol <= 0) {
      throw new MexcInvalidParamsError("position_snapshot_invalid", {
        endpoint: "/api/v1/private/stoporder/place",
        method: "POST"
      });
    }

    const pendingStopOrders = toOrderRows(
      await this.tradingApi.listStopOrders(exchangeSymbol, {
        isFinished: 0,
        pageSize: 100
      }).catch(() => [])
    );
    const cancelPayload = pendingStopOrders
      .filter((row) => toPositionId(row.positionId) === positionId)
      .map((row) => toPositionId(row.id ?? row.stopPlanOrderId))
      .filter((value): value is string => value !== null)
      .map((stopPlanOrderId) => ({ stopPlanOrderId }));

    if (cancelPayload.length > 0) {
      await this.tradingApi.cancelStopOrder(cancelPayload);
    }

    const takeProfitPrice = params.takeProfitPrice ?? null;
    const stopLossPrice = params.stopLossPrice ?? null;
    if (takeProfitPrice === null && stopLossPrice === null) {
      return { ok: true };
    }

    await this.tradingApi.placeStopOrder({
      positionId,
      vol: positionVol,
      volType: 2,
      profitTrend: takeProfitPrice !== null ? 1 : undefined,
      lossTrend: stopLossPrice !== null ? 1 : undefined,
      takeProfitPrice: takeProfitPrice ?? undefined,
      stopLossPrice: stopLossPrice ?? undefined
    });
    return { ok: true };
  }

  async closePosition(params: ClosePositionParams): Promise<{ orderIds: string[] }> {
    const targetSymbol = this.toCanonicalSymbol(params.symbol) ?? toCanonicalFallbackSymbol(params.symbol);
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
      orderIds.push(placed.orderId ?? "");
    }

    return { orderIds };
  }

  async listOpenOrders(params?: { symbol?: string }): Promise<NormalizedOrder[]> {
    await this.contractCache.refresh(false);
    const canonicalSymbol = params?.symbol ? toCanonicalFallbackSymbol(params.symbol) : null;
    const exchangeSymbol = canonicalSymbol ? await this.toExchangeSymbol(canonicalSymbol) : undefined;
    const [rowsRaw, planRowsRaw] = await Promise.all([
      this.tradeApi.getPendingOrders({
        productType: this.productType,
        symbol: exchangeSymbol,
        pageSize: 100
      }),
      this.tradeApi.getPendingPlanOrders({
        productType: this.productType,
        symbol: exchangeSymbol,
        pageSize: 100
      }).catch(() => [])
    ]);

    const rows = toOrderRows(rowsRaw);
    const planRows = toOrderRows(planRowsRaw);
    const mapQty = (symbol: string, value: unknown): number | null => {
      const qty = toNumber(value);
      if (qty === null) return null;
      return Number((qty * this.resolveContractSize(symbol)).toFixed(8));
    };

    const regular = rows.map((row) => {
      const rawSymbol = String(row.symbol ?? "");
      const symbol = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
      return {
        orderId: String(row.orderId ?? row.order_id ?? row.externalOid ?? ""),
        symbol,
        side: row.side ? String(row.side) : null,
        type: row.orderType ? String(row.orderType) : row.type ? String(row.type) : null,
        status: row.status ? String(row.status) : row.state ? String(row.state) : null,
        price: toNumber(row.price ?? row.avgPrice),
        qty: mapQty(symbol, row.vol ?? row.qty),
        triggerPrice: toNumber(row.triggerPrice),
        takeProfitPrice: pickPositiveNumber(row.takeProfitPrice),
        stopLossPrice: pickPositiveNumber(row.stopLossPrice),
        reduceOnly: toReduceOnly(row.reduceOnly),
        createdAt: toIsoFromMs(row.createTime ?? row.cTime ?? row.uTime),
        raw: row
      } satisfies NormalizedOrder;
    }).filter((row) => row.orderId.length > 0);

    const planned = planRows.map((row) => {
      const rawSymbol = String(row.symbol ?? "");
      const symbol = this.toCanonicalSymbol(rawSymbol) ?? toCanonicalFallbackSymbol(rawSymbol);
      return {
        orderId: String(row.orderId ?? row.id ?? ""),
        symbol,
        side: row.side ? String(row.side) : null,
        type: row.planType ? String(row.planType) : "plan",
        status: row.status ? String(row.status) : row.state ? String(row.state) : null,
        price: toNumber(row.price),
        qty: mapQty(symbol, row.vol ?? row.qty),
        triggerPrice: toNumber(row.triggerPrice),
        takeProfitPrice: pickPositiveNumber(row.takeProfitPrice),
        stopLossPrice: pickPositiveNumber(row.stopLossPrice),
        reduceOnly: toReduceOnly(row.reduceOnly),
        createdAt: toIsoFromMs(row.createTime ?? row.cTime ?? row.uTime),
        raw: row
      } satisfies NormalizedOrder;
    }).filter((row) => row.orderId.length > 0);

    const seen = new Set<string>();
    const out: NormalizedOrder[] = [];
    for (const row of [...regular, ...planned]) {
      if (seen.has(row.orderId)) continue;
      seen.add(row.orderId);
      out.push(row);
    }
    return out;
  }

  async listPositions(params?: { symbol?: string }): Promise<NormalizedPosition[]> {
    await this.contractCache.refresh(false);
    const normalizedSymbol = params?.symbol ? toCanonicalFallbackSymbol(params.symbol) : null;
    const exchangeSymbol = normalizedSymbol ? await this.toExchangeSymbol(normalizedSymbol) : undefined;
    const [positionsRaw, stopOrdersRaw] = await Promise.all([
      this.accountApi.getOpenPositions(exchangeSymbol),
      this.tradingApi.listStopOrders(exchangeSymbol, {
        isFinished: 0,
        pageSize: 100
      }).catch(() => [])
    ]);
    const stopOrders = toOrderRows(stopOrdersRaw);

    return positionsRaw
      .map((row) => {
        const mapped = mapPosition(row);
        const size = Number((mapped.size * this.resolveContractSize(mapped.symbol)).toFixed(8));
        const riskMetrics = buildPositionRiskMetrics({
          side: mapped.side,
          size,
          entryPrice: mapped.entryPrice,
          markPrice: mapped.markPrice ?? null,
          unrealizedPnl: mapped.unrealizedPnl ?? null,
          leverage: mapped.leverage ?? null,
          marginMode: mapped.marginMode ?? null,
          marginUsd: mapped.marginUsd ?? null,
          notionalUsd: mapped.notionalUsd ?? null,
          liquidationPrice: mapped.liquidationPrice ?? null,
          roePct: mapped.roePct ?? null
        });
        const positionId = toPositionId(row.positionId);
        const matchingStops = stopOrders.filter((item) => toPositionId(item.positionId) === positionId);
        const takeProfitPrice = pickPositiveNumber(
          ...matchingStops.map((item) => item.takeProfitPrice)
        );
        const stopLossPrice = pickPositiveNumber(
          ...matchingStops.map((item) => item.stopLossPrice)
        );
        return {
          symbol: mapped.symbol,
          side: mapped.side,
          size,
          entryPrice: mapped.entryPrice,
          markPrice: mapped.markPrice ?? null,
          unrealizedPnl: mapped.unrealizedPnl ?? null,
          leverage: riskMetrics.leverage,
          marginMode: riskMetrics.marginMode,
          marginUsd: riskMetrics.marginUsd,
          notionalUsd: riskMetrics.notionalUsd,
          liquidationPrice: riskMetrics.liquidationPrice,
          liquidationDistancePct: riskMetrics.liquidationDistancePct,
          roePct: riskMetrics.roePct,
          pnlPct: riskMetrics.pnlPct,
          takeProfitPrice,
          stopLossPrice
        } satisfies NormalizedPosition;
      })
      .filter((row) => row.symbol.length > 0 && row.size > 0)
      .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true));
  }

  async subscribeTicker(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeTicker(await this.toExchangeSymbol(symbol));
  }

  async subscribeDepth(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeDepth(await this.toExchangeSymbol(symbol));
  }

  async subscribeKline(symbol: string, interval: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeKline(await this.toExchangeSymbol(symbol), interval);
  }

  async subscribeTrades(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeDeals(await this.toExchangeSymbol(symbol));
  }

  onTicker(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onTicker((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onDepth(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onDepth((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onKline(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onKline((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onTrades(callback: (payload: MexcWsPayload) => void): () => void {
    return this.publicWs.onDeals((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onFill(callback: (event: MexcFillEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onFill((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
      });
    });
  }

  onPositionUpdate(callback: (event: MexcPositionEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onPositionUpdate((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
      });
    });
  }

  onOrderUpdate(callback: (event: MexcOrderEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();

    return ws.onOrderUpdate((event) => {
      callback({
        ...event,
        symbol: event.symbol
          ? this.toCanonicalSymbol(event.symbol) ?? toCanonicalFallbackSymbol(event.symbol)
          : undefined
      });
    });
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    await this.publicWs.disconnect();
    if (this.privateWs) {
      await this.privateWs.disconnect();
    }
  }

  private normalizeWsPayloadSymbol(payload: MexcWsPayload): MexcWsPayload {
    if (typeof payload.symbol !== "string") return payload;
    const canonical = this.toCanonicalSymbol(payload.symbol) ?? toCanonicalFallbackSymbol(payload.symbol);
    return {
      ...payload,
      symbol: canonical
    };
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
        `Trading disabled by exchange for ${contract.exchangeSymbol} (apiAllowed=false)`
      );
    }
    return contract;
  }

  private requirePrivateWs(): MexcPrivateWsApi {
    if (!this.privateWs) {
      throw new MexcMaintenanceError("MEXC private websocket requires apiKey/apiSecret", {
        endpoint: "ws://private",
        method: "GET"
      });
    }
    return this.privateWs;
  }
}
