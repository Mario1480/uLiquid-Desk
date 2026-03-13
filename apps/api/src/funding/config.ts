import { isAddress } from "viem";
import { resolveWalletReadConfig } from "../wallet/config.js";

const DEFAULT_ARBITRUM_CHAIN_ID = 42161;
const DEFAULT_ARBITRUM_RPC_URL = "https://arb1.arbitrum.io/rpc";
const DEFAULT_ARBITRUM_EXPLORER_URL = "https://arbiscan.io";
const DEFAULT_ARBITRUM_USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEFAULT_HYPERLIQUID_BRIDGE_CONTRACT = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const DEFAULT_HYPERLIQUID_DEPOSIT_URL = "https://app.hyperliquid.xyz/trade";
const DEFAULT_HYPERLIQUID_BRIDGE_URL = "https://app.hyperliquid.xyz/portfolio";
const DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL = "https://app.hyperliquid.xyz/portfolio";
const DEFAULT_HYPERLIQUID_EXCHANGE_URL = "https://api.hyperliquid.xyz";
const DEFAULT_USDC_DECIMALS = 6;

export type FundingReadConfig = {
  arbitrum: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    usdcAddress: `0x${string}` | null;
    usdcDecimals: number;
  };
  hyperEvm: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    usdcAddress: `0x${string}` | null;
    usdcDecimals: number;
  };
  hyperliquidInfoUrl: string;
  masterVault: {
    address: `0x${string}` | null;
  };
  externalLinks: {
    depositUrl: string | null;
    bridgeUrl: string | null;
    coreTransferUrl: string | null;
  };
  hyperliquidExchangeUrl: string;
  bridge: {
    depositContractAddress: `0x${string}` | null;
    minDepositUsdc: number;
    withdrawFeeUsdc: number;
  };
  errors: string[];
};

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function normalizeUrl(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeOptionalUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function readAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return raw as `0x${string}`;
}

export function resolveFundingReadConfig(): FundingReadConfig {
  const walletConfig = resolveWalletReadConfig();
  const errors = [...walletConfig.errors];
  const rawArbitrumUsdc = String(
    process.env.ARBITRUM_USDC_ADDRESS
    ?? process.env.NEXT_PUBLIC_ARBITRUM_USDC_ADDRESS
    ?? ""
  ).trim();
  const rawDepositUrl = String(
    process.env.HYPERLIQUID_DEPOSIT_URL
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_DEPOSIT_URL
    ?? ""
  ).trim();
  const rawCoreTransferUrl = String(
    process.env.HYPERLIQUID_CORE_EVM_TRANSFER_URL
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_CORE_EVM_TRANSFER_URL
    ?? ""
  ).trim();
  const rawBridgeUrl = String(
    process.env.HYPERLIQUID_BRIDGE_URL
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_BRIDGE_URL
    ?? ""
  ).trim();
  const rawBridgeContract = String(
    process.env.HYPERLIQUID_BRIDGE_CONTRACT
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_BRIDGE_CONTRACT
    ?? ""
  ).trim();

  const parsedArbitrumUsdcAddress = readAddress(rawArbitrumUsdc);
  const arbitrumUsdcAddress = parsedArbitrumUsdcAddress ?? DEFAULT_ARBITRUM_USDC_ADDRESS;
  const parsedBridgeContractAddress = readAddress(rawBridgeContract);
  const bridgeContractAddress = parsedBridgeContractAddress ?? DEFAULT_HYPERLIQUID_BRIDGE_CONTRACT;
  if (rawArbitrumUsdc && !parsedArbitrumUsdcAddress) errors.push("invalid_arbitrum_usdc_address");
  if (rawDepositUrl && !normalizeOptionalUrl(rawDepositUrl)) errors.push("invalid_hyperliquid_deposit_url");
  if (rawCoreTransferUrl && !normalizeOptionalUrl(rawCoreTransferUrl)) {
    errors.push("invalid_hyperliquid_core_transfer_url");
  }
  if (rawBridgeUrl && !normalizeOptionalUrl(rawBridgeUrl)) errors.push("invalid_hyperliquid_bridge_url");
  if (rawBridgeContract && !parsedBridgeContractAddress) errors.push("invalid_hyperliquid_bridge_contract");

  return {
    arbitrum: {
      chainId: readPositiveInt(
        process.env.ARBITRUM_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARBITRUM_CHAIN_ID,
        DEFAULT_ARBITRUM_CHAIN_ID
      ),
      rpcUrl: normalizeUrl(
        process.env.ARBITRUM_RPC_URL ?? process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
        DEFAULT_ARBITRUM_RPC_URL
      ),
      explorerUrl: normalizeUrl(
        process.env.ARBITRUM_EXPLORER_URL ?? process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL,
        DEFAULT_ARBITRUM_EXPLORER_URL
      ),
      usdcAddress: arbitrumUsdcAddress,
      usdcDecimals: readPositiveInt(
        process.env.ARBITRUM_USDC_DECIMALS ?? process.env.NEXT_PUBLIC_ARBITRUM_USDC_DECIMALS,
        DEFAULT_USDC_DECIMALS
      )
    },
    hyperEvm: {
      chainId: walletConfig.hyperEvmChainId,
      rpcUrl: walletConfig.hyperEvmRpcUrl,
      explorerUrl: walletConfig.hyperEvmExplorerUrl,
      usdcAddress: walletConfig.usdcAddress,
      usdcDecimals: walletConfig.usdcDecimals
    },
    hyperliquidInfoUrl: walletConfig.hyperliquidInfoUrl,
    masterVault: {
      address: walletConfig.masterVaultAddress
    },
    externalLinks: {
      depositUrl: normalizeOptionalUrl(rawDepositUrl) ?? DEFAULT_HYPERLIQUID_DEPOSIT_URL,
      bridgeUrl: normalizeOptionalUrl(rawBridgeUrl) ?? DEFAULT_HYPERLIQUID_BRIDGE_URL,
      coreTransferUrl: normalizeOptionalUrl(rawCoreTransferUrl) ?? DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL
    },
    hyperliquidExchangeUrl: normalizeUrl(
      process.env.HYPERLIQUID_EXCHANGE_URL ?? process.env.NEXT_PUBLIC_HYPERLIQUID_EXCHANGE_URL,
      DEFAULT_HYPERLIQUID_EXCHANGE_URL
    ),
    bridge: {
      depositContractAddress: bridgeContractAddress,
      minDepositUsdc: readPositiveInt(
        process.env.HYPERLIQUID_BRIDGE_MIN_DEPOSIT_USDC ?? process.env.NEXT_PUBLIC_HYPERLIQUID_BRIDGE_MIN_DEPOSIT_USDC,
        5
      ),
      withdrawFeeUsdc: readPositiveInt(
        process.env.HYPERLIQUID_BRIDGE_WITHDRAW_FEE_USDC ?? process.env.NEXT_PUBLIC_HYPERLIQUID_BRIDGE_WITHDRAW_FEE_USDC,
        1
      )
    },
    errors
  };
}
