import type { Hex } from "viem";

export type DexLaunchConfirmationStatus =
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "SOFT_CONFIRMED"
  | "SAFE"
  | "FINALIZED"
  | "FAILED"
  | "REORGED";

export type DexLaunchTracking = {
  chainId: number;
  contractAddress: `0x${string}`;
  transactionHash: Hex;
  dexLaunchTimestamp: string;
  confirmationStatus: DexLaunchConfirmationStatus;
  receiptBlockNumber: string | null;
  submittedAt: string;
  updatedAt: string;
};

export function deriveDexLaunchConfirmationStatus(input: {
  receiptStatus: "success" | "reverted";
  receiptBlockNumber: bigint;
  receiptBlockHash: string;
  canonicalBlockHash: string;
  safeBlockNumber: bigint;
  finalizedBlockNumber: bigint;
}): DexLaunchConfirmationStatus {
  if (input.receiptStatus !== "success") return "FAILED";
  if (input.receiptBlockHash.toLowerCase() !== input.canonicalBlockHash.toLowerCase()) return "REORGED";
  if (input.finalizedBlockNumber >= input.receiptBlockNumber) return "FINALIZED";
  if (input.safeBlockNumber >= input.receiptBlockNumber) return "SAFE";
  return "SOFT_CONFIRMED";
}

export function isDexLaunchTracking(value: unknown): value is DexLaunchTracking {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DexLaunchTracking>;
  return Number.isSafeInteger(candidate.chainId)
    && typeof candidate.contractAddress === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(candidate.contractAddress)
    && typeof candidate.transactionHash === "string"
    && /^0x[0-9a-fA-F]{64}$/.test(candidate.transactionHash)
    && typeof candidate.dexLaunchTimestamp === "string"
    && /^\d+$/.test(candidate.dexLaunchTimestamp)
    && ["AWAITING_SIGNATURE", "SUBMITTED", "SOFT_CONFIRMED", "SAFE", "FINALIZED", "FAILED", "REORGED"].includes(String(candidate.confirmationStatus))
    && (candidate.receiptBlockNumber === null || (typeof candidate.receiptBlockNumber === "string" && /^\d+$/.test(candidate.receiptBlockNumber)))
    && typeof candidate.submittedAt === "string"
    && typeof candidate.updatedAt === "string";
}
