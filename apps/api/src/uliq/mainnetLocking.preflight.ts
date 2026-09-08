import { keccak256, parseAbi } from "viem";
import type { UliqMainnetLockingConfig } from "./mainnetLocking.config.js";
import { assertUliqRpcPair, createUliqRpcPair, getConsistentBlockAt, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";

const lockerAbi = parseAbi([
  "function token() view returns (address)",
  "function ULIQ_TOKEN() view returns (address)",
  "function CHAIN_ID() view returns (uint256)",
  "function ONE_MONTH() view returns (uint64)",
  "function SIX_MONTHS() view returns (uint64)",
  "function TWELVE_MONTHS() view returns (uint64)",
  "function totalLocked() view returns (uint256)"
]);
const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
]);

// Read-only deployment reconciliation. Getter checks do not establish source-code identity.
export async function preflightUliqMainnetLocking(
  config: UliqMainnetLockingConfig,
  pair: UliqRpcPair = createUliqRpcPair(config)
) {
  await assertUliqRpcPair(config, pair);
  const finalized = await getConsistentFinalizedBlock(pair);
  if (config.startBlock > finalized.number) throw new Error("uliq_mainnet_locking_deployment_not_finalized");
  const deploymentBlock = await getConsistentBlockAt(pair, config.startBlock);
  const observations = await Promise.all([pair.primary, pair.secondary].map(async (client) => {
    const receipt = await client.getTransactionReceipt({ hash: config.deploymentTransactionHash });
    if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== config.deploymentTransactionHash.toLowerCase()
      || receipt.contractAddress?.toLowerCase() !== config.lockerAddress.toLowerCase()
      || receipt.blockNumber !== config.startBlock || receipt.blockHash.toLowerCase() !== deploymentBlock.hash.toLowerCase()) {
      throw new Error("uliq_mainnet_locking_deployment_receipt_mismatch");
    }
    const blockNumber = finalized.number;
    const [code, tokenCode, token, pinnedToken, chain, oneMonth, sixMonths, twelveMonths, totalLocked, decimals, balance] = await Promise.all([
      client.getCode({ address: config.lockerAddress, blockNumber }),
      client.getCode({ address: config.tokenAddress, blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "token", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "ULIQ_TOKEN", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "CHAIN_ID", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "ONE_MONTH", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "SIX_MONTHS", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "TWELVE_MONTHS", blockNumber }),
      client.readContract({ address: config.lockerAddress, abi: lockerAbi, functionName: "totalLocked", blockNumber }),
      client.readContract({ address: config.tokenAddress, abi: tokenAbi, functionName: "decimals", blockNumber }),
      client.readContract({ address: config.tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [config.lockerAddress], blockNumber })
    ]);
    if (!code || code === "0x" || !tokenCode || tokenCode === "0x") throw new Error("uliq_mainnet_locking_code_missing");
    if (token.toLowerCase() !== config.tokenAddress.toLowerCase() || pinnedToken.toLowerCase() !== config.tokenAddress.toLowerCase()
      || chain !== BigInt(config.chainId) || decimals !== 18) throw new Error("uliq_mainnet_locking_identity_mismatch");
    if (oneMonth !== 32n * 86400n || sixMonths !== 185n * 86400n || twelveMonths !== 367n * 86400n) {
      throw new Error("uliq_mainnet_locking_duration_mismatch");
    }
    if (balance < totalLocked) throw new Error("uliq_mainnet_locking_insolvent");
    return { runtimeCodeHash: keccak256(code), tokenCodeHash: keccak256(tokenCode), totalLockedRaw: totalLocked.toString(), balanceRaw: balance.toString() };
  }));
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) throw new Error("uliq_mainnet_locking_rpc_state_mismatch");
  // Recheck the pinned block after reads, so a changed provider view cannot pass silently.
  const afterReads = await getConsistentBlockAt(pair, finalized.number);
  if (afterReads.hash.toLowerCase() !== finalized.hash.toLowerCase()) throw new Error("uliq_mainnet_locking_finalized_block_changed");
  return {
    status: "deployment_reconciled" as const,
    chainId: config.chainId,
    lockerAddress: config.lockerAddress,
    tokenAddress: config.tokenAddress,
    deploymentTransactionHash: config.deploymentTransactionHash,
    startBlock: config.startBlock.toString(),
    finalizedBlock: finalized.number.toString(),
    finalizedBlockHash: finalized.hash,
    ...observations[0],
    sourceVerification: "required_separately" as const,
    runtimeActivation: "not_performed" as const
  };
}
