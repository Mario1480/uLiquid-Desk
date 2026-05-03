import type {
  AccountState,
  ContractInfo,
  FuturesPosition,
  MarginMode
} from "@mm/futures-core";
import { SymbolUnknownError, TradingNotAllowedError, enforceLeverageBounds } from "@mm/futures-core";
import { Hyperliquid } from "hyperliquid";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import {
  isConfirmedFuturesActionResult,
  isConfirmedPlaceOrderResult
} from "../futures-exchange.interface.js";
import type {
  CancelOrderResult,
  FundsTransferResult,
  FuturesExchange,
  PlaceOrderRequest,
  PlaceOrderResult
} from "../futures-exchange.interface.js";
import type {
  ClosePositionParams,
  NormalizedOrder,
  NormalizedPosition,
  PositionTpSlParams
} from "../core/order-normalization.types.js";
import {
  HYPERLIQUID_DEFAULT_MARGIN_COIN,
  HYPERLIQUID_DEFAULT_PRODUCT_TYPE,
  HYPERLIQUID_ZERO_ADDRESS,
  HYPEREVM_DEFAULT_USDC_ADDRESS,
  HYPEREVM_DEFAULT_USDC_DECIMALS
} from "./hyperliquid.constants.js";
import { HyperliquidAccountApi } from "./hyperliquid.account.api.js";
import { HyperliquidContractCache } from "./hyperliquid.contract-cache.js";
import { HyperliquidMarketApi, type HyperliquidMarketSnapshot } from "./hyperliquid.market.api.js";
import { HyperliquidPositionApi } from "./hyperliquid.position.api.js";
import { HyperliquidTradeApi } from "./hyperliquid.trade.api.js";
import { HyperliquidCoreWriterClient, parseCoreWriterOrderId } from "./hyperliquid.corewriter.js";
import {
  readHyperliquidSpotClearinghouseState,
  readHyperliquidSpotMeta
} from "./hyperliquid.info.http.js";
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

const erc20BalanceOfAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)"
]);

const botVaultUsdcAbi = parseAbi([
  "function usdc() view returns (address)"
]);

const HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD = 0.000001;

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

function toSpotWeiAmount(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("hyperliquid_core_to_evm_invalid_amount");
  }
  const normalizedDecimals = Number.isFinite(decimals) && decimals >= 0 ? Math.trunc(decimals) : 8;
  const scaled = Math.round(value * 10 ** normalizedDecimals);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error("hyperliquid_core_to_evm_invalid_amount");
  }
  return BigInt(scaled);
}

function normalizeUsdAmount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number(parsed.toFixed(6));
}

function normalizeTokenDecimals(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 36) return fallback;
  return Math.trunc(parsed);
}

function atomicTokenBalanceToNumber(value: bigint, decimals: number): number {
  if (value <= 0n) return 0;
  const normalizedDecimals = normalizeTokenDecimals(decimals, HYPEREVM_DEFAULT_USDC_DECIMALS);
  const scaled = Number(value) / 10 ** normalizedDecimals;
  if (!Number.isFinite(scaled) || scaled <= 0) return 0;
  return Number(scaled.toFixed(6));
}

function mapMarginMode(mode: MarginMode): "isolated" | "crossed" {
  return mode === "isolated" ? "isolated" : "crossed";
}

function isHyperliquidTestnet(restBaseUrl?: string | null): boolean {
  return (
    String(restBaseUrl ?? "").toLowerCase().includes("testnet")
    || String(process.env.HYPERLIQUID_TESTNET ?? "").trim() === "1"
  );
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
  const ratio = qty / stepSize;
  const epsilon = Math.max(1e-9, Math.abs(ratio) * Number.EPSILON * 16);
  const steps = Math.floor(ratio + epsilon);
  return Number((steps * stepSize).toFixed(12));
}

function parseOrderId(row: { orderId?: string; clientOid?: string }): string | null {
  const orderId = String(row.orderId ?? "").trim();
  if (orderId) return orderId;
  return null;
}

function toNormalizedOrder(row: any): NormalizedOrder {
  return {
    orderId: String(row?.orderId ?? ""),
    symbol: String(row?.symbol ?? ""),
    side: typeof row?.side === "string" ? row.side : null,
    type: typeof row?.orderType === "string" ? row.orderType : null,
    status: typeof row?.status === "string" ? row.status : null,
    price: toNumber(row?.price),
    qty: toNumber(row?.size),
    triggerPrice: toNumber(row?.triggerPrice),
    takeProfitPrice: null,
    stopLossPrice: null,
    reduceOnly: typeof row?.reduceOnly === "boolean" ? row.reduceOnly : null,
    createdAt: typeof row?.cTime === "string" ? row.cTime : null,
    raw: row?.raw ?? row
  };
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

type HyperliquidOrderMetadata = {
  symbol: string | null;
  assetIndex: number | null;
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
  readonly readSdk: Hyperliquid;
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
  private readonly botVaultAddress: `0x${string}` | null;
  private readonly hyperEvmRpcUrl: string;
  private readonly hyperEvmChainId: number;
  private readonly hyperEvmUsdcAddress: `0x${string}` | null;
  private readonly hyperEvmUsdcDecimals: number;
  private readonly orderSymbolIndex = new Map<string, string>();
  private readonly orderAssetIndex = new Map<string, number>();

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
    const testnet = isHyperliquidTestnet(config.restBaseUrl);
    const botVaultAddress = normalizeEvmAddress(config.botVaultAddress);
    this.botVaultAddress = botVaultAddress ? botVaultAddress as `0x${string}` : null;
    this.hyperEvmRpcUrl = String(
      config.hyperEvmRpcUrl ?? process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm"
    ).trim() || "https://rpc.hyperliquid.xyz/evm";
    this.hyperEvmChainId = Math.max(
      1,
      Math.trunc(Number(config.hyperEvmChainId ?? process.env.HYPEREVM_CHAIN_ID ?? 999))
    );
    this.hyperEvmUsdcAddress = normalizeEvmAddress(
      config.hyperEvmUsdcAddress
        ?? process.env.USDC_ADDRESS
        ?? process.env.VAULT_ONCHAIN_USDC_ADDRESS
        ?? process.env.CONTRACTS_USDC_ADDRESS
        ?? HYPEREVM_DEFAULT_USDC_ADDRESS
    ) as `0x${string}` | null;
    this.hyperEvmUsdcDecimals = normalizeTokenDecimals(
      config.hyperEvmUsdcDecimals ?? process.env.USDC_DECIMALS,
      HYPEREVM_DEFAULT_USDC_DECIMALS
    );

    this.sdk = new Hyperliquid({
      enableWs: false,
      privateKey: config.apiSecret,
      walletAddress: walletAddress ?? this.userAddress,
      vaultAddress: vaultAddress ?? undefined,
      testnet,
      // The upstream SDK refreshes perp and spot maps together. If the spot side
      // is temporarily unhealthy, futures writes like leverage/order placement
      // fail during symbol conversion. We seed the perp map from our own cache.
      disableAssetMapRefresh: true
    });
    this.readSdk = new Hyperliquid({
      enableWs: false,
      walletAddress: walletAddress ?? this.userAddress,
      vaultAddress: vaultAddress ?? undefined,
      testnet,
      // The upstream SDK refreshes perp and spot maps together. If the spot side
      // is temporarily unhealthy, futures writes like leverage/order placement
      // fail during symbol conversion. We seed the perp map from our own cache.
      disableAssetMapRefresh: true
    });

    this.marketApi = new HyperliquidMarketApi(this.readSdk, {
      timeoutMs: config.timeoutMs,
      retryAttempts: config.retryAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      log: config.log
    });
    this.accountApi = new HyperliquidAccountApi(this.hasSigning ? this.sdk : this.readSdk, this.userAddress, walletAddress);
    this.positionApi = new HyperliquidPositionApi(this.readSdk, this.userAddress, this.marketApi, walletAddress);
    const coreWriter =
      this.writeMode === "hyperevm_corewriter" && botVaultAddress && this.hasSigning && String(config.apiSecret ?? "").trim()
        ? new HyperliquidCoreWriterClient({
            privateKey: String(config.apiSecret).trim() as `0x${string}`,
            botVaultAddress: botVaultAddress as `0x${string}`,
            rpcUrl: this.hyperEvmRpcUrl,
            chainId: this.hyperEvmChainId
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

  private createHyperEvmPublicClient() {
    const chain = defineChain({
      id: this.hyperEvmChainId,
      name: this.hyperEvmChainId === 999 ? "HyperEVM" : `HyperEVM-${this.hyperEvmChainId}`,
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      rpcUrls: {
        default: {
          http: [this.hyperEvmRpcUrl]
        }
      }
    });
    return createPublicClient({
      chain,
      transport: http(this.hyperEvmRpcUrl)
    });
  }

  private async resolveBotVaultUsdcAddress(client: ReturnType<typeof createPublicClient>): Promise<`0x${string}` | null> {
    if (!this.botVaultAddress) return this.hyperEvmUsdcAddress;
    const vaultUsdcAddress = await client.readContract({
      address: this.botVaultAddress,
      abi: botVaultUsdcAbi,
      functionName: "usdc"
    }).catch(() => null);
    const normalizedVaultUsdcAddress = normalizeEvmAddress(vaultUsdcAddress);
    return normalizedVaultUsdcAddress
      ? normalizedVaultUsdcAddress as `0x${string}`
      : this.hyperEvmUsdcAddress;
  }

  async getEvmUsdcBalance(): Promise<{
    amountUsd: number;
    amountAtomic: bigint;
    holderAddress: `0x${string}`;
    tokenAddress: `0x${string}`;
    decimals: number;
  }> {
    if (!this.botVaultAddress) {
      throw new Error("hyperliquid_evm_usdc_balance_vault_missing");
    }
    const client = this.createHyperEvmPublicClient();
    const tokenAddress = await this.resolveBotVaultUsdcAddress(client);
    if (!tokenAddress) {
      throw new Error("hyperliquid_evm_usdc_token_missing");
    }
    const amountAtomic = await client.readContract({
      address: tokenAddress,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [this.botVaultAddress]
    }) as bigint;
    return {
      amountUsd: atomicTokenBalanceToNumber(amountAtomic, this.hyperEvmUsdcDecimals),
      amountAtomic,
      holderAddress: this.botVaultAddress,
      tokenAddress,
      decimals: this.hyperEvmUsdcDecimals
    };
  }

  private async readSpotTokenMetaBySymbol(): Promise<Map<string, { index: number; identifier: string; weiDecimals: number }>> {
    const spotMeta = await readHyperliquidSpotMeta(this.sdk);
    const tokens = Array.isArray(spotMeta?.tokens)
      ? spotMeta.tokens
      : Array.isArray(spotMeta?.universe)
        ? spotMeta.universe
        : [];
    const bySymbol = new Map<string, { index: number; identifier: string; weiDecimals: number }>();
    tokens.forEach((entry: any, fallbackIndex: number) => {
      const resolvedIndexRaw = Number(entry?.index ?? entry?.token ?? entry?.tokenId ?? entry?.coinIndex ?? NaN);
      const resolvedIndex = Number.isFinite(resolvedIndexRaw) && resolvedIndexRaw >= 0
        ? Math.trunc(resolvedIndexRaw)
        : fallbackIndex;
      const nameRaw = String(entry?.name ?? entry?.coin ?? entry?.symbol ?? entry?.tokenName ?? `token_${fallbackIndex}`).trim();
      const tokenIdRaw = String(entry?.tokenId ?? "").trim();
      const weiDecimalsRaw = Number(entry?.weiDecimals ?? entry?.decimals ?? NaN);
      const symbol = nameRaw.toUpperCase();
      if (!symbol) return;
      bySymbol.set(symbol, {
        index: resolvedIndex,
        identifier: tokenIdRaw ? `${nameRaw}:${tokenIdRaw}` : nameRaw,
        weiDecimals: Number.isFinite(weiDecimalsRaw) && weiDecimalsRaw >= 0 ? Math.trunc(weiDecimalsRaw) : 8
      });
    });
    return bySymbol;
  }

  async getCoreUsdcSpotBalance(): Promise<{
    amountUsd: number;
    token: string;
    tokenIndex: number;
    systemAddress: `0x${string}`;
    weiDecimals: number;
  }> {
    const tokenMetaBySymbol = await this.readSpotTokenMetaBySymbol();
    const usdcMeta = tokenMetaBySymbol.get("USDC");
    if (!usdcMeta?.identifier) {
      throw new Error("hyperliquid_usdc_spot_token_missing");
    }
    const systemAddress = encodeCoreSystemAddress(usdcMeta.index, "USDC");
    if (!systemAddress) {
      throw new Error("hyperliquid_usdc_system_address_missing");
    }
    const state = await readHyperliquidSpotClearinghouseState(this.sdk, this.userAddress);
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
          tokenIndex: usdcMeta.index,
          systemAddress,
          weiDecimals: usdcMeta.weiDecimals
        };
      }
    }
    return {
      amountUsd: 0,
      token: usdcMeta.identifier,
      tokenIndex: usdcMeta.index,
      systemAddress,
      weiDecimals: usdcMeta.weiDecimals
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

  async getConfiguredAccountState(): Promise<AccountState> {
    const account = await this.accountApi.getPrimaryAccount(this.productType);
    return {
      equity: toNumber(account?.accountEquity) ?? 0,
      availableMargin: toNumber(account?.available) ?? toNumber(account?.crossAvailable) ?? undefined,
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

  async listPositions(params?: { symbol?: string }): Promise<NormalizedPosition[]> {
    const target = params?.symbol
      ? this.toCanonicalSymbol(params.symbol) ?? coinToCanonicalSymbol(parseCoinFromAnySymbol(params.symbol))
      : null;
    const rows = await this.getPositions();
    return rows
      .filter((row) => (target ? row.symbol.toUpperCase() === target.toUpperCase() : true))
      .map((row) => ({
        symbol: row.symbol,
        side: row.side,
        size: row.size,
        entryPrice: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
        markPrice: Number.isFinite(Number(row.markPrice)) ? Number(row.markPrice) : null,
        unrealizedPnl: Number.isFinite(Number(row.unrealizedPnl)) ? Number(row.unrealizedPnl) : null,
        takeProfitPrice: null,
        stopLossPrice: null
      }));
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

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
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

    if (!isConfirmedPlaceOrderResult(placed)) {
      if (typeof placed?.status !== "string" || !placed.status.trim()) {
        throw new Error("hyperliquid_place_order_missing_order_id");
      }
      return {
        ...placed,
        clientOrderId: placed.clientOrderId ?? clientOid
      };
    }

    const orderId = parseOrderId(placed);
    if (!orderId) {
      throw new Error("hyperliquid_place_order_missing_order_id");
    }

    this.cacheOrderMetadata(orderId, contract.exchangeSymbol, contract.assetIndex);
    return {
      ...placed,
      orderId,
      clientOrderId: placed.clientOrderId ?? clientOid
    };
  }

  async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    return this.cancelOrderByParams({ orderId });
  }

  async cancelOrderByParams(params: { orderId: string; symbol?: string }): Promise<CancelOrderResult> {
    const orderId = String(params.orderId ?? "").trim();
    const parsedCoreWriterOrderId = parseCoreWriterOrderId(orderId);
    if (parsedCoreWriterOrderId) {
      return this.tradeApi.cancelOrder({
        symbol: "",
        orderId,
        productType: this.productType
      });
    }

    if (this.coreWriter) {
      const numericOrderId = Number(orderId);
      if (Number.isFinite(numericOrderId) && numericOrderId > 0) {
        const { assetIndex } = await this.resolveOrderMetadataForCancel(orderId, params.symbol);
        if (Number.isFinite(Number(assetIndex ?? NaN)) && Number(assetIndex) >= 0) {
          return this.coreWriter.cancelByOid({
            asset: Math.trunc(Number(assetIndex)),
            oid: Math.trunc(numericOrderId)
          });
        }
      }
    }

    const { symbol } = await this.resolveOrderMetadataForCancel(orderId, params.symbol);
    if (!symbol) {
      throw new Error(`hyperliquid_symbol_resolution_failed:${orderId}`);
    }

    await this.ensureSdkPerpAssetMapReady();

    return this.tradeApi.cancelOrder({
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
      if (!isConfirmedPlaceOrderResult(placed)) {
        throw new Error(placed.errorMessage ?? placed.errorCode ?? "hyperliquid_close_position_confirmation_pending");
      }
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
  }): Promise<FundsTransferResult> {
    if (!this.coreWriter) {
      throw new Error("hyperliquid_usd_class_transfer_unsupported");
    }
    return this.coreWriter.sendUsdClassTransfer({
      amountUsd: params.amountUsd,
      toPerp: params.toPerp
    });
  }

  private async readCoreUsdcSpotBalanceForDepositReconciliation(): Promise<number | null> {
    try {
      const balance = await this.getCoreUsdcSpotBalance();
      const amountUsd = Number(balance.amountUsd ?? NaN);
      return Number.isFinite(amountUsd) ? Number(amountUsd.toFixed(6)) : null;
    } catch (error) {
      this.config.log?.({
        at: new Date().toISOString(),
        endpoint: "hyperliquid/deposit/reconcile-core-usdc",
        method: "GET",
        durationMs: 0,
        ok: false,
        message: String(error)
      });
      return null;
    }
  }

  private async reconcileSubmittedHyperCoreDeposit(params: {
    result: FundsTransferResult;
    requestedAmountUsd: number;
    coreBalanceBeforeUsd: number | null;
  }): Promise<FundsTransferResult> {
    if (params.result.status === "failed") {
      return params.result;
    }

    const coreBalanceAfterUsd = await this.readCoreUsdcSpotBalanceForDepositReconciliation();
    const coreBalanceReachedRequestedDeposit =
      params.coreBalanceBeforeUsd !== null
      && coreBalanceAfterUsd !== null
      && coreBalanceAfterUsd + HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD
        >= params.coreBalanceBeforeUsd + params.requestedAmountUsd;
    if (coreBalanceReachedRequestedDeposit) {
      return {
        ...params.result,
        status: "confirmed",
        submitted: params.result.submitted || typeof params.result.txHash === "string",
        amountUsd: params.requestedAmountUsd,
        errorCode: "deposit_confirmed",
        errorMessage: "deposit_confirmed"
      };
    }

    const receiptConfirmed =
      params.result.confirmationSource === "receipt"
      && params.result.receiptStatus === "success";
    const errorCode = receiptConfirmed
      ? "deposit_pending_reconciliation"
      : "deposit_submitted";
    return {
      ...params.result,
      status: "pending_timeout",
      submitted: true,
      amountUsd: params.requestedAmountUsd,
      errorCode,
      errorMessage: errorCode
    };
  }

  private async reconcileSubmittedSpotToEvmTransfer(params: {
    result: FundsTransferResult;
    requestedAmountUsd: number;
    transferAmountUsd: number;
    evmBalanceBeforeUsd: number | null;
  }): Promise<FundsTransferResult> {
    if (params.result.status === "failed") {
      const finalFailure = params.result.receiptStatus === "reverted";
      return {
        ...params.result,
        status: finalFailure ? "transfer_failed_final" : "transfer_failed_retryable",
        submitted: params.result.submitted || typeof params.result.txHash === "string",
        amountUsd: params.transferAmountUsd,
        errorCode: params.result.errorCode ?? (finalFailure ? "transfer_failed_final" : "transfer_failed_retryable"),
        errorMessage: params.result.errorMessage ?? (finalFailure ? "transfer_failed_final" : "transfer_failed_retryable")
      };
    }

    const evmBalanceAfter = await this.getEvmUsdcBalance().catch(() => null);
    const evmBalanceAfterUsd = evmBalanceAfter?.amountUsd ?? null;
    const evmBalanceReachedRequestedAmount =
      evmBalanceAfterUsd !== null
      && evmBalanceAfterUsd + HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD >= params.requestedAmountUsd;
    const evmBalanceIncreasedByRequestedAmount =
      params.evmBalanceBeforeUsd !== null
      && evmBalanceAfterUsd !== null
      && evmBalanceAfterUsd + HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD
        >= params.evmBalanceBeforeUsd + params.requestedAmountUsd;
    if (evmBalanceReachedRequestedAmount || evmBalanceIncreasedByRequestedAmount) {
      return {
        ...params.result,
        status: "transfer_confirmed",
        submitted: params.result.submitted || typeof params.result.txHash === "string",
        amountUsd: params.transferAmountUsd,
        errorCode: "transfer_confirmed",
        errorMessage: "transfer_confirmed"
      };
    }

    const receiptConfirmed =
      params.result.confirmationSource === "receipt"
      && params.result.receiptStatus === "success";
    const errorCode = receiptConfirmed
      ? "transfer_pending_reconciliation"
      : "transfer_submitted";
    return {
      ...params.result,
      status: receiptConfirmed ? "transfer_pending_reconciliation" : "transfer_submitted",
      submitted: true,
      amountUsd: params.transferAmountUsd,
      errorCode,
      errorMessage: errorCode
    };
  }

  async depositUsdcToHyperCore(params: {
    amountUsd: number;
  }): Promise<FundsTransferResult> {
    if (!this.coreWriter) {
      throw new Error("hyperliquid_core_spot_transfer_unsupported");
    }
    const requestedAmountUsd = normalizeUsdAmount(params.amountUsd);
    if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) {
      throw new Error("hyperliquid_core_spot_transfer_invalid_amount");
    }

    const [evmBalance, coreBalanceBeforeUsd] = await Promise.all([
      this.getEvmUsdcBalance(),
      this.readCoreUsdcSpotBalanceForDepositReconciliation()
    ]);
    if (evmBalance.amountUsd + HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD < requestedAmountUsd) {
      return {
        status: "failed",
        submitted: false,
        confirmationSource: "none",
        receiptStatus: "unknown",
        amountUsd: requestedAmountUsd,
        errorCode: "insufficient_evm_usdc",
        errorMessage: "insufficient_evm_usdc"
      };
    }

    const submitted = await this.coreWriter.depositUsdcToHyperCore({
      amountUsd: requestedAmountUsd
    });
    return this.reconcileSubmittedHyperCoreDeposit({
      result: submitted,
      requestedAmountUsd,
      coreBalanceBeforeUsd
    });
  }

  async transferUsdcSpotToEvm(params: {
    amountUsd: number;
  }): Promise<FundsTransferResult> {
    const [{ amountUsd, tokenIndex, systemAddress, weiDecimals }, evmBalanceBefore] = await Promise.all([
      this.getCoreUsdcSpotBalance(),
      this.getEvmUsdcBalance().catch(() => null)
    ]);
    const requestedAmountUsd = Math.max(0, Number(params.amountUsd ?? 0));
    if (!Number.isFinite(requestedAmountUsd) || requestedAmountUsd <= 0) {
      return {
        status: "transfer_failed_final",
        submitted: false,
        confirmationSource: "none",
        receiptStatus: "unknown",
        amountUsd: requestedAmountUsd,
        errorCode: "hyperliquid_core_to_evm_invalid_amount",
        errorMessage: "hyperliquid_core_to_evm_invalid_amount"
      };
    }
    if (
      evmBalanceBefore?.amountUsd != null
      && evmBalanceBefore.amountUsd + HYPERLIQUID_DEPOSIT_RECONCILIATION_EPSILON_USD >= requestedAmountUsd
    ) {
      return {
        status: "transfer_confirmed",
        submitted: false,
        confirmationSource: "none",
        receiptStatus: "success",
        amountUsd: requestedAmountUsd,
        errorCode: "transfer_confirmed",
        errorMessage: "transfer_confirmed"
      };
    }
    const transferAmountUsd = Math.min(amountUsd, requestedAmountUsd);
    if (!Number.isFinite(transferAmountUsd) || transferAmountUsd <= 0) {
      return {
        status: "transfer_failed_final",
        submitted: false,
        confirmationSource: "none",
        receiptStatus: "unknown",
        amountUsd: requestedAmountUsd,
        errorCode: "hyperliquid_core_to_evm_no_spot_balance",
        errorMessage: "hyperliquid_core_to_evm_no_spot_balance"
      };
    }
    if (!this.coreWriter) {
      throw new Error("hyperliquid_core_to_evm_unsupported");
    }
    const submitted = await this.coreWriter.sendSpotAsset({
      destination: systemAddress,
      token: tokenIndex,
      weiAmount: toSpotWeiAmount(transferAmountUsd, weiDecimals)
    });
    return this.reconcileSubmittedSpotToEvmTransfer({
      result: submitted,
      requestedAmountUsd,
      transferAmountUsd,
      evmBalanceBeforeUsd: evmBalanceBefore?.amountUsd ?? null
    });
  }

  async listOpenOrders(params?: { symbol?: string }): Promise<NormalizedOrder[]> {
    const exchangeSymbol = params?.symbol
      ? await this.toExchangeSymbol(params.symbol).catch(() => params.symbol as string)
      : undefined;
    const [openOrders, openPlans] = await Promise.all([
      this.tradeApi.getPendingOrders({ symbol: exchangeSymbol }),
      this.tradeApi.getPendingPlanOrders({ symbol: exchangeSymbol })
    ]);
    const rows = [...openOrders, ...openPlans];
    await this.indexOrderMetadata(rows);
    return rows.map((row) => toNormalizedOrder(row));
  }

  async getRecentFills(params?: { symbol?: string; limit?: number }): Promise<unknown[]> {
    const exchangeSymbol = params?.symbol
      ? await this.toExchangeSymbol(params.symbol).catch(() => params.symbol as string)
      : undefined;
    const rows = await this.tradeApi.getFills({
      symbol: exchangeSymbol,
      limit: params?.limit ?? 100
    });
    return Array.isArray(rows) ? rows : [];
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
            await this.indexOrderMetadata([{ orderId: event.orderId, symbol: record.coin ? String(record.coin) : symbol ?? undefined }]);
            for (const cb of this.fillCallbacks) cb(event);
          }
        } catch {
          // keep poller resilient
        }
      }

      if (this.orderCallbacks.size > 0) {
        try {
          const [openOrders, openPlans] = await Promise.all([
            this.tradeApi.getPendingOrders({ pageSize: 500 }),
            this.tradeApi.getPendingPlanOrders({ pageSize: 500 })
          ]);
          const rows = [...openOrders, ...openPlans];
          await this.indexOrderMetadata(rows);
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

  private cacheOrderMetadata(orderId: string, symbol?: string | null, assetIndex?: number | null): void {
    const normalizedOrderId = String(orderId ?? "").trim();
    if (!normalizedOrderId) return;
    const normalizedSymbol = String(symbol ?? "").trim() || null;
    if (normalizedSymbol) {
      this.orderSymbolIndex.set(normalizedOrderId, normalizedSymbol);
    }
    if (Number.isFinite(Number(assetIndex ?? NaN)) && Number(assetIndex) >= 0) {
      this.orderAssetIndex.set(normalizedOrderId, Math.trunc(Number(assetIndex)));
    }
  }

  private async resolveAssetIndexFromSymbol(symbol: string | null | undefined): Promise<number | null> {
    const normalizedSymbol = String(symbol ?? "").trim();
    if (!normalizedSymbol) return null;
    await this.ensureSdkPerpAssetMapReady();
    const symbolConversion = getSdkSymbolConversionState(this.sdk);
    const internal = symbolConversion?.exchangeToInternalNameMap.get(normalizedSymbol)
      ?? (symbolConversion?.assetToIndexMap.has(normalizedSymbol) ? normalizedSymbol : null);
    const directAssetIndex = internal ? symbolConversion?.assetToIndexMap.get(internal) : undefined;
    if (Number.isFinite(Number(directAssetIndex ?? NaN)) && Number(directAssetIndex) >= 0) {
      return Math.trunc(Number(directAssetIndex));
    }
    const contract = await this.requireTradeableContract(normalizedSymbol).catch(async () => {
      const canonical = this.toCanonicalSymbol(normalizedSymbol);
      if (!canonical) return null;
      return this.requireTradeableContract(canonical).catch(() => null);
    });
    if (Number.isFinite(Number(contract?.assetIndex ?? NaN)) && Number(contract?.assetIndex) >= 0) {
      return Math.trunc(Number(contract?.assetIndex));
    }
    return null;
  }

  private async indexOrderMetadata(rows: Array<{ orderId?: string; symbol?: string }>): Promise<void> {
    const uniqueSymbols = new Set<string>();
    for (const row of rows) {
      const symbol = String(row.symbol ?? "").trim();
      if (symbol) uniqueSymbols.add(symbol);
    }
    const assetBySymbol = new Map<string, number | null>();
    await Promise.all([...uniqueSymbols].map(async (symbol) => {
      assetBySymbol.set(symbol, await this.resolveAssetIndexFromSymbol(symbol).catch(() => null));
    }));
    for (const row of rows) {
      const orderId = String(row.orderId ?? "").trim();
      const symbol = String(row.symbol ?? "").trim() || null;
      this.cacheOrderMetadata(orderId, symbol, symbol ? assetBySymbol.get(symbol) ?? null : null);
    }
  }

  private async hydrateOrderMetadataFromPendingOrders(orderId: string): Promise<void> {
    const normalizedOrderId = String(orderId ?? "").trim();
    if (!normalizedOrderId) return;
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const pageSize = Math.min(1000, 100 * (2 ** attempt));
      const pending = await this.tradeApi.getPendingOrders({
        productType: this.productType,
        pageSize,
        idLessThan: cursor
      });
      if (!Array.isArray(pending) || pending.length === 0) break;
      await this.indexOrderMetadata(pending);
      if (this.orderSymbolIndex.has(normalizedOrderId) || this.orderAssetIndex.has(normalizedOrderId)) {
        return;
      }
      if (pending.length < pageSize) break;
      const nextCursor = String(pending[pending.length - 1]?.orderId ?? "").trim();
      if (!nextCursor || visitedCursors.has(nextCursor)) break;
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }
  }

  private async resolveOrderMetadataForCancel(orderId: string, symbolHint?: string): Promise<HyperliquidOrderMetadata> {
    const normalizedOrderId = String(orderId ?? "").trim();
    const normalizedSymbolHint = String(symbolHint ?? "").trim() || null;

    if (normalizedSymbolHint) {
      const exchangeSymbolHint = await this.toExchangeSymbol(normalizedSymbolHint).catch(() => normalizedSymbolHint);
      const cachedSymbol = this.orderSymbolIndex.get(normalizedOrderId) ?? null;
      if (cachedSymbol) {
        const cachedCanonical = this.toCanonicalSymbol(cachedSymbol) ?? cachedSymbol;
        const hintedCanonical = this.toCanonicalSymbol(exchangeSymbolHint) ?? exchangeSymbolHint;
        if (cachedCanonical !== hintedCanonical) {
          throw new Error(`hyperliquid_order_symbol_conflict:${normalizedOrderId}`);
        }
      }
      const hintedAssetIndex = await this.resolveAssetIndexFromSymbol(exchangeSymbolHint);
      this.cacheOrderMetadata(normalizedOrderId, exchangeSymbolHint, hintedAssetIndex);
    }

    let symbol = this.orderSymbolIndex.get(normalizedOrderId) ?? null;
    let assetIndex = this.orderAssetIndex.get(normalizedOrderId) ?? null;
    if (symbol && (!Number.isFinite(Number(assetIndex ?? NaN)) || Number(assetIndex) < 0)) {
      assetIndex = await this.resolveAssetIndexFromSymbol(symbol);
      this.cacheOrderMetadata(normalizedOrderId, symbol, assetIndex);
    }

    if (!symbol || !Number.isFinite(Number(assetIndex ?? NaN)) || Number(assetIndex) < 0) {
      await this.hydrateOrderMetadataFromPendingOrders(normalizedOrderId);
      symbol = this.orderSymbolIndex.get(normalizedOrderId) ?? symbol ?? null;
      assetIndex = this.orderAssetIndex.get(normalizedOrderId) ?? assetIndex ?? null;
    }

    return {
      symbol,
      assetIndex: Number.isFinite(Number(assetIndex ?? NaN)) && Number(assetIndex) >= 0
        ? Math.trunc(Number(assetIndex))
        : null
    };
  }
}
