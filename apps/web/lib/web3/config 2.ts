import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { supportedChains, targetChainId, targetChainName } from "./chains";
import { web3Env } from "./env";

const walletConnectConnector = web3Env.walletConnectProjectId
  ? walletConnect({
      projectId: web3Env.walletConnectProjectId,
      showQrModal: true,
      metadata: {
        name: "uTrade Panel",
        description: "uTrade wallet connection",
        url: "https://utrade.vip",
        icons: ["https://utrade.vip/favicon.ico"]
      }
    })
  : null;

const connectors = walletConnectConnector ? [injected(), walletConnectConnector] : [injected()];

const transports = Object.fromEntries(
  supportedChains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0] ?? undefined)])
);

export const wagmiConfig = createConfig({
  chains: supportedChains as [typeof supportedChains[number], ...typeof supportedChains[number][]],
  connectors,
  transports: transports as Record<number, ReturnType<typeof http>>,
  ssr: true
});

export const TARGET_CHAIN_ID = targetChainId;
export const TARGET_CHAIN_NAME = targetChainName;
export const WALLETCONNECT_ENABLED = Boolean(web3Env.walletConnectProjectId);
