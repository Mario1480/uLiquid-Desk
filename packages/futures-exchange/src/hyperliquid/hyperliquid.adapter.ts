import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode
} from "@mm/futures-core";
import { HttpTransport } from "@nktkas/hyperliquid";
import { sendAsset } from "@nktkas/hyperliquid/api/exchange";
import { SymbolUnknownError, TradingNotAllowedError, enforceLeverageBounds } from "@mm/futures-core";
import { Hyperliquid } from "hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { FuturesExchange, PlaceOrderRequest } from "../futures-exchange.interface.js";
import type {
  ClosePositionParams,
  PositionTpSlParams
} from "../core/order-normalization.types.js";
import {
  HYPERLIQUID_DEFAULT_MARGIN_COIN,
  HYPERLIQUID_DEFAULT_PRODUCT_TYPE,
  HYPERLIQUID_ZERO_ADDRESS
} from "./hyperliquid.constants.js";
import { HyperliquidAccountApi } from "./hyperliquid.account.api.js";
import { HyperliquidContractCache } from "./hyperliquid.contract-cache.js";
import { HyperliquidMarketApi, type HyperliquidMarketSnapshot } from "./hyperliquid.market.api.js";
import { HyperliquidPositionApi } from "./hyperliquid.position.api.js";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";
import { HyperliquidCoreWriterClient, parseCoreWriterOrderId } from "./hyperliquid.corewriter.js";
import {
  coinToCanonicalSymbol,
  fromHyperliquidSymbol,
  normalizeHyperliquidSymbol,
  parseCoinFromAnySymbol,
  toHyperliquidSymbol,
  toInternalPerpSymbol
} from "./hyperliquid.symbols.js";
import type {
  HyperliquidAdapterConfig,
  HyperliquidContractInfo,
  HyperliquidOrderRaw,
  HyperliquidProductType
} from "./hyperliquid.types.js";

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEvmAddress(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return null;
  return text;
}

function encodeCoreSystemAddress(tokenIndex: number | null, symbol: string): `0x${string}` | null {
  if (String(symbol).trim().toUpperCase() === "HYPE") {
    return `0x${"2".repeat(40)}` as `0x${string}`;
  }
  if (tokenIndex === null || tokenIndex < 0) return null;
  const encoded = BigInt(tokenIndex).toString(16).padStart(38, "0");
  return `0x20${encoded}` as `0x${string}`;
}

function formatUnsignedDecimal(value: number, decimals = 6): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("hyperliquid_invalid_transfer_amount");
  }
  return Number(value.toFixed(decimals)).toString();
}

function mapMarginMode(mode: MarginMode): "isolated" | "crossed" {
  return mode === "isolated" ? "isolated" : "crossed";
}

function toPositionSide(raw: unknown): "long" | "short" {
  return String(raw ?? "").toLowerCase().includes("long") ? "long" : "short";
}

function mapPosition(row: {
  symbol?: string;
  holdSide?: string;
  total?: string;
  avgOpenPrice?: string;
  markPrice?: string;
  unrealizedPL?: string;
}): FuturesPosition {
  const coin = parseCoinFromAnySymbol(String(row.symbol ?? ""));
  return {
    symbol: coinToCanonicalSymbol(coin),
    side: toPositionSide(row.holdSide),
    size: toNumber(row.total) ?? 0,
    entryPrice: toNumber(row.avgOpenPrice) ?? 0,
    markPrice: toNumber(row.markPrice) ?? undefined,
    unrealizedPnl: toNumber(row.unrealizedPL) ?? undefined
  };
}

function normalizeQty(qty: number, stepSize: number | null | undefined): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (!stepSize || !Number.isFinite(stepSize) || stepSize <= 0) return qty;
  const steps = Math.floor(qty / stepSize);
  return Number((steps * stepSize).toFixed(12));
}

function parseOrderId(row: { orderId?: string; clientOid?: string }): string | null {
  const orderId = String(row.orderId ?? "").trim();
  if (orderId) return orderId;
  return null;
}

function createClientOid(): string {
  return `utrade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type HyperliquidSymbolConversionState = {
  initialized: boolean;
  assetToIndexMap: Map<string, number>;
  exchangeToInternalNameMap: Map<string, string>;
  disablePeriodicRefresh?: () => void;
};

function getSdkSymbolConversionState(sdk: Hyperliquid): HyperliquidSymbolConversionState | null {
  const symbolConversion = (sdk as { symbolConversion?: unknown }).symbolConversion;
  if (!symbolConversion || typeof symbolConversion !== "object") return null;
  const record = symbolConversion as Record<string, unknown>;
  const assetToIndexMap = record.assetToIndexMap;
  const exchangeToInternalNameMap = record.exchangeToInternalNameMap;
  if (!(assetToIndexMap instanceof Map) || !(exchangeToInternalNameMap instanceof Map)) {
    return null;
  }
  return symbolConversion as HyperliquidSymbolConversionState;
}

function toPlanKind(value: unknown): "tp" | "sl" | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.includes("profit") || text === "tp") return "tp";
  if (text.includes("loss") || text === "sl") return "sl";
  return null;
}

export class HyperliquidFuturesAdapter implements FuturesExchange {
  readonly sdk: Hyperliquid;
  readonly marketApi: HyperliquidMarketApi;
  readonly accountApi: HyperliquidAccountApi;
  readonly positionApi: HyperliquidPositionApi;
  readonly tradeApi: HyperliquidTradeApi;
  readonly contractCache: HyperliquidContractCache;

  readonly productType: HyperliquidProductType;
  readonly marginCoin: string;
  readonly defaultPositionMode: "one-way" | "hedge";

  private readonly userAddress: string;
  private readonly hasSigning: boolean;
  private readonly writeMode: "legacy_api" | "hyperevm_corewriter";
  private readonly coreWriter: HyperliquidCoreWriterClient | null;
  private readonly orderSymbolIndex = new Map<string, string>();

  private readonly tickerSymbols = new Set<string>();
  private readonly depthSymbols = new Set<string>();
  private readonly tradeSymbols = new Set<string>();

  private readonly tickerCallbacks = new Set<(payload: any) => void>();
  private readonly depthCallbacks = new Set<(payload: any) => void>();
  private readonly tradeCallbacks = new Set<(payload: any) => void>();
  private readonly fillCallbacks = new Set<(payload: any) => void>();
  private readonly orderCallbacks = new Set<(payload: any) => void>();
  private readonly positionCallbacks = new Set<(payload: any) => void>();

  private marketPollTimer: NodeJS.Timeout | null = null;
  private marketPollRunning = false;
  private lastMarketSnapshot: HyperliquidMarketSnapshot | null = null;
  private privatePollTimer: NodeJS.Timeout | null = null;
  private privatePollRunning = false;
  private readonly seenFillKeys = new Set<string>();
  private perpAssetMapReadyPromise: Promise<void> | null = null;

  constructor(private readonly config: HyperliquidAdapterConfig = {}) {
    this.productType = config.productType ?? HYPERLIQUID_DEFAULT_PRODUCT_TYPE;
    this.marginCoin = config.marginCoin ?? HYPERLIQUID_DEFAULT_MARGIN_COIN;
    this.defaultPositionMode = config.defaultPositionMode ?? "one-way";

    const walletAddress = normalizeEvmAddress(config.apiKey);
    const vaultAddress = normalizeEvmAddress(config.apiPassphrase);
    this.userAddress = vaultAddress ?? walletAddress ?? HYPERLIQUID_ZERO_ADDRESS;
    this.hasSigning = String(config.apiSecret ?? "").trim().length > 0;
    this.writeMode = config.writeMode ?? "legacy_api";

    this.sdk = new Hyperliquid({
      enableWs: false,
      privateKey: config.apiSecret,
      walletAddress: walletAddress ?? this.userAddress,
      vaultAddress: vaultAddress ?? undefined,
      testnet:
        String(config.restBaseUrl ?? "").toLowerCase().includes("testnet") ||
        String(process.env.HYPERLIQUID_TESTNET ?? "").trim() === "1",
      // The upstream SDK refreshes perp and spot maps together. If the spot side
      // is temporarily unhealthy, futures writes like leverage/order placement
      // fail during symbol conversion. We seed the perp map from our own cache.
      disableAssetMapRefresh: true
    });

    this.marketApi = new HyperliquidMarketApi(this.sdk, {
      timeoutMs: config.timeoutMs,
      retryAttempts: config.retryAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      log: config.log
    });
    this.accountApi = new HyperliquidAccountApi(this.sdk, this.userAddress, walletAddress);
    this.positionApi = new HyperliquidPositionApi(this.sdk, this.userAddress, this.marketApi);
    const botVaultAddress = normalizeEvmAddress(config.botVaultAddress);
    const coreWriter =
      this.writeMode === "hyperevm_corewriter" && botVaultAddress && this.hasSigning && String(config.apiSecret ?? "").trim()
        ? new HyperliquidCoreWriterClient({
            privateKey: String(config.apiSecret).trim() as `0x${string}`,
            botVaultAddress: botVaultAddress as `0x${string}`,
            rpcUrl: String(config.hyperEvmRpcUrl ?? process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm"),
            chainId: Math.max(1, Math.trunc(Number(config.hyperEvmChainId ?? process.env.HYPEREVM_CHAIN_ID ?? 999)))
          })
        : null;
    this.coreWriter = coreWriter;
    this.tradeApi = new HyperliquidTradeApi(this.sdk, this.userAddress, this.hasSigning, this.marketApi, coreWriter);

    this.contractCache = new HyperliquidContractCache(this.marketApi, {
      ttlSeconds: Number(process.env.CONTRACT_CACHE_TTL_SECONDS ?? "300")
    });
    this.contractCache.startBackgroundRefresh();
    void this.contractCache.warmup().catch((error) => {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "hyperliquid/metaAndAssetCtxs",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: `hyperliquid contract warmup failed: ${String(error)}`
      });
    });
    this.perpAssetMapReadyPromise = this.ensureSdkPerpAssetMapReady().catch(() => {
      this.perpAssetMapReadyPromise = null;
    });
  }

  private getExchangeApiUrl(): string {
    const raw = String(this.config.restBaseUrl ?? process.env.HYPERLIQUID_EXCHANGE_URL ?? "https://api.hyperliquid.xyz").trim();
    return raw.replace(/\/+$/, "") || "https://api.hyperliquid.xyz";
  }

  private getSignatureChainIdHex(): `0x${string}` {
    const configured = Number(
      this.config.restBaseUrl && this.config.restBaseUrl.toLowerCase().includes("testnet")
        ? process.env.HYPERLIQUID_TESTNET_SIGNATURE_CHAIN_ID ?? "421614"
        : process.env.HYPERLIQUID_SIGNATURE_CHAIN_ID ?? "42161"
    );
    const chainId = Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 42161;
    return `0x${chainId.toString(16)}` as `0x${string}`;
  }

  private getConfiguredVaultAddress(): `0x${string}` | null {
    const vaultAddress = normalizeEvmAddress(this.config.apiPassphrase);
    return vaultAddress ? vaultAddress as `0x${string}` : null;
  }

  private async readSpotTokenMetaBySymbol(): Promise<Map<string, { index: number; identifier: string }>> {
    const spotMeta = await (this.sdk.info as any)?.spot?.getSpotMeta?.(true);
    const tokens = Array.isArray(spotMeta?.tokens)
      ? spotMeta.tokens
      : Array.isArray(spotMeta?.universe)
        ? spotMeta.universe
        : [];
    const bySymbol = new Map<string, { index: number; identifier: string }>();
    tokens.forEach((entry: any, index: number) => {
      const nameRaw = String(entry?.name ?? entry?.coin ?? entry?.symbol ?? entry?.tokenName ?? `token_${index}`).trim();
      const tokenIdRaw = String(entry?.tokenId ?? "").trim();
      const symbol = nameRaw.toUpperCase();
      if (!symbol) return;
      bySymbol.set(symbol, {
        index,
        identifier: tokenIdRaw ? `${nameRaw}:${tokenIdRaw}` : nameRaw
      });
    });
    return bySymbol;
  }

  async getCoreUsdcSpotBalance(): Promise<{ amountUsd: number; token: string; systemAddress: `0x${string}` }> {
    const tokenMetaBySymbol = await this.readSpotTokenMetaBySymbol();
    const usdcMeta = tokenMetaBySymbol.get("USDC");
    if (!usdcMeta?.identifier) {
      throw new Error("hyperliquid_usdc_spot_token_missing");
    }
    const systemAddress = encodeCoreSystemAddress(usdcMeta.index, "USDC");
    if (!systemAddress) {
      throw new Error("hyperliquid_usdc_system_address_missing");
    }
    const state = await (this.sdk.info as any)?.spot?.getSpotClearinghouseState?.(this.userAddress, true);
    const balances = Array.isArray(state?.balances)
      ? state.balances
      : Array.isArray(state?.spotState?.balances)
        ? state.spotState.balances
        : Array.isArray(state?.tokenBalances)
          ? state.tokenBalances
          : [];
    for (const entry of balances) {
      const tokenIndex = Number(entry?.token ?? entry?.tokenId ?? entry?.coinIndex ?? NaN);
      const symbol = String(entry?.coin ?? entry?.symbol ?? entry?.tokenName ?? "").trim().toUpperCase();
      const totalRaw = entry?.total ?? entry?.balance ?? entry?.sz ?? entry?.amount ?? entry?.available ?? "0";
      if ((Number.isFinite(tokenIndex) && tokenIndex === usdcMeta.index) || symbol === "USDC") {
        const amountUsd = Number(totalRaw ?? 0);
        return {
          amountUsd: Number.isFinite(amountUsd) && amountUsd > 0 ? Number(amountUsd.toFixed(6)) : 0,
          token: usdcMeta.identifier,
          systemAddress
        };
      }
    }
    return {
      amountUsd: 0,
      token: usdcMeta.identifier,
      systemAddress
    };
  }

  private async ensureSdkPerpAssetMapReady(): Promise<void> {
    if (this.perpAssetMapReadyPromise) {
      return this.perpAssetMapReadyPromise;
    }
    this.perpAssetMapReadyPromise = (async () => {
      const symbolConversion = getSdkSymbolConversionState(this.sdk);
      if (!symbolConversion) return;
      if (symbolConversion.initialized && symbolConversion.assetToIndexMap.size > 0) return;

      const [meta] = await this.marketApi.getMetaAndAssetCtxs();
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      symbolConversion.assetToIndexMap.clear();
      symbolConversion.exchangeToInternalNameMap.clear();
      universe.forEach((row, index) => {
        const coin = normalizeHyperliquidSymbol(String(row?.name ?? ""));
        if (!coin) return;
        const internal = toInternalPerpSymbol(coin);
        symbolConversion.assetToIndexMap.set(internal, index);
        symbolConversion.exchangeToInternalNameMap.set(coin, internal);
      });
      symbolConversion.initialized = symbolConversion.assetToIndexMap.size > 0;
      symbolConversion.disablePeriodicRefresh?.();
    })();
    try {
      await this.perpAssetMapReadyPromise;
    } finally {
      if (!(getSdkSymbolConversionState(this.sdk)?.initialized)) {
        this.perpAssetMapReadyPromise = null;
      }
    }
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
    const registry = this.contractCache.getSymbolRegistry();
    return fromHyperliquidSymbol(symbol, registry) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(symbol));
  }

  async toExchangeSymbol(symbol: string): Promise<string> {
    await this.contractCache.refresh(false);
    const registry = this.contractCache.getSymbolRegistry();
    const exchangeSymbol = toHyperliquidSymbol(symbol, registry);
    if (exchangeSymbol) return exchangeSymbol;

    const coin = parseCoinFromAnySymbol(symbol);
    const internal = toInternalPerpSymbol(coin);
    const fallback = toHyperliquidSymbol(internal, registry);
    if (fallback) return fallback;

    throw new SymbolUnknownError(symbol);
  }

  async setLeverage(symbol: string, leverage: number, marginMode: MarginMode): Promise<void> {
    const contract = await this.requireTradeableContract(symbol);
    enforceLeverageBounds(leverage, contract);
    await this.ensureSdkPerpAssetMapReady();

    await this.accountApi.setMarginMode({
      symbol: contract.exchangeSymbol,
      marginMode: mapMarginMode(marginMode),
      marginCoin: this.marginCoin,
      productType: this.productType
    });

    await this.accountApi.setLeverage({
      symbol: contract.exchangeSymbol,
      leverage,
      marginCoin: this.marginCoin,
      productType: this.productType
    });
  }

  async placeOrder(req: PlaceOrderRequest): Promise<{ orderId: string; txHash?: string }> {
    const contract = await this.requireTradeableContract(req.symbol);
    await this.ensureSdkPerpAssetMapReady();
    const clientOid = String(req.clientOrderId ?? "").trim() || createClientOid();

    const qty = normalizeQty(Number(req.qty), contract.stepSize);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`hyperliquid_invalid_qty:${String(req.qty)}`);
    }

    const placed = await this.tradeApi.placeOrder({
      symbol: contract.exchangeSymbol,
      assetIndex: contract.assetIndex,
      productType: this.productType,
      szDecimals: Number(contract.raw.universe.szDecimals ?? 0),
      marginCoin: this.marginCoin,
      marginMode: mapMarginMode(req.marginMode ?? "cross"),
      side: req.side,
      orderType: req.type,
      size: String(qty),
      price: req.price !== undefined ? String(req.price) : undefined,
      clientOid,
      presetStopSurplusPrice:
        req.takeProfitPrice !== undefined ? String(req.takeProfitPrice) : undefined,
      presetStopLossPrice:
        req.stopLossPrice !== undefined ? String(req.stopLossPrice) : undefined,
      force: req.type === "limit" ? "gtc" : "ioc",
      reduceOnly: req.reduceOnly ? "YES" : "NO"
    });

    const orderId = parseOrderId(placed);
    if (!orderId) {
      throw new Error("hyperliquid_place_order_missing_order_id");
    }

    this.orderSymbolIndex.set(orderId, contract.exchangeSymbol);
    return {
      orderId,
      txHash: typeof placed.txHash === "string" ? placed.txHash : undefined
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const parsedCoreWriterOrderId = parseCoreWriterOrderId(orderId);
    if (parsedCoreWriterOrderId) {
      await this.tradeApi.cancelOrder({
        symbol: "",
        orderId,
        productType: this.productType
      });
      return;
    }

    let symbol = this.orderSymbolIndex.get(orderId) ?? null;

    if (!symbol) {
      const pending = await this.tradeApi.getPendingOrders({
        productType: this.productType,
        pageSize: 100
      });
      const matched = pending.find((item) => String(item.orderId ?? "") === orderId);
      symbol = String(matched?.symbol ?? "").trim() || null;
    }

    if (!symbol) {
      throw new Error(`hyperliquid_symbol_resolution_failed:${orderId}`);
    }

    await this.ensureSdkPerpAssetMapReady();

    await this.tradeApi.cancelOrder({
      symbol,
      orderId,
      productType: this.productType
    });
  }

  async setPositionTpSl(params: PositionTpSlParams): Promise<{ ok: true }> {
    const targetSymbol = this.toCanonicalSymbol(params.symbol) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(params.symbol));
    const positions = await this.getPositions();
    const targets = positions
      .filter((row) => row.symbol === targetSymbol)
      .filter((row) => (params.side ? row.side === params.side : true));

    if (targets.length === 0) {
      throw new Error("hyperliquid_position_not_found");
    }
    if (targets.length > 1 && !params.side) {
      throw new Error("hyperliquid_position_side_required");
    }
    if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null && params.takeProfitPrice <= 0) {
      throw new Error("hyperliquid_invalid_take_profit");
    }
    if (params.stopLossPrice !== undefined && params.stopLossPrice !== null && params.stopLossPrice <= 0) {
      throw new Error("hyperliquid_invalid_stop_loss");
    }

    const target = targets[0]!;
    const contract = this.contractCache?.getByCanonical
      ? await this.contractCache.getByCanonical(target.symbol).catch(() => null)
      : null;
    const szDecimals = Number(contract?.raw?.universe?.szDecimals ?? 0);
    const szDecimalsInput = contract ? { szDecimals } : {};
    const exchangeSymbol = await this.toExchangeSymbol(target.symbol);
    const pendingPlanOrders = await this.tradeApi.getPendingPlanOrders({
      symbol: exchangeSymbol,
      pageSize: 100
    });
    const cancelKinds = new Set<"tp" | "sl">();
    if (params.takeProfitPrice !== undefined) cancelKinds.add("tp");
    if (params.stopLossPrice !== undefined) cancelKinds.add("sl");

    if (cancelKinds.size > 0) {
      await this.ensureSdkPerpAssetMapReady();
      await Promise.allSettled(
        pendingPlanOrders.map(async (row) => {
          const kind = toPlanKind(row.planType);
          if (!kind || !cancelKinds.has(kind)) return;
          const orderId = String(row.orderId ?? row.clientOid ?? "").trim();
          if (!orderId) return;
          await this.tradeApi.cancelPlanOrder({
            symbol: exchangeSymbol,
            orderId,
            productType: this.productType
          });
        })
      );
    }

    if (params.takeProfitPrice !== undefined && params.takeProfitPrice !== null) {
      await this.ensureSdkPerpAssetMapReady();
      await this.tradeApi.placePositionTpSl({
        symbol: exchangeSymbol,
        productType: this.productType,
        ...szDecimalsInput,
        marginCoin: this.marginCoin,
        holdSide: target.side,
        planType: "profit_plan",
        triggerPrice: String(params.takeProfitPrice)
      });
    }
    if (params.stopLossPrice !== undefined && params.stopLossPrice !== null) {
      await this.ensureSdkPerpAssetMapReady();
      await this.tradeApi.placePositionTpSl({
        symbol: exchangeSymbol,
        productType: this.productType,
        ...szDecimalsInput,
        marginCoin: this.marginCoin,
        holdSide: target.side,
        planType: "loss_plan",
        triggerPrice: String(params.stopLossPrice)
      });
    }

    return { ok: true };
  }

  async closePosition(params: ClosePositionParams): Promise<{ orderIds: string[] }> {
    const targetSymbol = this.toCanonicalSymbol(params.symbol) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(params.symbol));
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
      orderIds.push(placed.orderId);
    }
    return { orderIds };
  }

  async addPositionMargin(params: {
    symbol: string;
    amountUsd: number;
    marginMode?: MarginMode;
  }): Promise<{ ok: true }> {
    const contract = await this.requireTradeableContract(params.symbol);
    await this.ensureSdkPerpAssetMapReady();
    await this.accountApi.addPositionMargin({
      symbol: contract.exchangeSymbol,
      amountUsd: params.amountUsd,
      marginMode: mapMarginMode(params.marginMode ?? "cross")
    });
    return { ok: true };
  }

  async transferUsdClass(params: {
    amountUsd: number;
    toPerp: boolean;
  }): Promise<{ ok: true; txHash?: string }> {
    if (!this.coreWriter) {
      throw new Error("hyperliquid_usd_class_transfer_unsupported");
    }
    const result = await this.coreWriter.sendUsdClassTransfer({
      amountUsd: params.amountUsd,
      toPerp: params.toPerp
    });
    return {
      ok: true,
      txHash: result.txHash
    };
  }

  async depositUsdcToHyperCore(params: {
    amountUsd: number;
  }): Promise<{ ok: true; txHash?: string }> {
    if (!this.coreWriter) {
      throw new Error("hyperliquid_core_spot_transfer_unsupported");
    }
    const result = await this.coreWriter.depositUsdcToHyperCore({
      amountUsd: params.amountUsd
    });
    return {
      ok: true,
      txHash: result.txHash
    };
  }

  async transferUsdcSpotToEvm(params: {
    amountUsd: number;
  }): Promise<{ ok: true }> {
    if (!this.hasSigning || !String(this.config.apiSecret ?? "").trim()) {
      throw new Error("hyperliquid_core_to_evm_signing_unavailable");
    }
    const vaultAddress = this.getConfiguredVaultAddress();
    if (!vaultAddress) {
      throw new Error("hyperliquid_core_to_evm_vault_address_missing");
    }
    const { amountUsd, token, systemAddress } = await this.getCoreUsdcSpotBalance();
    const requestedAmountUsd = Math.max(0, Number(params.amountUsd ?? 0));
    const transferAmountUsd = Math.min(amountUsd, requestedAmountUsd);
    if (!Number.isFinite(transferAmountUsd) || transferAmountUsd <= 0) {
      throw new Error("hyperliquid_core_to_evm_no_spot_balance");
    }
    const wallet = privateKeyToAccount(String(this.config.apiSecret).trim() as `0x${string}`);
    await sendAsset(
      {
        transport: new HttpTransport({
          apiUrl: this.getExchangeApiUrl()
        }),
        wallet,
        signatureChainId: this.getSignatureChainIdHex(),
        defaultVaultAddress: vaultAddress
      },
      {
        destination: systemAddress,
        sourceDex: "spot",
        destinationDex: "",
        token,
        amount: formatUnsignedDecimal(transferAmountUsd),
        fromSubAccount: ""
      }
    );
    return { ok: true };
  }

  async subscribeTicker(symbol: string): Promise<void> {
    this.tickerSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  async subscribeDepth(symbol: string): Promise<void> {
    this.depthSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  async subscribeTrades(symbol: string): Promise<void> {
    this.tradeSymbols.add(await this.toExchangeSymbol(symbol));
    this.ensureMarketPoller();
  }

  onTicker(callback: (payload: any) => void): () => void {
    this.tickerCallbacks.add(callback);
    return () => {
      this.tickerCallbacks.delete(callback);
    };
  }

  onDepth(callback: (payload: any) => void): () => void {
    this.depthCallbacks.add(callback);
    return () => {
      this.depthCallbacks.delete(callback);
    };
  }

  onTrades(callback: (payload: any) => void): () => void {
    this.tradeCallbacks.add(callback);
    return () => {
      this.tradeCallbacks.delete(callback);
    };
  }

  onFill(callback: (event: any) => void): () => void {
    this.fillCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.fillCallbacks.delete(callback);
    };
  }

  onPositionUpdate(callback: (event: any) => void): () => void {
    this.positionCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.positionCallbacks.delete(callback);
    };
  }

  onOrderUpdate(callback: (event: any) => void): () => void {
    this.orderCallbacks.add(callback);
    this.ensurePrivatePoller();
    return () => {
      this.orderCallbacks.delete(callback);
    };
  }

  async close(): Promise<void> {
    this.contractCache.stopBackgroundRefresh();
    if (this.marketPollTimer) {
      clearInterval(this.marketPollTimer);
      this.marketPollTimer = null;
    }
    if (this.privatePollTimer) {
      clearInterval(this.privatePollTimer);
      this.privatePollTimer = null;
    }

    this.tickerSymbols.clear();
    this.depthSymbols.clear();
    this.tradeSymbols.clear();

    this.tickerCallbacks.clear();
    this.depthCallbacks.clear();
    this.tradeCallbacks.clear();
    this.fillCallbacks.clear();
    this.orderCallbacks.clear();
    this.positionCallbacks.clear();
    this.seenFillKeys.clear();
  }

  getLatestTickerSnapshot(symbol: string): unknown | null {
    const snapshot = this.lastMarketSnapshot;
    if (!snapshot) return null;
    const coin = parseCoinFromAnySymbol(symbol);
    const ticker = snapshot.tickersByCoin.get(coin) ?? null;
    if (!ticker) return null;
    return {
      ...ticker,
      diagnostics: {
        ...ticker.diagnostics,
        snapshotAgeMs: Math.max(0, Date.now() - snapshot.fetchedAt)
      }
    };
  }

  private ensureMarketPoller(): void {
    if (this.marketPollTimer) return;
    const intervalMs = Math.max(1_000, Number(process.env.HYPERLIQUID_MARKET_POLL_MS ?? "2000"));

    this.marketPollTimer = setInterval(() => {
      void this.runMarketPoll();
    }, intervalMs);

    void this.runMarketPoll();
  }

  private async runMarketPoll(): Promise<void> {
    if (this.marketPollRunning) return;
    this.marketPollRunning = true;

    try {
      if (this.tickerCallbacks.size > 0) {
        try {
          const snapshot = await this.marketApi.getMarketSnapshot();
          this.lastMarketSnapshot = snapshot;
          for (const symbol of this.tickerSymbols) {
            const coin = parseCoinFromAnySymbol(symbol);
            const ticker = snapshot.tickersByCoin.get(coin);
            if (!ticker) continue;
            const payload = {
              data: [ticker]
            };
            for (const cb of this.tickerCallbacks) cb(payload);
          }
        } catch {
          // keep polling resilient if the shared market snapshot cannot be refreshed
        }
      }

      if (this.depthCallbacks.size > 0) {
        for (const symbol of this.depthSymbols) {
          try {
            const depth = await this.marketApi.getDepth(symbol, 50, this.productType);
            const payload = {
              data: [depth]
            };
            for (const cb of this.depthCallbacks) cb(payload);
          } catch {
            // keep polling resilient per symbol
          }
        }
      }

      if (this.tradeCallbacks.size > 0) {
        for (const symbol of this.tradeSymbols) {
          try {
            const trades = await this.marketApi.getTrades(symbol, 60, this.productType);
            const payload = {
              data: Array.isArray(trades) ? trades : []
            };
            for (const cb of this.tradeCallbacks) cb(payload);
          } catch {
            // keep polling resilient per symbol
          }
        }
      }
    } finally {
      this.marketPollRunning = false;
    }
  }

  private ensurePrivatePoller(): void {
    if (this.privatePollTimer) return;
    const intervalMs = Math.max(2_000, Number(process.env.HYPERLIQUID_PRIVATE_POLL_MS ?? "5000"));

    this.privatePollTimer = setInterval(() => {
      void this.runPrivatePoll();
    }, intervalMs);

    void this.runPrivatePoll();
  }

  private async runPrivatePoll(): Promise<void> {
    if (this.privatePollRunning) return;
    this.privatePollRunning = true;

    try {
      if (this.fillCallbacks.size > 0) {
        try {
          const fills = await this.tradeApi.getFills({ limit: 50 });
          const rows = Array.isArray(fills) ? fills : [];
          for (const row of rows.slice().reverse()) {
            const record = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
            if (!record) continue;
            const key = `${String(record.tid ?? "")}:${String(record.hash ?? "")}`;
            if (!key || this.seenFillKeys.has(key)) continue;
            this.seenFillKeys.add(key);
            if (this.seenFillKeys.size > 500) {
              const oldest = this.seenFillKeys.values().next().value as string | undefined;
              if (oldest) this.seenFillKeys.delete(oldest);
            }

            const symbol = this.toCanonicalSymbol(String(record.coin ?? "")) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(String(record.coin ?? "")));
            const event = {
              orderId: String(record.oid ?? ""),
              symbol,
              side: String(record.side ?? "").toLowerCase().includes("b") ? "buy" : "sell",
              price: toNumber(record.px) ?? undefined,
              qty: toNumber(record.sz) ?? undefined,
              raw: row
            };
            for (const cb of this.fillCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }

      if (this.orderCallbacks.size > 0) {
        try {
          const [openOrders, openPlans] = await Promise.all([
            this.tradeApi.getPendingOrders({ pageSize: 50 }),
            this.tradeApi.getPendingPlanOrders({ pageSize: 50 })
          ]);
          const rows = [...openOrders, ...openPlans];
          for (const row of rows) {
            const symbol = row.symbol ? this.toCanonicalSymbol(row.symbol) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(row.symbol)) : undefined;
            const event = {
              orderId: String(row.orderId ?? ""),
              symbol,
              status: row.status,
              raw: row
            };
            for (const cb of this.orderCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }

      if (this.positionCallbacks.size > 0) {
        try {
          const positions = await this.getPositions();
          for (const row of positions) {
            const event = {
              symbol: row.symbol,
              side: row.side,
              size: row.size,
              raw: row
            };
            for (const cb of this.positionCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }
    } finally {
      this.privatePollRunning = false;
    }
  }

  private async requireTradeableContract(symbol: string): Promise<HyperliquidContractInfo> {
    const contract = await this.contractCache.getByCanonical(symbol);
    if (!contract) throw new SymbolUnknownError(symbol);

    if (!contract.apiAllowed) {
      throw new TradingNotAllowedError(
        contract.canonicalSymbol,
        `Hyperliquid symbol ${contract.exchangeSymbol} is not tradable`
      );
    }

    return contract;
  }
}
