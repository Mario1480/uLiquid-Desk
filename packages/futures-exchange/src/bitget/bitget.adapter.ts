import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode
} from "@mm/futures-core";
import { SymbolUnknownError, TradingNotAllowedError, enforceLeverageBounds } from "@mm/futures-core";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import type {
  ClosePositionParams,
  EditOrderParams,
  NormalizedOrder,
  NormalizedOrderIntent,
  NormalizedPosition,
  OrderIntent,
  PositionTpSlParams
} from "../core/order-normalization.types.js";
import { ExchangeError } from "../core/exchange-error.types.js";
import {
  BITGET_DEFAULT_MARGIN_COIN,
  BITGET_DEFAULT_PRODUCT_TYPE,
  type BitgetProductType
} from "./bitget.constants.js";
import { BitgetAccountApi } from "./bitget.account.api.js";
import { BitgetContractCache } from "./bitget.contract-cache.js";
import { BitgetInvalidParamsError, BitgetSymbolStatusError } from "./bitget.errors.js";
import { mapBitgetError } from "./bitget-error.mapper.js";
import { BitgetMarketApi } from "./bitget.market.api.js";
import {
  deriveBitgetTradeSide,
  mapBitgetMarginMode,
  normalizeBitgetOrderIntent,
  validateBitgetTpSl
} from "./bitget-normalizer.js";
import { BitgetPositionApi } from "./bitget.position.api.js";
import { BitgetRestClient } from "./bitget.rest.js";
import { fromBitgetSymbol, normalizeCanonicalSymbol, toBitgetSymbol } from "./bitget.symbols.js";
import { BitgetTradeApi } from "./bitget.trade.api.js";
import type {
  BitgetAdapterConfig,
  BitgetContractInfo,
  BitgetFillEvent,
  BitgetOrderEvent,
  BitgetPositionEvent,
  BitgetPositionRaw,
  BitgetWsPayload
} from "./bitget.types.js";
import { BitgetPrivateWsApi } from "./bitget.ws.private.js";
import { BitgetPublicWsApi } from "./bitget.ws.public.js";
import { editBitgetOpenOrder } from "./fixes/bitget-order-edit.fix.js";
import {
  fallbackBitgetCloseSide,
  isNoPositionToCloseError,
  preferredBitgetCloseSide
} from "./fixes/bitget-close-side.fix.js";
import { upsertBitgetPositionTpSl } from "./fixes/bitget-plan-orders.fix.js";
import {
  type BitgetPositionModeHint,
  isBitgetMarginModeLockedError,
  isBitgetPositionModeOrderTypeMismatch,
  resolveBitgetPositionMode
} from "./fixes/bitget-position-mode.fix.js";
import { shouldSendBitgetReduceOnly } from "./fixes/bitget-reduce-only.fix.js";

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositionSide(raw: unknown, signedQty?: number | null): "long" | "short" {
  const text = String(raw ?? "").toLowerCase();
  if (text.includes("long")) return "long";
  if (text.includes("short")) return "short";
  if (typeof signedQty === "number" && Number.isFinite(signedQty) && signedQty > 0) return "long";
  return "short";
}

function mapPosition(row: BitgetPositionRaw): FuturesPosition {
  const canonical = normalizeCanonicalSymbol(String(row.symbol ?? ""));
  const total = toNumber(row.total);
  const available = toNumber(row.available);
  const signedQty =
    total !== null && Number.isFinite(total) && total !== 0
      ? total
      : available !== null && Number.isFinite(available) && available !== 0
        ? available
        : null;
  const size = Math.abs(signedQty ?? total ?? available ?? 0);
  return {
    symbol: canonical,
    side: toPositionSide(row.holdSide, signedQty),
    size,
    entryPrice: toNumber(row.avgOpenPrice) ?? 0,
    markPrice: toNumber(row.markPrice) ?? undefined,
    unrealizedPnl: toNumber(row.unrealizedPL) ?? undefined
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function getString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function toOrderRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }

  const record = toRecord(value);
  if (!record) return [];
  const candidates = [record.entrustedList, record.orderList, record.list, record.rows, record.data];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

export class BitgetFuturesAdapter implements FuturesExchange {
  readonly exchangeId = "bitget" as const;
  readonly rest: BitgetRestClient;
  readonly marketApi: BitgetMarketApi;
  readonly accountApi: BitgetAccountApi;
  readonly positionApi: BitgetPositionApi;
  readonly tradeApi: BitgetTradeApi;
  readonly contractCache: BitgetContractCache;

  readonly productType: BitgetProductType;
  readonly marginCoin: string;
  readonly defaultPositionMode: "one-way" | "hedge";

  private readonly publicWs: BitgetPublicWsApi;
  private readonly privateWs: BitgetPrivateWsApi | null;

  private readonly orderSymbolIndex = new Map<string, string>();
  private positionModeHint: BitgetPositionModeHint = null;

  constructor(private readonly config: BitgetAdapterConfig = {}) {
    this.productType = config.productType ?? BITGET_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? BITGET_DEFAULT_MARGIN_COIN;
    this.defaultPositionMode = config.defaultPositionMode ?? "one-way";

    this.rest = new BitgetRestClient(config);
    this.marketApi = new BitgetMarketApi(this.rest);
    this.accountApi = new BitgetAccountApi(this.rest);
    this.positionApi = new BitgetPositionApi(this.rest);
    this.tradeApi = new BitgetTradeApi(this.rest);

    this.contractCache = new BitgetContractCache(this.marketApi, this.productType, {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300")
    });
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "/api/v2/mix/market/contracts",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `bitget contract warmup failed: ${String(error)}`
      });
    });

    this.publicWs = new BitgetPublicWsApi(config, this.productType);

    this.privateWs =
      config.apiKey && config.apiSecret && config.apiPassphrase
        ? new BitgetPrivateWsApi(config, this.productType, () => this.reconcilePrivateState())
        : null;
  }

  async getAccountState(): Promise<AccountState> {
    const accounts = await this.accountApi.getAccounts(this.productType);
    const preferred =
      accounts.find((row) => String(row.marginCoin ?? "").toUpperCase() === this.marginCoin.toUpperCase()) ??
      accounts[0] ??
      null;

    return {
      equity: toNumber(preferred?.accountEquity) ?? 0,
      availableMargin: toNumber(preferred?.available) ?? toNumber(preferred?.crossAvailable) ?? undefined,
      marginMode: undefined
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const rows = await this.positionApi.getAllPositions({
      productType: this.productType,
      marginCoin: this.marginCoin
    });

    return rows
      .map((row) => mapPosition(row))
      .filter((row) => row.symbol.length > 0 && row.size > 0);
  }

  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    return this.contractCache.getByCanonical(symbol);
  }

  toCanonicalSymbol(symbol: string): string | null {
    return fromBitgetSymbol(symbol, this.contractCache.getSymbolRegistry());
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const exchangeSymbol = toBitgetSymbol(symbol, this.contractCache.getSymbolRegistry());
    if (!exchangeSymbol) throw new SymbolUnknownError(symbol);
    return exchangeSymbol;
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    try {
      const contract = await this.requireTradeableContract(symbol);
      enforceLeverageBounds(leverage, contract);

      try {
        await this.accountApi.setMarginMode({
          symbol: contract.exchangeSymbol,
          marginMode: mapBitgetMarginMode(marginMode),
          marginCoin: this.marginCoin,
          productType: this.productType
        });
      } catch (error) {
        // Bitget rejects margin-mode changes while orders/positions are open.
        // Continue and still apply leverage + order placement.
        if (!isBitgetMarginModeLockedError(error)) throw error;
      }

      await this.accountApi.setLeverage({
        symbol: contract.exchangeSymbol,
        leverage,
        marginCoin: this.marginCoin,
        productType: this.productType
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string }> {
    try {
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
        context: { source: "runner" }
      });
      await this.validateOrderIntent(normalized);
      return await this.placeNormalizedOrder(normalized);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async normalizeOrderIntent(intent: OrderIntent): Promise<NormalizedOrderIntent> {
    const canonicalSymbol = this.toCanonicalSymbol(intent.symbol) ?? normalizeCanonicalSymbol(intent.symbol);
    const contract = await this.requireTradeableContract(canonicalSymbol);
    return normalizeBitgetOrderIntent({
      contract,
      intent: {
        ...intent,
        symbol: contract.canonicalSymbol
      }
    });
  }

  async validateOrderIntent(intent: NormalizedOrderIntent): Promise<void> {
    if (!Number.isFinite(intent.normalizedQty) || intent.normalizedQty <= 0) {
      throw new BitgetInvalidParamsError("Invalid qty", {
        endpoint: "/api/v2/mix/order/place-order",
        method: "POST"
      });
    }
    if (intent.type === "limit") {
      if (intent.normalizedPrice === undefined || !Number.isFinite(intent.normalizedPrice) || intent.normalizedPrice <= 0) {
        throw new BitgetInvalidParamsError("Limit order requires valid price", {
          endpoint: "/api/v2/mix/order/place-order",
          method: "POST"
        });
      }
    }
    validateBitgetTpSl(intent);
  }

  async placeNormalizedOrder(intent: NormalizedOrderIntent): Promise<{ orderId: string }> {
    const initialMode = await this.resolvePositionMode();
    const place = (mode: "one-way" | "hedge") => {
      const tradeSide = deriveBitgetTradeSide(mode, Boolean(intent.reduceOnly));
      return this.tradeApi.placeOrder({
        symbol: intent.exchangeSymbol,
        productType: this.productType,
        marginCoin: this.marginCoin,
        marginMode: mapBitgetMarginMode(intent.marginMode ?? "cross"),
        clientOid: intent.clientOrderId,
        side: intent.side,
        tradeSide,
        orderType: intent.type,
        size: String(intent.normalizedQty),
        price: intent.normalizedPrice !== undefined ? String(intent.normalizedPrice) : undefined,
        presetStopSurplusPrice:
          intent.takeProfitPrice !== undefined ? String(intent.takeProfitPrice) : undefined,
        presetStopLossPrice:
          intent.stopLossPrice !== undefined ? String(intent.stopLossPrice) : undefined,
        force: intent.type === "limit" ? "gtc" : "ioc",
        reduceOnly: shouldSendBitgetReduceOnly({
          reduceOnly: intent.reduceOnly,
          side: intent.side,
          tradeSide
        })
      });
    };

    let placed: { orderId?: string; clientOid?: string };
    try {
      placed = await place(initialMode);
    } catch (error) {
      if (!isBitgetPositionModeOrderTypeMismatch(error)) throw error;
      const fallbackMode: "one-way" | "hedge" = initialMode === "hedge" ? "one-way" : "hedge";
      this.positionModeHint = { mode: fallbackMode, ts: Date.now() };
      placed = await place(fallbackMode);
    }

    const orderId = placed.orderId?.trim();
    if (!orderId) {
      throw new BitgetInvalidParamsError("Bitget place-order did not return orderId", {
        endpoint: "/api/v2/mix/order/place-order",
        method: "POST"
      });
    }

    this.orderSymbolIndex.set(orderId, intent.exchangeSymbol);
    return { orderId };
  }

  private async resolvePositionMode(): Promise<"one-way" | "hedge"> {
    const cacheMs = Number(process.env.BITGET_POSITION_MODE_CACHE_MS ?? "60000");
    this.positionModeHint = await resolveBitgetPositionMode({
      accountApi: this.accountApi,
      productType: this.productType,
      defaultPositionMode: this.defaultPositionMode,
      currentHint: this.positionModeHint,
      nowMs: Date.now(),
      cacheMs
    });
    return this.positionModeHint?.mode ?? this.defaultPositionMode;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.cancelOrderByParams({ orderId });
  }

  async cancelOrderByParams(params: { orderId: string; symbol?: string }): Promise<void> {
    try {
      let symbol: string | null = params.symbol?.trim() ?? null;

      if (!symbol) {
        symbol = this.orderSymbolIndex.get(params.orderId) ?? null;
      }

      if (!symbol) {
        const pendingRaw = await this.tradeApi.getPendingOrders({
          productType: this.productType,
          pageSize: 100
        });
        const pending = toOrderRows(pendingRaw);
        const matched = pending.find((item) => String(item.orderId ?? "") === params.orderId);
        symbol = String(matched?.symbol ?? "").trim() || null;
      }

      if (!symbol) {
        throw new BitgetInvalidParamsError(`Unable to resolve symbol for orderId ${params.orderId}`, {
          endpoint: "/api/v2/mix/order/cancel-order",
          method: "POST"
        });
      }

      const canonical = this.toCanonicalSymbol(symbol) ?? normalizeCanonicalSymbol(symbol);
      const exchangeSymbol = await this.toExchangeSymbol(canonical);
      await this.tradeApi.cancelOrder({
        symbol: exchangeSymbol,
        orderId: params.orderId,
        productType: this.productType
      });
      this.orderSymbolIndex.delete(params.orderId);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async editOrder(params: EditOrderParams): Promise<{ orderId: string }> {
    try {
      return await editBitgetOpenOrder({
        adapter: this,
        tradeApi: this.tradeApi,
        input: params
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async setPositionTpSl(params: PositionTpSlParams): Promise<{ ok: true }> {
    try {
      const normalizedSymbol = normalizeCanonicalSymbol(params.symbol);
      if (!normalizedSymbol) {
        throw new BitgetInvalidParamsError("symbol_required", {
          endpoint: "/api/v2/mix/order/place-pos-tpsl",
          method: "POST"
        });
      }
      const side =
        params.side ??
        (await this.listPositions({ symbol: normalizedSymbol }))[0]?.side;
      if (side !== "long" && side !== "short") {
        throw new BitgetInvalidParamsError("position_side_required", {
          endpoint: "/api/v2/mix/order/place-pos-tpsl",
          method: "POST"
        });
      }
      if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null && params.takeProfitPrice <= 0) {
        throw new BitgetInvalidParamsError("invalid_take_profit", {
          endpoint: "/api/v2/mix/order/place-pos-tpsl",
          method: "POST"
        });
      }
      if (params.stopLossPrice !== undefined && params.stopLossPrice !== null && params.stopLossPrice <= 0) {
        throw new BitgetInvalidParamsError("invalid_stop_loss", {
          endpoint: "/api/v2/mix/order/place-pos-tpsl",
          method: "POST"
        });
      }

      const exchangeSymbol = await this.toExchangeSymbol(normalizedSymbol);
      return await upsertBitgetPositionTpSl({
        tradeApi: this.tradeApi,
        symbol: exchangeSymbol,
        productType: this.productType,
        marginCoin: this.marginCoin,
        holdSide: side,
        takeProfitPrice: params.takeProfitPrice,
        stopLossPrice: params.stopLossPrice
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async closePosition(params: ClosePositionParams): Promise<{ orderIds: string[] }> {
    try {
      const positions = await this.listPositions({ symbol: params.symbol });
      const targets = positions
        .filter((row) => row.size > 0)
        .filter((row) => (params.side ? row.side === params.side : true));

      if (targets.length === 0) {
        return { orderIds: [] };
      }

      const orderIds: string[] = [];
      for (const position of targets) {
        const preferredSide = preferredBitgetCloseSide(position.side);
        const placeClose = async (orderSide: "buy" | "sell") =>
          this.placeOrder({
            symbol: position.symbol,
            side: orderSide,
            type: "market",
            qty: position.size,
            reduceOnly: true
          });
        try {
          const placed = await placeClose(preferredSide);
          orderIds.push(placed.orderId);
        } catch (error) {
          if (!isNoPositionToCloseError(error)) throw error;
          const fallbackSide = fallbackBitgetCloseSide(preferredSide);
          try {
            const fallbackPlaced = await placeClose(fallbackSide);
            orderIds.push(fallbackPlaced.orderId);
          } catch (fallbackError) {
            if (!isNoPositionToCloseError(fallbackError)) throw fallbackError;
          }
        }
      }
      return { orderIds };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async listOpenOrders(params?: { symbol?: string }): Promise<NormalizedOrder[]> {
    try {
      const canonicalSymbol = params?.symbol ? normalizeCanonicalSymbol(params.symbol) : null;
      const exchangeSymbol = canonicalSymbol ? await this.toExchangeSymbol(canonicalSymbol) : undefined;
      const rowsRaw = await this.tradeApi.getPendingOrders({
        productType: this.productType,
        symbol: exchangeSymbol,
        pageSize: 100
      });
      let planRowsRaw: unknown = [];
      try {
        planRowsRaw = await this.tradeApi.getPendingPlanOrders({
          productType: this.productType,
          symbol: exchangeSymbol,
          pageSize: 100
        });
      } catch {
        planRowsRaw = [];
      }

      const rows = toOrderRows(rowsRaw);
      const planRows = toOrderRows(planRowsRaw);

      const regular = rows.map((row) => {
        const rawSymbol = String(row.symbol ?? row.instId ?? "");
        const canonical = (rawSymbol && this.toCanonicalSymbol(rawSymbol)) ?? normalizeCanonicalSymbol(rawSymbol);
        const createdMs = getNumber(row, ["cTime", "createTime", "uTime"]);
        return {
          orderId: String(row.orderId ?? row.order_id ?? row.ordId ?? row.clientOid ?? ""),
          symbol: canonical,
          side: row.side ? String(row.side) : row.positionType ? String(row.positionType) : null,
          type: row.orderType ? String(row.orderType) : row.orderTypeName ? String(row.orderTypeName) : row.type ? String(row.type) : null,
          status: row.status ? String(row.status) : row.state ? String(row.state) : null,
          price: getNumber(row, ["price", "px", "avgPrice"]),
          qty: getNumber(row, ["size", "qty", "baseVolume", "vol"]),
          triggerPrice: getNumber(row, ["triggerPrice", "triggerPx"]),
          takeProfitPrice: getNumber(row, [
            "presetStopSurplusPrice",
            "stopSurplusTriggerPrice",
            "stopSurplusExecutePrice",
            "takeProfitPrice",
            "tp"
          ]),
          stopLossPrice: getNumber(row, [
            "presetStopLossPrice",
            "stopLossTriggerPrice",
            "stopLossExecutePrice",
            "stopLossPrice",
            "sl"
          ]),
          reduceOnly:
            typeof row.reduceOnly === "boolean"
              ? row.reduceOnly
              : getString(row, ["reduceOnly"])?.toLowerCase() === "yes"
                ? true
                : getString(row, ["reduceOnly"])?.toLowerCase() === "no"
                  ? false
                  : null,
          createdAt:
            createdMs !== null && Number.isFinite(createdMs)
              ? new Date(createdMs).toISOString()
              : null,
          raw: row
        } satisfies NormalizedOrder;
      }).filter((item) => item.orderId.length > 0);

      const planned = planRows.map((row) => {
        const rawSymbol = String(row.symbol ?? row.instId ?? "");
        const canonical = (rawSymbol && this.toCanonicalSymbol(rawSymbol)) ?? normalizeCanonicalSymbol(rawSymbol);
        const createdMs = getNumber(row, ["cTime", "createTime", "uTime"]);
        return {
          orderId: String(row.orderId ?? row.order_id ?? row.planOrderId ?? row.clientOid ?? ""),
          symbol: canonical,
          side: row.side ? String(row.side) : null,
          type: row.planType ? String(row.planType) : "plan",
          status: row.planStatus ? String(row.planStatus) : row.status ? String(row.status) : null,
          price: getNumber(row, ["price", "executePrice", "avgPrice"]),
          qty: getNumber(row, ["size", "qty", "vol"]),
          triggerPrice: getNumber(row, ["triggerPrice", "triggerPx"]),
          takeProfitPrice: getNumber(row, ["stopSurplusExecutePrice", "presetStopSurplusPrice"]),
          stopLossPrice: getNumber(row, ["stopLossExecutePrice", "presetStopLossPrice"]),
          reduceOnly:
            typeof row.reduceOnly === "boolean"
              ? row.reduceOnly
              : getString(row, ["reduceOnly"])?.toLowerCase() === "yes"
                ? true
                : getString(row, ["reduceOnly"])?.toLowerCase() === "no"
                  ? false
                  : null,
          createdAt:
            createdMs !== null && Number.isFinite(createdMs)
              ? new Date(createdMs).toISOString()
              : null,
          raw: row
        } satisfies NormalizedOrder;
      }).filter((item) => item.orderId.length > 0);

      const seen = new Set<string>();
      const out: NormalizedOrder[] = [];
      for (const row of [...regular, ...planned]) {
        if (seen.has(row.orderId)) continue;
        seen.add(row.orderId);
        out.push(row);
      }
      return out;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async listPositions(params?: { symbol?: string }): Promise<NormalizedPosition[]> {
    try {
      const normalizedSymbol = params?.symbol ? normalizeCanonicalSymbol(params.symbol) : null;
      const rows = await this.positionApi.getAllPositions({
        productType: this.productType,
        marginCoin: this.marginCoin
      });
      return rows
        .map((row) => {
          const mapped = mapPosition(row);
          const raw = toRecord(row);
          return {
            symbol: mapped.symbol,
            side: mapped.side,
            size: mapped.size,
            entryPrice: Number.isFinite(mapped.entryPrice) ? mapped.entryPrice : null,
            markPrice: mapped.markPrice ?? null,
            unrealizedPnl: mapped.unrealizedPnl ?? null,
            takeProfitPrice: getNumber(raw, ["takeProfitPrice", "tp", "presetStopSurplusPrice"]),
            stopLossPrice: getNumber(raw, ["stopLossPrice", "sl", "presetStopLossPrice"])
          } satisfies NormalizedPosition;
        })
        .filter((row) => row.size > 0)
        .filter((row) => (normalizedSymbol ? row.symbol === normalizedSymbol : true));
    } catch (error) {
      throw this.mapError(error);
    }
  }

  mapError(error: unknown): ExchangeError {
    return mapBitgetError(error);
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
    await this.publicWs.subscribeCandle(await this.toExchangeSymbol(symbol), interval);
  }

  async subscribeTrades(symbol: string): Promise<void> {
    await this.publicWs.connect();
    await this.publicWs.subscribeTrades(await this.toExchangeSymbol(symbol));
  }

  onTicker(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onTicker((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onDepth(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onDepth((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onKline(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onCandle("candle1m", (payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onTrades(callback: (payload: BitgetWsPayload) => void): () => void {
    return this.publicWs.onTrades((payload) => callback(this.normalizeWsPayloadSymbol(payload)));
  }

  onFill(callback: (event: BitgetFillEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribeFills();

    return ws.onFill((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
      });
    });
  }

  onPositionUpdate(callback: (event: BitgetPositionEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribePositions();

    return ws.onPositionUpdate((event) => {
      callback({
        ...event,
        symbol: this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
      });
    });
  }

  onOrderUpdate(callback: (event: BitgetOrderEvent) => void): () => void {
    const ws = this.requirePrivateWs();
    void ws.connect();
    void ws.subscribeOrders();

    return ws.onOrderUpdate((event) => {
      callback({
        ...event,
        symbol: event.symbol
          ? this.toCanonicalSymbol(event.symbol) ?? normalizeCanonicalSymbol(event.symbol)
          : undefined
      });
    });
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    await this.publicWs.disconnect();
    if (this.privateWs) await this.privateWs.disconnect();
  }

  private async reconcilePrivateState(): Promise<void> {
    const startedAt = Date.now();
    try {
      const [openOrders, positions, fills] = await Promise.allSettled([
        this.tradeApi.getPendingOrders({ productType: this.productType, pageSize: 100 }),
        this.positionApi.getAllPositions({ productType: this.productType, marginCoin: this.marginCoin }),
        this.tradeApi.getFills({ productType: this.productType, limit: 100 })
      ]);

      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "ws/private/reconcile",
        method: "GET",
        durationMs: Date.now() - startedAt,
        ok: true,
        message: JSON.stringify({
          openOrders: openOrders.status === "fulfilled" ? openOrders.value.length : "failed",
          positions: positions.status === "fulfilled" ? positions.value.length : "failed",
          fills: fills.status === "fulfilled" ? "ok" : "failed"
        })
      });
    } catch (error) {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "ws/private/reconcile",
        method: "GET",
        durationMs: Date.now() - startedAt,
        ok: false,
        message: String(error)
      });
    }
  }

  private normalizeWsPayloadSymbol(payload: BitgetWsPayload): BitgetWsPayload {
    const data = payload.data;
    if (!Array.isArray(data)) return payload;

    const normalized = data.map((row) => {
      if (!row || typeof row !== "object") return row;
      const symbol = (row as Record<string, unknown>).symbol ?? (row as Record<string, unknown>).instId;
      if (typeof symbol !== "string") return row;

      const canonical = this.toCanonicalSymbol(symbol) ?? normalizeCanonicalSymbol(symbol);
      return {
        ...row,
        symbol: canonical,
        instId: canonical
      };
    });

    return {
      ...payload,
      data: normalized
    };
  }

  private requirePrivateWs(): BitgetPrivateWsApi {
    if (!this.privateWs) {
      throw new BitgetInvalidParamsError(
        "Bitget private websocket requires apiKey/apiSecret/apiPassphrase",
        {
          endpoint: "wss://ws.bitget.com/v2/ws/private",
          method: "GET"
        }
      );
    }

    return this.privateWs;
  }

  private async requireTradeableContract(symbol: string): Promise<BitgetContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);

    if (!contract.apiAllowed) {
      throw new BitgetSymbolStatusError(
        `Bitget symbol ${contract.exchangeSymbol} is not tradable: status=${contract.symbolStatus}`,
        {
          endpoint: "/api/v2/mix/market/contracts",
          method: "GET"
        }
      );
    }

    if (contract.symbolStatus !== "normal") {
      throw new TradingNotAllowedError(
        contract.canonicalSymbol,
        `Bitget symbol ${contract.exchangeSymbol} blocked by symbolStatus=${contract.symbolStatus}`
      );
    }

    return contract;
  }
}
