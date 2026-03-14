import { isAddress } from "viem";
import { getWalletFeatureConfig } from "../wallet/config";
import type { TransferFeatureConfig } from "./types";

const DEFAULT_HYPERLIQUID_EXCHANGE_URL = "https://api.hyperliquid.xyz";
const DEFAULT_SIGNATURE_CHAIN_ID = 42161;

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
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

function readAddress(...names: string[]): `0x${string}` | null {
  const value = readEnv(...names);
  if (!value || !isAddress(value)) return null;
  return value as `0x${string}`;
}

function readPositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export function getTransferFeatureConfig(): TransferFeatureConfig {
  const wallet = getWalletFeatureConfig();
  return {
    hyperEvm: wallet.chain,
    wallet,
    hyperliquidExchangeUrl: readUrl(
      DEFAULT_HYPERLIQUID_EXCHANGE_URL,
      "HYPERLIQUID_EXCHANGE_URL",
      "NEXT_PUBLIC_HYPERLIQUID_EXCHANGE_URL"
    ),
    signatureChainId: readPositiveInt(
      readEnv(
        "HYPERLIQUID_SIGNATURE_CHAIN_ID",
        "NEXT_PUBLIC_HYPERLIQUID_SIGNATURE_CHAIN_ID"
      ),
      DEFAULT_SIGNATURE_CHAIN_ID
    ),
    systemAddress:
      readAddress(
        "HYPERLIQUID_SYSTEM_ADDRESS",
        "NEXT_PUBLIC_HYPERLIQUID_SYSTEM_ADDRESS"
      )
      ?? null
  };
}
