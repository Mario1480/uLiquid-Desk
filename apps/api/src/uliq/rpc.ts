import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { type UliqRuntimeConfig } from "./config.js";

export type UliqRpcPair = {
  primary: PublicClient;
  secondary: PublicClient;
};

export function createUliqRpcPair(config: UliqRuntimeConfig): UliqRpcPair {
  const chain = defineChain({
    id: config.chainId,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [config.primaryRpcUrl] }
    }
  });
  return {
    primary: createPublicClient({ chain, transport: http(config.primaryRpcUrl, { timeout: 15_000 }) }),
    secondary: createPublicClient({ chain, transport: http(config.secondaryRpcUrl, { timeout: 15_000 }) })
  };
}

export async function assertUliqRpcPair(config: UliqRuntimeConfig, pair: UliqRpcPair): Promise<void> {
  const [primaryChainId, secondaryChainId] = await Promise.all([
    pair.primary.getChainId(),
    pair.secondary.getChainId()
  ]);
  if (primaryChainId !== config.chainId || secondaryChainId !== config.chainId) {
    throw new Error("uliq_rpc_chain_mismatch");
  }
}

export async function withUliqRpcFailover<T>(
  pair: UliqRpcPair,
  read: (client: PublicClient, source: "primary" | "secondary") => Promise<T>
): Promise<{ value: T; source: "primary" | "secondary" }> {
  try {
    return { value: await read(pair.primary, "primary"), source: "primary" };
  } catch (primaryError) {
    try {
      return { value: await read(pair.secondary, "secondary"), source: "secondary" };
    } catch (secondaryError) {
      throw new AggregateError([primaryError, secondaryError], "uliq_rpc_unavailable");
    }
  }
}

export async function getConsistentFinalizedBlock(pair: UliqRpcPair): Promise<{
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
}> {
  return getConsistentTaggedBlock(pair, "finalized");
}

export async function getConsistentSafeBlock(pair: UliqRpcPair): Promise<{
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
}> {
  return getConsistentTaggedBlock(pair, "safe");
}

export async function getConsistentBlockAt(pair: UliqRpcPair, blockNumber: bigint): Promise<{
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
}> {
  const [primary, secondary] = await Promise.all([
    pair.primary.getBlock({ blockNumber }),
    pair.secondary.getBlock({ blockNumber })
  ]);
  if (!primary.hash || !secondary.hash || primary.number !== blockNumber || secondary.number !== blockNumber) {
    throw new Error("uliq_rpc_block_unavailable");
  }
  if (primary.hash.toLowerCase() !== secondary.hash.toLowerCase()) {
    throw new Error("uliq_rpc_block_mismatch");
  }
  return { number: blockNumber, hash: primary.hash, timestamp: primary.timestamp };
}

async function getConsistentTaggedBlock(pair: UliqRpcPair, blockTag: "safe" | "finalized"): Promise<{
  number: bigint;
  hash: `0x${string}`;
  timestamp: bigint;
}> {
  const [primaryHead, secondaryHead] = await Promise.all([
    pair.primary.getBlock({ blockTag }),
    pair.secondary.getBlock({ blockTag })
  ]);
  if (!primaryHead.hash || !secondaryHead.hash) throw new Error(`uliq_rpc_${blockTag}_head_unavailable`);

  const commonNumber = primaryHead.number < secondaryHead.number ? primaryHead.number : secondaryHead.number;
  if (primaryHead.number === commonNumber && secondaryHead.number === commonNumber) {
    if (primaryHead.hash.toLowerCase() !== secondaryHead.hash.toLowerCase()) {
      throw new Error(`uliq_rpc_${blockTag}_head_mismatch`);
    }
    return { number: commonNumber, hash: primaryHead.hash, timestamp: primaryHead.timestamp };
  }

  return getConsistentBlockAt(pair, commonNumber);
}
