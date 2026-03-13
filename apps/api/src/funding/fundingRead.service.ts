import { arbitrum } from "viem/chains";
import { createPublicClient, defineChain, formatUnits, http, isAddress, parseAbi, parseUnits } from "viem";
import type { PublicClient } from "viem";
import { evaluateFundingReadiness } from "./readiness.js";
import { resolveFundingReadConfig, type FundingReadConfig } from "./config.js";
import type {
  ArbitrumBalances,
  FundingAction,
  FundingActionId,
  FundingBalance,
  FundingBridgeOverview,
  FundingExternalLinksResponse,
  FundingHistoryResponse,
  FundingHistorySourceItem,
  FundingReadService,
  HyperCoreBalances,
  HyperEvmBalances,
  MasterVaultReadiness,
  TransferCapability,
  WalletFundingOverview
} from "./types.js";

const erc20ReadAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

type HyperliquidInfoRequest =
  | { type: "spotClearinghouseState"; user: `0x${string}` }
  | { type: "spotMeta" };

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

function unavailableBalance(symbol: string, decimals: number, reason: string | null): FundingBalance {
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

function normalizeOnchainBalance(symbol: string, decimals: number, rawValue: bigint): FundingBalance {
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

function normalizeDecimalBalance(symbol: string, decimals: number, value: string | number | null, reason: string | null = null): FundingBalance {
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

function normalizeUrl(path: string | null): string | null {
  const raw = String(path ?? "").trim();
  return raw ? raw : null;
}

function normalizeExternalLinks(config: FundingReadConfig): FundingExternalLinksResponse["links"] {
  return [
    {
      id: "hyperliquid_deposit",
      label: "Deposit USDC to Hyperliquid",
      href: normalizeUrl(config.externalLinks.depositUrl),
      enabled: Boolean(config.externalLinks.depositUrl),
      reason: config.externalLinks.depositUrl ? null : "hyperliquid_deposit_url_missing"
    },
    {
      id: "hyperliquid_core_evm_transfer",
      label: "Open HyperCore / HyperEVM transfer",
      href: normalizeUrl(config.externalLinks.coreTransferUrl),
      enabled: Boolean(config.externalLinks.coreTransferUrl),
      reason: config.externalLinks.coreTransferUrl ? null : "hyperliquid_core_transfer_url_missing"
    }
  ] satisfies FundingExternalLinksResponse["links"];
}

function buildMasterVaultReadiness(config: FundingReadConfig): MasterVaultReadiness {
  const reasons = [...config.errors];
  const configured = Boolean(config.masterVault.address && config.hyperEvm.usdcAddress);
  return {
    location: "masterVault",
    configured,
    writeEnabled: configured && reasons.length === 0,
    address: config.masterVault.address,
    reasons,
    status: configured && reasons.length === 0 ? "ready" : "blocked"
  };
}

function explorerAddressUrl(base: string, address: string | null): string | null {
  if (!address) return null;
  return `${base.replace(/\/$/, "")}/address/${address}`;
}

function buildBridgeOverview(params: {
  config: FundingReadConfig;
  arbitrum: ArbitrumBalances;
  hyperCore: HyperCoreBalances;
}): FundingBridgeOverview {
  const depositMissingRequirements: string[] = [];
  if (!params.config.bridge.depositContractAddress) {
    depositMissingRequirements.push("bridge_contract_missing");
  }
  if (!params.arbitrum.usdc.available) {
    depositMissingRequirements.push(params.arbitrum.usdc.reason ?? "arbitrum_usdc_unavailable");
  }
  if (!params.arbitrum.eth.available) {
    depositMissingRequirements.push(params.arbitrum.eth.reason ?? "arbitrum_eth_unavailable");
  }

  const withdrawMissingRequirements: string[] = [];
  if (!params.hyperCore.available) {
    withdrawMissingRequirements.push(params.hyperCore.reason ?? "hypercore_unavailable");
  }
  if (!params.hyperCore.usdc.available) {
    withdrawMissingRequirements.push(params.hyperCore.usdc.reason ?? "hypercore_usdc_unavailable");
  }

  return {
    asset: "USDC",
    sourceLocation: "arbitrum",
    destinationLocation: "hyperCore",
    nativeUsdcOnly: true,
    minDepositUsd: String(params.config.bridge.minDepositUsdc),
    withdrawFeeUsd: String(params.config.bridge.withdrawFeeUsdc),
    depositContractAddress: params.config.bridge.depositContractAddress,
    deposit: {
      enabled: depositMissingRequirements.length === 0,
      status: depositMissingRequirements.length === 0 ? "ready" : params.config.bridge.depositContractAddress ? "warning" : "blocked",
      reason: depositMissingRequirements[0] ?? null,
      missingRequirements: depositMissingRequirements
    },
    withdraw: {
      enabled: withdrawMissingRequirements.length === 0,
      status: withdrawMissingRequirements.length === 0 ? "ready" : params.hyperCore.available ? "warning" : "blocked",
      reason: withdrawMissingRequirements[0] ?? null,
      missingRequirements: withdrawMissingRequirements
    },
    links: {
      officialAppUrl: params.config.externalLinks.bridgeUrl,
      depositContractExplorerUrl: explorerAddressUrl(
        params.config.arbitrum.explorerUrl,
        params.config.bridge.depositContractAddress
      ),
      hyperliquidExchangeUrl: params.config.hyperliquidExchangeUrl
    }
  };
}

function normalizeHistoryStatus(value: string): "prepared" | "submitted" | "confirmed" | "failed" | "external" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "confirmed") return "confirmed";
  if (normalized === "submitted") return "submitted";
  if (normalized === "failed") return "failed";
  if (normalized === "prepared") return "prepared";
  return "external";
}

function buildTransferCapabilities(config: FundingReadConfig): TransferCapability[] {
  const href = normalizeUrl(config.externalLinks.coreTransferUrl);
  return [
    {
      id: "transfer_usdc_core_to_evm",
      direction: "core_to_evm",
      asset: "USDC",
      supported: Boolean(href),
      mode: "external_handoff",
      href,
      reason: href ? null : "hyperliquid_core_transfer_url_missing"
    },
    {
      id: "transfer_hype_core_to_evm",
      direction: "core_to_evm",
      asset: "HYPE",
      supported: Boolean(href),
      mode: "external_handoff",
      href,
      reason: href ? null : "hyperliquid_core_transfer_url_missing"
    }
  ];
}

function createActionMap(params: {
  config: FundingReadConfig;
  masterVault: MasterVaultReadiness;
  depositEnabled: boolean;
}): Record<FundingActionId, FundingAction> {
  const links = normalizeExternalLinks(params.config);
  const depositLink = links.find((item) => item.id === "hyperliquid_deposit") ?? null;
  const transferLink = links.find((item) => item.id === "hyperliquid_core_evm_transfer") ?? null;

  return {
    fund_arbitrum_usdc: {
      id: "fund_arbitrum_usdc",
      kind: "blocked",
      label: "Fund Arbitrum with USDC",
      description: "Add USDC to your Arbitrum wallet before starting the Hyperliquid deposit flow.",
      locationFrom: null,
      locationTo: "arbitrum",
      enabled: false,
      reason: "arbitrum_usdc_missing",
      href: null,
      chainId: params.config.arbitrum.chainId,
      asset: "USDC",
      external: false
    },
    fund_arbitrum_eth: {
      id: "fund_arbitrum_eth",
      kind: "blocked",
      label: "Fund Arbitrum with ETH",
      description: "Arbitrum deposit requires ETH for gas.",
      locationFrom: null,
      locationTo: "arbitrum",
      enabled: false,
      reason: "arbitrum_eth_missing",
      href: null,
      chainId: params.config.arbitrum.chainId,
      asset: "ETH",
      external: false
    },
    deposit_usdc_to_hyperliquid: {
      id: "deposit_usdc_to_hyperliquid",
      kind: depositLink?.enabled ? "external_handoff" : "blocked",
      label: "Deposit USDC to Hyperliquid",
      description: "Arbitrum -> Hyperliquid / HyperCore deposit handoff.",
      locationFrom: "arbitrum",
      locationTo: "hyperCore",
      enabled: Boolean(depositLink?.enabled),
      reason: depositLink?.reason ?? null,
      href: depositLink?.href ?? null,
      chainId: params.config.arbitrum.chainId,
      asset: "USDC",
      external: true
    },
    obtain_hype_bootstrap: {
      id: "obtain_hype_bootstrap",
      kind: "blocked",
      label: "Obtain HYPE for gas bootstrap",
      description: "HyperEVM gas uses HYPE, not ETH. Acquire HYPE before attempting Core -> EVM or EVM deposit actions.",
      locationFrom: null,
      locationTo: "hyperCore",
      enabled: false,
      reason: "hype_bootstrap_required",
      href: null,
      chainId: null,
      asset: "HYPE",
      external: false
    },
    transfer_usdc_core_to_evm: {
      id: "transfer_usdc_core_to_evm",
      kind: transferLink?.enabled ? "external_handoff" : "blocked",
      label: "Transfer USDC HyperCore -> HyperEVM",
      description: "Core -> EVM transfer is separate from the Arbitrum deposit flow.",
      locationFrom: "hyperCore",
      locationTo: "hyperEvm",
      enabled: Boolean(transferLink?.enabled),
      reason: transferLink?.reason ?? null,
      href: transferLink?.href ?? null,
      chainId: params.config.hyperEvm.chainId,
      asset: "USDC",
      external: true
    },
    transfer_hype_core_to_evm: {
      id: "transfer_hype_core_to_evm",
      kind: transferLink?.enabled ? "external_handoff" : "blocked",
      label: "Transfer HYPE HyperCore -> HyperEVM",
      description: "Use this to bootstrap HyperEVM gas when HYPE only exists on HyperCore.",
      locationFrom: "hyperCore",
      locationTo: "hyperEvm",
      enabled: Boolean(transferLink?.enabled),
      reason: transferLink?.reason ?? null,
      href: transferLink?.href ?? null,
      chainId: params.config.hyperEvm.chainId,
      asset: "HYPE",
      external: true
    },
    deposit_master_vault: {
      id: "deposit_master_vault",
      kind: "client_write",
      label: "Deposit USDC into MasterVault",
      description: "Client-side wallet approve + deposit on HyperEVM.",
      locationFrom: "hyperEvm",
      locationTo: "masterVault",
      enabled: params.depositEnabled,
      reason: params.depositEnabled ? null : params.masterVault.reasons[0] ?? "master_vault_not_ready",
      href: null,
      chainId: params.config.hyperEvm.chainId,
      asset: "USDC",
      external: false
    },
    ready: {
      id: "ready",
      kind: "blocked",
      label: "Funding complete",
      description: "All funding requirements are satisfied.",
      locationFrom: null,
      locationTo: "masterVault",
      enabled: false,
      reason: null,
      href: null,
      chainId: null,
      asset: null,
      external: false
    }
  };
}

function createHyperCoreFallback(address: string, reason: string | null): HyperCoreBalances {
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

export function createFundingReadService(config: FundingReadConfig = resolveFundingReadConfig()): FundingReadService {
  const arbitrumClient: PublicClient = createPublicClient({
    chain: {
      ...arbitrum,
      rpcUrls: {
        default: { http: [config.arbitrum.rpcUrl] },
        public: { http: [config.arbitrum.rpcUrl] }
      }
    },
    transport: http(config.arbitrum.rpcUrl)
  });

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

  async function readArbitrumBalances(address: `0x${string}`): Promise<ArbitrumBalances> {
    const [ethResult, usdcResult] = await Promise.all([
      arbitrumClient.getBalance({ address })
        .then((value) => normalizeOnchainBalance("ETH", 18, value))
        .catch((error) => unavailableBalance("ETH", 18, String(error))),
      config.arbitrum.usdcAddress
        ? arbitrumClient.readContract({
            address: config.arbitrum.usdcAddress,
            abi: erc20ReadAbi,
            functionName: "balanceOf",
            args: [address]
          })
            .then((value) => normalizeOnchainBalance("USDC", config.arbitrum.usdcDecimals, value as bigint))
            .catch((error) => unavailableBalance("USDC", config.arbitrum.usdcDecimals, String(error)))
        : Promise.resolve(unavailableBalance("USDC", config.arbitrum.usdcDecimals, "arbitrum_usdc_address_missing"))
    ]);

    return {
      location: "arbitrum",
      chainId: config.arbitrum.chainId,
      networkName: "Arbitrum",
      rpcUrl: config.arbitrum.rpcUrl,
      explorerUrl: config.arbitrum.explorerUrl,
      address,
      eth: ethResult,
      usdc: usdcResult,
      updatedAt: new Date().toISOString()
    };
  }

  async function readHyperEvmBalances(address: `0x${string}`): Promise<HyperEvmBalances> {
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

    return {
      location: "hyperEvm",
      chainId: config.hyperEvm.chainId,
      networkName: "HyperEVM",
      rpcUrl: config.hyperEvm.rpcUrl,
      explorerUrl: config.hyperEvm.explorerUrl,
      address,
      hype: hypeResult,
      usdc: usdcResult,
      updatedAt: new Date().toISOString()
    };
  }

  async function readHyperCoreBalances(address: `0x${string}`): Promise<HyperCoreBalances> {
    try {
      const [stateRaw, spotMetaRaw] = await Promise.all([
        postInfo<any>({ type: "spotClearinghouseState", user: address }),
        postInfo<any>({ type: "spotMeta" }).catch(() => null)
      ]);

      const tokens = Array.isArray(spotMetaRaw?.tokens) ? spotMetaRaw.tokens : Array.isArray(spotMetaRaw?.universe) ? spotMetaRaw.universe : [];
      const tokenNameByIndex = new Map<number, { name: string; decimals: number }>();
      tokens.forEach((entry: any, index: number) => {
        const name = pickString(entry, ["name", "coin", "symbol", "tokenName"]) ?? `token_${index}`;
        const decimals = pickNumber(entry, ["szDecimals", "decimals", "weiDecimals"]) ?? (name.toUpperCase() === "USDC" ? 6 : 18);
        tokenNameByIndex.set(index, { name: name.toUpperCase(), decimals });
      });

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
        const tokenMeta = tokenIndex === null ? null : tokenNameByIndex.get(tokenIndex);
        const symbol = (
          pickString(entry, ["coin", "symbol", "tokenName", "name"])
          ?? tokenMeta?.name
          ?? ""
        ).toUpperCase();
        const decimals = tokenMeta?.decimals ?? (symbol === "USDC" ? 6 : 18);
        const total = pickString(entry, ["total", "balance", "sz", "amount", "available"]) ?? "0";
        if (symbol === "USDC") {
          usdcBalance = normalizeDecimalBalance("USDC", decimals, total);
        } else if (symbol === "HYPE") {
          hypeBalance = normalizeDecimalBalance("HYPE", decimals, total);
        }
      }

      return {
        location: "hyperCore",
        address,
        source: "spotClearinghouseState",
        available: true,
        reason: null,
        usdc: usdcBalance,
        hype: hypeBalance,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      return createHyperCoreFallback(address, String(error));
    }
  }

  async function getFundingExternalLinks(params: { address: string }): Promise<FundingExternalLinksResponse> {
    const address = normalizeAddress(params.address);
    if (!address) throw new Error("invalid_wallet_address");

    return {
      address,
      links: normalizeExternalLinks(config),
      updatedAt: new Date().toISOString()
    };
  }

  async function getFundingOverview(params: { address: string }): Promise<WalletFundingOverview> {
    const address = normalizeAddress(params.address);
    if (!address) throw new Error("invalid_wallet_address");

    const [arbitrumBalances, hyperCoreBalances, hyperEvmBalances, externalLinks] = await Promise.all([
      readArbitrumBalances(address),
      readHyperCoreBalances(address),
      readHyperEvmBalances(address),
      getFundingExternalLinks({ address })
    ]);
    const masterVault = buildMasterVaultReadiness(config);
    const readiness = evaluateFundingReadiness({
      arbitrum: arbitrumBalances,
      hyperCore: hyperCoreBalances,
      hyperEvm: hyperEvmBalances,
      masterVault
    });
    const actions = Object.values(
      createActionMap({
        config,
        masterVault,
        depositEnabled: readiness.depositEnabled
      })
    );
    const bridge = buildBridgeOverview({
      config,
      arbitrum: arbitrumBalances,
      hyperCore: hyperCoreBalances
    });

    return {
      address,
      arbitrum: arbitrumBalances,
      hyperCore: hyperCoreBalances,
      hyperEvm: hyperEvmBalances,
      masterVault,
      bridge,
      readiness,
      actions,
      transferCapabilities: buildTransferCapabilities(config),
      externalLinks: externalLinks.links,
      updatedAt: new Date().toISOString()
    };
  }

  async function getFundingReadiness(params: { address: string }) {
    const overview = await getFundingOverview(params);
    return {
      address: overview.address,
      readiness: overview.readiness,
      updatedAt: overview.updatedAt
    };
  }

  async function getFundingHistory(params: { address: string; items?: FundingHistorySourceItem[] | null }): Promise<FundingHistoryResponse> {
    const address = normalizeAddress(params.address);
    if (!address) throw new Error("invalid_wallet_address");

    const items = (params.items ?? [])
      .filter((item) => item.actionType === "deposit_master_vault")
      .map((item) => ({
        id: item.id,
        actionId: "master_vault_deposit" as const,
        title: "MasterVault deposit",
        description: "Client-side MasterVault deposit action tracked by onchain action history.",
        locationFrom: "hyperEvm" as const,
        locationTo: "masterVault" as const,
        status: normalizeHistoryStatus(item.status),
        txHash: item.txHash,
        chainId: item.chainId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
      .sort((left, right) => Date.parse(String(right.createdAt ?? 0)) - Date.parse(String(left.createdAt ?? 0)));

    return {
      address,
      trackingMode: "lightweight",
      note: "External Hyperliquid handoffs are not fully tracked in v1 history.",
      items,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    getFundingOverview,
    getFundingReadiness,
    getFundingHistory,
    getFundingExternalLinks
  };
}
