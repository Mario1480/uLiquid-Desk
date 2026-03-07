import { defineChain, type Chain } from "viem";
import { arbitrum } from "viem/chains";
import { web3Env } from "./env";

const HYPEREVM_EXPLORER_NAME = "HyperEVM Explorer";
const HYPEREVM_NAME = "HyperEVM";
const HYPEREVM_RPC_FALLBACK = "https://rpc.hyperliquid.xyz/evm";

export const hyperEvmChain: Chain = {
  ...defineChain({
    id: 999,
    name: HYPEREVM_NAME,
    nativeCurrency: {
      name: "Hyperliquid",
      symbol: "HYPE",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [HYPEREVM_RPC_FALLBACK]
      }
    },
    blockExplorers: {
      default: {
        name: HYPEREVM_EXPLORER_NAME,
        url: "https://app.hyperliquid.xyz/explorer"
      }
    }
  }),
  rpcUrls: {
    default: { http: [web3Env.hyperEvmRpcUrl] },
    public: { http: [web3Env.hyperEvmRpcUrl] }
  },
  blockExplorers: {
    default: {
      name: HYPEREVM_EXPLORER_NAME,
      url: web3Env.hyperEvmExplorerUrl
    }
  }
};

export const supportedChains: Chain[] = web3Env.enableArbitrum
  ? [hyperEvmChain, arbitrum]
  : [hyperEvmChain];

export const targetChain =
  supportedChains.find((chain) => chain.id === web3Env.targetChainId) ?? hyperEvmChain;

export const targetChainId = targetChain.id;
export const targetChainName = targetChain.name;
