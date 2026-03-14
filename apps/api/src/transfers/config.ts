import { isAddress } from "viem";
import { resolveWalletReadConfig } from "../wallet/config.js";

const DEFAULT_HYPERLIQUID_EXCHANGE_URL = "https://api.hyperliquid.xyz";
const DEFAULT_USDC_DECIMALS = 6;
const PLACEHOLDER_HYPERLIQUID_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222";

export type TransferReadConfig = {
  hyperEvm: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    usdcAddress: `0x${string}` | null;
    usdcDecimals: number;
  };
  hyperliquidInfoUrl: string;
  hyperliquidExchangeUrl: string;
  systemAddress: `0x${string}` | null;
  errors: string[];
};

function normalizeUrl(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function readAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  if (raw.toLowerCase() === PLACEHOLDER_HYPERLIQUID_SYSTEM_ADDRESS.toLowerCase()) return null;
  return raw as `0x${string}`;
}

export function resolveTransferReadConfig(): TransferReadConfig {
  const walletConfig = resolveWalletReadConfig();
  const errors = [...walletConfig.errors];
  const rawSystemAddress = String(
    process.env.HYPERLIQUID_SYSTEM_ADDRESS
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_SYSTEM_ADDRESS
    ?? ""
  ).trim();
  const rawExchangeUrl = String(
    process.env.HYPERLIQUID_EXCHANGE_URL
    ?? process.env.NEXT_PUBLIC_HYPERLIQUID_EXCHANGE_URL
    ?? ""
  ).trim();

  const parsedSystemAddress = readAddress(rawSystemAddress);
  const systemAddress = parsedSystemAddress;
  if (rawSystemAddress && !parsedSystemAddress) errors.push("invalid_hyperliquid_system_address");
  if (rawExchangeUrl) {
    try {
      new URL(rawExchangeUrl);
    } catch {
      errors.push("invalid_hyperliquid_exchange_url");
    }
  }

  return {
    hyperEvm: {
      chainId: walletConfig.hyperEvmChainId,
      rpcUrl: walletConfig.hyperEvmRpcUrl,
      explorerUrl: walletConfig.hyperEvmExplorerUrl,
      usdcAddress: walletConfig.usdcAddress,
      usdcDecimals: readPositiveInt(walletConfig.usdcDecimals, DEFAULT_USDC_DECIMALS)
    },
    hyperliquidInfoUrl: walletConfig.hyperliquidInfoUrl,
    hyperliquidExchangeUrl: normalizeUrl(rawExchangeUrl, DEFAULT_HYPERLIQUID_EXCHANGE_URL),
    systemAddress,
    errors
  };
}
