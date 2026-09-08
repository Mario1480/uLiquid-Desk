import { encodeFunctionData, getAddress, type Address } from "viem";
import { uliqLockerAbi, uliqTokenAbi } from "./abi.js";
import { getUliqMainnetLockingConfig, getUliqMainnetLockingFlags, mainnetLockingCursorId, type UliqMainnetLockingConfig } from "./mainnetLocking.config.js";
import { createMainnetLockingReadiness, readMainnetLockingPair } from "./mainnetLocking.runtime.js";
import { createUliqRpcPair, getConsistentBlockAt, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";
import { parseUint256Decimal } from "./uint256.js";

export class UliqMainnetLockingService {
  private readonly ready: () => Promise<void>;
  constructor(
    private readonly db: any,
    private readonly config: UliqMainnetLockingConfig = getUliqMainnetLockingConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config),
    ready?: () => Promise<void>
  ) { this.ready = ready ?? createMainnetLockingReadiness(config, rpc); }

  private async wallet(userId: string): Promise<Address> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    return getAddress(user.walletAddress);
  }

  private tx(wallet: Address, to: Address, data: `0x${string}`) {
    return { chainId: this.config.chainId, expectedSender: wallet, to, data, value: "0" };
  }

  async getForUser(userId: string, before?: string) {
    const wallet = await this.wallet(userId);
    await this.ready();
    const head = await getConsistentFinalizedBlock(this.rpc);
    const cursor = await this.db.onchainSyncCursor.findUnique({ where: { id: mainnetLockingCursorId(this.config) } });
    if (cursor?.lastProcessedBlockHash) {
      const indexed = await getConsistentBlockAt(this.rpc, BigInt(cursor.lastProcessedBlock));
      if (indexed.hash.toLowerCase() !== cursor.lastProcessedBlockHash.toLowerCase()) throw new Error("uliq_mainnet_locking_indexer_reorg");
    }
    const rows = await this.db.uliqLockPosition.findMany({
      where: {
        chainId: this.config.chainId, contractAddress: this.config.lockerAddress.toLowerCase(),
        walletAddress: wallet.toLowerCase(),
        ...(before ? { lockIdOnchain: { lt: parseUint256Decimal(before, "cursor").toString() } } : {})
      }, orderBy: { lockIdOnchain: "desc" }, take: 51
    });
    const state = await readMainnetLockingPair(this.rpc, async (client) => {
      const [balance, lockedBalance, positions] = await Promise.all([
        client.readContract({ address: this.config.tokenAddress, abi: uliqTokenAbi, functionName: "balanceOf", args: [wallet], blockNumber: head.number }),
        client.readContract({ address: this.config.lockerAddress, abi: uliqLockerAbi, functionName: "lockedBalanceOf", args: [wallet], blockNumber: head.number }),
        Promise.all(rows.slice(0, 50).map(async (row: any) => {
          const id = BigInt(row.lockIdOnchain.toString());
          const [owner, amount, startedAt, unlockAt, withdrawn] = await client.readContract({ address: this.config.lockerAddress, abi: uliqLockerAbi, functionName: "locks", args: [id], blockNumber: head.number });
          if (owner.toLowerCase() !== wallet.toLowerCase()) throw new Error("lock_wallet_mismatch");
          return { lockId: id.toString(), amountRaw: amount.toString(), startedAt: startedAt.toString(), unlockAt: unlockAt.toString(), withdrawn, canUnlock: !withdrawn && BigInt(unlockAt) <= head.timestamp };
        }))
      ]);
      return { balanceRaw: balance.toString(), lockedBalanceRaw: lockedBalance.toString(), positions };
    });
    return {
      ...state, chainId: this.config.chainId, tokenAddress: this.config.tokenAddress,
      lockerAddress: this.config.lockerAddress, walletAddress: wallet,
      ...getUliqMainnetLockingFlags(), asOfBlock: head.number.toString(), asOfTimestamp: head.timestamp.toString(),
      indexedThroughBlock: cursor ? String(cursor.lastProcessedBlock) : null,
      partial: !cursor || BigInt(cursor.lastProcessedBlock) < head.number,
      nextCursor: rows.length > 50 ? rows[49].lockIdOnchain.toString() : null
    };
  }

  async prepareLock(userId: string, raw: string, days: number) {
    if (!getUliqMainnetLockingFlags().depositsEnabled) throw new Error("uliq_mainnet_locking_deposits_disabled");
    const amount = parseUint256Decimal(raw, "amount_raw");
    if (amount === 0n) throw new Error("invalid_amount_raw");
    if (![32, 185, 367].includes(days)) throw new Error("unsupported_lock_duration");
    const wallet = await this.wallet(userId);
    await this.ready();
    const head = await getConsistentFinalizedBlock(this.rpc);
    const balance = await readMainnetLockingPair(this.rpc, (client) => client.readContract({
      address: this.config.tokenAddress, abi: uliqTokenAbi, functionName: "balanceOf", args: [wallet], blockNumber: head.number
    }));
    if (balance < amount) throw new Error("insufficient_uliq_balance");
    // Always prepare an exact approval; never rely on an allowance read from an older finalized block.
    return {
      approval: this.tx(wallet, this.config.tokenAddress, encodeFunctionData({ abi: uliqTokenAbi, functionName: "approve", args: [this.config.lockerAddress, amount] })),
      transaction: this.tx(wallet, this.config.lockerAddress, encodeFunctionData({ abi: uliqLockerAbi, functionName: "lock", args: [amount, BigInt(days) * 86400n] }))
    };
  }

  async preparePosition(userId: string, rawId: string, contractAddress: string, newUnlockAt?: string) {
    if (contractAddress.toLowerCase() !== this.config.lockerAddress.toLowerCase()) throw new Error("invalid_locker_contract_address");
    if (newUnlockAt !== undefined && !getUliqMainnetLockingFlags().extensionsEnabled) throw new Error("uliq_mainnet_locking_extensions_disabled");
    const wallet = await this.wallet(userId);
    const id = parseUint256Decimal(rawId, "lock_id");
    await this.ready();
    const head = await getConsistentFinalizedBlock(this.rpc);
    const [owner, , , expiry, withdrawn] = await readMainnetLockingPair(this.rpc, (client) => client.readContract({ address: this.config.lockerAddress, abi: uliqLockerAbi, functionName: "locks", args: [id], blockNumber: head.number }));
    if (owner.toLowerCase() !== wallet.toLowerCase()) throw new Error("lock_wallet_mismatch");
    if (withdrawn) throw new Error("lock_already_withdrawn");
    if (newUnlockAt !== undefined) {
      const next = parseUint256Decimal(newUnlockAt, "new_unlock_at");
      if (next > (1n << 64n) - 1n) throw new Error("invalid_lock_extension_timestamp");
      if (next <= BigInt(expiry)) throw new Error("lock_expiry_not_increasing");
      return this.tx(wallet, this.config.lockerAddress, encodeFunctionData({ abi: uliqLockerAbi, functionName: "extendLock", args: [id, next] }));
    }
    if (BigInt(expiry) > head.timestamp) throw new Error("lock_still_active");
    return this.tx(wallet, this.config.lockerAddress, encodeFunctionData({ abi: uliqLockerAbi, functionName: "unlock", args: [id] }));
  }
}
