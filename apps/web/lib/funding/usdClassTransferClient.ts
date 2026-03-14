"use client";

import { HttpTransport } from "@nktkas/hyperliquid";
import { usdClassTransfer } from "@nktkas/hyperliquid/api/exchange";
import { parseUnits } from "viem";
import type { Address, WalletClient } from "viem";
import { createHyperliquidViemWalletAdapter } from "./hyperliquidViemWalletAdapter";

export class HyperliquidUsdClassTransferError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type UsdClassTransferExecutionState = {
  phase: "idle" | "awaiting_signature" | "submitted" | "pending" | "confirmed" | "error";
  message?: string;
  code?: string;
};

type ValidateUsdClassTransferInput = {
  amount: string;
  toPerp: boolean;
  spotBalanceRaw: string | null;
  spotBalanceAvailable: boolean;
  perpBalanceRaw: string | null;
  perpBalanceAvailable: boolean;
};

type SubmitUsdClassTransferInput = {
  amount: string;
  toPerp: boolean;
  walletClient: WalletClient;
  address: Address;
  hyperliquidExchangeUrl: string;
  signatureChainId: number;
};

type UsdClassTransferClientDeps = {
  submitTransfer: (input: SubmitUsdClassTransferInput) => Promise<void>;
};

function assertPositiveAmount(amount: string): string {
  const normalized = String(amount ?? "").trim();
  if (!normalized) {
    throw new HyperliquidUsdClassTransferError("invalid_amount", "Enter an amount.");
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HyperliquidUsdClassTransferError("invalid_amount", "Enter an amount greater than zero.");
  }
  return normalized;
}

function rawBalance(raw: string | null | undefined): bigint {
  try {
    return BigInt(raw ?? "0");
  } catch {
    return BigInt(0);
  }
}

export function validateUsdClassTransfer(input: ValidateUsdClassTransferInput): { normalizedAmount: string; amountRaw: bigint } {
  const normalizedAmount = assertPositiveAmount(input.amount);
  const amountRaw = parseUnits(normalizedAmount, 6);
  const sourceAvailable = input.toPerp ? input.spotBalanceAvailable : input.perpBalanceAvailable;
  const sourceRaw = input.toPerp ? input.spotBalanceRaw : input.perpBalanceRaw;
  const sourceLabel = input.toPerp ? "Hyperliquid spot wallet" : "Hyperliquid perps wallet";

  if (!sourceAvailable) {
    throw new HyperliquidUsdClassTransferError("source_balance_unavailable", `${sourceLabel} USDC balance is unavailable.`);
  }
  if (amountRaw > rawBalance(sourceRaw)) {
    throw new HyperliquidUsdClassTransferError("insufficient_balance", `Insufficient ${sourceLabel} USDC balance.`);
  }

  return { normalizedAmount, amountRaw };
}

async function defaultSubmitTransfer(input: SubmitUsdClassTransferInput): Promise<void> {
  const signatureChainId = `0x${input.signatureChainId.toString(16)}` as `0x${string}`;

  await usdClassTransfer(
    {
      transport: new HttpTransport({
        apiUrl: input.hyperliquidExchangeUrl,
        fetchOptions: {
          cache: "no-store"
        }
      }),
      signatureChainId,
      wallet: createHyperliquidViemWalletAdapter({
        walletClient: input.walletClient,
        address: input.address,
        chainId: input.signatureChainId
      })
    },
    {
      amount: input.amount,
      toPerp: input.toPerp
    }
  );
}

export function createUsdClassTransferClient(deps: Partial<UsdClassTransferClientDeps> = {}) {
  const resolvedDeps: UsdClassTransferClientDeps = {
    submitTransfer: deps.submitTransfer ?? defaultSubmitTransfer
  };

  return {
    async submitTransfer(input: SubmitUsdClassTransferInput): Promise<void> {
      const normalizedAmount = assertPositiveAmount(input.amount);
      await resolvedDeps.submitTransfer({
        ...input,
        amount: normalizedAmount
      });
    }
  };
}
