import { createPublicClient, defineChain, formatUnits, http, isAddress, parseAbi, parseUnits } from "viem";
import type { PublicClient } from "viem";
import { resolveTransferReadConfig, type TransferReadConfig } from "./config.js";
import type {
  HyperCoreTransferBalances,
  HyperEvmTransferBalances,
  TransferAsset,
  TransferAssetMetadata,
  TransferBalance,
  TransferCapability,
  TransferGasRequirement,
  TransferReadService,
  WalletTransferOverview
} from "./types.js";

const erc20ReadAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

type HyperliquidInfoRequest =
  | { type: "spotClearinghouseState"; user: `0x${string}` }
  | { type: "spotMeta" };

type SpotTokenMeta = {
  index: number | null;
  identifier: string;
  symbol: string;
  decimals: number;
};

type HyperCoreReadResult = {
  balances: HyperCoreTransferBalances;
  assetMetadata: TransferAssetMetadata[];
};

const HYPE_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const HYPERCORE_STATE_CACHE_TTL_MS = 60_000;

const hyperCoreStateCache = new Map<string, { expiresAt: number; value: HyperCoreReadResult }>();
let spotTokenMetaCache: { expiresAt: number; value: SpotTokenMeta[] } | null = null;

function encodeCoreSystemAddress(tokenIndex: number | null, symbol: string): `0x${string}` | null {
  if (symbol === "HYPE") return HYPE_SYSTEM_ADDRESS;
  if (tokenIndex === null || tokenIndex < 0) return null;
  const encoded = BigInt(tokenIndex).toString(16).padStart(38, "0");
  return `0x20${encoded}` as `0x${string}`;
}

function toAddress(value: string): `0x${string}` {
  return value.trim().toLowerCase() as `0x${string}`;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return toAddress(raw);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function pickNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickString(source: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(source?.[key]);
    if (value) return value;
  }
  return null;
}

function baseSymbol(value: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.split(":")[0]!.trim().toUpperCase();
}

function unavailableBalance(symbol: TransferAsset, decimals: number, reason: string | null): TransferBalance {
  return {
    symbol,
    decimals,
    raw: null,
    formatted: null,
    state: "unavailable",
    available: false,
    reason
  };
}

function isRateLimitError(error: unknown): boolean {
  return String(error ?? "").includes("hyperliquid_info_request_failed:429");
}

function mapHyperliquidReadReason(error: unknown, fallback = "hyperliquid_info_unavailable"): string {
  if (isRateLimitError(error)) return "hyperliquid_info_rate_limited";
  return fallback;
}

function normalizeOnchainBalance(symbol: TransferAsset, decimals: number, rawValue: bigint): TransferBalance {
  const formatted = formatUnits(rawValue, decimals);
  return {
    symbol,
    decimals,
    raw: rawValue.toString(),
    formatted,
    state: rawValue > 0n ? "available" : "zero",
    available: true,
    reason: null
  };
}

function normalizeDecimalBalance(
  symbol: TransferAsset,
  decimals: number,
  value: string | number | null,
  reason: string | null = null
): TransferBalance {
  if (value === null || value === undefined || value === "") {
    return unavailableBalance(symbol, decimals, reason ?? "balance_unavailable");
  }
  const formatted = String(value).trim();
  if (!formatted) return unavailableBalance(symbol, decimals, reason ?? "balance_unavailable");
  let raw: string | null = null;
  try {
    raw = parseUnits(formatted, decimals).toString();
  } catch {
    raw = null;
  }
  const numeric = Number(formatted);
  return {
    symbol,
    decimals,
    raw,
    formatted,
    state: Number.isFinite(numeric) && numeric > 0 ? "available" : "zero",
    available: true,
    reason: null
  };
}

async function parseInfoResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`hyperliquid_info_request_failed:${response.status}:${payload}`);
  }
  return response.json() as Promise<T>;
}

function buildProtocolNotes(): WalletTransferOverview["protocol"] {
  return {
    domainsDescription: "HyperCore and HyperEVM are separate balance domains.",
    timingCoreToEvm: "Core -> EVM is queued until the next HyperEVM block.",
    timingEvmToCore: "EVM -> Core is processed in the same L1 block after the HyperEVM block.",
    notes: [
      "Core -> EVM requires HYPE on HyperCore.",
      "EVM -> Core requires HYPE on HyperEVM.",
      "Transfers are wallet-signed client-side only."
    ]
  };
}

function buildGasRequirement(params: {
  direction: "core_to_evm" | "evm_to_core";
  hyperCoreHype: TransferBalance;
  hyperEvmHype: TransferBalance;
}): TransferGasRequirement {
  if (params.direction === "core_to_evm") {
    return {
      asset: "HYPE",
      location: "hyperCore",
      required: true,
      available: params.hyperCoreHype.available && params.hyperCoreHype.state === "available",
      balance: params.hyperCoreHype,
      detail: "Core -> EVM requires HYPE on HyperCore / Spot for gas.",
      reason: params.hyperCoreHype.available ? null : params.hyperCoreHype.reason
    };
  }
  return {
    asset: "HYPE",
    location: "hyperEvm",
    required: true,
    available: params.hyperEvmHype.available && params.hyperEvmHype.state === "available",
    balance: params.hyperEvmHype,
    detail: "EVM -> Core requires HYPE on HyperEVM for gas.",
    reason: params.hyperEvmHype.available ? null : params.hyperEvmHype.reason
  };
}

function createHyperCoreFallback(address: string, reason: string | null): HyperCoreTransferBalances {
  return {
    location: "hyperCore",
    address,
    source: "spotClearinghouseState",
    available: false,
    reason,
    usdc: unavailableBalance("USDC", 6, reason),
    hype: unavailableBalance("HYPE", 18, reason),
    updatedAt: new Date().toISOString()
  };
}

function buildSpotTokenMeta(raw: any): SpotTokenMeta[] {
  const tokens = Array.isArray(raw?.tokens)
    ? raw.tokens
    : Array.isArray(raw?.universe)
      ? raw.universe
      : [];

  return tokens.map((entry: any, index: number) => {
    const identifier =
      pickString(entry, ["name", "coin", "symbol", "tokenName"])
      ?? `token_${index}`;
    const symbol = baseSymbol(identifier);
    const decimals = pickNumber(entry, ["szDecimals", "decimals", "weiDecimals"])
      ?? (symbol === "USDC" ? 6 : 18);
    return {
      index,
      identifier,
      symbol,
      decimals
    } satisfies SpotTokenMeta;
  });
}

function buildAssetMetadataFromSpotTokens(
  tokenMetaBySymbol: Map<string, SpotTokenMeta>,
  config: TransferReadConfig
): TransferAssetMetadata[] {
  return [
    {
      asset: "USDC",
      symbol: "USDC",
      decimals: tokenMetaBySymbol.get("USDC")?.decimals ?? 6,
      hyperCoreToken: tokenMetaBySymbol.get("USDC")?.identifier ?? null,
      evmAssetType: "erc20",
      evmTokenAddress: config.hyperEvm.usdcAddress,
      systemAddress: encodeCoreSystemAddress(tokenMetaBySymbol.get("USDC")?.index ?? null, "USDC"),
      coreDepositWalletAddress: config.coreDepositWalletAddress
    },
    {
      asset: "HYPE",
      symbol: "HYPE",
      decimals: tokenMetaBySymbol.get("HYPE")?.decimals ?? 18,
      hyperCoreToken: tokenMetaBySymbol.get("HYPE")?.identifier ?? "HYPE",
      evmAssetType: "native",
      evmTokenAddress: null,
      systemAddress: encodeCoreSystemAddress(tokenMetaBySymbol.get("HYPE")?.index ?? null, "HYPE"),
      coreDepositWalletAddress: null
    }
  ];
}

export function createTransferReadService(
  config: TransferReadConfig = resolveTransferReadConfig()
): TransferReadService {
  const hyperEvmClient: PublicClient = createPublicClient({
    chain: defineChain({
      id: config.hyperEvm.chainId,
      name: "HyperEVM",
      nativeCurrency: {
        name: "Hyperliquid",
        symbol: "HYPE",
        decimals: 18
      },
      rpcUrls: {
        default: {
          http: [config.hyperEvm.rpcUrl]
        }
      }
    }),
    transport: http(config.hyperEvm.rpcUrl)
  });

  async function postInfo<T>(payload: HyperliquidInfoRequest): Promise<T> {
    const response = await fetch(config.hyperliquidInfoUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    return parseInfoResponse<T>(response);
  }

  async function readSpotTokenMeta(): Promise<SpotTokenMeta[]> {
    const now = Date.now();
    if (spotTokenMetaCache && spotTokenMetaCache.expiresAt > now) {
      return spotTokenMetaCache.value;
    }
    const raw = await postInfo<any>({ type: "spotMeta" });
    const value = buildSpotTokenMeta(raw);
    spotTokenMetaCache = {
      expiresAt: now + HYPERCORE_STATE_CACHE_TTL_MS,
      value
    };
    return value;
  }

  async function readHyperEvmBalances(address: `0x${string}`): Promise<HyperEvmTransferBalances> {
    const [hypeResult, usdcResult] = await Promise.all([
      hyperEvmClient.getBalance({ address })
        .then((value) => normalizeOnchainBalance("HYPE", 18, value))
        .catch((error) => unavailableBalance("HYPE", 18, String(error))),
      config.hyperEvm.usdcAddress
        ? hyperEvmClient.readContract({
            address: config.hyperEvm.usdcAddress,
            abi: erc20ReadAbi,
            functionName: "balanceOf",
            args: [address]
          })
            .then((value) => normalizeOnchainBalance("USDC", config.hyperEvm.usdcDecimals, value as bigint))
            .catch((error) => unavailableBalance("USDC", config.hyperEvm.usdcDecimals, String(error)))
        : Promise.resolve(unavailableBalance("USDC", config.hyperEvm.usdcDecimals, "hyperevm_usdc_address_missing"))
    ]);

    const available = hypeResult.available || usdcResult.available;
    const reason = !available
      ? hypeResult.reason ?? usdcResult.reason ?? "hyperevm_balance_unavailable"
      : null;

    return {
      location: "hyperEvm",
      address,
      available,
      reason,
      network: {
        chainId: config.hyperEvm.chainId,
        expectedChainId: config.hyperEvm.chainId,
        networkName: "HyperEVM",
        rpcUrl: config.hyperEvm.rpcUrl,
        explorerUrl: config.hyperEvm.explorerUrl
      },
      usdc: usdcResult,
      hype: hypeResult,
      updatedAt: new Date().toISOString()
    };
  }

  async function readHyperCoreState(address: `0x${string}`): Promise<HyperCoreReadResult> {
    const now = Date.now();
    const cached = hyperCoreStateCache.get(address);
    const cachedValid = cached && cached.expiresAt > now ? cached.value : null;

    const [stateResult, spotMetaResult] = await Promise.allSettled([
      postInfo<any>({ type: "spotClearinghouseState", user: address }),
      readSpotTokenMeta()
    ]);

    const spotTokens = spotMetaResult.status === "fulfilled"
      ? spotMetaResult.value
      : (cachedValid?.assetMetadata.map((asset) => ({
          index: asset.systemAddress?.startsWith("0x20")
            ? Number.parseInt(asset.systemAddress.slice(4), 16)
            : asset.asset === "HYPE"
              ? 0
              : null,
          identifier: asset.hyperCoreToken ?? asset.asset,
          symbol: asset.asset,
          decimals: asset.decimals
        })) ?? []);

    const tokenMetaByIndex = new Map<number, SpotTokenMeta>();
    const tokenMetaBySymbol = new Map<string, SpotTokenMeta>();
    spotTokens.forEach((meta) => {
      if (meta.index !== null && meta.index >= 0) tokenMetaByIndex.set(meta.index, meta);
      if (!tokenMetaBySymbol.has(meta.symbol)) tokenMetaBySymbol.set(meta.symbol, meta);
    });
    const assetMetadata = buildAssetMetadataFromSpotTokens(tokenMetaBySymbol, config);

    try {
      if (stateResult.status !== "fulfilled") throw stateResult.reason;
      const stateRaw = stateResult.value;

      const balancesRaw = Array.isArray(stateRaw?.balances)
        ? stateRaw.balances
        : Array.isArray(stateRaw?.spotState?.balances)
          ? stateRaw.spotState.balances
          : Array.isArray(stateRaw?.tokenBalances)
            ? stateRaw.tokenBalances
            : [];

      let usdcBalance = normalizeDecimalBalance("USDC", 6, "0");
      let hypeBalance = normalizeDecimalBalance("HYPE", 18, "0");

      for (const entry of balancesRaw) {
        const tokenIndex = pickNumber(entry, ["token", "tokenId", "coinIndex"]);
        const tokenMeta = tokenIndex === null ? null : tokenMetaByIndex.get(tokenIndex);
        const symbol = baseSymbol(
          pickString(entry, ["coin", "symbol", "tokenName", "name"]) ?? tokenMeta?.identifier ?? ""
        );
        const decimals = tokenMeta?.decimals ?? (symbol === "USDC" ? 6 : 18);
        const total = pickString(entry, ["total", "balance", "sz", "amount", "available"]) ?? "0";
        if (symbol === "USDC") {
          usdcBalance = normalizeDecimalBalance("USDC", decimals, total);
        } else if (symbol === "HYPE") {
          hypeBalance = normalizeDecimalBalance("HYPE", decimals, total);
        }
      }

      const result: HyperCoreReadResult = {
        balances: {
          location: "hyperCore",
          address,
          source: "spotClearinghouseState",
          available: true,
          reason: null,
          usdc: usdcBalance,
          hype: hypeBalance,
          updatedAt: new Date().toISOString()
        },
        assetMetadata
      };
      hyperCoreStateCache.set(address, {
        expiresAt: now + HYPERCORE_STATE_CACHE_TTL_MS,
        value: result
      });
      return result;
    } catch (error) {
      const reason = mapHyperliquidReadReason(error);
      if (cachedValid) {
        return {
          balances: {
            ...cachedValid.balances,
            available: true,
            reason: `${reason}_cached`
          },
          assetMetadata: cachedValid.assetMetadata
        };
      }
      return {
        balances: createHyperCoreFallback(address, reason),
        assetMetadata
      };
    }
  }

  function buildCapabilities(params: {
    assetMetadata: TransferAssetMetadata[];
    hyperCore: HyperCoreTransferBalances;
    hyperEvm: HyperEvmTransferBalances;
  }): TransferCapability[] {
    return params.assetMetadata.flatMap((asset) => {
      const coreGas = buildGasRequirement({
        direction: "core_to_evm",
        hyperCoreHype: params.hyperCore.hype,
        hyperEvmHype: params.hyperEvm.hype
      });
      const evmGas = buildGasRequirement({
        direction: "evm_to_core",
        hyperCoreHype: params.hyperCore.hype,
        hyperEvmHype: params.hyperEvm.hype
      });
      const coreSupported = Boolean(
        asset.systemAddress
        && asset.hyperCoreToken
        && params.hyperCore.available
      );
      const evmSupported = Boolean(
        asset.asset === "USDC"
          ? asset.coreDepositWalletAddress && asset.evmTokenAddress
          : asset.systemAddress && (asset.evmAssetType === "native" || asset.evmTokenAddress)
      );

      return [
        {
          id: `${asset.asset.toLowerCase()}_core_to_evm`,
          direction: "core_to_evm" as const,
          asset: asset.asset,
          supported: coreSupported,
          mode: "client_write" as const,
          reason: coreSupported
            ? null
            : params.hyperCore.reason
              ? params.hyperCore.reason
              : !asset.systemAddress
              ? "system_address_missing"
              : !asset.hyperCoreToken
                ? "hypercore_token_missing"
                : "hypercore_balance_unavailable",
          systemAddress: asset.systemAddress,
          coreDepositWalletAddress: asset.coreDepositWalletAddress,
          hyperCoreToken: asset.hyperCoreToken,
          evmAssetType: asset.evmAssetType,
          evmTokenAddress: asset.evmTokenAddress,
          requiresChainId: null,
          gas: coreGas
        },
        {
          id: `${asset.asset.toLowerCase()}_evm_to_core`,
          direction: "evm_to_core" as const,
          asset: asset.asset,
          supported: evmSupported,
          mode: "client_write" as const,
          reason: evmSupported
            ? null
            : asset.asset === "USDC" && !asset.coreDepositWalletAddress
              ? "core_deposit_wallet_missing"
              : !asset.systemAddress && asset.asset !== "USDC"
              ? "system_address_missing"
              : asset.evmAssetType === "erc20" && !asset.evmTokenAddress
                ? "hyperevm_token_address_missing"
                : "transfer_unsupported",
          systemAddress: asset.systemAddress,
          coreDepositWalletAddress: asset.coreDepositWalletAddress,
          hyperCoreToken: asset.hyperCoreToken,
          evmAssetType: asset.evmAssetType,
          evmTokenAddress: asset.evmTokenAddress,
          requiresChainId: params.hyperEvm.network.expectedChainId,
          gas: evmGas
        }
      ];
    });
  }

  async function getTransferOverview(params: { address: string }): Promise<WalletTransferOverview> {
    const address = normalizeAddress(params.address);
    if (!address) throw new Error("invalid_wallet_address");

    const [{ balances: hyperCore, assetMetadata }, hyperEvm] = await Promise.all([
      readHyperCoreState(address),
      readHyperEvmBalances(address)
    ]);

    return {
      address,
      assets: assetMetadata,
      hyperCore,
      hyperEvm,
      capabilities: buildCapabilities({
        assetMetadata,
        hyperCore,
        hyperEvm
      }),
      protocol: buildProtocolNotes(),
      updatedAt: new Date().toISOString()
    };
  }

  return {
    getTransferOverview
  };
}
