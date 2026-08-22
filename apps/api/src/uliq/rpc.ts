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
  const [primary, secondary] = await Promise.all([
    pair.primary.getBlock({ blockTag: "finalized" }),
    pair.secondary.getBlock({ blockTag: "finalized" })
  ]);
  if (primary.number !== secondary.number || primary.hash !== secondary.hash || !primary.hash) {
    throw new Error("uliq_rpc_finalized_head_mismatch");
  }
  return { number: primary.number, hash: primary.hash, timestamp: primary.timestamp };
}
