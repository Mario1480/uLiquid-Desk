import { targetChain } from "./chains";
import {
  appKitAdapter,
  appKitNetworks,
  isWeb3ModalReady,
  web3ModalMetadata,
  web3ModalProjectId
} from "./config";

type Web3ModalView = "Connect" | "Networks";
type Web3ModalOpenOptions = { view?: Web3ModalView };
type Web3ModalInstance = { open: (options?: Web3ModalOpenOptions) => Promise<void> | void };

let isInitialized = false;
let initError: string | null = null;
let initPromise: Promise<{ initialized: boolean; error: string | null }> | null = null;
let modalInstance: Web3ModalInstance | null = null;

export async function initWeb3Modal(): Promise<{ initialized: boolean; error: string | null }> {
  if (isInitialized || initError) {
    return { initialized: isInitialized, error: initError };
  }
  if (initPromise) {
    return initPromise;
  }

  if (!isWeb3ModalReady || !web3ModalProjectId || !appKitAdapter) {
    initError = "missing_walletconnect_project_id";
    return { initialized: false, error: initError };
  }
  if (typeof window === "undefined") {
    return { initialized: false, error: null };
  }

  initPromise = import("@reown/appkit/react")
    .then(({ createAppKit }) => {
      modalInstance = createAppKit({
        adapters: [appKitAdapter],
        networks: appKitNetworks,
        projectId: web3ModalProjectId,
        defaultNetwork: targetChain,
        metadata: web3ModalMetadata,
        themeMode: "dark",
        enableWalletConnect: true,
        features: {
          analytics: false,
          email: false,
          socials: false,
          swaps: false,
          onramp: false,
          history: false
        }
      }) as Web3ModalInstance;
      isInitialized = true;
      return { initialized: true, error: null };
    })
    .catch((error: unknown) => {
      initError = error instanceof Error ? error.message : "web3modal_init_failed";
      return { initialized: false, error: initError };
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

export function getWeb3ModalInitState(): { initialized: boolean; error: string | null } {
  return { initialized: isInitialized, error: initError };
}

export async function openWeb3Modal(options?: Web3ModalOpenOptions): Promise<void> {
  const state = await initWeb3Modal();
  if (!state.initialized || !modalInstance) {
    throw new Error(state.error ?? "web3modal_not_initialized");
  }
  await modalInstance.open(options);
}
