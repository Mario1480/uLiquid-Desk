import { isAddress } from "viem";
import type { Abi } from "viem";
import type { WalletFeatureConfig, MasterVaultAdapterId } from "./types";

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

function parseAbiJson(raw: string): Abi | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Abi) : null;
  } catch {
    return null;
  }
}

function normalizeAdapter(value: string): MasterVaultAdapterId {
  if (value === "eip4626") return "eip4626";
  if (value === "mock") return "mock";
  return "legacy_token_amount";
}

export function getWalletFeatureConfig(): WalletFeatureConfig {
  const rawAbi = readEnv("MASTER_VAULT_ABI", "NEXT_PUBLIC_MASTER_VAULT_ABI");
  const abi = parseAbiJson(rawAbi);
  const chainId = readPositiveInt(DEFAULT_CHAIN_ID, "HYPEREVM_CHAIN_ID", "NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID");
  const chainName = chainId === 999 ? "HyperEVM" : `Chain ${chainId}`;
  const errors: string[] = [];
  const masterVaultAddress = readAddress("MASTER_VAULT_ADDRESS", "NEXT_PUBLIC_MASTER_VAULT_ADDRESS");
  const usdcAddress =
    readAddress("USDC_ADDRESS", "NEXT_PUBLIC_USDC_ADDRESS", "NEXT_PUBLIC_HYPEREVM_USDC_ADDRESS")
    ?? DEFAULT_USDC_ADDRESS;

  if (rawAbi && !abi) errors.push("invalid_master_vault_abi");
  if (readEnv("MASTER_VAULT_ADDRESS", "NEXT_PUBLIC_MASTER_VAULT_ADDRESS") && !masterVaultAddress) {
    errors.push("invalid_master_vault_address");
  }
  if (readEnv("USDC_ADDRESS", "NEXT_PUBLIC_USDC_ADDRESS", "NEXT_PUBLIC_HYPEREVM_USDC_ADDRESS") && !usdcAddress) {
    errors.push("invalid_usdc_address");
  }

  const adapter = normalizeAdapter(readEnv("MASTER_VAULT_ADAPTER", "NEXT_PUBLIC_MASTER_VAULT_ADAPTER"));

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
    },
    masterVault: {
      address: masterVaultAddress,
      abi,
      adapter,
      depositFunctionName: readEnv("MASTER_VAULT_DEPOSIT_FUNCTION", "NEXT_PUBLIC_MASTER_VAULT_DEPOSIT_FUNCTION") || null,
      approveSpender:
        readAddress("MASTER_VAULT_APPROVE_SPENDER", "NEXT_PUBLIC_MASTER_VAULT_APPROVE_SPENDER")
        ?? masterVaultAddress,
      errors,
      writeEnabled: Boolean(masterVaultAddress && abi && usdcAddress && adapter !== "mock" && errors.length === 0)
    }
  };
}
