import { isAddress } from "viem";

const DEFAULT_HYPEREVM_RPC_URL = "https://rpc.hyperliquid.xyz/evm";
const DEFAULT_HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const DEFAULT_HYPEREVM_EXPLORER_URL = "https://app.hyperliquid.xyz/explorer";
const DEFAULT_USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const DEFAULT_USDC_DECIMALS = 6;

export type WalletReadConfig = {
  hyperEvmChainId: number;
  hyperEvmRpcUrl: string;
  hyperEvmExplorerUrl: string;
  hyperliquidInfoUrl: string;
  usdcAddress: `0x${string}` | null;
  usdcDecimals: number;
  masterVaultAddress: `0x${string}` | null;
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

function readAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return raw as `0x${string}`;
}

export function resolveWalletReadConfig(): WalletReadConfig {
  const errors: string[] = [];
  const rawUsdc = String(process.env.USDC_ADDRESS ?? "").trim();
  const rawMasterVault = String(process.env.MASTER_VAULT_ADDRESS ?? "").trim();
  const usdcAddress = readAddress(rawUsdc) ?? DEFAULT_USDC_ADDRESS;
  const masterVaultAddress = readAddress(rawMasterVault);

  if (rawUsdc && !usdcAddress) errors.push("invalid_usdc_address");
  if (rawMasterVault && !masterVaultAddress) errors.push("invalid_master_vault_address");

  return {
    hyperEvmChainId: readPositiveInt(process.env.HYPEREVM_CHAIN_ID ?? process.env.VAULT_ONCHAIN_CHAIN_ID, 999),
    hyperEvmRpcUrl: normalizeUrl(
      process.env.HYPEREVM_RPC_URL ?? process.env.VAULT_ONCHAIN_RPC_URL,
      DEFAULT_HYPEREVM_RPC_URL
    ),
    hyperEvmExplorerUrl: normalizeUrl(process.env.HYPEREVM_EXPLORER_URL, DEFAULT_HYPEREVM_EXPLORER_URL),
    hyperliquidInfoUrl: normalizeUrl(process.env.HYPERLIQUID_INFO_URL, DEFAULT_HYPERLIQUID_INFO_URL),
    usdcAddress,
    usdcDecimals: readPositiveInt(process.env.USDC_DECIMALS, DEFAULT_USDC_DECIMALS),
    masterVaultAddress,
    errors
  };
}
