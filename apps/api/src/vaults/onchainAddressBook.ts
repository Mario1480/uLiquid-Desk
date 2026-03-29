import { isAddress } from "viem";
import type { VaultExecutionMode } from "./executionMode.js";

export type OnchainContractVersion = "v1" | "v2" | "v3";

export type OnchainAddressBook = {
  contractVersion: OnchainContractVersion;
  chainId: number;
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  confirmations: number;
  startBlock: bigint;
};

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function readNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function readAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return raw as `0x${string}`;
}

export function resolveBotVaultV3FactoryAddress(
  mode: VaultExecutionMode
): `0x${string}` | null {
  if (mode === "onchain_live") {
    return readAddress(process.env.BOT_VAULT_V3_FACTORY_ADDRESS);
  }
  return readAddress(
    process.env.BOT_VAULT_V3_SIM_FACTORY_ADDRESS
      ?? process.env.BOT_VAULT_V3_FACTORY_ADDRESS
  );
}

export function normalizeOnchainContractVersion(value: unknown, fallback: OnchainContractVersion = "v1"): OnchainContractVersion {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "v3") return "v3";
  if (normalized === "v2") return "v2";
  if (normalized === "v1") return "v1";
  return fallback;
}

function resolveFactoryAddress(mode: VaultExecutionMode, contractVersion: OnchainContractVersion) {
  if (contractVersion === "v3") {
    return resolveBotVaultV3FactoryAddress(mode);
  }
  if (mode === "onchain_live") {
    if (contractVersion === "v2") {
      return readAddress(process.env.VAULT_ONCHAIN_FACTORY_V2_ADDRESS ?? process.env.VAULT_ONCHAIN_FACTORY_ADDRESS);
    }
    return readAddress(process.env.VAULT_ONCHAIN_FACTORY_V1_ADDRESS ?? process.env.VAULT_ONCHAIN_FACTORY_ADDRESS);
  }

  if (contractVersion === "v2") {
    return readAddress(
      process.env.VAULT_ONCHAIN_SIM_FACTORY_V2_ADDRESS
        ?? process.env.VAULT_ONCHAIN_SIM_FACTORY_ADDRESS
        ?? process.env.VAULT_ONCHAIN_FACTORY_V2_ADDRESS
        ?? process.env.VAULT_ONCHAIN_FACTORY_ADDRESS
    );
  }

  return readAddress(
    process.env.VAULT_ONCHAIN_SIM_FACTORY_V1_ADDRESS
      ?? process.env.VAULT_ONCHAIN_SIM_FACTORY_ADDRESS
      ?? process.env.VAULT_ONCHAIN_FACTORY_V1_ADDRESS
      ?? process.env.VAULT_ONCHAIN_FACTORY_ADDRESS
  );
}

function resolveByMode(mode: VaultExecutionMode, contractVersion: OnchainContractVersion) {
  if (mode === "onchain_live") {
    return {
      contractVersion,
      chainId: readPositiveInt(process.env.VAULT_ONCHAIN_CHAIN_ID, 999),
      rpcUrl: String(process.env.VAULT_ONCHAIN_RPC_URL ?? "").trim(),
      factoryAddress: resolveFactoryAddress(mode, contractVersion),
      usdcAddress: readAddress(process.env.VAULT_ONCHAIN_USDC_ADDRESS),
      confirmations: readNonNegativeInt(process.env.VAULT_ONCHAIN_CONFIRMATIONS, 2),
      startBlock: BigInt(readNonNegativeInt(process.env.VAULT_ONCHAIN_START_BLOCK, 0))
    };
  }

  return {
    contractVersion,
    chainId: readPositiveInt(process.env.VAULT_ONCHAIN_SIM_CHAIN_ID ?? process.env.VAULT_ONCHAIN_CHAIN_ID, 31337),
    rpcUrl: String(process.env.VAULT_ONCHAIN_SIM_RPC_URL ?? process.env.VAULT_ONCHAIN_RPC_URL ?? "http://127.0.0.1:8545").trim(),
    factoryAddress: resolveFactoryAddress(mode, contractVersion),
    usdcAddress: readAddress(process.env.VAULT_ONCHAIN_SIM_USDC_ADDRESS ?? process.env.VAULT_ONCHAIN_USDC_ADDRESS),
    confirmations: readNonNegativeInt(process.env.VAULT_ONCHAIN_SIM_CONFIRMATIONS ?? process.env.VAULT_ONCHAIN_CONFIRMATIONS, 0),
    startBlock: BigInt(readNonNegativeInt(process.env.VAULT_ONCHAIN_SIM_START_BLOCK ?? process.env.VAULT_ONCHAIN_START_BLOCK, 0))
  };
}

export function resolveOnchainAddressBook(
  input: VaultExecutionMode | { mode: VaultExecutionMode; contractVersion?: unknown }
): OnchainAddressBook {
  const mode = typeof input === "string" ? input : input.mode;
  const contractVersion = normalizeOnchainContractVersion(
    typeof input === "string" ? "v1" : input.contractVersion,
    "v1"
  );
  const resolved = resolveByMode(mode, contractVersion);

  if (!resolved.rpcUrl) {
    throw new Error("vault_onchain_rpc_url_missing");
  }

  if (!resolved.factoryAddress) {
    throw new Error("vault_onchain_factory_address_missing");
  }

  if (!resolved.usdcAddress) {
    throw new Error("vault_onchain_usdc_address_missing");
  }

  return {
    contractVersion: resolved.contractVersion,
    chainId: resolved.chainId,
    rpcUrl: resolved.rpcUrl,
    factoryAddress: resolved.factoryAddress,
    usdcAddress: resolved.usdcAddress,
    confirmations: resolved.confirmations,
    startBlock: resolved.startBlock
  };
}

export function canResolveOnchainAddressBook(
  input: VaultExecutionMode | { mode: VaultExecutionMode; contractVersion?: unknown }
): boolean {
  try {
    resolveOnchainAddressBook(input);
    return true;
  } catch {
    return false;
  }
}

export function resolveAllOnchainAddressBooks(mode: VaultExecutionMode): OnchainAddressBook[] {
  const books: OnchainAddressBook[] = [];
  for (const contractVersion of ["v1", "v2"] as const) {
    try {
      const next = resolveOnchainAddressBook({ mode, contractVersion });
      if (!books.some((entry) => entry.factoryAddress === next.factoryAddress)) {
        books.push(next);
      }
    } catch {
      // ignore missing version-specific config
    }
  }
  return books;
}

export function resolveBotVaultV3AddressBook(mode: VaultExecutionMode): OnchainAddressBook {
  return resolveOnchainAddressBook({ mode, contractVersion: "v3" });
}
