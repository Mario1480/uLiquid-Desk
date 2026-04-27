import { isAddress } from "viem";
import type { WalletFeatureConfig } from "./types";

const DEFAULT_CHAIN_ID = 999;
const DEFAULT_RPC_URL = "https://rpc.hyperliquid.xyz/evm";
const DEFAULT_EXPLORER_URL = "https://app.hyperliquid.xyz/explorer";
const DEFAULT_USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const DEFAULT_USDC_DECIMALS = 6;

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

export function getWalletFeatureConfig(): WalletFeatureConfig {
  const chainId = readPositiveInt(DEFAULT_CHAIN_ID, "HYPEREVM_CHAIN_ID", "NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID");
  const chainName = chainId === 999 ? "HyperEVM" : `Chain ${chainId}`;
  const usdcAddress =
    readAddress("USDC_ADDRESS", "NEXT_PUBLIC_USDC_ADDRESS", "NEXT_PUBLIC_HYPEREVM_USDC_ADDRESS")
    ?? DEFAULT_USDC_ADDRESS;

  return {
    chain: {
      id: chainId,
      name: chainName,
      rpcUrl: readEnv("HYPEREVM_RPC_URL", "NEXT_PUBLIC_HYPEREVM_RPC_URL") || DEFAULT_RPC_URL,
      explorerUrl: readEnv("HYPEREVM_EXPLORER_URL", "NEXT_PUBLIC_HYPEREVM_EXPLORER_URL") || DEFAULT_EXPLORER_URL
    },
    usdc: {
      address: usdcAddress,
      symbol: "USDC",
      decimals: readPositiveInt(DEFAULT_USDC_DECIMALS, "USDC_DECIMALS", "NEXT_PUBLIC_USDC_DECIMALS")
    }
  };
}
