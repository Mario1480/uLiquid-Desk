import type { Hex } from "viem";

export type PendingClaimTransaction = {
  chainId: number;
  contractAddress: `0x${string}`;
  walletAddress: `0x${string}`;
  transactionHash: Hex;
  releasedRawBefore: string;
  submittedAt: string;
};

export function isPendingClaimTransaction(value: unknown): value is PendingClaimTransaction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingClaimTransaction>;
  return Number.isSafeInteger(candidate.chainId)
    && Number(candidate.chainId) > 0
    && typeof candidate.contractAddress === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(candidate.contractAddress)
    && typeof candidate.walletAddress === "string"
    && /^0x[0-9a-fA-F]{40}$/.test(candidate.walletAddress)
    && typeof candidate.transactionHash === "string"
    && /^0x[0-9a-fA-F]{64}$/.test(candidate.transactionHash)
    && typeof candidate.releasedRawBefore === "string"
    && /^\d+$/.test(candidate.releasedRawBefore)
    && typeof candidate.submittedAt === "string"
    && Number.isFinite(Date.parse(candidate.submittedAt));
}

export function pendingClaimMatchesWallet(
  pending: PendingClaimTransaction | null,
  chainId: number | undefined,
  walletAddress: string | undefined
): pending is PendingClaimTransaction {
  return Boolean(
    pending
      && chainId === pending.chainId
      && walletAddress
      && walletAddress.toLowerCase() === pending.walletAddress.toLowerCase()
  );
}

export function finalizedClaimAmountRaw(
  pending: PendingClaimTransaction,
  releasedRaw: string
): string | null {
  if (!/^\d+$/.test(releasedRaw)) return null;
  const releasedBefore = BigInt(pending.releasedRawBefore);
  const releasedNow = BigInt(releasedRaw);
  return releasedNow > releasedBefore ? (releasedNow - releasedBefore).toString() : null;
}
