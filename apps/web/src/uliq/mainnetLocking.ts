import { encodeFunctionData, erc20Abi, parseAbi, type Address, type Hex } from "viem";
import { ULIQ_ARBITRUM_ONE_TOKEN } from "../../lib/uliqDeployments";

export type MainnetLockingTx = { chainId: number; expectedSender: string; to: Address; data: Hex; value: string };
export type MainnetLockingAction =
  | { kind: "approve"; amount: bigint; days: number }
  | { kind: "lock"; amount: bigint; days: number }
  | { kind: "unlock"; id: bigint }
  | { kind: "extend"; id: bigint; expiry: bigint };
const abi = parseAbi(["function lock(uint256,uint64)", "function unlock(uint256)", "function extendLock(uint256,uint64)"]);

export function assertMainnetLockingTransaction(tx: MainnetLockingTx, wallet: string, locker: Address, action: MainnetLockingAction) {
  const to = action.kind === "approve" ? ULIQ_ARBITRUM_ONE_TOKEN.address : locker;
  const data = action.kind === "approve"
    ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [locker, action.amount] })
    : action.kind === "lock" ? encodeFunctionData({ abi, functionName: "lock", args: [action.amount, BigInt(action.days) * BigInt(86400)] })
    : action.kind === "unlock" ? encodeFunctionData({ abi, functionName: "unlock", args: [action.id] })
    : encodeFunctionData({ abi, functionName: "extendLock", args: [action.id, action.expiry] });
  if (tx.chainId !== 42161 || tx.expectedSender?.toLowerCase() !== wallet.toLowerCase()
    || tx.to?.toLowerCase() !== to.toLowerCase() || tx.data?.toLowerCase() !== data.toLowerCase()
    || tx.value !== "0") throw new Error("mainnet_locking_transaction_mismatch");
}
