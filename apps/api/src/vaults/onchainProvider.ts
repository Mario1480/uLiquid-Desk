import {
  createPublicClient,
  encodeFunctionData,
  http,
  pad,
  toHex,
  type PublicClient
} from "viem";
import { botVaultAbi, masterVaultAbi, masterVaultFactoryAbi } from "./onchainAbi.js";
import type { OnchainAddressBook } from "./onchainAddressBook.js";
import type { OnchainProvider, OnchainTxRequest } from "./onchainProvider.types.js";

function toBytes32(value: string): `0x${string}` {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return pad("0x", { size: 32 });
  const hex = toHex(trimmed);
  return pad(hex, { size: 32 });
}

function buildTxRequest(addressBook: OnchainAddressBook, to: `0x${string}`, data: `0x${string}`, value = "0"): OnchainTxRequest {
  return {
    to,
    data,
    value,
    chainId: addressBook.chainId
  };
}

export function createOnchainPublicClient(addressBook: OnchainAddressBook): PublicClient {
  return createPublicClient({
    transport: http(addressBook.rpcUrl),
    chain: {
      id: addressBook.chainId,
      name: addressBook.chainId === 999 ? "HyperEVM" : `EVM-${addressBook.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: {
          http: [addressBook.rpcUrl]
        }
      }
    }
  });
}

export function createOnchainProvider(addressBook: OnchainAddressBook): OnchainProvider {
  return {
    async buildCreateMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultFactoryAbi,
        functionName: "createMasterVault",
        args: [input.ownerAddress]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildDepositToMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultAbi,
        functionName: "deposit",
        args: [addressBook.usdcAddress, input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildWithdrawFromMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultAbi,
        functionName: "withdraw",
        args: [input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildCreateBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultAbi,
        functionName: "createBotVault",
        args: [toBytes32(input.templateId), toBytes32(input.botId), input.allocationAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildSetTreasuryRecipientTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultFactoryAbi,
        functionName: "setTreasuryRecipient",
        args: [input.treasuryRecipient]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildSetProfitShareFeeRateTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultFactoryAbi,
        functionName: "setProfitShareFeeRatePct",
        args: [input.feeRatePct]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildClaimFromBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultAbi,
        functionName: "claimFromBotVault",
        args: [input.botVaultAddress, input.releasedReservedAtomic, input.grossReturnedAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildCloseBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultAbi,
        functionName: "closeBotVault",
        args: [input.botVaultAddress, input.releasedReservedAtomic, input.grossReturnedAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    }
  };
}

export function formatUsdFromAtomic(value: bigint, decimals = 6): number {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
}

export function formatSignedUsdFromAtomic(value: bigint, decimals = 6): number {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const parsed = formatUsdFromAtomic(abs, decimals);
  return negative ? -parsed : parsed;
}

export async function readMasterVaultState(client: PublicClient, address: `0x${string}`) {
  const [freeBalance, reservedBalance] = await Promise.all([
    client.readContract({ abi: masterVaultAbi, address, functionName: "freeBalance" }),
    client.readContract({ abi: masterVaultAbi, address, functionName: "reservedBalance" })
  ]);
  return {
    freeBalance: formatUsdFromAtomic(BigInt(freeBalance as bigint)),
    reservedBalance: formatUsdFromAtomic(BigInt(reservedBalance as bigint))
  };
}

export async function readFactoryTreasuryRecipient(
  client: PublicClient,
  factoryAddress: `0x${string}`
): Promise<`0x${string}` | null> {
  try {
    const result = await client.readContract({
      abi: masterVaultFactoryAbi,
      address: factoryAddress,
      functionName: "treasuryRecipient"
    });
    const normalized = String(result ?? "").trim();
    if (!normalized || normalized === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    return normalized as `0x${string}`;
  } catch {
    return null;
  }
}

export async function readFactoryProfitShareFeeRatePct(
  client: PublicClient,
  factoryAddress: `0x${string}`
): Promise<number | null> {
  try {
    const result = await client.readContract({
      abi: masterVaultFactoryAbi,
      address: factoryAddress,
      functionName: "profitShareFeeRatePct"
    });
    const parsed = Number(result ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readMasterVaultAddressForOwner(
  client: PublicClient,
  factoryAddress: `0x${string}`,
  ownerAddress: `0x${string}`
): Promise<`0x${string}` | null> {
  const result = await client.readContract({
    abi: masterVaultFactoryAbi,
    address: factoryAddress,
    functionName: "masterVaultOf",
    args: [ownerAddress]
  });
  const normalized = String(result ?? "").trim();
  if (!normalized || normalized === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return normalized as `0x${string}`;
}

export async function readBotVaultState(client: PublicClient, address: `0x${string}`) {
  const [status, principalAllocated, principalReturned, realizedPnlNet, feePaidTotal, highWaterMark] = await Promise.all([
    client.readContract({ abi: botVaultAbi, address, functionName: "status" }),
    client.readContract({ abi: botVaultAbi, address, functionName: "principalAllocated" }),
    client.readContract({ abi: botVaultAbi, address, functionName: "principalReturned" }),
    client.readContract({ abi: botVaultAbi, address, functionName: "realizedPnlNet" }),
    client.readContract({ abi: botVaultAbi, address, functionName: "feePaidTotal" }),
    client.readContract({ abi: botVaultAbi, address, functionName: "highWaterMark" })
  ]);

  return {
    status: Number(status),
    principalAllocated: formatUsdFromAtomic(BigInt(principalAllocated as bigint)),
    principalReturned: formatUsdFromAtomic(BigInt(principalReturned as bigint)),
    realizedPnlNet: formatSignedUsdFromAtomic(BigInt(realizedPnlNet as bigint)),
    feePaidTotal: formatUsdFromAtomic(BigInt(feePaidTotal as bigint)),
    highWaterMark: formatUsdFromAtomic(BigInt(highWaterMark as bigint))
  };
}

export async function readMasterVaultTreasuryRecipient(
  client: PublicClient,
  address: `0x${string}`
): Promise<`0x${string}` | null> {
  try {
    const result = await client.readContract({
      abi: masterVaultAbi,
      address,
      functionName: "treasuryRecipient"
    });
    const normalized = String(result ?? "").trim();
    if (!normalized || normalized === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    return normalized as `0x${string}`;
  } catch {
    return null;
  }
}

export async function readMasterVaultProfitShareFeeRatePct(
  client: PublicClient,
  address: `0x${string}`
): Promise<number | null> {
  try {
    const result = await client.readContract({
      abi: masterVaultAbi,
      address,
      functionName: "profitShareFeeRatePct"
    });
    const parsed = Number(result ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
  } catch {
    return null;
  }
}
