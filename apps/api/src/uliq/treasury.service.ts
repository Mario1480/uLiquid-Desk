import { encodeFunctionData, getAddress, isAddress, zeroAddress } from "viem";
import { uliqPaymentCustodyAbi, uliqPresaleAbi } from "./abi.js";
import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, withUliqRpcFailover, type UliqRpcPair } from "./rpc.js";
import { normalizeUliqAddress } from "./uint256.js";

export const GLOBAL_SETTING_ULIQ_TREASURY_KEY = "admin.uliqTreasury.v1";

export type UliqTreasurySyncStatus =
  | "missing"
  | "ready"
  | "proposal_required"
  | "acceptance_required"
  | "drifted"
  | "invalid";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeUliqTreasuryAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!isAddress(raw) || raw === zeroAddress) return null;
  return getAddress(raw);
}

function safeTransaction(
  chainId: number,
  to: `0x${string}`,
  data: `0x${string}`,
  expectedSender: string
) {
  return { chainId, to, data, value: "0", operation: 0, expectedSender };
}

export class UliqTreasuryService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig(),
    private readonly rpc: UliqRpcPair = createUliqRpcPair(config)
  ) {}

  async getState() {
    const [stored, head] = await Promise.all([
      this.db.globalSetting.findUnique({
        where: { key: GLOBAL_SETTING_ULIQ_TREASURY_KEY },
        select: { value: true, updatedAt: true }
      }),
      getConsistentFinalizedBlock(this.rpc)
    ]);
    const desiredTreasury = normalizeUliqTreasuryAddress(asRecord(stored?.value).desiredAddress);
    const read = await withUliqRpcFailover(this.rpc, async (client) => {
      const [
        owner,
        treasury,
        pendingTreasury,
        presale,
        paymentToken,
        balance,
        totalCollected,
        totalRefunded,
        totalReleased,
        configuredCustody
      ] = await Promise.all([
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "owner", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "treasury", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "pendingTreasury", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "presale", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "paymentToken", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "balance", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalCollected", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalRefunded", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.paymentCustody, abi: uliqPaymentCustodyAbi, functionName: "totalReleased", blockNumber: head.number }),
        client.readContract({ address: this.config.contracts.presale, abi: uliqPresaleAbi, functionName: "paymentCustody", blockNumber: head.number })
      ]);
      return {
        owner: normalizeUliqAddress(owner),
        treasury: normalizeUliqAddress(treasury),
        pendingTreasury: normalizeUliqAddress(pendingTreasury),
        presale: normalizeUliqAddress(presale),
        paymentToken: normalizeUliqAddress(paymentToken),
        balance: BigInt(balance as bigint),
        totalCollected: BigInt(totalCollected as bigint),
        totalRefunded: BigInt(totalRefunded as bigint),
        totalReleased: BigInt(totalReleased as bigint),
        configuredCustody: normalizeUliqAddress(configuredCustody)
      };
    });
    const onchain = read.value;
    const integrityValid =
      onchain.presale.toLowerCase() === this.config.contracts.presale.toLowerCase()
      && onchain.paymentToken.toLowerCase() === this.config.contracts.usdc.toLowerCase()
      && onchain.configuredCustody.toLowerCase() === this.config.contracts.paymentCustody.toLowerCase()
      && onchain.totalCollected === onchain.balance + onchain.totalRefunded + onchain.totalReleased;

    let syncStatus: UliqTreasurySyncStatus = "missing";
    if (!integrityValid) {
      syncStatus = "invalid";
    } else if (!desiredTreasury) {
      syncStatus = "missing";
    } else if (onchain.treasury.toLowerCase() === desiredTreasury.toLowerCase()) {
      syncStatus = onchain.pendingTreasury === zeroAddress ? "ready" : "drifted";
    } else if (onchain.pendingTreasury.toLowerCase() === desiredTreasury.toLowerCase()) {
      syncStatus = "acceptance_required";
    } else if (onchain.pendingTreasury !== zeroAddress) {
      syncStatus = "drifted";
    } else {
      syncStatus = "proposal_required";
    }

    return {
      desiredTreasury,
      desiredUpdatedAt: stored?.updatedAt instanceof Date ? stored.updatedAt.toISOString() : null,
      syncStatus,
      integrityStatus: integrityValid ? "healthy" : "invalid",
      custodyAddress: this.config.contracts.paymentCustody,
      owner: onchain.owner,
      activeTreasury: onchain.treasury,
      pendingTreasury: onchain.pendingTreasury === zeroAddress ? null : onchain.pendingTreasury,
      presaleAddress: onchain.presale,
      paymentTokenAddress: onchain.paymentToken,
      escrowBalanceUsdcRaw: onchain.balance.toString(),
      totalCollectedUsdcRaw: onchain.totalCollected.toString(),
      totalRefundedUsdcRaw: onchain.totalRefunded.toString(),
      totalReleasedUsdcRaw: onchain.totalReleased.toString(),
      asOfBlock: head.number.toString(),
      blockHash: head.hash,
      rpcSource: read.source
    };
  }

  async setDesiredTreasury(value: unknown) {
    const desiredAddress = normalizeUliqTreasuryAddress(value);
    if (!desiredAddress) throw new Error("invalid_uliq_treasury_address");
    await this.db.globalSetting.upsert({
      where: { key: GLOBAL_SETTING_ULIQ_TREASURY_KEY },
      create: { key: GLOBAL_SETTING_ULIQ_TREASURY_KEY, value: { desiredAddress } },
      update: { value: { desiredAddress } }
    });
    return this.getState();
  }

  async prepareProposal() {
    const state = await this.getState();
    if (!state.desiredTreasury) throw new Error("uliq_treasury_not_configured");
    if (state.integrityStatus !== "healthy") throw new Error("uliq_treasury_integrity_invalid");
    if (state.syncStatus === "ready") throw new Error("uliq_treasury_already_active");
    if (state.pendingTreasury) throw new Error("uliq_treasury_pending_proposal_exists");
    return {
      safeTransaction: safeTransaction(
        this.config.chainId,
        this.config.contracts.paymentCustody,
        encodeFunctionData({ abi: uliqPaymentCustodyAbi, functionName: "proposeTreasury", args: [state.desiredTreasury] }),
        state.owner
      ),
      preflight: state
    };
  }

  async prepareAcceptance() {
    const state = await this.getState();
    if (!state.desiredTreasury || !state.pendingTreasury) throw new Error("uliq_treasury_acceptance_not_ready");
    if (state.integrityStatus !== "healthy") throw new Error("uliq_treasury_integrity_invalid");
    if (state.pendingTreasury.toLowerCase() !== state.desiredTreasury.toLowerCase()) {
      throw new Error("uliq_treasury_pending_mismatch");
    }
    return {
      safeTransaction: safeTransaction(
        this.config.chainId,
        this.config.contracts.paymentCustody,
        encodeFunctionData({ abi: uliqPaymentCustodyAbi, functionName: "acceptTreasury" }),
        state.pendingTreasury
      ),
      preflight: state
    };
  }

  async prepareCancellation() {
    const state = await this.getState();
    if (!state.pendingTreasury) throw new Error("uliq_treasury_no_pending_proposal");
    if (state.integrityStatus !== "healthy") throw new Error("uliq_treasury_integrity_invalid");
    return {
      safeTransaction: safeTransaction(
        this.config.chainId,
        this.config.contracts.paymentCustody,
        encodeFunctionData({ abi: uliqPaymentCustodyAbi, functionName: "cancelTreasuryTransfer" }),
        state.owner
      ),
      preflight: state
    };
  }
}
