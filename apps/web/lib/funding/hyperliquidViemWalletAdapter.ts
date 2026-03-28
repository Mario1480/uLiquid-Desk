"use client";

import type { Address, WalletClient } from "viem";

type HyperliquidTypedDataParams = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

function sanitizeTypes(types: HyperliquidTypedDataParams["types"]) {
  const next = { ...types };
  delete (next as Record<string, unknown>).EIP712Domain;
  return next;
}

async function signViaJsonRpc(
  walletClient: WalletClient,
  address: Address,
  params: HyperliquidTypedDataParams,
): Promise<`0x${string}`> {
  if (typeof walletClient.request !== "function") {
    throw new Error("wallet_request_unavailable");
  }

  const payload = {
    domain: params.domain,
    types: params.types,
    primaryType: params.primaryType,
    message: params.message,
  };

  try {
    return await walletClient.request({
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(payload)],
    }) as `0x${string}`;
  } catch {
    try {
      return await walletClient.request({
        method: "eth_signTypedData_v3",
        params: [address, JSON.stringify(payload)],
      }) as `0x${string}`;
    } catch {
      return await walletClient.request({
        method: "eth_signTypedData",
        params: [address, payload],
      }) as `0x${string}`;
    }
  }
}

export function createHyperliquidViemWalletAdapter(input: {
  walletClient: WalletClient;
  address: Address;
  chainId: number;
}) {
  return {
    address: input.address,
    async signTypedData(params: HyperliquidTypedDataParams) {
      try {
        return await signViaJsonRpc(input.walletClient, input.address, params);
      } catch {
        return await input.walletClient.signTypedData({
          account: input.address,
          domain: params.domain as any,
          types: sanitizeTypes(params.types) as any,
          primaryType: params.primaryType as any,
          message: params.message as any,
        } as any);
      }
    },
    async getAddresses() {
      return [input.address];
    },
    async getChainId() {
      return input.chainId;
    }
  };
}
