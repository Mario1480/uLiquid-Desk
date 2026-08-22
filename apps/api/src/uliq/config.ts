import { getAddress, isAddress } from "viem";

export const ULIQ_TESTNET_CHAIN_ID = 421_614;
export const ULIQ_REFERENCE_PRICE_USD = "0.001000000000000000";
export const ULIQ_RESERVATION_TTL_MS = 10 * 60 * 1_000;
export const ULIQ_HOLDING_COOLDOWN_SECONDS = 24 * 60 * 60;
export const ULIQ_ENTITLEMENT_TTL_MS = 5 * 60 * 1_000;

export type UliqFeatureFlags = {
  enabled: boolean;
  presaleEnabled: boolean;
  discountsEnabled: boolean;
  lockingEnabled: boolean;
  adminEnabled: boolean;
};

export type UliqContractAddresses = {
  token: `0x${string}`;
  presale: `0x${string}`;
  vesting: `0x${string}`;
  locker: `0x${string}`;
  usdc: `0x${string}`;
};

export type UliqRuntimeConfig = {
  chainId: typeof ULIQ_TESTNET_CHAIN_ID;
  flags: UliqFeatureFlags;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  startBlock: bigint;
  confirmations: number;
  contracts: UliqContractAddresses;
};

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function requireAddress(value: string | undefined, name: string): `0x${string}` {
  const normalized = String(value ?? "").trim();
  if (!isAddress(normalized)) throw new Error(`uliq_config_invalid_${name}`);
  return getAddress(normalized);
}

function requireRpcUrl(value: string | undefined, name: string): string {
  const normalized = String(value ?? "").trim();
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    return parsed.toString();
  } catch {
    throw new Error(`uliq_config_invalid_${name}`);
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`uliq_config_invalid_${name}`);
  return parsed;
}

export function getUliqFeatureFlags(env: NodeJS.ProcessEnv = process.env): UliqFeatureFlags {
  const flags = {
    enabled: enabled(env.ULIQ_ENABLED),
    presaleEnabled: enabled(env.ULIQ_PRESALE_ENABLED),
    discountsEnabled: enabled(env.ULIQ_DISCOUNTS_ENABLED),
    lockingEnabled: enabled(env.ULIQ_LOCKING_ENABLED),
    adminEnabled: enabled(env.ULIQ_ADMIN_ENABLED)
  };
  const productionRuntime = String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  if (productionRuntime && Object.values(flags).some(Boolean)) {
    const explicitTestnetRuntime = enabled(env.ULIQ_TESTNET_RUNTIME);
    const explicitChainId = String(env.ULIQ_CHAIN_ID ?? "").trim();
    if (!explicitTestnetRuntime || explicitChainId !== String(ULIQ_TESTNET_CHAIN_ID)) {
      throw new Error("uliq_production_activation_forbidden");
    }
  }
  if (!flags.enabled && Object.entries(flags).some(([key, value]) => key !== "enabled" && value)) {
    throw new Error("uliq_parent_feature_disabled");
  }
  return flags;
}

export function getUliqRuntimeConfig(env: NodeJS.ProcessEnv = process.env): UliqRuntimeConfig {
  const flags = getUliqFeatureFlags(env);
  if (!flags.enabled) throw new Error("uliq_disabled");

  const chainId = positiveInteger(env.ULIQ_CHAIN_ID, ULIQ_TESTNET_CHAIN_ID, "chain_id");
  if (chainId !== ULIQ_TESTNET_CHAIN_ID) throw new Error("uliq_testnet_chain_required");
  const primaryRpcUrl = requireRpcUrl(env.ULIQ_RPC_PRIMARY_URL, "primary_rpc");
  const secondaryRpcUrl = requireRpcUrl(env.ULIQ_RPC_SECONDARY_URL, "secondary_rpc");
  if (primaryRpcUrl === secondaryRpcUrl) throw new Error("uliq_distinct_rpc_required");
  const rawStartBlock = String(env.ULIQ_START_BLOCK ?? "").trim();
  if (!/^\d+$/.test(rawStartBlock)) throw new Error("uliq_config_invalid_start_block");

  return {
    chainId: ULIQ_TESTNET_CHAIN_ID,
    flags,
    primaryRpcUrl,
    secondaryRpcUrl,
    startBlock: BigInt(rawStartBlock),
    confirmations: positiveInteger(env.ULIQ_CONFIRMATIONS, 12, "confirmations"),
    contracts: {
      token: requireAddress(env.ULIQ_TOKEN_ADDRESS, "token_address"),
      presale: requireAddress(env.ULIQ_PRESALE_ADDRESS, "presale_address"),
      vesting: requireAddress(env.ULIQ_VESTING_ADDRESS, "vesting_address"),
      locker: requireAddress(env.ULIQ_LOCKER_ADDRESS, "locker_address"),
      usdc: requireAddress(env.ULIQ_USDC_ADDRESS, "usdc_address")
    }
  };
}
