import { encodeFunctionData, zeroAddress, type PublicClient } from "viem";
import { uliqLockerAbi, uliqPaymentCustodyAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import { getUliqLockerAddresses, getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import { mapUliqPurchaseTrackingForApi } from "./purchaseTracking.service.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, withUliqRpcFailover, type UliqRpcPair } from "./rpc.js";
import { databaseUint256Decimal, normalizeUliqAddress, parseUint256Decimal } from "./uint256.js";
import { addBillingMonths } from "../billing/termWindow.js";

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
export const ULIQ_LOCK_DURATIONS: Record<number, bigint> = {
  32: 32n * 24n * 60n * 60n,
  185: 185n * 24n * 60n * 60n,
  367: 367n * 24n * 60n * 60n
};
export const ULIQ_LOCK_TERMS = [
  { billingMonths: 1, durationDays: 32, label: "1_MONTH" },
  { billingMonths: 6, durationDays: 185, label: "6_MONTHS" },
  { billingMonths: 12, durationDays: 367, label: "12_MONTHS" }
] as const;

function timestamp(value: bigint): string | null {
  return value === 0n ? null : new Date(Number(value) * 1_000).toISOString();
}

function transactionRequest(chainId: number, to: `0x${string}`, data: `0x${string}`, expectedSender?: string) {
  return { chainId, to, data, value: "0", expectedSender: expectedSender ?? null };
}

function configuredLockerAddress(config: UliqRuntimeConfig, value: unknown): `0x${string}` {
  const requested = normalizeUliqAddress(value, "locker_contract_address");
  const configured = getUliqLockerAddresses(config).find((address) => (
    address.toLowerCase() === requested.toLowerCase()
  ));
  if (!configured) throw new Error("invalid_locker_contract_address");
  return configured;
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
    const [purchases, trackedPurchases] = await Promise.all([
      this.db.uliqPresalePurchase.findMany({
        where: { userId, walletAddress },
        orderBy: [{ purchaseBlockNumber: "desc" }, { logIndex: "desc" }]
      }),
      this.db.uliqPurchaseTracking.findMany({
        where: {
          userId,
          walletAddress,
          chainId: this.config.chainId,
          presaleContractAddress: this.config.contracts.presale.toLowerCase()
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: 50
      })
    ]);
    const canonicalTransactionHashes = new Set(purchases.map((row: any) => String(row.transactionHash).toLowerCase()));
    return {
      walletAddress,
      purchases: purchases.map((row: any) => ({
        ...row,
        id: String(row.id),
        purchaseIdOnchain: databaseUint256Decimal(row.purchaseIdOnchain, "purchase_id_onchain"),
        usdcAmountRaw: databaseUint256Decimal(row.usdcAmountRaw, "usdc_amount_raw"),
        uliqAllocationRaw: databaseUint256Decimal(row.uliqAllocationRaw, "uliq_allocation_raw"),
        finalizationWalletRaw: databaseUint256Decimal(row.finalizationWalletRaw, "finalization_wallet_raw"),
        finalizationVestingRaw: databaseUint256Decimal(row.finalizationVestingRaw, "finalization_vesting_raw"),
        treasuryReleasedUsdcRaw: databaseUint256Decimal(row.treasuryReleasedUsdcRaw, "treasury_released_usdc_raw"),
        purchaseBlockNumber: BigInt(row.purchaseBlockNumber).toString(),
        confirmationStatus: "FINALIZED"
      })),
      trackedPurchases: trackedPurchases
        .filter((row: any) => !canonicalTransactionHashes.has(String(row.transactionHash).toLowerCase()))
        .map(mapUliqPurchaseTrackingForApi)
    };
  }

  async quotePurchase(requestedUsdcRawInput: unknown) {
    const requestedUsdcRaw = parseUint256Decimal(requestedUsdcRawInput, "requested_usdc_raw");
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, async (client) => {
      const [state, quote] = await Promise.all([
        client.readContract({
          address: this.config.contracts.presale,
          abi: uliqPresaleAbi,
          functionName: "state",
          blockNumber: head.number
        }),
        client.readContract({
          address: this.config.contracts.presale,
          abi: uliqPresaleAbi,
          functionName: "quotePurchase",
          args: [requestedUsdcRaw],
          blockNumber: head.number
        })
      ]);
      return { state: Number(state), quote };
    });
    if (read.value.state !== 2) throw new Error("uliq_sale_not_active");
    const [acceptedUsdcRaw, uliqAllocationRaw] = read.value.quote;
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
    const paymentCustody = await this.requireActiveSale();
    return {
      approval: transactionRequest(
        this.config.chainId,
        this.config.contracts.usdc,
        encodeFunctionData({
          abi: uliqTokenAbi,
          functionName: "approve",
          args: [paymentCustody, maxUsdcAmountRaw]
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
    const lockerAddresses = getUliqLockerAddresses(this.config);
    const read = await withUliqRpcFailover(this.rpc, (client) => Promise.all(lockerAddresses.map((address) => (
      client.readContract({
        address,
        abi: uliqLockerAbi,
        functionName: "lockedBalanceOf",
        args: [wallet],
        blockNumber: head.number
      })
    ))));
    const positions = await this.db.uliqLockPosition.findMany({
      where: {
        chainId: this.config.chainId,
        contractAddress: { in: lockerAddresses.map((address) => address.toLowerCase()) },
        walletAddress: wallet,
        status: { not: "ORPHANED" }
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }]
    });
    const asOf = new Date(Number(head.timestamp) * 1_000);
    const coverageTerms = ULIQ_LOCK_TERMS.map((term) => ({
      ...term,
      requiredUntil: addBillingMonths(asOf, term.billingMonths).toISOString()
    }));
    return {
      walletAddress: wallet,
      activeLockerAddress: this.config.contracts.locker,
      legacyLockerAddresses: this.config.legacyLockers ?? [],
      lockedBalanceRaw: read.value.reduce((total, value) => total + BigInt(value), 0n).toString(),
      positions: positions.map((row: any) => {
        const unlockAt = row.unlockAt instanceof Date ? row.unlockAt : new Date(row.unlockAt);
        return {
          ...row,
          lockIdOnchain: databaseUint256Decimal(row.lockIdOnchain, "lock_id_onchain"),
          amountRaw: databaseUint256Decimal(row.amountRaw, "lock_amount_raw"),
          asOfBlock: BigInt(row.asOfBlock).toString(),
          remainingCoverageSeconds: Math.max(0, Math.floor((unlockAt.getTime() - asOf.getTime()) / 1_000)),
          qualifiesFor: Object.fromEntries(coverageTerms.map((term) => [
            String(term.billingMonths),
            unlockAt.getTime() >= new Date(term.requiredUntil).getTime()
          ]))
        };
      }),
      supportedDurations: ULIQ_LOCK_TERMS,
      supportedDurationsDays: ULIQ_LOCK_TERMS.map((term) => term.durationDays),
      coverageTerms,
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
  }

  async prepareLock(params: { userId: string; amountRaw: unknown; durationDays: number }) {
    const wallet = await this.requireWallet(params.userId);
    const amount = parseUint256Decimal(params.amountRaw, "amount_raw");
    const duration = ULIQ_LOCK_DURATIONS[params.durationDays];
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

  async prepareUnlock(params: { userId: string; lockId: unknown; contractAddress: unknown }) {
    const wallet = await this.requireWallet(params.userId);
    const lockId = parseUint256Decimal(params.lockId, "lock_id");
    const lockerAddress = configuredLockerAddress(this.config, params.contractAddress);
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: lockerAddress,
      abi: uliqLockerAbi,
      functionName: "locks",
      args: [lockId],
      blockNumber: head.number
    }));
    const [owner, , , , withdrawn] = read.value;
    if (String(owner).toLowerCase() !== wallet) throw new Error("lock_wallet_mismatch");
    if (Boolean(withdrawn)) throw new Error("lock_already_withdrawn");
    return transactionRequest(this.config.chainId, lockerAddress, encodeFunctionData({
      abi: uliqLockerAbi,
      functionName: "unlock",
      args: [lockId]
    }), wallet);
  }

  async prepareLockExtension(params: { userId: string; lockId: unknown; contractAddress: unknown; newUnlockAt: unknown }) {
    const wallet = await this.requireWallet(params.userId);
    const lockId = parseUint256Decimal(params.lockId, "lock_id");
    const lockerAddress = configuredLockerAddress(this.config, params.contractAddress);
    const newUnlockAt = parseUint256Decimal(params.newUnlockAt, "new_unlock_at");
    if (newUnlockAt > (1n << 64n) - 1n) throw new Error("invalid_lock_extension_timestamp");
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, (client) => client.readContract({
      address: lockerAddress,
      abi: uliqLockerAbi,
      functionName: "locks",
      args: [lockId],
      blockNumber: head.number
    }));
    const [owner, , , currentUnlockAt, withdrawn] = read.value;
    if (String(owner).toLowerCase() !== wallet) throw new Error("lock_wallet_mismatch");
    if (Boolean(withdrawn)) throw new Error("lock_already_withdrawn");
    if (newUnlockAt <= BigInt(currentUnlockAt)) throw new Error("lock_expiry_not_increasing");
    return {
      transaction: transactionRequest(this.config.chainId, lockerAddress, encodeFunctionData({
        abi: uliqLockerAbi,
        functionName: "extendLock",
        args: [lockId, newUnlockAt]
      }), wallet),
      previousUnlockAt: timestamp(BigInt(currentUnlockAt)),
      newUnlockAt: timestamp(newUnlockAt),
      asOfBlock: head.number.toString(),
      blockHash: head.hash
    };
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

  async prepareMarkDexPending() {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, async (client) => {
      const [
        state,
        pendingPurchaseCount,
        owner,
        paymentCustody,
        treasury,
        finalizedAllocationUliqRaw,
        allocationCapUliqRaw,
        presaleInventoryUliqRaw
      ] = await Promise.all([
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "state", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "pendingPurchaseCount", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "owner", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "paymentCustody", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "treasury", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "finalizedAllocationUliqRaw", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "allocationCapUliqRaw", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.token, abi: uliqTokenAbi, functionName: "balanceOf", args: [this.config.contracts.presale], blockNumber: head.number })
      ]);
      return {
        state: Number(state),
        pendingPurchaseCount: BigInt(pendingPurchaseCount as bigint),
        owner: normalizeUliqAddress(owner),
        paymentCustody: normalizeUliqAddress(paymentCustody),
        treasury: normalizeUliqAddress(treasury),
        finalizedAllocationUliqRaw: BigInt(finalizedAllocationUliqRaw as bigint),
        allocationCapUliqRaw: BigInt(allocationCapUliqRaw as bigint),
        presaleInventoryUliqRaw: BigInt(presaleInventoryUliqRaw as bigint)
      };
    });
    if (read.value.state !== 4) throw new Error("uliq_sale_not_ended");
    if (read.value.pendingPurchaseCount !== 0n) throw new Error("uliq_pending_purchases_remain");
    if (read.value.paymentCustody.toLowerCase() !== this.config.contracts.paymentCustody.toLowerCase()) {
      throw new Error("uliq_payment_custody_mismatch");
    }
    if (read.value.treasury === zeroAddress) throw new Error("uliq_treasury_zero_address");
    if (read.value.finalizedAllocationUliqRaw > read.value.allocationCapUliqRaw) {
      throw new Error("uliq_allocation_invalid");
    }
    const unsoldUliqRaw = read.value.allocationCapUliqRaw - read.value.finalizedAllocationUliqRaw;
    if (read.value.presaleInventoryUliqRaw < unsoldUliqRaw) {
      throw new Error("uliq_presale_inventory_insufficient");
    }

    const simulation = await withUliqRpcFailover(this.rpc, (client) => client.simulateContract({
      address: this.config.contracts.presale,
      abi: uliqPresaleAbi,
      functionName: "markDexPending",
      account: read.value.owner,
      blockNumber: head.number
    }));

    return {
      safeTransaction: {
        ...transactionRequest(this.config.chainId, this.config.contracts.presale, encodeFunctionData({
          abi: uliqPresaleAbi,
          functionName: "markDexPending"
        }), read.value.owner),
        operation: 0
      },
      preflight: {
        owner: read.value.owner,
        state: "ENDED",
        pendingPurchaseCount: "0",
        paymentCustody: read.value.paymentCustody,
        treasury: read.value.treasury,
        finalizedAllocationUliqRaw: read.value.finalizedAllocationUliqRaw.toString(),
        allocationCapUliqRaw: read.value.allocationCapUliqRaw.toString(),
        unsoldUliqRaw: unsoldUliqRaw.toString(),
        presaleInventoryUliqRaw: read.value.presaleInventoryUliqRaw.toString(),
        simulation: "success",
        asOfBlock: head.number.toString(),
        blockHash: head.hash,
        rpcSource: read.source,
        simulationRpcSource: simulation.source
      }
    };
  }

  private async requireWallet(userId: string): Promise<`0x${string}`> {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    return normalizeUliqAddress(user.walletAddress).toLowerCase() as `0x${string}`;
  }

  private async requireActiveSale(): Promise<`0x${string}`> {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const read = await withUliqRpcFailover(this.rpc, async (client) => {
      const [state, paymentCustody] = await Promise.all([
        client.readContract({
          address: this.config.contracts.presale,
          abi: uliqPresaleAbi,
          functionName: "state",
          blockNumber: head.number
        }),
        client.readContract({
          address: this.config.contracts.presale,
          abi: uliqPresaleAbi,
          functionName: "paymentCustody",
          blockNumber: head.number
        })
      ]);
      return { state: Number(state), paymentCustody };
    });
    if (read.value.state !== 2) throw new Error("uliq_sale_not_active");
    return normalizeUliqAddress(read.value.paymentCustody, "payment_custody");
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
