import { http, createConfig } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { injected, walletConnect } from "wagmi/connectors";
import { supportedChains, targetChain, targetChainId, targetChainName } from "./chains";
import { web3Env } from "./env";

export const web3ModalProjectId = web3Env.walletConnectProjectId;
export const isWeb3ModalReady = Boolean(web3ModalProjectId);
export const web3ModalMetadata = {
  name: "uLiquid Desk",
  description: "uLiquid Desk wallet connection",
  url: "https://desk.uliquid.vip",
  icons: ["https://desk.uliquid.vip/favicon.ico"]
};

const transports = Object.fromEntries(
  supportedChains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0] ?? undefined)])
);

const fallbackConnectors = [
  injected({
    target: {
      id: "metaMask",
      name: "MetaMask",
      provider(window) {
        const injectedProviders = window?.ethereum?.providers ?? (window?.ethereum ? [window.ethereum] : []);
        return injectedProviders.find((provider) =>
          provider.isMetaMask && !provider.isTrust && !provider.isTrustWallet
        );
      }
    },
    shimDisconnect: true
  }),
  injected({ shimDisconnect: true })
];
const appKitConnectors = web3ModalProjectId
  ? [
      walletConnect({
        projectId: web3ModalProjectId,
        showQrModal: false,
        metadata: web3ModalMetadata
      }),
      ...fallbackConnectors
    ]
  : fallbackConnectors;

export const appKitNetworks = supportedChains as [AppKitNetwork, ...AppKitNetwork[]];
export const appKitAdapter = web3ModalProjectId
  ? new WagmiAdapter({
      networks: appKitNetworks,
      projectId: web3ModalProjectId,
      connectors: appKitConnectors,
      transports: transports as Record<number, ReturnType<typeof http>>,
      ssr: true
    })
  : null;

const fallbackWagmiConfig = createConfig({
  chains: supportedChains as [typeof supportedChains[number], ...typeof supportedChains[number][]],
  connectors: fallbackConnectors,
  transports: transports as Record<number, ReturnType<typeof http>>,
  ssr: true
});

export const wagmiConfig = appKitAdapter?.wagmiConfig ?? fallbackWagmiConfig;
export const TARGET_CHAIN = targetChain;
export const TARGET_CHAIN_ID = targetChainId;
export const TARGET_CHAIN_NAME = targetChainName;
export const HEADER_SWITCH_CHAINS = supportedChains.filter(
  (chain) => chain.id === 999
    || chain.id === 42161
    || (web3Env.publicPresaleEnabled && chain.id === web3Env.publicPresaleChainId)
);
export const SUPPORTED_CHAINS = supportedChains;
