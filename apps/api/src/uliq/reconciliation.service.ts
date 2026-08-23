import { uliqLockerAbi, uliqPaymentCustodyAbi, uliqPresaleAbi, uliqTokenAbi, uliqVestingAbi } from "./abi.js";
import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, withUliqRpcFailover, type UliqRpcPair } from "./rpc.js";
import { parseDatabaseUint256Decimal } from "./uint256.js";

type Mismatch = {
  scope: string;
  walletAddress?: string;
  field: string;
  onchain: string;
  projected: string;
};

async function upsertMismatchAlert(db: any, mismatchCount: number, details: Mismatch[], now: Date) {
  const existing = await db.platformAlert.findFirst({
    where: { source: "uliq_reconciliation", type: "uliq_state_mismatch", status: { in: ["open", "acknowledged"] } },
    orderBy: { createdAt: "desc" }
  });
  if (mismatchCount === 0) {
    if (existing) {
      await db.platformAlert.update({ where: { id: existing.id }, data: { status: "resolved", resolvedAt: now } });
    }
    return;
  }
  const data = {
    severity: "critical",
    status: "open",
    type: "uliq_state_mismatch",
    source: "uliq_reconciliation",
    title: "ULIQ onchain reconciliation mismatch",
    message: `${mismatchCount} ULIQ projection mismatch(es) require replay or manual review.`,
    metadata: { mismatchCount, details: details.slice(0, 100), observedAt: now.toISOString() }
  };
  if (existing) await db.platformAlert.update({ where: { id: existing.id }, data });
  else await db.platformAlert.create({ data });
}

export class UliqReconciliationService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async runOnce(now = new Date(), limit = 250): Promise<{ status: "OK" | "MISMATCH"; mismatchCount: number; asOfBlock: string }> {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const run = await this.db.uliqReconciliationRun.create({
      data: {
        chainId: this.config.chainId,
        scope: "uliq_mvp",
        asOfBlock: head.number,
        blockHash: head.hash,
        status: "OK",
        mismatchCount: 0,
        startedAt: now
      }
    });
    const mismatches: Mismatch[] = [];
    try {
      const users = await this.db.user.findMany({
        where: { walletAddress: { not: null } },
        select: { id: true, walletAddress: true },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(1_000, limit))
      });
      for (const user of users) {
        const walletAddress = String(user.walletAddress).toLowerCase() as `0x${string}`;
        const [onchain, vesting, locks] = await Promise.all([
          withUliqRpcFailover(this.rpc, async (client) => {
            const [walletRaw, vestingRaw, lockedRaw] = await Promise.all([
              client.readContract({ address: this.config.contracts.token, abi: uliqTokenAbi, functionName: "balanceOf", args: [walletAddress], blockNumber: head.number }),
              client.readContract({ address: this.config.contracts.vesting, abi: uliqVestingAbi, functionName: "unreleased", args: [walletAddress], blockNumber: head.number }),
              client.readContract({ address: this.config.contracts.locker, abi: uliqLockerAbi, functionName: "lockedBalanceOf", args: [walletAddress], blockNumber: head.number })
            ]);
            return { walletRaw: BigInt(walletRaw), vestingRaw: BigInt(vestingRaw), lockedRaw: BigInt(lockedRaw) };
          }),
          this.db.uliqVestingPosition.findUnique({
            where: {
              chainId_contractAddress_walletAddress: {
                chainId: this.config.chainId,
                contractAddress: this.config.contracts.vesting.toLowerCase(),
                walletAddress
              }
            }
          }),
          this.db.uliqLockPosition.aggregate({
            where: {
              chainId: this.config.chainId,
              contractAddress: this.config.contracts.locker.toLowerCase(),
              walletAddress,
              status: { in: ["ACTIVE", "MATURED"] }
            },
            _sum: { amountRaw: true }
          })
        ]);
        const projectedVesting = vesting
          ? parseDatabaseUint256Decimal(vesting.allocatedRaw, "vesting_allocated_raw")
            - parseDatabaseUint256Decimal(vesting.releasedRaw, "vesting_released_raw")
          : 0n;
        const projectedLocked = parseDatabaseUint256Decimal(locks?._sum?.amountRaw ?? "0", "locked_amount_raw");
        if (onchain.value.vestingRaw !== projectedVesting) {
          mismatches.push({ scope: "wallet", walletAddress, field: "vestingRaw", onchain: onchain.value.vestingRaw.toString(), projected: projectedVesting.toString() });
        }
        if (onchain.value.lockedRaw !== projectedLocked) {
          mismatches.push({ scope: "wallet", walletAddress, field: "lockedRaw", onchain: onchain.value.lockedRaw.toString(), projected: projectedLocked.toString() });
        }
      }

      const [pendingOnchain, pendingProjected] = await Promise.all([
        withUliqRpcFailover(this.rpc, (client) => client.readContract({
          address: this.config.contracts.presale,
          abi: uliqPresaleAbi,
          functionName: "pendingPurchaseCount",
          blockNumber: head.number
        })),
        this.db.uliqPresalePurchase.count({
          where: { chainId: this.config.chainId, presaleContractAddress: this.config.contracts.presale.toLowerCase(), status: "PENDING_WITHDRAWAL" }
        })
      ]);
      if (BigInt(pendingOnchain.value) !== BigInt(pendingProjected)) {
        mismatches.push({ scope: "presale", field: "pendingPurchaseCount", onchain: BigInt(pendingOnchain.value).toString(), projected: String(pendingProjected) });
      }

      const [custodyOnchain, pendingUsdcProjected, releasedUsdcProjected] = await Promise.all([
        withUliqRpcFailover(this.rpc, async (client) => {
          const [balance, totalCollected, totalRefunded, totalReleased] = await Promise.all([
            client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "balance", blockNumber: head.number }),
            client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalCollected", blockNumber: head.number }),
            client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalRefunded", blockNumber: head.number }),
            client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalReleased", blockNumber: head.number })
          ]);
          return {
            balance: BigInt(balance),
            totalCollected: BigInt(totalCollected),
            totalRefunded: BigInt(totalRefunded),
            totalReleased: BigInt(totalReleased)
          };
        }),
        this.db.uliqPresalePurchase.aggregate({
          where: { chainId: this.config.chainId, presaleContractAddress: this.config.contracts.presale.toLowerCase(), status: "PENDING_WITHDRAWAL" },
          _sum: { usdcAmountRaw: true }
        }),
        this.db.uliqPresalePurchase.aggregate({
          where: { chainId: this.config.chainId, presaleContractAddress: this.config.contracts.presale.toLowerCase(), status: "FINALIZED" },
          _sum: { treasuryReleasedUsdcRaw: true }
        })
      ]);
      const custody = custodyOnchain.value;
      const projectedPendingUsdc = parseDatabaseUint256Decimal(pendingUsdcProjected?._sum?.usdcAmountRaw ?? "0", "pending_usdc_raw");
      const projectedReleasedUsdc = parseDatabaseUint256Decimal(releasedUsdcProjected?._sum?.treasuryReleasedUsdcRaw ?? "0", "released_usdc_raw");
      if (custody.totalCollected !== custody.balance + custody.totalRefunded + custody.totalReleased) {
        mismatches.push({
          scope: "payment_custody",
          field: "accountingIdentity",
          onchain: custody.totalCollected.toString(),
          projected: (custody.balance + custody.totalRefunded + custody.totalReleased).toString()
        });
      }
      if (custody.balance !== projectedPendingUsdc) {
        mismatches.push({ scope: "payment_custody", field: "pendingEscrowUsdcRaw", onchain: custody.balance.toString(), projected: projectedPendingUsdc.toString() });
      }
      if (custody.totalReleased !== projectedReleasedUsdc) {
        mismatches.push({ scope: "payment_custody", field: "treasuryReleasedUsdcRaw", onchain: custody.totalReleased.toString(), projected: projectedReleasedUsdc.toString() });
      }

      const status = mismatches.length === 0 ? "OK" : "MISMATCH";
      await this.db.uliqReconciliationRun.update({
        where: { id: run.id },
        data: { status, mismatchCount: mismatches.length, details: { mismatches }, finishedAt: new Date() }
      });
      await upsertMismatchAlert(this.db, mismatches.length, mismatches, new Date());
      return { status, mismatchCount: mismatches.length, asOfBlock: head.number.toString() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.db.uliqReconciliationRun.update({
        where: { id: run.id },
        data: { status: "FAILED", details: { reason }, finishedAt: new Date() }
      });
      throw error;
    }
  }
}
