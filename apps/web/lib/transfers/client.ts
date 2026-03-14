"use client";

import { erc20Abi, parseUnits } from "viem";
import type { Address, PublicClient, WalletClient } from "viem";
import type {
  TransferAsset,
  TransferCapability,
  TransferDirection,
  TransferExecutionState
} from "./types";

export class TransferClientError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type SubmitTransferInput = {
  amount: string;
  asset: TransferAsset;
  direction: TransferDirection;
  capability: TransferCapability;
  walletClient: WalletClient;
  publicClient: PublicClient | null;
  address: Address;
};

type TransferClientDeps = {
  submitCoreToEvm: (input: SubmitTransferInput) => Promise<void>;
  submitEvmToCore: (input: SubmitTransferInput) => Promise<`0x${string}`>;
  waitForReceipt: (input: { publicClient: PublicClient; hash: `0x${string}` }) => Promise<void>;
};

function assertPositiveAmount(amount: string): string {
  const normalized = String(amount ?? "").trim();
  if (!normalized) throw new TransferClientError("invalid_amount", "Enter an amount.");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new TransferClientError("invalid_amount", "Enter an amount greater than zero.");
  }
  return normalized;
}

export function rawBalance(balance: { raw: string | null }): bigint {
  try {
    return BigInt(balance.raw ?? "0");
  } catch {
    return BigInt(0);
  }
}

export function validateTransferRequest(input: {
  amount: string;
  capability: TransferCapability;
  sourceBalanceRaw: string | null;
  sourceBalanceAvailable: boolean;
  gasBalanceRaw: string | null;
  gasAvailable: boolean;
  connectedChainId: number | null | undefined;
  expectedChainId: number;
}): { normalizedAmount: string; amountRaw: bigint } {
  const normalizedAmount = assertPositiveAmount(input.amount);
  if (!input.capability.supported) {
    throw new TransferClientError(
      "unsupported_asset",
      input.capability.reason ?? "This asset is not supported for the selected direction."
    );
  }

  const amountRaw = parseUnits(normalizedAmount, input.capability.asset === "USDC" ? 6 : 18);
  if (!input.sourceBalanceAvailable) {
    throw new TransferClientError("source_balance_unavailable", "Source balance is unavailable.");
  }
  if (amountRaw > rawBalance({ raw: input.sourceBalanceRaw })) {
    throw new TransferClientError("insufficient_balance", "Insufficient source balance.");
  }
  if (!input.gasAvailable || rawBalance({ raw: input.gasBalanceRaw }) <= BigInt(0)) {
    throw new TransferClientError("missing_gas_balance", input.capability.gas.detail);
  }
  if (
    input.capability.direction === "evm_to_core"
    && input.connectedChainId !== input.expectedChainId
  ) {
    throw new TransferClientError("wrong_chain", "Switch to HyperEVM to continue.");
  }

  return {
    normalizedAmount,
    amountRaw
  };
}

async function defaultSubmitCoreToEvm(input: SubmitTransferInput): Promise<void> {
  void input;
  throw new TransferClientError(
    "core_transfer_adapter_missing",
    "HyperCore transfer adapter is not configured."
  );
}

async function defaultSubmitEvmToCore(input: SubmitTransferInput): Promise<`0x${string}`> {
  if (input.asset === "USDC") {
    if (!input.capability.evmTokenAddress) {
      throw new TransferClientError("transfer_metadata_missing", "USDC token address is missing.");
    }
    if (!input.capability.coreDepositWalletAddress) {
      throw new TransferClientError("transfer_metadata_missing", "Core deposit wallet address is missing.");
    }
    if (!input.publicClient) {
      throw new TransferClientError("public_client_missing", "HyperEVM public client is unavailable.");
    }
    const amountRaw = parseUnits(input.amount, 6);
    const allowanceRaw = await (input.publicClient as any).readContract({
      address: input.capability.evmTokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.address, input.capability.coreDepositWalletAddress]
    }) as bigint;

    if (allowanceRaw < amountRaw) {
      const approvalHash = await input.walletClient.writeContract({
        account: input.address,
        address: input.capability.evmTokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [input.capability.coreDepositWalletAddress, amountRaw],
        chain: input.walletClient.chain ?? undefined
      });
      await input.publicClient.waitForTransactionReceipt({
        hash: approvalHash
      });
    }

    return input.walletClient.writeContract({
      account: input.address,
      address: input.capability.coreDepositWalletAddress,
      abi: [
        {
          type: "function",
          name: "deposit",
          stateMutability: "nonpayable",
          inputs: [
            { name: "amount", type: "uint256" },
            { name: "destination", type: "uint64" }
          ],
          outputs: []
        }
      ],
      functionName: "deposit",
        args: [
          amountRaw,
          BigInt("4294967295")
        ],
      chain: input.walletClient.chain ?? undefined
    });
  }

  if (!input.capability.systemAddress) {
    throw new TransferClientError("transfer_metadata_missing", "Transfer system address is missing.");
  }

  return input.walletClient.sendTransaction({
    account: input.address,
    to: input.capability.systemAddress,
    value: parseUnits(input.amount, 18),
    chain: input.walletClient.chain ?? undefined
  } as any);
}

async function defaultWaitForReceipt(input: { publicClient: PublicClient; hash: `0x${string}` }) {
  await input.publicClient.waitForTransactionReceipt({
    hash: input.hash
  });
}

export function createTransferClient(deps: Partial<TransferClientDeps> = {}) {
  const resolvedDeps: TransferClientDeps = {
    submitCoreToEvm: deps.submitCoreToEvm ?? defaultSubmitCoreToEvm,
    submitEvmToCore: deps.submitEvmToCore ?? defaultSubmitEvmToCore,
    waitForReceipt: deps.waitForReceipt ?? defaultWaitForReceipt
  };

  return {
    async submitTransfer(input: SubmitTransferInput): Promise<TransferExecutionState> {
      const normalizedAmount = assertPositiveAmount(input.amount);

      if (input.direction === "core_to_evm") {
        await resolvedDeps.submitCoreToEvm({
          ...input,
          amount: normalizedAmount
        });
        return {
          phase: "queued",
          message: "Transfer submitted to HyperCore and queued for the next HyperEVM block.",
          txHash: null
        };
      }

      if (!input.publicClient) {
        throw new TransferClientError("public_client_missing", "HyperEVM public client is unavailable.");
      }

      const txHash = await resolvedDeps.submitEvmToCore({
        ...input,
        amount: normalizedAmount
      });
      await resolvedDeps.waitForReceipt({
        publicClient: input.publicClient,
        hash: txHash
      });
      return {
        phase: "confirmed",
        message: "Transfer confirmed on HyperEVM and forwarded back to HyperCore.",
        txHash
      };
    }
  };
}

export function isTransferCapableAsset(value: string): value is TransferAsset {
  return value === "USDC" || value === "HYPE";
}

export function isTransferDirection(value: string): value is TransferDirection {
  return value === "core_to_evm" || value === "evm_to_core";
}
