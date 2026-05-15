"use client";

import { parseUnits } from "viem";
import type { Address, PublicClient, WalletClient } from "viem";
import { apiGet, apiPost } from "../api";
import type {
  RelayFundingDirection,
  RelayFundingQuote,
  RelayFundingQuoteLeg,
  RelayFundingStatus,
  RelayFundingStep
} from "./types";

export const RELAY_HYPE_TOPUP_THRESHOLD_RAW = parseUnits("0.02", 18);
export const RELAY_DEFAULT_HYPE_TOPUP_USDC = "5";

export class RelayFundingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type RelayExecutionPhase =
  | "idle"
  | "quoting"
  | "awaiting_signature"
  | "submitted"
  | "pending"
  | "confirmed"
  | "error";

export type RelayExecutionState = {
  phase: RelayExecutionPhase;
  message?: string;
  txHash?: string | null;
  code?: string;
};

type ValidateRelayFundingInput = {
  usdcAmount: string;
  includeHypeTopup: boolean;
  hypeTopupUsdcAmount: string;
  arbitrumUsdcRaw: string | null;
  arbitrumUsdcAvailable: boolean;
  arbitrumEthRaw: string | null;
  arbitrumEthAvailable: boolean;
  connectedChainId: number | null | undefined;
  expectedChainId: number;
};

type ValidateRelayWithdrawalInput = {
  usdcAmount: string;
  hyperEvmUsdcRaw: string | null;
  hyperEvmUsdcAvailable: boolean;
  hyperEvmHypeRaw: string | null;
  hyperEvmHypeAvailable: boolean;
  connectedChainId: number | null | undefined;
  expectedChainId: number;
};

type ExecuteRelayLegInput = {
  leg: RelayFundingQuoteLeg;
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: Address;
  onStepSubmitted?: (txHash: `0x${string}`, step: RelayFundingStep) => Promise<void> | void;
};

function normalizedAmount(value: string): string {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) throw new RelayFundingError("invalid_amount", "Enter a USDC amount.");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RelayFundingError("invalid_amount", "Enter an amount greater than zero.");
  }
  return raw;
}

function rawBalance(raw: string | null | undefined): bigint {
  try {
    return BigInt(raw ?? "0");
  } catch {
    return BigInt(0);
  }
}

export function shouldSuggestHypeTopup(hypeRaw: string | null | undefined): boolean {
  return rawBalance(hypeRaw) < RELAY_HYPE_TOPUP_THRESHOLD_RAW;
}

export function validateRelayFunding(input: ValidateRelayFundingInput): {
  usdcAmount: string;
  hypeTopupUsdcAmount: string;
  totalSourceRaw: bigint;
} {
  const usdcAmount = normalizedAmount(input.usdcAmount);
  const hypeTopupUsdcAmount = input.includeHypeTopup
    ? normalizedAmount(input.hypeTopupUsdcAmount || RELAY_DEFAULT_HYPE_TOPUP_USDC)
    : "0";
  const usdcRaw = parseUnits(usdcAmount, 6);
  const topupRaw = input.includeHypeTopup ? parseUnits(hypeTopupUsdcAmount, 6) : BigInt(0);
  const totalSourceRaw = usdcRaw + topupRaw;

  if (input.connectedChainId !== input.expectedChainId) {
    throw new RelayFundingError("wrong_chain", "Switch to Arbitrum to continue.");
  }
  if (!input.arbitrumUsdcAvailable) {
    throw new RelayFundingError("source_balance_unavailable", "Arbitrum USDC balance is unavailable.");
  }
  if (totalSourceRaw > rawBalance(input.arbitrumUsdcRaw)) {
    throw new RelayFundingError("insufficient_balance", "Insufficient Arbitrum USDC balance for the selected funding route.");
  }
  if (!input.arbitrumEthAvailable || rawBalance(input.arbitrumEthRaw) <= BigInt(0)) {
    throw new RelayFundingError("missing_gas_balance", "Arbitrum ETH gas balance is required.");
  }

  return {
    usdcAmount,
    hypeTopupUsdcAmount,
    totalSourceRaw
  };
}

export function validateRelayWithdrawal(input: ValidateRelayWithdrawalInput): {
  usdcAmount: string;
  totalSourceRaw: bigint;
} {
  const usdcAmount = normalizedAmount(input.usdcAmount);
  const totalSourceRaw = parseUnits(usdcAmount, 6);

  if (input.connectedChainId !== input.expectedChainId) {
    throw new RelayFundingError("wrong_chain", "Switch to HyperEVM to continue.");
  }
  if (!input.hyperEvmUsdcAvailable) {
    throw new RelayFundingError("source_balance_unavailable", "HyperEVM USDC balance is unavailable.");
  }
  if (totalSourceRaw > rawBalance(input.hyperEvmUsdcRaw)) {
    throw new RelayFundingError("insufficient_balance", "Insufficient HyperEVM USDC balance for the selected withdrawal route.");
  }
  if (!input.hyperEvmHypeAvailable || rawBalance(input.hyperEvmHypeRaw) <= BigInt(0)) {
    throw new RelayFundingError("missing_gas_balance", "HyperEVM HYPE gas balance is required.");
  }

  return {
    usdcAmount,
    totalSourceRaw
  };
}

export function getRelayQuote(address: string, input: {
  direction?: RelayFundingDirection;
  usdcAmount: string;
  includeHypeTopup: boolean;
  hypeTopupUsdcAmount: string;
}) {
  return apiPost<RelayFundingQuote>(`/funding/${address}/relay/quote`, input);
}

export function getRelayStatus(requestId: string) {
  return apiGet<RelayFundingStatus>(`/funding/relay/status?requestId=${encodeURIComponent(requestId)}`);
}

export async function executeRelayLeg(input: ExecuteRelayLegInput): Promise<{ txHash: `0x${string}` | null }> {
  let lastTxHash: `0x${string}` | null = null;
  for (const step of input.leg.steps) {
    for (const item of step.items) {
      const txHash = await input.walletClient.sendTransaction({
        account: input.address,
        to: item.tx.to,
        data: item.tx.data,
        value: BigInt(item.tx.value || "0"),
        chain: input.walletClient.chain ?? undefined
      } as any);
      lastTxHash = txHash;
      await input.onStepSubmitted?.(txHash, step);
      await input.publicClient.waitForTransactionReceipt({ hash: txHash });
    }
  }
  return { txHash: lastTxHash };
}

export async function pollRelayStatus(params: {
  requestId: string | null;
  attempts?: number;
  delayMs?: number;
}): Promise<RelayFundingStatus | null> {
  if (!params.requestId) return null;
  const attempts = Math.max(1, Math.trunc(params.attempts ?? 30));
  const delayMs = Math.max(250, Math.trunc(params.delayMs ?? 2_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getRelayStatus(params.requestId);
    if (status.status === "success" || status.status === "failed") return status;
    await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
  }
  return null;
}
