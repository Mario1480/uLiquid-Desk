import { encodeFunctionData, type PublicClient } from "viem";
import { uliqLockerAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, withUliqRpcFailover, type UliqRpcPair } from "./rpc.js";
import { normalizeUliqAddress, parseUint256Decimal } from "./uint256.js";

const SALE_STATES = [
  "DRAFT",
  "READY",
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "DEX_PENDING",
  "DEX_LAUNCHED",
  "COMPLETED",
  "CANCELLED"
] as const;

const PURCHASE_STATES = ["PENDING_WITHDRAWAL", "WITHDRAWN", "FINALIZED"] as const;
const LOCK_DURATIONS: Record<number, bigint> = {
  30: 30n * 24n * 60n * 60n,
  90: 90n * 24n * 60n * 60n,
  180: 180n * 24n * 60n * 60n
};

function timestamp(value: bigint): string | null {
  return value === 0n ? null : new Date(Number(value) * 1_000).toISOString();
}

function transactionRequest(chainId: number, to: `0x${string}`, data: `0x${string}`, expectedSender?: string) {
  return { chainId, to, data, value: "0", expectedSender: expectedSender ?? null };
}

async function readPresaleAtBlock(client: PublicClient, config: UliqRuntimeConfig, blockNumber: bigint) {
  const reads = await Promise.all([
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "state", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "saleStart", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "saleEnd", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "withdrawalPeriodSeconds", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "dexLaunchTimestamp", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "hardCapUsdcRaw", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "totalRaisedUsdcRaw", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "totalSoldUliqRaw", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "pendingAllocationUliqRaw", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "pendingPurchaseCount", blockNumber }),
    client.readContract({ address: config.contracts.presale, abi: uliqPresaleAbi, functionName: "maximumPurchasableUsdcRaw", blockNumber }),
    client.readContract({ address: config.contracts.token, abi: uliqTokenAbi, functionName: "balanceOf", args: [config.contracts.presale], blockNumber }),
    client.readContract({ address: config.contracts.token, abi: uliqTokenAbi, functionName: "balanceOf", args: [config.contracts.vesting], blockNumber })
  ]);
  return reads.map((value) => BigInt(value as bigint));
}

export class UliqPresaleService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async getOverview() {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => readPresaleAtBlock(client, this.config, head.number));
    const [state, saleStart, saleEnd, withdrawalPeriod, dexLaunch, hardCap, raised, sold, pendingRaw, pendingCount, maximum, presaleInventory, vestingInventory] = read.value;
    return {
      chainId: this.config.chainId,
      contractAddress: this.config.contracts.presale,
      tokenAddress: this.config.contracts.token,
      paymentTokenAddress: this.config.contracts.usdc,
      state: SALE_STATES[Number(state)] ?? "UNKNOWN",
      saleStart: timestamp(saleStart),
      saleEnd: timestamp(saleEnd),
      withdrawalPeriodSeconds: withdrawalPeriod.toString(),
      dexLaunchTimestamp: timestamp(dexLaunch),
      hardCapUsdcRaw: hardCap.toString(),
      totalRaisedUsdcRaw: raised.toString(),
      totalSoldUliqRaw: sold.toString(),
      pendingAllocationUliqRaw: pendingRaw.toString(),
      pendingPurchaseCount: pendingCount.toString(),
      maximumPurchasableUsdcRaw: maximum.toString(),
      presaleInventoryUliqRaw: presaleInventory.toString(),
      vestingInventoryUliqRaw: vestingInventory.toString(),
      referencePriceUsd: "0.001",
      asOfBlock: head.number.toString(),
      blockHash: head.hash,
      rpcSource: read.source,
      rpcHealth: {
        primary: "healthy",
        secondary: "healthy",
        finalizedHeadAgreement: true
      },
      legalStatus: "TESTNET_PROVISIONAL_ADR_001_BLOCKED"
    };
  }

  async getForUser(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    const walletAddress = String(user.walletAddress).toLowerCase();
    const purchases = await this.db.uliqPresalePurchase.findMany({
      where: { userId, walletAddress },
      orderBy: [{ purchaseBlockNumber: "desc" }, { logIndex: "desc" }]
    });
    return {
      walletAddress,
      purchases: purchases.map((row: any) => ({
        ...row,
        id: String(row.id),
        purchaseIdOnchain: String(row.purchaseIdOnchain),
        usdcAmountRaw: String(row.usdcAmountRaw),
        uliqAllocationRaw: String(row.uliqAllocationRaw),
        finalizationWalletRaw: String(row.finalizationWalletRaw),
        finalizationVestingRaw: String(row.finalizationVestingRaw),
        purchaseBlockNumber: BigInt(row.purchaseBlockNumber).toString()
      }))
    };
  }

  async quotePurchase(requestedUsdcRawInput: unknown) {
    const requestedUsdcRaw = parseUint256Decimal(requestedUsdcRawInput, "requested_usdc_raw");
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: this.config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "quotePurchase",
      args: [requestedUsdcRaw],
      blockNumber: head.number
    }));
    const [acceptedUsdcRaw, uliqAllocationRaw] = read.value;
    return {
      requestedUsdcRaw: requestedUsdcRaw.toString(),
      acceptedUsdcRaw: acceptedUsdcRaw.toString(),
      uliqAllocationRaw: uliqAllocationRaw.toString(),
      partialFill: acceptedUsdcRaw < requestedUsdcRaw,
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
  }

  async preparePurchase(params: { userId: string; maxUsdcAmountRaw: unknown; minUliqAllocationRaw: unknown }) {
    const wallet = await this.requireWallet(params.userId);
    const maxUsdcAmountRaw = parseUint256Decimal(params.maxUsdcAmountRaw, "max_usdc_amount_raw");
    const minUliqAllocationRaw = parseUint256Decimal(params.minUliqAllocationRaw, "min_uliq_allocation_raw");
    return {
      approval: transactionRequest(
        this.config.chainId,
        this.config.contracts.usdc,
        encodeFunctionData({
          abi: uliqTokenAbi,
          functionName: "approve",
          args: [this.config.contracts.presale, maxUsdcAmountRaw]
        }),
        wallet
      ),
      purchase: transactionRequest(
        this.config.chainId,
        this.config.contracts.presale,
        encodeFunctionData({
          abi: uliqPresaleAbi,
          functionName: "buy",
          args: [maxUsdcAmountRaw, minUliqAllocationRaw]
        }),
        wallet
      )
    };
  }

  async prepareWithdraw(userId: string, purchaseIdInput: unknown) {
    const wallet = await this.requireWallet(userId);
    const purchaseId = parseUint256Decimal(purchaseIdInput, "purchase_id");
    const purchase = await this.readPurchase(purchaseId);
    if (purchase.buyer.toLowerCase() !== wallet) throw new Error("purchase_wallet_mismatch");
    if (purchase.state !== "PENDING_WITHDRAWAL") throw new Error("purchase_not_pending");
    return transactionRequest(this.config.chainId, this.config.contracts.presale, encodeFunctionData({
      abi: uliqPresaleAbi,
      functionName: "withdrawPurchase",
      args: [purchaseId]
    }), wallet);
  }

  async prepareFinalize(purchaseIdInput: unknown) {
    const purchaseId = parseUint256Decimal(purchaseIdInput, "purchase_id");
    const purchase = await this.readPurchase(purchaseId);
    if (purchase.state !== "PENDING_WITHDRAWAL") throw new Error("purchase_not_pending");
    return transactionRequest(this.config.chainId, this.config.contracts.presale, encodeFunctionData({
      abi: uliqPresaleAbi,
      functionName: "finalizePurchase",
      args: [purchaseId]
    }));
  }

  async getVesting(userId: string) {
    const wallet = await this.requireWallet(userId);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, async (client) => Promise.all([
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "allocated", args: [wallet], blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "released", args: [wallet], blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "unreleased", args: [wallet], blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "vested", args: [wallet], blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "claimable", args: [wallet], blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "vestingStart", blockNumber: head.number }),
      client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "vestingEnd", blockNumber: head.number })
    ]));
    const values = read.value.map((value) => BigInt(value as bigint));
    return {
      walletAddress: wallet,
      allocatedRaw: values[0].toString(),
      releasedRaw: values[1].toString(),
      unreleasedRaw: values[2].toString(),
      vestedRaw: values[3].toString(),
      claimableRaw: values[4].toString(),
      vestingStart: timestamp(values[5]),
      vestingEnd: timestamp(values[6]),
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
  }

  async prepareVestingClaim(userId: string) {
    const wallet = await this.requireWallet(userId);
    return transactionRequest(this.config.chainId, this.config.contracts.vesting, encodeFunctionData({
      abi: uliqVestingAbi,
      functionName: "claim"
    }), wallet);
  }

  async getLocks(userId: string) {
    const wallet = await this.requireWallet(userId);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: this.config.contracts.locker,
      abi: uliqLockerAbi,
      functionName: "lockedBalanceOf",
      args: [wallet],
      blockNumber: head.number
    }));
    const positions = await this.db.uliqLockPosition.findMany({
      where: { chainId: this.config.chainId, walletAddress: wallet, status: { not: "ORPHANED" } },
      orderBy: [{ startAt: "desc" }, { id: "desc" }]
    });
    return {
      walletAddress: wallet,
      lockedBalanceRaw: BigInt(read.value).toString(),
      positions: positions.map((row: any) => ({
        ...row,
        lockIdOnchain: String(row.lockIdOnchain),
        amountRaw: String(row.amountRaw),
        asOfBlock: BigInt(row.asOfBlock).toString()
      })),
      supportedDurationsDays: [30, 90, 180],
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
  }

  async prepareLock(params: { userId: string; amountRaw: unknown; durationDays: number }) {
    const wallet = await this.requireWallet(params.userId);
    const amount = parseUint256Decimal(params.amountRaw, "amount_raw");
    const duration = LOCK_DURATIONS[params.durationDays];
    if (!duration) throw new Error("unsupported_lock_duration");
    return {
      approval: transactionRequest(this.config.chainId, this.config.contracts.token, encodeFunctionData({
        abi: uliqTokenAbi,
        functionName: "approve",
        args: [this.config.contracts.locker, amount]
      }), wallet),
      lock: transactionRequest(this.config.chainId, this.config.contracts.locker, encodeFunctionData({
        abi: uliqLockerAbi,
        functionName: "lock",
        args: [amount, duration]
      }), wallet)
    };
  }

  async prepareUnlock(params: { userId: string; lockId: unknown }) {
    const wallet = await this.requireWallet(params.userId);
    const lockId = parseUint256Decimal(params.lockId, "lock_id");
    return transactionRequest(this.config.chainId, this.config.contracts.locker, encodeFunctionData({
      abi: uliqLockerAbi,
      functionName: "unlock",
      args: [lockId]
    }), wallet);
  }

  async prepareDexLaunchTimestamp(value: unknown) {
    const timestampValue = parseUint256Decimal(value, "dex_launch_timestamp");
    if (timestampValue > (1n << 64n) - 1n) throw new Error("invalid_dex_launch_timestamp");
    const head = await getConsistentFinalizedBlock(this.rpc);
    if (timestampValue < head.timestamp) throw new Error("uliq_dex_launch_timestamp_in_past");
    const read = await withUliqRpcFailover(this.rpc, async (client) => {
      const [state, pendingPurchaseCount, owner] = await Promise.all([
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "state", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "pendingPurchaseCount", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "owner", blockNumber: head.number })
      ]);
      return { state: Number(state), pendingPurchaseCount: BigInt(pendingPurchaseCount), owner };
    });
    if (read.value.state !== 5) throw new Error("uliq_sale_not_dex_pending");
    if (read.value.pendingPurchaseCount !== 0n) throw new Error("uliq_pending_purchases_remain");
    return {
      safeTransaction: {
        ...transactionRequest(this.config.chainId, this.config.contracts.presale, encodeFunctionData({
          abi: uliqPresaleAbi,
          functionName: "setDexLaunchTimestamp",
          args: [timestampValue]
        }), read.value.owner),
        operation: 0
      },
      preflight: {
        owner: normalizeUliqAddress(read.value.owner),
        state: "DEX_PENDING",
        pendingPurchaseCount: "0",
        asOfBlock: head.number.toString(),
        blockHash: head.hash
      }
    };
  }

  private async requireWallet(userId: string): Promise<`0x${string}`> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    return normalizeUliqAddress(user.walletAddress).toLowerCase() as `0x${string}`;
  }

  private async readPurchase(purchaseId: bigint) {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: this.config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "purchases",
      args: [purchaseId],
      blockNumber: head.number
    }));
    const [buyer, usdcAmountRaw, uliqAllocationRaw, purchasedAt, withdrawalDeadline, state] = read.value;
    return {
      buyer,
      usdcAmountRaw: usdcAmountRaw.toString(),
      uliqAllocationRaw: uliqAllocationRaw.toString(),
      purchasedAt: timestamp(BigInt(purchasedAt)),
      withdrawalDeadline: timestamp(BigInt(withdrawalDeadline)),
      state: PURCHASE_STATES[Number(state)] ?? "UNKNOWN"
    };
  }
}
