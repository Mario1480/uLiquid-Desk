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

export function createHyperliquidViemWalletAdapter(input: {
  walletClient: WalletClient;
  address: Address;
  chainId: number;
}) {
  return {
    address: input.address,
    async signTypedData(params: HyperliquidTypedDataParams) {
      return input.walletClient.signTypedData({
        account: input.address,
        domain: params.domain as any,
        types: sanitizeTypes(params.types) as any,
        primaryType: params.primaryType as any,
        message: params.message as any
      } as any);
    },
    async getAddresses() {
      return [input.address];
    },
    async getChainId() {
      return input.chainId;
    }
  };
}
