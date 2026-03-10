import { isAddress } from "viem";
import { resolveWalletReadConfig } from "../wallet/config.js";

const DEFAULT_ARBITRUM_CHAIN_ID = 42161;
const DEFAULT_ARBITRUM_RPC_URL = "https://arb1.arbitrum.io/rpc";
const DEFAULT_ARBITRUM_EXPLORER_URL = "https://arbiscan.io";
const DEFAULT_ARBITRUM_USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEFAULT_HYPERLIQUID_DEPOSIT_URL = "https://app.hyperliquid.xyz/trade";
const DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL = "https://app.hyperliquid.xyz/portfolio";
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
    coreTransferUrl: string | null;
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

  const parsedArbitrumUsdcAddress = readAddress(rawArbitrumUsdc);
  const arbitrumUsdcAddress = parsedArbitrumUsdcAddress ?? DEFAULT_ARBITRUM_USDC_ADDRESS;
  if (rawArbitrumUsdc && !parsedArbitrumUsdcAddress) errors.push("invalid_arbitrum_usdc_address");
  if (rawDepositUrl && !normalizeOptionalUrl(rawDepositUrl)) errors.push("invalid_hyperliquid_deposit_url");
  if (rawCoreTransferUrl && !normalizeOptionalUrl(rawCoreTransferUrl)) {
    errors.push("invalid_hyperliquid_core_transfer_url");
  }

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
      coreTransferUrl: normalizeOptionalUrl(rawCoreTransferUrl) ?? DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL
    },
    errors
  };
}
