"use client";

import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../../lib/web3/config";

export default function Web3Providers({ children }: { children: React.ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
