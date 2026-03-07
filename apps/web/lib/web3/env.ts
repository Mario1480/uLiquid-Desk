const DEFAULT_TARGET_CHAIN_ID = 999;
const DEFAULT_HYPEREVM_RPC_URL = "https://rpc.hyperliquid.xyz/evm";
const DEFAULT_HYPEREVM_EXPLORER_URL = "https://app.hyperliquid.xyz/explorer";
const DEFAULT_ENABLE_ARBITRUM = true;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function parseOptionalString(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export const web3Env = {
  targetChainId: parseNumber(process.env.NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID, DEFAULT_TARGET_CHAIN_ID),
  hyperEvmRpcUrl: parseOptionalString(process.env.NEXT_PUBLIC_HYPEREVM_RPC_URL) ?? DEFAULT_HYPEREVM_RPC_URL,
  hyperEvmExplorerUrl:
    parseOptionalString(process.env.NEXT_PUBLIC_HYPEREVM_EXPLORER_URL) ?? DEFAULT_HYPEREVM_EXPLORER_URL,
  walletConnectProjectId: parseOptionalString(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
  enableArbitrum: parseBoolean(process.env.NEXT_PUBLIC_WEB3_ENABLE_ARBITRUM, DEFAULT_ENABLE_ARBITRUM)
};

