import { isAddress } from "viem";
import { getWalletFeatureConfig } from "../wallet/config";
import type { FundingFeatureConfig } from "./types";

const DEFAULT_ARBITRUM_CHAIN_ID = 42161;
const DEFAULT_ARBITRUM_RPC_URL = "https://arb1.arbitrum.io/rpc";
const DEFAULT_ARBITRUM_EXPLORER_URL = "https://arbiscan.io";
const DEFAULT_ARBITRUM_USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEFAULT_HYPERLIQUID_BRIDGE_CONTRACT = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const DEFAULT_HYPERLIQUID_DEPOSIT_URL = "https://app.hyperliquid.xyz/trade";
const DEFAULT_HYPERLIQUID_BRIDGE_URL = "https://app.hyperliquid.xyz/portfolio";
const DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL = "https://app.hyperliquid.xyz/portfolio";
const DEFAULT_HYPERLIQUID_EXCHANGE_URL = "https://api.hyperliquid.xyz";
const DEFAULT_ARBITRUM_USDC_DECIMALS = 6;

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function readAddress(...names: string[]): string | null {
  const value = readEnv(...names);
  return value && isAddress(value) ? value : null;
}

function readPositiveInt(fallback: number, ...names: string[]): number {
  const value = readEnv(...names);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function readUrl(fallback: string, ...names: string[]): string {
  const value = readEnv(...names);
  if (!value) return fallback;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function readOptionalUrl(...names: string[]): string | null {
  const value = readEnv(...names);
  if (!value) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getFundingFeatureConfig(): FundingFeatureConfig {
  const wallet = getWalletFeatureConfig();

  return {
    arbitrum: {
      chainId: readPositiveInt(
        DEFAULT_ARBITRUM_CHAIN_ID,
        "ARBITRUM_CHAIN_ID",
        "NEXT_PUBLIC_ARBITRUM_CHAIN_ID"
      ),
      name: "Arbitrum",
      rpcUrl: readUrl(
        DEFAULT_ARBITRUM_RPC_URL,
        "ARBITRUM_RPC_URL",
        "NEXT_PUBLIC_ARBITRUM_RPC_URL"
      ),
      explorerUrl: readUrl(
        DEFAULT_ARBITRUM_EXPLORER_URL,
        "ARBITRUM_EXPLORER_URL",
        "NEXT_PUBLIC_ARBITRUM_EXPLORER_URL"
      ),
      usdcAddress:
        readAddress(
          "ARBITRUM_USDC_ADDRESS",
          "NEXT_PUBLIC_ARBITRUM_USDC_ADDRESS"
        )
        ?? DEFAULT_ARBITRUM_USDC_ADDRESS,
      usdcDecimals: readPositiveInt(
        DEFAULT_ARBITRUM_USDC_DECIMALS,
        "ARBITRUM_USDC_DECIMALS",
        "NEXT_PUBLIC_ARBITRUM_USDC_DECIMALS"
      )
    },
    hyperEvm: wallet.chain,
    hyperliquidExchangeUrl: readUrl(
      DEFAULT_HYPERLIQUID_EXCHANGE_URL,
      "HYPERLIQUID_EXCHANGE_URL",
      "NEXT_PUBLIC_HYPERLIQUID_EXCHANGE_URL"
    ),
    bridge: {
      depositContractAddress:
        readAddress(
          "HYPERLIQUID_BRIDGE_CONTRACT",
          "NEXT_PUBLIC_HYPERLIQUID_BRIDGE_CONTRACT"
        )
        ?? DEFAULT_HYPERLIQUID_BRIDGE_CONTRACT,
      minDepositUsdc: readPositiveInt(
        5,
        "HYPERLIQUID_BRIDGE_MIN_DEPOSIT_USDC",
        "NEXT_PUBLIC_HYPERLIQUID_BRIDGE_MIN_DEPOSIT_USDC"
      ),
      withdrawFeeUsdc: readPositiveInt(
        1,
        "HYPERLIQUID_BRIDGE_WITHDRAW_FEE_USDC",
        "NEXT_PUBLIC_HYPERLIQUID_BRIDGE_WITHDRAW_FEE_USDC"
      ),
      officialAppUrl:
        readOptionalUrl(
          "HYPERLIQUID_BRIDGE_URL",
          "NEXT_PUBLIC_HYPERLIQUID_BRIDGE_URL"
        )
        ?? DEFAULT_HYPERLIQUID_BRIDGE_URL
    },
    externalLinks: {
      depositUrl:
        readOptionalUrl(
          "HYPERLIQUID_DEPOSIT_URL",
          "NEXT_PUBLIC_HYPERLIQUID_DEPOSIT_URL"
        )
        ?? DEFAULT_HYPERLIQUID_DEPOSIT_URL,
      coreTransferUrl:
        readOptionalUrl(
          "HYPERLIQUID_CORE_EVM_TRANSFER_URL",
          "NEXT_PUBLIC_HYPERLIQUID_CORE_EVM_TRANSFER_URL"
        )
        ?? DEFAULT_HYPERLIQUID_CORE_TRANSFER_URL
    },
    wallet
  };
}
