import { getAddress, isAddress, zeroAddress } from "viem";

export const ULIQ_MAINNET_LOCKING_CHAIN_ID = 42161;
export const ULIQ_MAINNET_LOCKING_TOKEN = "0xF2Fa252134c84Fcf260c73665BAf3f8cCBe03EEd";

export type UliqMainnetLockingConfig = {
  chainId: typeof ULIQ_MAINNET_LOCKING_CHAIN_ID;
  tokenAddress: typeof ULIQ_MAINNET_LOCKING_TOKEN;
  lockerAddress: `0x${string}`;
  deploymentTransactionHash: `0x${string}`;
  startBlock: bigint;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  runtimeCodeHash?: `0x${string}`;
};

export function getUliqMainnetLockingFlags(env: NodeJS.ProcessEnv = process.env) {
  const on = (value: string | undefined) => ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
  const enabled = on(env.ULIQ_MAINNET_LOCKING_ENABLED);
  return {
    enabled,
    depositsEnabled: enabled && on(env.ULIQ_MAINNET_LOCKING_DEPOSITS_ENABLED),
    extensionsEnabled: enabled && on(env.ULIQ_MAINNET_LOCKING_EXTENSIONS_ENABLED),
    indexerEnabled: enabled && on(env.ULIQ_MAINNET_LOCKING_INDEXER_ENABLED)
  };
}

export function mainnetLockingCursorId(config: UliqMainnetLockingConfig): string {
  return `uliq-mainnet-locking:${config.chainId}:${config.lockerAddress.toLowerCase()}`;
}

function rpcUrl(value: string | undefined, name: string): string {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.toString();
  } catch {
    throw new Error(`uliq_mainnet_locking_invalid_${name}`);
  }
}

// Independent from the legacy Sepolia namespace. Parsing does not activate any routes or jobs.
export function getUliqMainnetLockingConfig(env: NodeJS.ProcessEnv = process.env): UliqMainnetLockingConfig {
  if (String(env.ULIQ_MAINNET_LOCKING_CHAIN_ID ?? "").trim() !== "42161") {
    throw new Error("uliq_mainnet_locking_invalid_chain_id");
  }
  const locker = String(env.ULIQ_MAINNET_LOCKING_LOCKER_ADDRESS ?? "").trim();
  if (!isAddress(locker) || locker.toLowerCase() === zeroAddress
    || locker.toLowerCase() === ULIQ_MAINNET_LOCKING_TOKEN.toLowerCase()) {
    throw new Error("uliq_mainnet_locking_invalid_locker_address");
  }
  const transactionHash = String(env.ULIQ_MAINNET_LOCKING_DEPLOYMENT_TX_HASH ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || /^0x0{64}$/i.test(transactionHash)) {
    throw new Error("uliq_mainnet_locking_invalid_deployment_tx_hash");
  }
  const startBlock = String(env.ULIQ_MAINNET_LOCKING_START_BLOCK ?? "").trim();
  if (!/^[1-9]\d*$/.test(startBlock)) throw new Error("uliq_mainnet_locking_invalid_start_block");
  const primaryRpcUrl = rpcUrl(env.ULIQ_MAINNET_LOCKING_RPC_PRIMARY_URL, "primary_rpc");
  const secondaryRpcUrl = rpcUrl(env.ULIQ_MAINNET_LOCKING_RPC_SECONDARY_URL, "secondary_rpc");
  if (primaryRpcUrl === secondaryRpcUrl) throw new Error("uliq_mainnet_locking_distinct_rpc_required");
  const runtimeCodeHash = String(env.ULIQ_MAINNET_LOCKING_RUNTIME_CODE_HASH ?? "").trim();
  if (runtimeCodeHash && !/^0x[0-9a-fA-F]{64}$/.test(runtimeCodeHash)) throw new Error("uliq_mainnet_locking_invalid_code_hash");
  return {
    chainId: ULIQ_MAINNET_LOCKING_CHAIN_ID,
    tokenAddress: ULIQ_MAINNET_LOCKING_TOKEN,
    lockerAddress: getAddress(locker),
    deploymentTransactionHash: transactionHash as `0x${string}`,
    startBlock: BigInt(startBlock),
    primaryRpcUrl,
    secondaryRpcUrl,
    ...(runtimeCodeHash ? { runtimeCodeHash: runtimeCodeHash.toLowerCase() as `0x${string}` } : {})
  };
}
