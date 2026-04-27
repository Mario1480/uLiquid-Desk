export type BotVaultViewState = {
  id?: string;
  botId?: string;
  userId?: string;
  vaultModel?: string | null;
  contractVersion?: string | null;
  beneficiaryAddress?: string | null;
  // Controller contract/operator address for lifecycle actions.
  controllerAddress?: string | null;
  // Legacy response alias for the onchain BotVault contract address.
  vaultAddress?: string | null;
  // Canonical onchain BotVault contract address.
  onchainBotVaultAddress?: string | null;
  // Legacy alias for the strategy/execution agent wallet.
  agentWallet?: string | null;
  // Explicit strategy/execution agent wallet address.
  agentWalletAddress?: string | null;
  agentWalletVersion?: number;
  agentSecretRef?: string | null;
  allocatedUsd?: number | null;
  availableUsd?: number | null;
  withdrawnUsd?: number | null;
  claimedProfitUsd?: number | null;
  feePaidTotal?: number | null;
  profitShareAccruedUsd?: number | null;
  fundingStatus?: string | null;
  hypercoreFundingStatus?: string | null;
  hasOnchainVault?: boolean;
  fundingConfirmedOnchain?: boolean;
  canClaim?: boolean;
  canClose?: boolean;
  canRecover?: boolean;
  canSetAgentWallet?: boolean;
  executionStatus?: string | null;
  status?: string | null;
  claimableProfitUsd?: number | null;
  feeConfigSummary?: {
    platformFeeRatePct: number;
    affiliateFeeRatePct: number;
    totalFeeRatePct: number;
    affiliateUserId: string | null;
    affiliateRecipientAddress: string | null;
    feeConfigLockedAt: string;
  } | null;
  endedAt?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(Number(value));
}

function pickString(next: unknown, prev: unknown): string | null {
  const nextValue = typeof next === "string" ? next : null;
  if (nextValue && nextValue.trim()) return nextValue;
  const prevValue = typeof prev === "string" ? prev : null;
  return prevValue && prevValue.trim() ? prevValue : null;
}

function pickNullableString(next: unknown, prev: unknown): string | null {
  if (next === null) {
    const prevValue = typeof prev === "string" ? prev : null;
    return prevValue && prevValue.trim() ? prevValue : null;
  }
  return pickString(next, prev);
}

function pickNumber(next: unknown, prev: unknown): number | null {
  if (isFiniteNumber(next)) return Number(next);
  if (isFiniteNumber(prev)) return Number(prev);
  return null;
}

function pickBoolean(next: unknown, prev: unknown): boolean | undefined {
  if (typeof next === "boolean") return next;
  if (typeof prev === "boolean") return prev;
  return undefined;
}

export function mergeStableBotVaultState(
  prev: BotVaultViewState | null,
  next: BotVaultViewState | null | undefined
): BotVaultViewState | null {
  if (!next) return prev;
  if (!prev) return next;
  return {
    id: pickString(next.id, prev.id) ?? undefined,
    botId: pickString(next.botId, prev.botId) ?? undefined,
    userId: pickString(next.userId, prev.userId) ?? undefined,
    vaultModel: pickNullableString(next.vaultModel, prev.vaultModel),
    contractVersion: pickNullableString(next.contractVersion, prev.contractVersion),
    beneficiaryAddress: pickNullableString(next.beneficiaryAddress, prev.beneficiaryAddress),
    controllerAddress: pickNullableString(next.controllerAddress, prev.controllerAddress),
    vaultAddress: pickNullableString(next.vaultAddress ?? next.onchainBotVaultAddress, prev.vaultAddress ?? prev.onchainBotVaultAddress),
    onchainBotVaultAddress: pickNullableString(next.onchainBotVaultAddress ?? next.vaultAddress, prev.onchainBotVaultAddress ?? prev.vaultAddress),
    agentWallet: pickNullableString(next.agentWallet ?? next.agentWalletAddress, prev.agentWallet ?? prev.agentWalletAddress),
    agentWalletAddress: pickNullableString(next.agentWalletAddress ?? next.agentWallet, prev.agentWalletAddress ?? prev.agentWallet),
    agentWalletVersion: pickNumber(next.agentWalletVersion, prev.agentWalletVersion) ?? undefined,
    agentSecretRef: pickNullableString(next.agentSecretRef, prev.agentSecretRef),
    allocatedUsd: pickNumber(next.allocatedUsd, prev.allocatedUsd),
    availableUsd: pickNumber(next.availableUsd, prev.availableUsd),
    withdrawnUsd: pickNumber(next.withdrawnUsd, prev.withdrawnUsd),
    claimedProfitUsd: pickNumber(next.claimedProfitUsd, prev.claimedProfitUsd),
    feePaidTotal: pickNumber(next.feePaidTotal, prev.feePaidTotal),
    profitShareAccruedUsd: pickNumber(next.profitShareAccruedUsd, prev.profitShareAccruedUsd),
    fundingStatus: pickNullableString(next.fundingStatus, prev.fundingStatus),
    hypercoreFundingStatus: pickNullableString(next.hypercoreFundingStatus, prev.hypercoreFundingStatus),
    hasOnchainVault: pickBoolean(next.hasOnchainVault, prev.hasOnchainVault),
    fundingConfirmedOnchain: pickBoolean(next.fundingConfirmedOnchain, prev.fundingConfirmedOnchain),
    canClaim: pickBoolean(next.canClaim, prev.canClaim),
    canClose: pickBoolean(next.canClose, prev.canClose),
    canRecover: pickBoolean(next.canRecover, prev.canRecover),
    canSetAgentWallet: pickBoolean(next.canSetAgentWallet, prev.canSetAgentWallet),
    executionStatus: pickNullableString(next.executionStatus, prev.executionStatus),
    status: pickNullableString(next.status, prev.status),
    claimableProfitUsd: pickNumber(next.claimableProfitUsd, prev.claimableProfitUsd),
    feeConfigSummary:
      next.feeConfigSummary && typeof next.feeConfigSummary === "object"
        ? next.feeConfigSummary
        : prev.feeConfigSummary ?? null,
    endedAt: pickNullableString(next.endedAt, prev.endedAt),
    closedAt: pickNullableString(next.closedAt, prev.closedAt),
    createdAt: pickNullableString(next.createdAt, prev.createdAt),
    updatedAt: pickNullableString(next.updatedAt, prev.updatedAt)
  };
}

export function deriveStableBotVaultCapabilities(
  vault: BotVaultViewState | null | undefined
): {
  hasOnchainVault: boolean;
  fundingConfirmedOnchain: boolean;
  canClaim: boolean;
  canClose: boolean;
  canRecover: boolean;
  canSetAgentWallet: boolean;
} {
  const status = String(vault?.status ?? "").trim().toUpperCase();
  const fundingStatus = String(vault?.fundingStatus ?? "").trim().toLowerCase();
  const hypercoreFundingStatus = String(vault?.hypercoreFundingStatus ?? "").trim().toLowerCase();
  const claimableProfitUsd = Number(vault?.claimableProfitUsd ?? 0);
  const allocatedUsd = Number(vault?.allocatedUsd ?? 0);
  const onchainBotVaultAddress = typeof vault?.onchainBotVaultAddress === "string" && vault.onchainBotVaultAddress.trim()
    ? vault.onchainBotVaultAddress
    : vault?.vaultAddress;
  const hasOnchainVault = typeof vault?.hasOnchainVault === "boolean"
    ? vault.hasOnchainVault
    : Boolean(typeof onchainBotVaultAddress === "string" && onchainBotVaultAddress.trim());
  const hyperEvmFundingConfirmed =
    fundingStatus === "hyper_evm_confirmed_onchain"
    || fundingStatus === "hyper_evm_funded";
  const fundingConfirmedOnchain = typeof vault?.fundingConfirmedOnchain === "boolean"
    ? vault.fundingConfirmedOnchain
    : (
      allocatedUsd > 0
      || hyperEvmFundingConfirmed
      || fundingStatus === "settled"
      || hypercoreFundingStatus === "pending"
      || hypercoreFundingStatus === "funded"
      || hypercoreFundingStatus === "withdrawn"
    );

  return {
    hasOnchainVault,
    fundingConfirmedOnchain,
    canClaim: typeof vault?.canClaim === "boolean"
      ? vault.canClaim
      : hasOnchainVault && status !== "CLOSED" && Number.isFinite(claimableProfitUsd) && claimableProfitUsd > 0.000001,
    canClose: typeof vault?.canClose === "boolean"
      ? vault.canClose
      : hasOnchainVault && (status === "FUNDED" || status === "ACTIVE" || status === "PAUSED" || status === "CLOSE_ONLY"),
    canRecover: typeof vault?.canRecover === "boolean"
      ? vault.canRecover
      : hasOnchainVault && fundingConfirmedOnchain && status === "CLOSED",
    canSetAgentWallet: typeof vault?.canSetAgentWallet === "boolean" ? vault.canSetAgentWallet : true
  };
}
