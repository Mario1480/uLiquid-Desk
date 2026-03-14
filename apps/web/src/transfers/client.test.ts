import assert from "node:assert/strict";
import test from "node:test";
import {
  createTransferClient,
  TransferClientError,
  validateTransferRequest
} from "../../lib/transfers/client";
import type { TransferCapability } from "../../lib/transfers/types";

function createCapability(overrides: Partial<TransferCapability> = {}): TransferCapability {
  return {
    id: "usdc_core_to_evm",
    direction: "core_to_evm",
    asset: "USDC",
    supported: true,
    mode: "client_write",
    reason: null,
    systemAddress: "0x2000000000000000000000000000000000000000",
    coreDepositWalletAddress: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24",
    hyperCoreToken: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
    evmAssetType: "erc20",
    evmTokenAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    requiresChainId: null,
    gas: {
      asset: "HYPE",
      location: "hyperCore",
      required: true,
      available: true,
      balance: {
        symbol: "HYPE",
        decimals: 18,
        raw: "1000000000000000000",
        formatted: "1",
        state: "available",
        available: true,
        reason: null
      },
      detail: "Core -> EVM requires HYPE on HyperCore / Spot for gas.",
      reason: null
    },
    ...overrides
  };
}

test("validateTransferRequest rejects zero amount", () => {
  assert.throws(
    () =>
      validateTransferRequest({
        amount: "0",
        capability: createCapability(),
        sourceBalanceRaw: "1000000",
        sourceBalanceAvailable: true,
        gasBalanceRaw: "1000000000000000000",
        gasAvailable: true,
        connectedChainId: 999,
        expectedChainId: 999
      }),
    (error: unknown) =>
      error instanceof TransferClientError
      && error.code === "invalid_amount"
  );
});

test("validateTransferRequest rejects insufficient source balance", () => {
  assert.throws(
    () =>
      validateTransferRequest({
        amount: "2",
        capability: createCapability(),
        sourceBalanceRaw: "1000000",
        sourceBalanceAvailable: true,
        gasBalanceRaw: "1000000000000000000",
        gasAvailable: true,
        connectedChainId: 999,
        expectedChainId: 999
      }),
    (error: unknown) =>
      error instanceof TransferClientError
      && error.code === "insufficient_balance"
  );
});

test("validateTransferRequest rejects missing gas balance", () => {
  assert.throws(
    () =>
      validateTransferRequest({
        amount: "1",
        capability: createCapability(),
        sourceBalanceRaw: "1000000",
        sourceBalanceAvailable: true,
        gasBalanceRaw: "0",
        gasAvailable: true,
        connectedChainId: 999,
        expectedChainId: 999
      }),
    (error: unknown) =>
      error instanceof TransferClientError
      && error.code === "missing_gas_balance"
  );
});

test("validateTransferRequest blocks wrong HyperEVM chain for EVM -> Core", () => {
  assert.throws(
    () =>
      validateTransferRequest({
        amount: "1",
        capability: createCapability({
          id: "usdc_evm_to_core",
          direction: "evm_to_core",
          requiresChainId: 999,
          gas: {
            ...createCapability().gas,
            location: "hyperEvm"
          }
        }),
        sourceBalanceRaw: "1000000",
        sourceBalanceAvailable: true,
        gasBalanceRaw: "1000000000000000000",
        gasAvailable: true,
        connectedChainId: 42161,
        expectedChainId: 999
      }),
    (error: unknown) =>
      error instanceof TransferClientError
      && error.code === "wrong_chain"
  );
});

test("submitTransfer returns queued state for Core -> EVM", async () => {
  const calls: string[] = [];
  const client = createTransferClient({
    async submitCoreToEvm() {
      calls.push("core");
    },
    async submitEvmToCore() {
      throw new Error("not_used");
    },
    async waitForReceipt() {
      throw new Error("not_used");
    }
  });

  const result = await client.submitTransfer({
    amount: "1",
    asset: "USDC",
    direction: "core_to_evm",
    capability: createCapability(),
    walletClient: {} as any,
    publicClient: null,
    address: "0x1234567890123456789012345678901234567890"
  });

  assert.deepEqual(calls, ["core"]);
  assert.equal(result.phase, "queued");
});

test("submitTransfer waits for receipt for EVM -> Core", async () => {
  const calls: string[] = [];
  const client = createTransferClient({
    async submitCoreToEvm() {
      throw new Error("not_used");
    },
    async submitEvmToCore() {
      calls.push("evm");
      return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    },
    async waitForReceipt() {
      calls.push("wait");
    }
  });

  const result = await client.submitTransfer({
    amount: "1",
    asset: "HYPE",
    direction: "evm_to_core",
    capability: createCapability({
      id: "hype_evm_to_core",
      direction: "evm_to_core",
      asset: "HYPE",
      evmAssetType: "native",
      evmTokenAddress: null,
      requiresChainId: 999,
      gas: {
        ...createCapability().gas,
        location: "hyperEvm"
      }
    }),
    walletClient: {} as any,
    publicClient: {} as any,
    address: "0x1234567890123456789012345678901234567890"
  });

  assert.deepEqual(calls, ["evm", "wait"]);
  assert.equal(result.phase, "confirmed");
});

test("submitTransfer performs approve + deposit for USDC EVM -> Core", async () => {
  const writes: Array<{ fn: string; args: unknown[] }> = [];
  const waits: string[] = [];
  const allowanceReads: string[] = [];
  const approvalHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const depositHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const client = createTransferClient();
  const result = await client.submitTransfer({
    amount: "5",
    asset: "USDC",
    direction: "evm_to_core",
    capability: createCapability({
      id: "usdc_evm_to_core",
      direction: "evm_to_core",
      requiresChainId: 999,
      gas: {
        ...createCapability().gas,
        location: "hyperEvm"
      }
    }),
    walletClient: {
      writeContract: async (input: any) => {
        writes.push({ fn: input.functionName, args: input.args });
        return input.functionName === "approve" ? approvalHash : depositHash;
      }
    } as any,
    publicClient: {
      readContract: async () => {
        allowanceReads.push("allowance");
        return 0n;
      },
      waitForTransactionReceipt: async ({ hash }: any) => {
        waits.push(hash);
      }
    } as any,
    address: "0x1234567890123456789012345678901234567890"
  });

  assert.deepEqual(allowanceReads, ["allowance"]);
  assert.deepEqual(
    writes.map((entry) => entry.fn),
    ["approve", "deposit"]
  );
  assert.deepEqual(waits, [approvalHash, depositHash]);
  assert.deepEqual(writes[1]?.args, [5000000n, 4294967295n]);
  assert.equal(result.phase, "confirmed");
  assert.equal(result.txHash, depositHash);
});
