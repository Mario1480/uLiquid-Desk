import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  toHex,
  type PublicClient
} from "viem";
import {
  botVaultAbi,
  botVaultFactoryV3Abi,
  botVaultV2Abi,
  botVaultV3Abi,
  masterVaultAbi,
  masterVaultFactoryAbi,
  masterVaultFactoryV2Abi,
  masterVaultV2Abi
} from "./onchainAbi.js";
import type { OnchainAddressBook } from "./onchainAddressBook.js";
import type { OnchainProvider, OnchainTxRequest } from "./onchainProvider.types.js";

function toBytes32(value: string): `0x${string}` {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return pad("0x", { size: 32 });
  const hex = toHex(trimmed);
  if ((hex.length - 2) / 2 > 32) {
    return keccak256(hex);
  }
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
  const factoryAbi =
    addressBook.contractVersion === "v3"
      ? botVaultFactoryV3Abi
      : addressBook.contractVersion === "v2"
        ? masterVaultFactoryV2Abi
        : masterVaultFactoryAbi;
  const vaultAbi = addressBook.contractVersion === "v2" ? masterVaultV2Abi : masterVaultAbi;
  return {
    async buildCreateMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: "createMasterVault",
        args: [input.ownerAddress]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildDepositToMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "deposit",
        args: [addressBook.usdcAddress, input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildWithdrawFromMasterVaultTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "withdraw",
        args: [input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildCreateBotVaultTx(input) {
      const data =
        addressBook.contractVersion === "v2" && input.agentWallet
          ? encodeFunctionData({
              abi: masterVaultV2Abi,
              functionName: "createBotVault",
              args: [toBytes32(input.templateId), input.agentWallet]
            })
          : encodeFunctionData({
              abi: vaultAbi,
              functionName: "createBotVault",
              args: [toBytes32(input.templateId), toBytes32(input.botId), input.allocationAtomic]
            });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildReserveForBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "reserveForBotVault",
        args: [input.botVaultAddress, input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildFundBotVaultOnHyperCoreTx(input) {
      const amountAtomic = BigInt(input.amountAtomic);
      if (amountAtomic > BigInt("18446744073709551615")) {
        throw new Error("amount_atomic_exceeds_uint64");
      }
      const data = encodeFunctionData({
        abi: masterVaultV2Abi,
        functionName: "fundBotVaultOnHyperCore",
        args: [input.botVaultAddress, amountAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildSetBotVaultCloseOnlyTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "setBotVaultCloseOnly",
        args: [input.botVaultAddress]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildSetBotVaultAgentWalletTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultV2Abi,
        functionName: "setBotVaultAgentWallet",
        args: [input.botVaultAddress, input.agentWallet]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildSetTreasuryRecipientTx(input) {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: "setTreasuryRecipient",
        args: [input.treasuryRecipient]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildSetProfitShareFeeRateTx(input) {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: "setProfitShareFeeRatePct",
        args: [input.feeRatePct]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildClaimFromBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "claimFromBotVault",
        args: [input.botVaultAddress, input.releasedReservedAtomic, input.grossReturnedAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildCloseBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "closeBotVault",
        args: [input.botVaultAddress, input.releasedReservedAtomic, input.grossReturnedAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    },

    async buildCreateBotVaultV3Tx(input) {
      const data = encodeFunctionData({
        abi: botVaultFactoryV3Abi,
        functionName: "createBotVault",
        args: [
          input.beneficiaryAddress,
          input.controllerAddress,
          input.agentWallet ?? "0x0000000000000000000000000000000000000000",
          toBytes32(input.templateId),
          toBytes32(input.botId)
        ]
      });
      return buildTxRequest(addressBook, addressBook.factoryAddress, data);
    },

    async buildFundBotVaultV3Tx(input) {
      const data = encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "fund",
        args: [input.amountAtomic]
      });
      return buildTxRequest(addressBook, input.botVaultAddress, data);
    },

    async buildClaimProfitBotVaultV3Tx(input) {
      const data = encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "claimProfit",
        args: [input.grossAmountAtomic, input.feeAmountAtomic, input.principalPortionAtomic]
      });
      return buildTxRequest(addressBook, input.botVaultAddress, data);
    },

    async buildCloseBotVaultV3Tx(input) {
      const data = encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "closeVault",
        args: [input.principalToReturnAtomic, input.grossAmountAtomic, input.feeAmountAtomic]
      });
      return buildTxRequest(addressBook, input.botVaultAddress, data);
    },

    async buildSetBotVaultV3CloseOnlyTx(input) {
      const data = encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "setCloseOnly",
        args: []
      });
      return buildTxRequest(addressBook, input.botVaultAddress, data);
    },

    async buildSetBotVaultV3AgentWalletTx(input) {
      const data = encodeFunctionData({
        abi: botVaultV3Abi,
        functionName: "setAgentWallet",
        args: [input.agentWallet]
      });
      return buildTxRequest(addressBook, input.botVaultAddress, data);
    },

    async buildRecoverClosedBotVaultTx(input) {
      const data = encodeFunctionData({
        abi: masterVaultV2Abi,
        functionName: "recoverClosedBotVault",
        args: [input.botVaultAddress, input.releasedReservedAtomic, input.grossReturnedAtomic]
      });
      return buildTxRequest(addressBook, input.masterVaultAddress, data);
    }
  };
}

async function readWithAbiFallback<T>(
  client: PublicClient,
  input: {
    abi:
      | typeof masterVaultAbi
      | typeof masterVaultV2Abi
      | typeof masterVaultFactoryAbi
      | typeof masterVaultFactoryV2Abi
      | typeof botVaultAbi
      | typeof botVaultV2Abi
      | typeof botVaultFactoryV3Abi
      | typeof botVaultV3Abi;
    fallbackAbi:
      | typeof masterVaultAbi
      | typeof masterVaultV2Abi
      | typeof masterVaultFactoryAbi
      | typeof masterVaultFactoryV2Abi
      | typeof botVaultAbi
      | typeof botVaultV2Abi
      | typeof botVaultFactoryV3Abi
      | typeof botVaultV3Abi;
    address: `0x${string}`;
    functionName: string;
    args?: readonly unknown[];
  }
): Promise<T> {
  try {
    return await client.readContract({
      abi: input.abi as any,
      address: input.address,
      functionName: input.functionName as any,
      args: input.args as any
    }) as T;
  } catch {
    return await client.readContract({
      abi: input.fallbackAbi as any,
      address: input.address,
      functionName: input.functionName as any,
      args: input.args as any
    }) as T;
  }
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
    readWithAbiFallback<bigint>(client, {
      abi: masterVaultV2Abi,
      fallbackAbi: masterVaultAbi,
      address,
      functionName: "freeBalance"
    }),
    readWithAbiFallback<bigint>(client, {
      abi: masterVaultV2Abi,
      fallbackAbi: masterVaultAbi,
      address,
      functionName: "reservedBalance"
    })
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
    const result = await readWithAbiFallback<`0x${string}` | string>(client, {
      abi: masterVaultFactoryAbi,
      fallbackAbi: masterVaultFactoryV2Abi,
      address: factoryAddress,
      functionName: "treasuryRecipient"
    });
    const normalized = String(result ?? "").trim();
    if (!normalized || normalized === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    return normalized as `0x${string}`;
  } catch {
    try {
      const result = await client.readContract({
        abi: botVaultFactoryV3Abi,
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
}

export async function readFactoryProfitShareFeeRatePct(
  client: PublicClient,
  factoryAddress: `0x${string}`
): Promise<number | null> {
  try {
    const result = await readWithAbiFallback<bigint | number>(client, {
      abi: masterVaultFactoryAbi,
      fallbackAbi: masterVaultFactoryV2Abi,
      address: factoryAddress,
      functionName: "profitShareFeeRatePct"
    });
    const parsed = Number(result ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    return parsed;
  } catch {
    try {
      const result = await client.readContract({
        abi: botVaultFactoryV3Abi,
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
}

export async function readMasterVaultAddressForOwner(
  client: PublicClient,
  factoryAddress: `0x${string}`,
  ownerAddress: `0x${string}`
): Promise<`0x${string}` | null> {
  const result = await readWithAbiFallback<`0x${string}` | string>(client, {
    abi: masterVaultFactoryV2Abi,
    fallbackAbi: masterVaultFactoryAbi,
    address: factoryAddress,
    functionName: "masterVaultOf",
    args: [ownerAddress]
  }).catch(() => null);
  const normalized = String(result ?? "").trim();
  if (!normalized || normalized === "null" || normalized === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  return normalized as `0x${string}`;
}

export async function readBotVaultState(client: PublicClient, address: `0x${string}`) {
  const [status, principalAllocated, principalReturned, realizedPnlNet, feePaidTotal, highWaterMark] = await Promise.all([
    readWithAbiFallback<bigint | number>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "status" }),
    readWithAbiFallback<bigint>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "principalAllocated" }),
    readWithAbiFallback<bigint>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "principalReturned" }),
    readWithAbiFallback<bigint>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "realizedPnlNet" }),
    readWithAbiFallback<bigint>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "feePaidTotal" }),
    readWithAbiFallback<bigint>(client, { abi: botVaultV2Abi, fallbackAbi: botVaultAbi, address, functionName: "highWaterMark" })
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

export async function readBotVaultV3State(client: PublicClient, address: `0x${string}`) {
  const [status, principalDeposited, principalReturned, realizedPnlNet, feePaidTotal, highWaterMarkProfit] = await Promise.all([
    client.readContract({ abi: botVaultV3Abi, address, functionName: "status" }),
    client.readContract({ abi: botVaultV3Abi, address, functionName: "principalDeposited" }),
    client.readContract({ abi: botVaultV3Abi, address, functionName: "principalReturned" }),
    client.readContract({ abi: botVaultV3Abi, address, functionName: "realizedPnlNet" }),
    client.readContract({ abi: botVaultV3Abi, address, functionName: "feePaidTotal" }),
    client.readContract({ abi: botVaultV3Abi, address, functionName: "highWaterMarkProfit" })
  ]);

  return {
    status: Number(status),
    principalAllocated: formatUsdFromAtomic(BigInt(principalDeposited as bigint)),
    principalReturned: formatUsdFromAtomic(BigInt(principalReturned as bigint)),
    realizedPnlNet: formatSignedUsdFromAtomic(BigInt(realizedPnlNet as bigint)),
    feePaidTotal: formatUsdFromAtomic(BigInt(feePaidTotal as bigint)),
    highWaterMark: formatUsdFromAtomic(BigInt(highWaterMarkProfit as bigint))
  };
}

export async function readMasterVaultSettlementState(
  client: PublicClient,
  address: `0x${string}`,
  botVaultAddress: `0x${string}`
) {
  const [freeBalance, reservedBalance, tokenSurplus, principalOutstanding] = await Promise.all([
    readWithAbiFallback<bigint>(client, { abi: masterVaultV2Abi, fallbackAbi: masterVaultAbi, address, functionName: "freeBalance" }),
    readWithAbiFallback<bigint>(client, { abi: masterVaultV2Abi, fallbackAbi: masterVaultAbi, address, functionName: "reservedBalance" }),
    readWithAbiFallback<bigint>(client, { abi: masterVaultV2Abi, fallbackAbi: masterVaultAbi, address, functionName: "tokenSurplus" }),
    readWithAbiFallback<bigint>(client, {
      abi: masterVaultV2Abi,
      fallbackAbi: masterVaultAbi,
      address,
      functionName: "principalOutstanding",
      args: [botVaultAddress]
    })
  ]);

  return {
    freeBalance: formatUsdFromAtomic(BigInt(freeBalance as bigint)),
    reservedBalance: formatUsdFromAtomic(BigInt(reservedBalance as bigint)),
    tokenSurplus: formatUsdFromAtomic(BigInt(tokenSurplus as bigint)),
    principalOutstanding: formatUsdFromAtomic(BigInt(principalOutstanding as bigint))
  };
}

export async function readMasterVaultTreasuryRecipient(
  client: PublicClient,
  address: `0x${string}`
): Promise<`0x${string}` | null> {
  try {
    const result = await readWithAbiFallback<`0x${string}` | string>(client, {
      abi: masterVaultV2Abi,
      fallbackAbi: masterVaultAbi,
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
    const result = await readWithAbiFallback<bigint | number>(client, {
      abi: masterVaultV2Abi,
      fallbackAbi: masterVaultAbi,
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
