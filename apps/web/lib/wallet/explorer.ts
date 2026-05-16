export const DEFAULT_HYPEREVM_EXPLORER_URL = "https://hyperevmscan.io";

export function normalizeExplorerBaseUrl(explorerUrl: string | null | undefined): string {
  const raw = String(explorerUrl ?? "").trim() || DEFAULT_HYPEREVM_EXPLORER_URL;
  return raw.replace(/\/$/, "");
}

export function buildExplorerAddressUrl(explorerUrl: string | null | undefined, address: string): string {
  return `${normalizeExplorerBaseUrl(explorerUrl)}/address/${address}`;
}

export function buildExplorerTxUrl(explorerUrl: string | null | undefined, txHash: string): string {
  return `${normalizeExplorerBaseUrl(explorerUrl)}/tx/${txHash}`;
}

export function buildHyperEvmAddressUrl(address: string): string {
  return buildExplorerAddressUrl(DEFAULT_HYPEREVM_EXPLORER_URL, address);
}

export function buildHyperEvmTxUrl(txHash: string): string {
  return buildExplorerTxUrl(DEFAULT_HYPEREVM_EXPLORER_URL, txHash);
}
