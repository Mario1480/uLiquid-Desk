import type { PublicClient } from "viem";
import type { UliqMainnetLockingConfig } from "./mainnetLocking.config.js";
import { preflightUliqMainnetLocking } from "./mainnetLocking.preflight.js";
import type { UliqRpcPair } from "./rpc.js";

export async function readMainnetLockingPair<T>(rpc: UliqRpcPair, read: (client: PublicClient) => Promise<T>): Promise<T> {
  const values = await Promise.all([read(rpc.primary), read(rpc.secondary)]);
  const serialize = (value: T) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
  if (serialize(values[0]) !== serialize(values[1])) throw new Error("uliq_mainnet_locking_rpc_state_mismatch");
  return values[0];
}

export function createMainnetLockingReadiness(config: UliqMainnetLockingConfig, rpc: UliqRpcPair) {
  let validUntil = 0;
  let pending: Promise<void> | null = null;
  return async () => {
    if (Date.now() < validUntil) return;
    pending ??= (async () => {
      if (!config.runtimeCodeHash) throw new Error("uliq_mainnet_locking_verified_code_hash_required");
      const result = await preflightUliqMainnetLocking(config, rpc);
      if (result.runtimeCodeHash.toLowerCase() !== config.runtimeCodeHash.toLowerCase()) {
        throw new Error("uliq_mainnet_locking_code_hash_mismatch");
      }
      validUntil = Date.now() + 60_000;
    })();
    try { await pending; } finally { pending = null; }
  };
}
