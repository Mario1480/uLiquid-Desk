import { isAddress } from "viem";
import type { VaultExecutionMode } from "./executionMode.js";

export type OnchainAddressBook = {
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

function resolveByMode(mode: VaultExecutionMode) {
  if (mode === "onchain_live") {
    return {
      chainId: readPositiveInt(process.env.VAULT_ONCHAIN_CHAIN_ID, 999),
      rpcUrl: String(process.env.VAULT_ONCHAIN_RPC_URL ?? "").trim(),
      factoryAddress: readAddress(process.env.VAULT_ONCHAIN_FACTORY_ADDRESS),
      usdcAddress: readAddress(process.env.VAULT_ONCHAIN_USDC_ADDRESS),
      confirmations: readNonNegativeInt(process.env.VAULT_ONCHAIN_CONFIRMATIONS, 2),
      startBlock: BigInt(readNonNegativeInt(process.env.VAULT_ONCHAIN_START_BLOCK, 0))
    };
  }

  return {
    chainId: readPositiveInt(process.env.VAULT_ONCHAIN_SIM_CHAIN_ID ?? process.env.VAULT_ONCHAIN_CHAIN_ID, 31337),
    rpcUrl: String(process.env.VAULT_ONCHAIN_SIM_RPC_URL ?? process.env.VAULT_ONCHAIN_RPC_URL ?? "http://127.0.0.1:8545").trim(),
    factoryAddress: readAddress(process.env.VAULT_ONCHAIN_SIM_FACTORY_ADDRESS ?? process.env.VAULT_ONCHAIN_FACTORY_ADDRESS),
    usdcAddress: readAddress(process.env.VAULT_ONCHAIN_SIM_USDC_ADDRESS ?? process.env.VAULT_ONCHAIN_USDC_ADDRESS),
    confirmations: readNonNegativeInt(process.env.VAULT_ONCHAIN_SIM_CONFIRMATIONS ?? process.env.VAULT_ONCHAIN_CONFIRMATIONS, 0),
    startBlock: BigInt(readNonNegativeInt(process.env.VAULT_ONCHAIN_SIM_START_BLOCK ?? process.env.VAULT_ONCHAIN_START_BLOCK, 0))
  };
}

export function resolveOnchainAddressBook(mode: VaultExecutionMode): OnchainAddressBook {
  const resolved = resolveByMode(mode);

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
    chainId: resolved.chainId,
    rpcUrl: resolved.rpcUrl,
    factoryAddress: resolved.factoryAddress,
    usdcAddress: resolved.usdcAddress,
    confirmations: resolved.confirmations,
    startBlock: resolved.startBlock
  };
}

export function canResolveOnchainAddressBook(mode: VaultExecutionMode): boolean {
  try {
    resolveOnchainAddressBook(mode);
    return true;
  } catch {
    return false;
  }
}
