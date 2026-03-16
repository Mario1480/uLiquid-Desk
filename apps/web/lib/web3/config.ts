import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { supportedChains, targetChain, targetChainId, targetChainName } from "./chains";
import { web3Env } from "./env";

export const web3ModalProjectId = web3Env.walletConnectProjectId;
export const isWeb3ModalReady = Boolean(web3ModalProjectId);
const isBrowserRuntime = typeof window !== "undefined";

const connectors = isBrowserRuntime && isWeb3ModalReady
  ? [
      walletConnect({
        projectId: web3ModalProjectId!,
        showQrModal: false,
        metadata: {
          name: "uLiquid Desk",
          description: "uLiquid Desk wallet connection",
          url: "https://desk.uliquid.vip",
          icons: ["https://desk.uliquid.vip/favicon.ico"]
        }
      }),
      injected({ shimDisconnect: true })
    ]
  : [injected({ shimDisconnect: true })];

const transports = Object.fromEntries(
  supportedChains.map((chain) => [chain.id, http(chain.rpcUrls.default.http[0] ?? undefined)])
);

export const wagmiConfig = createConfig({
  chains: supportedChains as [typeof supportedChains[number], ...typeof supportedChains[number][]],
  connectors,
  transports: transports as Record<number, ReturnType<typeof http>>,
  ssr: true
});

export const TARGET_CHAIN = targetChain;
export const TARGET_CHAIN_ID = targetChainId;
export const TARGET_CHAIN_NAME = targetChainName;
