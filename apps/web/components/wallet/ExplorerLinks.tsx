"use client";

import { AppIcon } from "../../app/components/AppIcon";
import {
  DEFAULT_HYPEREVM_EXPLORER_URL,
  buildExplorerAddressUrl,
  buildExplorerTxUrl
} from "../../lib/wallet/format";

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function HyperEvmAddressLink({
  address,
  explorerUrl = DEFAULT_HYPEREVM_EXPLORER_URL,
  className = "btn",
  label = "Open in HyperEVMScan"
}: {
  address: string | null | undefined;
  explorerUrl?: string | null;
  className?: string;
  label?: string;
}) {
  const normalized = normalizeValue(address);
  if (!normalized) return null;

  return (
    <a className={className} href={buildExplorerAddressUrl(explorerUrl, normalized)} target="_blank" rel="noreferrer">
      <AppIcon name="external" />
      {label}
    </a>
  );
}

export function HyperEvmTxLink({
  txHash,
  explorerUrl = DEFAULT_HYPEREVM_EXPLORER_URL,
  className = "btn",
  label = "View transaction"
}: {
  txHash: string | null | undefined;
  explorerUrl?: string | null;
  className?: string;
  label?: string;
}) {
  const normalized = normalizeValue(txHash);
  if (!normalized) return null;

  return (
    <a className={className} href={buildExplorerTxUrl(explorerUrl, normalized)} target="_blank" rel="noreferrer">
      <AppIcon name="external" />
      {label}
    </a>
  );
}
