"use client";

import { HttpTransport } from "@nktkas/hyperliquid";
import { withdraw3 } from "@nktkas/hyperliquid/api/exchange";
import { erc20Abi, isAddress, parseUnits } from "viem";
import type { Address, PublicClient, WalletClient } from "viem";

export class FundingBridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type BridgeExecutionState = {
  phase: "idle" | "awaiting_signature" | "submitted" | "pending" | "confirmed" | "error";
  message?: string;
  txHash?: string | null;
  code?: string;
};

type DepositValidationInput = {
  amount: string;
  minDepositUsdc: number;
  sourceBalanceRaw: string | null;
  sourceBalanceAvailable: boolean;
  gasBalanceRaw: string | null;
  gasAvailable: boolean;
  connectedChainId: number | null | undefined;
  expectedChainId: number;
};

type WithdrawValidationInput = {
  amount: string;
  feeUsdc: number;
  sourceBalanceRaw: string | null;
  sourceBalanceAvailable: boolean;
  destination: string;
};

type SubmitDepositInput = {
  amount: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: Address;
  usdcAddress: Address;
  bridgeContractAddress: Address;
};

type SubmitWithdrawInput = {
  amount: string;
  destination: Address;
  walletClient: WalletClient;
  address: Address;
  hyperliquidExchangeUrl: string;
};

type BridgeClientDeps = {
  submitDeposit: (input: SubmitDepositInput) => Promise<`0x${string}`>;
  submitWithdraw: (input: SubmitWithdrawInput) => Promise<void>;
  waitForReceipt: (input: { publicClient: PublicClient; hash: `0x${string}` }) => Promise<void>;
};

function assertPositiveAmount(amount: string): string {
  const normalized = String(amount ?? "").trim();
  if (!normalized) throw new FundingBridgeError("invalid_amount", "Enter an amount.");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new FundingBridgeError("invalid_amount", "Enter an amount greater than zero.");
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

export function validateBridgeDeposit(input: DepositValidationInput): { normalizedAmount: string; amountRaw: bigint } {
  const normalizedAmount = assertPositiveAmount(input.amount);
  const amountRaw = parseUnits(normalizedAmount, 6);

  if (input.connectedChainId !== input.expectedChainId) {
    throw new FundingBridgeError("wrong_chain", "Switch to Arbitrum to continue.");
  }
  if (!input.sourceBalanceAvailable) {
    throw new FundingBridgeError("source_balance_unavailable", "Arbitrum USDC balance is unavailable.");
  }
  if (Number(normalizedAmount) < Number(input.minDepositUsdc)) {
    throw new FundingBridgeError(
      "min_deposit_not_met",
      `Minimum deposit is ${Number(input.minDepositUsdc).toFixed(0)} USDC.`
    );
  }
  if (amountRaw > rawBalance(input.sourceBalanceRaw)) {
    throw new FundingBridgeError("insufficient_balance", "Insufficient Arbitrum USDC balance.");
  }
  if (!input.gasAvailable || rawBalance(input.gasBalanceRaw) <= BigInt(0)) {
    throw new FundingBridgeError("missing_gas_balance", "Arbitrum ETH gas balance is required.");
  }

  return {
    normalizedAmount,
    amountRaw
  };
}

export function validateBridgeWithdraw(input: WithdrawValidationInput): { normalizedAmount: string; amountRaw: bigint } {
  const normalizedAmount = assertPositiveAmount(input.amount);
  const amountRaw = parseUnits(normalizedAmount, 6);

  if (!isAddress(input.destination)) {
    throw new FundingBridgeError("invalid_destination", "Enter a valid Arbitrum destination address.");
  }
  if (!input.sourceBalanceAvailable) {
    throw new FundingBridgeError("source_balance_unavailable", "HyperCore USDC balance is unavailable.");
  }
  if (amountRaw > rawBalance(input.sourceBalanceRaw)) {
    throw new FundingBridgeError("insufficient_balance", "Insufficient HyperCore USDC balance.");
  }
  if (Number(normalizedAmount) <= Number(input.feeUsdc)) {
    throw new FundingBridgeError(
      "amount_below_fee",
      `Amount must be greater than the ${Number(input.feeUsdc).toFixed(0)} USDC withdraw fee.`
    );
  }

  return {
    normalizedAmount,
    amountRaw
  };
}

async function defaultSubmitDeposit(input: SubmitDepositInput): Promise<`0x${string}`> {
  return input.walletClient.writeContract({
    account: input.address,
    address: input.usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [input.bridgeContractAddress, parseUnits(input.amount, 6)],
    chain: input.walletClient.chain ?? undefined
  });
}

async function defaultSubmitWithdraw(input: SubmitWithdrawInput): Promise<void> {
  await withdraw3(
    {
      transport: new HttpTransport({
        apiUrl: input.hyperliquidExchangeUrl,
        fetchOptions: {
          cache: "no-store"
        }
      }),
      wallet: {
        address: input.address,
        async signTypedData(params: any) {
          return input.walletClient.signTypedData({
            ...params,
            account: input.address
          } as any);
        },
        async getChainId() {
          return input.walletClient.getChainId();
        }
      }
    },
    {
      destination: input.destination,
      amount: input.amount
    }
  );
}

async function defaultWaitForReceipt(input: { publicClient: PublicClient; hash: `0x${string}` }) {
  await input.publicClient.waitForTransactionReceipt({
    hash: input.hash
  });
}

export function createFundingBridgeClient(deps: Partial<BridgeClientDeps> = {}) {
  const resolvedDeps: BridgeClientDeps = {
    submitDeposit: deps.submitDeposit ?? defaultSubmitDeposit,
    submitWithdraw: deps.submitWithdraw ?? defaultSubmitWithdraw,
    waitForReceipt: deps.waitForReceipt ?? defaultWaitForReceipt
  };

  return {
    async submitDeposit(input: SubmitDepositInput): Promise<{ txHash: `0x${string}` }> {
      const txHash = await resolvedDeps.submitDeposit(input);
      await resolvedDeps.waitForReceipt({
        publicClient: input.publicClient,
        hash: txHash
      });
      return { txHash };
    },
    async submitWithdraw(input: SubmitWithdrawInput): Promise<void> {
      await resolvedDeps.submitWithdraw(input);
    }
  };
}
